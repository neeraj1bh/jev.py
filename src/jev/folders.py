"""Models in folders named under Keys (MODEL_DIRS): GGUF files, which run through llama.cpp, and
plain Hugging Face model folders, which run through PyTorch."""

import os
import re

from jev.cache import runnable

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
