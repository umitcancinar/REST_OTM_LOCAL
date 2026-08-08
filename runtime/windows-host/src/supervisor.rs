use crate::backoff::CrashTracker;
use crate::config::{ChildSpec, HostConfig, ShutdownSpec};
use crate::error::{HostError, Result};
use crate::health::{ChildState, HealthRegistry, OverallState};
use crate::platform::ManagedChild;
use crate::secrets::SecretProvider;
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use tracing::{error, info, warn};

const POLL_INTERVAL: Duration = Duration::from_millis(250);

pub struct RunningSupervisor {
    stop: Arc<AtomicBool>,
    health: HealthRegistry,
    fatal_rx: Receiver<HostError>,
    workers: Vec<JoinHandle<()>>,
}

impl RunningSupervisor {
    pub fn start(config: HostConfig, secrets: Arc<dyn SecretProvider>) -> Result<Self> {
        Self::start_with_stop(config, secrets, Arc::new(AtomicBool::new(false)))
    }

    pub fn start_with_stop(
        config: HostConfig,
        secrets: Arc<dyn SecretProvider>,
        stop: Arc<AtomicBool>,
    ) -> Result<Self> {
        config.validate()?;
        let health = HealthRegistry::new(
            config.health_file.clone(),
            config.installation_id.clone(),
            config.children.iter().map(|child| child.name.clone()),
        )?;
        let (fatal_tx, fatal_rx) = mpsc::channel();
        let mut workers = Vec::with_capacity(config.children.len());

        for index in config.startup_order()? {
            let spec = config.children[index].clone();
            health.update_child(
                &spec.name,
                ChildState::Starting,
                None,
                0,
                None,
                None,
                false,
            )?;
            let initial_child = match spawn_child(&spec, secrets.as_ref()) {
                Ok(child) => child,
                Err(cause) => {
                    let message = cause.to_string();
                    health.update_child(
                        &spec.name,
                        ChildState::Failed,
                        None,
                        0,
                        None,
                        Some(message.clone()),
                        false,
                    )?;
                    stop.store(true, Ordering::SeqCst);
                    for worker in workers {
                        let _ = worker.join();
                    }
                    return Err(HostError::ChildProcess {
                        name: spec.name,
                        message,
                    });
                }
            };
            let pid = initial_child.id();
            health.update_child(
                &spec.name,
                ChildState::Running,
                Some(pid),
                0,
                None,
                None,
                false,
            )?;
            info!(event = "child_started", child = %spec.name, pid, "child process started");

            let worker_health = health.clone();
            let worker_stop = stop.clone();
            let worker_secrets = secrets.clone();
            let worker_policy = config.restart_policy.clone();
            let worker_fatal = fatal_tx.clone();
            workers.push(thread::spawn(move || {
                worker_loop(
                    spec,
                    initial_child,
                    worker_policy,
                    worker_secrets,
                    worker_health,
                    worker_stop,
                    worker_fatal,
                )
            }));
        }
        drop(fatal_tx);
        Ok(Self {
            stop,
            health,
            fatal_rx,
            workers,
        })
    }

    pub fn shutdown_handle(&self) -> Arc<AtomicBool> {
        self.stop.clone()
    }

    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    pub fn wait(mut self) -> Result<()> {
        let fatal = loop {
            match self.fatal_rx.recv_timeout(POLL_INTERVAL) {
                Ok(error) => {
                    self.stop.store(true, Ordering::SeqCst);
                    break Some(error);
                }
                Err(RecvTimeoutError::Timeout) if self.stop.load(Ordering::SeqCst) => break None,
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => break None,
            }
        };

        self.health.set_overall(OverallState::Stopping)?;
        for worker in self.workers.drain(..) {
            if worker.join().is_err() && fatal.is_none() {
                self.health.set_overall(OverallState::Failed)?;
                return Err(HostError::ChildProcess {
                    name: "supervisor-worker".into(),
                    message: "worker thread panicked".into(),
                });
            }
        }
        if let Some(error) = fatal {
            self.health.set_overall(OverallState::Failed)?;
            Err(error)
        } else {
            self.health.set_overall(OverallState::Stopped)?;
            Ok(())
        }
    }
}

