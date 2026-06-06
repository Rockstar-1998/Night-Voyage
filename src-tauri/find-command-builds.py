import os
import glob

vendor_dir = os.path.join(os.path.dirname(__file__), 'vendor')

for crate_dir in glob.glob(os.path.join(vendor_dir, '*')):
    if not os.path.isdir(crate_dir):
        continue

    build_rs = os.path.join(crate_dir, 'build.rs')
    if not os.path.exists(build_rs):
        continue

    with open(build_rs, 'r', encoding='utf-8') as f:
        content = f.read()

    if 'Command::new' in content or '.output()' in content or '.status()' in content:
        # Count occurrences
        lines = []
        for i, line in enumerate(content.split('\n'), 1):
            if 'Command::new' in line or '.output()' in line or '.status()' in line:
                lines.append(f"  Line {i}: {line.strip()}")

        if lines:
            print(f"\n{os.path.basename(crate_dir)}:")
            for line in lines:
                print(line)
