import { useCallback, useEffect, useRef, useState } from "react";

import type { Row } from "../types";

/** A fixed pace, or FIT: whatever pace makes the whole replay last FIT_MS, for short clips. */
export type ReplaySpeed = 1 | 4 | 10 | 50 | 100 | "fit";
export const FIT = "fit";
export const FIT_MS = 30_000;
const UPDATE_MS = 50;

/**
 * When each row finished, from the start of the run: the recorded finish times when every row has
 * one, else rebuilt from the recorded durations with `workers` rows running at once, in order.
 */
function finishTimes(rows: Row[], workers: number) {
  const slowest = (row: Row) => Math.max(0, ...row.sides.map((side) => side.ms));
  if (rows.length && rows.every((row) => row.at)) {
    const start = Math.min(...rows.map((row) => (row.at ?? 0) - slowest(row)));
    return rows.map((row, index) => ({ index, end: (row.at ?? 0) - start }));
  }
  const free = Array.from({ length: Math.max(1, workers) }, () => 0);
  return rows.map((row, index) => {
    const worker = free.indexOf(Math.min(...free));
    const end = (free[worker] ?? 0) + slowest(row);
    free[worker] = end;
    return { index, end };
  });
}

/**
 * Plays a finished batch back as it happened: rows appear at the moment they finished. One frame
 * loop reads the clock, so a 3,000-row replay at 100× costs no more than a short one.
 */
export function useBatchReplay(rows: Row[]) {
  const [shown, setShown] = useState<number[] | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [pace, setPace] = useState(1);
  const frame = useRef(0);

  const stop = useCallback(() => {
    cancelAnimationFrame(frame.current);
    setShown(null);
  }, []);

  const play = useCallback(
    (workers: number) => {
      stop();
      const schedule = finishTimes(rows, workers).sort((a, b) => a.end - b.end);
      const last = schedule.at(-1)?.end ?? 0;
      const rate = speed === FIT ? Math.max(1, last / FIT_MS) : speed;
      const start = performance.now();
      setPace(rate);
      setStartedAt(start);
      setShown([]);
      let done = 0;
      let shownDone = 0;
      let lastShown = 0;
      const tick = () => {
        const now = performance.now();
        const elapsed = (now - start) * rate;
        while (done < schedule.length && (schedule[done]?.end ?? 0) <= elapsed) done++;
        // Rows reach the page at most every UPDATE_MS; the clocks and counts glide in between.
        if (done !== shownDone && (now - lastShown >= UPDATE_MS || done === schedule.length)) {
          shownDone = done;
          lastShown = now;
          setShown(schedule.slice(0, done).map((step) => step.index));
        }
        if (elapsed < last + 800 * rate) frame.current = requestAnimationFrame(tick);
        else setShown(null);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [rows, speed, stop],
  );

  useEffect(() => stop, [stop]);

  const visibleRows =
    shown === null
      ? rows
      : shown.flatMap((index) => (rows[index] ? [{ ...rows[index], isNew: true }] : []));
  return { replaying: shown !== null, visibleRows, play, stop, speed, setSpeed, pace, startedAt };
}
