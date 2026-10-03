import { Fragment, useState } from "react";

import { useElapsed } from "../../hooks/useElapsed";
import { breakable, cn, inset, labelText, liveCard, shell, tableHead } from "../../lib/styles";
import type { PanelState, Question } from "../../lib/types";
import { LiveLight } from "../ui/Aurora";
import { Tip } from "../ui/Tip";
import {
  AnswerCell,
  Caret,
  Distribution,
  detailCell,
  idle,
  Reveal,
  rowCell,
  ShowAllButton,
} from "./AnswerCells";

function ModelHeading({ name, state }: { name: string; state: PanelState }) {
  const written = name.endsWith("· text");
  const ms = useElapsed(state);
  return (
    <th className={cn(tableHead, "min-w-37.5 align-bottom")}>
      <Tip content={name}>
        <span className="line-clamp-2 text-[13px] font-semibold text-ink">{name}</span>
      </Tip>
      <span
        className={cn(
          "font-mono text-xs tabular-nums transition-colors",
          state.fastest ? "text-good" : "text-dim",
        )}
      >
        {state.status === "idle" ? " " : `${ms} ms`}
      </span>
      {written && (
        <span className="ml-2 text-xs font-normal text-dim">written, no probabilities</span>
      )}
    </th>
  );
}

export interface CompareTableProps {
  names: string[];
  panels: PanelState[];
  questionIds: string[];
  /** The questions themselves, so the table shows what will be asked before anything runs. */
  asked?: Record<string, Question>;
  truth?: Record<string, string>;
  /** Inside another box, such as the item dialog: no frame or legend of its own. */
  bare?: boolean;
}

function optionsText(question: Question) {
  if (question.type === "noul") return "yes / no";
  const options = Array.isArray(question.criteria)
    ? question.criteria
    : Object.keys(question.criteria ?? {});
  if (question.type === "score") return `${options.length} levels`;
  const shown = options.slice(0, 4).join(" · ");
  return options.length > 4 ? `${shown} · +${options.length - 4}` : shown;
}

function QuestionHint({ question }: { question: Question }) {
  return (
    <span className="mt-0.5 block text-xs text-dim">
      {question.instructions && <span className="block">{question.instructions}</span>}
      <span className="block font-mono">{optionsText(question)}</span>
    </span>
  );
}

/** One column per model and one row per question; a row opens to show every option's probability. */
export function CompareTable({
  names,
  panels,
  questionIds,
  asked,
  truth,
  bare,
}: CompareTableProps) {
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

  const live = !bare && panels.some((panel) => panel.status === "running");

  return (
    <div className={cn(!bare && shell, live && liveCard, "animate-fade")}>
      {live && <LiveLight />}
      <div className={cn(!bare && inset, !bare && "px-5 py-4")}>
        {hasAnswers && (
          <ShowAllButton allOpen={allOpen} onClick={() => setOpen(allOpen ? [] : questionIds)} />
        )}
        <div className="overflow-x-auto">
          <table
            className="w-full table-fixed border-collapse text-[13px]"
            // On narrow screens the table keeps readable columns and scrolls inside its card.
            style={{ minWidth: (asked ? 288 : 176) + (truth ? 120 : 0) + 150 * names.length }}
          >
            <colgroup>
              <col className={asked ? "w-72" : "w-44"} />
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
            <tbody>
              {questionIds.map((id) => {
                const isOpen = open.includes(id);
                return (
                  <Fragment key={id}>
                    <tr
                      className={cn(
                        "transition-colors [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg",
                        hasAnswers && "cursor-pointer hover:bg-lift",
                        isOpen && "[&>td]:border-b-transparent",
                      )}
                      onClick={hasAnswers ? () => toggle(id) : undefined}
                    >
                      <td className={cn(rowCell, "text-ink")}>
                        {hasAnswers ? (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggle(id);
                            }}
                            className="inline-flex max-w-full items-center gap-2 rounded-sm border-0 bg-transparent p-0 text-left font-medium text-ink"
                          >
                            <Caret open={isOpen} />
                            <span className="min-w-0 wrap-break-word">{breakable(id)}</span>
                          </button>
                        ) : (
                          <span className="font-medium wrap-break-word">{breakable(id)}</span>
                        )}
                        {asked?.[id] && <QuestionHint question={asked[id]} />}
                      </td>
                      {truth && (
                        <Tip content={truth[id]}>
                          <td className={cn(rowCell, "text-dim")}>
                            <span className="line-clamp-2 wrap-break-word">{truth[id] ?? "–"}</span>
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
                        />
                      ))}
                    </tr>
                    {hasAnswers && (
                      <tr>
                        <td className={detailCell(isOpen)} />
                        {truth && <td className={detailCell(isOpen)} />}
                        {names.map((name, k) => (
                          <td key={name} className={detailCell(isOpen)}>
                            <Reveal open={isOpen}>
                              <div className="pt-1 pb-3">
                                <Distribution
                                  answer={panels[k]?.response?.answers[id]}
                                  truth={truth?.[id]}
                                  written={name.endsWith("· text")}
                                />
                              </div>
                            </Reveal>
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
          Green marks the fastest model{truth ? " and answers that match the label" : ""}; the
          number is how sure the model was. Open a question to see every option.
        </p>
        {failures.map((message) => (
          <p key={message} className="mt-1 mb-0 text-[13px] text-warn">
            {message}
          </p>
        ))}
      </div>
    </div>
  );
}
