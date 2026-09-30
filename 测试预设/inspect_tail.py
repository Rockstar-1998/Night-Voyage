import json

p = r'c:\Users\Administrator\.trae-cn\attachments\6a950a0d924ee8cc70191210\5be1e17f-f814-4311-beda-363d72c7ee14_7ef7c2f1-8172-4bfc-abdf-c4a380bf4d5f_Night Voyage 全能进阶核心预设 V2.2.nvpreset.json'
doc = json.load(open(p, encoding='utf-8'))
g = doc['preset']['blueprintGraph']
ids = ['n_branch_1_z382', 'n_constant_2_z7u2']
watch = set(ids) | {'n_end', 'n_schema_text', 'n_output_rules'}

for n in g['nodes']:
    if n['id'] in ids or n['type'].startswith('sampling'):
        print(json.dumps(n, ensure_ascii=False, indent=1))
        watch.add(n['id'])

print('--- edges referencing watch nodes ---')
for e in g['edges']:
    if e['source'] in watch or e['target'] in watch:
        print(f"{e['id']}: {e['source']}.{e['source_port']} -> {e['target']}.{e['target_port']}")

print('--- prompt nodes with priority >= 88 (头部区) ---')
for n in g['nodes']:
    if n['type'] == 'prompt' and n['config'].get('priority', 0) >= 88:
        print(f"{n['config']['priority']}  {n['config']['identifier']}")

print('--- node id / type counts ---')
from collections import Counter
print(Counter(n['type'] for n in g['nodes']))
