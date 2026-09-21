import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { useCountUp } from "../hooks/useCountUp";
import { scoreResponse } from "../scoring";
import { cn, labelText } from "../styles";
import type { Row } from "../types";

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
    <span className="font-mono text-[44px] leading-none font-semibold text-ink tabular-nums">
      {seconds.toFixed(1)}
      <small className="ml-1 text-base font-normal text-dim">s</small>
    </span>
  );
}

function LaneRow({ lane, leading, labelled }: { lane: Lane; leading: boolean; labelled: boolean }) {
  const share = lane.total ? lane.correct / lane.total : 0;
  const shown = useCountUp(share * 100);
  const ms = useCountUp(lane.averageMs);
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 380, damping: 32 }}
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-rule py-3 first:border-t-0"
    >
      <span className="truncate text-sm font-semibold text-ink" title={lane.name}>
        {lane.name}
      </span>
      <span
        className={cn(
          "text-right font-mono text-[26px] leading-none font-semibold tabular-nums transition-colors",
          leading ? "text-good" : "text-ink",
        )}
      >
        {labelled ? `${shown.toFixed(1)}%` : `${Math.round(ms)} ms`}
      </span>
      <span className="h-1.5 overflow-hidden rounded-full bg-bar">
        <span
          className={cn(
            "block h-full rounded-full transition-[width] duration-500 ease-out",
            leading ? "bg-good" : "bg-dim",
          )}
          style={{ width: `${labelled ? share * 100 : 100}%` }}
        />
      </span>
      <span className={cn(labelText, "text-right font-mono tabular-nums")}>
        {labelled && `${lane.correct}/${lane.total} · `}
        {Math.round(ms).toLocaleString()} ms avg
      </span>
    </motion.div>
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
  const leader =
    rows.length > 0 && ranked.length > 1 && score(ranked[0]!) > score(ranked[1]!)
      ? ranked[0]?.name
      : undefined;
  const done = useCountUp(rows.length, 250);

  return (
    <section className="mb-3.5 grid gap-6 rounded-lg border border-rule bg-panel px-5 py-5 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <span className={labelText}>{label}</span>
        <Clock startedAt={startedAt} pace={pace} />
        <span className="font-mono text-sm text-dim tabular-nums">
          <span className="text-ink">{Math.round(done)}</span> / {total} items
        </span>
        <span className="h-1 overflow-hidden rounded-full bg-bar">
          <span
            className="block h-full rounded-full bg-ink/70 transition-[width] duration-300"
            style={{ width: `${total ? (rows.length / total) * 100 : 0}%` }}
          />
        </span>
      </div>
      <div>
        {ranked.map((lane) => (
          <LaneRow key={lane.name} lane={lane} leading={lane.name === leader} labelled={labelled} />
        ))}
      </div>
    </section>
  );
}
