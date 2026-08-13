use crate::error::{HostError, Result};
use std::fs;
use std::path::Path;
use std::time::SystemTime;
use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::EnvFilter;

const MAX_LOG_FILES: usize = 31;
const MAX_TOTAL_LOG_BYTES: u64 = 256 * 1024 * 1024;

pub fn initialize(log_directory: &Path) -> Result<WorkerGuard> {
    fs::create_dir_all(log_directory)
        .map_err(|error| HostError::io(log_directory.display().to_string(), error))?;
    prune_old_logs(log_directory)?;
    let appender = tracing_appender::rolling::daily(log_directory, "runtime-host.ndjson");
    let (writer, guard) = tracing_appender::non_blocking(appender);
    // A machine-wide environment variable must not be able to turn production
    // logging up to trace and fill the customer's disk with sensitive noise.
    let filter = EnvFilter::new("info");
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

fn prune_old_logs(log_directory: &Path) -> Result<()> {
    let mut files = Vec::new();
    for entry in fs::read_dir(log_directory)
        .map_err(|error| HostError::io(log_directory.display().to_string(), error))?
    {
        let entry = entry
            .map_err(|error| HostError::io(log_directory.display().to_string(), error))?;
        let file_type = entry
            .file_type()
            .map_err(|error| HostError::io(entry.path().display().to_string(), error))?;
        let name = entry.file_name();
        if !file_type.is_file()
            || !name
                .to_string_lossy()
                .starts_with("runtime-host.ndjson")
        {
            continue;
        }
        let metadata = entry
            .metadata()
            .map_err(|error| HostError::io(entry.path().display().to_string(), error))?;
        files.push((
            entry.path(),
            metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
            metadata.len(),
        ));
    }

    files.sort_by(|left, right| right.1.cmp(&left.1));
    let mut retained_bytes = 0_u64;
    for (index, (path, _, length)) in files.into_iter().enumerate() {
        let keep = index < MAX_LOG_FILES
            && retained_bytes.saturating_add(length) <= MAX_TOTAL_LOG_BYTES;
        if keep {
            retained_bytes = retained_bytes.saturating_add(length);
        } else {
            fs::remove_file(&path)
                .map_err(|error| HostError::io(path.display().to_string(), error))?;
        }
    }
    Ok(())
}
