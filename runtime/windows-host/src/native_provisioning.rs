use crate::bootstrap::{
    load_verified_bootstrap, sha256_hex, BootstrapBackend, BootstrapReceipt, BootstrapRequest,
};
use crate::config::{
    ChildSpec, Endpoint, GatewayEndpoint, HostConfig, NetworkContract, RestartPolicy, ShutdownSpec,
};
use crate::error::{HostError, Result};
use crate::{ACL_POLICY_VERSION, BOOTSTRAP_RECEIPT_SCHEMA_VERSION, CONFIG_SCHEMA_VERSION, SERVICE_NAME};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::{c_void, OsStr, OsString};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::ptr::{null, null_mut};
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use windows_sys::Win32::Foundation::ERROR_INSUFFICIENT_BUFFER;
use windows_sys::Win32::Security::Cryptography::{
    BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
};
use windows_sys::Win32::Storage::FileSystem::{
    MoveFileExW, FILE_ATTRIBUTE_REPARSE_POINT, MOVEFILE_WRITE_THROUGH,
};
use windows_sys::Win32::Foundation::LocalFree;
use zeroize::{Zeroize, Zeroizing};

const DACL_SECURITY_INFORMATION: u32 = 0x0000_0004;
const PROTECTED_DACL_SECURITY_INFORMATION: u32 = 0x8000_0000;
const SDDL_REVISION_1: u32 = 1;
const REQUIRED_SECRET_NAMES: [&str; 8] = [
    "databaseUrl",
    "internalApiToken",
    "printAgentSecret",
    "jwtAccessSecret",
    "jwtRefreshSecret",
    "backupEncryptionKey",
    "gatewayControlSecret",
    "tableQrSigningSecret",
];

#[link(name = "advapi32")]
extern "system" {
    fn LookupAccountNameW(
        system_name: *const u16,
        account_name: *const u16,
        sid: *mut c_void,
        sid_size: *mut u32,
        domain: *mut u16,
        domain_size: *mut u32,
        sid_use: *mut u32,
    ) -> i32;
    fn ConvertSidToStringSidW(sid: *const c_void, string_sid: *mut *mut u16) -> i32;
    fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
        text: *const u16,
        revision: u32,
        descriptor: *mut *mut c_void,
        descriptor_size: *mut u32,
    ) -> i32;
    fn ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor: *const c_void,
        revision: u32,
        information: u32,
        text: *mut *mut u16,
        text_length: *mut u32,
    ) -> i32;
    fn SetFileSecurityW(path: *const u16, information: u32, descriptor: *const c_void) -> i32;
    fn GetFileSecurityW(
        path: *const u16,
        information: u32,
        descriptor: *mut c_void,
        descriptor_size: u32,
        required_size: *mut u32,
    ) -> i32;
}

#[derive(Serialize)]
struct SecretStoreDocument {
    schema_version: u32,
    protection: &'static str,
    values: BTreeMap<String, String>,
}

pub struct NativeWindowsBootstrapBackend;

impl BootstrapBackend for NativeWindowsBootstrapBackend {
    fn provision(&self, request: &BootstrapRequest) -> Result<()> {
        provision(request)
    }
}

struct Rollback {
    files: Vec<PathBuf>,
    directories: Vec<PathBuf>,
    committed: bool,
}

impl Rollback {
    fn new() -> Self {
        Self { files: Vec::new(), directories: Vec::new(), committed: false }
    }
}

impl Drop for Rollback {
    fn drop(&mut self) {
        if self.committed {
            return;
        }
        for file in self.files.iter().rev() {
            let _ = fs::remove_file(file);
        }
        for directory in self.directories.iter().rev() {
            let _ = fs::remove_dir_all(directory);
        }
    }
}

