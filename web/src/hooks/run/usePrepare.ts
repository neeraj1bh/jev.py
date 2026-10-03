import { useRef, useState } from "react";

import { errorMessage, loadModel } from "../../lib/api";
import { ggufOverBudget } from "../../lib/backends";
import type { Backend } from "../../lib/types";
import type { RunContext } from "./context";
import type { RunView } from "./useRunView";

export function usePrepare(
  { backends, confirm, toast, reload }: RunContext,
  { setVerdict }: RunView,
) {
  // The step a run is waiting on before its first request, and the downloads that measure it.
  const [waiting, setWaiting] = useState<{ label: string; downloads: string[] } | null>(null);

  // Models loaded from this page already; loading them again is quick and needs no loader.
  const loaded = useRef(new Set<string>());

  /** Downloads the local models that are not on disk yet, all at once after one question,
   * then loads each model, so timing starts warm. */
  async function prepare(models: string[]) {
    const picked = models
      .map((id) => backends[id])
      .filter((backend): backend is Backend => !!backend);
    if (!picked.length || picked.length !== models.length) {
      setVerdict("Pick a model first.");
      return false;
    }
    const tooBig = ggufOverBudget(picked);
    if (tooBig) {
      setVerdict(tooBig);
      toast.show(tooBig);
      return false;
    }
    const missing = picked.filter((backend) => backend.group === "local" && !backend.ready);
    if (missing.length && !(await confirmDownloads(missing))) return false;
    // A download changes what is on disk; a GGUF model starts llama-server, shown in the header.
    const refresh = missing.length > 0 || picked.some((backend) => backend.group === "gguf");
    try {
      await Promise.all(missing.map((backend) => loadModel(backend.id)));
      for (const backend of picked) await warmUp(backend);
    } catch (error) {
      setVerdict(errorMessage(error));
      toast.show(errorMessage(error));
      if (refresh) await reload();
      return false;
    } finally {
      setWaiting(null);
    }
    if (refresh) await reload();
    return true;
  }

  async function confirmDownloads(missing: Backend[]) {
    const gb = missing.reduce((sum, backend) => sum + (backend.gb ?? 0), 0);
    const names = missing.map((backend) => backend.label).join(", ");
    const ok = await confirm.ask(
      missing.length === 1 ? `Download ${names}?` : `Download ${missing.length} models?`,
      `${missing.length === 1 ? "" : `${names}. `}About ${gb.toFixed(1)} GB, saved to ${missing[0]?.path?.replace(/models--.*$/, "") ?? "models/"} and used from there next time.`,
      "Download",
    );
    if (ok) {
      setVerdict(`Downloading ${names}. First time only; this can take minutes.`);
      setWaiting({ label: "downloading", downloads: missing.map((backend) => backend.id) });
    }
    return ok;
  }

  /** Loads one picked model before its timed run, with a loader the first time. */
  async function warmUp(backend: Backend) {
    const cold = !backend.running && !loaded.current.has(backend.id);
    if (backend.group === "local") {
      setVerdict(`Loading ${backend.label}…`);
      if (cold) setWaiting({ label: "loading the model", downloads: [] });
    }
    if (backend.group === "gguf") {
      setVerdict(`Starting llama-server with ${backend.label}…`);
      if (cold) setWaiting({ label: "starting llama.cpp", downloads: [] });
    }
    const { stopped } = await loadModel(backend.id);
    loaded.current.add(backend.id);
    if (stopped?.length) toast.show(`Stopped ${stopped.join(", ")} to make room.`);
  }

  return {
    waiting,
    prepare,
  };
}
