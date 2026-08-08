use crate::error::{HostError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OverallState {
    Starting,
    Healthy,
    Degraded,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ChildState {
    Pending,
    Starting,
    Running,
    Backoff,
    CrashLoop,
    Stopping,
    Stopped,
    Failed,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ChildHealth {
    pub state: ChildState,
    pub pid: Option<u32>,
    pub restart_count: u64,
    pub crashes_in_window: usize,
    pub last_exit_code: Option<i32>,
    pub last_error: Option<String>,
    pub updated_at_unix_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct HealthSnapshot {
    pub schema_version: u32,
    pub installation_id: String,
    pub overall: OverallState,
    pub children: BTreeMap<String, ChildHealth>,
    pub updated_at_unix_ms: u64,
}

#[derive(Clone)]
pub struct HealthRegistry {
    path: PathBuf,
    inner: Arc<Mutex<HealthSnapshot>>,
    persist_lock: Arc<Mutex<()>>,
}

impl HealthRegistry {
    pub fn new(
        path: PathBuf,
        installation_id: String,
        child_names: impl IntoIterator<Item = String>,
    ) -> Result<Self> {
        let timestamp = unix_millis();
        let children = child_names
            .into_iter()
            .map(|name| {
                (
                    name,
                    ChildHealth {
                        state: ChildState::Pending,
                        pid: None,
                        restart_count: 0,
                        crashes_in_window: 0,
                        last_exit_code: None,
                        last_error: None,
                        updated_at_unix_ms: timestamp,
                    },
                )
            })
            .collect();
        let registry = Self {
            path,
            inner: Arc::new(Mutex::new(HealthSnapshot {
                schema_version: 1,
                installation_id,
                overall: OverallState::Starting,
                children,
                updated_at_unix_ms: timestamp,
            })),
            persist_lock: Arc::new(Mutex::new(())),
        };
        registry.persist()?;
        Ok(registry)
    }

    pub fn update_child(
        &self,
        name: &str,
        state: ChildState,
        pid: Option<u32>,
        crashes_in_window: usize,
        exit_code: Option<i32>,
        error: Option<String>,
        increment_restart: bool,
    ) -> Result<()> {
        {
            let mut snapshot = self.lock()?;
            let child = snapshot.children.get_mut(name).ok_or_else(|| {
                HostError::InvalidConfig(format!("unknown child health entry: {name}"))
            })?;
            child.state = state;
            child.pid = pid;
            child.crashes_in_window = crashes_in_window;
            child.last_exit_code = exit_code;
            child.last_error = error.map(|message| sanitize_health_error(&message));
            child.updated_at_unix_ms = unix_millis();
            if increment_restart {
                child.restart_count = child.restart_count.saturating_add(1);
            }
            snapshot.updated_at_unix_ms = unix_millis();
            snapshot.overall = derive_overall(&snapshot.children, &snapshot.overall);
        }
        self.persist()
    }

    pub fn set_overall(&self, state: OverallState) -> Result<()> {
        {
            let mut snapshot = self.lock()?;
            snapshot.overall = state;
            snapshot.updated_at_unix_ms = unix_millis();
        }
        self.persist()
    }

    pub fn snapshot(&self) -> Result<HealthSnapshot> {
        Ok(self.lock()?.clone())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HealthSnapshot>> {
        self.inner
            .lock()
            .map_err(|_| HostError::InvalidConfig("health state mutex is poisoned".into()))
    }

    fn persist(&self) -> Result<()> {
        let _persist_guard = self
            .persist_lock
            .lock()
            .map_err(|_| HostError::InvalidConfig("health persistence mutex is poisoned".into()))?;
        let snapshot = self.snapshot()?;
        let bytes = serde_json::to_vec(&snapshot)
            .map_err(|error| HostError::json("serialize health state", error))?;
        persist_health_file(&self.path, &bytes)
    }
}

fn derive_overall(
    children: &BTreeMap<String, ChildHealth>,
    current: &OverallState,
) -> OverallState {
    if matches!(
        current,
        OverallState::Stopping | OverallState::Stopped | OverallState::Failed
    ) {
        return current.clone();
    }
    if children.values().all(|child| child.state == ChildState::Running) {
        OverallState::Healthy
    } else if children
        .values()
        .any(|child| matches!(child.state, ChildState::CrashLoop | ChildState::Failed))
    {
        OverallState::Degraded
    } else {
        OverallState::Starting
    }
}

fn persist_health_file(path: &Path, bytes: &[u8]) -> Result<()> {
    static TEMPORARY_COUNTER: AtomicU64 = AtomicU64::new(0);
    let parent = path
        .parent()
        .ok_or_else(|| HostError::InvalidConfig("health path has no parent".into()))?;
    fs::create_dir_all(parent)
        .map_err(|error| HostError::io(parent.display().to_string(), error))?;
    let temporary = parent.join(format!(
        ".health-{}-{}.tmp",
        std::process::id(),
        TEMPORARY_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
    drop(file);
    if path.exists() {
        fs::remove_file(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    }
    fs::rename(&temporary, path)
        .map_err(|error| HostError::io(path.display().to_string(), error))?;
    Ok(())
}

fn unix_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64
}

fn sanitize_health_error(message: &str) -> String {
    message
        .chars()
        .filter(|character| !character.is_control())
        .take(512)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn persists_structured_health_without_control_characters() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("health.json");
        let registry = HealthRegistry::new(path.clone(), "install-id".into(), ["api".into()])
            .unwrap();
        registry
            .update_child(
                "api",
                ChildState::Failed,
                None,
                2,
                Some(1),
                Some("failed\nwith\tcontrols".into()),
                true,
            )
            .unwrap();
        let parsed: HealthSnapshot =
            serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(parsed.overall, OverallState::Degraded);
        assert_eq!(parsed.children["api"].last_error.as_deref(), Some("failedwithcontrols"));
    }
}
