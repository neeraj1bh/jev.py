"""Models in folders added in the page: GGUF files, which run through llama.cpp, and plain
Hugging Face model folders, which run through PyTorch. The folders, and the llama-server program
when it is not on the PATH, are kept in data/model-folders.json (git-ignored)."""

import json
import os
import platform
import re
import shutil
import subprocess

from jev.cache import runnable
from jev.core import ROOT

PATH = os.path.join(ROOT, "data", "model-folders.json")

SHARD = re.compile(r"-(\d{5})-of-\d{5}\.gguf$", re.IGNORECASE)


def _gb(folder, names):
    return round(sum(os.path.getsize(os.path.join(folder, n)) for n in names) / 1e9, 1)


def scan(dirs):
    """{id: {"label", "gb", "kind"}}. A GGUF model's id is "gguf:" and the path of its first file
    (llama.cpp finds the other shards itself); a model folder's id is its path."""
    found = {}
    # Walks the whole tree: quick for a models folder, slow if pointed at a home folder.
    for top in dirs:
        for folder, subfolders, files in os.walk(top):
            subfolders[:] = [s for s in subfolders if not s.startswith(".")]
            if runnable({f: os.path.join(folder, f) for f in files}):
                found[folder] = {
                    "label": os.path.basename(folder),
                    "gb": _gb(folder, files),
                    "kind": "folder",
                }
                continue
            for name in files:
                # mmproj files hold a vision encoder, not a model
                if not name.lower().endswith(".gguf") or name.lower().startswith("mmproj"):
                    continue
                shard = SHARD.search(name)
                if shard and shard.group(1) != "00001":
                    continue
                stem = SHARD.sub("", name) if shard else name[: -len(".gguf")]
                parts = [f for f in files if SHARD.sub("", f) == stem] if shard else [name]
                found["gguf:" + os.path.join(folder, name)] = {
                    "label": stem,
                    "gb": _gb(folder, parts),
                    "kind": "gguf",
                }
    return found


def settings():
    try:
        with open(PATH) as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"folders": [], "llama_server": ""}


def _save(values):
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as f:
        json.dump(values, f, indent=1)


def _local(path):
    """A path as this machine names it; in WSL, C:\\models becomes /mnt/c/models."""
    path = os.path.expanduser(path.strip())
    if "microsoft" in platform.release().lower() and re.match(r"^[A-Za-z]:[\\/]", path):
        path = subprocess.run(["wslpath", "-u", path], capture_output=True, text=True, check=True).stdout
    return os.path.abspath(path.strip())


def add(folder):
    """Remember a folder that holds models; returns how many it holds."""
    folder = _local(folder)
    if not os.path.isdir(folder):
        raise ValueError(f"No folder at {folder}")
    found = scan([folder])
    if not found:
        raise ValueError(f"No GGUF files or model folders in {folder}")
    values = settings()
    values["folders"] = list(dict.fromkeys([*values["folders"], folder]))
    _save(values)
    return len(found)


def remove(folder):
    values = settings()
    values["folders"] = [f for f in values["folders"] if f != folder]
    _save(values)


def llama_server():
    """The llama-server program: the one set in the page, else one on the PATH."""
    return (
        settings().get("llama_server")
        or shutil.which("llama-server")
        or shutil.which("llama-server.exe")
        or ""
    )


def set_llama_server(path):
    path = _local(path)
    if not (os.path.isfile(path) and os.access(path, os.X_OK)):
        raise ValueError(f"{path} is not a program this machine can run")
    values = settings()
    values["llama_server"] = path
    _save(values)
