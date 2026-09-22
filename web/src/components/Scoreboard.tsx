import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useCountUp } from "../hooks/useCountUp";
import { scoreResponse } from "../scoring";
import { cn, labelText } from "../styles";
import type { Row } from "../types";
import { Tip } from "./Tip";

interface Lane {
  name: string;
  correct: number;
  total: number;
  averageMs: number;
}

function lanes(rows: Row[], columns: string[]): Lane[] {
  return columns.map((name, k) => {
    let correct = 0;
    let total = 0;
    let ms = 0;
    let answered = 0;
    for (const row of rows) {
      const side = row.sides[k];
      if (!side) continue;
      const [c, n] = scoreResponse(side.response, row.item.truth);
      correct += c;
      total += n;
      ms += side.ms;
      answered++;
    }
    return { name, correct, total, averageMs: answered ? ms / answered : 0 };
  });
}

function Clock({ startedAt, pace }: { startedAt: number; pace: number }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const seconds = Math.max(0, ((now - startedAt) * pace) / 1000);
  return (
    <span className="font-mono text-[34px] leading-none font-semibold text-ink tabular-nums">
      {seconds.toFixed(1)}
      <small className="ml-1 text-sm font-normal text-dim">s</small>
    </span>
  );
}

interface LaneRowProps {
  lane: Lane;
  rank: number;
  leading: boolean;
  labelled: boolean;
}

/** One model in one line: rank, name, a bar as wide as the page allows, then its numbers. */
function LaneRow({ lane, rank, leading, labelled }: LaneRowProps) {
  const share = lane.total ? lane.correct / lane.total : 0;
  const shown = useCountUp(share * 100);
  const ms = useCountUp(lane.averageMs);
  return (
    <motion.li
      layout
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="grid grid-cols-[1.75rem_minmax(7rem,15rem)_minmax(0,1fr)_5rem_minmax(0,11rem)] items-center gap-x-4 border-t border-rule py-2.5 first:border-t-0 max-[700px]:grid-cols-[1.75rem_minmax(0,1fr)_5rem] max-[700px]:gap-y-1.5"
    >
      <span className="font-mono text-xs text-dim tabular-nums">{rank}</span>
      <Tip content={lane.name}>
        <span className="truncate text-sm font-semibold text-ink">{lane.name}</span>
      </Tip>
      <span className="h-2 overflow-hidden rounded-full bg-bar max-[700px]:order-last max-[700px]:col-span-3">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500 ease-out",
            leading ? "bg-good" : "bg-dim",
          )}
          style={{ width: `${labelled ? share * 100 : 100}%` }}
        />
      </span>
      <span
        className={cn(
          "text-right font-mono text-xl leading-none font-semibold tabular-nums transition-colors",
          leading ? "text-good" : "text-ink",
        )}
      >
        {labelled ? `${shown.toFixed(1)}%` : `${Math.round(ms)} ms`}
      </span>
      <span
        className={cn(labelText, "truncate text-right font-mono tabular-nums max-[700px]:hidden")}
      >
        {labelled && `${lane.correct}/${lane.total} · `}
        {Math.round(ms).toLocaleString()} ms avg
      </span>
    </motion.li>
  );
}

interface ScoreboardProps {
  rows: Row[];
  columns: string[];
  total: number;
  startedAt: number;
  pace: number;
  label: string;
}

/** The live view while a batch runs or replays: a clock, the count, and models racing on share right. */
export function Scoreboard({ rows, columns, total, startedAt, pace, label }: ScoreboardProps) {
  const all = lanes(rows, columns);
  const labelled = all.some((lane) => lane.total > 0);
  const score = (lane: Lane) =>
    labelled ? (lane.total ? lane.correct / lane.total : 0) : -lane.averageMs;
  const ranked = [...all].sort((a, b) => score(b) - score(a));
  const [first, second] = ranked;
  const leader =
    rows.length > 0 && first && second && score(first) > score(second) ? first.name : undefined;
  const done = useCountUp(rows.length, 120);

  return (
    <section className="mb-3.5 rounded-lg border border-rule bg-panel px-5 py-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <span className={labelText}>{label}</span>
        <div className="flex items-baseline gap-5">
          <span className="font-mono text-sm text-dim tabular-nums">
            <span className="text-ink">{Math.round(done).toLocaleString()}</span> /{" "}
            {total.toLocaleString()} items
          </span>
          <Clock startedAt={startedAt} pace={pace} />
        </div>
      </div>
      <span className="mt-3 mb-2 block h-1 overflow-hidden rounded-full bg-bar">
        <span
          className="block h-full rounded-full bg-ink/70 transition-[width] duration-300"
          style={{ width: `${total ? (rows.length / total) * 100 : 0}%` }}
        />
      </span>
      <ol className="m-0 list-none p-0">
        {ranked.map((lane, k) => (
          <LaneRow
            key={lane.name}
            lane={lane}
            rank={k + 1}
            leading={lane.name === leader}
            labelled={labelled}
          />
        ))}
      </ol>
    </section>
  );
}
