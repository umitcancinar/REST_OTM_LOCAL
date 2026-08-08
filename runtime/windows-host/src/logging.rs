use crate::error::{HostError, Result};
use std::fs;
use std::path::Path;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

pub fn initialize(log_directory: &Path) -> Result<WorkerGuard> {
    fs::create_dir_all(log_directory)
        .map_err(|error| HostError::io(log_directory.display().to_string(), error))?;
    let appender = tracing_appender::rolling::daily(log_directory, "runtime-host.ndjson");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    let filter = EnvFilter::try_from_env("RESTOTM_LOG").unwrap_or_else(|_| EnvFilter::new("info"));
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_writer(writer)
        .json()
        .flatten_event(true)
        .with_ansi(false)
        .try_init()
        .map_err(|error| HostError::InvalidConfig(format!("logging initialization failed: {error}")))?;
    Ok(guard)
}
