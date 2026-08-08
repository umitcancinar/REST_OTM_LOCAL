use restotm_windows_host::error::{HostError, Result};
use restotm_windows_host::runtime::RuntimeInstance;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

fn main() -> ExitCode {
    match run(std::env::args_os().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("RESTOTM runtime host failed: {error}");
            ExitCode::from(1)
        }
    }
}

fn run(arguments: Vec<OsString>) -> Result<()> {
    let (mode, config_path) = parse_arguments(arguments)?;
    match mode.as_str() {
        "console" => run_console(config_path),
        "service" => {
            #[cfg(windows)]
            {
                restotm_windows_host::windows_service::run_dispatcher(config_path)
            }
            #[cfg(not(windows))]
            {
                let _ = config_path;
                Err(HostError::UnsupportedPlatform(
                    "Windows service dispatcher is unavailable on this platform".into(),
                ))
            }
        }
        _ => Err(HostError::InvalidConfig("unsupported runtime mode".into())),
    }
}

fn run_console(config_path: PathBuf) -> Result<()> {
    let stop = Arc::new(AtomicBool::new(false));
    let signal_stop = stop.clone();
    ctrlc::set_handler(move || signal_stop.store(true, Ordering::SeqCst))
        .map_err(|error| HostError::InvalidConfig(format!("signal handler failed: {error}")))?;
    RuntimeInstance::start(&config_path, stop)?.wait()
}

fn parse_arguments(arguments: Vec<OsString>) -> Result<(String, PathBuf)> {
    if arguments.len() != 3 || arguments[1].to_str() != Some("--config") {
        return Err(HostError::InvalidConfig(
            "usage: restotm-runtime-service <service|console> --config <absolute-path>".into(),
        ));
    }
    let mode = arguments[0]
        .clone()
        .into_string()
        .map_err(|_| HostError::InvalidConfig("mode is not UTF-8".into()))?;
    if mode != "service" && mode != "console" {
        return Err(HostError::InvalidConfig(
            "mode must be service or console".into(),
        ));
    }
    let config_path = PathBuf::from(arguments[2].clone());
    if !config_path.is_absolute() {
        return Err(HostError::InvalidConfig(
            "config path must be absolute".into(),
        ));
    }
    Ok((mode, config_path))
}
