"""Core v1: a frozen, balanced pick of items from every set in the demo, stored as pointers.

The file keeps each item's dataset, split, row number and a fingerprint, never its text, so the
repo redistributes nothing and anyone can rebuild the same items from the Hub. Sets whose
questions have more than 26 options form a separate "wide" part: letter-reading backends cannot
answer them, and keeping them apart keeps the main comparison paired across every model.

    uv run --no-sync jev-bench freeze                        # add sets not in benchmarks/core-v1.json yet
    uv run --no-sync jev-bench run remote:deepseek           # one model; letter readers skip wide
    uv run --no-sync jev-bench run Qwen/Qwen2.5-1.5B-Instruct  # local models answer every item
    uv run --no-sync jev-bench export                        # every item as text, for reviewers
    uv run --no-sync jev-bench tokens                        # input tokens per item, for cost estimates
    uv run --no-sync jev-bench check                         # offline self-checks of the readout

Each run is saved like a demo batch, so Past runs lists it and can compare runs side by side.
"""

import hashlib
import json
import math
import os
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor

from jev import demo
from jev.core import ROOT

NAME = "core-v1"
PATH = os.path.join(ROOT, "benchmarks", f"{NAME}.json")
TOKENS_PATH = os.path.join(ROOT, "benchmarks", f"{NAME}-tokens.json")
TOKENIZER = "Qwen/Qwen2.5-0.5B-Instruct"
PER_SET = 50
LETTER_LIMIT = 26
DATASET = "Core v1"
HOSTED_WORKERS = 8


