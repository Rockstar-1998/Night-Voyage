#![allow(clippy::uninlined_format_args)]

use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::iter;
use std::path::Path;
use std::process::{self, Command, Stdio};
use std::str;

fn main() {
    if cfg!(feature = "std") {
        println!("cargo:rerun-if-changed=src/nightly.rs");

        let error_generic_member_access;
        let consider_rustc_bootstrap;
        if compile_probe(false) {
            // This is a nightly or dev compiler, so it supports unstable
            // features regardless of RUSTC_BOOTSTRAP. No need to rerun build
            // script if RUSTC_BOOTSTRAP is changed.
            error_generic_member_access = true;
            consider_rustc_bootstrap = false;
        } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
            if compile_probe(true) {
                // This is a stable or beta compiler for which the user has set
                // RUSTC_BOOTSTRAP to turn on unstable features. Rerun build
                // script if they change it.
                error_generic_member_access = true;
                consider_rustc_bootstrap = true;
            } else if rustc_bootstrap == "1" {
                // This compiler does not support the generic member access API
                // in the form that anyhow expects. No need to pay attention to
                // RUSTC_BOOTSTRAP.
                error_generic_member_access = false;
                consider_rustc_bootstrap = false;
            } else {
                // This is a stable or beta compiler for which RUSTC_BOOTSTRAP
                // is set to restrict the use of unstable features by this
                // crate.
                error_generic_member_access = false;
                consider_rustc_bootstrap = true;
            }
        } else {
            // Without RUSTC_BOOTSTRAP, this compiler does not support the
            // generic member access API in the form that anyhow expects, but
            // try again if the user turns on unstable features.
            error_generic_member_access = false;
            consider_rustc_bootstrap = true;
        }

        if error_generic_member_access {
            println!("cargo:rustc-cfg=error_generic_member_access");
        }

        if consider_rustc_bootstrap {
            println!("cargo:rerun-if-env-changed=RUSTC_BOOTSTRAP");
        }
    }

    let Some(rustc) = rustc_minor_version() else {
        return;
    };

    if rustc >= 80 {
        println!("cargo:rustc-check-cfg=cfg(anyhow_build_probe)");
        println!("cargo:rustc-check-cfg=cfg(anyhow_nightly_testing)");
        println!("cargo:rustc-check-cfg=cfg(anyhow_no_clippy_format_args)");
        println!("cargo:rustc-check-cfg=cfg(anyhow_no_core_error)");
        println!("cargo:rustc-check-cfg=cfg(error_generic_member_access)");
    }

    if rustc < 81 {
        // core::error::Error
        // https://blog.rust-lang.org/2024/09/05/Rust-1.81.0.html#coreerrorerror
        println!("cargo:rustc-cfg=anyhow_no_core_error");
    }

    if rustc < 85 {
        // #[clippy::format_args]
        // https://doc.rust-lang.org/1.85.1/clippy/attribs.html#clippyformat_args
        println!("cargo:rustc-cfg=anyhow_no_clippy_format_args");
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
        eprintln!(
            "Environment variable ${} is not set during execution of build script",
            key,
        );
        process::exit(1);
    })
}
