import { useEffect, useState } from "react";

import type { PanelState } from "../types";

/** Milliseconds shown for a panel: ticking while it runs, capped during a replay, final when done. */
export function useElapsed(state: PanelState) {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (state.status !== "running") return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state.status]);

  if (state.status === "done") return state.ms ?? 0;
  if (state.status !== "running") return 0;
  const elapsed = Math.round(now - (state.startedAt ?? now));
  return Math.max(0, Math.min(elapsed, state.cap ?? Number.POSITIVE_INFINITY));
}
