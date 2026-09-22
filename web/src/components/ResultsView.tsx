import { ArrowLeft, Play, Square } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import type { ReplaySpeed } from "../hooks/useBatchReplay";
import { chipButton, cn, labelText } from "../styles";
import type { Row } from "../types";
import { BatchTable } from "./BatchTable";
import { Icon } from "./Icon";
import { Scoreboard } from "./Scoreboard";
import { Summary } from "./Summary";

const SPEEDS: ReplaySpeed[] = [1, 2, 4];

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
            <div className="inline-flex rounded-full border border-rule p-0.5">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  aria-pressed={props.speed === speed}
                  disabled={props.replaying}
                  onClick={() => props.onSpeedChange(speed)}
                  className={cn(
                    "rounded-full border-0 px-2.5 py-[3px] font-mono text-xs transition-colors",
                    props.speed === speed
                      ? "bg-lift text-ink"
                      : "bg-transparent text-dim hover:text-ink",
                  )}
                >
                  {speed}×
                </button>
              ))}
            </div>
            <button
              type="button"
              className={cn(chipButton(props.replaying), "inline-flex items-center gap-1.5")}
              onClick={props.replaying ? props.onStopReplay : props.onReplay}
            >
              <Icon icon={props.replaying ? Square : Play} size={14} />
              {props.replaying ? "Stop replay" : "Replay batch"}
            </button>
          </div>
        )}
      </div>
      {props.stage ??
        (props.scoreboard ? (
          <Scoreboard rows={props.rows} columns={props.columns} {...props.scoreboard} />
        ) : (
          <Summary rows={props.rows} columns={props.columns} dataset={props.dataset} />
        ))}
      <BatchTable
        rows={props.rows}
        columns={props.columns}
        note={props.note}
        file={props.file}
        selected={props.selected}
        follow={props.follow}
        onOpen={props.running || props.replaying ? () => undefined : props.onOpenRow}
      />
    </section>
  );
}
