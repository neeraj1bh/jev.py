import { ApiError, readout, sampleItem, streamGenerate } from "./api";
import { parseWritten, readoutFooter } from "./scoring";
import type { GeneratedText, Item, RecordedSide, Response, Side } from "./types";

export const now = () => performance.now();

/** Hosted models run at once; models on this machine take turns so they do not slow each other. */
export async function runEach<T>(
  ids: string[],
  isLocal: (id: string) => boolean,
  run: (id: string, index: number) => Promise<T>,
) {
  const results: T[] = [];
  const entries = [...ids.entries()];
  const local = entries.filter(([, id]) => isLocal(id));
  const remote = entries.filter(([, id]) => !isLocal(id));
  await Promise.all([
    ...remote.map(async ([index, id]) => {
      results[index] = await run(id, index);
    }),
    (async () => {
      for (const [index, id] of local) results[index] = await run(id, index);
    })(),
  ]);
  return results;
}

export interface TimedReadout extends RecordedSide {
  startedAt: number;
  failed: boolean;
}

export async function timedReadout(
  body: Parameters<typeof readout>[0],
  onStart: (startedAt: number) => void,
): Promise<TimedReadout> {
  const startedAt = now();
  onStart(startedAt);
  const response = await readout(body);
  const ms = Math.round(now() - startedAt);
  const footer = response.error ? response.error.message : readoutFooter(response);
  return { ms, response, footer, startedAt, failed: !!response.error };
}

export async function timedGenerate(
  body: object,
  onStart: (startedAt: number) => void,
  onText: (text: string) => void,
): Promise<GeneratedText & { startedAt: number }> {
  const startedAt = now();
  const chunks: [number, string][] = [];
  let text = "";
  onStart(startedAt);
  await streamGenerate(body, (chunk) => {
    chunks.push([now() - startedAt, chunk]);
    text += chunk;
    onText(text);
  });
  const ms = Math.round(now() - startedAt);
  const parsed = parseWritten(text);
  return {
    ms,
    parsed,
    chunks,
    text,
    startedAt,
    footer: `${parsed ? "valid JSON" : "not valid JSON"} · no probabilities`,
  };
}

interface BatchOptions {
  dataset: string;
  wide: boolean;
  models: string[];
  total: number;
  workers: number;
  isLocal: (id: string) => boolean;
  requestFields: Record<string, unknown>;
  takeFreshDeck: () => boolean;
  shouldStop: () => boolean;
  onProgress: (progress: { done: number; inFlight: number; left: number | null }) => void;
  onRow: (item: Item, sides: Side[]) => void;
  onError: (message: string) => void;
}

/** Samples items and asks every model, several workers at once; returns why it stopped early, if it did. */
export async function runBatchLoop(options: BatchOptions) {
  const { models, total } = options;
  let started = 0;
  let done = 0;
  let inFlight = 0;
  let left: number | null = null;
  let stopped = false;
  let exhausted = "";

  const worker = async () => {
    while (!stopped && !options.shouldStop() && started < total) {
      started++;
      let item: Item;
      try {
        item = await sampleItem(options.dataset, options.takeFreshDeck(), options.wide);
      } catch (error) {
        stopped = true;
        if (error instanceof ApiError && error.status === 409) exhausted = error.message;
        else options.onError(error instanceof Error ? error.message : String(error));
        return;
      }
      left = item.left ?? null;
      inFlight++;
      options.onProgress({ done, inFlight, left });
      const sides = await runEach(models, options.isLocal, async (backend) => {
        const startedAt = now();
        const response: Response = await readout({ ...item, ...options.requestFields, backend });
        return { ms: response.latency_ms ?? Math.round(now() - startedAt), response };
      });
      const error = sides.find((side) => side.response.error)?.response.error;
      if (error) options.onError(error.message);
      options.onRow(item, sides);
      done++;
      inFlight--;
      options.onProgress({ done, inFlight, left });
    }
  };

  await Promise.all(Array.from({ length: options.workers }, worker));
  return { done, exhausted };
}