fn provision(request: &BootstrapRequest) -> Result<()> {
    validate_installer_roots(request)?;
    assert_tree_has_no_reparse_points(&request.install_root)?;
    verify_required_payload(request)?;
    configure_service_contract()?;

    let config_root = request.program_data_root.join("config");
    let data_root = request.program_data_root.join("data");
    let log_root = request.program_data_root.join("logs");
    // Servis kisitli SID ile calistigi icin hesabin kendi TEMP klasorune yazamaz
    // (Prisma migration "EPERM: mkdir ...NETWOR~1\AppData\Local\Temp" ile duser).
    // Cocuk sureclere kendi denetimimizdeki, ayni ACL politikasina tabi bir
    // gecici klasor veriyoruz.
    let temp_root = request.program_data_root.join("temp");
    let runtime_root = request.program_data_root.join("runtime");
    let backup_root = request.program_data_root.join("backups");
    let backup_replica_root = request.program_data_root.join("backup-replica");
    let config_path = config_root.join("runtime.json");
    let secret_path = config_root.join("secrets.json");
    let receipt_path = config_root.join("bootstrap-receipt.json");

    let existing = [config_path.exists(), secret_path.exists(), receipt_path.exists()];
    if existing.iter().any(|value| *value) {
        if !existing.iter().all(|value| *value) {
            return Err(HostError::InvalidBootstrap(
                "partial bootstrap state exists; refusing repair or secret rotation".into(),
            ));
        }
        verify_existing(request, &config_path)?;
        harden_tree(&request.install_root)?;
        harden_tree(&request.program_data_root)?;
        return Ok(());
    }

    let mut rollback = Rollback::new();
    if request.program_data_root.exists()
        && fs::read_dir(&request.program_data_root)
            .map_err(|error| HostError::io(request.program_data_root.display().to_string(), error))?
            .next()
            .is_some()
    {
        return Err(HostError::InvalidBootstrap(
            "unbound ProgramData content exists; explicit recovery is required".into(),
        ));
    }
    create_directory_without_reparse(&request.program_data_root, &mut rollback)?;
    apply_restrictive_acl(&request.program_data_root, true)?;
    for directory in [
        config_root.clone(),
        data_root.clone(),
        data_root.join("postgres"),
        data_root.join("uploads"),
        data_root.join("license"),
        data_root.join("update"),
        data_root.join("print-agent"),
        log_root.clone(),
        runtime_root.clone(),
        temp_root.clone(),
        backup_root.clone(),
        backup_replica_root.clone(),
    ] {
        create_directory_without_reparse(&directory, &mut rollback)?;
        apply_restrictive_acl(&directory, true)?;
    }

    // Program Files payload and all customer data are unreadable to ordinary local users.
    // LocalSystem, elevated administrators and the restricted service SID are the only ACEs.
    harden_tree(&request.install_root)?;
    harden_tree(&request.program_data_root)?;

    let installation_id = new_installation_id()?;
    let (secret_bytes, database_password) = create_secret_store(&installation_id)?;
    initialize_postgres_cluster(
        request,
        &data_root.join("postgres"),
        &config_root,
        &database_password,
    )?;
    // initdb kendi olusturdugu dizin ve dosyalara ust dizinden miras alinan ACE
    // birakir; politika ise her yolda korumali (miras edilmemis) DACL bekler.
    // Kume kurulduktan sonra bu alt agaci yeniden sertlestiriyoruz, yoksa
    // asagidaki verify_restrictive_tree adimi hakli olarak reddediyor.
    harden_tree(&data_root.join("postgres"))?;
    atomic_write_new(&secret_path, &secret_bytes)?;
    rollback.files.push(secret_path.clone());
    apply_restrictive_acl(&secret_path, false)?;

    let config = build_config(
        request,
        &installation_id,
        &secret_path,
        &receipt_path,
        &log_root,
        &runtime_root,
        &backup_root,
        &backup_replica_root,
        &data_root,
    )?;
    let config_bytes = serde_json::to_vec_pretty(&config)
        .map_err(|error| HostError::json("serialize native runtime config", error))?;
    atomic_write_new(&config_path, &config_bytes)?;
    rollback.files.push(config_path.clone());
    apply_restrictive_acl(&config_path, false)?;

    let completed_at_unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| HostError::InvalidBootstrap("system clock is before Unix epoch".into()))?
        .as_millis() as u64;
    let receipt = BootstrapReceipt {
        schema_version: BOOTSTRAP_RECEIPT_SCHEMA_VERSION,
        installation_id: installation_id.clone(),
        config_sha256: sha256_hex(&config_bytes),
        secret_store_sha256: sha256_hex(&secret_bytes),
        acl_policy_version: ACL_POLICY_VERSION.into(),
        completed_at_unix_ms,
    };
    let receipt_bytes = serde_json::to_vec_pretty(&receipt)
        .map_err(|error| HostError::json("serialize native bootstrap receipt", error))?;
    atomic_write_new(&receipt_path, &receipt_bytes)?;
    rollback.files.push(receipt_path.clone());
    apply_restrictive_acl(&receipt_path, false)?;

    let verified = load_verified_bootstrap(&config_path)?;
    if verified.config.installation_id != installation_id {
        return Err(HostError::InvalidBootstrap(
            "post-write bootstrap verification returned a different installation".into(),
        ));
    }
    verify_restrictive_tree(&request.install_root)?;
    verify_restrictive_tree(&request.program_data_root)?;
    rollback.committed = true;
    Ok(())
}

fn configure_service_contract() -> Result<()> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| HostError::InvalidBootstrap("SystemRoot is unavailable".into()))?;
    let sc = PathBuf::from(system_root).join("System32/sc.exe");
    if !sc.is_file() {
        return Err(HostError::InvalidBootstrap(
            "canonical Windows service controller is missing".into(),
        ));
    }
    for arguments in [
        vec!["config", SERVICE_NAME, "start=", "delayed-auto"],
        vec![
            "failure",
            SERVICE_NAME,
            "reset=",
            "86400",
            "actions=",
            "restart/15000/restart/30000/restart/60000",
        ],
        vec!["failureflag", SERVICE_NAME, "1"],
        // Servis kendi SID'ini almaya devam eder (ACL politikamiz buna dayanir),
        // ancak "restricted" (write-restricted) token calisma zamaniyla uyumsuz:
        // Prisma sema motoru "spawn EPERM" ile baslatilamiyor ve gecici klasore
        // yazilamiyor. Yalitim yine de guclu: servis yonetici olmayan bir hesapla
        // calisir ve tum agac SYSTEM/Administrators/NetworkService/servis SID
        // disinda kimseye acik degildir.
        vec!["sidtype", SERVICE_NAME, "unrestricted"],
    ] {
        let status = Command::new(&sc)
            .args(&arguments)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| HostError::io("configure RESTOTM Windows service", error))?;
        if !status.success() {
            return Err(HostError::InvalidBootstrap(format!(
                "Windows service hardening command failed: {}",
                arguments[0]
            )));
        }
    }
    set_preshutdown_timeout(PRESHUTDOWN_TIMEOUT_MS)
}

