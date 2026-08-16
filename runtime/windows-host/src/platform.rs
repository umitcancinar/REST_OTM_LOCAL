use crate::error::{HostError, Result};
use std::path::Path;
use std::process::{Child, Command, ExitStatus};

pub struct ManagedChild {
    child: Child,
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
}

// SAFETY: `job` is an opaque Windows kernel object handle (an integer-like
// identifier), not a pointer into process memory. Handles are valid to use
// and close from any thread, so it is safe to move `ManagedChild` across
// threads even though `HANDLE` is FFI-typed as a raw pointer.
#[cfg(windows)]
unsafe impl Send for ManagedChild {}

/// Replaces a durable state file without first creating a window where the
/// destination does not exist. Windows' standard `rename` does not replace an
/// existing file, so use the native write-through primitive there.
pub fn atomic_replace(source: &Path, destination: &Path) -> Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };

        let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination_wide: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        let result = unsafe {
            MoveFileExW(
                source_wide.as_ptr(),
                destination_wide.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        };
        if result == 0 {
            return Err(HostError::io(
                destination.display().to_string(),
                std::io::Error::last_os_error(),
            ));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        std::fs::rename(source, destination)
            .map_err(|error| HostError::io(destination.display().to_string(), error))
    }
}

impl ManagedChild {
    pub fn spawn(command: &mut Command) -> Result<Self> {
        #[cfg(windows)]
        {
            spawn_windows(command)
        }
        #[cfg(not(windows))]
        {
            command
                .spawn()
                .map(|child| Self { child })
                .map_err(|error| HostError::io("spawn child process", error))
        }
    }

    pub fn id(&self) -> u32 {
        self.child.id()
    }

    pub fn try_wait(&mut self) -> Result<Option<ExitStatus>> {
        self.child
            .try_wait()
            .map_err(|error| HostError::io("poll child process", error))
    }

    pub fn terminate_tree(&mut self) -> Result<()> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::JobObjects::TerminateJobObject;
            if TerminateJobObject(self.job, 1) == 0 {
                return Err(HostError::io(
                    "terminate Windows job object",
                    std::io::Error::last_os_error(),
                ));
            }
            Ok(())
        }
        #[cfg(not(windows))]
        {
            self.child
                .kill()
                .map_err(|error| HostError::io("terminate child process", error))
        }
    }

    pub fn wait(&mut self) -> Result<ExitStatus> {
        self.child
            .wait()
            .map_err(|error| HostError::io("wait for child process", error))
    }
}

#[cfg(windows)]
impl Drop for ManagedChild {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

#[cfg(windows)]
fn spawn_windows(command: &mut Command) -> Result<ManagedChild> {
    use std::mem::{size_of, zeroed};
    use std::os::windows::io::AsRawHandle;
    use std::os::windows::process::CommandExt;
    use std::ptr::null;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};

    unsafe {
        let job = CreateJobObjectW(null(), null());
        if job.is_null() {
            return Err(HostError::io(
                "create Windows job object",
                std::io::Error::last_os_error(),
            ));
        }

        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &limits as *const _ as *const core::ffi::c_void,
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        ) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(HostError::io("configure Windows job object", error));
        }

        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                CloseHandle(job);
                return Err(HostError::io("spawn Windows child process", error));
            }
        };
        if AssignProcessToJobObject(job, child.as_raw_handle() as _) == 0 {
            let error = std::io::Error::last_os_error();
            let _ = child.kill();
            let _ = child.wait();
            CloseHandle(job);
            return Err(HostError::io("assign child to Windows job object", error));
        }
        Ok(ManagedChild { child, job })
    }
}

#[cfg(windows)]
pub fn dpapi_unprotect(encrypted: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::{copy_nonoverlapping, null_mut, write_bytes};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    if encrypted.is_empty() || encrypted.len() > u32::MAX as usize {
        return Err(HostError::InvalidSecretStore(
            "DPAPI payload length is invalid".into(),
        ));
    }
    let entropy_bytes = b"RESTOTM/runtime-secrets/v1";
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: encrypted.len() as u32,
        pbData: encrypted.as_ptr() as *mut u8,
    };
    let mut entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    unsafe {
        if CryptUnprotectData(
            &mut input,
            null_mut(),
            &mut entropy,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        ) == 0
        {
            return Err(HostError::io(
                "DPAPI CryptUnprotectData",
                std::io::Error::last_os_error(),
            ));
        }
        if output.pbData.is_null() || output.cbData == 0 {
            if !output.pbData.is_null() {
                LocalFree(output.pbData as _);
            }
            return Err(HostError::InvalidSecretStore(
                "DPAPI returned an empty secret".into(),
            ));
        }
        let mut clear = vec![0_u8; output.cbData as usize];
        copy_nonoverlapping(output.pbData, clear.as_mut_ptr(), clear.len());
        write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as _);
        Ok(clear)
    }
}

#[cfg(windows)]
pub fn dpapi_protect_local_machine(clear: &[u8]) -> Result<Vec<u8>> {
    use std::ptr::{copy_nonoverlapping, null_mut, write_bytes};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_LOCAL_MACHINE, CRYPTPROTECT_UI_FORBIDDEN,
        CRYPT_INTEGER_BLOB,
    };

    if clear.is_empty() || clear.len() > u32::MAX as usize {
        return Err(HostError::InvalidBootstrap(
            "DPAPI cleartext length is invalid".into(),
        ));
    }
    let entropy_bytes = b"RESTOTM/runtime-secrets/v1";
    let mut input = CRYPT_INTEGER_BLOB {
        cbData: clear.len() as u32,
        pbData: clear.as_ptr() as *mut u8,
    };
    let mut entropy = CRYPT_INTEGER_BLOB {
        cbData: entropy_bytes.len() as u32,
        pbData: entropy_bytes.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    unsafe {
        if CryptProtectData(
            &mut input,
            null_mut(),
            &mut entropy,
            null_mut(),
            null_mut(),
            CRYPTPROTECT_UI_FORBIDDEN | CRYPTPROTECT_LOCAL_MACHINE,
            &mut output,
        ) == 0
        {
            return Err(HostError::io(
                "DPAPI CryptProtectData(LocalMachine)",
                std::io::Error::last_os_error(),
            ));
        }
        if output.pbData.is_null() || output.cbData == 0 {
            if !output.pbData.is_null() {
                LocalFree(output.pbData as _);
            }
            return Err(HostError::InvalidBootstrap(
                "DPAPI returned an empty envelope".into(),
            ));
        }
        let mut encrypted = vec![0_u8; output.cbData as usize];
        copy_nonoverlapping(output.pbData, encrypted.as_mut_ptr(), encrypted.len());
        write_bytes(output.pbData, 0, output.cbData as usize);
        LocalFree(output.pbData as _);
        Ok(encrypted)
    }
}

#[cfg(not(windows))]
pub fn dpapi_unprotect(_encrypted: &[u8]) -> Result<Vec<u8>> {
    Err(HostError::UnsupportedPlatform(
        "DPAPI is available only on Windows".into(),
    ))
}
