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
                    "label": re.sub("-instruct", "", stem, flags=re.IGNORECASE),
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


def _holds_models(folder, depth=2):
    """A quick look, two levels down, used to mark folders worth opening."""
    try:
        entries = list(os.scandir(folder))
    except OSError:
        return False
    if any(e.name == "config.json" or e.name.lower().endswith(".gguf") for e in entries):
        return True
    return depth > 1 and any(
        _holds_models(e.path, depth - 1)
        for e in entries
        if e.is_dir(follow_symlinks=False) and e.name[0] != "."
    )


def roots():
    """Where browsing starts: the home folder, the top of the file system, and the drives."""
    places = [os.path.expanduser("~"), os.path.abspath(os.sep)]
    if os.name == "nt":
        places += [f"{letter}:\\" for letter in "CDEFGH" if os.path.isdir(f"{letter}:\\")]
    elif os.path.isdir("/mnt"):  # WSL mounts the Windows drives here
        places += sorted(os.path.join("/mnt", d) for d in os.listdir("/mnt") if len(d) == 1)
    if os.path.isdir("/Volumes"):  # macOS disks
        places += sorted(os.path.join("/Volumes", d) for d in os.listdir("/Volumes"))
    return [p for p in dict.fromkeys(places) if _has_entries(p)]


def _has_entries(folder):
    """An unused WSL drive letter is an empty folder."""
    try:
        return os.path.isdir(folder) and any(os.scandir(folder))
    except OSError:
        return False


def browse(path, files=False):
    """One folder's subfolders, and with files=True its llama-server programs, for the page's picker."""
    path = _local(path) if path else os.path.expanduser("~")
    if not os.path.isdir(path):
        raise ValueError(f"No folder at {path}")
    try:
        entries = sorted(os.scandir(path), key=lambda e: e.name.lower())
    except PermissionError:
        raise ValueError(f"No permission to open {path}") from None
    visible = [e for e in entries if not e.name.startswith((".", "$"))]
    return {
        "path": path,
        "parent": os.path.dirname(path) if os.path.dirname(path) != path else None,
        "roots": roots(),
        "folders": [
            {"name": e.name, "path": e.path, "models": _holds_models(e.path)}
            for e in visible
            if e.is_dir(follow_symlinks=False)
        ],
        "files": [
            {"name": e.name, "path": e.path}
            for e in visible
            if files and e.is_file() and e.name.lower() in ("llama-server", "llama-server.exe")
        ]
        if files
        else [],
        "models": _holds_models(path),
    }
