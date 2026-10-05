# Hosted providers

`src/jev/remote.py` asks a hosted model for one token with the options labelled A, B, C… and reads the
probability of each letter from the API's `top_logprobs`. A provider works only if its API returns
the probabilities of the most likely next tokens, and only if the model answers straight away
instead of reasoning first. Checked against each provider's API reference on 2026-09-21.

| provider | probabilities | in `src/jev/remote.py` | notes |
|---|---|---|---|
| DeepSeek | top 20 | yes | thinking turned off per request |
| Kimi (Moonshot) | top 20 | yes | Kimi K3 cannot stop reasoning first, so it does not work; earlier Kimi models do |
| OpenAI | top 20 | yes | |
| OpenRouter | passed through | yes | only when the routed provider returns them |
| Together AI | top 20 | not yet | OpenAI-compatible |
| Google Gemini | top candidates | not yet | its own request and response shape |
| xAI (Grok) | top 8 | not yet | letters outside the top 8 would read as 0 |
| Fireworks | top 5 by default | not yet | same limit, raised per deployment |
| Cohere | chosen token only | no | no alternatives, so no distribution |
| Groq | none | no | the API rejects `logprobs` |
| Anthropic (Claude) | none | no | the Messages API returns no probabilities |
| Ollama | yes, from v0.12.11 | not yet | in its own API and its OpenAI-compatible one (release notes, 2025-11-12) |
| Mistral, Qwen (Alibaba) | unconfirmed | no | not stated in the documentation checked |

Of the 139 OpenRouter models checked, only 44 really return probabilities, so the page tests each
one and lists only those.

Two limits follow from reading letters. A question can have at most 26 options, and a provider
that returns fewer than 20 alternatives can only report that many options per question.

TypeSafe's own API (`typesafe`) and the Vercel AI Gateway (`vercel`) are not letter readouts: they
return Jev's probabilities directly and take any number of options.
