use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::iter;
use std::path::{Path, PathBuf};
use std::process::{self, Command, Stdio};
use std::str;

const PRIVATE: &str = "\
#[doc(hidden)]
pub mod __private$$ {
    #[doc(hidden)]
    pub use crate::private::*;
}
";

fn main() {
    println!("cargo:rerun-if-changed=build/probe.rs");

    println!("cargo:rustc-check-cfg=cfg(error_generic_member_access)");
    println!("cargo:rustc-check-cfg=cfg(thiserror_nightly_testing)");
    println!("cargo:rustc-check-cfg=cfg(thiserror_no_backtrace_type)");

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let patch_version = env::var("CARGO_PKG_VERSION_PATCH").unwrap();
    let module = PRIVATE.replace("$$", &patch_version);
    fs::write(out_dir.join("private.rs"), module).unwrap();

    let error_generic_member_access;
    let consider_rustc_bootstrap;
    if compile_probe(false) {
        // This is a nightly or dev compiler, so it supports unstable features
        // regardless of RUSTC_BOOTSTRAP. No need to rerun build script if
        // RUSTC_BOOTSTRAP is changed.
        error_generic_member_access = true;
        consider_rustc_bootstrap = false;
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe(true) {
            // This is a stable or beta compiler for which the user has set
            // RUSTC_BOOTSTRAP to turn on unstable features. Rerun build script
            // if they change it.
            error_generic_member_access = true;
            consider_rustc_bootstrap = true;
        } else if rustc_bootstrap == "1" {
            // This compiler does not support the generic member access API in
            // the form that thiserror expects. No need to pay attention to
            // RUSTC_BOOTSTRAP.
            error_generic_member_access = false;
            consider_rustc_bootstrap = false;
        } else {
            // This is a stable or beta compiler for which RUSTC_BOOTSTRAP is
            // set to restrict the use of unstable features by this crate.
            error_generic_member_access = false;
            consider_rustc_bootstrap = true;
        }
    } else {
        // Without RUSTC_BOOTSTRAP, this compiler does not support the generic
        // member access API in the form that thiserror expects, but try again
        // if the user turns on unstable features.
        error_generic_member_access = false;
        consider_rustc_bootstrap = true;
    }

    if error_generic_member_access {
        println!("cargo:rustc-cfg=error_generic_member_access");
    }

    if consider_rustc_bootstrap {
        println!("cargo:rerun-if-env-changed=RUSTC_BOOTSTRAP");
    }

    // core::error::Error stabilized in Rust 1.81
    // https://blog.rust-lang.org/2024/09/05/Rust-1.81.0.html#coreerrorerror
    let rustc = rustc_minor_version();
    if cfg!(not(feature = "std")) && rustc.map_or(false, |rustc| rustc < 81) {
        println!("cargo:rustc-cfg=feature=\"std\"");
    }

    let Some(rustc) = rustc else {
        return;
    };

    // std::backtrace::Backtrace stabilized in Rust 1.65
    // https://blog.rust-lang.org/2022/11/03/Rust-1.65.0.html#stabilized-apis
    if rustc < 65 {
        println!("cargo:rustc-cfg=thiserror_no_backtrace_type");
    }
}

fn compile_probe(_rustc_bootstrap: bool) -> bool {
    // Workaround for Windows bug: std::process::Command panics with "operation completed successfully"
    false
}

fn rustc_minor_version() -> Option<u32> {
    // Workaround for Windows bug: std::process::Command::output() panics with "operation completed successfully"
    Some(96)
}

fn cargo_env_var(key: &str) -> OsString {
    env::var_os(key).unwrap_or_else(|| {
        eprintln!("Environment variable ${key} is not set during execution of build script");
        process::exit(1);
    })
}
