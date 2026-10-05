"""Letter vs option-text readout, and how often the answer flips when the options are reversed.

Runs the six choice tasks of the frozen item set (results/eval-set.json). Each item is asked
twice per readout, once with the options in order and once reversed, in one request so the
state is prefilled once. Writes results/<model>-readout.jsonl and prints, per task and readout:
accuracy in order, accuracy reversed, flip rate (the top answer changes) and mean |Δp| of the
true option; then a paired letter-vs-text McNemar test on the in-order answers.

    uv run jev-readout Qwen/Qwen2.5-1.5B-Instruct
"""

import json
import math
import os
import random
import sys
import time

from jev.bench.eval import AG_NEWS, COMMIT_TYPES, KIND_DESC, NLI, load_set
from jev.core import DEFAULT_MODEL, ROOT, Jev


def items(data):
    """(task, state, instructions, criteria, truth) for every choice item."""
    for title, truth in data["hn"]:
        if "kind" in truth:
            yield (
                "kind",
                {"hacker_news_post_title": title},
                "What kind of thing does this post link to?",
                KIND_DESC,
                truth["kind"],
            )
    for msg, truth in data["commits"]:
        yield (
            "type",
            {"commit_message": msg},
            "What kind of change is this commit?",
            COMMIT_TYPES,
            truth["type"],
        )
    for subject, question, choices, truth in data["fields"]:
        state = {"subject": subject.replace("_", " "), "question": question}
        yield "fields", state, "Which answer is correct?", dict.fromkeys(choices), truth
    pub = data["public"]
    for sample, truth in pub["snli"]:
        yield (
            "snli",
            {"premise": sample[0], "hypothesis": sample[1]},
            "How does the hypothesis relate to the premise?",
            dict.fromkeys(NLI),
            truth,
        )
    for sample, truth in pub["topic"]:
        yield (
            "topic",
            {"news": sample},
            "Which section does this news belong to?",
            dict.fromkeys(AG_NEWS),
            truth,
        )
    rows, intents = pub["intent"]
    for sample, truth in rows:
        yield "intent", {"message": sample}, "What does the customer want?", dict.fromkeys(intents), truth


def mcnemar(only_first, only_second):
    """Exact two-sided p for b vs c discordant pairs."""
    discordant, fewer = only_first + only_second, min(only_first, only_second)
    return (
        min(1.0, 2 * sum(math.comb(discordant, i) for i in range(fewer + 1)) / 2**discordant)
        if discordant
        else 1.0
    )


def main(model=DEFAULT_MODEL):
    jev = Jev(model, readout="letter")  # checks every letter is one token; the loop switches readouts
    path = os.path.join(ROOT, "results", model.split("/")[-1].lower() + "-readout.jsonl")
    started, rows = time.time(), []
    with open(path, "w") as log:
        todo = list(items(load_set(60)))
        if cap := int(os.environ.get("READOUT_N", 0)):  # items per task, same seed for every model
            by_task = {}
            for item in todo:
                by_task.setdefault(item[0], []).append(item)
            todo = [x for v in by_task.values() for x in random.Random(0).sample(v, min(cap, len(v)))]
        for task, state, instr, crit, truth in todo:
            questions = {
                "fwd": {"type": "choice", "instructions": instr, "criteria": crit},
                "rev": {"type": "choice", "instructions": instr, "criteria": dict(reversed(crit.items()))},
            }
            for readout in ("text", "letter"):
                jev.readout = readout
                answers = jev.ask(state, questions)["answers"]
                row = {"task": task, "readout": readout, "truth": truth, "state": state}
                row |= {k: answers[k]["probabilities"] for k in questions}
                rows.append(row)
                log.write(json.dumps(row, ensure_ascii=False) + "\n")

    def top(probabilities):
        return max(probabilities, key=probabilities.get)

    print(
        f"# jev-readout {model}   {len(rows) // 2} items, "
        f"{(time.time() - started) / len(rows) * 2000:.0f} ms each (both readouts, both orders)\n"
    )
    print(f"{'task':8} {'readout':7} {'n':>4}  acc fwd  acc rev  flip   mean|Δp true|")
    for task in dict.fromkeys(r["task"] for r in rows):
        for readout in ("text", "letter"):
            task_rows = [r for r in rows if r["task"] == task and r["readout"] == readout]
            count = len(task_rows)
            fwd = sum(top(r["fwd"]) == r["truth"] for r in task_rows) / count
            rev = sum(top(r["rev"]) == r["truth"] for r in task_rows) / count
            flip = sum(top(r["fwd"]) != top(r["rev"]) for r in task_rows) / count
            shift = sum(abs(r["fwd"][r["truth"]] - r["rev"][r["truth"]]) for r in task_rows) / count
            print(f"{task:8} {readout:7} {count:4}  {fwd:7.3f}  {rev:7.3f}  {flip:5.3f}  {shift:6.3f}")
    text = [top(r["fwd"]) == r["truth"] for r in rows if r["readout"] == "text"]
    letter = [top(r["fwd"]) == r["truth"] for r in rows if r["readout"] == "letter"]
    text_only = sum(t and not le for t, le in zip(text, letter, strict=True))
    letter_only = sum(le and not t for t, le in zip(text, letter, strict=True))
    print(f"\nall tasks, in order: text {sum(text) / len(text):.3f}, letter {sum(letter) / len(letter):.3f}")
    print(
        f"McNemar: text-only right {text_only}, letter-only right {letter_only}, "
        f"exact p = {mcnemar(text_only, letter_only):.3g}"
    )
    print(f"every answer: {os.path.relpath(path, ROOT)}")


def cli():
    assert mcnemar(0, 0) == 1.0 and abs(mcnemar(0, 10) - 2 / 1024) < 1e-12
    main(*sys.argv[1:2])


if __name__ == "__main__":
    cli()
