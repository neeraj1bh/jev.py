"""Does jev.py get real judgments right? Public data, public labels, model sees only the text.

  hn       one Hacker News title per call, three questions in one pass
             show    noul    Show HN post?             truth: the "Show HN:" prefix, removed first
             ask     noul    Ask HN post?              truth: the "Ask HN:" prefix, removed first
             kind    choice  code/paper/video/ref/news truth: the link's domain
  commits  one commit message per call, from public repos using conventional commits
             type    choice  fix/feat/docs/refactor/test/chore   truth: the prefix, removed first
  shell    one shell command per call, 40 hand-labelled
             writes  noul    does it modify or delete anything?   truth: labelled by hand

Prints accuracy, Brier score and a reliability table (how often a 0.9 was actually a yes).

    python eval.py [model_id] [n]        # n per class, default 60

The item set is saved to results/eval-set.json on first run and reused after,
so every model is scored on the same items.
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

from jev import DEFAULT_MODEL, Jev


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "jev.py eval"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


HN = "https://hn.algolia.com/api/v1/{}?tags=story&hitsPerPage=300&query={}"
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


def hn_rows(n):
    def hits(kind, q, extra=""):
        return get(HN.format(kind, urllib.parse.quote(q)) + extra)["hits"]

    rows = []
    for prefix in ("Show HN", "Ask HN"):
        for h in [
            h for h in hits("search_by_date", f'"{prefix}:"') if h["title"].lower().startswith(prefix.lower())
        ][:n]:
            rows.append(
                (re.sub(rf"^{prefix}:?\s*", "", h["title"], flags=re.I), {prefix.split()[0].lower(): 1})
            )
    for h in [
        h for h in hits("search_by_date", "") if not re.match(r"(show|ask|tell|launch) hn", h["title"], re.I)
    ][:n]:
        rows.append((h["title"], {"show": 0, "ask": 0}))
    for dom, kind in KINDS.items():
        for h in [
            h for h in hits("search", dom, "&restrictSearchableAttributes=url") if dom in (h.get("url") or "")
        ][: n // 3]:
            rows.append((h["title"], {"kind": kind}))
    return rows


def commit_rows(n):
    rows = []
    for repo in COMMIT_REPOS:
        for page in (1, 2):
            for c in get(f"https://api.github.com/repos/{repo}/commits?per_page=100&page={page}"):
                m = re.match(
                    r"(fix|feat|docs|refactor|test|chore)(\(.*?\))?!?:\s*(.+)",
                    c["commit"]["message"].split("\n")[0],
                )
                if m:
                    rows.append((m.group(3), {"type": m.group(1)}))
    per = {}
    return [r for r in rows if per.setdefault(r[1]["type"], []).append(r) or len(per[r[1]["type"]]) <= n]


def report(name, pairs, kind):
    if kind == "noul":
        acc = sum((p > 0.5) == y for p, y in pairs) / len(pairs)
        brier = sum((p - y) ** 2 for p, y in pairs) / len(pairs)
        print(f"\n{name:<8} noul    n={len(pairs):<4} accuracy={acc:.3f}  brier={brier:.3f}")
        print("  p(yes)       n   actually yes")
        for lo, hi in ((0, 0.1), (0.1, 0.3), (0.3, 0.5), (0.5, 0.7), (0.7, 0.9), (0.9, 1.01)):
            b = [y for p, y in pairs if lo <= p < hi]
            if b:
                print(f"  [{lo:.1f},{min(hi, 1):.1f})   {len(b):>4}   {sum(b) / len(b):.2f}")
    else:
        acc = sum(c == y for c, y, _ in pairs) / len(pairs)
        print(f"\n{name:<8} choice  n={len(pairs):<4} accuracy={acc:.3f}  (chance {1 / kind:.2f})")
        print("  confidence   n   accuracy")
        for lo, hi in ((0, 0.3), (0.3, 0.6), (0.6, 0.8), (0.8, 1.01)):
            b = [c == y for c, y, conf in pairs if lo <= conf < hi]
            if b:
                print(f"  [{lo:.1f},{min(hi, 1):.1f})   {len(b):>4}   {sum(b) / len(b):.2f}")


def load_set(n):
    """Fetch the items once and keep them, so every model is scored on the same set."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "eval-set.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    data = {"hn": hn_rows(n), "commits": commit_rows(n), "shell": SHELL}
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=1)
    return data


def main(model=DEFAULT_MODEL, n=60):
    data = load_set(n)
    jev = Jev(model)
    t0, total, res = time.time(), 0, {}
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
        a = jev.ask({"hacker_news_post_title": title}, hn_q)["answers"]
        for k, y in truth.items():
            res.setdefault(k, []).append(
                (a[k]["noul"], y) if k != "kind" else (a[k]["choice"], y, a[k]["confidence"])
            )
        total += 1
    for msg, truth in data["commits"]:
        a = jev.ask(
            {"commit_message": msg},
            {
                "type": {
                    "type": "choice",
                    "criteria": COMMIT_TYPES,
                    "instructions": "What kind of change is this commit?",
                }
            },
        )["answers"]
        res.setdefault("type", []).append((a["type"]["choice"], truth["type"], a["type"]["confidence"]))
        total += 1
    for cmd, y in data["shell"]:
        a = jev.ask(
            {"shell_command": cmd},
            {
                "writes": {
                    "type": "noul",
                    "instructions": "Does running this command create, modify or delete "
                    "any file, process, package or setting?",
                }
            },
        )["answers"]
        res.setdefault("writes", []).append((a["writes"]["noul"], y))
        total += 1
    for name, kind in (
        ("show", "noul"),
        ("ask", "noul"),
        ("kind", len(KIND_DESC)),
        ("type", len(COMMIT_TYPES)),
        ("writes", "noul"),
    ):
        report(name, res[name], kind)
    print(f"\n{total} items, {(time.time() - t0) / total * 1000:.0f} ms each on {jev.device}, {model}")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(*a[:1], **({"n": int(a[1])} if len(a) > 1 else {}))
