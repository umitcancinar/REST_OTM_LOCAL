use crate::error::{HostError, Result};
use std::path::Path;
use std::process::{Child, Command, ExitStatus};

/// Windows'ta cocuk surec iki sekilde baslatilabilir: normal `Command::spawn`
/// ile ya da yonetici grubu dusurulmus kisitli bir token ile. Ikincisi
/// PostgreSQL icin zorunludur; sunucu, yonetici haklarina sahip bir kimlikle
/// calistirilmayi reddeder. Kisitli yolda `std::process::Child` uretilemedigi
/// icin ham surec tanitici tutulur.
#[cfg(windows)]
enum WindowsProcess {
    Standard(Child),
    Restricted {
        handle: windows_sys::Win32::Foundation::HANDLE,
        pid: u32,
    },
}

pub struct ManagedChild {
    #[cfg(windows)]
    process: WindowsProcess,
    #[cfg(not(windows))]
    child: Child,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

// SAFETY: `job` is an opaque Windows kernel object handle (an integer-like
// identifier), not a pointer into process memory. Handles are valid to use
// and close from any thread, so it is safe to move `ManagedChild` across
// threads even though `HANDLE` is FFI-typed as a raw pointer.
#[cfg(windows)]
unsafe impl Send for ManagedChild {}

/// Replaces a durable state file without first creating a window where the
/// destination does not exist. Windows' standard `rename` does not replace an
/// existing file, so use the native write-through primitive there.
pub fn atomic_replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination_wide: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(HostError::io(
                destination.display().to_string(),
                std::io::Error::last_os_error(),
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(source, destination)
            .map_err(|error| HostError::io(destination.display().to_string(), error))
    }
}

impl ManagedChild {
    /// `drop_administrator_rights` yalniz PostgreSQL icin true verilir.
    pub fn spawn(command: &mut Command, drop_administrator_rights: bool) -> Result<Self> {
        #[cfg(windows)]
        {
            // Kisitlama yalniz gercekten gerekiyorsa yapilir: sorun PostgreSQL'in
            // yonetici haklariyla calismayi reddetmesidir. Servis zaten yonetici
            // olmayan bir hesapla calisiyorsa token'a dokunmaya gerek yoktur ve
            // dokunmamak gerekir; kisitli servis SID'i olan bir token zaten
            // yeniden kisitlanamaz.
            if drop_administrator_rights && current_process_is_administrator() {
                spawn_windows_restricted(command)
            } else {
                spawn_windows(command)
            }
        }
        #[cfg(not(windows))]
        {
            let _ = drop_administrator_rights;
            command
                .spawn()
                .map(|child| Self { child })
                .map_err(|error| HostError::io("spawn child process", error))
        }
    }

    pub fn id(&self) -> u32 {
        #[cfg(windows)]
        {
            match &self.process {
                WindowsProcess::Standard(child) => child.id(),
                WindowsProcess::Restricted { pid, .. } => *pid,
            }
        }
        #[cfg(not(windows))]
        {
            self.child.id()
        }
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>> {
        #[cfg(windows)]
        {
            match &mut self.process {
                WindowsProcess::Standard(child) => child
                    .try_wait()
                    .map_err(|error| HostError::io("poll child process", error)),
                WindowsProcess::Restricted { handle, .. } => raw_try_wait(*handle),
            }
        }
        #[cfg(not(windows))]
        {
            self.child
                .try_wait()
                .map_err(|error| HostError::io("poll child process", error))
        }
    }

    pub fn terminate_tree(&mut self) -> Result<()> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;
            if TerminateJobObject(self.job, 1) == 0 {
                return Err(HostError::io(
                    "terminate Windows job object",
                    std::io::Error::last_os_error(),
                ));
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            self.child
                .kill()
                .map_err(|error| HostError::io("terminate child process", error))
        }
    }

    pub fn wait(&mut self) -> Result<ExitStatus> {
        #[cfg(windows)]
        {
            match &mut self.process {
                WindowsProcess::Standard(child) => child
                    .wait()
                    .map_err(|error| HostError::io("wait for child process", error)),
                WindowsProcess::Restricted { handle, .. } => raw_wait(*handle),
            }
        }
        #[cfg(not(windows))]
        {
            self.child
                .wait()
                .map_err(|error| HostError::io("wait for child process", error))
        }
    }
}

#[cfg(windows)]
fn raw_try_wait(
    handle: windows_sys::Win32::Foundation::HANDLE,
) -> Result<Option<ExitStatus>> {
    use windows_sys::Win32::Foundation::WAIT_TIMEOUT;
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};

