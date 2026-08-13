use crate::error::{HostError, Result};
use crate::runtime::RuntimeInstance;
use crate::SERVICE_NAME;
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use windows_service::service::{
    ServiceControl, ServiceControlAccept, ServiceExitCode, ServiceState, ServiceStatus,
    ServiceType,
};
use windows_service::service_control_handler::{
    self, ServiceControlHandlerResult, ServiceStatusHandle,
};
use windows_service::service_dispatcher;

static CONFIG_PATH: OnceLock<PathBuf> = OnceLock::new();

windows_service::define_windows_service!(ffi_service_main, service_main);

pub fn run_dispatcher(config_path: PathBuf) -> Result<()> {
    CONFIG_PATH
        .set(config_path)
        .map_err(|_| HostError::InvalidConfig("service config path was set twice".into()))?;
    service_dispatcher::start(SERVICE_NAME, ffi_service_main)?;
    Ok(())
}

fn service_main(_arguments: Vec<OsString>) {
    if let Err(error) = run_service() {
        eprintln!("RESTOTM runtime service failed: {error}");
    }
}

fn run_service() -> Result<()> {
    let stop = Arc::new(AtomicBool::new(false));
    let handler_stop = stop.clone();
    let status_slot: Arc<Mutex<Option<ServiceStatusHandle>>> = Arc::new(Mutex::new(None));
    let handler_status = status_slot.clone();
    let event_handler = move |control| -> ServiceControlHandlerResult {
        match control {
            ServiceControl::Stop | ServiceControl::Shutdown | ServiceControl::Preshutdown => {
                handler_stop.store(true, Ordering::SeqCst);
                if let Ok(slot) = handler_status.lock() {
                    if let Some(handle) = slot.as_ref() {
                        let _ = handle.set_service_status(service_status(
                            ServiceState::StopPending,
                            ServiceControlAccept::empty(),
                            ServiceExitCode::Win32(0),
                            1,
                            Duration::from_secs(120),
                        ));
                    }
                }
                ServiceControlHandlerResult::NoError
            }
            ServiceControl::Interrogate => ServiceControlHandlerResult::NoError,
            _ => ServiceControlHandlerResult::NotImplemented,
        }
    };
    let status = service_control_handler::register(SERVICE_NAME, event_handler)?;
    *status_slot
        .lock()
        .map_err(|_| HostError::InvalidConfig("service status mutex is poisoned".into()))? =
        Some(status.clone());
    status.set_service_status(service_status(
        ServiceState::StartPending,
        ServiceControlAccept::empty(),
        ServiceExitCode::Win32(0),
        1,
        Duration::from_secs(30),
    ))?;
    let config_path = CONFIG_PATH
        .get()
        .ok_or_else(|| HostError::InvalidConfig("service config path is missing".into()))?;

    // Child readiness is deliberately strict and PostgreSQL recovery can take
    // longer than SCM's initial wait hint. Keep advancing the checkpoint while
    // startup is in progress so Windows never mistakes a healthy recovery for
    // a hung service.
    let startup_reporting = Arc::new(AtomicBool::new(true));
    let reporter_running = startup_reporting.clone();
    let reporter_stop = stop.clone();
    let reporter_status = status.clone();
    let startup_reporter = thread::spawn(move || {
        let mut checkpoint = 2u32;
        while reporter_running.load(Ordering::SeqCst)
            && !reporter_stop.load(Ordering::SeqCst)
        {
            thread::park_timeout(Duration::from_secs(5));
            if !reporter_running.load(Ordering::SeqCst)
                || reporter_stop.load(Ordering::SeqCst)
            {
                break;
            }
            if reporter_status
                .set_service_status(service_status(
                    ServiceState::StartPending,
                    ServiceControlAccept::empty(),
                    ServiceExitCode::Win32(0),
                    checkpoint,
                    Duration::from_secs(30),
                ))
                .is_err()
            {
                break;
            }
            checkpoint = checkpoint.saturating_add(1);
        }
    });

    let runtime_result = RuntimeInstance::start(config_path, stop);
    startup_reporting.store(false, Ordering::SeqCst);
    startup_reporter.thread().unpark();
    startup_reporter.join().map_err(|_| {
        HostError::InvalidConfig("service startup status reporter panicked".into())
    })?;

    let runtime = match runtime_result {
        Ok(runtime) => runtime,
        Err(error) => {
            status.set_service_status(service_status(
                ServiceState::Stopped,
                ServiceControlAccept::empty(),
                ServiceExitCode::ServiceSpecific(1),
                0,
                Duration::default(),
            ))?;
            return Err(error);
        }
    };

    status.set_service_status(service_status(
        ServiceState::Running,
        ServiceControlAccept::STOP
            | ServiceControlAccept::SHUTDOWN
            | ServiceControlAccept::PRESHUTDOWN,
        ServiceExitCode::Win32(0),
        0,
        Duration::default(),
    ))?;
    let result = runtime.wait();
    status.set_service_status(service_status(
        ServiceState::Stopped,
        ServiceControlAccept::empty(),
        if result.is_ok() {
            ServiceExitCode::Win32(0)
        } else {
            ServiceExitCode::ServiceSpecific(2)
        },
        0,
        Duration::default(),
    ))?;
    result
}

fn service_status(
    current_state: ServiceState,
    controls_accepted: ServiceControlAccept,
    exit_code: ServiceExitCode,
    checkpoint: u32,
    wait_hint: Duration,
) -> ServiceStatus {
    ServiceStatus {
        service_type: ServiceType::OWN_PROCESS,
        current_state,
        controls_accepted,
        exit_code,
        checkpoint,
        wait_hint,
        process_id: None,
    }
}
