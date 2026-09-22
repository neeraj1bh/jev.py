import { useCallback, useEffect, useState } from "react";

import { fetchBackends, fetchDatasets, fetchGateway } from "../api";
import { isUsable, TEXTLESS } from "../backends";
import type { Backend, Dataset } from "../types";

export function useBackends() {
  const [backends, setBackends] = useState<Record<string, Backend>>({});
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  // Not remembered across reloads: the page opens with no model picked.
  const [generateModel, setGenerateModel] = useState("");
  const [compareModels, setCompareModels] = useState<string[]>([]);

  /** Keeps the viewer's picks while they still work. */
  const apply = useCallback((list: Backend[]) => {
    const byId = Object.fromEntries(list.map((backend) => [backend.id, backend]));
    const usable = (id?: string) => !!id && isUsable(byId[id]);
    const canGenerate = (id?: string) => id !== undefined && usable(id) && !TEXTLESS.has(id);
    setBackends(byId);
    // Both start empty: nothing runs, downloads or spends a key until a model is picked.
    setGenerateModel((previous) => (canGenerate(previous) ? previous : ""));
    setCompareModels((previous) => previous.filter(usable));
  }, []);

  /** Direct backends, plus the gateway's catalog when it can be fetched. */
  const fetchAll = useCallback(async () => {
    const [direct, gateway] = await Promise.all([fetchBackends(), fetchGateway().catch(() => [])]);
    return [...direct, ...gateway];
  }, []);

  /** Refetches the models and returns them, for a caller that needs one just added. */
  const reload = useCallback(async () => {
    const list = await fetchAll();
    apply(list);
    return list;
  }, [apply, fetchAll]);

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
