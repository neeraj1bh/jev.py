import type { Backend, BackendGroup, Dataset } from "./types";

/** Jev returns probabilities only; it never writes text. */
export const TEXTLESS = new Set(["remote:typesafe", "remote:vercel"]);

export const isOffline = (backend: Backend) => !backend.ready && backend.group === "server";

export const isUsable = (backend?: Backend) =>
  !!backend && !isOffline(backend) && (backend.ready || backend.group === "local");

export const isHosted = (backend?: Backend) => backend?.group === "hosted";

export function statusText(backend: Backend) {
  if (backend.group === "local") {
    const size = backend.gb ? ` ${backend.gb} GB` : "";
    return backend.ready ? `${backend.gb ? `${backend.gb} GB · ` : ""}on disk` : `download${size}`;
  }
  if (backend.group === "server") return backend.ready ? "running" : "not running";
  return backend.ready ? "key set" : "add key";
}

export function pickerSubtitle(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "local") {
    return `${backend.device}${backend.gb ? ` · ${backend.gb} GB` : ""}${backend.ready ? "" : " · download"}`;
  }
  if (backend.group === "gateway") return "via OpenRouter";
  return backend.group === "server" ? (backend.ready ? "running" : "not running") : "hosted";
}

export function location(backend?: Backend) {
  if (!backend) return "";
  if (backend.group === "server") return `llama.cpp at ${backend.url}`;
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
  ["server", "Local server"],
  ["hosted", "Hosted"],
];

/** Usable backends first; with `textlessLast`, Jev (which cannot write text) after the rest. */
export function groupBackends(backends: Backend[], textlessLast: boolean) {
  const rank = (backend: Backend) =>
    textlessLast && TEXTLESS.has(backend.id)
      ? 1
      : backend.ready || backend.group === "local"
        ? 0
        : 2;
  const device = backends.find((backend) => backend.group === "local")?.device ?? "";
  return DIRECT_GROUPS.map(([group, name]) => ({
    group,
    heading: group === "local" ? `${name} · ${device}` : name,
    backends: backends
      .filter((backend) => backend.group === group)
      .sort((a, b) => rank(a) - rank(b)),
  }));
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

// One full run of the frozen set: about 4,000 questions, ~0.75M input tokens, one output token each.
export const RUN_QUESTIONS = 4_000;
const RUN_INPUT_TOKENS = 750_000;

/** Dollars for one full run: 0 when free, null when the price is unknown. */
export function runDollars(backend: Backend) {
  if (backend.free || backend.price === 0) return 0;
  if (backend.price === undefined) return null;
  return ((backend.price ?? 0) * RUN_INPUT_TOKENS + (backend.price_out ?? 0) * RUN_QUESTIONS) / 1e6;
}

export const dollarText = (dollars: number) =>
  `$${dollars < 1 ? dollars.toFixed(2) : dollars.toFixed(dollars < 10 ? 1 : 0)}`;
