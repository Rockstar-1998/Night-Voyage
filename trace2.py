with open('src/components/WorldBookSidebar.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

def trace_tags(start, end):
    indent = 0
    for i in range(start, end):
        line = lines[i]
        line = line.replace('<div />', '')
        line = line.replace('<div class="absolute inset-0 bg-accent/5" />', '')
        line = line.replace('<div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />', '')
        open_divs = line.count('<div') - line.count('</div')
        indent += open_divs
        if open_divs != 0:
            print(f"{i}: {line.strip()} | diff: {open_divs} | current indent: {indent}")

print("Tracing List Match")
trace_tags(115, 206)
