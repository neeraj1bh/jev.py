# Changelog

## 0.1.0 (2026-10-06)

The first public release.

- **Typed decisions from any local model.** `core.py` scores each option of a yes/no, choice or
  score question by the probability the model gives it, with the state's cache shared by every
  option, and answers in TypeSafe's request and response shapes.
- **Hosted models, read by letter.** `remote.py` asks DeepSeek, Kimi, OpenAI, OpenRouter models and
  llama.cpp for one letter and reads the options' probabilities from its top log-probabilities.
  TypeSafe's Jev, through its API or Vercel's gateway, and Laya answer in their own typed shape.
- **A page to compare them.** The same questions to several models with answers, probabilities and
  times side by side; a model's written answers against its own readout; batches of a labelled set,
  replayed or reopened later.
- **Core v1.** A frozen benchmark of 2,302 items from public, human-labelled sets, 328 more with
  over 26 options, scored with intervals that resample whole clusters.

Fixed in the week before release: written answers match the longest option they start with; a
model that is loading or starting holds up no other request, and each local model answers one
request at a time; requests that change files answer this machine only; server addresses typed
under Keys must include their path and reach every model using them; models that only return
probabilities are never asked to write; Laya carries its 100-option limit.
