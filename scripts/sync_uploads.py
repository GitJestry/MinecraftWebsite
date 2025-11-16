#!/usr/bin/env python3
"""Synchronize Dropbox files into the repository.

This script downloads files from a Dropbox folder (or subtree) and
writes them into the repository so that GitHub Actions can commit the
changes. Only the ``assets`` and ``downloads`` directories are synced.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from typing import Dict, Iterable, List

import requests

DROPBOX_API = "https://api.dropboxapi.com/2"
DROPBOX_CONTENT_API = "https://content.dropboxapi.com/2"
ALLOWED_ROOTS = {"assets", "downloads"}


def _require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def list_dropbox_files(token: str, root_path: str) -> Iterable[Dict[str, object]]:
    """Yield metadata dictionaries for every file under ``root_path``."""

    url = f"{DROPBOX_API}/files/list_folder"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {
        "path": root_path,
        "recursive": True,
        "include_media_info": False,
        "include_deleted": False,
    }

    while True:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        for entry in data.get("entries", []):
            if entry.get(".tag") == "file":
                yield entry
        if not data.get("has_more"):
            break
        payload = {"cursor": data["cursor"]}
        url = f"{DROPBOX_API}/files/list_folder/continue"


def download_file(token: str, path: str) -> bytes:
    headers = {
        "Authorization": f"Bearer {token}",
        "Dropbox-API-Arg": json.dumps({"path": path}),
    }
    response = requests.post(
        f"{DROPBOX_CONTENT_API}/files/download", headers=headers, timeout=60
    )
    response.raise_for_status()
    return response.content


def should_sync(repo_root: Path, rel_path: Path, size: int) -> bool:
    if not rel_path.parts:
        return False
    if rel_path.parts[0] not in ALLOWED_ROOTS:
        return False
    local_file = repo_root / rel_path
    if not local_file.exists():
        return True
    return local_file.stat().st_size != size


def main() -> int:
    token = _require_env("DROPBOX_ACCESS_TOKEN")
    root_path = os.environ.get("DROPBOX_ROOT_PATH", "")
    repo_root = Path(os.environ.get("GITHUB_WORKSPACE", ".")).resolve()

    synced_files: List[str] = []
    for entry in list_dropbox_files(token, root_path):
        dropbox_path = entry["path_display"]
        rel_part = dropbox_path[len(root_path) :].lstrip("/") if root_path else dropbox_path.lstrip("/")
        rel_path = Path(rel_part)
        if not should_sync(repo_root, rel_path, int(entry["size"])):
            continue
        target_file = repo_root / rel_path
        target_file.parent.mkdir(parents=True, exist_ok=True)
        file_bytes = download_file(token, entry["path_lower"])
        target_file.write_bytes(file_bytes)
        synced_files.append(str(rel_path))
        print(f"Downloaded {rel_path} ({len(file_bytes)} bytes)")

    if not synced_files:
        print("No files needed syncing.")
    else:
        print("Synced files:\n" + "\n".join(f" - {path}" for path in synced_files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
