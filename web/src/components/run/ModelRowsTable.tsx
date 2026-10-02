import { Fragment, useState } from "react";

import { breakable, cn, rankChip, tableHead } from "../../lib/styles";
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
import type { CompareTableProps } from "./CompareTable";

/** Many models on one item: a row per model and a column per question; a row opens to show
 * every option that model weighed. */
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
