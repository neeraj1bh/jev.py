"""The llama-servers jev.py starts for the GGUF models picked in the page: one per model, so two
of them can answer without taking turns. A server stops when it is stopped in the page, after it
has gone unused for a while, or when jev.py exits.

From WSL it can start the Windows build (llama-server.exe), which is how an AMD GPU is used: the
model path is given in Windows form, and the server listens on the Windows side of the WSL link
only, where jev.py reaches it, not on the local network."""

import atexit
import json
import os
import platform
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
from functools import cache
from threading import Lock, Thread

READY_SECONDS = 600  # a 30B model can take minutes to load from a slow disk
IDLE_SECONDS = 15 * 60  # an unused model gives its memory back after this long
CONTEXT = "8192"
LOG = os.path.join(tempfile.gettempdir(), "jev-llama-server.log")
STARTED = os.path.join(tempfile.gettempdir(), "jev-llama-server.json")  # for after a crash
LOCK = Lock()
SERVERS = {}  # GGUF file -> {"process", "url", "used"}


def _wsl_to_windows():
    return "microsoft" in platform.release().lower()


def _windows_address():
    """The Windows host as WSL sees it: the default route."""
    routes = subprocess.run(["ip", "route"], capture_output=True, text=True, check=True).stdout
    return next(line.split()[2] for line in routes.splitlines() if line.startswith("default"))


def _free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@cache
def _fits(binary):
    """Newer builds size the model to the free GPU memory (--fit); older ones take every layer."""
    try:
        return (
            "--fit" in subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=30).stdout
        )
    except (OSError, subprocess.TimeoutExpired):
        return False


def _end_leftovers():
    """llama-servers from a jev.py that was killed outright, ended when the next one starts."""
    try:
        with open(STARTED) as f:
            old = json.load(f)
    except (OSError, ValueError):
        return
    for pid in old:
        try:
            with open(f"/proc/{pid}/cmdline") as f:
                if "llama-server" in f.read():  # not a pid the system gave to something else since
                    os.kill(pid, signal.SIGTERM)
        except (OSError, ValueError):
            pass
    os.unlink(STARTED)


def _remember():
    with open(STARTED, "w") as f:
        json.dump([server["process"].pid for server in SERVERS.values()], f)


def _ready(url):
    try:
        with urllib.request.urlopen(url + "/health", timeout=2) as r:
            return json.loads(r.read()).get("status") == "ok"
    except (OSError, ValueError):  # refused while starting, 503 while loading
        return False


def _start(gguf, binary):
    windows = _wsl_to_windows() and binary.lower().endswith(".exe")
    model = gguf
    if windows:
        model = subprocess.run(["wslpath", "-w", gguf], capture_output=True, text=True, check=True).stdout
    host = _windows_address() if windows else "127.0.0.1"
    port = str(_free_port())
    size = ["--fit", "on"] if _fits(binary) else ["-ngl", "99"]
    with open(LOG, "a") as log:
        process = subprocess.Popen(
            [binary, "-m", model.strip(), "--host", host, "--port", port, "-c", CONTEXT, *size],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    return process, f"http://{host}:{port}"


def serve(gguf, binary):
    """The base URL of a llama-server running gguf, starting one if it is not running yet."""
    with LOCK:
        if running(gguf):
            SERVERS[gguf]["used"] = time.time()
            return SERVERS[gguf]["url"]
        if not SERVERS:
            _end_leftovers()
        process, url = _start(gguf, binary)
        SERVERS[gguf] = {"process": process, "url": url, "used": time.time()}
        _remember()
        deadline = time.time() + READY_SECONDS
        while time.time() < deadline:
            if process.poll() is not None:
                stop(gguf)
                raise ValueError(f"llama-server stopped while loading {os.path.basename(gguf)}; see {LOG}")
            if _ready(url):
                return url
            time.sleep(1)
        stop(gguf)
        raise ValueError(f"llama-server was not ready after {READY_SECONDS // 60} minutes; see {LOG}")


def running(gguf=None):
    """Whether that GGUF file has a llama-server, or the list of the files that do."""
    alive = [f for f, server in SERVERS.items() if server["process"].poll() is None]
    return gguf in alive if gguf else alive


def stop(gguf=None):
    """Stop one model's llama-server, or all of them."""
    for f in [gguf] if gguf else list(SERVERS):
        server = SERVERS.pop(f, None)
        if server and server["process"].poll() is None:
            server["process"].terminate()
            try:
                server["process"].wait(10)
            except subprocess.TimeoutExpired:
                server["process"].kill()
    if SERVERS:
        _remember()
    elif os.path.exists(STARTED):
        os.unlink(STARTED)


def _stop_when_idle():
    while True:
        time.sleep(60)
        with LOCK:
            for f in running():
                if time.time() - SERVERS[f]["used"] > IDLE_SECONDS:
                    stop(f)


atexit.register(stop)
Thread(target=_stop_when_idle, daemon=True).start()
