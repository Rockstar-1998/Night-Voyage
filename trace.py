with open('src/components/SettingsArea.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def trace_tags(start, end):
    indent = 0
    for i in range(start, end):
        line = lines[i]
        # remove self-closing tags
        line = line.replace('<div />', '')
        open_divs = line.count('<div') - line.count('</div')
        indent += open_divs
        if open_divs != 0:
            print(f"{i}: {line.strip()} | diff: {open_divs} | current indent: {indent}")

print("Tracing API Match")
trace_tags(387, 797)
