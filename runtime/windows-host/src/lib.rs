pub mod backoff;
pub mod bootstrap;
pub mod config;
pub mod error;
pub mod health;
pub mod logging;
pub mod platform;
pub mod runtime;
pub mod secrets;
pub mod supervisor;

#[cfg(windows)]
pub mod windows_service;

pub const SERVICE_NAME: &str = "RESTOTMRuntime";
pub const CONFIG_SCHEMA_VERSION: u32 = 1;
pub const BOOTSTRAP_RECEIPT_SCHEMA_VERSION: u32 = 1;
pub const ACL_POLICY_VERSION: &str = "restotm-windows-acl-v1";
