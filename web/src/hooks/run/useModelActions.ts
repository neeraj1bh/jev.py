import { useState } from "react";

import type { LocalModelActions } from "../../components/models/ModelMenu";
import { MAX_COMPARE } from "../../components/models/ModelsPicker";
import { addModel, deleteModel, downloadModel, errorMessage, stopModel } from "../../lib/api";
import type { Backend, Mode } from "../../lib/types";
import type { RunContext } from "./context";
import type { Results } from "./useResults";
import type { RunInput } from "./useRunInput";
import type { RunView } from "./useRunView";

/** Picking models for Compare and Generate, adding, deleting and stopping them, and asking for a
 * key when a picked model needs one. */
export function useModelActions(
  ctx: RunContext,
  view: RunView,
  results: Results,
  input: RunInput,
  switchMode: (next: Mode) => void,
) {
  const { backends, datasets, downloads, compareModels, setCompareModels, setGenerateModel } = ctx;
  const { mode, reload, confirm, toast, setOpenMenu } = ctx;
  const { resetPanels, exampleResults } = view;
  const { clearBatch } = results;
  const { dataset } = input;
  const [addingFor, setAddingFor] = useState<"generate" | "compare" | "benchmark" | null>(null);

  const [keyRequest, setKeyRequest] = useState<{
    backend: string;
    forCompare: boolean;
    /** The model to add once the key works, when it differs from the keyed backend. */
    add?: string;
  } | null>(null);

  const warnIfTooManyOptions = (models: string[], name = dataset) => {
    const set = datasets.find((d) => d.name === name);
    const blocker =
      set &&
      models.map((id) => backends[id]).find((b) => b?.max && set.options && set.options > b.max);
    if (set && blocker) {
      toast.show(
        `${name} asks to pick 1 of ${set.options}; ${blocker.label} reads the answer as a letter and takes at most ${blocker.max}. Pick Jev or a local model, or another set.`,
      );
    }
  };

  function askForKey(backend: string, forCompare: boolean, add?: string) {
    setOpenMenu("");
    setKeyRequest({ backend, forCompare, add });
  }

  async function onKeySaved(keyed: string) {
    const forCompare = keyRequest?.forCompare ?? true;
    const backend = keyRequest?.add ?? keyed;
    setKeyRequest(null);
    if (forCompare)
      setCompareModels((models) =>
        models.includes(backend) ? models : [...models, backend].slice(-6),
      );
    else setGenerateModel(backend);
    exampleResults.current = {};
    resetPanels();
    await reload();
    if (forCompare && mode === "generate") switchMode("compare");
  }

  /** A local model picked before it is on disk starts downloading right away, not at the first run. */
  async function downloadIfMissing(backend: Backend) {
    if (backend.group !== "local" || backend.ready || downloads[backend.id]) return;
    const ok = await confirm.ask(
      `Download ${backend.label}?`,
      `About ${backend.gb?.toFixed(1) ?? "?"} GB, saved to ${backend.path?.replace(/models--.*$/, "") ?? "models/"} and used from there next time.`,
      "Download",
    );
    if (!ok) return;
    downloadModel(backend.id)
      .then(() => toast.show(`${backend.label} is downloaded.`))
      .catch((error) => toast.show(errorMessage(error)))
      .finally(reload);
  }

  function pickGenerateModel(id: string) {
    setOpenMenu("");
    const backend = backends[id];
    if (!backend) return;
    // A local model that is not on disk yet downloads when it first runs; only hosted ones need a key.
    if (!backend.ready && backend.group !== "local") {
      if (backend.group === "gateway") askForKey("remote:openrouter", false, id);
      else askForKey(id, false);
      return;
    }
    downloadIfMissing(backend);
    setGenerateModel(id);
    clearBatch();
    exampleResults.current = {};
    resetPanels();
    warnIfTooManyOptions([id]);
  }

  /** Adds a Hugging Face model and picks it where the dialog was opened from. */
  async function addLocalModel(id: string) {
    await addModel(id);
    const added = (await reload()).find((backend) => backend.id === id);
    if (added) downloadIfMissing(added); // not awaited: the dialog closes, then the download asks
    if (addingFor === "generate") {
      setGenerateModel(id);
      clearBatch();
      exampleResults.current = {};
      resetPanels();
    } else if (addingFor === "compare" && compareModels.length < MAX_COMPARE) {
      const next = [...compareModels, id];
      setCompareModels(next);
      clearBatch();
      resetPanels(next.length);
    }
  }

  async function deleteLocalModel(backend: Backend) {
    setOpenMenu("");
    const shared = backend.path?.includes(`${"/"}.cache${"/"}huggingface`)
      ? " It is in the shared Hugging Face cache, so other tools lose it too."
      : "";
    const ok = await confirm.ask(
      `Delete ${backend.label}?`,
      `This removes about ${backend.gb ?? "?"} GB from ${backend.path}.${shared} It downloads again if you pick it later.`,
      "Delete",
    );
    if (!ok) return;
    try {
      const { freed } = await deleteModel(backend.id);
      toast.show(`Deleted ${backend.label}, ${(freed / 1e9).toFixed(1)} GB freed.`);
    } catch (error) {
      toast.show(errorMessage(error));
    }
    await reload();
  }

  const localActions = (target: "generate" | "compare" | "benchmark"): LocalModelActions => ({
    onAddModel: () => {
      setOpenMenu("");
      setAddingFor(target);
    },
    onDelete: deleteLocalModel,
    onStop: async (backend) => {
      await stopModel(backend.id).catch((error) => toast.show(errorMessage(error)));
      await reload();
    },
  });

  function toggleCompareModel(id: string) {
    const backend = backends[id];
    if (!backend) return;
    const adding = !compareModels.includes(id);
    if (adding && !backend.ready && backend.group === "hosted") {
      askForKey(id, true);
      return;
    }
    if (adding && !backend.ready && backend.group === "gateway") {
      askForKey("remote:openrouter", true, id);
      return;
    }
    if (adding) downloadIfMissing(backend);
    const next = adding ? [...compareModels, id] : compareModels.filter((model) => model !== id);
    setCompareModels(next);
    clearBatch();
    exampleResults.current = {};
    resetPanels(next.length);
    warnIfTooManyOptions(next);
  }

  const keyBackend = keyRequest ? backends[keyRequest.backend] : undefined;

  return {
    addingFor,
    setAddingFor,
    setKeyRequest,
    keyBackend,
    onKeySaved,
    pickGenerateModel,
    addLocalModel,
    localActions,
    toggleCompareModel,
  };
}
