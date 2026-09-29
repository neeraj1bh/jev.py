# The API, by example

One server at a time answers on `http://localhost:8080/v1/systemone`:

```sh
uv run jev serve                   # a model on this machine
uv run jev-remote deepseek serve   # a hosted model, key in .env
```

`uv run prod` and `uv run dev` use the same port, so stop one before starting another.

## A request

The self-check's request: one ticket, one question of each type.

```sh
curl -s localhost:8080/v1/systemone -H 'content-type: application/json' -d @- <<'EOF' | python3 -m json.tool --indent 2
{
  "state": {
    "ticket": "I was charged twice for order #4411 and I want my money back. This is the third time I've written, I'm done with you people.",
    "customer_since": "2019"
  },
  "questions": {
    "refund_requested": { "type": "noul", "instructions": "Is the customer asking for a refund?" },
    "is_spam": { "type": "noul", "instructions": "Is this message spam or an advertisement?" },
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this ticket?",
      "criteria": {
        "billing": "charges, refunds, invoices",
        "shipping": "delivery, tracking, lost parcels",
        "returns": "returning or exchanging an item",
        "other": null
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["calm and polite", "annoyed but civil", "angry, threatening to leave"]
    }
  }
}
EOF
```

## A model on this machine

`uv run jev serve` with the default Qwen2.5-1.5B-Instruct (numbers rounded):

```json
{
  "model": "Qwen/Qwen2.5-1.5B-Instruct",
  "answers": {
    "refund_requested": { "type": "noul", "noul": 1.0, "raw": [-0.0025, -10.0025] },
    "is_spam": { "type": "noul", "noul": 0.0015, "raw": [-6.5296, -0.0296] },
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.9841, "shipping": 0.0, "returns": 0.0159, "other": 0.0 },
      "confidence": 0.941,
      "raw": [-0.0166, -11.3916, -4.1416, -14.7666]
    },
    "frustration": {
      "type": "score",
      "score": 1.8644,
      "probabilities": { "0": 0.0247, "1": 0.0862, "2": 0.8891 },
      "legend": { "0": "calm and polite", "1": "annoyed but civil", "2": "angry, threatening to leave" },
      "confidence": 0.6293,
      "raw": [-3.5871, -2.3371, -0.0038]
    }
  },
  "usage": { "input_tokens": 567, "output_tokens": 0 }
}
```

- `noul` is the probability of yes; `choice` is the likeliest option; `score` is the expected
  level, here 1.86 on a scale of 0 to 2.
- `raw` is each option's log-probability, in the order the options were given.
- `output_tokens` is 0: the model reads its options, it writes nothing.

## A hosted model

`uv run jev-remote deepseek serve`, asked the README's one-question request (`raw` cut to three of
its twenty tokens, numbers rounded):

```json
{
  "model": "deepseek-flash",
  "answers": {
    "refund": {
      "type": "noul",
      "noul": 1.0,
      "coverage": { "status": "complete", "observed": 1.0, "missing": [] },
      "raw": [["A", -0.0000156], ["a", -11.361], ["yes", -12.912]]
    }
  },
  "invalid": {},
  "usage": { "input_tokens": 69, "output_tokens": 1, "cost": null, "per_question": { "...": "..." } },
  "latency_ms": 961
}
```

A hosted model sees the options as letters (A = yes, B = no) and writes one token.

- `raw` is the top tokens the provider returned for it, with their log-probabilities.
- `coverage` says how many of the options' letters were among those tokens: `complete`, `partial`
  (the missing letters are listed and count as zero), or `none`.
- A question with no option letter among the top tokens goes to `invalid` instead of `answers`.
- `cost` is in dollars where the provider reports it (OpenRouter), else `null`.
