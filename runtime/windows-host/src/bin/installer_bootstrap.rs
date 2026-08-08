use restotm_windows_host::bootstrap::{run_bootstrap, UnavailableBootstrapBackend};
use std::process::ExitCode;

fn main() -> ExitCode {
    match run_bootstrap(std::env::args_os().skip(1), &UnavailableBootstrapBackend) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("RESTOTM bootstrap refused provisioning: {error}");
            // EX_CONFIG. The helper must never report successful provisioning until
            // native ACL creation, DPAPI protection and atomic receipt writing exist.
            ExitCode::from(78)
        }
    }
}
