path = "src/components/SettingsArea.tsx"
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

c = c.replace('" py-4 border-b border-white/5>', ' py-4 border-b border-white/5">')
c = c.replace('" py-4 pl-4 border-b border-white/5>', ' py-4 pl-4 border-b border-white/5">')

# Let's handle the exact issue: `<div class="flex items-center justify-between gap-4" py-4 border-b border-white/5>`
import re
c = re.sub(r'class="([^"]+)" py-4 border-b border-white/5', r'class="\1 py-4 border-b border-white/5"', c)
c = re.sub(r'class="([^"]+)" py-4 pl-4 border-b border-white/5', r'class="\1 py-4 pl-4 border-b border-white/5"', c)

with open(path, "w", encoding="utf-8") as f:
    f.write(c)