    unsafe {
        if WaitForSingleObject(handle, 0) == WAIT_TIMEOUT {
            return Ok(None);
        }
        let mut code = 0_u32;
        if GetExitCodeProcess(handle, &mut code) == 0 {
            return Err(HostError::io(
                "read child process exit code",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(Some(exit_status_from_code(code)))
    }
}

#[cfg(windows)]
fn raw_wait(handle: windows_sys::Win32::Foundation::HANDLE) -> Result<ExitStatus> {
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, WaitForSingleObject, INFINITE,
    };

    unsafe {
        WaitForSingleObject(handle, INFINITE);
        let mut code = 0_u32;
        if GetExitCodeProcess(handle, &mut code) == 0 {
            return Err(HostError::io(
                "read child process exit code",
                std::io::Error::last_os_error(),
            ));
        }
        Ok(exit_status_from_code(code))
    }
}

#[cfg(windows)]
fn exit_status_from_code(code: u32) -> ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    ExitStatus::from_raw(code)
}

#[cfg(windows)]
impl Drop for ManagedChild {
    fn drop(&mut self) {
        unsafe {
            if let WindowsProcess::Restricted { handle, .. } = self.process {
                windows_sys::Win32::Foundation::CloseHandle(handle);
            }
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(windows)]
fn spawn_windows(command: &mut Command) -> Result<ManagedChild> {
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::ptr::null;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};

    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(HostError::io(
                "create Windows job object",
                std::io::Error::last_os_error(),
            ));
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io("configure Windows job object", error));
        }

        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                CloseHandle(job);
                return Err(HostError::io("spawn Windows child process", error));
            }
        };
        if AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
            let error = std::io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            CloseHandle(job);
            return Err(HostError::io("assign child to Windows job object", error));
        }
        Ok(ManagedChild {
            process: WindowsProcess::Standard(child),
            job,
        })
    }
}

/// PostgreSQL, yonetici haklarina sahip bir kimlikle calistirilmayi guvenlik
/// geregi reddeder ("execution of PostgreSQL by a user with administrative
/// permissions is not permitted"). Servis LocalSystem olarak calistigi icin
/// sunucuyu dogrudan baslatamayiz. PostgreSQL'in kendi araclari (initdb,
/// pg_ctl) ayni durumda kendilerini yonetici grubu devre disi birakilmis bir
/// token ile yeniden baslatir; burada ayni yaklasimi uyguluyoruz. Token'in
/// kullanici SID'i (LocalSystem) korundugu icin ProgramData ve Program Files
/// uzerindeki kisitli ACL'ler calismaya devam eder.
#[cfg(windows)]
fn spawn_windows_restricted(command: &mut Command) -> Result<ManagedChild> {
    use std::mem::{size_of, zeroed};
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE};
    use windows_sys::Win32::Security::{
        AllocateAndInitializeSid, CreateRestrictedToken, FreeSid, DISABLE_MAX_PRIVILEGE,
        SID_AND_ATTRIBUTES, SID_IDENTIFIER_AUTHORITY, TOKEN_ADJUST_DEFAULT,
        TOKEN_ASSIGN_PRIMARY, TOKEN_DUPLICATE, TOKEN_QUERY,
    };
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{
        CreateProcessAsUserW, GetCurrentProcess, OpenProcessToken, ResumeThread,
        TerminateProcess, CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW, CREATE_SUSPENDED,
        CREATE_UNICODE_ENVIRONMENT, PROCESS_INFORMATION, STARTUPINFOW,
    };

    const SECURITY_BUILTIN_DOMAIN_RID: u32 = 0x20;
    const DOMAIN_ALIAS_RID_ADMINS: u32 = 0x220;

    let mut command_line = build_command_line(command);
    let mut environment = build_environment_block(command);
    let working_directory = command.get_current_dir().map(|directory| {
        use std::os::windows::ffi::OsStrExt;
        directory
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect::<Vec<u16>>()
    });

    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(HostError::io(
                "create Windows job object",
                std::io::Error::last_os_error(),
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io("configure Windows job object", error));
        }

        let mut process_token: HANDLE = null_mut();
        if OpenProcessToken(
            GetCurrentProcess(),
            TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT,
            &mut process_token,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io("open service process token", error));
        }

        let authority = SID_IDENTIFIER_AUTHORITY { Value: [0, 0, 0, 0, 0, 5] };
        let mut administrators = null_mut();
        if AllocateAndInitializeSid(
            &authority,
            2,
            SECURITY_BUILTIN_DOMAIN_RID,
            DOMAIN_ALIAS_RID_ADMINS,
            0,
            0,
            0,
            0,
            0,
            0,
            &mut administrators,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(process_token);
            CloseHandle(job);
            return Err(HostError::io("build Administrators SID", error));
        }

        let mut disable = [SID_AND_ATTRIBUTES { Sid: administrators, Attributes: 0 }];
        let mut restricted_token: HANDLE = null_mut();
        let created = CreateRestrictedToken(
            process_token,
            DISABLE_MAX_PRIVILEGE,
            disable.len() as u32,
            disable.as_mut_ptr(),
            0,
            null_mut(),
            0,
            null_mut(),
            &mut restricted_token,
        );
        FreeSid(administrators);
        CloseHandle(process_token);
        if created == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io("create restricted token", error));
        }

        let mut startup: STARTUPINFOW = zeroed();
        startup.cb = size_of::<STARTUPINFOW>() as u32;
        let mut information: PROCESS_INFORMATION = zeroed();

        // Surec askida baslatilir; is nesnesine baglandiktan sonra devam ettirilir.
        // Boylece cocuk, denetim altina alinmadan once is yapamaz veya cikamaz.
        let spawned = CreateProcessAsUserW(
            restricted_token,
            null(),
            command_line.as_mut_ptr(),
            null(),
            null(),
            FALSE,
            CREATE_NEW_PROCESS_GROUP
                | CREATE_NO_WINDOW
                | CREATE_SUSPENDED
                | CREATE_UNICODE_ENVIRONMENT,
            environment.as_mut_ptr() as *const core::ffi::c_void,
            working_directory
                .as_ref()
                .map_or(null(), |directory| directory.as_ptr()),
            &startup,
            &mut information,
        );
        CloseHandle(restricted_token);
        if spawned == 0 {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io(
                "spawn restricted Windows child process",
                error,
            ));
        }

        if AssignProcessToJobObject(job, information.hProcess) == 0 {
            let error = std::io::Error::last_os_error();
            TerminateProcess(information.hProcess, 1);
            CloseHandle(information.hThread);
            CloseHandle(information.hProcess);
            CloseHandle(job);
            return Err(HostError::io("assign child to Windows job object", error));
        }

        if ResumeThread(information.hThread) == u32::MAX {
            let error = std::io::Error::last_os_error();
            TerminateProcess(information.hProcess, 1);
            CloseHandle(information.hThread);
            CloseHandle(information.hProcess);
            CloseHandle(job);
            return Err(HostError::io("resume restricted child process", error));
        }
        CloseHandle(information.hThread);

        Ok(ManagedChild {
            process: WindowsProcess::Restricted {
                handle: information.hProcess,
                pid: information.dwProcessId,
            },
            job,
        })
    }
}

