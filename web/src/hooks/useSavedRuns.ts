import { useState } from "react";

import type { KindFilter } from "../components/past/RunFilter";
import { fetchRuns } from "../lib/api";
import type { SavedRun } from "../lib/types";
import { usePersistentState } from "./usePersistentState";

const isKindFilter = (value: unknown): value is KindFilter =>
  value === "" || value === "cmp" || value === "gen";

/** The runs saved on this machine, and how Past runs pages and filters them. */
export function useSavedRuns() {
  const [runs, setRuns] = useState<SavedRun[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [kind, setKind] = usePersistentState<KindFilter>("runs-kind", "", isKindFilter);

  const refresh = () => {
    if (!runs.length) setLoading(true); // the list on screen stays while it refreshes
    fetchRuns()
      .then(setRuns)
      .finally(() => setLoading(false));
  };

  return { runs, page, setPage, loading, kind, setKind, refresh };
}
