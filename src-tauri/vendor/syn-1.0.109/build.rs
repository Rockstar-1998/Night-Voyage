use std::env;
use std::process::Command;
use std::str;

// The rustc-cfg strings below are *not* public API. Please let us know by
// opening a GitHub issue if your build environment requires some way to enable
// these cfgs other than by executing our build script.
fn main() {
    let compiler = match rustc_version() {
        Some(compiler) => compiler,
        None => return,
    };

    if compiler.minor < 36 {
        println!("cargo:rustc-cfg=syn_omit_await_from_token_macro");
    }

    if compiler.minor < 39 {
        println!("cargo:rustc-cfg=syn_no_const_vec_new");
    }

    if compiler.minor < 40 {
        println!("cargo:rustc-cfg=syn_no_non_exhaustive");
    }

    if compiler.minor < 56 {
        println!("cargo:rustc-cfg=syn_no_negative_literal_parse");
    }

    if !compiler.nightly {
        println!("cargo:rustc-cfg=syn_disable_nightly_tests");
    }
}

struct Compiler {
    minor: u32,
    nightly: bool,
}

fn rustc_version() -> Option<Compiler> {
    Some(Compiler { minor: 96, nightly: false })
}
