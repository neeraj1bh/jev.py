import { TimerIcon } from "@phosphor-icons/react";
import { cn, inset, liveCard, shell } from "../../lib/styles";
import type { PanelState } from "../../lib/types";
import { LiveLight } from "../ui/Aurora";
import { IconTile } from "../ui/Icon";
import { Tip } from "../ui/Tip";
import { Clock, liveTone, PlaceBadge } from "./Panel";

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
          className={cn(shell, panel.status === "running" && liveCard, "min-w-0")}
        >
          {panel.status === "running" && <LiveLight />}
          <Tip content={names[k]}>
            <h2 className="m-0 flex items-center gap-2 px-2 pt-1 pb-2 text-sm font-semibold text-ink">
              <IconTile icon={TimerIcon} tone={liveTone(panel)} />
              <span className="truncate">{names[k]}</span>
            </h2>
          </Tip>
          <div className={cn(inset, "flex items-baseline justify-between gap-3 px-5 py-3.5")}>
            <Clock state={panel} className="text-[34px]" />
            <PlaceBadge place={places[k]} className="m-0" />
          </div>
        </section>
      ))}
    </div>
  );
}