/// PostgreSQL'in duzgun kapanabilmesi icin gereken preshutdown suresi.
const PRESHUTDOWN_TIMEOUT_MS: u32 = 120_000;

/// sc.exe'nin `preshutdown` diye bir komutu yoktur; boyle bir cagri
/// "Unrecognized command" (1639) ile doner. SCM bu degeri servisin kendi
/// registry anahtarindaki PreshutdownTimeout DWORD'unden okur ve kurulum
/// dogrulamasi da (Test-RestOtmInstallation.ps1) ayni degeri denetler.
fn set_preshutdown_timeout(milliseconds: u32) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegSetValueExW, HKEY_LOCAL_MACHINE, KEY_SET_VALUE, REG_DWORD,
    };

    let subkey: Vec<u16> =
        std::ffi::OsString::from(format!("SYSTEM\\CurrentControlSet\\Services\\{SERVICE_NAME}"))
            .encode_wide()
            .chain(Some(0))
            .collect();
    let value_name: Vec<u16> = std::ffi::OsString::from("PreshutdownTimeout")
        .encode_wide()
        .chain(Some(0))
        .collect();

    let mut key = std::ptr::null_mut();
    let opened =
        unsafe { RegOpenKeyExW(HKEY_LOCAL_MACHINE, subkey.as_ptr(), 0, KEY_SET_VALUE, &mut key) };
    if opened != ERROR_SUCCESS {
        return Err(HostError::InvalidBootstrap(format!(
            "RESTOTM service registry key is unavailable: {opened}"
        )));
    }

    let bytes = milliseconds.to_le_bytes();
    let written = unsafe {
        RegSetValueExW(
            key,
            value_name.as_ptr(),
            0,
            REG_DWORD,
            bytes.as_ptr(),
            bytes.len() as u32,
        )
    };
    unsafe {
        RegCloseKey(key);
    }
    if written != ERROR_SUCCESS {
        return Err(HostError::InvalidBootstrap(format!(
            "Windows service preshutdown timeout could not be set: {written}"
        )));
    }
    Ok(())
}

