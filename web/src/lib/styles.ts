export const cn = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export const labelText = "text-[13px] text-dim";
// The raised look: a tinted shell holding a white inset, the header living on the shell.
export const shell = "rounded-[22px] bg-lift p-1.5 shadow-(--surface-shadow)";
export const inset = "rounded-2xl bg-panel";
// A shell that holds a LiveLight: its own stacking layer, so the light stays under the content.
export const liveCard = "relative isolate";
export const microLabel = "text-[10.5px] font-medium tracking-[0.08em] text-dim uppercase";
export const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-rule bg-transparent px-3.5 py-2 text-ink transition-colors duration-150 hover:enabled:border-dim";
export const solidButton =
  "inline-flex items-center justify-center gap-1.5 rounded-full border border-ink bg-ink px-5 py-2 font-semibold text-paper transition-[opacity,transform] duration-150 hover:enabled:opacity-[0.88] active:enabled:translate-y-px";
export const chipButton = (active = false) =>
  cn(
    "inline-flex items-center justify-center gap-1.5 rounded-full border px-3 py-1 text-[13.5px] transition-colors duration-150",
    active
      ? "border-ink bg-ink text-paper"
      : "border-rule bg-transparent text-dim hover:enabled:border-dim",
  );
// A sticky cell drops a collapsed border, so the rule under the header is an inset shadow.
export const tableHead =
  "sticky top-0 bg-panel px-2 py-1.5 text-left font-medium text-dim shadow-[inset_0_-1px_0_var(--color-rule)]";
export const tableCell =
  "max-w-[260px] overflow-hidden border-b border-rule px-2 py-[7px] align-top text-ellipsis whitespace-nowrap";
export const monoDim = "font-mono text-xs text-dim";
export const numberInput =
  "w-16 rounded-full border border-rule bg-paper px-2 py-1 text-center font-mono text-[13.5px] text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dim";
/** A place in a ranking: first is filled, the rest are tinted. */
export const rankChip = (rank: number) =>
  cn(
    "grid size-5 place-items-center rounded-md font-mono text-[11px] font-medium tabular-nums",
    rank === 1 ? "bg-ink text-paper" : "bg-lift text-dim",
  );
