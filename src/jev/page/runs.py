"""Saved runs: one JSON line per answer, the summaries Past runs lists, and how an answer is
scored against its label."""

import contextlib
import hashlib
import json
import os
import time

from jev.core import ROOT, _options
from jev.page.models import LOCK
from jev.remote import total

LOGS = os.path.join(ROOT, "results", "logs", "demo")  # one .jsonl per batch, git-ignored


def text_answers(text, questions):
    """A written JSON reply in the shape of a probability reply, each answer counted as certain."""
    try:
        got = json.loads(text.replace("```json", "").replace("```", "").strip())
    except ValueError:
        return {}
    out = {}
    for qid, q in questions.items():
        if not isinstance(got, dict) or qid not in got:
            continue
        v = str(got[qid]).strip().lower()
        first = (v.replace(",", " ").split() or [""])[0]
        if q["type"] == "noul":
            out[qid] = {"type": "noul", "noul": 1.0 if first in ("yes", "true") else 0.0}
        elif q["type"] == "choice":
            hit = next((la for la in _options(q)[0] if v == la.lower() or v.startswith(la.lower())), None)
            if hit is not None:
                out[qid] = {"type": "choice", "choice": hit, "probabilities": {hit: 1.0}}
        else:
            with contextlib.suppress(ValueError):
                out[qid] = {"type": "score", "score": float(first)}
    return out


def log_row(body, backend, answers, ms, response=None):
    """One answer of a run, appended to its session's file, with the rest of the reply (usage,
    invalid answers, an error) when there is one."""
    name = "".join(c if c.isalnum() or c in "._-" else "-" for c in body["log"])[:120]
    os.makedirs(LOGS, exist_ok=True)
    keys = ("dataset", "set", "source", "state", "questions", "truth", "mode", "sides", "system")
    row = {k: body.get(k) for k in keys}
    # "at" is when the answer came back, so a replay can follow the run's real timeline
    row |= {"backend": backend, "answers": answers, "ms": ms, "at": round(time.time() * 1000)}
    if response:
        row["response"] = {k: v for k, v in response.items() if k != "answers"}
    with LOCK, open(os.path.join(LOGS, name + ".jsonl"), "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def answer(a):
    """The answer a probability reply amounts to, in the label set's words."""
    if a["type"] == "noul":
        return "yes" if a["noul"] >= 0.5 else "no"
    if a["type"] == "choice":
        return a["choice"]
    p = a.get("probabilities")  # a score's answer is its most probable level, not the rounded mean
    return max(p, key=p.get) if p else str(round(a["score"]))


def right(a, truth):
    norm = {"true": "yes", "false": "no"}
    return answer(a).lower().strip() == norm.get(str(truth).lower(), str(truth).lower().strip())


def item_key(x):
    """One logged item: two TypeSafe steps can share a document, so the questions count too."""
    return x["source"], json.dumps((x["state"], x["questions"]), sort_keys=True)


SUMMARIES = {}  # file name -> (mtime, size, summary); a saved run is read again only when it changes


def summary(f):
    """One saved batch: set, backends, items and each side's score."""
    path = os.path.join(LOGS, f)
    stat = os.stat(path)
    cached = SUMMARIES.get(f)
    if cached and cached[:2] == (stat.st_mtime, stat.st_size):
        return cached[2]
    with open(path) as fh:
        lines = [json.loads(x) for x in fh if x.strip()]
    sides = sorted(
        dict.fromkeys(x["backend"] for x in lines), key=lambda b: not b.endswith("#text")
    )  # written side first
    order = next((x["sides"] for x in lines if x.get("sides")), None)
    if order and lines[0].get("mode") != "gen":  # compare: the order the models were picked in
        sides.sort(key=lambda b: order.index(b) if b in order else len(order))
    items = len({item_key(x) for x in lines})
    score = {b: [0, 0] for b in sides}
    for x in lines:
        for qid, t in x["truth"].items():
            score[x["backend"]][1] += 1
            score[x["backend"]][0] += qid in x["answers"] and right(x["answers"][qid], t)
    ds, kind = (lines[0]["dataset"], lines[0].get("mode") or "cmp") if lines else ("", "cmp")
    out = {"name": f[:-6], "dataset": ds, "backends": sides, "items": items, "score": score, "mode": kind}
    if items == 1:  # which item, so runs that can be compared are visible before opening them
        out["item"] = lines[0].get("source")
    # Short item fingerprints, so the page knows which runs share items before opening any; a big
    # run sends one digest of all of them instead.
    keys = sorted({hashlib.sha1(json.dumps(item_key(x)).encode()).hexdigest()[:8] for x in lines})
    out["keys" if len(keys) <= 200 else "digest"] = (
        keys if len(keys) <= 200 else hashlib.sha1(",".join(keys).encode()).hexdigest()[:12]
    )
    SUMMARIES[f] = stat.st_mtime, stat.st_size, out
    return out


def runs():
    """The saved batches, newest first."""
    if not os.path.isdir(LOGS):
        return []
    return [summary(f) for f in sorted(os.listdir(LOGS), reverse=True) if f.endswith(".jsonl")]


RUN_BODIES = {}  # file name -> (mtime, size, JSON body); a big run is merged once, not per open


def run_body(name):
    """run_rows as the JSON the page fetches, rebuilt only when the file changes."""
    path = os.path.join(LOGS, os.path.basename(name) + ".jsonl")
    stat = os.stat(path)
    cached = RUN_BODIES.get(path)
    if not cached or cached[:2] != (stat.st_mtime, stat.st_size):
        cached = RUN_BODIES[path] = (stat.st_mtime, stat.st_size, json.dumps(run_rows(name)).encode())
    return cached[2]


def run_rows(name):
    """One saved batch as items, each with both sides' answers, in the order they ran."""
    path = os.path.join(LOGS, os.path.basename(name) + ".jsonl")
    items = {}
    with open(path) as fh:
        for x in map(json.loads, filter(str.strip, fh)):
            it = items.setdefault(
                item_key(x), {"it": {k: x[k] for k in ("state", "questions", "truth", "source")}, "sides": {}}
            )
            res = {"answers": x["answers"]}
            if usage := (x.get("response") or {}).get("usage"):
                # the totals the page prices a run from, not each question's details
                billed = total((usage.get("per_question") or {}).values(), "cost")
                res["usage"] = {
                    "input_tokens": usage.get("input_tokens"),
                    "output_tokens": usage.get("output_tokens"),
                    "cost": usage.get("cost", billed if usage.get("per_question") else None),
                }
            it["sides"][x["backend"]] = {"ms": x["ms"], "res": res}
            if "at" in x:  # older runs did not record it
                # the item started when its first model started (local models answer one after
                # another), and ended with its last answer
                it["start"] = min(it.get("start", x["at"]), x["at"] - x["ms"])
                it["at"] = max(it.get("at", 0), x["at"])
    return list(items.values())
