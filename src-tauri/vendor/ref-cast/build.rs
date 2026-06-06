use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::str;

const PRIVATE: &str = "\
#[doc(hidden)]
pub mod __private$$ {
    #[doc(hidden)]
    pub use crate::private::*;
}
";

fn main() {
    println!("cargo:rerun-if-changed=build.rs");

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let patch_version = env::var("CARGO_PKG_VERSION_PATCH").unwrap();
    let module = PRIVATE.replace("$$", &patch_version);
    fs::write(out_dir.join("private.rs"), module).unwrap();

    let minor = match rustc_minor_version() {
        Some(minor) => minor,
        None => return,
    };

    if minor >= 80 {
        println!("cargo:rustc-check-cfg=cfg(no_intrinsic_type_name)");
        println!("cargo:rustc-check-cfg=cfg(no_phantom_pinned)");
    }

    if minor < 33 {
        println!("cargo:rustc-cfg=no_phantom_pinned");
    }

    if minor < 38 {
        println!("cargo:rustc-cfg=no_intrinsic_type_name");
    }
}

fn rustc_minor_version() -> Option<u32> {
    // Workaround for Windows bug: std::process::Command::output() panics with "operation completed successfully"
    Some(96)
}