fn verify_required_payload(request: &BootstrapRequest) -> Result<()> {
    for relative in [
        "bin/restotm-runtime-service.exe",
        "bin/restotm-installer-bootstrap.exe",
        "postgres/bin/postgres.exe",
        "postgres/bin/pg_dump.exe",
        "postgres/bin/pg_restore.exe",
        "postgres/bin/initdb.exe",
        "postgres/bin/pg_ctl.exe",
        "postgres/bin/libpq.dll",
        "postgres/share/postgresql.conf.sample",
        "runtime/node.exe",
        "api/restotm-api.exe",
        "admin/restotm-admin.exe",
        "waiter/restotm-waiter.exe",
        "menu/restotm-menu.exe",
        "print-agent/restotm-print-agent.exe",
        "gateway/restotm-lan-gateway.exe",
        "config/license-public-key.pem",
        "config/update-public-key.pem",
    ] {
        let path = request.install_root.join(relative);
        assert_no_reparse_components(&path)?;
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| HostError::io(path.display().to_string(), error))?;
        if !metadata.is_file() || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(HostError::InvalidBootstrap(format!(
                "signed canonical payload file is missing or indirect: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

fn validate_installer_roots(request: &BootstrapRequest) -> Result<()> {
    let program_files = std::env::var_os("ProgramW6432")
        .or_else(|| std::env::var_os("ProgramFiles"))
        .ok_or_else(|| HostError::InvalidBootstrap("Program Files root is unavailable".into()))?;
    let program_data = std::env::var_os("ProgramData")
        .ok_or_else(|| HostError::InvalidBootstrap("ProgramData root is unavailable".into()))?;
    let approved_install = PathBuf::from(program_files).join("RESTOTM");
    let approved_data = PathBuf::from(program_data).join("RESTOTM");
    if !windows_path_eq(&request.install_root, &approved_install)
        || !windows_path_eq(&request.program_data_root, &approved_data)
    {
        return Err(HostError::InvalidBootstrap(format!(
            "installer roots must be exactly {} and {}",
            approved_install.display(),
            approved_data.display()
        )));
    }
    for path in [&request.install_root, &request.program_data_root] {
        if !is_drive_absolute(path)
            || path.to_string_lossy().starts_with("\\\\")
            || path.to_string_lossy().contains(':') && path.to_string_lossy()[2..].contains(':')
        {
            return Err(HostError::InvalidBootstrap(
                "UNC, drive-relative, alternate-stream or non-absolute roots are forbidden".into(),
            ));
        }
    }
    Ok(())
}

fn is_drive_absolute(path: &Path) -> bool {
    let mut components = path.components();
    matches!(components.next(), Some(Component::Prefix(_)))
        && matches!(components.next(), Some(Component::RootDir))
        && !components.any(|part| matches!(part, Component::ParentDir | Component::CurDir))
}

fn windows_path_eq(left: &Path, right: &Path) -> bool {
    left.to_string_lossy().trim_end_matches(&['\\', '/'][..]).eq_ignore_ascii_case(
        right.to_string_lossy().trim_end_matches(&['\\', '/'][..]),
    )
}

fn create_directory_without_reparse(path: &Path, rollback: &mut Rollback) -> Result<()> {
    if path.exists() {
        assert_no_reparse(path)?;
        if !path.is_dir() {
            return Err(HostError::InvalidBootstrap(format!(
                "required directory is not a directory: {}",
                path.display()
            )));
        }
        return Ok(());
    }
    let parent = path.parent().ok_or_else(|| {
        HostError::InvalidBootstrap(format!("directory has no parent: {}", path.display()))
    })?;
    if !parent.exists() {
        create_directory_without_reparse(parent, rollback)?;
    }
    assert_no_reparse(parent)?;
    fs::create_dir(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    rollback.directories.push(path.to_owned());
    assert_no_reparse(path)
}

fn assert_tree_has_no_reparse_points(root: &Path) -> Result<()> {
    assert_no_reparse_components(root)?;
    walk_tree(root, &mut |path, _| assert_no_reparse(path))
}

fn assert_no_reparse_components(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if current.exists() {
            assert_no_reparse(&current)?;
        }
    }
    Ok(())
}

fn assert_no_reparse(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| HostError::io(path.display().to_string(), error))?;
    if metadata.file_type().is_symlink()
        || metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    {
        return Err(HostError::InvalidBootstrap(format!(
            "junction/reparse traversal is forbidden: {}",
            path.display()
        )));
    }
    Ok(())
}

fn walk_tree(root: &Path, visitor: &mut dyn FnMut(&Path, bool) -> Result<()>) -> Result<()> {
    let metadata = fs::symlink_metadata(root)
        .map_err(|error| HostError::io(root.display().to_string(), error))?;
    let is_directory = metadata.is_dir();
    visitor(root, is_directory)?;
    if is_directory {
        for entry in fs::read_dir(root)
            .map_err(|error| HostError::io(root.display().to_string(), error))?
        {
            let entry = entry.map_err(|error| HostError::io(root.display().to_string(), error))?;
            walk_tree(&entry.path(), visitor)?;
        }
    }
    Ok(())
}

fn harden_tree(root: &Path) -> Result<()> {
    assert_no_reparse_components(root)?;
    walk_tree(root, &mut |path, is_directory| {
        assert_no_reparse(path)?;
        apply_restrictive_acl(path, is_directory)
    })
}

pub(crate) fn verify_restrictive_tree(root: &Path) -> Result<()> {
    assert_no_reparse_components(root)?;
    walk_tree(root, &mut |path, is_directory| {
        assert_no_reparse(path)?;
        verify_restrictive_acl(path, is_directory)
    })
}

fn service_sid_string() -> Result<String> {
    let account = wide(&format!("NT SERVICE\\{SERVICE_NAME}"));
    let mut sid_size = 0_u32;
    let mut domain_size = 0_u32;
    let mut sid_use = 0_u32;
    unsafe {
        LookupAccountNameW(
            null(),
            account.as_ptr(),
            null_mut(),
            &mut sid_size,
            null_mut(),
            &mut domain_size,
            &mut sid_use,
        );
    }
    if sid_size == 0 || std::io::Error::last_os_error().raw_os_error() != Some(ERROR_INSUFFICIENT_BUFFER as i32) {
        return Err(HostError::io(
            "lookup RESTOTM restricted service SID size",
            std::io::Error::last_os_error(),
        ));
    }
    let mut sid = vec![0_u8; sid_size as usize];
    let mut domain = vec![0_u16; domain_size as usize];
    if unsafe {
        LookupAccountNameW(
            null(),
            account.as_ptr(),
            sid.as_mut_ptr().cast(),
            &mut sid_size,
            domain.as_mut_ptr(),
            &mut domain_size,
            &mut sid_use,
        )
    } == 0
    {
        return Err(HostError::io(
            "lookup RESTOTM restricted service SID",
            std::io::Error::last_os_error(),
        ));
    }
    let mut string_sid = null_mut();
    if unsafe { ConvertSidToStringSidW(sid.as_ptr().cast(), &mut string_sid) } == 0 {
        return Err(HostError::io(
            "convert RESTOTM service SID",
            std::io::Error::last_os_error(),
        ));
    }
    let result = unsafe { wide_ptr_to_string(string_sid) };
    unsafe { LocalFree(string_sid as _) };
    result
}

/// Agac sira disi kullanicilar icin kapalidir. NS (NetworkService) servisin
/// calistigi hesaptir: PostgreSQL yonetici haklarina sahip bir kimlikle
/// calistirilmayi reddettigi icin servis LocalSystem olamaz. Kisitli servis
/// SID'i (ServiceSidType=3) korunur; yazma denetimi hem hesabi hem servis
/// SID'ini gerektirdiginden ikisi de listede kalmalidir.
fn expected_sddl(is_directory: bool) -> Result<String> {
    let service_sid = service_sid_string()?;
    let flags = if is_directory { "OICI" } else { "" };
    Ok(format!(
        "D:P(A;{flags};FA;;;SY)(A;{flags};FA;;;BA)(A;{flags};FA;;;NS)(A;{flags};FA;;;{service_sid})"
    ))
}

fn apply_restrictive_acl(path: &Path, is_directory: bool) -> Result<()> {
    let expected = expected_sddl(is_directory)?;
    let descriptor = descriptor_from_sddl(&expected)?;
    let path_wide = wide(path.as_os_str());
    let result = unsafe {
        SetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            descriptor,
        )
    };
    unsafe { LocalFree(descriptor as _) };
    if result == 0 {
        return Err(HostError::io(
            format!("apply restrictive DACL to {}", path.display()),
            std::io::Error::last_os_error(),
        ));
    }
    verify_restrictive_acl(path, is_directory)
}

fn verify_restrictive_acl(path: &Path, is_directory: bool) -> Result<()> {
    let expected_descriptor = descriptor_from_sddl(&expected_sddl(is_directory)?)?;
    let expected = descriptor_to_sddl(expected_descriptor)?;
    unsafe { LocalFree(expected_descriptor as _) };

    let path_wide = wide(path.as_os_str());
    let mut required = 0_u32;
    unsafe {
        GetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            null_mut(),
            0,
            &mut required,
        );
    }
    if required == 0 {
        return Err(HostError::io(
            format!("read DACL size for {}", path.display()),
            std::io::Error::last_os_error(),
        ));
    }
    let mut descriptor = vec![0_u8; required as usize];
    if unsafe {
        GetFileSecurityW(
            path_wide.as_ptr(),
            DACL_SECURITY_INFORMATION,
            descriptor.as_mut_ptr().cast(),
            descriptor.len() as u32,
            &mut required,
        )
    } == 0
    {
        return Err(HostError::io(
            format!("read DACL for {}", path.display()),
            std::io::Error::last_os_error(),
        ));
    }
    let actual = descriptor_to_sddl(descriptor.as_ptr().cast())?;
    if actual != expected {
        return Err(HostError::InvalidBootstrap(format!(
            "DACL differs from SYSTEM/Administrators/service-SID policy: {}",
            path.display()
        )));
    }
    Ok(())
}

fn descriptor_from_sddl(sddl: &str) -> Result<*mut c_void> {
    let text = wide(sddl);
    let mut descriptor = null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            null_mut(),
        )
    } == 0
    {
        return Err(HostError::io(
            "convert restrictive SDDL",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(descriptor)
}

fn descriptor_to_sddl(descriptor: *const c_void) -> Result<String> {
    let mut text = null_mut();
    if unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            descriptor,
            SDDL_REVISION_1,
            DACL_SECURITY_INFORMATION,
            &mut text,
            null_mut(),
        )
    } == 0
    {
        return Err(HostError::io(
            "read canonical DACL SDDL",
            std::io::Error::last_os_error(),
        ));
    }
    let result = unsafe { wide_ptr_to_string(text) };
    unsafe { LocalFree(text as _) };
    result
}

