# Core v1, the benchmark

`benchmarks/core-v1.json` fixes one set of questions that every model answers: 2,630 items and
2,932 questions from 48 public datasets and TypeSafe's published cases. It covers safety, sentiment,
reading, contracts, other languages, reasoning, knowledge and judging which answer is better. Each
set's picks are balanced across labels, subjects and answer positions, and reviewers read every
question. The file stores pointers, not text: anyone rebuilds the same items from Hugging Face,
and a changed item is reported, not used.

Three sets (Banking77, CLINC150, LEDGAR) have more than 26 options, so only models on this machine
and Jev answer their 328 items. Laya answers two of the three: its server refuses more than 100
options, which rules out CLINC150. Every other model answers the remaining 2,302, and every
comparison uses only the questions all its models answered.

```sh
uv run jev-bench check                            # offline checks, no key, no cost
uv run jev-bench run remote:deepseek              # one model; the run appears in Past runs
uv run jev-bench run Qwen/Qwen2.5-1.5B-Instruct   # a model on this machine
uv run jev-bench run remote:laya:typed-decisions  # Laya, with a laya-serve running
uv run jev-bench score <run>.jsonl <run>.jsonl    # scores, ranges and probability quality
```

The latest results are at the top of the [README](../README.md). The models to run are listed in
`benchmarks/core-v1-models.json`.

## Earlier results

`uv run jev-eval` runs an older, smaller evaluation on public data with public labels, and the
same frozen items for every model. Share of answers right:

| task | chance | 1.5B CPU | 3B CPU | 7B Q4 | 14B Q4 | 30B-A3B Q4 | DeepSeek |
|---|---|---|---|---|---|---|---|
| Show HN title | .50 | .608 | .767 | .767 | **.775** | **.775** | **.775** |
| Ask HN title | .50 | .900 | .917 | .933 | .942 | .942 | **.950** |
| link kind, of 5 | .20 | .650 | .650 | .717 | .775 | .758 | **.842** |
| commit type, of 6 | .17 | .260 | .402 | .429 | .422 | .466 | **.598** |
| shell command writes | .50 | .650 | .700 | .875 | .925 | .925 | **.975** |
| exam subject, of 4 | .25 | .495 | .565 | .640 | .695 | .777 | **.868** |
| sentiment (SST-2) | .50 | .940 | .930 | .947 | .947 | .950 | **.970** |
| phishing email | .50 | .821 | .808 | .849 | .869 | **.945** | .924 |
| entailment (RTE) | .50 | .736 | .690 | .758 | .819 | **.856** | **.856** |
| SNLI, of 3 | .33 | .761 | **.906** | .731 | .889 | .845 | .828 |
| news topic, of 4 | .25 | .827 | .747 | **.837** | .787 | .780 | .813 |
| support intent, of 26 | .04 | .693 | .690 | .813 | .837 | .843 | **.927** |
| toxicity level, of 4 | .25 | .377 | .157 | .337 | .447 | .327 | **.520** |
| **TypeSafe cases** |  | .511 | .593 | .675 | .751 | .774 | **.876** |
| ms per item | | 1,804 | 3,405 | 1,916 | 4,715 | — | 725 |

Qwen2.5 1.5B to 14B and Qwen3-30B-A3B. CPU: an 8-core desktop with PyTorch; the rest on a 12 GB AMD
GPU through llama.cpp. DeepSeek is V4.1 Flash, hosted. Bigger models do better, and small ones are
overconfident: use them to sort and flag, not to gate anything that cannot be undone. Summaries of
each run are in [`results/`](results/).
