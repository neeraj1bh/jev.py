import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { Fragment, useState } from "react";

import { useElapsed } from "../hooks/useElapsed";
import { answerLabel, matchesLabel } from "../scoring";
import { cn, labelText, panelBox, tableHead } from "../styles";
import type { Answer, PanelState } from "../types";
import { CheckMark } from "./CheckMark";
import { Icon } from "./Icon";
import { Skeleton } from "./Skeleton";
import { Tip } from "./Tip";

/** The probability behind the answer shown, or null for a written answer with no probabilities. */
function confidence(answer: Answer) {
  if (answer.type === "noul") return answerLabel(answer) === "yes" ? answer.noul : 1 - answer.noul;
  if (answer.type === "choice") return answer.probabilities[answer.choice] ?? null;
  return null;
}

function ModelHeading({ name, state }: { name: string; state: PanelState }) {
  const written = name.endsWith("· text");
  const ms = useElapsed(state);
  return (
    <th className={cn(tableHead, "min-w-[150px] align-bottom")}>
      <Tip content={name}>
        <span className="line-clamp-2 text-[13px] font-semibold text-ink">{name}</span>
      </Tip>
      <span
        className={cn(
          "font-mono text-xs tabular-nums transition-colors",
          state.fastest ? "text-good" : "text-dim",
        )}
      >
        {state.status === "idle" ? "\u00a0" : `${ms} ms`}
      </span>
      {written && (
        <span className="ml-2 text-xs font-normal text-dim">written, no probabilities</span>
      )}
    </th>
  );
}