unsafe fn wide_ptr_to_string(pointer: *const u16) -> Result<String> {
    if pointer.is_null() {
        return Err(HostError::InvalidBootstrap("Windows returned a null string".into()));
    }
    let mut length = 0;
    while *pointer.add(length) != 0 {
        length += 1;
    }
    OsString::from_wide(std::slice::from_raw_parts(pointer, length))
        .into_string()
        .map_err(|_| HostError::InvalidBootstrap("Windows returned non-Unicode SID/SDDL".into()))
}

fn wide(value: impl AsRef<OsStr>) -> Vec<u16> {
    value.as_ref().encode_wide().chain(Some(0)).collect()
}

fn atomic_write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().ok_or_else(|| {
        HostError::InvalidBootstrap(format!("file has no parent: {}", path.display()))
    })?;
    assert_no_reparse(parent)?;
    let temporary = parent.join(format!(
        ".restotm-bootstrap-{}.tmp",
        URL_SAFE_NO_PAD.encode(random_bytes(24)?)
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
        file.write_all(bytes)
            .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
        file.sync_all()
            .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
        drop(file);
        let temporary_wide = wide(temporary.as_os_str());
        let destination_wide = wide(path.as_os_str());
        if unsafe {
            MoveFileExW(
                temporary_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_WRITE_THROUGH,
            )
        } == 0
        {
            return Err(HostError::io(
                format!("atomic publish {}", path.display()),
                std::io::Error::last_os_error(),
            ));
        }
        OpenOptions::new()
            .write(true)
            .open(path)
            .and_then(|file| file.sync_all())
            .map_err(|error| HostError::io(path.display().to_string(), error))?;
        Ok(())
    })();
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn random_bytes(length: usize) -> Result<Vec<u8>> {
    let mut bytes = vec![0_u8; length];
    let status = unsafe {
        BCryptGenRandom(
            null_mut(),
            bytes.as_mut_ptr(),
            bytes.len() as u32,
            BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        )
    };
    if status < 0 {
        bytes.zeroize();
        return Err(HostError::InvalidBootstrap(format!(
            "BCryptGenRandom failed with NTSTATUS 0x{:08x}",
            status as u32
        )));
    }
    Ok(bytes)
}

fn random_secret(length: usize) -> Result<Zeroizing<String>> {
    let mut bytes = Zeroizing::new(random_bytes(length)?);
    let encoded = URL_SAFE_NO_PAD.encode(bytes.as_slice());
    bytes.zeroize();
    Ok(Zeroizing::new(encoded))
}

