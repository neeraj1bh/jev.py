import type { Backend, Dataset, Item, KeyInfo, Request, Response, SavedRun, Side } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function getJson<T>(path: string): Promise<T> {
  return (await (await fetch(path)).json()) as T;
}

export const postJson = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

async function postOrThrow<T>(path: string, body: unknown): Promise<T> {
  const response = await postJson(path, body);
  const data = (await response.json()) as T & { error?: { message?: string } };
  if (!response.ok) throw new ApiError(data.error?.message ?? response.statusText, response.status);
  return data;
}

export const fetchBackends = () => getJson<Backend[]>("/v1/backends");
export const fetchGateway = () => getJson<Backend[]>("/v1/gateway");
export const fetchDatasets = () => getJson<Dataset[]>("/v1/datasets");
export const fetchRuns = () => getJson<SavedRun[]>("/v1/runs");
export const fetchProgress = () =>
  getJson<Record<string, { done: number; total: number; unit: string }>>("/v1/progress");

export async function fetchRun(name: string) {
  interface Saved {
    it: Item;
    sides: Record<string, { ms: number; res: Response }>;
  }
  const rows = await getJson<Saved[]>(`/v1/run?name=${encodeURIComponent(name)}`);
  return rows.map((row) => ({
    item: row.it,
    sides: Object.fromEntries(
      Object.entries(row.sides).map(([backend, side]) => [
        backend,
        { ms: side.ms, response: side.res } satisfies Side,
      ]),
    ),
  }));
}

/** `wide` lets a frozen benchmark include its over-26-option items: every picked model reads them. */
export const sampleItem = (dataset: string, fresh = false, wide = false) =>
  postOrThrow<Item>("/v1/sample", { dataset, fresh, wide });
export const loadModel = (backend: string) => postOrThrow<unknown>("/v1/load", { backend });
/** `backend` is a backend id such as remote:deepseek, or a key name such as HF_TOKEN. */
export const saveKey = (backend: string, key: string, save: boolean) =>
  postOrThrow<unknown>("/v1/key", { backend, key, save });
export const fetchKeys = () => getJson<KeyInfo[]>("/v1/keys");
/** Forgets a key for this session and removes it from .env. */
export const clearKey = (backend: string) =>
  postOrThrow<unknown>("/v1/key", { backend, clear: true });

export interface Preset {
  name: string;
  dataset: string;
  models: string[];
}
export const fetchPresets = () => getJson<Preset[]>("/v1/presets");

export async function readout(
  body: Request & { backend: string } & Record<string, unknown>,
): Promise<Response> {
  return (await (await postJson("/v1/systemone", body)).json()) as Response;
}

export async function streamGenerate(body: object, onChunk: (text: string) => void) {
  const { body: stream } = await postJson("/v1/generate", body);
  if (!stream) throw new Error("The server sent no text stream.");
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    onChunk(decoder.decode(value, { stream: true }));
  }
}
