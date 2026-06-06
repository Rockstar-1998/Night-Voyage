import os
import json
import hashlib
import glob
import re

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

def update_checksum(crate_dir):
    checksum_path = os.path.join(crate_dir, '.cargo-checksum.json')
    if not os.path.exists(checksum_path):
        return

    with open(checksum_path, 'r', encoding='utf-8-sig') as f:
        data = json.load(f)

    files_dict = data.get('files', {})

    for root, dirs, files in os.walk(crate_dir):
        for fname in files:
            if fname == '.cargo-checksum.json':
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, crate_dir).replace('\\', '/')
            if rel_path in files_dict:
                files_dict[rel_path] = sha256_file(fpath)

    with open(checksum_path, 'w', encoding='utf-8') as f:
        json.dump(data, f)

def fix_build_rs(build_rs_path):
    with open(build_rs_path, 'r', encoding='utf-8') as f:
        content = f.read()

    original = content
    modified = False

    # Fix 1: Replace rustc_minor_version functions that call Command::output
    # Pattern matches various forms of this function
    pattern1 = r'fn rustc_minor_version\(\)(?:\s*->\s*Option<u32>)?\s*\{[\s\S]*?Command::new[\s\S]*?output\(\)[\s\S]*?\}'
    if re.search(pattern1, content):
        content = re.sub(pattern1, '''fn rustc_minor_version() -> Option<u32> {
    // Workaround for Windows bug: std::process::Command::output() panics
    Some(96)
}''', content)
        modified = True

    # Fix 2: Replace do_compile_probe / compile_probe functions
    pattern2 = r'fn (do_compile_probe|compile_probe)\([^)]*\)(?:\s*->\s*bool)?\s*\{[\s\S]*?Command::new[\s\S]*?\}'
    if re.search(pattern2, content):
        content = re.sub(pattern2, r'''fn \1(_feature: &str, _rustc_bootstrap: bool) -> bool {
    // Workaround for Windows bug: std::process::Command panics
    false
}''', content)
        modified = True

    # Fix 3: Replace which_freebsd functions
    pattern3 = r'fn which_freebsd\(\)(?:\s*->\s*Option<[^>]+>)?\s*\{[\s\S]*?Command::new[\s\S]*?\}'
    if re.search(pattern3, content):
        content = re.sub(pattern3, '''fn which_freebsd() -> Option<i32> {
    // Workaround for Windows bug: skip freebsd-version check
    None
}''', content)
        modified = True

    # Fix 4: Replace emcc_version_code functions
    pattern4 = r'fn emcc_version_code\(\)(?:\s*->\s*Option<[^>]+>)?\s*\{[\s\S]*?Command::new[\s\S]*?\}'
    if re.search(pattern4, content):
        content = re.sub(pattern4, '''fn emcc_version_code() -> Option<u64> {
    // Workaround for Windows bug: skip emcc check
    None
}''', content)
        modified = True

    # Fix 5: Replace rustc_version_cmd functions
    pattern5 = r'fn rustc_version_cmd\([^)]*\)(?:\s*->\s*Output)?\s*\{[\s\S]*?Command::new[\s\S]*?\}'
    if re.search(pattern5, content):
        content = re.sub(pattern5, '''fn rustc_version_cmd(_is_clippy_driver: bool) -> std::process::Output {
    panic!("Workaround for Windows bug: std::process::Command::output() panics")
}''', content)
        modified = True

    # Fix 6: Replace rustc_minor_nightly functions
    pattern6 = r'fn rustc_minor_nightly\(\)(?:\s*->\s*\([^)]+\))?\s*\{[\s\S]*?Command::new[\s\S]*?\}'
    if re.search(pattern6, content):
        content = re.sub(pattern6, '''fn rustc_minor_nightly() -> (u32, bool) {
    // Workaround for Windows bug: std::process::Command::output() panics
    (96, false)
}''', content)
        modified = True

    if modified:
        with open(build_rs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True
    return False

vendor_dir = os.path.join(os.path.dirname(__file__), 'vendor')
fixed_crates = []

for crate_dir in glob.glob(os.path.join(vendor_dir, '*')):
    if not os.path.isdir(crate_dir):
        continue

    build_rs = os.path.join(crate_dir, 'build.rs')
    if not os.path.exists(build_rs):
        continue

    if fix_build_rs(build_rs):
        crate_name = os.path.basename(crate_dir)
        fixed_crates.append(crate_name)
        update_checksum(crate_dir)
        print(f"Fixed: {crate_name}")

print(f"\nTotal fixed: {len(fixed_crates)}")
print("Done!")
