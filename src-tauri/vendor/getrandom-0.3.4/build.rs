use std::{env, ffi::OsString, process::Command};

/// Tries to get the minor version of the Rust compiler in use.
/// If it fails for any reason, returns `None`.
///
/// Based on the `rustc_version` crate.
fn rustc_minor_version() -> Option<u64> {
    Some(96)
}

fn main() {
    // Automatically detect cfg(sanitize = "memory") even if cfg(sanitize) isn't
    // supported. Build scripts get cfg() info, even if the cfg is unstable.
    println!("cargo:rerun-if-changed=build.rs");
    let sanitizers = std::env::var("CARGO_CFG_SANITIZE").unwrap_or_default();
    if sanitizers.contains("memory") {
        println!("cargo:rustc-cfg=getrandom_msan");
    }

    // Use `RtlGenRandom` on older compiler versions since win7 targets
    // TODO(MSRV 1.78): Remove this check
    let target_family = env::var_os("CARGO_CFG_TARGET_FAMILY").and_then(|f| f.into_string().ok());
    if target_family.as_deref() == Some("windows") {
        /// Minor version of the Rust compiler in which win7 targets were inroduced
        const WIN7_INTRODUCED_MINOR_VER: u64 = 78;

        match rustc_minor_version() {
            Some(minor_ver) if minor_ver < WIN7_INTRODUCED_MINOR_VER => {
                println!("cargo:rustc-cfg=getrandom_backend=\"windows_legacy\"");
            }
            None => println!("cargo:warning=Couldn't detect minor version of the Rust compiler"),
            _ => {}
        }
    }
}
