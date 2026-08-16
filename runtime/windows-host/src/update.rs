//! Fail-closed handoff between the local API's downloader and the native host.
//!
//! The API is deliberately unable to install an update. This module consumes its
//! fixed `pending-handoff.json`, verifies the Ed25519 envelope and every staged
//! artifact again, extracts one signed `windows-payload` into an immutable
//! Program Files release directory, snapshots the offline PostgreSQL data tree,
//! and atomically switches a small active-release pointer. The stable Windows
//! service binary and ProgramData operational trees are never part of a payload.

use crate::config::HostConfig;
use crate::error::{HostError, Result};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use zip::ZipArchive;

const HANDOFF_FILE: &str = "pending-handoff.json";
const ACTIVE_RELEASE_FILE: &str = "active-release.json";
const JOURNAL_FILE: &str = "update-transaction.json";
const SUPERVISOR_RESULT_FILE: &str = "supervisor-result.json";
const MAX_JSON_BYTES: u64 = 256 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 20_000;
const MAX_EXTRACTED_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const HEALTH_TIMEOUT: Duration = Duration::from_secs(120);
const HEALTH_STABILITY: Duration = Duration::from_secs(5);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SignedEnvelope {
    payload: String,
    signature: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    schema_version: u32,
    version: String,
    channel: String,
    min_current_version: String,
    max_current_version: String,
    issued_at: String,
    expires_at: String,
    migration: Migration,
    artifacts: Vec<ManifestArtifact>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Migration {
    contract_version: u32,
    min_current_schema_version: u32,
    max_current_schema_version: u32,
    target_schema_version: u32,
    mode: MigrationMode,
    requires_backup: bool,
    rollback_supported: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
enum MigrationMode {
    None,
    BackwardCompatible,
    OfflineRequired,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManifestArtifact {
    role: String,
    file_name: String,
    platform: String,
    sha256: String,
    size_bytes: u64,
    url: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Handoff {
    contract_version: u32,
    command_id: String,
    action: String,
    state: String,
    created_at: String,
    current_version: String,
    target_version: String,
    channel: String,
    manifest_sha256: String,
    manifest_envelope_path: PathBuf,
    stage_directory: PathBuf,
    artifacts: Vec<HandoffArtifact>,
    migration: Migration,
    verification: VerificationContract,
    requirements: RequirementsContract,
    local_api_apply_supported: bool,
    operational_data_included: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HandoffArtifact {
    role: String,
    file_name: String,
    absolute_path: PathBuf,
    sha256: String,
    size_bytes: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerificationContract {
    signature_algorithm: String,
    canonical_manifest_required: bool,
    supervisor_must_reverify_manifest_and_artifacts: bool,
    public_key_environment_name: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RequirementsContract {
    supervisor_protocol_version: u32,
    pre_migration_backup_required_when_declared: bool,
    atomic_replace_required: bool,
    health_check_and_rollback_required: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActiveRelease {
    state_version: u32,
    version: String,
    database_schema_version: u32,
    manifest_sha256: String,
    release_directory: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TransactionJournal {
    state_version: u32,
    command_id: String,
    phase: TransactionPhase,
    target_version: String,
    target_schema_version: u32,
    manifest_sha256: String,
    candidate_directory: PathBuf,
    safety_backup_directory: PathBuf,
    previous_active: Option<ActiveRelease>,
    schema_change: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum TransactionPhase {
    Prepared,
    Activated,
    HealthChecking,
    Committed,
    RolledBack,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SupervisorResult {
    result_version: u32,
    command_id: String,
    target_version: String,
    manifest_sha256: String,
    state: &'static str,
    detail: String,
}

pub struct UpdateCoordinator {
    base_config: HostConfig,
    update_root: PathBuf,
    active_path: PathBuf,
    journal_path: PathBuf,
    handoff_path: PathBuf,
}

pub struct PreparedUpdate {
    coordinator: UpdateCoordinator,
    journal: TransactionJournal,
    candidate_config: HostConfig,
    fallback_config: HostConfig,
}

impl UpdateCoordinator {
    pub fn open(base_config: HostConfig) -> Result<Self> {
        let api = api_child(&base_config)?;
        let update_root = required_environment_path(api, "LOCAL_UPDATE_DATA_DIR")?;
        assert_path_below(&base_config.program_data_root, &update_root, "update data root")?;
        assert_direct_components(&base_config.program_data_root)?;
        fs::create_dir_all(&update_root)
            .map_err(|error| HostError::io(update_root.display().to_string(), error))?;
        assert_direct_components(&update_root)?;
        Ok(Self {
            active_path: base_config.program_data_root.join("runtime").join(ACTIVE_RELEASE_FILE),
            journal_path: update_root.join(JOURNAL_FILE),
            handoff_path: update_root.join(HANDOFF_FILE),
            base_config,
            update_root,
        })
    }

    /// Resolve an already committed immutable release before child startup.
    pub fn effective_config(&self) -> Result<HostConfig> {
        match read_optional_json::<ActiveRelease>(&self.active_path)? {
            Some(active) => self.config_for_release(&active),
            None => Ok(self.base_config.clone()),
        }
    }

    /// Recover a power-loss journal and prepare one immutable staged update.
    pub fn prepare(mut self) -> Result<PreparedUpdateOutcome> {
        self.recover_interrupted()?;
        let fallback_config = self.effective_config()?;
        if !self.handoff_path.exists() {
            return Ok(PreparedUpdateOutcome::NoPending(fallback_config));
        }

        let handoff: Handoff = read_json_limited(&self.handoff_path)?;
        let current = current_version(&fallback_config)?;
        self.validate_handoff_contract(&handoff, &current)?;
        let (manifest, digest) = self.reverify_manifest(&handoff)?;
        self.validate_manifest_binding(&handoff, &manifest, &digest, &fallback_config)?;
        self.reverify_artifacts(&handoff, &manifest)?;

        let archive = handoff
            .artifacts
            .iter()
            .find(|artifact| artifact.role == "windows-payload")
            .ok_or_else(|| reject("exactly one windows-payload artifact is required"))?;
        if handoff.artifacts.len() != 1 {
            return Err(reject("component artifacts cannot be atomically mapped; use one canonical windows-payload"));
        }
        let release_name = format!("{}-{}", handoff.target_version, &digest[..16]);
        let releases_root = self.base_config.install_root.join("releases");
        fs::create_dir_all(&releases_root)
            .map_err(|error| HostError::io(releases_root.display().to_string(), error))?;
        assert_direct_components(&releases_root)?;
        let candidate_directory = releases_root.join(release_name);
        if candidate_directory.exists() {
            return Err(reject("candidate release directory already exists; explicit reconciliation is required"));
        }
        extract_canonical_payload(&archive.absolute_path, &candidate_directory)?;
        assert_candidate_contract(&self.base_config, &candidate_directory)?;

        let safety_backup_directory = self
            .base_config
            .program_data_root
            .join("backups")
            .join("update-safety")
            .join(&handoff.command_id);
        snapshot_postgres_data(&self.base_config, &safety_backup_directory)?;

        let previous_active = read_optional_json::<ActiveRelease>(&self.active_path)?;
        let active = ActiveRelease {
            state_version: 1,
            version: handoff.target_version.clone(),
            database_schema_version: manifest.migration.target_schema_version,
            manifest_sha256: digest.clone(),
            release_directory: candidate_directory.clone(),
        };
        let mut journal = TransactionJournal {
            state_version: 1,
            command_id: handoff.command_id,
            phase: TransactionPhase::Prepared,
            target_version: handoff.target_version,
            target_schema_version: manifest.migration.target_schema_version,
            manifest_sha256: digest,
            candidate_directory,
            safety_backup_directory,
            previous_active,
            schema_change: manifest.migration.mode != MigrationMode::None,
        };
        atomic_write_json(&self.journal_path, &journal)?;
        atomic_write_json(&self.active_path, &active)?;
        journal.phase = TransactionPhase::Activated;
        atomic_write_json(&self.journal_path, &journal)?;
        let candidate_config = self.config_for_release(&active)?;
        Ok(PreparedUpdateOutcome::Pending(PreparedUpdate {
            coordinator: self,
            journal,
            candidate_config,
            fallback_config,
        }))
    }

    fn recover_interrupted(&mut self) -> Result<()> {
        let Some(journal) = read_optional_json::<TransactionJournal>(&self.journal_path)? else {
            return Ok(());
        };
        match journal.phase {
            TransactionPhase::Committed => {
                remove_file_if_exists(&self.handoff_path)?;
                remove_directory_if_exists(&journal.safety_backup_directory)?;
                remove_file_if_exists(&self.journal_path)?;
                Ok(())
            }
            TransactionPhase::Prepared => {
                remove_directory_if_exists(&journal.candidate_directory)?;
                remove_file_if_exists(&self.journal_path)
            }
            TransactionPhase::Activated | TransactionPhase::HealthChecking => {
                self.rollback_journal(&journal, "recovered interrupted update before child startup")
            }
            TransactionPhase::RolledBack => remove_file_if_exists(&self.journal_path),
        }
    }

    fn rollback_journal(&self, journal: &TransactionJournal, detail: &str) -> Result<()> {
        if journal.schema_change {
            restore_postgres_snapshot(&self.base_config, &journal.safety_backup_directory)?;
        }
        match &journal.previous_active {
            Some(active) => atomic_write_json(&self.active_path, active)?,
            None => remove_file_if_exists(&self.active_path)?,
        }
        let result = SupervisorResult {
            result_version: 1,
            command_id: journal.command_id.clone(),
            target_version: journal.target_version.clone(),
            manifest_sha256: journal.manifest_sha256.clone(),
            state: "ROLLED_BACK_REQUIRES_OPERATOR_RECONCILIATION",
            detail: sanitize_detail(detail),
        };
        atomic_write_json(&self.update_root.join(SUPERVISOR_RESULT_FILE), &result)?;
        let failed_handoff = self
            .update_root
            .join(format!("pending-handoff.{}.failed.json", journal.command_id));
        if self.handoff_path.exists() {
            fs::rename(&self.handoff_path, &failed_handoff)
                .map_err(|error| HostError::io(failed_handoff.display().to_string(), error))?;
        }
        remove_directory_if_exists(&journal.safety_backup_directory)?;
        remove_file_if_exists(&self.journal_path)
    }

    fn config_for_release(&self, active: &ActiveRelease) -> Result<HostConfig> {
        if active.state_version != 1 || !is_safe_version(&active.version) {
            return Err(reject("active release state is invalid"));
        }
        assert_path_below(&self.base_config.install_root, &active.release_directory, "active release")?;
        assert_direct_components(&active.release_directory)?;
        assert_direct_tree(&active.release_directory)?;
        if active.manifest_sha256.len() != 64 || !is_lower_hex(&active.manifest_sha256) {
            return Err(reject("active release manifest digest is invalid"));
        }
        assert_candidate_contract(&self.base_config, &active.release_directory)?;
        let mut config = self.base_config.clone();
        for child in &mut config.children {
            let executable = child.executable.strip_prefix(&self.base_config.install_root)
                .map_err(|_| reject("base executable escapes install root"))?;
            let working = child.working_directory.strip_prefix(&self.base_config.install_root)
                .map_err(|_| reject("base working directory escapes install root"))?;
            child.executable = active.release_directory.join(executable);
            child.working_directory = active.release_directory.join(working);
            child.environment.insert("APP_VERSION".into(), active.version.clone());
            if child.name == "local-api" {
                child.environment.insert(
                    "LOCAL_UPDATE_DATABASE_SCHEMA_VERSION".into(),
                    active.database_schema_version.to_string(),
                );
                remap_environment_path(
                    &mut child.environment,
                    "PG_DUMP_PATH",
                    &self.base_config.install_root,
                    &active.release_directory,
                )?;
                remap_environment_path(
                    &mut child.environment,
                    "PG_RESTORE_PATH",
                    &self.base_config.install_root,
                    &active.release_directory,
                )?;
            }
        }
        config.validate()?;
        Ok(config)
    }

    fn validate_handoff_contract(&self, handoff: &Handoff, current: &str) -> Result<()> {
        if handoff.contract_version != 1
            || handoff.action != "INSTALL_STAGED_UPDATE"
            || handoff.state != "STAGED_AWAITING_SUPERVISOR"
            || handoff.local_api_apply_supported
            || handoff.operational_data_included
            || handoff.current_version != current
            || !is_safe_version(&handoff.target_version)
            || !is_uuid_like(&handoff.command_id)
            || handoff.created_at.is_empty()
        {
            return Err(reject("handoff header or current-version binding is invalid"));
        }
        let verification = &handoff.verification;
        let requirements = &handoff.requirements;
        if verification.signature_algorithm != "Ed25519"
            || !verification.canonical_manifest_required
            || !verification.supervisor_must_reverify_manifest_and_artifacts
            || verification.public_key_environment_name != "LOCAL_UPDATE_PUBLIC_KEY"
            || requirements.supervisor_protocol_version != 1
            || !requirements.pre_migration_backup_required_when_declared
            || !requirements.atomic_replace_required
            || !requirements.health_check_and_rollback_required
        {
            return Err(reject("supervisor safety requirements were weakened"));
        }
        let stages_root = self.update_root.join("stages");
        assert_direct_child(&stages_root, &handoff.stage_directory, "stage directory")?;
        if handoff.manifest_envelope_path != handoff.stage_directory.join("signed-manifest.json") {
            return Err(reject("manifest envelope path is not canonical"));
        }
        Ok(())
    }

    fn reverify_manifest(&self, handoff: &Handoff) -> Result<(Manifest, String)> {
        let envelope: SignedEnvelope = read_json_limited(&handoff.manifest_envelope_path)?;
        if envelope.payload.len() > MAX_JSON_BYTES as usize {
            return Err(reject("signed payload exceeds supervisor limit"));
        }
        let api = api_child(&self.base_config)?;
        let update_key_path = api.file_environment.get("LOCAL_UPDATE_PUBLIC_KEY")
            .ok_or_else(|| reject("update public key path is missing"))?;
        let license_key_path = api.file_environment.get("LOCAL_LICENSE_PUBLIC_KEY")
            .ok_or_else(|| reject("license public key path is missing"))?;
        if update_key_path == license_key_path {
            return Err(reject("license and update trust roots must be distinct"));
        }
        let update_der = read_ed25519_spki(update_key_path)?;
        let license_der = read_ed25519_spki(license_key_path)?;
        if update_der == license_der {
            return Err(reject("license and update trust roots reuse the same Ed25519 key"));
        }
        let verifying_key = VerifyingKey::from_bytes(
            update_der[12..44].try_into().map_err(|_| reject("invalid Ed25519 SPKI"))?,
        ).map_err(|_| reject("invalid Ed25519 public key"))?;
        let signature_bytes = URL_SAFE_NO_PAD.decode(envelope.signature.as_bytes())
            .map_err(|_| reject("manifest signature is not canonical base64url"))?;
        if signature_bytes.len() != 64 || URL_SAFE_NO_PAD.encode(&signature_bytes) != envelope.signature {
            return Err(reject("manifest signature has invalid length or encoding"));
        }
        let signature = Signature::from_slice(&signature_bytes)
            .map_err(|_| reject("manifest signature has invalid length"))?;
        verifying_key.verify(envelope.payload.as_bytes(), &signature)
            .map_err(|_| reject("manifest Ed25519 signature verification failed"))?;
        let value: Value = serde_json::from_str(&envelope.payload)
            .map_err(|_| reject("signed manifest payload is not JSON"))?;
        if canonical_json(&value)? != envelope.payload {
            return Err(reject("manifest payload is not sorted-json-v1 canonical JSON"));
        }
        let manifest: Manifest = serde_json::from_value(value)
            .map_err(|_| reject("manifest schema is invalid"))?;
        let digest = sha256_bytes(envelope.payload.as_bytes());
        Ok((manifest, digest))
    }

    fn validate_manifest_binding(
        &self,
        handoff: &Handoff,
        manifest: &Manifest,
        digest: &str,
        config: &HostConfig,
    ) -> Result<()> {
        if manifest.schema_version != 1
            || manifest.version != handoff.target_version
            || manifest.channel != handoff.channel
            || digest != handoff.manifest_sha256
            || manifest.migration != handoff.migration
            || !version_in_range(&handoff.current_version, &manifest.min_current_version, &manifest.max_current_version)
        {
            return Err(reject("signed manifest does not match handoff"));
        }
        if compare_version(&manifest.version, &handoff.current_version) != Some(1) {
            return Err(reject("signed manifest target is not newer than installed release"));
        }
        let configured_channel = api_child(config)?.environment.get("LOCAL_UPDATE_CHANNEL")
            .ok_or_else(|| reject("installed update channel is missing"))?;
        if configured_channel != &manifest.channel {
            return Err(reject("signed manifest channel differs from installed channel"));
        }
        validate_manifest_times(&manifest.issued_at, &manifest.expires_at)?;
        let current_schema = current_schema_version(config)?;
        let migration = &manifest.migration;
        if migration.contract_version != 1
            || current_schema < migration.min_current_schema_version
            || current_schema > migration.max_current_schema_version
        {
            return Err(reject("database migration range rejects the installed schema"));
        }
        match migration.mode {
            MigrationMode::None if migration.target_schema_version == current_schema => {}
            MigrationMode::BackwardCompatible | MigrationMode::OfflineRequired => {
                return Err(reject(
                    "schema-changing update rejected: no hash-bound fixed-command migration runner and post-schema proof",
                ));
            }
            _ => return Err(reject("mode=none migration contract must preserve the installed schema")),
        }
        Ok(())
    }

    fn reverify_artifacts(&self, handoff: &Handoff, manifest: &Manifest) -> Result<()> {
        if handoff.artifacts.len() != manifest.artifacts.len() || handoff.artifacts.is_empty() {
            return Err(reject("handoff artifact count differs from signed manifest"));
        }
        let mut names = HashSet::new();
        for (staged, signed) in handoff.artifacts.iter().zip(&manifest.artifacts) {
            if staged.role != signed.role
                || staged.file_name != signed.file_name
                || staged.sha256 != signed.sha256
                || staged.size_bytes != signed.size_bytes
                || signed.platform != "win32-x64"
                || signed.url.is_empty()
                || !is_safe_file_name(&signed.file_name)
                || !names.insert(signed.file_name.to_ascii_lowercase())
                || staged.absolute_path != handoff.stage_directory.join(&staged.file_name)
            {
                return Err(reject("staged artifact metadata differs from signed manifest"));
            }
            let metadata = fs::symlink_metadata(&staged.absolute_path)
                .map_err(|error| HostError::io(staged.absolute_path.display().to_string(), error))?;
            if !metadata.is_file() || metadata.len() != staged.size_bytes {
                return Err(reject("staged artifact is missing, indirect or has wrong size"));
            }
            assert_direct_components(&staged.absolute_path)?;
            assert_direct_tree(&staged.absolute_path)?;
            if sha256_file(&staged.absolute_path)? != staged.sha256 {
                return Err(reject("staged artifact SHA-256 verification failed"));
            }
        }
        Ok(())
    }
}

pub enum PreparedUpdateOutcome {
    NoPending(HostConfig),
    Pending(PreparedUpdate),
}

impl PreparedUpdate {
    pub fn candidate_config(&self) -> HostConfig {
        self.candidate_config.clone()
    }

    pub fn fallback_config(&self) -> HostConfig {
        self.fallback_config.clone()
    }

    pub fn mark_health_checking(&mut self) -> Result<()> {
        self.journal.phase = TransactionPhase::HealthChecking;
        atomic_write_json(&self.coordinator.journal_path, &self.journal)
    }

    pub fn commit(mut self) -> Result<()> {
        self.journal.phase = TransactionPhase::Committed;
        atomic_write_json(&self.coordinator.journal_path, &self.journal)?;
        let result = SupervisorResult {
            result_version: 1,
            command_id: self.journal.command_id.clone(),
            target_version: self.journal.target_version.clone(),
            manifest_sha256: self.journal.manifest_sha256.clone(),
            state: "APPLIED_HEALTHY",
            detail: "signed release activated after stable child health gate".into(),
        };
        atomic_write_json(&self.coordinator.update_root.join(SUPERVISOR_RESULT_FILE), &result)?;
        remove_file_if_exists(&self.coordinator.handoff_path)?;
        remove_directory_if_exists(&self.journal.safety_backup_directory)?;
        remove_file_if_exists(&self.coordinator.journal_path)
    }

    pub fn rollback(self, detail: &str) -> Result<HostConfig> {
        self.coordinator.rollback_journal(&self.journal, detail)?;
        Ok(self.fallback_config)
    }
}

pub fn wait_for_candidate_health(
    config: &HostConfig,
    expected_version: &str,
    external_stop: &AtomicBool,
) -> Result<()> {
    let deadline = Instant::now() + HEALTH_TIMEOUT;
    let mut stable_since = None;
    while Instant::now() < deadline {
        if external_stop.load(Ordering::SeqCst) {
            return Err(reject("candidate health gate cancelled by service stop request"));
        }
        let healthy = tcp_ready(config.network.postgres.port)
            && http_ready(config.network.api.port, "/api/health", "127.0.0.1", Some(expected_version))
            && tcp_ready(config.network.admin.port)
            && tcp_ready(config.network.waiter.port)
            && tcp_ready(config.network.menu.port)
            && gateway_ready(config);
        if healthy {
            let since = stable_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= HEALTH_STABILITY {
                return Ok(());
            }
        } else {
            stable_since = None;
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(reject("candidate failed the 120-second stable child health gate"))
}

fn gateway_ready(config: &HostConfig) -> bool {
    let host = config.children.iter()
        .find(|child| child.name == "lan-gateway")
        .and_then(|child| child.environment.get("GATEWAY_ALLOWED_HOSTS"))
        .map(String::as_str)
        .unwrap_or("127.0.0.1");
    http_ready(config.network.gateway.port, "/__restotm/health", host, None)
}

fn tcp_ready(port: u16) -> bool {
    TcpStream::connect_timeout(
        &SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port),
        Duration::from_secs(1),
    ).is_ok()
}

fn http_ready(port: u16, path: &str, host: &str, expected_version: Option<&str>) -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_secs(1)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(2)));
    if write!(stream, "GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").is_err() {
        return false;
    }
    let mut response = Vec::with_capacity(4096);
    if stream.take(64 * 1024).read_to_end(&mut response).is_err() {
        return false;
    }
    let text = String::from_utf8_lossy(&response);
    if !(text.starts_with("HTTP/1.1 200") || text.starts_with("HTTP/1.0 200")) {
        return false;
    }
    expected_version.map_or(true, |version| {
        text.contains(&format!("\"version\":\"{version}\""))
    })
}

fn extract_canonical_payload(archive_path: &Path, target: &Path) -> Result<()> {
    let file = File::open(archive_path)
        .map_err(|error| HostError::io(archive_path.display().to_string(), error))?;
    let mut archive = ZipArchive::new(file).map_err(|_| reject("windows-payload is not a valid ZIP"))?;
    if archive.len() == 0 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(reject("windows-payload entry count is outside limits"));
    }
    let parent = target.parent().ok_or_else(|| reject("candidate path has no parent"))?;
    let partial = parent.join(format!(".{}.partial", target.file_name().unwrap_or_default().to_string_lossy()));
    if partial.exists() || target.exists() {
        return Err(reject("candidate or partial release directory already exists"));
    }
    fs::create_dir(&partial).map_err(|error| HostError::io(partial.display().to_string(), error))?;
    let result = (|| -> Result<()> {
        let mut total = 0_u64;
        let mut names = HashSet::new();
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|_| reject("ZIP entry cannot be read"))?;
            let enclosed = entry.enclosed_name().ok_or_else(|| reject("ZIP traversal path rejected"))?;
            validate_relative_payload_path(&enclosed)?;
            let folded = enclosed.to_string_lossy().replace('\\', "/").to_ascii_lowercase();
            if !names.insert(folded) {
                return Err(reject("ZIP paths collide under Windows case-insensitive rules"));
            }
            if entry.unix_mode().is_some_and(|mode| mode & 0o170000 == 0o120000) {
                return Err(reject("ZIP symlink entry rejected"));
            }
            total = total.checked_add(entry.size()).ok_or_else(|| reject("ZIP size overflow"))?;
            if total > MAX_EXTRACTED_BYTES {
                return Err(reject("ZIP extracted size exceeds supervisor limit"));
            }
            let destination = partial.join(&enclosed);
            if entry.is_dir() {
                fs::create_dir_all(&destination)
                    .map_err(|error| HostError::io(destination.display().to_string(), error))?;
                continue;
            }
            let directory = destination.parent().ok_or_else(|| reject("ZIP destination has no parent"))?;
            fs::create_dir_all(directory)
                .map_err(|error| HostError::io(directory.display().to_string(), error))?;
            let mut output = OpenOptions::new().create_new(true).write(true).open(&destination)
                .map_err(|error| HostError::io(destination.display().to_string(), error))?;
            std::io::copy(&mut entry, &mut output)
                .map_err(|error| HostError::io(destination.display().to_string(), error))?;
            output.sync_all().map_err(|error| HostError::io(destination.display().to_string(), error))?;
        }
        assert_direct_tree(&partial)?;
        verify_restrictive_update_tree(&partial)?;
        fs::rename(&partial, target)
            .map_err(|error| HostError::io(target.display().to_string(), error))?;
        sync_directory_best_effort(parent);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&partial);
    }
    result
}

fn validate_relative_payload_path(path: &Path) -> Result<()> {
    if path.is_absolute() || path.components().count() == 0 {
        return Err(reject("payload path is not relative"));
    }
    let mut components = path.components();
    let first = components.next().ok_or_else(|| reject("empty payload path"))?;
    let Component::Normal(first) = first else {
        return Err(reject("payload path contains a special component"));
    };
    let allowed = ["api", "admin", "waiter", "menu", "gateway", "print-agent", "postgres"];
    if !allowed.iter().any(|value| first.to_string_lossy().eq_ignore_ascii_case(value)) {
        return Err(reject("payload may contain only canonical child release trees"));
    }
    for component in path.components() {
        let Component::Normal(value) = component else {
            return Err(reject("payload traversal component rejected"));
        };
        let text = value.to_string_lossy();
        if !is_safe_windows_component(&text) {
            return Err(reject("payload contains an unsafe Windows path component"));
        }
    }
    Ok(())
}

fn assert_candidate_contract(base: &HostConfig, candidate: &Path) -> Result<()> {
    assert_direct_tree(candidate)?;
    for child in &base.children {
        let executable = child.executable.strip_prefix(&base.install_root)
            .map_err(|_| reject("base child executable escapes install root"))?;
        let working = child.working_directory.strip_prefix(&base.install_root)
            .map_err(|_| reject("base child working directory escapes install root"))?;
        let candidate_executable = candidate.join(executable);
        let candidate_working = candidate.join(working);
        if !candidate_executable.is_file() || !candidate_working.is_dir() {
            return Err(reject("candidate omits a canonical child executable or working directory"));
        }
    }
    Ok(())
}

fn snapshot_postgres_data(config: &HostConfig, backup: &Path) -> Result<()> {
    let source = config.program_data_root.join("data").join("postgres");
    assert_path_below(&config.program_data_root, &source, "PostgreSQL data")?;
    assert_path_below(&config.program_data_root, backup, "update safety backup")?;
    if backup.exists() {
        return Err(reject("update safety backup already exists"));
    }
    assert_direct_components(&source)?;
    // RuntimeInstance invokes the coordinator before any supervised child is
    // spawned. Refuse the snapshot if a separately launched PostgreSQL still
    // owns the fixed port or if its clean-shutdown marker was not removed.
    if tcp_ready(config.network.postgres.port) || source.join("postmaster.pid").exists() {
        return Err(reject(
            "PostgreSQL is not proven offline; raw update safety snapshot refused",
        ));
    }
    copy_tree_direct(&source, backup)?;
    verify_restrictive_update_tree(backup)
}

fn restore_postgres_snapshot(config: &HostConfig, backup: &Path) -> Result<()> {
    let data = config.program_data_root.join("data").join("postgres");
    assert_path_below(&config.program_data_root, &data, "PostgreSQL restore target")?;
    assert_path_below(&config.program_data_root, backup, "PostgreSQL safety backup")?;
    assert_direct_tree(backup)?;
    let restore = config.program_data_root.join("data").join(".postgres-update-restore");
    let failed = config.program_data_root.join("data").join(".postgres-update-failed");
    if restore.exists() || failed.exists() {
        return Err(reject("PostgreSQL rollback scratch path already exists"));
    }
    copy_tree_direct(backup, &restore)?;
    fs::rename(&data, &failed).map_err(|error| HostError::io(data.display().to_string(), error))?;
    if let Err(error) = fs::rename(&restore, &data) {
        let _ = fs::rename(&failed, &data);
        return Err(HostError::io(data.display().to_string(), error));
    }
    fs::remove_dir_all(&failed).map_err(|error| HostError::io(failed.display().to_string(), error))?;
    sync_directory_best_effort(data.parent().unwrap_or(&config.program_data_root));
    Ok(())
}

fn copy_tree_direct(source: &Path, target: &Path) -> Result<()> {
    assert_direct_tree(source)?;
    fs::create_dir(target).map_err(|error| HostError::io(target.display().to_string(), error))?;
    let result = (|| -> Result<()> {
        for entry in fs::read_dir(source).map_err(|error| HostError::io(source.display().to_string(), error))? {
            let entry = entry.map_err(|error| HostError::io(source.display().to_string(), error))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| HostError::io(entry.path().display().to_string(), error))?;
            let destination = target.join(entry.file_name());
            if metadata.is_dir() {
                copy_tree_direct(&entry.path(), &destination)?;
            } else if metadata.is_file() {
                fs::copy(entry.path(), &destination)
                    .map_err(|error| HostError::io(destination.display().to_string(), error))?;
                File::open(&destination)
                    .and_then(|file| file.sync_all())
                    .map_err(|error| HostError::io(destination.display().to_string(), error))?;
            } else {
                return Err(reject("reparse/symlink/special file in copied data tree"));
            }
        }
        sync_directory_best_effort(target);
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(target);
    }
    result
}

fn assert_direct_tree(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| HostError::io(path.display().to_string(), error))?;
    if metadata.file_type().is_symlink() || is_windows_reparse(&metadata) {
        return Err(reject("junction/reparse/symlink path rejected"));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(path).map_err(|error| HostError::io(path.display().to_string(), error))? {
            assert_direct_tree(&entry.map_err(|error| HostError::io(path.display().to_string(), error))?.path())?;
        }
    }
    Ok(())
}

fn assert_direct_components(path: &Path) -> Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if !current.exists() { continue; }
        let metadata = fs::symlink_metadata(&current)
            .map_err(|error| HostError::io(current.display().to_string(), error))?;
        if metadata.file_type().is_symlink() || is_windows_reparse(&metadata) {
            return Err(reject("junction/reparse/symlink path component rejected"));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn is_windows_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_windows_reparse(_metadata: &fs::Metadata) -> bool { false }

#[cfg(windows)]
fn verify_restrictive_update_tree(path: &Path) -> Result<()> {
    crate::native_provisioning::verify_restrictive_tree(path)
}

#[cfg(not(windows))]
fn verify_restrictive_update_tree(_path: &Path) -> Result<()> { Ok(()) }

fn atomic_write_json<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().ok_or_else(|| reject("state path has no parent"))?;
    fs::create_dir_all(parent).map_err(|error| HostError::io(parent.display().to_string(), error))?;
    assert_direct_tree(parent)?;
    let temporary = parent.join(format!(".{}.partial", path.file_name().unwrap_or_default().to_string_lossy()));
    if temporary.exists() {
        return Err(reject("stale atomic state temporary file requires reconciliation"));
    }
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|error| HostError::json(path.display().to_string(), error))?;
    let mut file = OpenOptions::new().create_new(true).write(true).open(&temporary)
        .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
    file.write_all(&bytes).and_then(|_| file.sync_all())
        .map_err(|error| HostError::io(temporary.display().to_string(), error))?;
    #[cfg(windows)]
    replace_file_write_through(&temporary, path)?;
    #[cfg(not(windows))]
    fs::rename(&temporary, path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    sync_directory_best_effort(parent);
    Ok(())
}

#[cfg(windows)]
fn replace_file_write_through(source: &Path, target: &Path) -> Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH};
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target_wide: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let moved = unsafe { MoveFileExW(source_wide.as_ptr(), target_wide.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
    if moved == 0 {
        return Err(HostError::io(target.display().to_string(), std::io::Error::last_os_error()));
    }
    Ok(())
}

fn read_json_limited<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| HostError::io(path.display().to_string(), error))?;
    if !metadata.is_file() || metadata.len() > MAX_JSON_BYTES || metadata.file_type().is_symlink() || is_windows_reparse(&metadata) {
        return Err(reject("JSON state file is missing, indirect or too large"));
    }
    let bytes = fs::read(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    serde_json::from_slice(&bytes).map_err(|error| HostError::json(path.display().to_string(), error))
}

fn read_optional_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>> {
    if !path.exists() { return Ok(None); }
    read_json_limited(path).map(Some)
}

fn read_ed25519_spki(path: &Path) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| HostError::io(path.display().to_string(), error))?;
    if !metadata.is_file() || metadata.len() > 64 * 1024 || metadata.file_type().is_symlink() || is_windows_reparse(&metadata) {
        return Err(reject("public key file is missing, indirect or too large"));
    }
    let pem = fs::read_to_string(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    if pem.contains("PRIVATE KEY") || !pem.contains("-----BEGIN PUBLIC KEY-----") || !pem.contains("-----END PUBLIC KEY-----") {
        return Err(reject("trust root must be a public-key PEM"));
    }
    let body: String = pem.lines().filter(|line| !line.starts_with("-----")).collect();
    let der = STANDARD.decode(body.as_bytes()).map_err(|_| reject("public key PEM base64 is invalid"))?;
    const ED25519_SPKI_PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
    if der.len() != 44 || der[..12] != ED25519_SPKI_PREFIX {
        return Err(reject("trust root is not an Ed25519 SubjectPublicKeyInfo"));
    }
    Ok(der)
}

fn canonical_json(value: &Value) -> Result<String> {
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) | Value::String(_) => {
            serde_json::to_string(value).map_err(|error| HostError::json("canonical manifest", error))
        }
        Value::Array(values) => {
            let items = values.iter().map(canonical_json).collect::<Result<Vec<_>>>()?;
            Ok(format!("[{}]", items.join(",")))
        }
        Value::Object(values) => {
            let sorted: BTreeMap<&String, &Value> = values.iter().collect();
            let mut pairs = Vec::with_capacity(sorted.len());
            for (key, value) in sorted {
                let key = serde_json::to_string(key)
                    .map_err(|error| HostError::json("canonical manifest key", error))?;
                pairs.push(format!("{key}:{}", canonical_json(value)?));
            }
            Ok(format!("{{{}}}", pairs.join(",")))
        }
    }
}

fn validate_manifest_times(issued_at: &str, expires_at: &str) -> Result<()> {
    let issued = OffsetDateTime::parse(issued_at, &Rfc3339)
        .map_err(|_| reject("manifest issuedAt is not RFC3339"))?;
    let expires = OffsetDateTime::parse(expires_at, &Rfc3339)
        .map_err(|_| reject("manifest expiresAt is not RFC3339"))?;
    let now = OffsetDateTime::now_utc();
    if issued > now + time::Duration::minutes(5)
        || expires <= now
        || expires <= issued
        || expires - issued > time::Duration::days(31)
    {
        return Err(reject("manifest time window is expired, future-dated or too long"));
    }
    Ok(())
}

fn sha256_file(path: &Path) -> Result<String> {
    let mut file = File::open(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 128 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| HostError::io(path.display().to_string(), error))?;
        if read == 0 { break; }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

fn current_version(config: &HostConfig) -> Result<String> {
    let value = api_child(config)?.environment.get("APP_VERSION")
        .ok_or_else(|| reject("local API APP_VERSION is required by update supervisor"))?;
    if !is_safe_version(value) { return Err(reject("local API APP_VERSION is invalid")); }
    Ok(value.clone())
}

fn current_schema_version(config: &HostConfig) -> Result<u32> {
    api_child(config)?.environment.get("LOCAL_UPDATE_DATABASE_SCHEMA_VERSION")
        .ok_or_else(|| reject("installed database schema version is missing"))?
        .parse().map_err(|_| reject("installed database schema version is invalid"))
}

fn api_child(config: &HostConfig) -> Result<&crate::config::ChildSpec> {
    config.children.iter().find(|child| child.name == "local-api")
        .ok_or_else(|| reject("canonical local-api child is missing"))
}

fn required_environment_path(child: &crate::config::ChildSpec, name: &str) -> Result<PathBuf> {
    child.environment.get(name).map(PathBuf::from)
        .ok_or_else(|| reject(format!("{name} is missing from local-api environment")))
}

fn remap_environment_path(
    environment: &mut BTreeMap<String, String>,
    name: &str,
    install_root: &Path,
    release_root: &Path,
) -> Result<()> {
    let old = PathBuf::from(environment.get(name).ok_or_else(|| reject(format!("{name} missing")))?);
    let relative = old.strip_prefix(install_root).map_err(|_| reject(format!("{name} escapes install root")))?;
    environment.insert(name.into(), release_root.join(relative).display().to_string());
    Ok(())
}

fn assert_path_below(root: &Path, path: &Path, label: &str) -> Result<()> {
    if path == root || !path.starts_with(root) || path.components().any(|part| matches!(part, Component::ParentDir | Component::CurDir)) {
        return Err(reject(format!("{label} must be a clean child of its fixed root")));
    }
    Ok(())
}

fn assert_direct_child(root: &Path, path: &Path, label: &str) -> Result<()> {
    assert_path_below(root, path, label)?;
    assert_direct_components(root)?;
    assert_direct_components(path)?;
    let relative = path.strip_prefix(root).map_err(|_| reject(format!("{label} escapes root")))?;
    if relative.components().count() != 1 {
        return Err(reject(format!("{label} must be an immediate child")));
    }
    assert_direct_tree(path)
}

fn is_safe_file_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.ends_with('.')
        && !value.chars().any(|character| ['/', '\\', ':'].contains(&character))
        && is_safe_windows_component(value)
}

fn is_safe_windows_component(value: &str) -> bool {
    if value.is_empty()
        || value.ends_with(['.', ' '])
        || value.chars().any(|character| ['<', '>', ':', '"', '/', '\\', '|', '?', '*', '\0'].contains(&character))
    {
        return false;
    }
    let stem = value.split('.').next().unwrap_or_default().to_ascii_lowercase();
    !matches!(stem.as_str(), "con" | "prn" | "aux" | "nul" | "com1" | "com2" | "com3" | "com4" | "com5" | "com6" | "com7" | "com8" | "com9" | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6" | "lpt7" | "lpt8" | "lpt9")
}

fn is_uuid_like(value: &str) -> bool {
    value.len() == 36 && value.chars().enumerate().all(|(index, ch)| {
        if [8, 13, 18, 23].contains(&index) { ch == '-' } else { ch.is_ascii_hexdigit() }
    })
}

fn is_safe_version(value: &str) -> bool {
    if value.is_empty() || value.len() > 128 || value.contains('+') { return false; }
    let (core, pre) = value.split_once('-').map_or((value, None), |(a, b)| (a, Some(b)));
    let parts: Vec<_> = core.split('.').collect();
    parts.len() == 3
        && parts.iter().all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()) && (part == &"0" || !part.starts_with('0')))
        && pre.map_or(true, |pre| !pre.is_empty() && pre.split('.').all(|part| {
            !part.is_empty()
                && part.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
                && (!part.chars().all(|ch| ch.is_ascii_digit()) || part == "0" || !part.starts_with('0'))
        }))
}

