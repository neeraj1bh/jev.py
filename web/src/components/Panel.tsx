import { type ReactNode, useEffect, useState } from "react";

import { cx } from "../styles";
import type { PanelState } from "../types";

function Clock({ state, compact }: { state: PanelState; compact?: boolean }) {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (state.status !== "running") return;
    let frame = 0;
    const tick = () => {
      setNow(performance.now());
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [state.status]);

  const elapsed = Math.round(now - (state.startedAt ?? now));
  const ms =
    state.status === "running"
      ? Math.max(0, Math.min(elapsed, state.cap ?? Infinity))
      : state.status === "done"
        ? (state.ms ?? 0)
        : 0;

  return (
    <div
      className={cx(
        "font-mono leading-none font-[650] tabular-nums",
        compact ? "mt-2.5 mb-3 text-[32px]" : "mt-3.5 mb-4 text-[40px]",
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
  state: PanelState;
  compact?: boolean;
  children: ReactNode;
}

export function Panel({ title, subtitle, state, compact, children }: PanelProps) {
  return (
    <section
      className={cx(
        "flex min-w-0 flex-col rounded-lg border border-rule bg-panel",
        compact ? "min-h-[300px] px-[18px] py-4" : "min-h-[420px] px-5 py-[18px]",
      )}
    >
      <h2 className="m-0 text-sm font-semibold text-ink">
        {title}
        <small className="mt-0.5 block font-body text-[13px] font-normal tracking-normal text-dim">
          {subtitle}
        </small>
      </h2>
      <Clock state={state} compact={compact} />
      {children}
      <div className={cx("mt-auto pt-3.5 text-dim", compact ? "text-xs" : "text-[13px]")}>
        {state.footer}
      </div>
    </section>
  );
}
