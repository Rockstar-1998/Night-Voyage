import os
import json
import hashlib
import glob

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        h.update(f.read())
    return h.hexdigest()

vendor_dir = os.path.join(os.path.dirname(__file__), 'vendor')

for crate_dir in glob.glob(os.path.join(vendor_dir, '*')):
    if not os.path.isdir(crate_dir):
        continue

    checksum_path = os.path.join(crate_dir, '.cargo-checksum.json')
    if not os.path.exists(checksum_path):
        continue

    with open(checksum_path, 'r', encoding='utf-8-sig') as f:
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

print("Done!")
