"""The comparison page's server: its API and the built page.

Compare sends the same request to several models side by side, local, a llama.cpp server or
hosted; Generate vs readout asks one model to write its answers and to read them from its
probabilities. Nothing is loaded at start. A local model is downloaded when first picked: into the
Hugging Face cache if it is already there, else into ./models (git-ignored; JEV_MODELS overrides).

    uv run prod [model_id] [port]     # then open http://localhost:8080
"""

import contextlib
import gc
import gzip
import json
import mimetypes
import os
import random
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock, Thread

from huggingface_hub.constants import HF_HUB_CACHE

from jev.bench import core_v1, datasets
from jev.bench.datasets import dataset_path, typesafe_item, typesafe_rows
from jev.bench.sets import OTHERS, SETS, Labelled
from jev.core import DEFAULT_MODEL, ROOT, Jev, gpu_hint
from jev.dev import NO_NODE, page_tools
from jev.local import cache, downloads, folders, llamaserver
from jev.local.downloads import PROGRESS
from jev.page.catalog import CHECKED, gateway
from jev.page.keys import clear_key, keys, set_key
from jev.page.models import (
    DEVICE,
    LOADED,
    MODELS,
    add_model,
    backends,
    caches,
    download_model,
    folder_state,
    generate,
    generate_remote,
    get,
    in_cache,
    local_ids,
    model_dirs,
    model_places,
)
from jev.page.runs import log_row, run_body, runs, text_answers
from jev.remote import BACKENDS, PROBABILITIES_ONLY, NoProbabilities, Remote, env

WEB = os.path.join(ROOT, "web", "dist")  # the built page; see web/

CORE = ("Core v1",)  # frozen benchmarks, see bench/core_v1.py
try:  # input tokens per item, measured by `jev-bench tokens`, for the page's cost estimates
    with open(os.path.join(ROOT, "benchmarks", "core-v1-tokens.json")) as f:
        SIZES = json.load(f)["per_item"]
except (OSError, ValueError):
    SIZES = {}
CORE_ITEMS = {}

DECKS = {}  # dataset name -> row indices not dealt yet, so a batch never repeats an item


class Exhausted(Exception):
    pass


def deal(name, size, fresh):
    """The next unseen row index; a fresh deck on request, never a silent reshuffle."""
    if fresh or name not in DECKS:
        DECKS[name] = random.sample(range(size), size)
    if not DECKS[name]:
        raise Exhausted(f"all {size} items of {name} are done")
    return DECKS[name].pop()


def sample(name, fresh=False, wide=False):
    """One random labelled item as a request, plus its truth. The first call per dataset
    downloads about 300 rows spread over the set into DATA; later calls deal from them."""
    if name in CORE:
        deck = f"{name} + wide" if wide else name  # wide: every picked model reads over 26 options
        if deck not in CORE_ITEMS:
            CORE_ITEMS[deck] = core_v1.load("main") + (core_v1.load("wide") if wide else [])
        items = CORE_ITEMS[deck]
        return items[deal(deck, len(items), fresh)] | {"pool": len(items), "left": len(DECKS[deck])}
    if name == "TypeSafe cases":
        cases = typesafe_rows()
        item = typesafe_item(*cases[deal(name, len(cases), fresh)])
        return item | {"pool": len(cases), "left": len(DECKS[name])}
    page = datasets.download(name)
    rows = datasets.labelled_rows(name, page)
    item = datasets.row_item(name, page, rows[deal(name, len(rows), fresh)])
    return item | {"pool": len(rows), "left": len(DECKS[name])}


def dataset_menu():
    """Every set the page offers, with what its menu shows, in the order of its headings."""
    hf_token = bool(env("HF_TOKEN"))
    fetch = core_v1.pages_to_fetch()
    sets = [
        {
            "name": name, "options": 26, "yes_no": False, "frozen": True,
            "local": not fetch["pages"], "fetch": fetch, "items": core_v1.size(),
            "fetch_wide": core_v1.pages_to_fetch("wide"),
            "needs_token": any(s.gated for s in SETS.values()) and not hf_token,  # GPQA is in Core v1
        }
        for name in CORE
    ]  # fmt: skip
    sets += [
        {
            "name": name,
            "options": s.options,
            "yes_no": isinstance(s, Labelled) and s.yes is not None,
            "needs_token": s.gated and not hf_token,
            "local": os.path.exists(dataset_path(name)),
        }
        for name, s in SETS.items()
    ]
    typesafe = os.path.isdir(os.path.join(ROOT, "results", "typesafe"))
    sets.append({"name": "TypeSafe cases", "options": None, "local": typesafe})
    for entry in sets:
        record = SETS.get(entry["name"])
        entry["group"], entry["about"] = (record.group, record.about) if record else OTHERS[entry["name"]]
        entry |= SIZES.get(entry["name"], {})
    headings = list(dict.fromkeys(x["group"] for x in sets))
    return sorted(sets, key=lambda x: headings.index(x["group"]))


