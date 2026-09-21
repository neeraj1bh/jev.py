import { useCallback, useEffect, useRef, useState } from "react";

import type { Row } from "../types";

export type ReplaySpeed = 1 | 2 | 4;

/** When each row finished, rebuilt from the recorded times: `workers` rows ran at once, in order. */
function finishTimes(rows: Row[], workers: number) {
  const free = Array.from({ length: Math.max(1, workers) }, () => 0);
  return rows.map((row, index) => {
    const worker = free.indexOf(Math.min(...free));
    const end = (free[worker] ?? 0) + Math.max(0, ...row.sides.map((side) => side.ms));
    free[worker] = end;
    return { index, end };
  });
}

/** Plays a finished batch back as it happened: rows appear at the moment they finished. */
export function useBatchReplay(rows: Row[]) {
  const [shown, setShown] = useState<number[] | null>(null);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const timers = useRef<number[]>([]);

  const stop = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
    setShown(null);
  }, []);

  const play = useCallback(
    (workers: number) => {
      stop();
      setShown([]);
      const schedule = finishTimes(rows, workers);
      for (const { index, end } of schedule) {
        timers.current.push(
          window.setTimeout(() => setShown((current) => [...(current ?? []), index]), end / speed),
        );
      }
      const last = Math.max(0, ...schedule.map((step) => step.end));
      timers.current.push(window.setTimeout(() => setShown(null), last / speed + 800));
    },
    [rows, speed, stop],
  );

  useEffect(() => stop, [stop]);

  const visibleRows = shown === null ? rows : shown.flatMap((index) => rows[index] ?? []);
  return { replaying: shown !== null, visibleRows, play, stop, speed, setSpeed };
}
