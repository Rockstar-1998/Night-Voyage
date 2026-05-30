path = "src/components/WorldBookEntryArea.tsx"
with open(path, "r", encoding="utf-8") as f:
    c = f.read()

c = c.replace('<Show when={expandedEntryId() === item.id}>\n          <div class="px-6 pb-6 pt-2 border-t border-white/5 space-y-6">',
                '<div class={`grid transition-all duration-300 ease-in-out ${expandedEntryId() === item.id ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>\n          <div class="overflow-hidden">\n            <div class="px-6 pb-6 pt-2 border-t border-white/5 space-y-6">')

with open(path, "w", encoding="utf-8") as f:
    f.write(c)

print("done")