def progress():
    """Everything downloading now: datasets by pages, models by bytes."""
    return {k: {"done": done, "total": total, "unit": unit} for k, (done, total, unit) in PROGRESS.items()}


SAMPLE_LOCK = Lock()

SYSTEMS = {}  # backend id -> the system it answers as, also logged with the rows of its failed items


def presets():
    """Model lists frozen with a benchmark, e.g. Core v1's, for one-click selection in the page."""
    path = os.path.join(ROOT, "benchmarks", "core-v1-models.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        frozen = json.load(f)
    lists = {"Core v1 models": frozen["models"], "Core v1 optional": frozen.get("optional", [])}
    return [{"name": n, "dataset": "Core v1", "models": [m["id"] for m in ms]} for n, ms in lists.items()]


CHANGES_FILES = ("/key", "/models", "/folders", "/delete", "/download")  # answer this machine only


def page_is_stale(index):
    """True when the page's source changed after the last build, as after a git pull."""
    source = os.path.join(ROOT, "web")
    built = os.path.getmtime(index)
    paths = [os.path.join(source, f) for f in ("index.html", "package.json", "vite.config.ts")]
    paths += [os.path.join(d, f) for d, _, fs in os.walk(os.path.join(source, "src")) for f in fs]
    return any(os.path.getmtime(p) > built for p in paths if os.path.exists(p))


def main(model_id=DEFAULT_MODEL, port=8080):
    started_with = [] if model_id == DEFAULT_MODEL else [model_id]  # a model named at start is listed

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # chunked streaming needs 1.1; 1.0 clients would see the size markers

        def _send(self, code, data, ctype="application/json"):
            # The page may reload or close before the answer arrives.
            with contextlib.suppress(BrokenPipeError, ConnectionResetError):
                self._write(code, data, ctype)

        def _write(self, code, data, ctype):
            # A 9-model run is 11 MB of JSON; compressed it is a tenth of that.
            if len(data) > 64_000 and "gzip" in self.headers.get("accept-encoding", ""):
                data = gzip.compress(data, compresslevel=1)
                self.send_response(code)
                self.send_header("content-encoding", "gzip")
            else:
                self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path.endswith("/backends"):
                return self._send(200, json.dumps(backends(started_with)).encode())
            if self.path.endswith("/gateway"):
                return self._send(200, json.dumps(gateway()).encode())
            if self.path.endswith("/runs"):
                return self._send(200, json.dumps(runs()).encode())
            if "/run?" in self.path:
                name = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)["name"][0]
                return self._send(200, run_body(name))
            if self.path.endswith("/progress"):
                return self._send(200, json.dumps(progress()).encode())
            if self.path.endswith("/folders"):
                return self._send(200, json.dumps(folder_state()).encode())
            if "/browse" in self.path:
                if not self.from_this_machine():
                    return self._send(
                        403, b'{"error": {"message": "folders can only be browsed from this machine"}}'
                    )
                query = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
                try:
                    path = query.get("path", [""])[0]
                    listing = folders.browse(
                        path, files="files" in query, hidden="hidden" in query, places=model_places()
                    )
                    shown = listing["path"]
                    listing["listed"] = shown in (HF_HUB_CACHE, MODELS, *model_dirs()) or in_cache(shown)
                except ValueError as e:
                    return self._send(400, json.dumps({"error": {"message": str(e)}}).encode())
                return self._send(200, json.dumps(listing).encode())
            if self.path.endswith("/presets"):
                return self._send(200, json.dumps(presets()).encode())
            if self.path.endswith("/keys"):
                return self._send(200, json.dumps(keys()).encode())
            if self.path.endswith("/datasets"):
                return self._send(200, json.dumps(dataset_menu()).encode())
            path = urllib.parse.urlparse(self.path).path
            file = os.path.normpath(os.path.join(WEB, path.lstrip("/")))
            if path != "/" and file.startswith(WEB + os.sep) and os.path.isfile(file):
                kind = mimetypes.guess_type(file)[0] or "application/octet-stream"
                with open(file, "rb") as f:
                    return self._send(200, f.read(), kind)
            index = os.path.join(WEB, "index.html")
            if not os.path.exists(index) or page_is_stale(index):
                why = "is older than its source" if os.path.exists(index) else "is not built yet"
                message = f"The page {why}. Build it with: cd web && pnpm install && pnpm build\n"
                return self._send(503, message.encode(), "text/plain; charset=utf-8")
            with open(index, encoding="utf-8") as f:
                html = f.read().replace("{{model}}", model_id)
            self._send(200, html.encode(), "text/html; charset=utf-8")

        def from_this_machine(self):
            return self.client_address[0] in ("127.0.0.1", "::1")

        def from_elsewhere(self):
            """A request another website's page sent: it could spend your keys or replace them."""
            origin = self.headers.get("origin")
            host = urllib.parse.urlparse(origin).hostname if origin else None
            return origin is not None and host not in ("localhost", "127.0.0.1", "[::1]", "::1")

        def do_POST(self):
            if self.from_elsewhere():
                return self._send(403, b'{"error": {"message": "requests from other sites are refused"}}')
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                if self.path.endswith(CHANGES_FILES) and not self.from_this_machine():
                    raise ValueError("keys, models and folders can only be changed from this machine")
                if self.path.endswith("/stop") and body.get("backend") in CORE:  # Core v1's rows, not a model
                    core_v1.STOP.set()
                    return self._send(200, b"{}")
                if self.path.endswith("/sample"):
                    with SAMPLE_LOCK:  # batches ask in parallel; one download and one deck per set
                        try:
                            item = sample(body["dataset"], body.get("fresh", False), body.get("wide", False))
                        except Exhausted as e:
                            return self._send(409, json.dumps({"error": {"message": str(e)}}).encode())
                    return self._send(200, json.dumps(item).encode())
                if self.path.endswith("/key"):
                    if body.get("clear"):
                        clear_key(body["backend"])
                    else:
                        set_key(body["backend"], body["key"].strip(), body.get("save", False))
                    return self._send(200, b"{}")
                if self.path.endswith("/models"):
                    add_model(body["id"].strip())
                    return self._send(200, b"{}")
                if self.path.endswith("/folders"):
                    if "add" in body:
                        if in_cache(folders.local_path(body["add"])):
                            raise ValueError("These models are already in the menu.")
                        folders.add(body["add"], listed=(HF_HUB_CACHE, MODELS))
                    elif "remove" in body:
                        folders.remove(body["remove"])
                    elif "find_llama_server" in body:
                        folders.set_llama_server(folders.find_program(body["find_llama_server"]))
                    else:
                        folders.set_llama_server(body["llama_server"])
                    return self._send(200, json.dumps(folder_state()).encode())
                bid = body.get("backend") or model_id
                if not bid.startswith(("remote:", "openrouter:")) and bid not in local_ids([model_id])[0]:
                    raise ValueError(f"{bid} is not in the model menu; add it there first")
                if self.path.endswith("/stop"):  # a download, or the llama-server of a GGUF model
                    if bid.startswith("gguf:"):
                        llamaserver.stop(bid.removeprefix("gguf:"))
                    downloads.stop(bid)
                    return self._send(200, b"{}")
                if self.path.endswith("/delete"):
                    LOADED.pop(bid, None)
                    gc.collect()
                    freed = cache.delete(bid, caches())
                    return self._send(200, json.dumps({"freed": freed}).encode())
                if self.path.endswith("/download"):  # picked in the menu: fetch now, load at run time
                    download_model(bid)
                    return self._send(200, b"{}")
                was_running = set(llamaserver.running())
                jev = get(bid)
                SYSTEMS[bid] = core_v1.system(bid, jev)
                by_path = {m["path"]: m for m in backends([]) if m["group"] == "gguf"}
                gone = was_running - set(llamaserver.running())
                stopped_for_room = [by_path[p]["label"] for p in gone if p in by_path]
                if self.path.endswith("/load"):  # downloads a local model the first time
                    answer = {"device": jev.device, "stopped": stopped_for_room}
                    return self._send(200, json.dumps(answer).encode())
                if self.path.endswith("/generate"):
                    if isinstance(jev, Remote) and jev.backend in PROBABILITIES_ONLY:
                        raise ValueError("This model returns probabilities only; it does not write text")
                    make = generate if isinstance(jev, Jev) else generate_remote
                    started = time.time()
                    pieces = make(jev, body["state"], body["questions"])
                    head = next(pieces, "")  # errors surface here, before the stream starts
                    self.send_response(200)
                    self.send_header("content-type", "text/plain; charset=utf-8")
                    self.send_header("transfer-encoding", "chunked")
                    self.end_headers()
                    text = []
                    for piece in [head, *pieces] if head else pieces:
                        text.append(piece)
                        chunk = piece.encode()
                        if not chunk:  # a zero-length chunk would end the stream
                            continue
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                    if body.get("log"):  # the written side of generate vs readout
                        answers = text_answers("".join(text), body["questions"])
                        log_row(
                            body,
                            (body.get("backend") or model_id) + "#text",
                            answers,
                            round((time.time() - started) * 1000),
                        )
                    return
                started = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - started) * 1000)
                if body.get("log"):  # every run is kept, with its input, label and the system that answered
                    log_row(body | {"system": SYSTEMS[bid]}, bid, res["answers"], res["latency_ms"], res)
                self._send(200, json.dumps(res).encode())
            except Exception as e:
                bid = body.get("backend") or model_id
                msg = str(e)
                gateway_model = bid.startswith("openrouter:")
                rejected = isinstance(e, urllib.error.HTTPError) and e.code in (401, 403)
                if self.path.endswith("/key") and rejected:
                    msg = f"That key was rejected (HTTP {e.code}). Nothing was saved."
                elif isinstance(e, NoProbabilities) and gateway_model:
                    CHECKED[bid] = False  # it drops out of the list on the next refresh
                    model = bid.split("/")[-1]
                    msg = f"{model} answered without probabilities, so it cannot be read this way."
                elif isinstance(e, urllib.error.HTTPError) and gateway_model and e.code == 404:
                    model = bid.split("/")[-1]
                    msg = f"OpenRouter has no provider for {model} that returns probabilities right now."
                elif isinstance(e, urllib.error.HTTPError) and bid.startswith(("remote:", "openrouter:")):
                    LOADED.pop(bid, None)  # the next try re-reads .env
                    name = next((x["label"] for x in backends([]) if x["id"] == bid), bid.split("/")[-1])
                    var = BACKENDS["openrouter" if gateway_model else bid.split(":", 1)[1]][0]
                    fix = "That key was rejected." if self.path.endswith("/key") else f"Check {var} in .env."
                    msg = f"{name} answered HTTP {e.code} ({e.reason})" + (
                        f". {fix}" if e.code in (401, 403) else "."
                    )
                elif isinstance(e, urllib.error.URLError):
                    LOADED.pop(bid, None)
                    msg = f"Could not reach {bid.split(':', 1)[-1]}: {e.reason}"
                # a failed item is still logged, as the system the run's answered items name, so it counts
                # as wrong in that run; the page starts every model before a run, so only a model this
                # server never started is logged by its id alone
                if self.path.endswith("/systemone") and body.get("log"):
                    system = SYSTEMS.get(bid, {"id": bid})
                    log_row(body | {"system": system}, bid, {}, 0, {"answers": {}, "error": msg})
                self._send(400, json.dumps({"error": {"message": msg}}).encode())

        def log_message(self, fmt, *args):
            if self.path.endswith("/progress"):
                return  # polled every second while the page is open
            sys.stderr.write(f"{self.command} {self.path} {args[1] if len(args) > 1 else ''}\n")

    print(f"open http://localhost:{port}  ({DEVICE}; models in {HF_HUB_CACHE} or {MODELS})")
    if hint := gpu_hint():
        print(hint)
    Thread(target=runs, daemon=True).start()  # summarise the saved runs before Past runs is opened
    # `kill` ends the server like Ctrl+C does, and llama-server stops with it.
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    # This machine only; JEV_HOST=0.0.0.0 opens the page and its models to the local network.
    server = ThreadingHTTPServer((os.environ.get("JEV_HOST", "127.0.0.1"), port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
    finally:
        server.server_close()
        # Exit at once: a normal exit first waits for a model still generating or a download still
        # fetching, which held Ctrl-C for minutes. Saved runs are written a row at a time.
        llamaserver.stop()
        sys.stdout.flush()
        os._exit(0)


def build_page():
    """Builds the page when it is missing or older than its source, as after a pull. Without Node
    the server still starts and the page says how to build it."""
    index = os.path.join(WEB, "index.html")
    if os.path.exists(index) and not page_is_stale(index):
        return
    try:
        script = page_tools()
        if not script:
            print(NO_NODE)
            return
        subprocess.run([*script, "build"], cwd=os.path.dirname(WEB), check=True)
    except (OSError, subprocess.CalledProcessError) as e:
        print(f"the page was not built ({e}); open the server for the steps")


def cli(build=True):
    args = sys.argv[1:]
    if args and args[0].startswith("-"):  # e.g. `uv run prod --no-sync`, where uv passes the flag on
        raise SystemExit(f"prod takes a model and a port, not {args[0]}; uv's own flags go before prod")
    if build:
        build_page()
    main(*args[:1], **({"port": int(args[1])} if len(args) > 1 else {}))


if __name__ == "__main__":
    cli()