def fingerprint(item):
    """A short hash of what the model is asked and the answer it is scored against."""
    text = json.dumps([item["state"], item["questions"], item["truth"]], sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(text.encode()).hexdigest()[:16]


def answer_group(name, item):
    """What the pick balances on: the label, or for multiple choice the right answer's position."""
    truth = item["truth"]["answer"]
    if name in demo.MC:
        return list(item["questions"]["answer"]["criteria"]).index(truth)
    return truth


def balanced(pairs, key, n, seed):
    """Up to n items taking turns across groups, so no label or answer position dominates."""
    rng = random.Random(seed)
    groups = {}
    for pair in pairs:
        groups.setdefault(key(pair), []).append(pair)
    for members in groups.values():
        rng.shuffle(members)
    picked = []
    while len(picked) < n and any(groups.values()):
        for k in sorted(groups, key=str):
            if groups[k] and len(picked) < n:
                picked.append(groups[k].pop())
    return picked


def freeze():
    """Pick items for every set not in the file yet; sets already frozen keep their items."""
    frozen = {}
    if os.path.exists(PATH):
        with open(PATH) as f:
            frozen = json.load(f)["sets"]
    names = [*demo.DATASETS, *demo.MC]
    sets = {}
    for name in [*(n for n in frozen if n in names), *(n for n in names if n not in frozen)]:
        if name in frozen:
            sets[name] = frozen[name]
            continue
        hub, config, split = (demo.DATASETS.get(name) or demo.MC[name])[:3]
        page = demo.download(name, hub, config, split)
        pairs = [(r, demo.row_item(name, page, r)) for r in demo.labelled_rows(name, page)]
        picked = balanced(pairs, lambda p, n=name: answer_group(n, p[1]), PER_SET, f"{NAME}:{name}")
        options = demo.OPTIONS.get(name, 2)
        sets[name] = {
            "hub": hub,
            "config": config,
            "split": split,
            "part": "wide" if options > LETTER_LIMIT else "main",
            "options": options,
            "items": sorted(
                ({"row": r["row_idx"], "sha": fingerprint(item)} for r, item in picked),
                key=lambda x: x["row"],
            ),
        }
    steps = [
        {"case": case, "node": node, "sha": fingerprint(demo.typesafe_item(case, node, doc, qs, truth))}
        for case, node, doc, qs, truth in demo.typesafe_rows()
    ]
    os.makedirs(os.path.dirname(PATH), exist_ok=True)
    with open(PATH, "w") as f:
        json.dump(
            {
                "name": NAME,
                "status": "draft: a balanced random pick; the final list comes from review (see README)",
                "frozen": time.strftime("%Y-%m-%d"),
                "per_set": PER_SET,
                "sets": sets,
                "typesafe": steps,
            },
            f,
            indent=1,
        )
    main = sum(len(s["items"]) for s in sets.values() if s["part"] == "main")
    wide = sum(len(s["items"]) for s in sets.values() if s["part"] == "wide")
    print(f"{os.path.relpath(PATH, ROOT)}: {main} main items and {len(steps)} TypeSafe steps, {wide} wide")


def load(part="main"):
    """The frozen items of one part, rebuilt from the Hub and checked against their fingerprints."""
    with open(PATH) as f:
        frozen = json.load(f)
    items = []
    for name, spec in frozen["sets"].items():
        if spec["part"] != part:
            continue
        # Rows this machine already downloaded are read from disk; only the rest come from the Hub.
        local = demo.download(name, spec["hub"], spec["config"], spec["split"])
        pages = {None: local}
        on_disk = {r["row_idx"] for r in local["rows"]}
        for pointer in spec["items"]:
            start = None if pointer["row"] in on_disk else pointer["row"] - pointer["row"] % 100
            if start not in pages:
                pages[start] = demo.rows_page(spec["hub"], spec["config"], spec["split"], start)
            page = pages[start]
            row = next(r for r in page["rows"] if r["row_idx"] == pointer["row"])
            item = demo.row_item(name, page, row)
            if fingerprint(item) != pointer["sha"]:
                raise ValueError(f"{name} row {pointer['row']} changed on the Hub since {frozen['frozen']}")
            items.append(item | {"set": name})
    if part == "main":
        steps = {
            (case, node): (case, node, doc, qs, truth) for case, node, doc, qs, truth in demo.typesafe_rows()
        }
        for pointer in frozen["typesafe"]:
            item = demo.typesafe_item(*steps[(pointer["case"], pointer["node"])])
            if fingerprint(item) != pointer["sha"]:
                raise ValueError(
                    f"TypeSafe {pointer['case']} {pointer['node']} changed since {frozen['frozen']}"
                )
            items.append(item | {"set": "TypeSafe cases"})
    return items


def reads_wide(model):
    """Letter-reading backends answer 26 options at most; Jev and local models read any number."""
    if model.startswith(("openrouter:", "gguf:")):
        return False
    kind, _, name = model.partition(":")
    return kind != "remote" or name.split(":")[0] not in demo.LETTER


def run(model):
    items = load("main") + (load("wide") if reads_wide(model) else [])
    backend = demo.get(model)
    stamp = time.strftime("%Y-%m-%d-%H-%M-%S", time.gmtime())
    log = f"{stamp}-{NAME}-{model.split(':')[-1].split('/')[-1]}"
    dataset = DATASET

    def ask(item):
        started = time.time()
        try:
            answers = backend.ask(item["state"], item["questions"])["answers"]
        except Exception as e:
            print(f"  {item['source']}: {e}")
            answers = {}
        ms = round((time.time() - started) * 1000)
        demo.log_row(
            {"log": log, "dataset": dataset, "sides": [model]}
            | {k: item[k] for k in ("source", "state", "questions", "truth")},
            model,
            answers,
            ms,
        )

    workers = HOSTED_WORKERS if model.startswith(("remote:", "openrouter:")) else 1
    with ThreadPoolExecutor(workers) as pool:
        for k, _ in enumerate(pool.map(ask, items), 1):
            if k % 100 == 0 or k == len(items):
                print(f"{k}/{len(items)}", flush=True)
    print(f"saved to results/logs/demo/{log}.jsonl; open it in Past runs")


def export():
    """Every item with its text and label, one JSON line each, into local/ (git-ignored)."""
    path = os.path.join(ROOT, "local", "review", f"{NAME}-items.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        for part in ("main", "wide"):
            for item in load(part):
                keep = ("set", "source", "state", "questions", "truth")
                f.write(
                    json.dumps(
                        {"part": part, "sha": fingerprint(item)} | {k: item[k] for k in keep},
                        ensure_ascii=False,
                    )
                    + "\n"
                )
    print(os.path.relpath(path, ROOT))


def tokens():
    """Input tokens per item as a letter-reading API receives them: one request per question, each
    with the whole state. Measured with a Qwen tokenizer; other tokenizers differ by some percent."""
    from transformers import AutoTokenizer

    from jev.remote import LETTER_SYSTEM, letter_prompt

    tok = AutoTokenizer.from_pretrained(TOKENIZER)
    per_set = {}
    for item in load("main"):
        size = 0
        for q in item["questions"].values():
            _, user = letter_prompt(item["state"], q)
            messages = [{"role": "system", "content": LETTER_SYSTEM}, {"role": "user", "content": user}]
            prompt = tok.apply_chat_template(messages, add_generation_prompt=True, tokenize=False)
            size += len(tok(prompt)["input_ids"])
        total, questions, count = per_set.get(item["set"], (0, 0, 0))
        per_set[item["set"]] = (total + size, questions + len(item["questions"]), count + 1)
    sets = {
        name: {"tokens": round(total / count), "questions": round(questions / count, 2)}
        for name, (total, questions, count) in per_set.items()
    }
    items = sum(count for _, _, count in per_set.values())
    sets[DATASET] = {
        "tokens": round(sum(total for total, _, _ in per_set.values()) / items),
        "questions": round(sum(q for _, q, _ in per_set.values()) / items, 2),
    }
    with open(TOKENS_PATH, "w") as f:
        json.dump(
            {"measured": time.strftime("%Y-%m-%d"), "tokenizer": TOKENIZER, "per_item": sets}, f, indent=1
        )
    average = sets[DATASET]["tokens"]
    print(f"{os.path.relpath(TOKENS_PATH, ROOT)}: {DATASET} averages {average} tokens an item")


def check():
    """Offline asserts on the hosted letter readout; no network."""
    from jev.remote import letter_probs

    def top(**p):
        return [{"token": t.replace("_", " "), "logprob": math.log(x)} for t, x in p.items()]

    probs, cov = letter_probs(top(A=0.2, _A=0.2, B=0.3), 2)
    assert cov["status"] == "complete" and abs(probs[0] - 4 / 7) < 1e-12 and abs(probs[1] - 3 / 7) < 1e-12
    probs, cov = letter_probs(top(A=0.8, hello=0.1), 2)
    assert cov["status"] == "partial" and cov["missing"] == ["B"] and probs == [1.0, 0.0]
    probs, cov = letter_probs(top(hello=0.5, the=0.3), 2)
    assert cov["status"] == "none" and probs is None
    assert json.loads(json.dumps(0.123456789)) == 0.123456789
    print("OK  letter readout checks")


def cli():
    args = sys.argv[1:]
    if args[:1] == ["freeze"]:
        freeze()
    elif args[:1] == ["export"]:
        export()
    elif args[:1] == ["check"]:
        check()
    elif args[:1] == ["tokens"]:
        tokens()
    elif args[:1] == ["run"] and len(args) == 2:
        run(args[1])
    else:
        print(__doc__)


if __name__ == "__main__":
    cli()
