import { Lightning } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import { useCountUp } from "../hooks/useCountUp";
import { cn, inset, shell } from "../styles";
import type { Backend, Row } from "../types";
import { Aurora } from "./Aurora";
import { FluxBar } from "./FluxBar";
import { IconTile } from "./Icon";
import { SummaryTable } from "./Summary";

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
    <span className="font-mono text-2xl leading-none font-semibold text-ink tabular-nums">
      {seconds.toFixed(1)}
      <small className="ml-1 text-sm font-normal text-dim">s</small>
    </span>
  );
}

interface ScoreboardProps {
  rows: Row[];
  columns: string[];
  total: number;
  startedAt: number;
  pace: number;
  label: string;
  priceOf: (column: string) => Backend | undefined;
}

/** The live view while a batch runs or replays: a clock, the count, and the summary table
 * filling in as the rows arrive. */
export function Scoreboard({
  rows,
  columns,
  total,
  startedAt,
  pace,
  label,
  priceOf,
}: ScoreboardProps) {
  const done = useCountUp(rows.length, 120);

  return (
    <section className={cn(shell, "mb-3.5")}>
      <div className="relative flex flex-wrap items-center justify-between gap-x-6 gap-y-2 overflow-hidden rounded-2xl px-4 pt-3 pb-3">
        <Aurora className="opacity-30 [mask-image:linear-gradient(to_right,transparent,black)]" />
        <div className="relative flex min-w-0 items-center gap-2">
          <IconTile icon={Lightning} tone="ink" />
          <span className="truncate text-[15px] font-semibold tracking-tight text-ink">
            {label}
          </span>
          <span className="rounded-full bg-bar/70 px-2.5 py-0.5 font-mono text-[11px] font-medium text-dim tabular-nums">
            {columns.length} model{columns.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="relative flex items-center gap-4">
          <span className="font-mono text-sm text-dim tabular-nums">
            <span className="text-ink">{Math.round(done).toLocaleString()}</span> /{" "}
            {total.toLocaleString()} items
          </span>
          <Clock startedAt={startedAt} pace={pace} />
          <span className="relative flex size-2">
            <span className="absolute inset-0 animate-ping rounded-full bg-good opacity-70 motion-reduce:animate-none" />
            <span className="relative size-2 rounded-full bg-good" />
          </span>
        </div>
      </div>
      <div className={inset}>
        <div className="px-4 pt-3 pb-2">
          <FluxBar share={total ? rows.length / total : 0} label="Items done" className="h-2" />
          <div className="mt-1 overflow-x-auto">
            <SummaryTable rows={rows} columns={columns} priceOf={priceOf} live />
          </div>
        </div>
      </div>
    </section>
  );
}
