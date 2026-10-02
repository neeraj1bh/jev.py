import { ArrowsInLineVertical, ArrowsOutLineVertical, CaretRight } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { answerLabel, matchesLabel } from "../../lib/scoring";
import { chipButton, cn } from "../../lib/styles";
import type { Answer, PanelState } from "../../lib/types";
import { Icon } from "../ui/Icon";
import { Skeleton } from "../ui/Skeleton";
import { Tip } from "../ui/Tip";

/** The probability behind the answer shown, or null for a written answer with no probabilities. */
function confidence(answer: Answer) {
  if (answer.type === "noul") return answerLabel(answer) === "yes" ? answer.noul : 1 - answer.noul;
  if (answer.type === "choice") return answer.probabilities[answer.choice] ?? null;
  return null;
}

/** Opens and closes its content by height, quickly, so a row never jumps open. */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={false}
      animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      className="overflow-hidden"
      aria-hidden={!open}
    >
      {children}
    </motion.div>
  );
}

function AnswerChip({
  answer,
  truth,
  written,
}: {
  answer: Answer;
  truth?: string;
  written: boolean;
}) {
  const label = answerLabel(answer);
  const shown = answer.type === "score" ? answer.score.toFixed(2) : label;
  const correct = truth === undefined ? null : matchesLabel(label, truth);
  const sure = written ? null : confidence(answer);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Tip content={shown}>
        <span
          className={cn(
            "min-w-0 truncate rounded-md px-1.5 py-0.5 text-[12.5px] font-medium",
            correct === null
              ? "bg-panel text-ink ring-1 ring-rule"
              : correct
                ? "bg-good/12 text-good"
                : "bg-warn/12 text-warn",
          )}
        >
          {shown}
        </span>
      </Tip>
      {sure !== null && (
        <span
          className={cn(
            "flex-none font-mono text-[11.5px] tabular-nums",
            sure < 0.6 ? "text-warn" : "text-dim",
          )}
        >
          {sure.toFixed(2)}
        </span>
      )}
    </span>
  );
}

export function Distribution({
  answer,
  truth,
  written,
}: {
  answer?: Answer;
  truth?: string;
  written: boolean;
}) {
  if (!answer) return <span className="text-xs text-dim">No answer</span>;
  if (written) return <span className="text-xs text-dim">Written, no probabilities</span>;
  const probabilities =
    answer.type === "noul"
      ? { yes: answer.noul, no: 1 - answer.noul }
      : (answer.probabilities ?? {});
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, 6);
  const best = answerLabel(answer);
  const right = truth === undefined ? null : matchesLabel(best, truth);
  return (
    <div className="max-w-[340px] space-y-1">
      {shown.map(([option, probability]) => {
        const chosen = option === best;
        const isLabel = truth !== undefined && matchesLabel(option, truth);
        return (
          <div
            key={option}
            className={cn(
              "grid grid-cols-[minmax(0,112px)_minmax(40px,1fr)_36px] items-center gap-2.5 font-mono text-[11.5px]",
              chosen ? "text-ink" : "text-dim",
            )}
          >
            <Tip content={option}>
              <span className={cn("truncate", chosen && "font-semibold")}>
                {answer.type === "score" ? `level ${option}` : option}
                {isLabel && !chosen && <span className="ml-1.5 text-good">label</span>}
              </span>
            </Tip>
            <span className="h-1.5 overflow-hidden rounded-full bg-bar">
              <span
                className={cn(
                  "block h-full rounded-full",
                  !chosen ? "bg-dim/50" : right === false ? "bg-warn" : "bg-good",
                )}
                style={{ width: `${Math.max(probability * 100, probability > 0 ? 2 : 0)}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{probability.toFixed(2)}</span>
          </div>
        );
      })}
      {ranked.length > shown.length && (
        <div className="text-[11.5px] text-dim">+ {ranked.length - shown.length} more options</div>
      )}
    </div>
  );
}

export function AnswerCell({
  state,
  id,
  truth,
  written,
}: {
  state: PanelState;
  id: string;
  truth?: string;
  written: boolean;
}) {
  if (state.status === "running" && !state.response) {
    return (
      <td className={rowCell}>
        <span className="flex items-center gap-3">
          <Skeleton className="w-14" />
          <Skeleton className="h-1 w-8" />
        </span>
      </td>
    );
  }
  if (state.status === "idle") return <td className={rowCell} />;
  const answer = state.response?.answers[id];
  if (!answer) {
    const failed = state.status === "done" && !state.response;
    return (
      <td className={cn(rowCell, failed ? "text-warn" : "text-dim")}>{failed ? "failed" : "–"}</td>
    );
  }
  return (
    <td className={rowCell}>
      <AnswerChip answer={answer} truth={truth} written={written} />
    </td>
  );
}

export const idle: PanelState = { status: "idle", footer: "" };

export const rowCell = "border-0 border-b border-rule px-2 py-2.5 align-middle";

// The row under an open row: no rule until it opens, so a closed one takes no room.
export const detailCell = (open: boolean) =>
  cn("px-2 py-0 align-top", open ? "border-0 border-b border-rule" : "border-0");

export function Caret({ open }: { open: boolean }) {
  return (
    <span className="grid size-5 flex-none place-items-center rounded-md bg-lift text-dim">
      <Icon
        icon={CaretRight}
        size={11}
        className={cn("transition-transform duration-150", open && "rotate-90")}
      />
    </span>
  );
}

export function ShowAllButton({ allOpen, onClick }: { allOpen: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-end pb-1.5">
      <button type="button" onClick={onClick} className={cn(chipButton(), "text-[12.5px]")}>
        <Icon icon={allOpen ? ArrowsInLineVertical : ArrowsOutLineVertical} size={12} />
        {allOpen ? "Hide all options" : "Show all options"}
      </button>
    </div>
  );
}
