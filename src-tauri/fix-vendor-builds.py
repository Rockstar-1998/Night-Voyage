import os
import json
import hashlib
import glob

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

def fix_build_rs(build_rs_path):
    with open(build_rs_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Check if it uses Command::output for rustc version detection
    if 'Command::new' not in content or 'rustc' not in content:
        return False

    # Replace rustc_minor_version function
    import re

    # Pattern to match rustc_minor_version function
    pattern = r'fn rustc_minor_version\(\)(?:\s*->\s*Option<u32>)?\s*\{[^}]*Command::new[^}]*output\(\)[^}]*\}'

    if re.search(pattern, content, re.DOTALL):
        new_func = '''fn rustc_minor_version() -> Option<u32> {
    // Workaround for Windows bug: std::process::Command::output() panics with "operation completed successfully"
    Some(96)
}'''
        content = re.sub(pattern, new_func, content, flags=re.DOTALL)

        with open(build_rs_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return True

    # Also fix do_compile_probe in proc-macro2
    if 'do_compile_probe' in content and 'Command::new' in content:
        pattern2 = r'fn do_compile_probe\([^)]*\)(?:\s*->\s*bool)?\s*\{[^}]*Command::new[^}]*success\s*\}'
        if re.search(pattern2, content, re.DOTALL):
            new_func2 = '''fn do_compile_probe(_feature: &str, _rustc_bootstrap: bool) -> bool {
    // Workaround for Windows bug: std::process::Command panics with "operation completed successfully"
    false
}'''
            content = re.sub(pattern2, new_func2, content, flags=re.DOTALL)

            with open(build_rs_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True

    return False

def update_checksum(crate_dir):
    checksum_path = os.path.join(crate_dir, '.cargo-checksum.json')
    if not os.path.exists(checksum_path):
        return

    with open(checksum_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    files_dict = data.get('files', {})
    updated = False

    for root, dirs, files in os.walk(crate_dir):
        for fname in files:
            if fname == '.cargo-checksum.json':
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, crate_dir).replace('\\', '/')
            if rel_path in files_dict:
                new_hash = sha256_file(fpath)
                if files_dict[rel_path] != new_hash:
                    files_dict[rel_path] = new_hash
                    updated = True

    if updated:
        with open(checksum_path, 'w', encoding='utf-8') as f:
            json.dump(data, f)
        print(f"Updated checksum: {os.path.basename(crate_dir)}")

vendor_dir = os.path.join(os.path.dirname(__file__), 'vendor')

for crate_dir in glob.glob(os.path.join(vendor_dir, '*')):
    if not os.path.isdir(crate_dir):
        continue

    build_rs = os.path.join(crate_dir, 'build.rs')
    if os.path.exists(build_rs):
        if fix_build_rs(build_rs):
            print(f"Fixed: {os.path.basename(crate_dir)}")
            update_checksum(crate_dir)

print("Done!")
