use crate::bootstrap::load_verified_bootstrap;
use crate::error::Result;
use crate::logging;
use crate::secrets::DpapiSecretProvider;
use crate::supervisor::RunningSupervisor;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tracing_appender::non_blocking::WorkerGuard;

pub struct RuntimeInstance {
    supervisor: RunningSupervisor,
    _log_guard: WorkerGuard,
}
impl RuntimeInstance {
    pub fn start(config_path: &Path, stop: Arc<AtomicBool>) -> Result<Self> {
        let verified = load_verified_bootstrap(config_path)?;
        let log_guard = logging::initialize(&verified.config.log_directory)?;
        let secrets = DpapiSecretProvider::from_verified_bytes(&verified.secret_store_bytes)?;
        let supervisor = RunningSupervisor::start_with_stop(verified.config, secrets, stop)?;
        Ok(Self {
            supervisor,
            _log_guard: log_guard,
        })
    }

    pub fn wait(self) -> Result<()> {
        self.supervisor.wait()
    }
}