fn protect_secret(clear: &str) -> Result<String> {
    let encrypted = crate::platform::dpapi_protect_local_machine(clear.as_bytes())?;
    Ok(format!("dpapi-local-machine-v1:{}", STANDARD.encode(encrypted)))
}

fn create_secret_store(installation_id: &str) -> Result<(Vec<u8>, Zeroizing<String>)> {
    let database_password = random_secret(48)?;
    let database_url = Zeroizing::new(format!(
        "postgresql://restotm_runtime:{}@127.0.0.1:55432/postgres?schema=public",
        database_password.as_str()
    ));
    let mut backup_key = Zeroizing::new(random_bytes(32)?);
    let backup_key_base64 = Zeroizing::new(STANDARD.encode(backup_key.as_slice()));
    backup_key.zeroize();

    let mut values = BTreeMap::new();
    values.insert("databaseUrl".into(), protect_secret(&database_url)?);
    values.insert("internalApiToken".into(), protect_secret(&random_secret(48)?)?);
    values.insert("printAgentSecret".into(), protect_secret(&random_secret(48)?)?);
    values.insert("jwtAccessSecret".into(), protect_secret(&random_secret(64)?)?);
    values.insert("jwtRefreshSecret".into(), protect_secret(&random_secret(64)?)?);
    values.insert("backupEncryptionKey".into(), protect_secret(&backup_key_base64)?);
    values.insert("gatewayControlSecret".into(), protect_secret(&random_secret(48)?)?);
    values.insert("tableQrSigningSecret".into(), protect_secret(&random_secret(48)?)?);
    if values.len() != REQUIRED_SECRET_NAMES.len()
        || REQUIRED_SECRET_NAMES.iter().any(|name| !values.contains_key(*name))
        || installation_id.is_empty()
    {
        return Err(HostError::InvalidBootstrap("canonical secret map is incomplete".into()));
    }
    let document = serde_json::to_vec_pretty(&SecretStoreDocument {
        schema_version: 1,
        protection: "dpapi-local-machine-v1",
        values,
    })
    .map_err(|error| HostError::json("serialize native secret store", error))?;
    Ok((document, database_password))
}

fn initialize_postgres_cluster(
    request: &BootstrapRequest,
    data_directory: &Path,
    config_root: &Path,
    password: &str,
) -> Result<()> {
    let initdb = request.install_root.join("postgres/bin/initdb.exe");
    assert_no_reparse_components(&initdb)?;
    assert_no_reparse(data_directory)?;
    let password_file = config_root.join(format!(
        ".postgres-password-{}.tmp",
        new_installation_id()?.replace('-', "")
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&password_file)
            .map_err(|error| HostError::io(password_file.display().to_string(), error))?;
        file.write_all(password.as_bytes())
            .and_then(|_| file.write_all(b"\r\n"))
            .and_then(|_| file.sync_all())
            .map_err(|error| HostError::io(password_file.display().to_string(), error))?;
        drop(file);
        apply_restrictive_acl(&password_file, false)?;

        let status = Command::new(&initdb)
            .args(["--no-instructions", "--encoding=UTF8", "--locale=C"])
            .arg("--username=restotm_runtime")
            .arg("--auth-host=scram-sha-256")
            .arg("--auth-local=scram-sha-256")
            .arg("--pwfile")
            .arg(&password_file)
            .arg("--pgdata")
            .arg(data_directory)
            .current_dir(request.install_root.join("postgres/bin"))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|error| HostError::io("start initdb", error))?;
        if !status.success() {
            return Err(HostError::InvalidBootstrap(format!(
                "PostgreSQL cluster initialization failed: {status}"
            )));
        }
        Ok(())
    })();
    let _ = fs::remove_file(&password_file);
    result
}

