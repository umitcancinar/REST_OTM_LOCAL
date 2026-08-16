//! Signed, shell-free launcher shared by the six Node.js child roles.
//!
//! The same PE is copied under a role-specific canonical file name. It accepts
//! no arguments, never invokes cmd/PowerShell and only starts the bundled
//! node.exe plus a fixed script path below the signed Program Files payload.

use std::env;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, PartialEq)]
struct RoleSpec {
    script: &'static str,
    migrate_before_start: bool,
}

fn role_spec(file_name: &str) -> Option<RoleSpec> {
    match file_name.to_ascii_lowercase().as_str() {
        "restotm-api.exe" => Some(RoleSpec { script: "api/runtime/local.js", migrate_before_start: true }),
        "restotm-admin.exe" => Some(RoleSpec { script: "admin/runtime/apps/admin/server.js", migrate_before_start: false }),
        "restotm-waiter.exe" => Some(RoleSpec { script: "waiter/runtime/apps/waiter/server.js", migrate_before_start: false }),
        "restotm-menu.exe" => Some(RoleSpec { script: "menu/runtime/apps/menu/server.js", migrate_before_start: false }),
        "restotm-print-agent.exe" => Some(RoleSpec { script: "print-agent/dist/agent.js", migrate_before_start: false }),
        "restotm-lan-gateway.exe" => Some(RoleSpec { script: "gateway/dist/app.js", migrate_before_start: false }),
        _ => None,
    }
}

/// `Path::canonicalize` Windows'ta `\\?\` onekli "verbatim" yol dondurur.
/// Node bu bicimi ana modul yolu olarak kabul etmez: yolu ayristirirken koku
/// "C:" sanip `EISDIR: illegal operation on a directory, lstat 'C:'` ile duser.
/// Kurulum kokunun disina cikilmadigi denetimleri canonical yollar uzerinde
/// yapmaya devam ediyoruz; oneki yalniz Node'a verilen degerden kaldiriyoruz.
fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.as_os_str().to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => match rest.strip_prefix("UNC\\") {
            Some(share) => PathBuf::from(format!(r"\\{share}")),
            None => PathBuf::from(rest),
        },
        None => path.to_path_buf(),
    }
}

fn canonical_file(path: &Path, label: &str) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|_| format!("{label} eksik veya dolayli yol: {}", path.display()))?;
    if !canonical.is_file() {
        return Err(format!("{label} dosya degil: {}", canonical.display()));
    }
    Ok(canonical)
}

fn run() -> Result<i32, String> {
    if env::args_os().len() != 1 {
        return Err("child launcher arguman kabul etmez".into());
    }
    let executable = canonical_file(
        &env::current_exe().map_err(|_| "launcher yolu okunamadi".to_string())?,
        "launcher",
    )?;
    let file_name = executable
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "launcher dosya adi UTF-8 degil".to_string())?;
    let role = role_spec(file_name)
        .ok_or_else(|| format!("bilinmeyen launcher rolu: {file_name}"))?;
    let component_dir = executable.parent().ok_or_else(|| "launcher parent eksik".to_string())?;
    let install_root = component_dir.parent().ok_or_else(|| "install root eksik".to_string())?;
    let install_root = install_root
        .canonicalize()
        .map_err(|_| "install root dogrulanamadi".to_string())?;
    let node = canonical_file(&install_root.join("runtime/node.exe"), "node runtime")?;
    let script = canonical_file(&install_root.join(role.script), "role script")?;
    if (!node.starts_with(&install_root)) || (!script.starts_with(&install_root)) {
        return Err("runtime dosyasi imzali kurulum kokunun disina cikiyor".into());
    }

    if role.migrate_before_start {
        let prisma = canonical_file(
            &install_root.join("api/runtime/node_modules/prisma/build/index.js"),
            "Prisma migration CLI",
        )?;
        let schema = canonical_file(
            &install_root.join("api/runtime/prisma/schema.prisma"),
            "Prisma schema",
        )?;
        if (!prisma.starts_with(&install_root)) || (!schema.starts_with(&install_root)) {
            return Err("migration dosyasi imzali kurulum kokunun disina cikiyor".into());
        }
        let mut migration = Command::new(without_verbatim_prefix(&node));
        migration
            .arg(without_verbatim_prefix(&prisma))
            .args(["migrate", "deploy", "--schema"])
            .arg(without_verbatim_prefix(&schema))
            .current_dir(without_verbatim_prefix(&install_root))
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        #[cfg(windows)]
        migration.creation_flags(CREATE_NO_WINDOW);
        let status = migration.status()
            .map_err(|error| format!("Veritabani migration baslatilamadi: {error}"))?;
        if !status.success() {
            return Err(format!("Veritabani migration basarisiz: {status}"));
        }
    }

    let mut command = Command::new(without_verbatim_prefix(&node));
    command
        .arg(without_verbatim_prefix(&script))
        .current_dir(without_verbatim_prefix(component_dir))
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    let status = command.status().map_err(|error| format!("Node child baslatilamadi: {error}"))?;
    Ok(status.code().unwrap_or(1))
}

fn main() -> ExitCode {
    match run() {
        Ok(code) if (0..=255).contains(&code) => ExitCode::from(code as u8),
        Ok(_) => ExitCode::FAILURE,
        Err(error) => {
            eprintln!("RESTOTM launcher baslatma reddi: {error}");
            ExitCode::from(78)
        }
    }
}

#[cfg(test)]
mod tests {
  use super::{role_spec, RoleSpec};

    #[test]
    fn only_canonical_roles_are_mapped() {
        assert_eq!(role_spec("restotm-api.exe"), Some(RoleSpec {
            script: "api/runtime/local.js", migrate_before_start: true,
        }));
        assert_eq!(role_spec("RESTOTM-MENU.EXE"), Some(RoleSpec {
            script: "menu/runtime/apps/menu/server.js", migrate_before_start: false,
        }));
        assert_eq!(role_spec("cmd.exe"), None);
    }
}
