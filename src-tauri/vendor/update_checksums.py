import os, json, hashlib

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

crates = [
    "crc32fast",
    "getrandom-0.3.4",
    "httparse",
    "paste",
    "ring",
    "rustix",
    "syn-1.0.109",
    "target-lexicon",
    "wasm-bindgen-shared",
    "zerocopy",
]

vendor_dir = os.path.dirname(os.path.abspath(__file__))

for crate in crates:
    crate_dir = os.path.join(vendor_dir, crate)
    if not os.path.isdir(crate_dir):
        print(f"Skipping missing crate: {crate}")
        continue

    files_dict = {}
    for root, dirs, files in os.walk(crate_dir):
        for fname in files:
            if fname == '.cargo-checksum.json':
                continue
            fpath = os.path.join(root, fname)
            rel_path = os.path.relpath(fpath, crate_dir).replace('\\', '/')
            files_dict[rel_path] = sha256_file(fpath)

    checksum_path = os.path.join(crate_dir, '.cargo-checksum.json')
    if not os.path.exists(checksum_path):
        print(f"No checksum file for {crate}, creating...")
        orig = {}
    else:
        with open(checksum_path, 'r', encoding='utf-8-sig') as f:
            orig = json.load(f)

    data = {'package': orig.get('package', ''), 'files': files_dict}
    with open(checksum_path, 'w', encoding='utf-8') as f:
        json.dump(data, f)

    print(f"Updated {crate}: {len(files_dict)} files")