/// PostgreSQL'in reddettigi durum tam olarak budur: etkin token'in yerel
/// Administrators grubunda olmasi.
#[cfg(windows)]
fn current_process_is_administrator() -> bool {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::FALSE;
    use windows_sys::Win32::Security::{
        AllocateAndInitializeSid, CheckTokenMembership, FreeSid, SID_IDENTIFIER_AUTHORITY,
    };

    const SECURITY_BUILTIN_DOMAIN_RID: u32 = 0x20;
    const DOMAIN_ALIAS_RID_ADMINS: u32 = 0x220;

    unsafe {
        let authority = SID_IDENTIFIER_AUTHORITY { Value: [0, 0, 0, 0, 0, 5] };
        let mut administrators = null_mut();
        if AllocateAndInitializeSid(
            &authority,
            2,
            SECURITY_BUILTIN_DOMAIN_RID,
            DOMAIN_ALIAS_RID_ADMINS,
            0,
            0,
            0,
            0,
            0,
            0,
            &mut administrators,
        ) == 0
        {
            // SID kurulamadiysa guvenli tarafta kalip kisitlamayi deneriz.
            return true;
        }
        let mut is_member = FALSE;
        let checked = CheckTokenMembership(null_mut(), administrators, &mut is_member);
        FreeSid(administrators);
        checked == 0 || is_member != FALSE
    }
}

/// `CreateProcessAsUserW` hazir bir komut satiri bekler. Windows'un standart
/// argüman ayristirma kurallarina gore tirnaklama yapiyoruz.
#[cfg(windows)]
fn build_command_line(command: &Command) -> Vec<u16> {
    let mut line: Vec<u16> = Vec::new();
    append_quoted_argument(command.get_program(), &mut line);
    for argument in command.get_args() {
        line.push(u16::from(b' '));
        append_quoted_argument(argument, &mut line);
    }
    line.push(0);
    line
}

