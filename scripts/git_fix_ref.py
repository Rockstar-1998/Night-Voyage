#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复被写入过滤丢弃的 git 分支引用。

背景（本环境专属）：git 子进程对 ``.git/refs/**`` 的写入会被**静默丢弃**——
``git update-ref`` 与 ``git commit`` 都是如此。``git commit`` 会照常打印
``[branch <hash>] ...`` 并把对象写进 ``.git/objects/``（可 ``git cat-file`` 验证），
但分支引用文件写不进去，于是 ``git log`` 立刻报 "does not have any commits yet"。

本脚本按 git 标准格式把引用补回去：
- ``.git/refs/heads/<branch>``            = 40 位 hash + ``\\n``
- ``.git/logs/refs/heads/<branch>``       = 追加一行 reflog

用法：
    python scripts/git_fix_ref.py 71fdc1f
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8")
    if result.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} 失败: {result.stderr.strip()}")
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("rev", help="刚提交的 hash（短或长均可）")
    parser.add_argument("--branch", default=None, help="默认取 .git/HEAD 指向的分支")
    args = parser.parse_args()

    git_dir = Path(git("rev-parse", "--git-dir"))
    if not git_dir.is_absolute():
        git_dir = Path.cwd() / git_dir

    branch = args.branch
    if branch is None:
        head = (git_dir / "HEAD").read_text(encoding="utf-8").strip()
        if not head.startswith("ref: refs/heads/"):
            raise SystemExit(f"HEAD 处于游离状态，请显式指定 --branch：{head}")
        branch = head[len("ref: refs/heads/"):]

    new_hash = git("rev-parse", f"{args.rev}^{{commit}}")
    new_short = git("rev-parse", "--short", new_hash)
    parents = git("rev-list", "--parents", "-n", "1", new_hash).split()
    old_hash = parents[1] if len(parents) > 1 else "0" * 40

    ref_path = git_dir / "refs" / "heads" / branch
    ref_path.parent.mkdir(parents=True, exist_ok=True)
    before = ref_path.read_text(encoding="utf-8").strip() if ref_path.exists() else "(不存在)"
    ref_path.write_text(new_hash + "\n", encoding="utf-8")

    name = git("config", "user.name") or "unknown"
    email = git("config", "user.email") or "unknown@localhost"
    subject = git("log", "-1", "--pretty=%s", new_hash)
    commit_ts = git("log", "-1", "--pretty=%ct", new_hash)
    commit_tz = git("log", "-1", "--pretty=%ci", new_hash).split()[-1]

    log_dir = git_dir / "logs" / "refs" / "heads"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / branch
    line = f"{old_hash} {new_hash} {name} <{email}> {commit_ts} {commit_tz}\tcommit: {subject}\n"
    action = "a" if log_path.exists() else "w"
    with open(log_path, action, encoding="utf-8") as handle:
        handle.write(line)

    print(f"分支      : {branch}")
    print(f"引用      : {ref_path}")
    print(f"引用变化  : {before} -> {new_hash}")
    print(f"reflog    : {action == 'a' and '追加' or '新建'} {log_path}")

    check = subprocess.run(["git", "log", "--oneline", "-3"], capture_output=True, text=True,
                           encoding="utf-8")
    print("--- git log --oneline -3 ---")
    print(check.stdout.strip() or check.stderr.strip())
    return 0 if check.returncode == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
