"""Does jev.py get real judgments right? Public data, public labels, model sees only the text.

  hn       one Hacker News title per call, three questions in one pass
             show    noul    Show HN post?             truth: the "Show HN:" prefix, removed first
             ask     noul    Ask HN post?              truth: the "Ask HN:" prefix, removed first
             kind    choice  code/paper/video/ref/news truth: the link's domain
  commits  one commit message per call, from public repos using conventional commits
             type    choice  fix/feat/docs/refactor/test/chore   truth: the prefix, removed first
  shell    one shell command per call, 40 hand-labelled
             writes  noul    does it modify or delete anything?   truth: labelled by hand
  fields   one exam question per call, 40 each from ten MMLU subjects
             answer  choice  four answers, biology to law        truth: the exam key
  typesafe TypeSafe's published eval cases, fetched at run time, kept out of git
             one document per call, its questions in one pass; truth: the published consensus
  public   300 items each from seven labelled datasets on the Hugging Face Hub
             sentiment  noul    is the review positive?            SST-2
             phishing   noul    is the email a phishing attempt?   phishing-email-dataset
             entails    noul    does A entail B?                   GLUE RTE
             snli       choice  entail / neutral / contradict      SNLI
             topic      choice  world / sports / business / tech   AG News
             intent     choice  27 support intents                 Bitext customer support
             toxicity   score   four levels                        Civil Comments (human scores)

Prints accuracy, Brier score and a reliability table (how often a 0.9 was actually a yes), and
writes every answer with its probabilities and latency to results/logs/<model>.jsonl for later comparison.

    uv run jev-eval [model_id] [n]       # n per class, default 60

The item set is saved to results/eval-set.json on first run and reused after,
so every model is scored on the same items.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from jev.bench.datasets import typesafe_rows
from jev.core import DEFAULT_MODEL, ROOT, Jev


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "jev.py eval"})
    for attempt in range(8):
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as e:
            if (e.code != 429 and e.code < 500) or attempt == 7:
                raise
            time.sleep(min(2**attempt, 60))  # rate limited or a passing server error


HN_SEARCH = "https://hn.algolia.com/api/v1/{}?tags=story&hitsPerPage=300&query={}"
KINDS = {
    "github.com": "code",
    "arxiv.org": "paper",
    "youtube.com": "video",
    "en.wikipedia.org": "reference",
    "nytimes.com": "news",
    "theguardian.com": "news",
}
KIND_DESC = {
    "code": "a software project or repository",
    "paper": "an academic or research paper",
    "video": "a video",
    "reference": "an encyclopedia or reference page",
    "news": "a news article",
}
COMMIT_REPOS = ["vitejs/vite", "angular/angular", "nestjs/nest"]
SUBJECTS = [
    "college_biology",
    "college_chemistry",
    "college_physics",
    "college_medicine",
    "electrical_engineering",
    "college_computer_science",
    "computer_security",
    "professional_law",
    "econometrics",
    "world_religions",
]
COMMIT_TYPES = {
    "fix": "fixes a bug",
    "feat": "adds a feature",
    "docs": "changes documentation only",
    "refactor": "restructures code without changing behaviour",
    "test": "adds or changes tests",
    "chore": "build, tooling or dependency housekeeping",
}
SHELL = [
    ("ls -la", 0),
    ("cat config.yaml", 0),
    ("git status", 0),
    ("git diff HEAD~1", 0),
    ("grep -rn TODO src/", 0),
    ("df -h", 0),
    ("ps aux | grep node", 0),
    ("curl -s https://example.com", 0),
    ("npm ls", 0),
    ("docker ps", 0),
    ("head -n 50 log.txt", 0),
    ("find . -name '*.py'", 0),
    ("echo $PATH", 0),
    ("which python", 0),
    ("git log --oneline -20", 0),
    ("python -c 'print(1)'", 0),
    ("wc -l *.md", 0),
    ("tail -f app.log", 0),
    ("env | sort", 0),
    ("git branch -a", 0),
    ("rm -rf build/", 1),
    ("git push --force origin main", 1),
    ("npm install lodash", 1),
    ("sed -i 's/a/b/' file.txt", 1),
    ("git reset --hard HEAD~3", 1),
    ("mv src/old.py src/new.py", 1),
    ("echo x > out.txt", 1),
    ("docker rm -f web", 1),
    ("chmod -R 777 /var/www", 1),
    ("pip install requests", 1),
    ("git checkout -- .", 1),
    ("mkdir -p a/b/c", 1),
    ("DROP TABLE users;", 1),
    ("kill -9 1234", 1),
    ("cp -r src backup/", 1),
    ("truncate -s 0 db.sqlite", 1),
    ("git commit -am wip", 1),
    ("apt-get remove nginx", 1),
    ("curl -X DELETE https://api/items/1", 1),
    ("export FOO=bar", 1),
]


def hn_rows(count):
    def hits(kind, query, extra=""):
        return get(HN_SEARCH.format(kind, urllib.parse.quote(query)) + extra)["hits"]

    rows = []
    for prefix in ("Show HN", "Ask HN"):
        for hit in [
            h for h in hits("search_by_date", f'"{prefix}:"') if h["title"].lower().startswith(prefix.lower())
        ][:count]:
            rows.append(
                (re.sub(rf"^{prefix}:?\s*", "", hit["title"], flags=re.I), {prefix.split()[0].lower(): 1})
            )
    for hit in [
        h for h in hits("search_by_date", "") if not re.match(r"(show|ask|tell|launch) hn", h["title"], re.I)
    ][:count]:
        rows.append((hit["title"], {"show": 0, "ask": 0}))
    for dom, kind in KINDS.items():
        for hit in [
            h for h in hits("search", dom, "&restrictSearchableAttributes=url") if dom in (h.get("url") or "")
        ][: count // 3]:
            rows.append((hit["title"], {"kind": kind}))
    return rows


def commit_rows(count):
    rows = []
    for repo in COMMIT_REPOS:
        for page in (1, 2):
            for commit in get(f"https://api.github.com/repos/{repo}/commits?per_page=100&page={page}"):
                match = re.match(
                    r"(fix|feat|docs|refactor|test|chore)(\(.*?\))?!?:\s*(.+)",
                    commit["commit"]["message"].split("\n")[0],
                )
                if match:
                    rows.append((match.group(3), {"type": match.group(1)}))
    per = {}
    return [r for r in rows if per.setdefault(r[1]["type"], []).append(r) or len(per[r[1]["type"]]) <= count]


def report(name, pairs, kind):
    if kind == "score":
        off = [abs(score - truth) for score, truth, _ in pairs]
        exact = sum(round(score) == truth for score, truth, _ in pairs) / len(pairs)
        mae = sum(off) / len(off)
        print(f"\n{name:<8} score   n={len(pairs):<4} exact level={exact:.3f}  mean level error={mae:.2f}")
        return
    if kind == "noul":
        acc = sum((p > 0.5) == y for p, y in pairs) / len(pairs)
        brier = sum((p - y) ** 2 for p, y in pairs) / len(pairs)
        print(f"\n{name:<8} noul    n={len(pairs):<4} accuracy={acc:.3f}  brier={brier:.3f}")
        print("  p(yes)       n   actually yes")
        for lo, hi in ((0, 0.1), (0.1, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.01)):
            in_bin = [y for p, y in pairs if lo <= p < hi]
            if in_bin:
                print(f"  [{lo:.1f},{min(hi, 1):.1f})   {len(in_bin):>4}   {sum(in_bin) / len(in_bin):.2f}")
    else:
        acc = sum(c == y for c, y, _ in pairs) / len(pairs)
        print(f"\n{name:<8} choice  n={len(pairs):<4} accuracy={acc:.3f}  (chance {1 / kind:.2f})")
        print("  confidence   n   accuracy")
        for lo, hi in ((0, 0.3), (0.3, 0.6), (0.6, 0.8), (0.8, 1.01)):
            in_bin = [c == y for c, y, conf in pairs if lo <= conf < hi]
            if in_bin:
                print(f"  [{lo:.1f},{min(hi, 1):.1f})   {len(in_bin):>4}   {sum(in_bin) / len(in_bin):.2f}")


HUB = "https://datasets-server.huggingface.co/rows?dataset={}&config={}&split={}&offset={}&length=100"


def hub(dataset, config, split, offsets=(0,)):
    rows = []
    for offset in offsets:
        rows += [r["row"] for r in get(HUB.format(dataset, config, split, offset))["rows"]]
        time.sleep(1)  # the Hub's rows endpoint is rate limited
    return rows


AG_NEWS = ["world", "sports", "business", "science and technology"]
NLI = ["entailment", "neutral", "contradiction"]
TOX = ["not toxic", "mildly toxic", "toxic", "severely toxic"]


def pages(count, step):
    """Page offsets for n rows of a 100-row endpoint, `step` rows apart."""
    return tuple(range(0, step * -(-count // 100), step))


def public_rows(count):
    by_task = {}
    by_task["sentiment"] = [
        (r["sentence"], r["label"] == 1)
        for r in hub("stanfordnlp/sst2", "default", "validation", pages(count, 100))
    ][:count]
    by_task["phishing"] = [
        (r["Email Text"][:1500], r["Email Type"] == "Phishing Email")
        for r in hub("zefang-liu/phishing-email-dataset", "default", "train", pages(count, 9000))
        if isinstance(r["Email Text"], str) and len(r["Email Text"]) > 40
    ][:count]
    by_task["entails"] = [
        ((r["sentence1"], r["sentence2"]), r["label"] == 0)
        for r in hub("nyu-mll/glue", "rte", "validation", pages(count, 100))
    ][:count]
    by_task["snli"] = [
        ((r["premise"], r["hypothesis"]), NLI[r["label"]])
        for r in hub("stanfordnlp/snli", "plain_text", "test", pages(count, 3000))
        if r["label"] >= 0
    ][:count]
    by_task["topic"] = [
        (r["text"], AG_NEWS[r["label"]])
        for r in hub("fancyzhx/ag_news", "default", "test", pages(count, 3000))
    ][:count]
    # the file is sorted by intent, about a thousand rows each: one page per thousand covers all 27
    bitext = hub(
        "bitext/Bitext-customer-support-llm-chatbot-training-dataset",
        "default",
        "train",
        tuple(range(0, 26000, 1000)),
    )
    intents = sorted({r["intent"] for r in bitext})
    by_task["intent"] = (
        [(r["instruction"], r["intent"]) for r in bitext[:: len(bitext) // count]][:count],
        intents,
    )

    def level(toxicity):
        return 0 if toxicity < 0.1 else 1 if toxicity < 0.5 else 2 if toxicity < 0.8 else 3

    calm, harsh, offset = [], [], 0
    while (len(calm) < count // 2 or len(harsh) < count // 2) and offset < 5000:  # toxic comments are rare
        for comment in hub("google/civil_comments", "default", "test", (offset,)):
            bucket = calm if comment["toxicity"] < 0.1 else harsh if comment["toxicity"] >= 0.5 else None
            if bucket is not None and len(bucket) < count // 2:
                bucket.append((comment["text"][:800], level(comment["toxicity"])))
        offset += 100
    by_task["toxicity"] = calm + harsh
    return by_task


def field_rows(count):
    rows = []
    for subject in SUBJECTS:
        url = (
            "https://datasets-server.huggingface.co/rows?dataset=cais/mmlu"
            f"&config={subject}&split=test&offset=0&length={count}"
        )
        for hub_row in get(url)["rows"]:
            item = hub_row["row"]
            rows.append((subject, item["question"], item["choices"], item["choices"][item["answer"]]))
    return rows


PUBLIC_N = 300  # items per Hub task


def dist(answer):
    """The answer as a distribution over the labels TypeSafe uses."""
    if answer["type"] == "noul":
        return {"true": answer["noul"], "false": 1 - answer["noul"]}
    return answer["probabilities"]


def load_set(count):
    """Fetch the items once and keep them, so every model is scored on the same set."""
    path = os.path.join(ROOT, "results", "eval-set.json")
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    if "public" in data and len(data["public"]["sentiment"]) < PUBLIC_N:  # widen, keeping every old row
        fresh = public_rows(PUBLIC_N)
        for task, rows in fresh.items():
            old_rows = data["public"][task]
            new_rows, rows = (old_rows[0], rows[0]) if task == "intent" else (old_rows, rows)
            seen, add = {json.dumps(r) for r in new_rows}, []
            for row in map(list, rows):
                if json.dumps(row) not in seen and len(add) < PUBLIC_N - len(new_rows):
                    seen.add(json.dumps(row))
                    add.append(row)
            data["public"][task] = (new_rows + add, old_rows[1]) if task == "intent" else new_rows + add
        with open(path, "w") as f:
            json.dump(data, f, indent=1)
    if all(k in data for k in ("hn", "commits", "shell", "fields", "public")):
        return data
    makers = {
        "hn": lambda: hn_rows(count),
        "commits": lambda: commit_rows(count),
        "shell": lambda: SHELL,
        "fields": lambda: field_rows(min(count, 40)),
        "public": lambda: public_rows(PUBLIC_N),
    }
    for key, make in makers.items():
        if key not in data:
            data[key] = make()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)
    return data


def record(log, jev, task, state, questions, truth, logged=None):
    """Ask, time it, and append one line per question with everything the model returned."""
    started = time.time()
    answers = jev.ask(state, questions)["answers"]
    ms = round((time.time() - started) * 1000)
    for qid, answer in answers.items():
        row = {
            "task": task,
            "question": qid,
            "state": logged or state,
            "truth": truth.get(qid),
            "ms": ms,
            **answer,
        }
        log.write(json.dumps(row, ensure_ascii=False) + "\n")
    return answers


def items(data):
    """(task, state, questions, truth, logged state) for every item of the set, in run order.

    The logged state is what reaches the log: a TypeSafe case id instead of its document.
    """
    hn_q = {
        "show": {"type": "noul", "instructions": "Is the author showing off something they built or made?"},
        "ask": {"type": "noul", "instructions": "Is the author asking the community a question?"},
        "kind": {
            "type": "choice",
            "instructions": "What kind of thing does this post link to?",
            "criteria": KIND_DESC,
        },
    }
    for title, truth in data["hn"]:
        yield "hn", {"hacker_news_post_title": title}, hn_q, truth, None
    commit_q = {
        "type": {
            "type": "choice",
            "criteria": COMMIT_TYPES,
            "instructions": "What kind of change is this commit?",
        }
    }
    for msg, truth in data["commits"]:
        yield "commits", {"commit_message": msg}, commit_q, truth, None
    shell_q = {
        "writes": {
            "type": "noul",
            "instructions": "Does running this command create, modify or delete "
            "any file, process, package or setting?",
        }
    }
    for cmd, writes in data["shell"]:
        yield "shell", {"shell_command": cmd}, shell_q, {"writes": writes}, None
    for subject, question, choices, truth in data["fields"]:
        yield (
            "fields",
            {"subject": subject.replace("_", " "), "question": question},
            {
                "answer": {
                    "type": "choice",
                    "instructions": "Which answer is correct?",
                    "criteria": dict.fromkeys(choices),
                }
            },
            {"answer": truth},
            None,
        )
    pub = data["public"]
    for task, ask_q, state_of in (
        ("sentiment", {"type": "noul", "instructions": "Is this review positive?"}, lambda x: {"review": x}),
        (
            "phishing",
            {"type": "noul", "instructions": "Is this email a phishing attempt?"},
            lambda x: {"email": x},
        ),
        (
            "entails",
            {"type": "noul", "instructions": "Does sentence A entail sentence B?"},
            lambda x: {"A": x[0], "B": x[1]},
        ),
        (
            "snli",
            {
                "type": "choice",
                "instructions": "How does the hypothesis relate to the premise?",
                "criteria": dict.fromkeys(NLI),
            },
            lambda x: {"premise": x[0], "hypothesis": x[1]},
        ),
        (
            "topic",
            {
                "type": "choice",
                "instructions": "Which section does this news belong to?",
                "criteria": dict.fromkeys(AG_NEWS),
            },
            lambda x: {"news": x},
        ),
        (
            "toxicity",
            {"type": "score", "instructions": "How toxic is this comment?", "criteria": TOX},
            lambda x: {"comment": x},
        ),
    ):
        for sample, truth in pub[task]:
            yield task, state_of(sample), {task: ask_q}, {task: truth}, None
    rows, intents = pub["intent"]
    intent_q = {
        "intent": {
            "type": "choice",
            "instructions": "What does the customer want?",
            "criteria": dict.fromkeys(intents),
        }
    }
    for sample, truth in rows:
        yield "intent", {"message": sample}, intent_q, {"intent": truth}, None
    for case, node, doc, questions, truth in typesafe_rows():
        yield "typesafe", doc, questions, truth, {"typesafe_case": case, "node": node}


def main(model=DEFAULT_MODEL, n=60):
    data = load_set(n)
    if model.startswith("remote:"):
        from jev.remote import Remote

        jev = Remote(*model.split(":")[1:3])  # remote:<backend>[:<model>]
    else:
        jev = Jev(model)
    started, total = time.time(), 0
    slug = (getattr(jev, "backend", "") + "-" if hasattr(jev, "backend") else "") + jev.model_id.split("/")[
        -1
    ].lower()
    os.makedirs(os.path.join(ROOT, "results", "logs"), exist_ok=True)
    with open(os.path.join(ROOT, "results", "logs", slug + ".jsonl"), "w") as log:
        res, typesafe_right = {}, []
        for task, state, questions, truth, logged in items(data):
            answers = record(log, jev, task, state, questions, truth, logged)
            if task == "typesafe":
                for qid, ans in answers.items():
                    ours = dist(ans)
                    typesafe_right.append(max(ours, key=ours.get) == truth[qid])
                total += 1
                continue
            for qid, expected in truth.items():
                ans = answers[qid]
                if ans["type"] == "noul":
                    res.setdefault(qid, []).append((ans["noul"], int(expected)))
                else:
                    res.setdefault(qid, []).append(
                        (ans.get("choice", ans.get("score")), expected, ans["confidence"])
                    )
            if task == "fields":
                res.setdefault(state["subject"].replace(" ", "_"), []).append(
                    answers["answer"]["choice"] == truth["answer"]
                )
            total += 1
        for name, kind in (
            ("show", "noul"),
            ("ask", "noul"),
            ("kind", len(KIND_DESC)),
            ("type", len(COMMIT_TYPES)),
            ("writes", "noul"),
            ("answer", 4),
            ("sentiment", "noul"),
            ("phishing", "noul"),
            ("entails", "noul"),
            ("snli", 3),
            ("topic", 4),
            ("intent", len(data["public"]["intent"][1])),
            ("toxicity", "score"),
        ):
            report(name, res[name], kind)
        print(
            f"typesafe  {len(typesafe_right)} questions  "
            f"accuracy vs consensus={sum(typesafe_right) / len(typesafe_right):.3f}"
        )
        print(
            "  by subject: "
            + "  ".join(f"{s.replace('college_', '')} {sum(res[s]) / len(res[s]):.2f}" for s in SUBJECTS)
        )
    print(f"\n{total} items, {(time.time() - started) / total * 1000:.0f} ms each on {jev.device}, {model}")
    print(f"every answer, probability and latency: {os.path.relpath(log.name, ROOT)}")


def cli():
    args = sys.argv[1:]
    main(*args[:1], **({"n": int(args[1])} if len(args) > 1 else {}))


if __name__ == "__main__":
    cli()
