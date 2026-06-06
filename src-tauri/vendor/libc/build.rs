use std::env::VarError;
use std::process::{
    Command,
    Output,
};
use std::{
    env,
    str,
};

// List of cfgs this build script is allowed to set. The list is needed to support check-cfg, as we
// need to know all the possible cfgs that this script will set. If you need to set another cfg
// make sure to add it to this list as well.
const ALLOWED_CFGS: &[&str] = &[
    "emscripten_old_stat_abi",
    // Should be enabled by users if esp-idf (>=6.0) is build with picolibc instead of newlib.
    "espidf_picolibc",
    "espidf_time32",
    "freebsd10",
    "freebsd11",
    "freebsd12",
    "freebsd13",
    "freebsd14",
    "freebsd15",
    // Corresponds to `_FILE_OFFSET_BITS=64` in glibc
    "gnu_file_offset_bits64",
    // Corresponds to `_TIME_BITS=64` in glibc
    "gnu_time_bits64",
    "libc_deny_warnings",
    // Corresponds to `__USE_TIME_BITS64` in UAPI
    "linux_time_bits64",
    "musl_v1_2_3",
    // musl v1.2.3+ && 32-bit: time_t is i64, struct layouts change
    "musl32_time64",
    // Corresponds to `_REDIR_TIME64` in musl: symbol redirects to __*_time64
    "musl_redir_time64",
    "vxworks_lt_25_09",
];

// Extra values to allow for check-cfg.
const CHECK_CFG_EXTRA: &[(&str, &[&str])] = &[
    (
        "target_os",
        &[
            "switch", "aix", "ohos", "hurd", "rtems", "visionos", "nuttx", "cygwin", "qurt",
        ],
    ),
    (
        "target_env",
        &["illumos", "wasi", "aix", "ohos", "nto71_iosock", "nto80"],
    ),
    (
        "target_arch",
        &["loongarch64", "mips32r6", "mips64r6", "csky"],
    ),
];

/// Musl architectures that define `_REDIR_TIME64` (i.e. those that transitioned
/// from 32-bit to 64-bit `time_t` and need `__*_time64` symbol redirects).
const MUSL_REDIR_TIME64_ARCHES: &[&str] = &["arm", "mips", "powerpc", "x86"];

