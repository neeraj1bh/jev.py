import type { ReactNode } from "react";

import { useElapsed } from "../hooks/useElapsed";
import { cn } from "../styles";
import type { PanelState } from "../types";
import { InfoTip } from "./InfoTip";

function Clock({ state }: { state: PanelState }) {
  const ms = useElapsed(state);
  return (
    <div
      className={cn(
        "mt-3.5 mb-4 font-mono text-[40px] leading-none font-[650] tabular-nums transition-colors",
        state.fastest ? "text-good" : "text-ink",
      )}
    >
      <span>{ms}</span>
      <small className="ml-1 text-[15px] font-normal text-dim">ms</small>
    </div>
  );
}

interface PanelProps {
  title: ReactNode;
  subtitle: string;
  info?: ReactNode;
  state: PanelState;
  children: ReactNode;
}

export function Panel({ title, subtitle, info, state, children }: PanelProps) {
  return (
    <section className="flex min-h-[260px] min-w-0 flex-col rounded-lg border border-rule bg-panel px-5 py-[18px]">
      <h2 className="m-0 text-sm font-semibold text-ink">
        <span className="inline-flex items-center gap-1">
          {title}
          {info && <InfoTip>{info}</InfoTip>}
        </span>
        <small className="mt-0.5 block font-body text-[13px] font-normal text-dim">
          {subtitle}
        </small>
      </h2>
      <Clock state={state} />
      {children}
      <div className="mt-auto pt-3.5 text-[13px] text-dim">{state.footer}</div>
    </section>
  );
}
