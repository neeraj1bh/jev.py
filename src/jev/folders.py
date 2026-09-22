"""Models in folders added in the page: GGUF files, which run through llama.cpp, and plain
Hugging Face model folders, which run through PyTorch. The folders, and the llama-server program
when it is not on the PATH, are kept in data/model-folders.json (git-ignored)."""

import contextlib
import json
import os
import platform
import re
import shutil
import subprocess

from jev.cache import on_disk, runnable
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
            # A Hugging Face cache's own folders are read through the cache, by model name (cache.py).
            subfolders[:] = [s for s in subfolders if not s.startswith((".", "models--")) and s != "blobs"]
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
                    # llama.cpp's cache names files owner_repo-GGUF_file
                    "label": re.sub(r"^.*-GGUF_|-instruct", "", stem, flags=re.IGNORECASE),
                    "gb": _gb(folder, parts),
                    "kind": "gguf",
                }
    return found


def known_folders():
    """Where llama.cpp (llama-server -hf) and LM Studio keep models, when they exist; from WSL,
    also under the Windows user's folder."""
    homes = [os.path.expanduser("~")]
    if "microsoft" in platform.release().lower():
        with contextlib.suppress(OSError, subprocess.CalledProcessError):
            windows = subprocess.run(
                ["cmd.exe", "/c", "echo %USERPROFILE%"],
                capture_output=True,
                text=True,
                check=True,
                cwd="/mnt/c",
            ).stdout
            homes.append(_local(windows))
    places = [".cache/llama.cpp", "AppData/Local/llama.cpp", ".lmstudio/models", ".cache/lm-studio/models"]
    return [os.path.join(h, p) for h in homes for p in places if os.path.isdir(os.path.join(h, p))]


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


def is_hf_cache(folder):
    try:
        return any(e.is_dir() and e.name.startswith("models--") for e in os.scandir(folder))
    except OSError:
        return False


def add(folder, listed=()):
    """Remember a folder that holds models; returns how many it holds. `listed` are the cache
    folders the menu already reads, which need no adding."""
    folder = _local(folder)
    if not os.path.isdir(folder):
        raise ValueError(f"No folder at {folder}")
    if folder in listed:
        raise ValueError("These models are already in the menu.")
    found = len(scan([folder])) + (len(on_disk([folder])) if is_hf_cache(folder) else 0)
    if not found:
        raise ValueError(f"No GGUF files or model folders in {folder}")
    values = settings()
    values["folders"] = list(dict.fromkeys([*values["folders"], folder]))
    _save(values)
    return found


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


SYSTEM = {"/proc", "/sys", "/dev"}  # virtual folders of the running system, never models


def _holds_models(folder, depth=2):
    """A quick look, two levels down, used to mark folders worth opening. Unreadable counts as no."""
    if folder in SYSTEM:
        return False
    try:
        entries = list(os.scandir(folder))
        if any(e.name.lower().endswith(".gguf") for e in entries):
            return True
        files = {e.name: e.path for e in entries if e.is_file()}
        if "config.json" in files and runnable(
            files
        ):  # many tools keep a config.json; a model has weights too
            return True
        subfolders = [e.path for e in entries if e.is_dir(follow_symlinks=False) and e.name[0] != "."]
    except OSError:
        return False
    return depth > 1 and any(_holds_models(f, depth - 1) for f in subfolders)


def roots():
    """Where browsing starts: the home folder, the top of the file system, and the drives."""
    places = [os.path.expanduser("~"), os.path.abspath(os.sep)]
    if os.name == "nt":
        places += [f"{letter}:\\" for letter in "CDEFGH" if os.path.isdir(f"{letter}:\\")]
    elif os.path.isdir("/mnt"):  # WSL mounts the Windows drives here
        places += sorted(os.path.join("/mnt", d) for d in os.listdir("/mnt") if len(d) == 1)
    if os.path.isdir("/Volumes"):  # macOS disks
        places += sorted(os.path.join("/Volumes", d) for d in os.listdir("/Volumes"))
    for mounts in ("/media", "/run/media"):  # Linux: USB and other mounted drives, one folder per user
        if os.path.isdir(mounts):
            places += sorted(os.path.join(mounts, d) for d in os.listdir(mounts))
    return [p for p in dict.fromkeys(places) if _has_entries(p)]


def _has_entries(folder):
    """An unused WSL drive letter is an empty folder."""
    try:
        return os.path.isdir(folder) and any(os.scandir(folder))
    except OSError:
        return False


def _leads_to(folder, places):
    """True when a folder known to hold models is this folder or somewhere below it."""
    return any(p == folder or p.startswith(folder.rstrip(os.sep) + os.sep) for p in places)


def browse(path, files=False, hidden=False, places=()):
    """One folder's subfolders, and with files=True its llama-server programs, for the page's picker;
    folders starting with a dot are left out unless hidden=True. `places` are folders known to hold
    models, so every folder on the way to one is marked, however deep."""
    path = _local(path) if path else os.path.expanduser("~")
    if not os.path.isdir(path):
        raise ValueError(f"No folder at {path}")
    try:
        entries = sorted(os.scandir(path), key=lambda e: e.name.lower())
    except PermissionError:
        raise ValueError(f"No permission to open {path}") from None
    # A hidden folder that leads to models (like ~/.cache) is shown anyway.
    visible = [
        e
        for e in entries
        if not e.name.startswith("$") and (hidden or not e.name.startswith(".") or _leads_to(e.path, places))
    ]
    return {
        "path": path,
        "parent": os.path.dirname(path) if os.path.dirname(path) != path else None,
        "roots": roots(),
        "folders": [
            {"name": e.name, "path": e.path, "models": _leads_to(e.path, places) or _holds_models(e.path)}
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
        "models": _leads_to(path, places) or _holds_models(path),
    }


KNOWN = known_folders()  # looked up once: cmd.exe takes a moment
