import type { PanelState } from "../types";
import { Clock, PlaceBadge } from "./Panel";
import { Tip } from "./Tip";

export interface Place {
  place: number;
  behind: number;
}

/** Where each finished side came in, 1st first, and how far behind the winner; unfinished sides get none. */
export function finishOrder(panels: PanelState[]): (Place | undefined)[] {
  const done = panels.filter(
    (panel) => panel.status === "done" && (panel.response !== undefined || !!panel.text),
  );
  if (panels.length < 2 || done.length === 0) return panels.map(() => undefined);
  const best = Math.min(...done.map((panel) => panel.ms ?? 0));
  return panels.map((panel) =>
    done.includes(panel)
      ? {
          place: 1 + done.filter((other) => (other.ms ?? 0) < (panel.ms ?? 0)).length,
          behind: (panel.ms ?? 0) - best,
        }
      : undefined,
  );
}

/** A compare replayed on one item: a big clock per model, stopping in finishing order. */
export function RaceClocks({ names, panels }: { names: string[]; panels: PanelState[] }) {
  const places = finishOrder(panels);
  return (
    <div className="mb-3.5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3.5">
      {panels.map((panel, k) => (
        <section
          key={names[k]}
          className="min-w-0 rounded-lg border border-rule bg-panel px-5 py-4"
        >
          <Tip content={names[k]}>
            <h2 className="m-0 truncate text-sm font-semibold text-ink">{names[k]}</h2>
          </Tip>
          <Clock state={panel} />
          <PlaceBadge place={places[k]} />
        </section>
      ))}
    </div>
  );
}