function AnswerCell({
  state,
  id,
  truth,
  written,
  open = false,
}: {
  state: PanelState;
  id: string;
  truth?: string;
  /** A written answer has no probabilities to show. */
  written: boolean;
  /** Its options are listed right below, so the bar here would only repeat the first of them. */
  open?: boolean;
}) {
  const cell = cn("border-b border-rule px-2 py-2 align-top", open && "border-b-0");
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
  const probability = written || open ? null : confidence(answer);
  const correct = truth === undefined ? null : matchesLabel(label, truth);
  return (
    <td className={cell}>
      <span className="flex items-start gap-3">
        <Tip content={shown}>
          <span
            className={cn(
              "line-clamp-2 min-w-0 flex-1 font-medium break-words",
              correct === null ? "text-ink" : correct ? "text-good" : "text-warn",
            )}
          >
            {shown} {correct !== null && <CheckMark ok={correct} />}
          </span>
        </Tip>
        {probability !== null && (
          <span className="mt-[3px] ml-auto flex flex-none items-center gap-2">
            <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-bar sm:block">
              <span
                className="block h-full rounded-full bg-ink/70"
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

function OptionBreakdown({ answer, written }: { answer?: Answer; written: boolean }) {
  if (!answer) return <span className="text-dim">–</span>;
  if (written) return null;
  const probabilities =
    answer.type === "noul"
      ? { yes: answer.noul, no: 1 - answer.noul }
      : (answer.probabilities ?? {});
  const ranked = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  const shown = ranked.slice(0, 6);
  const best = answerLabel(answer);
  return (
    <div className="space-y-1 font-mono text-xs">
      {shown.map(([option, probability]) => (
        <div
          key={option}
          className={cn(
            "grid grid-cols-[minmax(0,1fr)_48px_36px] items-center gap-2",
            option === best ? "text-ink" : "text-dim",
          )}
        >
          <Tip content={option}>
            <span className="truncate">{answer.type === "score" ? `level ${option}` : option}</span>
          </Tip>
          <span className="h-1 overflow-hidden rounded-full bg-bar">
            <span
              className={cn(
                "block h-full rounded-full",
                option === best ? "bg-ink/70" : "bg-dim/60",
              )}
              style={{ width: `${probability * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{probability.toFixed(2)}</span>
        </div>
      ))}
      {ranked.length > shown.length && (
        <div className="text-dim">+ {ranked.length - shown.length} more options</div>
      )}
    </div>
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
/** snake_case names wrap after an underscore instead of spilling into the next column. */
const breakable = (name: string) => name.replaceAll("_", "_\u200b");

const rowCell = "border-b border-rule px-2 py-2 align-top";

/** One column per model and one row per question; a row opens to show every option's probability. */
export function CompareTable({ names, panels, questionIds, truth, bare }: CompareTableProps) {
  const [open, setOpen] = useState<string[]>([]);
  const hasResults = panels.some((panel) => panel.status !== "idle");
  const hasAnswers = panels.some((panel) => panel.response);
  const allOpen = questionIds.length > 0 && questionIds.every((id) => open.includes(id));
  const toggle = (id: string) =>
    setOpen((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  const failures = names.flatMap((name, k) => {
    const state = panels[k];
    return state?.status === "done" && !state.response ? [`${name}: ${state.footer}`] : [];
  });

  return (
    <div className={cn(!bare && panelBox, "animate-fade")}>
      {hasAnswers && (
        <div className="flex justify-end pb-1">
          <button
            type="button"
            onClick={() => setOpen(allOpen ? [] : questionIds)}
            className="inline-flex items-center gap-1 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-[13px] text-dim transition-colors hover:text-ink"
          >
            <Icon icon={allOpen ? ChevronsDownUp : ChevronsUpDown} size={14} />
            {allOpen ? "Hide all options" : "Show all options"}
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table
          className="w-full table-fixed border-collapse text-[13px]"
          // On narrow screens the table keeps readable columns and scrolls inside its card.
          style={{ minWidth: 176 + (truth ? 120 : 0) + 150 * names.length }}
        >
          <colgroup>
            <col className="w-44" />
            {truth && <col className="w-[20%]" />}
            {names.map((name) => (
              <col key={name} />
            ))}
          </colgroup>
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
            {questionIds.map((id) => {
              const isOpen = open.includes(id);
              return (
                <Fragment key={id}>
                  <tr className="transition-colors hover:bg-lift [&>td:first-child]:rounded-l-md [&>td:last-child]:rounded-r-md">
                    <td className={cn(rowCell, "text-ink", isOpen && "border-b-0")}>
                      {hasAnswers ? (
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          onClick={() => toggle(id)}
                          className="inline-flex max-w-full items-start gap-1 rounded-sm border-0 bg-transparent p-0 text-left text-ink"
                        >
                          <Icon
                            icon={ChevronRight}
                            size={14}
                            className={cn(
                              "text-dim transition-transform duration-150",
                              isOpen && "rotate-90",
                            )}
                          />
                          <span className="min-w-0 break-words">{breakable(id)}</span>
                        </button>
                      ) : (
                        <span className="break-words">{breakable(id)}</span>
                      )}
                    </td>
                    {truth && (
                      <Tip content={truth[id]}>
                        <td className={cn(rowCell, "text-dim", isOpen && "border-b-0")}>
                          <span className="line-clamp-2 break-words">{truth[id] ?? "–"}</span>
                        </td>
                      </Tip>
                    )}
                    {names.map((name, k) => (
                      <AnswerCell
                        key={name}
                        state={panels[k] ?? idle}
                        id={id}
                        truth={truth?.[id]}
                        written={name.endsWith("· text")}
                        open={isOpen}
                      />
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="animate-fade motion-reduce:animate-none">
                      <td className={rowCell} />
                      {truth && <td className={rowCell} />}
                      {names.map((name, k) => (
                        <td key={name} className={cn(rowCell, "pt-0 pb-3")}>
                          <OptionBreakdown
                            answer={panels[k]?.response?.answers[id]}
                            written={name.endsWith("· text")}
                          />
                        </td>
                      ))}
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={cn(labelText, "mt-3 mb-0", (bare || !hasResults) && "hidden")}>
        Green marks the fastest model{truth ? " and answers that match the label" : ""}. The bar is
        how sure the model was; open a question to see every option.
      </p>
      {failures.map((message) => (
        <p key={message} className="mt-1 mb-0 text-[13px] text-warn">
          {message}
        </p>
      ))}
    </div>
  );
}

/** Many models on one item: a row per model and a column per question, so nothing is squeezed. */
export function ModelRowsTable({
  names,
  panels,
  questionIds,
  truth,
}: Omit<CompareTableProps, "bare">) {
  return (
    <div className="overflow-x-auto">
      <table
        className="w-full border-collapse text-[13px]"
        style={{ minWidth: 300 + 190 * questionIds.length }}
      >
        <thead>
          <tr>
            <th className={cn(tableHead, "sticky left-0 z-[2] align-bottom")}>Model</th>
            <th className={cn(tableHead, "text-right align-bottom")}>Time</th>
            {questionIds.map((id) => (
              <th key={id} className={cn(tableHead, "align-bottom")}>
                <span className="block break-words text-ink">{breakable(id)}</span>
                {truth?.[id] !== undefined && (
                  <span className="block truncate text-xs font-normal">label: {truth[id]}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0">
          {names.map((name, k) => {
            const state = panels[k] ?? idle;
            return (
              <tr key={name} className="transition-colors hover:bg-lift">
                <td
                  className={cn(
                    rowCell,
                    "sticky left-0 z-[1] bg-panel font-semibold whitespace-nowrap text-ink",
                  )}
                >
                  <span className="mr-2.5 inline-block w-5 font-mono text-xs font-normal text-dim">
                    {k + 1}
                  </span>
                  {name}
                </td>
                <td
                  className={cn(
                    rowCell,
                    "text-right font-mono text-xs tabular-nums",
                    state.fastest ? "text-good" : "text-dim",
                  )}
                >
                  {state.ms === undefined ? "–" : `${state.ms.toLocaleString()} ms`}
                </td>
                {questionIds.map((id) => (
                  <AnswerCell
                    key={id}
                    state={state}
                    id={id}
                    truth={truth?.[id]}
                    written={name.endsWith("· text")}
                  />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