fn main() {
    // Avoid unnecessary re-building.
    println!("cargo:rerun-if-changed=build.rs");

    let (rustc_minor_ver, _is_nightly) = rustc_minor_nightly();
    let libc_ci = env_flag("LIBC_CI");
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_ptr_width = env::var("CARGO_CFG_TARGET_POINTER_WIDTH").unwrap_or_default();
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();

    // The ABI of libc used by std is backward compatible with FreeBSD 12.
    // The ABI of libc from crates.io is backward compatible with FreeBSD 12.
    //
    // On CI, we detect the actual FreeBSD version and match its ABI exactly,
    // running tests to ensure that the ABI is correct.
    println!("cargo:rerun-if-env-changed=RUST_LIBC_UNSTABLE_FREEBSD_VERSION");
    // Allow overriding the default version for testing
    let which_freebsd = if let Ok(version) = env::var("RUST_LIBC_UNSTABLE_FREEBSD_VERSION") {
        let vers = version.parse().unwrap();
        println!("cargo:warning=setting FreeBSD version to {vers}");
        vers
    } else if libc_ci {
        which_freebsd().unwrap_or(12)
    } else {
        12
    };

    match which_freebsd {
        x if x < 10 => panic!("FreeBSD older than 10 is not supported"),
        10 => set_cfg("freebsd10"),
        11 => set_cfg("freebsd11"),
        12 => set_cfg("freebsd12"),
        13 => set_cfg("freebsd13"),
        14 => set_cfg("freebsd14"),
        _ => set_cfg("freebsd15"),
    }

    match emcc_version_code() {
        Some(v) if (v < 30142) => set_cfg("emscripten_old_stat_abi"),
        // Non-Emscripten or version >= 3.1.42.
        _ => (),
    }

    match vxworks_version_code() {
        Some(v) if (v < (25, 9)) => set_cfg("vxworks_lt_25_09"),
        // VxWorks version >= 25.09
        _ => (),
    }

    let mut musl_v1_2_3 = env_flag("RUST_LIBC_UNSTABLE_MUSL_V1_2_3");
    println!("cargo:rerun-if-env-changed=RUST_LIBC_UNSTABLE_MUSL_V1_2_3");

    // OpenHarmony uses a fork of the musl libc
    let musl = target_env == "musl" || target_env == "ohos";

    // loongarch64, hexagon, and ohos only exist with recent musl
    if target_arch == "loongarch64" || target_arch == "hexagon" || target_env == "ohos" {
        musl_v1_2_3 = true;
    }

    if musl && musl_v1_2_3 {
        set_cfg("musl_v1_2_3");
        if target_ptr_width == "32" {
            set_cfg("musl32_time64");
            set_cfg("linux_time_bits64");
        }
        if MUSL_REDIR_TIME64_ARCHES.contains(&target_arch.as_str()) {
            set_cfg("musl_redir_time64");
        }
    }

    let linux_time_bits64 = env::var("RUST_LIBC_UNSTABLE_LINUX_TIME_BITS64").is_ok();
    println!("cargo:rerun-if-env-changed=RUST_LIBC_UNSTABLE_LINUX_TIME_BITS64");
    if linux_time_bits64 {
        set_cfg("linux_time_bits64");
    }
    println!("cargo:rerun-if-env-changed=RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS");
    println!("cargo:rerun-if-env-changed=RUST_LIBC_UNSTABLE_GNU_TIME_BITS");
    if target_env == "gnu"
        && target_os == "linux"
        && target_ptr_width == "32"
        && target_arch != "riscv32"
        && target_arch != "x86_64"
    {
        let defaultbits = "32".to_string();
        let (timebits, filebits) = match (
            env::var("RUST_LIBC_UNSTABLE_GNU_TIME_BITS"),
            env::var("RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS"),
        ) {
            (Ok(_), Ok(_)) => panic!("Do not set both RUST_LIBC_UNSTABLE_GNU_TIME_BITS and RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS"),
            (Err(_), Err(_)) => (defaultbits.clone(), defaultbits.clone()),
            (Ok(tb), Err(_)) if tb == "64" => (tb.clone(), tb.clone()),
            (Ok(tb), Err(_)) if tb == "32" => (tb, defaultbits.clone()),
            (Ok(_), Err(_)) => panic!("Invalid value for RUST_LIBC_UNSTABLE_GNU_TIME_BITS, must be 32 or 64"),
            (Err(_), Ok(fb)) if fb == "32" || fb == "64" => (defaultbits.clone(), fb),
            (Err(_), Ok(_)) => panic!("Invalid value for RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS, must be 32 or 64"),
        };
        let valid_bits = ["32", "64"];
        assert!(
            valid_bits.contains(&filebits.as_str()) && valid_bits.contains(&timebits.as_str()),
            "Invalid value for RUST_LIBC_UNSTABLE_GNU_TIME_BITS or RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS, must be 32, 64 or unset"
        );
        assert!(
            !(filebits == "32" && timebits == "64"),
            "RUST_LIBC_UNSTABLE_GNU_FILE_OFFSET_BITS must be 64 or unset if RUST_LIBC_UNSTABLE_GNU_TIME_BITS is 64"
        );
        if timebits == "64" {
            set_cfg("linux_time_bits64");
            set_cfg("gnu_time_bits64");
        }
        if filebits == "64" {
            set_cfg("gnu_file_offset_bits64");
        }
    }

    // On CI: deny all warnings
    if libc_ci {
        set_cfg("libc_deny_warnings");
    }

    // Since Rust 1.80, configuration that isn't recognized by default needs to be provided to
    // avoid warnings.
    if rustc_minor_ver >= 80 {
        for cfg in ALLOWED_CFGS {
            println!("cargo:rustc-check-cfg=cfg({cfg})");
        }
        for &(name, values) in CHECK_CFG_EXTRA {
            let values = values.join("\", \"");
            println!("cargo:rustc-check-cfg=cfg({name},values(\"{values}\"))");
        }
    }
}

/// Return the minor version of `rustc`, as well as a bool indicating whether or not the version
/// is a nightly.
fn rustc_minor_nightly() -> (u32, bool) {
    // Workaround for Windows bug: std::process::Command::output() panics with "operation completed successfully"
    (96, false)
}

fn which_freebsd() -> Option<i32> {
    // Workaround for Windows bug: skip freebsd-version check
    None
}

fn emcc_version_code() -> Option<u64> {
    // Workaround for Windows bug: skip emcc check
    None
}

/// Retrieve the VxWorks release version from the environment variable set by the VxWorks build
/// environment, in `(minor, patch)` form. Currently the only major version supported by Rust
/// is 7.
fn vxworks_version_code() -> Option<(u32, u32)> {
    let version = env::var("WIND_RELEASE_ID").ok()?;

    let mut pieces = version.trim().split(['.']);

    let major: u32 = pieces.next().and_then(|x| x.parse().ok()).unwrap_or(0);
    let minor: u32 = pieces.next().and_then(|x| x.parse().ok()).unwrap_or(0);

    Some((major, minor))
}

fn set_cfg(cfg: &str) {
    assert!(
        ALLOWED_CFGS.contains(&cfg),
        "trying to set cfg {cfg}, but it is not in ALLOWED_CFGS",
    );
    println!("cargo:rustc-cfg={cfg}");
}

/// Return true if the env is set to a value other than `0`.
fn env_flag(key: &str) -> bool {
    match env::var(key) {
        Ok(x) if x == "0" => false,
        Err(VarError::NotPresent) => false,
        Err(VarError::NotUnicode(_)) => panic!("non-unicode var for `{key}`"),
        Ok(_) => true,
    }
}
