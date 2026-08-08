use crate::error::{HostError, Result};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::Arc;
use zeroize::Zeroizing;

const DPAPI_PREFIX: &str = "dpapi-local-machine-v1:";

pub trait SecretProvider: Send + Sync {
    fn resolve(&self, reference: &str) -> Result<Zeroizing<String>>;
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SecretStoreDocument {
    schema_version: u32,
    protection: String,
    values: BTreeMap<String, String>,
}

pub struct DpapiSecretProvider {
    values: BTreeMap<String, String>,
}

impl DpapiSecretProvider {
    pub fn from_verified_bytes(bytes: &[u8]) -> Result<Arc<dyn SecretProvider>> {
        let document: SecretStoreDocument = serde_json::from_slice(bytes)
            .map_err(|error| HostError::json("verified secret store", error))?;
        if document.schema_version != 1 || document.protection != "dpapi-local-machine-v1" {
            return Err(HostError::InvalidSecretStore(
                "schema/protection must be dpapi-local-machine-v1".into(),
            ));
        }
        if document.values.is_empty() {
            return Err(HostError::InvalidSecretStore(
                "secret store cannot be empty".into(),
            ));
        }
        for (name, envelope) in &document.values {
            if name.is_empty()
                || !name
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
                || !envelope.starts_with(DPAPI_PREFIX)
            {
                return Err(HostError::InvalidSecretStore(format!(
                    "invalid secret entry: {name}"
                )));
            }
        }
        Ok(Arc::new(Self {
            values: document.values,
        }))
    }
}

impl SecretProvider for DpapiSecretProvider {
    fn resolve(&self, reference: &str) -> Result<Zeroizing<String>> {
        let envelope = self
            .values
            .get(reference)
            .ok_or_else(|| HostError::SecretUnavailable(reference.into()))?;
        let encrypted = STANDARD
            .decode(&envelope[DPAPI_PREFIX.len()..])
            .map_err(|_| HostError::InvalidSecretStore(format!("invalid base64 for {reference}")))?;
        let clear = Zeroizing::new(crate::platform::dpapi_unprotect(&encrypted)?);
        let value = std::str::from_utf8(clear.as_slice())
            .map_err(|_| HostError::InvalidSecretStore(format!("secret {reference} is not UTF-8")))?
            .to_owned();
        if value.len() < 32 || value.contains('\0') {
            return Err(HostError::InvalidSecretStore(format!(
                "secret {reference} is too short or contains NUL"
            )));
        }
        Ok(Zeroizing::new(value))
    }
}

#[cfg(test)]
pub struct MemorySecretProvider(pub BTreeMap<String, String>);

#[cfg(test)]
impl SecretProvider for MemorySecretProvider {
    fn resolve(&self, reference: &str) -> Result<Zeroizing<String>> {
        self.0
            .get(reference)
            .cloned()
            .map(Zeroizing::new)
            .ok_or_else(|| HostError::SecretUnavailable(reference.into()))
    }
}