#[allow(clippy::too_many_arguments)]
fn build_config(
    request: &BootstrapRequest,
    installation_id: &str,
    secret_path: &Path,
    receipt_path: &Path,
    log_root: &Path,
    runtime_root: &Path,
    backup_root: &Path,
    backup_replica_root: &Path,
    data_root: &Path,
) -> Result<HostConfig> {
    let install = &request.install_root;
    let mut api_environment = BTreeMap::from([
        ("NODE_ENV".into(), "production".into()),
        ("APP_VERSION".into(), request.product_version.clone()),
        ("RUNTIME_MODE".into(), "local".into()),
        ("BIND_HOST".into(), "127.0.0.1".into()),
        ("PORT".into(), request.api_port.to_string()),
        ("LOCAL_LICENSE_SERVER_URL".into(), request.license_server_url.trim_end_matches('/').into()),
        ("LOCAL_POSTGRES_DATA_DIR".into(), data_root.join("postgres").display().to_string()),
        ("LOCAL_BACKUP_DIR".into(), backup_root.display().to_string()),
        ("LOCAL_BACKUP_EXTERNAL_DIR".into(), backup_replica_root.display().to_string()),
        ("LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY".into(), "warn".into()),
        ("LOCAL_BACKUP_KEY_ID".into(), format!("restotm-{installation_id}")),
        ("LOCAL_LICENSE_DATA_DIR".into(), data_root.join("license").display().to_string()),
        ("LOCAL_LAN_HOSTNAME".into(), format!("restotm-{}.local", installation_id.replace('-', "").chars().take(8).collect::<String>())),
        ("LOCAL_UPDATE_MANIFEST_URL".into(), format!("{}/api/updates/v1/manifest", request.license_server_url.trim_end_matches('/'))),
        ("LOCAL_UPDATE_DATA_DIR".into(), data_root.join("update").display().to_string()),
        ("LOCAL_UPDATE_CHANNEL".into(), "stable".into()),
        ("LOCAL_UPDATE_DATABASE_SCHEMA_VERSION".into(), "1".into()),
        ("LOCAL_UPDATE_ALLOWED_ORIGINS".into(), request.license_server_url.trim_end_matches('/').into()),
        ("PG_DUMP_PATH".into(), install.join("postgres/bin/pg_dump.exe").display().to_string()),
        ("PG_RESTORE_PATH".into(), install.join("postgres/bin/pg_restore.exe").display().to_string()),
        ("BACKUP_RETENTION_DAILY".into(), "30".into()),
        ("BACKUP_RETENTION_WEEKLY".into(), "12".into()),
        ("BACKUP_RETENTION_MONTHLY".into(), "12".into()),
        ("BACKUP_EXTERNAL_RETENTION_DAILY".into(), "90".into()),
        ("BACKUP_EXTERNAL_RETENTION_WEEKLY".into(), "26".into()),
        ("BACKUP_EXTERNAL_RETENTION_MONTHLY".into(), "24".into()),
    ]);
    // Keep insertion-independent serialization while making the complete contract explicit.
    api_environment.insert("BACKUP_RESTORE_VERIFICATION_INTERVAL_MS".into(), "604800000".into());
    api_environment.insert("BACKUP_RESTORE_VERIFICATION_RETRY_MS".into(), "21600000".into());

    let empty = BTreeMap::new();
    let config = HostConfig {
        schema_version: CONFIG_SCHEMA_VERSION,
        installation_id: installation_id.into(),
        install_root: install.clone(),
        program_data_root: request.program_data_root.clone(),
        secret_store: secret_path.into(),
        bootstrap_receipt: receipt_path.into(),
        health_file: runtime_root.join("health.json"),
        log_directory: log_root.into(),
        network: NetworkContract {
            postgres: Endpoint { host: "127.0.0.1".into(), port: request.postgres_port },
            api: Endpoint { host: "127.0.0.1".into(), port: request.api_port },
            admin: Endpoint { host: "127.0.0.1".into(), port: request.admin_port },
            waiter: Endpoint { host: "127.0.0.1".into(), port: request.waiter_port },
            menu: Endpoint { host: "127.0.0.1".into(), port: request.menu_port },
            print_agent: Endpoint { host: "127.0.0.1".into(), port: request.print_port },
            gateway: GatewayEndpoint {
                host: "0.0.0.0".into(),
                port: request.gateway_port,
                firewall_profile: "Private".into(),
                remote_scope: "LocalSubnet".into(),
            },
        },
        restart_policy: RestartPolicy {
            initial_delay_ms: 1_000,
            maximum_delay_ms: 60_000,
            stable_reset_ms: 120_000,
            crash_window_ms: 600_000,
            maximum_crashes_in_window: 5,
            crash_loop_quarantine_ms: 300_000,
        },
        children: vec![
            ChildSpec {
                name: "postgres".into(),
                executable: install.join("postgres/bin/postgres.exe"),
                working_directory: install.join("postgres/bin"),
                arguments: vec!["-D".into(), data_root.join("postgres").display().to_string(), "-p".into(), request.postgres_port.to_string(), "-h".into(), "127.0.0.1".into()],
                environment: empty.clone(), file_environment: BTreeMap::new(), secret_environment: empty.clone(), depends_on: vec![], essential: true,
                shutdown: ShutdownSpec::Postgres {
                    pg_ctl_path: install.join("postgres/bin/pg_ctl.exe"),
                    data_directory: data_root.join("postgres"),
                    grace_ms: 30_000,
                },
            },
            ChildSpec {
                name: "local-api".into(), executable: install.join("api/restotm-api.exe"), working_directory: install.join("api"), arguments: vec![],
                environment: api_environment,
                file_environment: BTreeMap::from([
                    ("LOCAL_LICENSE_PUBLIC_KEY".into(), install.join("config/license-public-key.pem")),
                    ("LOCAL_UPDATE_PUBLIC_KEY".into(), install.join("config/update-public-key.pem")),
                ]),
                secret_environment: BTreeMap::from([
                    ("DATABASE_URL".into(), "databaseUrl".into()), ("JWT_ACCESS_SECRET".into(), "jwtAccessSecret".into()),
                    ("JWT_REFRESH_SECRET".into(), "jwtRefreshSecret".into()), ("PRINT_AGENT_SECRET".into(), "printAgentSecret".into()),
                    ("INTERNAL_RUNTIME_TOKEN".into(), "internalApiToken".into()),
                    ("LOCAL_BACKUP_KEY_BASE64".into(), "backupEncryptionKey".into()),
                    ("TABLE_QR_SIGNING_SECRET".into(), "tableQrSigningSecret".into()),
                ]),
                depends_on: vec!["postgres".into()], essential: true,
                shutdown: ShutdownSpec::Http { port: request.api_port, path: "/internal/runtime/shutdown".into(), token_secret: "internalApiToken".into(), grace_ms: 30_000 },
            },
            ui_child("admin-ui", install.join("admin/restotm-admin.exe"), install.join("admin"), request.admin_port),
            ui_child("waiter-ui", install.join("waiter/restotm-waiter.exe"), install.join("waiter"), request.waiter_port),
            ChildSpec {
                name: "menu-ui".into(), executable: install.join("menu/restotm-menu.exe"), working_directory: install.join("menu"), arguments: vec![],
                environment: BTreeMap::from([
                    ("NODE_ENV".into(), "production".into()), ("HOSTNAME".into(), "127.0.0.1".into()),
                    ("PORT".into(), request.menu_port.to_string()),
                    ("CLOUD_MENU_API_URL".into(), format!("{}/api", request.license_server_url.trim_end_matches('/'))),
                ]), file_environment: BTreeMap::new(), secret_environment: BTreeMap::new(),
                depends_on: vec!["local-api".into()], essential: true, shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
            },
            ChildSpec {
                name: "print-agent".into(), executable: install.join("print-agent/restotm-print-agent.exe"), working_directory: install.join("print-agent"), arguments: vec![],
                environment: BTreeMap::from([
                    ("NODE_ENV".into(), "production".into()),
                    ("PRINT_AGENT_WS_URL".into(), format!("http://127.0.0.1:{}", request.api_port)),
                    ("PRINT_AGENT_DATA_DIR".into(), data_root.join("print-agent").display().to_string()),
                ]), file_environment: BTreeMap::new(), secret_environment: BTreeMap::from([("PRINT_AGENT_SECRET".into(), "printAgentSecret".into())]),
                depends_on: vec!["local-api".into()], essential: false, shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
            },
            ChildSpec {
                name: "lan-gateway".into(), executable: install.join("gateway/restotm-lan-gateway.exe"), working_directory: install.join("gateway"), arguments: vec![],
                environment: BTreeMap::from([
                    ("NODE_ENV".into(), "production".into()),
                    ("GATEWAY_BIND_HOST".into(), "0.0.0.0".into()),
                    ("GATEWAY_PORT".into(), request.gateway_port.to_string()),
                    ("GATEWAY_ALLOWED_HOSTS".into(), format!("restotm-{}.local", installation_id.replace('-', "").chars().take(8).collect::<String>())),
                    ("GATEWAY_API_TARGET".into(), format!("http://127.0.0.1:{}", request.api_port)),
                    ("GATEWAY_ADMIN_TARGET".into(), format!("http://127.0.0.1:{}", request.admin_port)),
                    ("GATEWAY_WAITER_TARGET".into(), format!("http://127.0.0.1:{}", request.waiter_port)),
                    ("GATEWAY_MENU_TARGET".into(), format!("http://127.0.0.1:{}", request.menu_port)),
                ]), file_environment: BTreeMap::new(), secret_environment: BTreeMap::from([("GATEWAY_CONTROL_SECRET".into(), "gatewayControlSecret".into())]),
                depends_on: vec!["local-api".into(), "admin-ui".into(), "waiter-ui".into(), "menu-ui".into()], essential: true, shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
            },
        ],
    };
    config.validate()?;
    Ok(config)
}

