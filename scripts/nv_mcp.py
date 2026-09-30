#!/usr/bin/env python
"""Night Voyage dev-time MCP endpoint: thin CLI driver.

Why this exists
---------------
The rolling-development workflow needs to poke the running client's MCP endpoint
without re-running the whole E2E suite (`scripts/mcp_endpoint_e2e.py`).  This is
the minimal, dependency-free driver used for live demos and for iterating on new
tools.

Usage
-----
    python scripts/nv_mcp.py tools
    python scripts/nv_mcp.py call nv_db_info
    python scripts/nv_mcp.py call nv_conversations_list '{"limit": 5}'
    python scripts/nv_mcp.py raw '{"jsonrpc":"2.0","id":1,"method":"ping"}'

Notes
-----
* Uses a *direct* connection (`ProxyHandler({})`).  This machine sets
  HTTP_PROXY/HTTPS_PROXY with no NO_PROXY, so urllib would otherwise route the
  loopback request through the proxy.
* Never writes to the DB on its own; it only calls the endpoint.  Any mutation is
  whatever tool you asked for, executed by the real backend.
"""

import json
import os
import sys
import urllib.error
import urllib.request

ENDPOINT = "http://127.0.0.1:55287/mcp"
TOKEN_FILE = r"D:\software_cache\night-voyage-mcp.token"

_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def load_token():
    if not os.path.exists(TOKEN_FILE):
        sys.exit("token file missing: %s" % TOKEN_FILE)
    with open(TOKEN_FILE, "r", encoding="utf-8") as fh:
        return fh.read().strip()


def rpc(payload, token, endpoint=ENDPOINT):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "X-NV-Token": token,
        },
        method="POST",
    )
    try:
        with _OPENER.open(req, timeout=30) as resp:
            raw = resp.read().decode("utf-8", "replace")
            status = resp.status
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        status = exc.code
    except urllib.error.URLError as exc:
        sys.exit(
            "transport error: %s\n"
            "(if the client is not running, or the proxy env vars are leaking, "
            "this is expected)" % exc
        )
    print("[http %s]" % status)
    try:
        print(json.dumps(json.loads(raw), ensure_ascii=False, indent=2))
    except ValueError:
        print(raw)
    return raw


def call_tool(name, args, token):
    return rpc(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": args},
        },
        token,
    )


def main(argv):
    if len(argv) < 2:
        sys.exit(__doc__)
    token = load_token()
    cmd = argv[1]

    if cmd == "tools":
        return rpc({"jsonrpc": "2.0", "id": 1, "method": "tools/list"}, token)

    if cmd == "call":
        if len(argv) < 3:
            sys.exit("usage: nv_mcp.py call <tool> [json-args]")
        name = argv[2]
        args = json.loads(argv[3]) if len(argv) > 3 else {}
        return call_tool(name, args, token)

    if cmd == "raw":
        if len(argv) < 3:
            sys.exit("usage: nv_mcp.py raw '<json-rpc payload>'")
        return rpc(json.loads(argv[2]), token)

    sys.exit("unknown command: %s" % cmd)


if __name__ == "__main__":
    main(sys.argv)