fn version_in_range(version: &str, minimum: &str, maximum: &str) -> bool {
    compare_version(version, minimum).is_some_and(|order| order >= 0)
        && compare_version(version, maximum).is_some_and(|order| order <= 0)
}

fn compare_version(left: &str, right: &str) -> Option<i8> {
    if !is_safe_version(left) || !is_safe_version(right) { return None; }
    fn parse(value: &str) -> Option<([u64; 3], Vec<&str>)> {
        let (core, pre) = value.split_once('-').map_or((value, ""), |parts| parts);
        let numbers: Vec<u64> = core.split('.').map(str::parse).collect::<std::result::Result<_, _>>().ok()?;
        Some(([numbers[0], numbers[1], numbers[2]], if pre.is_empty() { vec![] } else { pre.split('.').collect() }))
    }
    let (a, apre) = parse(left)?;
    let (b, bpre) = parse(right)?;
    for index in 0..3 {
        if a[index] != b[index] { return Some(if a[index] < b[index] { -1 } else { 1 }); }
    }
    if apre.is_empty() || bpre.is_empty() {
        return Some(match (apre.is_empty(), bpre.is_empty()) { (true, true) => 0, (true, false) => 1, _ => -1 });
    }
    for index in 0..apre.len().max(bpre.len()) {
        let Some(av) = apre.get(index) else { return Some(-1); };
        let Some(bv) = bpre.get(index) else { return Some(1); };
        if av == bv { continue; }
        let an = av.parse::<u64>();
        let bn = bv.parse::<u64>();
        return Some(match (an, bn) {
            (Ok(a), Ok(b)) => if a < b { -1 } else { 1 },
            (Ok(_), Err(_)) => -1,
            (Err(_), Ok(_)) => 1,
            _ => if av < bv { -1 } else { 1 },
        });
    }
    Some(0)
}

