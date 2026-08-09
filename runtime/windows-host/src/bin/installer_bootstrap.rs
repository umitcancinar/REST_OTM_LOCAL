use restotm_windows_host::bootstrap::{run_bootstrap, verify_production_contract};
#[cfg(not(windows))]
use restotm_windows_host::bootstrap::UnavailableBootstrapBackend;
#[cfg(windows)]
use restotm_windows_host::native_provisioning::NativeWindowsBootstrapBackend;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;

fn main() -> ExitCode {
    match execute(std::env::args_os().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("RESTOTM bootstrap refused provisioning: {error}");
            ExitCode::from(78)
        }
    }
}

fn execute(arguments: Vec<OsString>) -> restotm_windows_host::error::Result<()> {
    if arguments.first().and_then(|value| value.to_str()) == Some("verify-production-contract") {
        if arguments.len() != 3 || arguments[1] != "--contract" {
            return Err(restotm_windows_host::error::HostError::InvalidBootstrap(
                "verification requires exactly --contract <absolute-path>".into(),
            ));
        }
        let contract = PathBuf::from(&arguments[2]);
        if !contract.is_absolute() {
            return Err(restotm_windows_host::error::HostError::InvalidBootstrap(
                "verification contract path must be absolute".into(),
            ));
        }
        verify_production_contract(&contract)?;
        #[cfg(not(windows))]
        return Err(restotm_windows_host::error::HostError::UnsupportedPlatform(
            "production capability is available only in a Windows build".into(),
        ));
        #[cfg(windows)]
        return Ok(());
    }

    #[cfg(windows)]
    return run_bootstrap(arguments, &NativeWindowsBootstrapBackend);
    #[cfg(not(windows))]
    run_bootstrap(arguments, &UnavailableBootstrapBackend)
}
