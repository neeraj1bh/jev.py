import type { ReactNode } from "react";

import { useElapsed } from "../hooks/useElapsed";
import { cn, inset, shell } from "../styles";
import type { PanelState } from "../types";
import { type IconGlyph, IconTile } from "./Icon";
import { InfoTip } from "./InfoTip";
import type { Place } from "./RaceClocks";

/** A side's tile fills while it runs and turns green when it finished first. */
export const liveTone = (state: PanelState) =>
  state.status === "running" ? "ink" : state.fastest ? "good" : "idle";

export function Clock({
  state,
  className = "mt-3.5 mb-4",
}: {
  state: PanelState;
  className?: string;
}) {
  const ms = useElapsed(state);
  return (
    <div
      className={cn(
        "font-mono text-[40px] leading-none font-[650] tabular-nums transition-colors",
        state.fastest ? "text-good" : "text-ink",
        className,
      )}
    >
      <span>{ms}</span>
      <small className="ml-1 text-[15px] font-normal text-dim">ms</small>
    </div>
  );
}

const ordinal = (n: number) =>
  `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

export function PlaceBadge({
  place,
  className = "-mt-2 mb-3",
}: {
  place?: Place;
  className?: string;
}) {
  return (
    <p className={cn("min-h-5 font-mono text-[13px] text-dim tabular-nums", className)}>
      {place && (
        <>
          <span className={cn("font-semibold", place.place === 1 ? "text-good" : "text-ink")}>
            {ordinal(place.place)}
          </span>
          {place.behind > 0 && ` · +${place.behind.toLocaleString()} ms`}
        </>
      )}
    </p>
  );
}

interface PanelProps {
  title: ReactNode;
  icon?: IconGlyph;
  subtitle: string;
  info?: ReactNode;
  state: PanelState;
  place?: Place;
  children: ReactNode;
}

export function Panel({ title, icon, subtitle, info, state, place, children }: PanelProps) {
  return (
    <section className={cn(shell, "flex min-h-[260px] min-w-0 flex-col")}>
      <h2 className="m-0 px-3.5 pt-2 pb-2.5 text-sm font-semibold text-ink">
        <span className="inline-flex items-center gap-1">
          {icon && <IconTile icon={icon} tone={liveTone(state)} className="mr-1" />}
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
        <small className="mt-0.5 block font-body text-[13px] font-normal text-dim">
          {subtitle}
        </small>
      </h2>
      <div className={cn(inset, "flex flex-1 flex-col px-5 pt-1 pb-[18px]")}>
        <Clock state={state} />
        <PlaceBadge place={place} />
        {children}
        <div className="mt-auto border-0 border-t border-dashed border-rule pt-3 text-[13px] text-dim">
          {state.footer}
        </div>
      </div>
    </section>
  );
}
