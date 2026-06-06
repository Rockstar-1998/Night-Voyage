use std::env;
use std::ffi::OsString;
use std::fs;
use std::io::ErrorKind;
use std::iter;
use std::path::Path;
use std::process::{self, Command, Stdio};
use std::str;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let mut consider_rustc_bootstrap = false;
    if compile_probe("span_locations") {
        println!("cargo:rustc-cfg=proc_macro_span");
        println!("cargo:rustc-cfg=proc_macro_span_shrink");
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe("span_locations") {
            println!("cargo:rustc-cfg=proc_macro_span");
            println!("cargo:rustc-cfg=proc_macro_span_shrink");
        } else if rustc_bootstrap == "1" {
            // This is a stable or beta compiler for which the user has set
            // RUSTC_BOOTSTRAP to turn on unstable features, but the span API is
            // not supported. No need to pay attention to RUSTC_BOOTSTRAP.
        } else {
            // This is a stable or beta compiler for which RUSTC_BOOTSTRAP is
            // set to restrict the use of unstable features by this crate.
            consider_rustc_bootstrap = true;
        }
    } else {
        // Without RUSTC_BOOTSTRAP, this compiler does not support the span
        // API, but try again if the user turns on unstable features.
        consider_rustc_bootstrap = true;
    }

    if compile_probe("is_available") {
        println!("cargo:rustc-cfg=proc_macro_is_available");
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe("is_available") {
            println!("cargo:rustc-cfg=proc_macro_is_available");
        } else if rustc_bootstrap == "1" {
            //
        } else {
            consider_rustc_bootstrap = true;
        }
    } else {
        consider_rustc_bootstrap = true;
    }

    if compile_probe("literal_byte_character") {
        println!("cargo:rustc-cfg=proc_macro_literal_byte_character");
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe("literal_byte_character") {
            println!("cargo:rustc-cfg=proc_macro_literal_byte_character");
        } else if rustc_bootstrap == "1" {
            //
        } else {
            consider_rustc_bootstrap = true;
        }
    } else {
        consider_rustc_bootstrap = true;
    }

    if compile_probe("literal_c_string_from_str") {
        println!("cargo:rustc-cfg=proc_macro_literal_c_string_from_str");
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe("literal_c_string_from_str") {
            println!("cargo:rustc-cfg=proc_macro_literal_c_string_from_str");
        } else if rustc_bootstrap == "1" {
            //
        } else {
            consider_rustc_bootstrap = true;
        }
    } else {
        consider_rustc_bootstrap = true;
    }

    if compile_probe("no_source_text") {
        println!("cargo:rustc-cfg=proc_macro_no_source_text");
    } else if let Some(rustc_bootstrap) = env::var_os("RUSTC_BOOTSTRAP") {
        if compile_probe("no_source_text") {
            println!("cargo:rustc-cfg=proc_macro_no_source_text");
        } else if rustc_bootstrap == "1" {
            //
        } else {
            consider_rustc_bootstrap = true;
        }
    } else {
        consider_rustc_bootstrap = true;
    }

    if consider_rustc_bootstrap {
        println!("cargo:rerun-if-env-changed=RUSTC_BOOTSTRAP");
    }

    let version = rustc_minor_version().unwrap_or(0);

    if version >= 80 {
        println!("cargo:rustc-check-cfg=cfg(nightly_testing)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_span)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_span_shrink)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_is_available)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_literal_byte_character)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_literal_c_string_from_str)");
        println!("cargo:rustc-check-cfg=cfg(proc_macro_no_source_text)");
        println!("cargo:rustc-check-cfg=cfg(super_unstable)");
        println!("cargo:rustc-check-cfg=cfg(wrap_proc_macro)");
    }
}

fn compile_probe(_feature: &str) -> bool {
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
