import { ArrowsInLineVertical, ArrowsOutLineVertical, CaretRight } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Fragment, type ReactNode, useState } from "react";

import { useElapsed } from "../../hooks/useElapsed";
import { answerLabel, matchesLabel } from "../../lib/scoring";
import {
  chipButton,
  cn,
  inset,
  labelText,
  liveCard,
  rankChip,
  shell,
  tableHead,
} from "../../lib/styles";
import type { Answer, PanelState, Question } from "../../lib/types";
import { LiveLight } from "../ui/Aurora";
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

/** The answer as a chip, green when it matches the label and orange when it does not. */
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

/** Every option with its probability, the chosen one first and coloured; the rest fade. */
function Distribution({
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
        {state.status === "idle" ? " " : `${ms} ms`}
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

interface CompareTableProps {
  names: string[];
  panels: PanelState[];
  questionIds: string[];
  /** The questions themselves, so the table shows what will be asked before anything runs. */
  asked?: Record<string, Question>;
  truth?: Record<string, string>;
  /** Inside another box, such as the item dialog: no frame or legend of its own. */
  bare?: boolean;
}

const idle: PanelState = { status: "idle", footer: "" };

function optionsText(question: Question) {
  if (question.type === "noul") return "yes / no";
  const options = Array.isArray(question.criteria)
    ? question.criteria
    : Object.keys(question.criteria ?? {});
  if (question.type === "score") return `${options.length} levels`;
  const shown = options.slice(0, 4).join(" · ");
  return options.length > 4 ? `${shown} · +${options.length - 4}` : shown;
}

/** What a question asks and what it can answer, under its name. */
function QuestionHint({ question }: { question: Question }) {
  return (
    <span className="mt-0.5 block text-xs text-dim">
      {question.instructions && <span className="block">{question.instructions}</span>}
      <span className="block font-mono">{optionsText(question)}</span>
    </span>
  );
}
/** snake_case names wrap after an underscore instead of spilling into the next column. */
const breakable = (name: string) => name.replaceAll("_", "_​");

const rowCell = "border-0 border-b border-rule px-2 py-2.5 align-middle";
// The row under an open row: no rule until it opens, so a closed one takes no room.
const detailCell = (open: boolean) =>
  cn("px-2 py-0 align-top", open ? "border-0 border-b border-rule" : "border-0");

/** The caret that opens a row, on a small tile. */
function Caret({ open }: { open: boolean }) {
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
                            <span className="min-w-0 break-words">{breakable(id)}</span>
                          </button>
                        ) : (
                          <span className="font-medium break-words">{breakable(id)}</span>
                        )}
                        {asked?.[id] && <QuestionHint question={asked[id]} />}
                      </td>
                      {truth && (
                        <Tip content={truth[id]}>
                          <td className={cn(rowCell, "text-dim")}>
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

/** Many models on one item: a row per model and a column per question; a row opens to show
 * every option that model weighed. */
/** Opens or closes every row's options at once. */
function ShowAllButton({ allOpen, onClick }: { allOpen: boolean; onClick: () => void }) {
  return (
    <div className="flex justify-end pb-1.5">
      <button type="button" onClick={onClick} className={cn(chipButton(), "text-[12.5px]")}>
        <Icon icon={allOpen ? ArrowsInLineVertical : ArrowsOutLineVertical} size={12} />
        {allOpen ? "Hide all options" : "Show all options"}
      </button>
    </div>
  );
}

export function ModelRowsTable({
  names,
  panels,
  questionIds,
  truth,
}: Omit<CompareTableProps, "bare">) {
  const [open, setOpen] = useState<string[]>([]);
  const toggle = (name: string) =>
    setOpen((current) =>
      current.includes(name) ? current.filter((x) => x !== name) : [...current, name],
    );
  const slowest = Math.max(1, ...panels.map((panel) => panel.ms ?? 0));
  const span = 2 + questionIds.length;
  const allOpen = names.length > 0 && names.every((name) => open.includes(name));
  return (
    <div>
      {panels.some((panel) => panel.response) && (
        <ShowAllButton allOpen={allOpen} onClick={() => setOpen(allOpen ? [] : names)} />
      )}
      <div className="overflow-x-auto">
        <table
          className="w-full border-collapse text-[13px]"
          style={{ minWidth: 360 + 170 * questionIds.length }}
        >
          <thead>
            <tr>
              <th className={cn(tableHead, "sticky left-0 z-[2] w-px align-bottom")}>Model</th>
              <th className={cn(tableHead, "w-px align-bottom")}>Time</th>
              {questionIds.map((id) => (
                <th key={id} className={cn(tableHead, "align-bottom")}>
                  <span className="block break-words text-ink">{breakable(id)}</span>
                  {truth?.[id] !== undefined && (
                    <span className="mt-0.5 flex items-center gap-1.5 text-[11px] font-normal">
                      <span className="tracking-[0.08em] uppercase">label</span>
                      <span className="truncate font-medium text-good">{truth[id]}</span>
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((name, k) => {
              const state = panels[k] ?? idle;
              const isOpen = open.includes(name);
              const written = name.endsWith("· text");
              return (
                <Fragment key={name}>
                  <tr
                    onClick={() => toggle(name)}
                    className={cn(
                      "group cursor-pointer transition-colors hover:bg-lift [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg",
                      isOpen && "[&>td]:border-b-transparent",
                    )}
                  >
                    <td
                      className={cn(
                        rowCell,
                        "sticky left-0 z-[1] bg-panel transition-colors group-hover:bg-lift",
                      )}
                    >
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggle(name);
                        }}
                        className="flex items-center gap-2.5 border-0 bg-transparent p-0 text-left font-semibold whitespace-nowrap text-ink"
                      >
                        <span className={rankChip(k + 1)}>{k + 1}</span>
                        {name}
                        <Caret open={isOpen} />
                      </button>
                    </td>
                    <td className={rowCell}>
                      {state.ms === undefined ? (
                        <span className="text-dim">–</span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-20 flex-none overflow-hidden rounded-full bg-bar">
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                state.fastest ? "bg-good" : "bg-dim/60",
                              )}
                              style={{ width: `${(state.ms / slowest) * 100}%` }}
                            />
                          </span>
                          <span
                            className={cn(
                              "font-mono text-xs whitespace-nowrap tabular-nums",
                              state.fastest ? "text-good" : "text-dim",
                            )}
                          >
                            {state.ms.toLocaleString()} ms
                          </span>
                        </span>
                      )}
                    </td>
                    {questionIds.map((id) => (
                      <AnswerCell
                        key={id}
                        state={state}
                        id={id}
                        truth={truth?.[id]}
                        written={written}
                      />
                    ))}
                  </tr>
                  <tr>
                    <td colSpan={span} className={detailCell(isOpen)}>
                      <Reveal open={isOpen}>
                        <div
                          className="grid gap-x-6 gap-y-3 pt-1 pb-3.5 pl-8"
                          style={{
                            gridTemplateColumns: `repeat(${Math.min(questionIds.length, 4)}, minmax(0, 1fr))`,
                          }}
                        >
                          {questionIds.map((id) => (
                            <div key={id} className="min-w-0">
                              <div className="mb-1.5 text-[10.5px] font-medium tracking-[0.08em] text-dim uppercase">
                                {breakable(id)}
                              </div>
                              <Distribution
                                answer={state.response?.answers[id]}
                                truth={truth?.[id]}
                                written={written}
                              />
                            </div>
                          ))}
                        </div>
                      </Reveal>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