impl Drop for RunningSupervisor {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn worker_loop(
    spec: ChildSpec,
    mut child: ManagedChild,
    policy: crate::config::RestartPolicy,
    secrets: Arc<dyn SecretProvider>,
    health: HealthRegistry,
    stop: Arc<AtomicBool>,
    fatal: Sender<HostError>,
) {
    let mut tracker = CrashTracker::new(policy);
    let mut started_at = Instant::now();

    loop {
        if stop.load(Ordering::SeqCst) {
            update_or_fail(
                &health,
                &fatal,
                &stop,
                &spec.name,
                ChildState::Stopping,
                Some(child.id()),
                0,
                None,
                None,
                false,
            );
            stop_child(&spec, &mut child, secrets.as_ref());
            update_or_fail(
                &health,
                &fatal,
                &stop,
                &spec.name,
                ChildState::Stopped,
                None,
                0,
                None,
                None,
                false,
            );
            return;
        }

        match child.try_wait() {
            Ok(None) => {
                thread::sleep(POLL_INTERVAL);
                continue;
            }
            Ok(Some(status)) => {
                let exit_code = status.code();
                let decision = tracker.record_exit(started_at, Instant::now());
                warn!(
                    event = "child_exited",
                    child = %spec.name,
                    ?exit_code,
                    crashes_in_window = decision.crashes_in_window,
                    delay_ms = decision.delay.as_millis() as u64,
                    crash_loop = decision.crash_loop,
                    "child exited unexpectedly"
                );
                let state = if decision.crash_loop {
                    ChildState::CrashLoop
                } else {
                    ChildState::Backoff
                };
                update_or_fail(
                    &health,
                    &fatal,
                    &stop,
                    &spec.name,
                    state,
                    None,
                    decision.crashes_in_window,
                    exit_code,
                    None,
                    true,
                );
                if decision.crash_loop && spec.essential {
                    stop.store(true, Ordering::SeqCst);
                    let _ = fatal.send(HostError::CrashLoop(spec.name.clone()));
                    return;
                }
                if !sleep_interruptibly(decision.delay, &stop) {
                    continue;
                }
            }
            Err(cause) => {
                stop.store(true, Ordering::SeqCst);
                let _ = fatal.send(HostError::ChildProcess {
                    name: spec.name.clone(),
                    message: cause.to_string(),
                });
                return;
            }
        }

        update_or_fail(
            &health,
            &fatal,
            &stop,
            &spec.name,
            ChildState::Starting,
            None,
            0,
            None,
            None,
            false,
        );
        match spawn_child(&spec, secrets.as_ref()) {
            Ok(new_child) => {
                let pid = new_child.id();
                child = new_child;
                started_at = Instant::now();
                update_or_fail(
                    &health,
                    &fatal,
                    &stop,
                    &spec.name,
                    ChildState::Running,
                    Some(pid),
                    0,
                    None,
                    None,
                    false,
                );
                info!(event = "child_restarted", child = %spec.name, pid, "child restarted");
            }
            Err(cause) => {
                error!(event = "child_restart_failed", child = %spec.name, error = %cause, "child restart failed");
                let decision = tracker.record_exit(Instant::now(), Instant::now());
                update_or_fail(
                    &health,
                    &fatal,
                    &stop,
                    &spec.name,
                    if decision.crash_loop {
                        ChildState::CrashLoop
                    } else {
                        ChildState::Backoff
                    },
                    None,
                    decision.crashes_in_window,
                    None,
                    Some(cause.to_string()),
                    true,
                );
                if decision.crash_loop && spec.essential {
                    stop.store(true, Ordering::SeqCst);
                    let _ = fatal.send(HostError::CrashLoop(spec.name.clone()));
                    return;
                }
                if !sleep_interruptibly(decision.delay, &stop) {
                    continue;
                }
                match spawn_child(&spec, secrets.as_ref()) {
                    Ok(new_child) => {
                        let pid = new_child.id();
                        child = new_child;
                        started_at = Instant::now();
                    }
                    Err(second_error) => {
                        if spec.essential {
                            stop.store(true, Ordering::SeqCst);
                            let _ = fatal.send(HostError::ChildProcess {
                                name: spec.name.clone(),
                                message: second_error.to_string(),
                            });
                            return;
                        }
                        continue;
                    }
                }
            }
        }
    }
}

fn spawn_child(spec: &ChildSpec, secrets: &dyn SecretProvider) -> Result<ManagedChild> {
    if !spec.executable.is_file() || !spec.working_directory.is_dir() {
        return Err(HostError::ChildProcess {
            name: spec.name.clone(),
            message: "signed release executable or working directory is missing".into(),
        });
    }
    let mut command = Command::new(&spec.executable);
    command
        .current_dir(&spec.working_directory)
        .args(&spec.arguments)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    for inherited in ["SystemRoot", "WINDIR", "TEMP", "TMP"] {
        if let Some(value) = std::env::var_os(inherited) {
            command.env(inherited, value);
        }
    }
    for (key, value) in &spec.environment {
        command.env(key, value);
    }
    for (key, file_path) in &spec.file_environment {
        let metadata = std::fs::metadata(file_path)
            .map_err(|error| HostError::io(file_path.display().to_string(), error))?;
        if !metadata.is_file() || metadata.len() > 64 * 1024 {
            return Err(HostError::InvalidConfig(format!(
                "public environment file for {} is missing or too large",
                spec.name
            )));
        }
        let value = std::fs::read_to_string(file_path)
            .map_err(|error| HostError::io(file_path.display().to_string(), error))?;
        if value.contains("PRIVATE KEY") || value.contains('\0') {
            return Err(HostError::InvalidConfig(format!(
                "file_environment for {} contains forbidden private material",
                spec.name
            )));
        }
        command.env(key, value);
    }
    for (key, secret_reference) in &spec.secret_environment {
        let value = secrets.resolve(secret_reference)?;
        command.env(key, value.as_str());
    }
    ManagedChild::spawn(&mut command).map_err(|cause| HostError::ChildProcess {
        name: spec.name.clone(),
        message: cause.to_string(),
    })
}

fn stop_child(spec: &ChildSpec, child: &mut ManagedChild, secrets: &dyn SecretProvider) {
    match &spec.shutdown {
        ShutdownSpec::Http {
            port,
            path,
            token_secret,
            grace_ms,
        } => {
            if let Err(cause) = send_shutdown_http(*port, path, token_secret, secrets) {
                warn!(event = "graceful_shutdown_failed", child = %spec.name, error = %cause, "graceful shutdown request failed");
            }
            let deadline = Instant::now() + Duration::from_millis(*grace_ms);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        info!(event = "child_stopped", child = %spec.name, ?status, "child stopped gracefully");
                        return;
                    }
                    Ok(None) if Instant::now() < deadline => thread::sleep(POLL_INTERVAL),
                    _ => break,
                }
            }
        }
        ShutdownSpec::Terminate { grace_ms } => {
            let deadline = Instant::now() + Duration::from_millis(*grace_ms);
            while Instant::now() < deadline {
                if child.try_wait().ok().flatten().is_some() {
                    return;
                }
                thread::sleep(POLL_INTERVAL);
            }
        }
    }
    if let Err(cause) = child.terminate_tree() {
        error!(event = "child_force_stop_failed", child = %spec.name, error = %cause, "failed to terminate child tree");
    }
    let _ = child.wait();
}

