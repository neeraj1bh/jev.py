import { useEffect, useState } from "react";

import { answerLabels } from "../scoring";
import { labelText } from "../styles";
import type { PanelState, Row } from "../types";
import { GenerateView } from "./ResultPanels";

interface GenerateReplayProps {
  rows: Row[];
  startedAt: number;
  pace: number;
  onePass: boolean;
}

const writtenText = (row: Row) =>
  JSON.stringify(answerLabels(row.sides[0]?.response.answers ?? {}), null, 2);

/** One side of the item being replayed, `elapsed` ms after the item started. */
function sidePanel(row: Row, k: number, elapsed: number, now: number): PanelState {
  const side = row.sides[k];
  const ms = side?.ms ?? 0;
  const text = k === 0 ? writtenText(row) : undefined;
  if (elapsed >= ms)
    return {
      status: "done",
      ms,
      response: side?.response,
      text,
      footer: k === 0 ? "valid JSON" : "every option scored",
      fastest: ms <= (row.sides[1 - k]?.ms ?? Number.POSITIVE_INFINITY),
    };
  return {
    status: "running",
    startedAt: now - elapsed,
    text: text?.slice(0, Math.floor((text.length * elapsed) / ms)),
    footer: k === 0 ? "Streaming…" : "Scoring every option…",
  };
}

/** A generate-vs-readout batch played back as it ran: one item at a time, both ways at once. */
export function GenerateReplay({ rows, startedAt, pace, onePass }: GenerateReplayProps) {
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

  const clock = (now - startedAt) * pace;
  let start = 0;
  let index = 0;
  for (; index < rows.length - 1; index++) {
    const length = Math.max(0, ...(rows[index]?.sides.map((side) => side.ms) ?? []));
    if (start + length > clock) break;
    start += length;
  }
  const row = rows[index];
  if (!row) return null;
  const elapsed = clock - start;

  return (
    <div className="mb-3.5">
      <p className={`${labelText} mb-2 font-mono tabular-nums`}>
        Replaying item {index + 1} of {rows.length} at {Math.round(pace)}×
      </p>
      <GenerateView
        panels={[sidePanel(row, 0, elapsed, now), sidePanel(row, 1, elapsed, now)]}
        savedNames={null}
        writtenAsAnswers={false}
        onePass={onePass}
        truth={row.item.truth}
      />
    </div>
  );
}
