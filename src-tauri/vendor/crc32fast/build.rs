use std::{env, process::Command};

fn main() {
    if let Some(minor_version) = minor_rustc_version() {
        // rustc 1.80 stabilized ARM CRC32 intrinsics:
        // https://doc.rust-lang.org/nightly/core/arch/aarch64/fn.__crc32d.html
        if minor_version >= 80 {
            println!("cargo:rustc-cfg=stable_arm_crc32_intrinsics");
            println!("cargo:rustc-check-cfg=cfg(stable_arm_crc32_intrinsics)");
        }
    }
}

fn minor_rustc_version() -> Option<u32> {
    Some(96)
}