fn send_shutdown_http(
    port: u16,
    path: &str,
    token_secret: &str,
    secrets: &dyn SecretProvider,
) -> Result<()> {
    let token = secrets.resolve(token_secret)?;
    if token.contains('\r') || token.contains('\n') {
        return Err(HostError::InvalidSecretStore(
            "shutdown token contains header control characters".into(),
        ));
    }
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| HostError::io("connect graceful shutdown endpoint", error))?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .and_then(|_| stream.set_write_timeout(Some(Duration::from_secs(2))))
        .map_err(|error| HostError::io("configure graceful shutdown socket", error))?;
    stream
        .write_all(format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer ").as_bytes())
        .and_then(|_| stream.write_all(token.as_bytes()))
        .and_then(|_| {
            stream.write_all(b"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        })
        .map_err(|error| HostError::io("write graceful shutdown request", error))?;
    let mut response = [0_u8; 128];
    let length = stream
        .read(&mut response)
        .map_err(|error| HostError::io("read graceful shutdown response", error))?;
    let status = std::str::from_utf8(&response[..length]).unwrap_or_default();
    if !(status.starts_with("HTTP/1.1 200")
        || status.starts_with("HTTP/1.1 202")
        || status.starts_with("HTTP/1.1 204"))
    {
        return Err(HostError::ChildProcess {
            name: "graceful-shutdown".into(),
            message: "loopback endpoint rejected shutdown request".into(),
        });
    }
    Ok(())
}

fn sleep_interruptibly(duration: Duration, stop: &AtomicBool) -> bool {
    let deadline = Instant::now() + duration;
    while Instant::now() < deadline {
        if stop.load(Ordering::SeqCst) {
            return false;
        }
        thread::sleep(POLL_INTERVAL.min(deadline.saturating_duration_since(Instant::now())));
    }
    true
}

#[allow(clippy::too_many_arguments)]
fn update_or_fail(
    health: &HealthRegistry,
    fatal: &Sender<HostError>,
    stop: &AtomicBool,
    name: &str,
    state: ChildState,
    pid: Option<u32>,
    crashes: usize,
    exit_code: Option<i32>,
    error: Option<String>,
    increment_restart: bool,
) {
    if let Err(cause) = health.update_child(
        name,
        state,
        pid,
        crashes,
        exit_code,
        error,
        increment_restart,
    ) {
        stop.store(true, Ordering::SeqCst);
        let _ = fatal.send(cause);
    }
}
