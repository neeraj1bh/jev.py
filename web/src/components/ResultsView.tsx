import { ArrowLeft, Play, Square } from "lucide-react";
import { useState } from "react";

import type { ReplaySpeed } from "../hooks/useBatchReplay";
import { chipButton, cn, labelText } from "../styles";
import type { Row } from "../types";
import { BatchTable } from "./BatchTable";
import { Icon } from "./Icon";
import { Summary } from "./Summary";

type Tab = "summary" | "items";
const SPEEDS: ReplaySpeed[] = [1, 2, 4];

interface ResultsViewProps {
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

/** A batch on its own screen: the summary or the items, with a replay that plays it back as it ran. */
export function ResultsView(props: ResultsViewProps) {
  const [tab, setTab] = useState<Tab>("summary");
  const busy = props.running || props.replaying;

  return (
    <section className="animate-fade motion-reduce:animate-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={props.onBack}
            disabled={props.running}
            className="inline-flex items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 py-1 text-sm text-dim transition-colors hover:text-ink"
          >
            <Icon icon={ArrowLeft} size={14} />
            Setup
          </button>
          <div className="inline-flex rounded-full border border-rule p-0.5">
            {(["summary", "items"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={tab === option}
                onClick={() => setTab(option)}
                className={cn(
                  "rounded-full border-0 px-3 py-[3px] text-[13px] transition-colors",
                  tab === option ? "bg-lift text-ink" : "bg-transparent text-dim hover:text-ink",
                )}
              >
                {option === "summary" ? "Summary" : `Items · ${props.rows.length}`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {props.running ? (
            <button type="button" className={chipButton()} onClick={props.onStopBatch}>
              Stop batch
            </button>
          ) : (
            <>
              <span className={cn(labelText, "hidden sm:inline")}>Replay speed</span>
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
            </>
          )}
        </div>
      </div>

      {tab === "summary" ? (
        <Summary rows={props.rows} columns={props.columns} dataset={props.dataset} />
      ) : (
        <BatchTable
          rows={props.rows}
          columns={props.columns}
          note={props.note}
          file={props.file}
          selected={props.selected}
          follow={props.follow}
          onOpen={busy ? () => undefined : props.onOpenRow}
        />
      )}
    </section>
  );
}