fn ui_child(name: &str, executable: PathBuf, working_directory: PathBuf, port: u16) -> ChildSpec {
    ChildSpec {
        name: name.into(), executable, working_directory, arguments: vec![],
        environment: BTreeMap::from([("NODE_ENV".into(), "production".into()), ("HOSTNAME".into(), "127.0.0.1".into()), ("PORT".into(), port.to_string())]),
        file_environment: BTreeMap::new(), secret_environment: BTreeMap::new(), depends_on: vec!["local-api".into()], essential: true,
        shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
    }
}

fn new_installation_id() -> Result<String> {
    let mut bytes = Zeroizing::new(random_bytes(16)?);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Ok(format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    ))
}

fn verify_existing(request: &BootstrapRequest, config_path: &Path) -> Result<()> {
    let verified = load_verified_bootstrap(config_path)?;
    let config = verified.config;
    if !windows_path_eq(&config.install_root, &request.install_root)
        || !windows_path_eq(&config.program_data_root, &request.program_data_root)
        || config.network.postgres.port != request.postgres_port
        || config.network.api.port != request.api_port
        || config.network.admin.port != request.admin_port
        || config.network.waiter.port != request.waiter_port
        || config.network.menu.port != request.menu_port
        || config.network.print_agent.port != request.print_port
        || config.network.gateway.port != request.gateway_port
    {
        return Err(HostError::InvalidBootstrap(
            "existing bootstrap does not match this signed installer request".into(),
        ));
    }
    let api = config.children.iter().find(|child| child.name == "local-api")
        .ok_or_else(|| HostError::InvalidBootstrap("existing local-api child is missing".into()))?;
    if api.environment.get("LOCAL_LICENSE_SERVER_URL").map(String::as_str)
        != Some(request.license_server_url.trim_end_matches('/'))
    {
        return Err(HostError::InvalidBootstrap(
            "license control-plane change requires an explicit signed migration".into(),
        ));
    }
    Ok(())
}