fn is_lower_hex(value: &str) -> bool { value.chars().all(|ch| ch.is_ascii_digit() || ('a'..='f').contains(&ch)) }

fn remove_file_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => { sync_directory_best_effort(path.parent().unwrap_or(Path::new("."))); Ok(()) }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(HostError::io(path.display().to_string(), error)),
    }
}

fn remove_directory_if_exists(path: &Path) -> Result<()> {
    match fs::remove_dir_all(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(HostError::io(path.display().to_string(), error)),
    }
}

fn sync_directory_best_effort(path: &Path) {
    if let Ok(directory) = File::open(path) { let _ = directory.sync_all(); }
}

fn sanitize_detail(value: &str) -> String {
    value.chars().filter(|ch| !ch.is_control()).take(512).collect()
}

fn reject(message: impl Into<String>) -> HostError { HostError::UpdateRejected(message.into()) }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_comparison_is_deterministic() {
        assert_eq!(compare_version("1.2.0", "1.1.9"), Some(1));
        assert_eq!(compare_version("1.2.0-rc.1", "1.2.0"), Some(-1));
        assert_eq!(compare_version("1.2.0-1", "1.2.0-alpha"), Some(-1));
        assert!(!is_safe_version("01.2.3"));
        assert!(!is_safe_version("1.2.3+ambiguous"));
    }

    #[test]
    fn windows_names_and_canonical_json_are_strict() {
        assert!(!is_safe_windows_component("CON.zip"));
        assert!(!is_safe_windows_component("payload. "));
        assert!(is_safe_windows_component("restotm-update.zip"));
        let value: Value = serde_json::from_str(r#"{"z":1,"a":{"b":2,"a":1}}"#).unwrap();
        assert_eq!(canonical_json(&value).unwrap(), r#"{"a":{"a":1,"b":2},"z":1}"#);
    }
}
