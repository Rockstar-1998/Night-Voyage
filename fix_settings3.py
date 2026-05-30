import re

with open('src/components/SettingsArea.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

c = re.sub(r'</Show>\s*<Show when=\{categoryId === \'appearance\'\}>', 
           r'</Match>\n            <Match when={categoryId === \'appearance\'}>', 
           c)

c = re.sub(r'</Show>\s*<Show when=\{props.activeCategory !== \'api\' && props.activeCategory !== \'appearance\'\}>',
           r'</Match>\n            <Match when={categoryId !== \'api\' && categoryId !== \'appearance\'}>',
           c)

with open('src/components/SettingsArea.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done")
