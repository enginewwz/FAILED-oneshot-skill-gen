#!/usr/bin/env bash
# Copy one session (and its workspace record) from the main dsh home to the dev home.
# Usage: scripts/seed-session.sh [session-id]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DST_HOME="${DSH_SKILLGEN_HOME:-$ROOT/.dsh}"
SRC_HOME="${DSH_SEED_SOURCE_HOME:-$HOME/.dsh}"
SESSION_ID="${1:-}"

python3 - "$ROOT" "$SRC_HOME" "$DST_HOME" "$SESSION_ID" <<'PY'
import json
import os
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path

project = Path(sys.argv[1])
src_home = Path(sys.argv[2])
dst_home = Path(sys.argv[3])
want = sys.argv[4]

def load(path):
    with path.open() as f:
        return json.load(f)

def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())

def header_of(session_dir):
    bundle = session_dir / "session.v4.jsonl.zstd"
    try:
        out = subprocess.run(
            ["zstd", "-dc", str(bundle)],
            check=True, capture_output=True, text=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        sys.exit(f"cannot read session header from {bundle}: {error}")
    return json.loads(out.stdout.splitlines()[0])

src_registry = src_home / "storages" / "workspace.json"
registry = load(src_registry) if src_registry.is_file() else {}
workspaces = registry.get("tables", {}).get("workspaces", {})

def workspace_for(sid):
    return next(((wid, w) for wid, w in workspaces.items()
                 if sid in w.get("sessionIds", [])), None)

# Pick the requested session, or the newest session of this project's workspace.
if want:
    matches = list((src_home / "sessions").glob(f"*/{want}"))
    if not matches:
        sys.exit(f"no session directory named {want} under {src_home / 'sessions'}")
    session_dir = matches[0]
else:
    found = next(((wid, w) for wid, w in workspaces.items()
                  if w.get("path") == str(project)), None)
    if found is None:
        sys.exit(f"no workspace for {project} in {src_registry}; pass a session id explicitly")
    ids = found[1].get("sessionIds", [])
    candidates = [p for sid in ids for p in (src_home / "sessions").glob(f"*/{sid}")]
    if not candidates:
        sys.exit(f"no session directory found for workspace {project}")
    session_dir = max(candidates, key=lambda p: p.stat().st_mtime)

sid = session_dir.name
if not sid.startswith("session-"):
    sys.exit(f"unexpected session directory name: {session_dir}")

# Find its workspace in the source registry; fall back to the log header.
found = workspace_for(sid)
if found is not None:
    src_id, workspace = found
    workspace_path = workspace.get("path", "")
    workspace_title = workspace.get("title") or Path(workspace_path).name
else:
    header = header_of(session_dir)
    workspace_path = header.get("cwd") or str(project)
    workspace_title = Path(workspace_path).name
    src_id = str(uuid.uuid4())
    workspace = {
        "path": workspace_path,
        "title": workspace_title,
        "sessionIds": [sid],
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
    }

# Copy the log files (the lock belongs to the running source instance).
slug = session_dir.parent.name
dest_dir = dst_home / "sessions" / slug / sid
dest_dir.mkdir(parents=True, exist_ok=True)
for item in session_dir.iterdir():
    if item.is_file() and item.name != "session.lock":
        shutil.copy2(item, dest_dir / item.name)

# Merge the workspace into the destination registry, matching by path.
dst_registry = dst_home / "storages" / "workspace.json"
if dst_registry.is_file():
    dst = load(dst_registry)
else:
    dst = {
        "unit": {"name": "workspace", "version": 2},
        "global": {"initialized": True, "workspaceIds": [],
                   "archivedSessionIds": [], "pinnedSessionIds": []},
        "tables": {"workspaces": {}},
    }
dst.setdefault("unit", {"name": "workspace", "version": 2})
dst.setdefault("global", {})
dst.setdefault("tables", {}).setdefault("workspaces", {})
g = dst["global"]
g["initialized"] = True
g.setdefault("workspaceIds", [])
g.setdefault("archivedSessionIds", [])
g.setdefault("pinnedSessionIds", [])

target = next((w for w in dst["tables"]["workspaces"].values()
               if w.get("path") == workspace_path), None)
if target is None:
    target_id = src_id
    if target_id in dst["tables"]["workspaces"]:
        target_id = str(uuid.uuid4())
    target = dict(workspace)
    target["sessionIds"] = []
    dst["tables"]["workspaces"][target_id] = target
else:
    target_id = next(k for k, v in dst["tables"]["workspaces"].items() if v is target)

ids = target.setdefault("sessionIds", [])
if sid not in ids:
    ids.append(sid)
target["updatedAt"] = now_iso()
if target_id not in g["workspaceIds"]:
    g["workspaceIds"].append(target_id)
g["archivedSessionIds"] = [s for s in g["archivedSessionIds"] if s != sid]

dst_registry.parent.mkdir(parents=True, exist_ok=True)
tmp = dst_registry.with_suffix(".json.tmp")
with tmp.open("w") as f:
    json.dump(dst, f, indent=2, ensure_ascii=False)
os.replace(tmp, dst_registry)

print(f"seeded session: {sid}")
print(f"  from:      {session_dir}")
print(f"  to:        {dest_dir}")
print(f"  workspace: {target_id} ({workspace_path})")
print(f"  title:     {workspace_title}")
if workspace_path != str(project):
    print("  note:      session belongs to another workspace; the dev GUI will show it there")
PY
