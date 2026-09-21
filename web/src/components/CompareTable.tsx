import { useElapsed } from "../hooks/useElapsed";
import { answerLabel, matchesLabel } from "../scoring";
import { cn, labelText, panelBox, tableHead } from "../styles";
import type { Answer, PanelState } from "../types";
import { CheckMark } from "./CheckMark";
import { Skeleton } from "./Skeleton";

/** The probability behind the answer shown, or null for a written answer with no probabilities. */
function confidence(answer: Answer) {
  if (answer.type === "noul") return answerLabel(answer) === "yes" ? answer.noul : 1 - answer.noul;
  if (answer.type === "choice") return answer.probabilities[answer.choice] ?? null;
  return null;
}

function ModelHeading({ name, state }: { name: string; state: PanelState }) {
  const ms = useElapsed(state);
  return (
    <th className={cn(tableHead, "min-w-[150px] align-bottom")}>
      <span className="block text-[13px] font-semibold text-ink">{name}</span>
      <span
        className={cn(
          "font-mono text-xs tabular-nums transition-colors",
          state.fastest ? "text-good" : "text-dim",
        )}
      >
        {state.status === "idle" ? "\u00a0" : `${ms} ms`}
      </span>
    </th>
  );
}

function AnswerCell({ state, id, truth }: { state: PanelState; id: string; truth?: string }) {
  const cell = "border-b border-rule px-2 py-2 align-top";
  if (state.status === "running" && !state.response) {
    return (
      <td className={cell}>
        <span className="flex items-center gap-3">
          <Skeleton className="w-14" />
          <Skeleton className="ml-auto h-1 w-12" />
        </span>
      </td>
    );
  }
  if (state.status === "idle") return <td className={cell} />;
  const answer = state.response?.answers[id];
  if (!answer) {
    const failed = state.status === "done" && !state.response;
    return (
      <td className={cn(cell, failed ? "text-warn" : "text-dim")}>{failed ? "failed" : "–"}</td>
    );
  }
  const label = answerLabel(answer);
  const shown = answer.type === "score" ? answer.score.toFixed(2) : label;
  const probability = confidence(answer);
  const correct = truth === undefined ? null : matchesLabel(label, truth);
  return (
    <td className={cell}>
      <span className="flex items-center gap-3">
        <span
          className={cn(
            "inline-flex min-w-0 items-center gap-1 truncate font-medium",
            correct === null ? "text-ink" : correct ? "text-good" : "text-warn",
          )}
        >
          {shown}
          {correct !== null && <CheckMark ok={correct} />}
        </span>
        {probability !== null && (
          <span className="ml-auto flex flex-none items-center gap-2">
            <span className="h-1 w-12 overflow-hidden rounded-full bg-bar">
              <span
                className="block h-full rounded-full bg-dim"
                style={{ width: `${probability * 100}%` }}
              />
            </span>
            <span className="font-mono text-xs text-dim tabular-nums">
              {probability.toFixed(2)}
            </span>
          </span>
        )}
      </span>
    </td>
  );
}

interface CompareTableProps {
  names: string[];
  panels: PanelState[];
  questionIds: string[];
  truth?: Record<string, string>;
  /** Inside another box, such as the item dialog: no frame or legend of its own. */
  bare?: boolean;
}

const idle: PanelState = { status: "idle", footer: "" };

/** Three or more models: one column each, one row per question, so nothing repeats. */
export function CompareTable({ names, panels, questionIds, truth, bare }: CompareTableProps) {
  const hasResults = panels.some((panel) => panel.status !== "idle");
  const failures = names.flatMap((name, k) => {
    const state = panels[k];
    return state?.status === "done" && !state.response ? [`${name}: ${state.footer}`] : [];
  });
  return (
    <div className={cn(!bare && panelBox, "animate-fade overflow-x-auto")}>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={cn(tableHead, "align-bottom")}>Question</th>
            {truth && <th className={cn(tableHead, "align-bottom")}>Label</th>}
            {names.map((name, k) => (
              <ModelHeading key={name} name={name} state={panels[k] ?? idle} />
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {questionIds.map((id) => (
            <tr
              key={id}
              className="transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md"
            >
              <td className="border-b border-rule px-2 py-2 align-top text-ink">{id}</td>
              {truth && (
                <td className="border-b border-rule px-2 py-2 align-top text-dim">
                  {truth[id] ?? "–"}
                </td>
              )}
              {names.map((name, k) => (
                <AnswerCell key={name} state={panels[k] ?? idle} id={id} truth={truth?.[id]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className={cn(labelText, "mt-3 mb-0", (bare || !hasResults) && "hidden")}>
        Green marks the fastest model{truth ? " and answers that match the label" : ""}. The bar is
        how sure the model was.
      </p>
      {failures.map((message) => (
        <p key={message} className="mt-1 mb-0 text-[13px] text-warn">
          {message}
        </p>
      ))}
    </div>
  );
}
