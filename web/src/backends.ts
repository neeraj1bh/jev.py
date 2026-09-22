import type { Backend, BackendGroup, Dataset } from "./types";

/** Jev returns probabilities only; it never writes text. */
export const OPENROUTER = "remote:openrouter";
export const TEXTLESS = new Set(["remote:typesafe", "remote:vercel"]);

/** A llama.cpp server that is not running, or a GGUF file with no llama-server program set. */
export const isOffline = (backend: Backend) =>
  !backend.ready && (backend.group === "server" || backend.group === "gguf");

export const isUsable = (backend?: Backend) =>
  !!backend && !isOffline(backend) && (backend.ready || backend.group === "local");

export const isHosted = (backend?: Backend) => backend?.group === "hosted";

export function statusText(backend: Backend) {
  if (backend.group === "local") {
    const size = backend.gb ? ` ${backend.gb} GB` : "";
    return backend.ready ? `${backend.gb ? `${backend.gb} GB · ` : ""}on disk` : `download${size}`;
  }
  if (backend.group === "server") return backend.ready ? "running" : "not running";
  if (backend.group === "gguf") return backend.ready ? `${backend.gb} GB` : "needs llama-server";
  const model = backend.model ? `${backend.model} · ` : "";
  return model + (backend.ready ? "key set" : "add key");
}

export function pickerSubtitle(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "local") {
    return `${backend.device}${backend.gb ? ` · ${backend.gb} GB` : ""}${backend.ready ? "" : " · download"}`;
  }
  if (backend.group === "gateway") return "via OpenRouter";
  if (backend.group === "gguf") return "llama.cpp";
  if (backend.group === "server") return backend.ready ? "running" : "not running";
  return backend.model ?? "direct API";
}

export function location(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "server") return `llama.cpp at ${backend.url}`;
  if (backend.group === "gguf") return `${backend.path}, run by llama-server`;
  if (backend.group === "hosted") return `Key from ${backend.key}`;
  const need =
    backend.need_gb && backend.have_gb
      ? `. Needs about ${backend.need_gb} GB; this machine has ${backend.have_gb} GB.`
      : "";
  return `${backend.ready ? "On disk" : "Downloads to"} ${backend.path}${need}`;
}

/** A set with more options than a letter-reading backend can take (26) cannot run there. */
export const blockingBackend = (dataset: Dataset, backends: (Backend | undefined)[]) =>
  backends.find((backend) => backend?.max && dataset.options && dataset.options > backend.max);

export const panelSubtitle = (name?: string) =>
  name?.endsWith("· text")
    ? "written answers, each counted as certain"
    : "one request, a probability for every option";

const DIRECT_GROUPS: [BackendGroup, string][] = [
  ["local", "On this machine"],
  ["gguf", "GGUF files · llama.cpp"],
  ["server", "Local server"],
  ["hosted", "Direct APIs · one pinned model each"],
];

/** Usable backends first, then the ones that still need a key or a server. */
export function groupBackends(backends: Backend[]) {
  const rank = (backend: Backend) => (backend.ready || backend.group === "local" ? 0 : 1);
  const device = backends.find((backend) => backend.group === "local")?.device ?? "";
  // A group with nothing in it, such as a local server nobody runs, gets no heading.
  return DIRECT_GROUPS.map(([group, name]) => ({
    group,
    heading: group === "local" ? `${name} · ${device}` : name,
    // OpenRouter's own entry only holds its key; its models are listed under their makers.
    backends: backends
      .filter((backend) => backend.group === group && backend.id !== OPENROUTER)
      .sort((a, b) => rank(a) - rank(b)),
  })).filter((entry) => entry.backends.length > 0);
}

const PROVIDER_NAMES: Record<string, string> = {
  qwen: "Qwen",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  "z-ai": "Z.ai",
  "x-ai": "xAI",
  moonshotai: "Kimi",
  "meta-llama": "Meta Llama",
  google: "Google",
  mistralai: "Mistral",
  minimax: "MiniMax",
  nvidia: "NVIDIA",
  inclusionai: "inclusionAI",
  "ibm-granite": "IBM Granite",
  openrouter: "OpenRouter",
};

export const providerName = (slug = "") => PROVIDER_NAMES[slug] ?? slug;

// Measured 2026-09-22 by rendering every letter-readout prompt of the frozen set with the Qwen
// tokenizer: 4,055 requests, 2.25M input tokens, one output token each. TypeSafe's cases are 1.75M
// of it, since each question resends its document; the other questions average 135 tokens.
const RUN_QUESTIONS = 4_055;
const RUN_INPUT_TOKENS = 2_250_000;
// For a set with no measurement: the average one-question item of the frozen set above.
const ITEM_INPUT_TOKENS = 135;

const dollars = (backend: Backend, input: number, output: number) => {
  if (backend.free || backend.price === 0) return 0;
  if (backend.price === undefined) return null;
  return ((backend.price ?? 0) * input + (backend.price_out ?? 0) * output) / 1e6;
};

/** Dollars for one full frozen-set run: 0 when free, null when the price is unknown. */
export const runDollars = (backend: Backend) => dollars(backend, RUN_INPUT_TOKENS, RUN_QUESTIONS);

/** Dollars for `items` items of a set, from its measured size when there is one. */
export const itemsDollars = (backend: Backend, items: number, dataset?: Dataset) =>
  dollars(
    backend,
    (dataset?.tokens ?? ITEM_INPUT_TOKENS) * items,
    (dataset?.questions ?? 1) * items,
  );

export const dollarText = (dollars: number) =>
  `$${dollars < 1 ? dollars.toFixed(2) : dollars.toFixed(dollars < 10 ? 1 : 0)}`;
