import { ArrowLeft, Play, Stop } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef } from "react";

import { FIT, FIT_MS, type ReplaySpeed } from "../hooks/useBatchReplay";
import { rankColumns } from "../scoring";
import { chipButton, cn, labelText } from "../styles";
import type { Backend, Row } from "../types";
import { BatchTable } from "./BatchTable";
import { Icon } from "./Icon";
import { Scoreboard } from "./Scoreboard";
import { SegmentPill, segmentTrack } from "./Segment";
import { Summary } from "./Summary";
import { Tip } from "./Tip";

const SPEEDS: ReplaySpeed[] = [1, 4, 10, 50, 100, FIT];

export interface ScoreboardState {
  startedAt: number;
  total: number;
  pace: number;
  label: string;
}

interface ResultsViewProps {
  /** Set while the batch runs or replays; the racing scoreboard then stands in for the summary. */
  scoreboard: ScoreboardState | null;
  /** Generate vs readout shows its two panels instead, live or replayed, as a single run does. */
  stage?: ReactNode;
  dataset: string;
  /** The model behind a column, for its price; none for a column no model list names. */
  priceOf: (column: string) => Backend | undefined;
  rows: Row[];
  columns: string[];
  note: string;
  file: { text: string; path: string };
  selected: number | null;
  follow: boolean;
  running: boolean;
  replaying: boolean;
  speed: ReplaySpeed;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onReplay: () => void;
  onStopReplay: () => void;
  onStopBatch: () => void;
  onOpenRow: (index: number) => void;
  onBack: () => void;
}

/** A batch on its own screen: the summary and the items, with a replay that plays it back as it ran. */
export function ResultsView(props: ResultsViewProps) {
  // A finished batch reads best first; while rows still arrive the columns keep their place.
  const settled = !props.scoreboard && !props.stage;
  const ranked = useMemo(() => {
    if (!settled) return { rows: props.rows, columns: props.columns };
    const order = rankColumns(props.rows, props.columns.length);
    return {
      columns: order.map((k) => props.columns[k] ?? ""),
      rows: props.rows.map((row) => ({
        ...row,
        sides: order.flatMap((k) => (row.sides[k] ? [row.sides[k]] : [])),
      })),
    };
  }, [settled, props.rows, props.columns]);
  const top = useRef<HTMLElement>(null);

  useEffect(() => {
    if (props.replaying) top.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [props.replaying]);

  return (
    <section ref={top} className="scroll-mt-4 animate-fade motion-reduce:animate-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={props.onBack}
          disabled={props.running}
          className="inline-flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-sm text-dim transition-colors hover:text-ink"
        >
          <Icon icon={ArrowLeft} size={14} />
          Back to setup
        </button>
        {props.running ? (
          <button type="button" className={chipButton()} onClick={props.onStopBatch}>
            Stop batch
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className={cn(labelText, "hidden sm:inline")}>Speed</span>
            <div className={segmentTrack}>
              {SPEEDS.map((speed) => (
                <Tip
                  key={speed}
                  content={
                    speed === FIT
                      ? `Picks the speed that fits the whole replay into ${FIT_MS / 1000} seconds`
                      : undefined
                  }
                >
                  <button
                    type="button"
                    aria-pressed={props.speed === speed}
                    disabled={props.replaying}
                    onClick={() => props.onSpeedChange(speed)}
                    className={cn(
                      "relative rounded-full border-0 bg-transparent px-2.5 py-[3px] font-mono text-xs whitespace-nowrap transition-colors",
                      props.speed === speed ? "text-ink" : "text-dim hover:text-ink",
                    )}
                  >
                    {props.speed === speed && <SegmentPill group="speed" />}
                    <span className="relative">
                      {speed === FIT ? `${FIT_MS / 1000} s` : `${speed}×`}
                    </span>
                  </button>
                </Tip>
              ))}
            </div>
            <button
              type="button"
              className={cn(chipButton(props.replaying), "inline-flex items-center gap-1.5")}
              onClick={props.replaying ? props.onStopReplay : props.onReplay}
            >
              <Icon icon={props.replaying ? Stop : Play} size={14} />
              {props.replaying ? "Stop replay" : "Replay batch"}
            </button>
          </div>
        )}
      </div>
      {props.stage ??
        (props.scoreboard ? (
          <Scoreboard
            rows={props.rows}
            columns={props.columns}
            priceOf={props.priceOf}
            {...props.scoreboard}
          />
        ) : (
          <Summary
            rows={ranked.rows}
            columns={ranked.columns}
            dataset={props.dataset}
            priceOf={props.priceOf}
          />
        ))}
      <BatchTable
        rows={ranked.rows}
        columns={ranked.columns}
        note={props.note}
        file={props.file}
        selected={props.selected}
        follow={props.follow}
        live={props.running || props.replaying}
        onOpen={props.running || props.replaying ? () => undefined : props.onOpenRow}
      />
    </section>
  );
}
