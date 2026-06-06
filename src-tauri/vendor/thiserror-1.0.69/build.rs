use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::iter;
use std::path::Path;
use std::process::{self, Command, Stdio};

fn main() {
    println!("cargo:rerun-if-changed=build/probe.rs");

    println!("cargo:rustc-check-cfg=cfg(error_generic_member_access)");
    println!("cargo:rustc-check-cfg=cfg(thiserror_nightly_testing)");

    let error_generic_member_access;
    let consider_rustc_bootstrap;
    if compile_probe(false) {
        error_generic_member_access = true;
        consider_rustc_bootstrap = false;
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe(true) {
            error_generic_member_access = true;
            consider_rustc_bootstrap = true;
        } else if rustc_bootstrap == "1" {
            error_generic_member_access = false;
            consider_rustc_bootstrap = false;
        } else {
            error_generic_member_access = false;
            consider_rustc_bootstrap = true;
        }
    } else {
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

fn compile_probe(_rustc_bootstrap: bool) -> bool {
    // Workaround for Windows bug: std::process::Command panics with "operation completed successfully"
    false
}

fn cargo_env_var(key: &str) -> OsString {
    env::var_os(key).unwrap_or_else(|| {
        eprintln!("Environment variable ${key} is not set during execution of build script");
        process::exit(1);
    })
}
