import { useCallback, useEffect, useState } from "react";

import { fetchBackends, fetchDatasets, fetchGateway } from "../api";
import { isUsable, TEXTLESS } from "../backends";
import type { Backend, Dataset } from "../types";
import { isString, isStringList, usePersistentState } from "./usePersistentState";

/** The model the server was started with, written into the page by demo.py. */
const startupModel = (() => {
  const content =
    document.querySelector<HTMLMetaElement>('meta[name="default-model"]')?.content ?? "";
  return content.includes("{{") ? "" : content;
})();

export function useBackends() {
  const [backends, setBackends] = useState<Record<string, Backend>>({});
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [generateModel, setGenerateModel] = usePersistentState("generate-model", "", isString);
  const [compareModels, setCompareModels] = usePersistentState<string[]>(
    "compare-models",
    [],
    isStringList,
  );

  /** Keeps the current picks when they still work, otherwise falls back to usable ones. */
  const apply = useCallback(
    (list: Backend[]) => {
      const byId = Object.fromEntries(list.map((backend) => [backend.id, backend]));
      const usable = (id?: string) => !!id && isUsable(byId[id]);
      const canGenerate = (id?: string) => id !== undefined && usable(id) && !TEXTLESS.has(id);
      setBackends(byId);
      setGenerateModel((previous) => {
        const keep = previous || startupModel;
        if (canGenerate(keep)) return keep;
        const local = list.find((b) => canGenerate(b.id) && b.group === "local");
        return (local ?? list.find((b) => canGenerate(b.id)))?.id ?? "";
      });
      setCompareModels((previous) => {
        let picked = previous.filter(usable);
        if (!picked.length) {
          const first = usable(startupModel) ? startupModel : list.find((b) => usable(b.id))?.id;
          if (first) picked = [first];
        }
        while (picked.length < 2) {
          const hosted = list.find(
            (b) => usable(b.id) && b.group === "hosted" && !picked.includes(b.id),
          );
          const next = hosted ?? list.find((b) => usable(b.id) && !picked.includes(b.id));
          if (!next) break;
          picked = [...picked, next.id];
        }
        return picked;
      });
    },
    [setCompareModels, setGenerateModel],
  );

  /** Direct backends, plus the gateway's catalog when it can be fetched. */
  const fetchAll = useCallback(async () => {
    const [direct, gateway] = await Promise.all([fetchBackends(), fetchGateway().catch(() => [])]);
    return [...direct, ...gateway];
  }, []);

  const reload = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);

  useEffect(() => {
    fetchAll().then(apply);
    fetchDatasets().then(setDatasets);
  }, [apply, fetchAll]);

  const markDatasetLocal = (name: string) =>
    setDatasets((all) =>
      all.map((dataset) => (dataset.name === name ? { ...dataset, local: true } : dataset)),
    );

  return {
    backends,
    datasets,
    generateModel,
    setGenerateModel,
    compareModels,
    setCompareModels,
    reload,
    markDatasetLocal,
  };
}
