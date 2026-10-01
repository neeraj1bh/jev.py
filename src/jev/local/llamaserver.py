"""The llama-servers jev.py starts for the GGUF models picked in the page: one per model, so two
of them can answer without taking turns. A server stops when it is stopped in the page, after it
has gone unused for a while, or when jev.py exits.

From WSL it can start the Windows build (llama-server.exe), which is how an AMD GPU is used: the
model path is given in Windows form, and the server listens on the Windows side of the WSL link
only, where jev.py reaches it, not on the local network."""

import atexit
import ctypes
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
BUDGET = 0.7  # models running together may take this much of the machine's memory
FREED_SECONDS = 5  # how long the memory of a stopped model takes to come back
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


FIRST_PORT = 8082  # 8081 stays free for a llama-server started by hand


def _free_port(taken):
    """A port near 8082: Windows reserves blocks of high ports, which llama-server cannot bind."""
    for port in range(FIRST_PORT, FIRST_PORT + 50):
        if port in taken:
            continue
        with socket.socket() as probe:
            probe.settimeout(0.2)
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise ValueError("no free port near 8082 for llama-server")


@cache
def memory_gb(binary):
    """The memory the machine llama-server runs on has: Windows' own when it runs there."""
    if _wsl_to_windows() and binary.lower().endswith(".exe"):
        try:
            out = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory",
                ],
                capture_output=True,
                text=True,
                timeout=30,
                cwd="/mnt/c",
            ).stdout
            return int(out.strip()) / 1e9
        except (OSError, ValueError, subprocess.TimeoutExpired):
            pass
    if os.name == "nt":  # Windows has no sysconf
        status = ctypes.create_string_buffer(64)
        ctypes.memmove(status, ctypes.c_ulong(64), 4)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(status):
            return int.from_bytes(status[8:16], "little") / 1e9
        return 0
    try:  # Linux and macOS
        return os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES") / 1e9
    except (ValueError, OSError, AttributeError):
        return 0


def budget_gb(binary):
    """How much memory the models running together may take."""
    return round(memory_gb(binary) * BUDGET, 1)


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


def _last_words():
    """The end of llama-server's log, which says why it stopped."""
    try:
        with open(LOG) as f:
            lines = [line.strip() for line in f if line.strip()]
    except OSError:
        return f"see {LOG}"
    return (lines[-1][-160:] if lines else "") + f" (see {LOG})"


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
    port = str(_free_port({server["port"] for server in SERVERS.values()}))
    size = ["--fit", "on"] if _fits(binary) else ["-ngl", "99"]
    with open(LOG, "a") as log:
        process = subprocess.Popen(
            [binary, "-m", model.strip(), "--host", host, "--port", port, "-c", CONTEXT, *size],
            stdout=log,
            stderr=subprocess.STDOUT,
        )
    return process, f"http://{host}:{port}", int(port)


def _make_room(gb, binary):
    """Stop the models used longest ago until this one fits the budget; loading every picked model
    at once filled the machine's memory."""
    memory = memory_gb(binary)
    if not (gb and memory):
        return
    budget = budget_gb(binary)
    if gb > memory:
        raise ValueError(
            f"This model needs about {gb} GB and the machine has {memory:.0f} GB. "
            "Pick a smaller one, or one quantized further."
        )
    oldest = sorted(running(), key=lambda f: SERVERS[f]["used"])
    made_room = False
    while oldest and gb + sum(SERVERS[f]["gb"] or 0 for f in running()) > budget:
        stop(oldest.pop(0))
        made_room = True
    if made_room:
        time.sleep(FREED_SECONDS)  # the memory of a stopped model comes back a moment later


def serve(gguf, binary, gb=None):
    """The base URL of a llama-server running gguf, starting one if it is not running yet."""
    with LOCK:
        if running(gguf):
            SERVERS[gguf]["used"] = time.time()
            return SERVERS[gguf]["url"]
        if not SERVERS:
            _end_leftovers()
        _make_room(gb, binary)
        process, url, port = _start(gguf, binary)
        SERVERS[gguf] = {"process": process, "url": url, "used": time.time(), "gb": gb, "port": port}
        _remember()
        deadline = time.time() + READY_SECONDS
        while time.time() < deadline:
            if process.poll() is not None:
                stop(gguf)
                raise ValueError(f"llama-server stopped loading {os.path.basename(gguf)}: {_last_words()}")
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
