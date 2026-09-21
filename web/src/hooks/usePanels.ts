import { useState } from "react";

import { fastestIndexes } from "../scoring";
import type { PanelState } from "../types";

export const idlePanel = (): PanelState => ({ status: "idle", footer: "Waiting to run." });
export const runningPanel = (footer: string, startedAt: number): PanelState => ({
  status: "running",
  startedAt,
  footer,
});

type PanelUpdate = PanelState | ((previous: PanelState) => PanelState);

export function usePanels() {
  const [panels, setPanels] = useState<PanelState[]>([idlePanel(), idlePanel()]);

  const reset = (count: number) => setPanels(Array.from({ length: count }, idlePanel));
  const update = (index: number, next: PanelUpdate) =>
    setPanels((all) =>
      all.map((panel, k) =>
        k === index ? (typeof next === "function" ? next(panel) : next) : panel,
      ),
    );
  const markFastest = (ms: number[]) => {
    const [fastest] = fastestIndexes(ms);
    setPanels((all) => all.map((panel, k) => ({ ...panel, fastest: k === fastest })));
  };

  return { panels, setPanels, reset, update, markFastest };
}