#[cfg(windows)]
fn append_quoted_argument(argument: &std::ffi::OsStr, output: &mut Vec<u16>) {
    use std::os::windows::ffi::OsStrExt;

    let encoded: Vec<u16> = argument.encode_wide().collect();
    let needs_quotes = encoded.is_empty()
        || encoded
            .iter()
            .any(|unit| *unit == u16::from(b' ') || *unit == u16::from(b'\t') || *unit == u16::from(b'"'));
    if !needs_quotes {
        output.extend_from_slice(&encoded);
        return;
    }

    output.push(u16::from(b'"'));
    let mut backslashes = 0_usize;
    for unit in encoded {
        if unit == u16::from(b'\\') {
            backslashes += 1;
            continue;
        }
        if unit == u16::from(b'"') {
            // Tirnaktan onceki n ters bolu 2n'e cikarilir, ardindan tirnagi
            // kaciran bir ters bolu daha eklenir.
            for _ in 0..(backslashes * 2 + 1) {
                output.push(u16::from(b'\\'));
            }
            backslashes = 0;
        } else {
            for _ in 0..backslashes {
                output.push(u16::from(b'\\'));
            }
            backslashes = 0;
        }
        output.push(unit);
    }
    for _ in 0..backslashes * 2 {
        output.push(u16::from(b'\\'));
    }
    output.push(u16::from(b'"'));
}

/// Ortam blogu yalniz `Command` uzerinde acikca ayarlanmis degiskenlerden
/// kurulur. Cagiran taraf `env_clear()` ile ortami sifirlar ve cocugun gormesi
/// gereken her degiskeni tek tek verir; surecin kendi ortamini miras almak bu
/// kasitli yalitimi bozardi. Windows blogun buyuk/kucuk harf duyarsiz sirali
/// olmasini bekler.
#[cfg(windows)]
fn build_environment_block(command: &Command) -> Vec<u16> {
    use std::collections::BTreeMap;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStrExt;

    let mut variables: BTreeMap<String, (OsString, OsString)> = BTreeMap::new();
    for (key, value) in command.get_envs() {
        let sort_key = key.to_string_lossy().to_uppercase();
        match value {
            Some(value) => {
                variables.insert(sort_key, (key.to_os_string(), value.to_os_string()));
            }
            None => {
                variables.remove(&sort_key);
            }
        }
    }

    let mut block: Vec<u16> = Vec::new();
    for (_, (key, value)) in variables {
        block.extend(key.encode_wide());
        block.push(u16::from(b'='));
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

#[cfg(windows)]
pub fn dpapi_unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::{copy_nonoverlapping, null_mut, write_bytes};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if encrypted.is_empty() || encrypted.len() > u32::MAX as usize {
        return Err(HostError::InvalidSecretStore(
            "DPAPI payload length is invalid".into(),
        ));
    }
    let entropy_bytes = b"RESTOTM/runtime-secrets/v1";
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    unsafe {
        if CryptUnprotectData(
            &mut input,
            null_mut(),
            &mut entropy,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err(HostError::io(
                "DPAPI CryptUnprotectData",
                std::io::Error::last_os_error(),
            ));
        }
        if output.pbData.is_null() || output.cbData == 0 {
            if !output.pbData.is_null() {
                LocalFree(output.pbData as _);
            }
            return Err(HostError::InvalidSecretStore(
                "DPAPI returned an empty secret".into(),
            ));
        }
        let mut clear = vec![0_u8; output.cbData as usize];
        copy_nonoverlapping(output.pbData, clear.as_mut_ptr(), clear.len());
        write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as _);
        Ok(clear)
    }
}

#[cfg(windows)]
pub fn dpapi_protect_local_machine(clear: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::{copy_nonoverlapping, null_mut, write_bytes};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
        CRYPT_INTEGER_BLOB,
    };

    if clear.is_empty() || clear.len() > u32::MAX as usize {
        return Err(HostError::InvalidBootstrap(
            "DPAPI cleartext length is invalid".into(),
        ));
    }
    let entropy_bytes = b"RESTOTM/runtime-secrets/v1";
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: clear.len() as u32,
        pbData: clear.as_ptr() as *mut u8,
    };
    let mut entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    unsafe {
        if CryptProtectData(
            &mut input,
            null_mut(),
            &mut entropy,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN | CRYPTPROTECT_LOCAL_MACHINE,
            &mut output,
        ) == 0
        {
            return Err(HostError::io(
                "DPAPI CryptProtectData(LocalMachine)",
                std::io::Error::last_os_error(),
            ));
        }
        if output.pbData.is_null() || output.cbData == 0 {
            if !output.pbData.is_null() {
                LocalFree(output.pbData as _);
            }
            return Err(HostError::InvalidBootstrap(
                "DPAPI returned an empty envelope".into(),
            ));
        }
        let mut encrypted = vec![0_u8; output.cbData as usize];
        copy_nonoverlapping(output.pbData, encrypted.as_mut_ptr(), encrypted.len());
        write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as _);
        Ok(encrypted)
    }
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(_encrypted: &[u8]) -> Result<Vec<u8>> {
    Err(HostError::UnsupportedPlatform(
        "DPAPI is available only on Windows".into(),
    ))
}
