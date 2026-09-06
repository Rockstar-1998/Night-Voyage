import json, sys

PATH = sys.argv[1] if len(sys.argv) > 1 else r"d:\data\Night Voyage\测试预设\Night Voyage 全能进阶核心预设 V2.2.nvpreset.json"

with open(PATH, encoding="utf-8") as f:
    doc = json.load(f)

g = doc["preset"]["blueprintGraph"]
nodes = g["nodes"]
edges = g["edges"]
errors = []

ids = [n["id"] for n in nodes]
if len(ids) != len(set(ids)):
    errors.append("duplicate node id")
by_id = {n["id"]: n for n in nodes}

starts = [n for n in nodes if n["type"] == "start"]
ends = [n for n in nodes if n["type"] == "end"]
if len(starts) != 1: errors.append(f"start count = {len(starts)}")
if len(ends) != 1: errors.append(f"end count = {len(ends)}")

valid_gate_ports = {}
for n in nodes:
    if n["type"] in ("mutex_gate", "group_gate"):
        valid_gate_ports[n["id"]] = {f"out_{o['key']}" for o in n["config"]["options"]}

for e in edges:
    if e["source"] not in by_id: errors.append(f"edge {e['id']}: source missing")
    if e["target"] not in by_id: errors.append(f"edge {e['id']}: target missing")
    src = by_id.get(e["source"])
    if src and src["id"] in valid_gate_ports:
        if e["source_port"] not in valid_gate_ports[src["id"]]:
            errors.append(f"edge {e['id']}: dirty port {e['source_port']} on gate {src['id']}")

seen_edge = set()
for e in edges:
    k = (e["source"], e["source_port"], e["target"], e["target_port"])
    if k in seen_edge: errors.append(f"edge {e['id']}: duplicate edge {k}")
    seen_edge.add(k)

field_names = [n["config"]["field_name"] for n in nodes if n["type"] == "schema_field"]
if len(field_names) != len(set(field_names)):
    dup = [x for x in set(field_names) if field_names.count(x) > 1]
    errors.append(f"duplicate field_name: {dup}")
idents = [n["config"]["identifier"] for n in nodes if n["type"] == "prompt"]
if len(idents) != len(set(idents)):
    dup = [x for x in set(idents) if idents.count(x) > 1]
    errors.append(f"duplicate identifier: {dup}")

for n in nodes:
    if n["type"] == "mode_switch":
        for port in ("out_legacy", "out_mem0", "out_stateless"):
            if not any(e["source"] == n["id"] and e["source_port"] == port for e in edges):
                errors.append(f"mode_switch {n['id']} missing {port}")

for n in nodes:
    if n["type"] == "branch":
        cfg = n["config"]
        for c in cfg["cases"]:
            if not any(e["source"] == n["id"] and e["source_port"] == c["port"] for e in edges):
                errors.append(f"branch {n['id']} case port {c['port']} no edge")
        if not any(e["source"] == n["id"] and e["source_port"] == cfg["default_port"] for e in edges):
            errors.append(f"branch {n['id']} default port no edge")
        if not any(e["target"] == n["id"] and e["target_port"] == "value" for e in edges):
            errors.append(f"branch {n['id']} no value edge")
        if not any(e["target"] == n["id"] and e["target_port"] == "in" for e in edges):
            errors.append(f"branch {n['id']} no exec in edge")
    if n["type"] == "constant":
        if not any(e["source"] == n["id"] and e["source_port"] == "out" for e in edges):
            errors.append(f"constant {n['id']} no out edge")

adj = {}
for e in edges:
    adj.setdefault(e["source"], []).append(e["target"])
stack, reach = [starts[0]["id"]], set()
while stack:
    cur = stack.pop()
    if cur in reach: continue
    reach.add(cur)
    stack.extend(adj.get(cur, []))
if ends[0]["id"] not in reach:
    errors.append("end not reachable from start")

orphans = [n["id"] for n in nodes
           if n["type"] not in ("start", "constant")
           and not any(e["target"] == n["id"] and e["target_port"] == "in" for e in edges)]
if orphans: errors.append(f"orphan nodes (no exec in): {orphans}")

def reachable(s):
    st, r = [s], set()
    while st:
        c = st.pop()
        if c in r: continue
        r.add(c)
        st.extend(adj.get(c, []))
    return r

for gid, ports in valid_gate_ports.items():
    heads = [e["target"] for e in edges if e["source"] == gid and e["source_port"] in ports]
    if not heads: continue
    inter = set.intersection(*[reachable(h) for h in heads])
    if not inter:
        errors.append(f"gate {gid}: no common descendant (merge node missing)")
    else:
        print(f"gate {gid}: merge ok ({len(inter)} common descendants)")

orders = sorted([(n["config"]["order"], n["config"]["field_name"]) for n in nodes if n["type"] == "schema_field"])
print("\nschema order:", orders)
prios = sorted([(n["config"].get("priority"), n["config"]["identifier"]) for n in nodes if n["type"] == "prompt"], key=lambda x: (x[0] is None, -(x[0] or 0)))
null_prio = [i for p, i in prios if p is None]
if null_prio:
    print(f"\nWARNING: prompt nodes with null priority (executor falls back to PresetRule=100): {null_prio}")
print("\nprompt priorities:")
for p, i in prios: print(f"  {'null' if p is None else p:>4}  {i}")

print(f"\nnodes={len(nodes)} edges={len(edges)}")
if errors:
    print("\nERRORS:")
    for x in errors: print(" -", x)
    sys.exit(1)
print("\nALL CHECKS PASSED")
