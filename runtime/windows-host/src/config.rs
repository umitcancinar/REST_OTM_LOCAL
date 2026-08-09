use crate::error::{HostError, Result};
use crate::CONFIG_SCHEMA_VERSION;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::fs;
use std::net::IpAddr;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct HostConfig {
    pub schema_version: u32,
    pub installation_id: String,
    pub install_root: PathBuf,
    pub program_data_root: PathBuf,
    pub secret_store: PathBuf,
    pub bootstrap_receipt: PathBuf,
    pub health_file: PathBuf,
    pub log_directory: PathBuf,
    pub network: NetworkContract,
    pub restart_policy: RestartPolicy,
    pub children: Vec<ChildSpec>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NetworkContract {
    pub postgres: Endpoint,
    pub api: Endpoint,
    pub admin: Endpoint,
    pub waiter: Endpoint,
    pub menu: Endpoint,
    pub print_agent: Endpoint,
    pub gateway: GatewayEndpoint,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GatewayEndpoint {
    pub host: String,
    pub port: u16,
    pub firewall_profile: String,
    pub remote_scope: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RestartPolicy {
    pub initial_delay_ms: u64,
    pub maximum_delay_ms: u64,
    pub stable_reset_ms: u64,
    pub crash_window_ms: u64,
    pub maximum_crashes_in_window: usize,
    pub crash_loop_quarantine_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ChildSpec {
    pub name: String,
    pub executable: PathBuf,
    pub working_directory: PathBuf,
    #[serde(default)]
    pub arguments: Vec<String>,
    #[serde(default)]
    pub environment: BTreeMap<String, String>,
    #[serde(default)]
    pub file_environment: BTreeMap<String, PathBuf>,
    #[serde(default)]
    pub secret_environment: BTreeMap<String, String>,
    #[serde(default)]
    pub depends_on: Vec<String>,
    pub essential: bool,
    pub shutdown: ShutdownSpec,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum ShutdownSpec {
    Http {
        port: u16,
        path: String,
        token_secret: String,
        grace_ms: u64,
    },
    Terminate {
        grace_ms: u64,
    },
}

impl HostConfig {
    pub fn load(path: &Path) -> Result<(Self, Vec<u8>)> {
        let raw = fs::read(path).map_err(|error| HostError::io(path.display().to_string(), error))?;
        let config: Self = serde_json::from_slice(&raw)
            .map_err(|error| HostError::json(path.display().to_string(), error))?;
        config.validate()?;
        Ok((config, raw))
    }

    pub fn validate(&self) -> Result<()> {
        if self.schema_version != CONFIG_SCHEMA_VERSION {
            return Err(HostError::InvalidConfig(format!(
                "schema_version must be {CONFIG_SCHEMA_VERSION}"
            )));
        }
        if self.installation_id.len() < 32 || self.installation_id.len() > 64 {
            return Err(HostError::InvalidConfig(
                "installation_id must be a persisted UUID-like identifier".into(),
            ));
        }

        assert_absolute_clean("install_root", &self.install_root)?;
        assert_absolute_clean("program_data_root", &self.program_data_root)?;
        if self.install_root.starts_with(&self.program_data_root)
            || self.program_data_root.starts_with(&self.install_root)
        {
            return Err(HostError::InvalidConfig(
                "install_root and program_data_root must be separate trees".into(),
            ));
        }
        assert_path_below("secret_store", &self.program_data_root, &self.secret_store)?;
        assert_path_below(
            "bootstrap_receipt",
            &self.program_data_root,
            &self.bootstrap_receipt,
        )?;
        assert_path_below("health_file", &self.program_data_root, &self.health_file)?;
        assert_path_below("log_directory", &self.program_data_root, &self.log_directory)?;

        if self.secret_store == self.bootstrap_receipt || self.secret_store == self.health_file {
            return Err(HostError::InvalidConfig(
                "secret, bootstrap receipt and health paths must be distinct".into(),
            ));
        }

        self.network.validate()?;
        self.restart_policy.validate()?;
        if self.children.is_empty() {
            return Err(HostError::InvalidConfig(
                "at least one supervised child is required".into(),
            ));
        }

        let mut names = HashSet::new();
        for child in &self.children {
            child.validate(&self.install_root, &self.network)?;
            if !names.insert(child.name.as_str()) {
                return Err(HostError::InvalidConfig(format!(
                    "duplicate child name: {}",
                    child.name
                )));
            }
        }
        for child in &self.children {
            for dependency in &child.depends_on {
                if dependency == &child.name || !names.contains(dependency.as_str()) {
                    return Err(HostError::InvalidConfig(format!(
                        "child {} has invalid dependency {}",
                        child.name, dependency
                    )));
                }
            }
        }
        self.startup_order()?;
        Ok(())
    }

    pub fn startup_order(&self) -> Result<Vec<usize>> {
        let indices: HashMap<&str, usize> = self
            .children
            .iter()
            .enumerate()
            .map(|(index, child)| (child.name.as_str(), index))
            .collect();
        let mut permanent = HashSet::new();
        let mut temporary = HashSet::new();
        let mut order = Vec::with_capacity(self.children.len());

        fn visit(
            index: usize,
            children: &[ChildSpec],
            indices: &HashMap<&str, usize>,
            permanent: &mut HashSet<usize>,
            temporary: &mut HashSet<usize>,
            order: &mut Vec<usize>,
        ) -> Result<()> {
            if permanent.contains(&index) {
                return Ok(());
            }
            if !temporary.insert(index) {
                return Err(HostError::InvalidConfig(format!(
                    "dependency cycle includes {}",
                    children[index].name
                )));
            }
            for dependency in &children[index].depends_on {
                visit(
                    indices[dependency.as_str()],
                    children,
                    indices,
                    permanent,
                    temporary,
                    order,
                )?;
            }
            temporary.remove(&index);
            permanent.insert(index);
            order.push(index);
            Ok(())
        }

        for index in 0..self.children.len() {
            visit(
                index,
                &self.children,
                &indices,
                &mut permanent,
                &mut temporary,
                &mut order,
            )?;
        }
        Ok(order)
    }
}

impl NetworkContract {
    fn validate(&self) -> Result<()> {
        let internal = [
            ("postgres", &self.postgres),
            ("api", &self.api),
            ("admin", &self.admin),
            ("waiter", &self.waiter),
            ("menu", &self.menu),
            ("print_agent", &self.print_agent),
        ];
        let mut ports = BTreeSet::new();
        for (name, endpoint) in internal {
            let address: IpAddr = endpoint.host.parse().map_err(|_| {
                HostError::InvalidConfig(format!("{name} host is not an IP address"))
            })?;
            if !address.is_loopback() {
                return Err(HostError::InvalidConfig(format!(
                    "{name} must bind to loopback, got {}",
                    endpoint.host
                )));
            }
            if endpoint.port < 1024 || !ports.insert(endpoint.port) {
                return Err(HostError::InvalidConfig(format!(
                    "{name} port is privileged or duplicated: {}",
                    endpoint.port
                )));
            }
        }
        if self.postgres.port != 55432
            || self.api.port != 4100
            || self.admin.port != 3100
            || self.waiter.port != 3200
            || self.menu.port != 3300
            || self.print_agent.port != 4300
        {
            return Err(HostError::InvalidConfig(
                "internal ports must match the signed runtime contract".into(),
            ));
        }
        if self.gateway.host != "0.0.0.0"
            || self.gateway.port != 8787
            || self.gateway.firewall_profile != "Private"
            || self.gateway.remote_scope != "LocalSubnet"
            || !ports.insert(self.gateway.port)
        {
            return Err(HostError::InvalidConfig(
                "gateway must be 0.0.0.0:8787 with Private/LocalSubnet firewall contract".into(),
            ));
        }
        Ok(())
    }

    pub fn internal_ports(&self) -> BTreeSet<u16> {
        [
            self.postgres.port,
            self.api.port,
            self.admin.port,
            self.waiter.port,
            self.menu.port,
            self.print_agent.port,
        ]
        .into_iter()
        .collect()
    }
}

impl RestartPolicy {
    fn validate(&self) -> Result<()> {
        if self.initial_delay_ms < 250
            || self.maximum_delay_ms < self.initial_delay_ms
            || self.maximum_delay_ms > 300_000
            || self.stable_reset_ms < self.initial_delay_ms
            || self.crash_window_ms < self.stable_reset_ms
            || self.maximum_crashes_in_window < 2
            || self.crash_loop_quarantine_ms < self.maximum_delay_ms
        {
            return Err(HostError::InvalidConfig(
                "restart policy limits are unsafe or internally inconsistent".into(),
            ));
        }
        Ok(())
    }
}

impl ChildSpec {
    fn validate(&self, install_root: &Path, network: &NetworkContract) -> Result<()> {
        if self.name.is_empty()
            || self.name.len() > 64
            || !self
                .name
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
        {
            return Err(HostError::InvalidConfig(format!(
                "unsafe child name: {}",
                self.name
            )));
        }
        assert_path_below("child executable", install_root, &self.executable)?;
        assert_path_below("child working_directory", install_root, &self.working_directory)?;

        for argument in &self.arguments {
            let lowered = argument.to_ascii_lowercase();
            if [
                "password",
                "secret",
                "private-key",
                "license-key",
                "database-url",
                "database_url",
                "bearer",
            ]
            .iter()
            .any(|needle| lowered.contains(needle))
            {
                return Err(HostError::InvalidConfig(format!(
                    "child {} places a sensitive value/reference in process arguments",
                    self.name
                )));
            }
        }

        for (key, value) in &self.environment {
            validate_environment_key(key)?;
            let lowered_key = key.to_ascii_lowercase();
            if ["secret", "password", "token", "private_key", "database_url"]
                .iter()
                .any(|needle| lowered_key.contains(needle))
                || value.contains("BEGIN PRIVATE KEY")
            {
                return Err(HostError::InvalidConfig(format!(
                    "child {} must reference sensitive environment through secret_environment",
                    self.name
                )));
            }
        }
        for (key, secret_reference) in &self.secret_environment {
            validate_environment_key(key)?;
            if self.environment.contains_key(key)
                || secret_reference.is_empty()
                || !secret_reference
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
            {
                return Err(HostError::InvalidConfig(format!(
                    "child {} has invalid secret environment mapping",
                    self.name
                )));
            }
        }
        for (key, file_path) in &self.file_environment {
            validate_environment_key(key)?;
            if self.environment.contains_key(key) || self.secret_environment.contains_key(key) {
                return Err(HostError::InvalidConfig(format!(
                    "child {} maps environment key {} more than once",
                    self.name, key
                )));
            }
            assert_path_below("child file environment", install_root, file_path)?;
        }

        match &self.shutdown {
            ShutdownSpec::Http {
                port,
                path,
                token_secret,
                grace_ms,
            } => {
                if !network.internal_ports().contains(port)
                    || !path.starts_with('/')
                    || path.contains('\r')
                    || path.contains('\n')
                    || token_secret.is_empty()
                    || !(1_000..=120_000).contains(grace_ms)
                {
                    return Err(HostError::InvalidConfig(format!(
                        "child {} has unsafe HTTP shutdown contract",
                        self.name
                    )));
                }
            }
            ShutdownSpec::Terminate { grace_ms } => {
                if !(250..=30_000).contains(grace_ms) {
                    return Err(HostError::InvalidConfig(format!(
                        "child {} has unsafe terminate grace period",
                        self.name
                    )));
                }
            }
        }
        Ok(())
    }
}

fn assert_absolute_clean(label: &str, path: &Path) -> Result<()> {
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
    {
        return Err(HostError::InvalidConfig(format!(
            "{label} must be an absolute normalized path"
        )));
    }
    Ok(())
}

fn assert_path_below(label: &str, root: &Path, candidate: &Path) -> Result<()> {
    assert_absolute_clean(label, candidate)?;
    if candidate == root || candidate.strip_prefix(root).is_err() {
        return Err(HostError::InvalidConfig(format!(
            "{label} must be below {}",
            root.display()
        )));
    }
    Ok(())
}

fn validate_environment_key(key: &str) -> Result<()> {
    if key.is_empty()
        || key.len() > 128
        || !key.chars().all(|character| {
            character.is_ascii_uppercase() || character.is_ascii_digit() || character == '_'
        })
    {
        return Err(HostError::InvalidConfig(format!(
            "invalid environment variable name: {key}"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config(root: &Path) -> HostConfig {
        let install = root.join("program-files/restotm");
        let data = root.join("program-data/restotm");
        HostConfig {
            schema_version: 1,
            installation_id: "11111111-2222-3333-4444-555555555555".into(),
            install_root: install.clone(),
            program_data_root: data.clone(),
            secret_store: data.join("config/secrets.json"),
            bootstrap_receipt: data.join("config/bootstrap-receipt.json"),
            health_file: data.join("runtime/health.json"),
            log_directory: data.join("logs"),
            network: NetworkContract {
                postgres: Endpoint { host: "127.0.0.1".into(), port: 55432 },
                api: Endpoint { host: "127.0.0.1".into(), port: 4100 },
                admin: Endpoint { host: "127.0.0.1".into(), port: 3100 },
                waiter: Endpoint { host: "127.0.0.1".into(), port: 3200 },
                menu: Endpoint { host: "127.0.0.1".into(), port: 3300 },
                print_agent: Endpoint { host: "127.0.0.1".into(), port: 4300 },
                gateway: GatewayEndpoint {
                    host: "0.0.0.0".into(),
                    port: 8787,
                    firewall_profile: "Private".into(),
                    remote_scope: "LocalSubnet".into(),
                },
            },
            restart_policy: RestartPolicy {
                initial_delay_ms: 1_000,
                maximum_delay_ms: 60_000,
                stable_reset_ms: 120_000,
                crash_window_ms: 600_000,
                maximum_crashes_in_window: 5,
                crash_loop_quarantine_ms: 300_000,
            },
            children: vec![ChildSpec {
                name: "postgres".into(),
                executable: install.join("postgres/bin/postgres.exe"),
                working_directory: install.join("postgres/bin"),
                arguments: vec!["--config-file".into(), data.join("postgresql.conf").display().to_string()],
                environment: BTreeMap::new(),
                file_environment: BTreeMap::new(),
                secret_environment: BTreeMap::new(),
                depends_on: vec![],
                essential: true,
                shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
            }],
        }
    }

    #[test]
    fn accepts_loopback_only_contract() {
        let temporary = tempfile::tempdir().unwrap();
        valid_config(temporary.path()).validate().unwrap();
    }

    #[test]
    fn rejects_lan_postgres_binding() {
        let temporary = tempfile::tempdir().unwrap();
        let mut config = valid_config(temporary.path());
        config.network.postgres.host = "0.0.0.0".into();
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_secrets_in_arguments() {
        let temporary = tempfile::tempdir().unwrap();
        let mut config = valid_config(temporary.path());
        config.children[0].arguments.push("--password=<redacted>".into());
        assert!(config.validate().is_err());
    }

    #[test]
    fn rejects_dependency_cycle() {
        let temporary = tempfile::tempdir().unwrap();
        let mut config = valid_config(temporary.path());
        let install = config.install_root.clone();
        config.children[0].depends_on = vec!["api".into()];
        config.children.push(ChildSpec {
            name: "api".into(),
            executable: install.join("api/api.exe"),
            working_directory: install.join("api"),
            arguments: vec![],
            environment: BTreeMap::new(),
            file_environment: BTreeMap::new(),
            secret_environment: BTreeMap::new(),
            depends_on: vec!["postgres".into()],
            essential: true,
            shutdown: ShutdownSpec::Terminate { grace_ms: 5_000 },
        });
        assert!(config.validate().is_err());
    }
}
