"""Live comparison page: the same model answering the same questions two ways, side by side.

Left, the usual way — generate the answers as JSON, token by token, then parse.
Right, jev.py — one forward pass, probabilities for every option, nothing to parse.

    python demo.py [model_id] [port]      # then open http://localhost:8080
"""

import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import torch
from transformers import TextIteratorStreamer

from jev import DEFAULT_MODEL, SYSTEM, Jev, _options, _text

PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "demo.html")


@torch.no_grad()
def generate(jev, state, questions):
    """Ask the model to write all answers as one JSON object; yield text as it comes."""
    lines = []
    for qid, q in questions.items():
        labels, descs = _options(q)
        opts = ", ".join(f"{la} ({_text(d)})" if d else la for la, d in zip(labels, descs, strict=True))
        lines.append(f'"{qid}": {_text(q["instructions"])} — one of: {opts}')
    user = (
        f"STATE:\n{_text(state)}\n\nAnswer every question as one JSON object, "
        f"keys exactly as given, values from the allowed options:\n" + "\n".join(lines)
    )
    msgs = [{"role": "system", "content": SYSTEM.split(" Read")[0]}, {"role": "user", "content": user}]
    text = jev.tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    enc = jev.tok(text, return_tensors="pt").to(jev.device)
    streamer = TextIteratorStreamer(jev.tok, skip_prompt=True, skip_special_tokens=True)
    Thread(
        target=jev.model.generate,
        kwargs=dict(**enc, streamer=streamer, do_sample=False, max_new_tokens=24 * len(questions)),
    ).start()
    yield from streamer


def main(model_id=DEFAULT_MODEL, port=8080):
    jev = Jev(model_id)

    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"  # chunked streaming needs 1.1; 1.0 clients would see the size markers

        def _send(self, code, data, ctype="application/json"):
            self.send_response(code)
            self.send_header("content-type", ctype)
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(200, open(PAGE, "rb").read(), "text/html; charset=utf-8")

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
            try:
                if self.path.endswith("/generate"):
                    self.send_response(200)
                    self.send_header("content-type", "text/plain; charset=utf-8")
                    self.send_header("transfer-encoding", "chunked")
                    self.end_headers()
                    for piece in generate(jev, body["state"], body["questions"]):
                        chunk = piece.encode()
                        if not chunk:  # a zero-length chunk would end the stream
                            continue
                        self.wfile.write(f"{len(chunk):x}\r\n".encode() + chunk + b"\r\n")
                        self.wfile.flush()
                    self.wfile.write(b"0\r\n\r\n")
                    return
                t = time.time()
                res = jev.ask(body["state"], body["questions"])
                res["latency_ms"] = round((time.time() - t) * 1000)
                self._send(200, json.dumps(res).encode())
            except Exception as e:
                self._send(400, json.dumps({"error": {"message": str(e)}}).encode())

        def log_message(self, fmt, *a):
            sys.stderr.write(f"{self.command} {self.path} {a[1] if len(a) > 1 else ''}\n")

    print(f"open http://localhost:{port}  ({model_id} on {jev.device})")
    ThreadingHTTPServer(("", port), H).serve_forever()


if __name__ == "__main__":
    a = sys.argv[1:]
    main(*a[:1], **({"port": int(a[1])} if len(a) > 1 else {}))
