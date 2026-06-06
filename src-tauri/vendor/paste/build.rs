use std::env;
use std::process::Command;
use std::str;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let version = match rustc_version() {
        Some(version) => version,
        None => return,
    };

    if version.minor >= 80 {
        println!("cargo:rustc-check-cfg=cfg(no_literal_fromstr)");
        println!("cargo:rustc-check-cfg=cfg(feature, values(\"protocol_feature_paste\"))");
    }

    if version.minor < 54 {
        // https://github.com/rust-lang/rust/pull/84717
        println!("cargo:rustc-cfg=no_literal_fromstr");
    }
}

struct RustcVersion {
    minor: u32,
}

fn rustc_version() -> Option<RustcVersion> {
    Some(RustcVersion { minor: 96 })
}
