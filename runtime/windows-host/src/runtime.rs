use crate::bootstrap::load_verified_bootstrap;
use crate::error::Result;
use crate::logging;
use crate::secrets::DpapiSecretProvider;
use crate::supervisor::RunningSupervisor;
use crate::update::{wait_for_candidate_health, PreparedUpdateOutcome, UpdateCoordinator};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{error, info, warn};
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
        let coordinator = UpdateCoordinator::open(verified.config)?;
        let supervisor = match coordinator.prepare()? {
            PreparedUpdateOutcome::NoPending(config) => {
                RunningSupervisor::start_with_stop(config, secrets, stop)?
            }
            PreparedUpdateOutcome::Pending(mut update) => {
                let candidate = update.candidate_config();
                let target_version = candidate.children.iter()
                    .find(|child| child.name == "local-api")
                    .and_then(|child| child.environment.get("APP_VERSION"))
                    .cloned()
                    .ok_or_else(|| crate::error::HostError::UpdateRejected(
                        "candidate APP_VERSION is missing".into(),
                    ))?;
                info!(event = "signed_update_candidate_start", version = %target_version,
                    "starting immutable signed update candidate");
                let candidate_supervisor = match RunningSupervisor::start_with_stop(
                    candidate.clone(), secrets.clone(), stop.clone(),
                ) {
                    Ok(supervisor) => supervisor,
                    Err(cause) => {
                        error!(event = "signed_update_candidate_spawn_failed", error = %cause,
                            "candidate startup failed; rolling back before service availability");
                        let fallback = update.rollback(&cause.to_string())?;
                        return Ok(Self {
                            supervisor: RunningSupervisor::start_with_stop(fallback, secrets, stop)?,
                            _log_guard: log_guard,
                        });
                    }
                };
                update.mark_health_checking()?;
                match wait_for_candidate_health(&candidate, &target_version, stop.as_ref()) {
                    Ok(()) => {
                        update.commit()?;
                        info!(event = "signed_update_committed", version = %target_version,
                            "candidate passed stable health gate and was committed");
                        candidate_supervisor
                    }
                    Err(cause) if stop.load(Ordering::SeqCst) => {
                        // Leave the durable HEALTH_CHECKING journal in place.
                        // The next service start restores the previous release and,
                        // for schema-changing updates, the offline physical snapshot.
                        warn!(event = "signed_update_interrupted", error = %cause,
                            "external stop interrupted update; recovery journal retained");
                        candidate_supervisor.request_stop();
                        candidate_supervisor.wait()?;
                        return Err(cause);
                    }
                    Err(cause) => {
                        error!(event = "signed_update_health_failed", error = %cause,
                            "candidate failed health gate; stopping all children before rollback");
                        candidate_supervisor.request_stop();
                        candidate_supervisor.wait()?;
                        let fallback = update.rollback(&cause.to_string())?;
                        RunningSupervisor::start_with_stop(fallback, secrets, stop)?
                    }
                }
            }
        };
        Ok(Self {
            supervisor,
            _log_guard: log_guard,
        })
    }

    pub fn wait(self) -> Result<()> {
        self.supervisor.wait()
    }
}
