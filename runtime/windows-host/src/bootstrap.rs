use crate::config::HostConfig;
use crate::error::{HostError, Result};
use crate::{ACL_POLICY_VERSION, BOOTSTRAP_RECEIPT_SCHEMA_VERSION};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BootstrapReceipt {
    pub schema_version: u32,
    pub installation_id: String,
    pub config_sha256: String,
    pub secret_store_sha256: String,
    pub acl_policy_version: String,
    pub completed_at_unix_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BootstrapRequest {
    pub install_root: PathBuf,
    pub program_data_root: PathBuf,
    pub license_server_url: String,
    pub postgres_port: u16,
    pub api_port: u16,
    pub admin_port: u16,
    pub waiter_port: u16,
    pub print_port: u16,
    pub gateway_port: u16,
}

pub struct VerifiedBootstrap {
    pub config: HostConfig,
    pub config_bytes: Vec<u8>,
    pub secret_store_bytes: Vec<u8>,
}

pub trait BootstrapBackend {
    fn provision(&self, request: &BootstrapRequest) -> Result<()>;
}

pub struct UnavailableBootstrapBackend;

impl BootstrapBackend for UnavailableBootstrapBackend {
    fn provision(&self, _request: &BootstrapRequest) -> Result<()> {
        Err(HostError::UnsupportedPlatform(
            "native ACL + DPAPI provisioning backend is not production-complete; refusing success"
                .into(),
        ))
    }
}

impl BootstrapRequest {
    pub fn parse(arguments: impl IntoIterator<Item = OsString>) -> Result<Self> {
        let mut arguments = arguments.into_iter();
        let operation = arguments
            .next()
            .and_then(|value| value.into_string().ok())
            .ok_or_else(|| HostError::InvalidBootstrap("missing operation".into()))?;
        if operation != "provision" {
            return Err(HostError::InvalidBootstrap(
                "only the provision operation is accepted".into(),
            ));
        }

        let mut values = BTreeMap::new();
        while let Some(flag) = arguments.next() {
            let flag = flag
                .into_string()
                .map_err(|_| HostError::InvalidBootstrap("flag is not valid UTF-8".into()))?;
            if !flag.starts_with("--") || flag.len() < 3 {
                return Err(HostError::InvalidBootstrap(format!("invalid flag: {flag}")));
            }
            let value = arguments
                .next()
                .ok_or_else(|| HostError::InvalidBootstrap(format!("missing value for {flag}")))?
                .into_string()
                .map_err(|_| HostError::InvalidBootstrap(format!("invalid value for {flag}")))?;
            if values.insert(flag.clone(), value).is_some() {
                return Err(HostError::InvalidBootstrap(format!("duplicate flag: {flag}")));
            }
        }

        let mut take = |name: &str| {
            values
                .remove(name)
                .ok_or_else(|| HostError::InvalidBootstrap(format!("missing required flag: {name}")))
        };
        let request = Self {
            install_root: PathBuf::from(take("--install-root")?),
            program_data_root: PathBuf::from(take("--program-data-root")?),
            license_server_url: take("--license-server-url")?,
            postgres_port: parse_port("--postgres-port", &take("--postgres-port")?)?,
            api_port: parse_port("--api-port", &take("--api-port")?)?,
            admin_port: parse_port("--admin-port", &take("--admin-port")?)?,
            waiter_port: parse_port("--waiter-port", &take("--waiter-port")?)?,
            print_port: parse_port("--print-port", &take("--print-port")?)?,
            gateway_port: parse_port("--gateway-port", &take("--gateway-port")?)?,
        };
        if !values.is_empty() {
            return Err(HostError::InvalidBootstrap(format!(
                "unknown flags: {}",
                values.keys().cloned().collect::<Vec<_>>().join(", ")
            )));
        }
        request.validate()?;
        Ok(request)
    }

    pub fn validate(&self) -> Result<()> {
        validate_lexical_path("install_root", &self.install_root)?;
        validate_lexical_path("program_data_root", &self.program_data_root)?;
        let lowered_url = self.license_server_url.to_ascii_lowercase();
        if !lowered_url.starts_with("https://")
            || self.license_server_url.len() > 2048
            || self.license_server_url.contains('\r')
            || self.license_server_url.contains('\n')
            || self.license_server_url.contains('\t')
            || self.license_server_url.contains(' ')
            || self.license_server_url.contains('@')
            || self.license_server_url.contains('?')
            || self.license_server_url.contains('#')
        {
            return Err(HostError::InvalidBootstrap(
                "license server must be a credential/query-free HTTPS URL".into(),
            ));
        }
        let ports = [
            self.postgres_port,
            self.api_port,
            self.admin_port,
            self.waiter_port,
            self.print_port,
            self.gateway_port,
        ];
        if ports.iter().any(|port| *port < 1024)
            || ports.into_iter().collect::<BTreeSet<_>>().len() != ports.len()
            || self.postgres_port != 55432
            || self.gateway_port != 8787
        {
            return Err(HostError::InvalidBootstrap(
                "ports are privileged, duplicated or violate the fixed PostgreSQL/gateway contract"
                    .into(),
            ));
        }
        Ok(())
    }
}

pub fn run_bootstrap(
    arguments: impl IntoIterator<Item = OsString>,
    backend: &dyn BootstrapBackend,
) -> Result<()> {
    let request = BootstrapRequest::parse(arguments)?;
    backend.provision(&request)
}

pub fn load_verified_bootstrap(config_path: &Path) -> Result<VerifiedBootstrap> {
    let (config, config_bytes) = HostConfig::load(config_path)?;
    let secret_store_bytes = fs::read(&config.secret_store)
        .map_err(|error| HostError::io(config.secret_store.display().to_string(), error))?;
    let receipt_bytes = fs::read(&config.bootstrap_receipt)
        .map_err(|error| HostError::io(config.bootstrap_receipt.display().to_string(), error))?;
    let receipt: BootstrapReceipt = serde_json::from_slice(&receipt_bytes)
        .map_err(|error| HostError::json(config.bootstrap_receipt.display().to_string(), error))?;

    if receipt.schema_version != BOOTSTRAP_RECEIPT_SCHEMA_VERSION
        || receipt.installation_id != config.installation_id
        || receipt.acl_policy_version != ACL_POLICY_VERSION
        || !is_sha256(&receipt.config_sha256)
        || !is_sha256(&receipt.secret_store_sha256)
        || !receipt
            .config_sha256
            .eq_ignore_ascii_case(&sha256_hex(&config_bytes))
        || !receipt
            .secret_store_sha256
            .eq_ignore_ascii_case(&sha256_hex(&secret_store_bytes))
    {
        return Err(HostError::InvalidBootstrap(
            "receipt does not bind the installation, config, secret store and ACL policy".into(),
        ));
    }

    Ok(VerifiedBootstrap {
        config,
        config_bytes,
        secret_store_bytes,
    })
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn parse_port(name: &str, value: &str) -> Result<u16> {
    value
        .parse::<u16>()
        .map_err(|_| HostError::InvalidBootstrap(format!("invalid port for {name}")))
}

fn validate_lexical_path(label: &str, path: &Path) -> Result<()> {
    let text = path.to_string_lossy();
    let normalized = text.replace('\\', "/");
    if text.is_empty()
        || normalized.split('/').any(|segment| segment == "..")
        || normalized.contains('\0')
    {
        return Err(HostError::InvalidBootstrap(format!(
            "{label} is empty or contains traversal"
        )));
    }
    #[cfg(windows)]
    if !path.is_absolute() {
        return Err(HostError::InvalidBootstrap(format!(
            "{label} must be absolute on Windows"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct RecordingBackend(std::sync::Mutex<usize>);

    impl BootstrapBackend for RecordingBackend {
        fn provision(&self, _: &BootstrapRequest) -> Result<()> {
            *self.0.lock().unwrap() += 1;
            Ok(())
        }
    }

    fn valid_arguments() -> Vec<OsString> {
        [
            "provision",
            "--install-root",
            "C:\\Program Files\\RESTOTM",
            "--program-data-root",
            "C:\\ProgramData\\RESTOTM",
            "--license-server-url",
            "https://license.example.test",
            "--postgres-port",
            "55432",
            "--api-port",
            "4100",
            "--admin-port",
            "3100",
            "--waiter-port",
            "3200",
            "--print-port",
            "4300",
            "--gateway-port",
            "8787",
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }

    #[test]
    fn accepts_exact_installer_contract() {
        let backend = RecordingBackend(std::sync::Mutex::new(0));
        run_bootstrap(valid_arguments(), &backend).unwrap();
        assert_eq!(*backend.0.lock().unwrap(), 1);
    }

    #[test]
    fn rejects_unknown_or_duplicate_flags() {
        let mut arguments = valid_arguments();
        arguments.extend([OsString::from("--gateway-port"), OsString::from("8787")]);
        assert!(BootstrapRequest::parse(arguments).is_err());
    }

    #[test]
    fn unavailable_backend_never_returns_false_success() {
        assert!(run_bootstrap(valid_arguments(), &UnavailableBootstrapBackend).is_err());
    }
}
