import { useEffect, useState } from "react";

import { answerLabel, matchesLabel } from "../scoring";
import { cx } from "../styles";
import type { Answer, Response } from "../types";
import { CheckMark } from "./CheckMark";

function ProbabilityBar({ percent, top }: { percent: number; top: boolean }) {
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span className="h-[7px] overflow-hidden rounded bg-bar">
      <i
        className={cx(
          "block h-full transition-[width] duration-[450ms] ease-(--ease-out) motion-reduce:transition-none",
          top ? "bg-good" : "bg-dim",
        )}
        style={{ width: grown ? `${percent}%` : 0 }}
      />
    </span>
  );
}

interface AnswerRowProps {
  id: string;
  answer: Answer;
  truth?: string;
  collapsible: boolean;
  compact?: boolean;
  toggleable?: boolean;
}

function AnswerRow({ id, answer, truth, collapsible, compact, toggleable }: AnswerRowProps) {
  const [collapsed, setCollapsed] = useState(collapsible);
  const probabilities =
    answer.type === "noul"
      ? { yes: answer.noul, no: +(1 - answer.noul).toFixed(4) }
      : (answer.probabilities ?? {});
  const best = answerLabel(answer);
  const headline =
    answer.type === "score"
      ? `score ${answer.score.toFixed(2)}`
      : answer.type === "noul"
        ? `${best} · ${answer.noul.toFixed(2)}`
        : answer.choice;
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const shown = ranked.length > 8 ? ranked.slice(0, 6) : Object.entries(probabilities);
  const correct = truth !== undefined && matchesLabel(best, truth);
  const canToggle = toggleable && collapsible;
  const Heading = canToggle ? "button" : "div";

  return (
    <div
      className={cx(
        "grid gap-3.5 border-t border-rule max-[860px]:grid-cols-1 max-[860px]:gap-1.5",
        collapsed
          ? "grid-cols-1 py-[7px]"
          : cx("py-[11px]", compact ? "grid-cols-1 gap-1.5" : "grid-cols-[150px_minmax(0,1fr)]"),
      )}
    >
      <Heading
        {...(canToggle && {
          type: "button",
          "aria-expanded": !collapsed,
          onClick: () => setCollapsed(!collapsed),
        })}
        className={cx(
          "text-[13px] [overflow-wrap:anywhere] text-dim",
          collapsed && "flex items-baseline gap-2.5",
          canToggle && "w-full cursor-pointer border-0 bg-transparent p-0 text-left",
        )}
      >
        {id}
        <b
          className={cx(
            "font-mono text-ink",
            collapsed ? "line-clamp-1 text-[13px]" : "line-clamp-2 text-sm",
          )}
          title={headline}
        >
          {headline}
        </b>
        {truth !== undefined && (
          <span
            className={cx(
              "block overflow-hidden text-[13px]",
              correct ? "text-good" : "text-warn",
              collapsed ? "ml-auto max-w-[45%] flex-none" : "mt-[3px]",
            )}
            title={truth}
          >
            label: {truth}&nbsp;
            <CheckMark ok={correct} />
          </span>
        )}
      </Heading>
      {!collapsed && (
        <div>
          {shown.map(([option, probability]) => (
            <div
              key={option}
              className={cx(
                "grid items-center gap-2.5 font-mono text-xs leading-[1.7]",
                compact
                  ? "grid-cols-[minmax(0,96px)_minmax(24px,1fr)_36px]"
                  : "grid-cols-[110px_minmax(40px,260px)_44px]",
                option === best ? "font-semibold text-ink" : "text-dim",
              )}
            >
              <span className="truncate" title={option}>
                {answer.type === "score" ? `level ${option}` : option}
              </span>
              <ProbabilityBar percent={probability * 100} top={option === best} />
              <span className="text-right tabular-nums">{probability.toFixed(2)}</span>
            </div>
          ))}
          {shown.length < ranked.length && (
            <div className="mt-1 text-[13px] text-dim">
              + {ranked.length - shown.length} more options
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface AnswersProps {
  response: Response;
  truth?: Record<string, string>;
  compact?: boolean;
  toggleable?: boolean;
}

export function Answers({ response, truth, compact, toggleable }: AnswersProps) {
  const entries = Object.entries(response.answers);
  const collapsible = entries.length > 4;
  return entries.map(([id, answer]) => (
    <AnswerRow
      key={id}
      id={id}
      answer={answer}
      truth={truth?.[id]}
      collapsible={collapsible}
      compact={compact}
      toggleable={toggleable}
    />
  ));
}
