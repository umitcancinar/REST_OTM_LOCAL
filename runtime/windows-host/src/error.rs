use std::io;

#[derive(Debug, thiserror::Error)]
pub enum HostError {
    #[error("configuration rejected: {0}")]
    InvalidConfig(String),

    #[error("bootstrap proof rejected: {0}")]
    InvalidBootstrap(String),

    #[error("secret store rejected: {0}")]
    InvalidSecretStore(String),

    #[error("secret is unavailable: {0}")]
    SecretUnavailable(String),

    #[error("child process {name} failed: {message}")]
    ChildProcess { name: String, message: String },

    #[error("essential child entered crash loop: {0}")]
    CrashLoop(String),

    #[error("signed update rejected: {0}")]
    UpdateRejected(String),

    #[error("unsupported platform operation: {0}")]
    UnsupportedPlatform(String),

    #[error("I/O failure at {context}: {source}")]
    Io {
        context: String,
        #[source]
        source: io::Error,
    },

    #[error("JSON failure at {context}: {source}")]
    Json {
        context: String,
        #[source]
        source: serde_json::Error,
    },

    #[cfg(windows)]
    #[error("Windows service failure: {0}")]
    WindowsService(#[from] windows_service::Error),
}

impl HostError {
    pub fn io(context: impl Into<String>, source: io::Error) -> Self {
        Self::Io {
            context: context.into(),
            source,
        }
    }

    pub fn json(context: impl Into<String>, source: serde_json::Error) -> Self {
        Self::Json {
            context: context.into(),
            source,
        }
    }
}

pub type Result<T> = std::result::Result<T, HostError>;
