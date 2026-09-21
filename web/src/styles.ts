export const cx = (...classes: (string | false | null | undefined)[]) =>
  classes.filter(Boolean).join(" ");

export const labelText = "text-[13px] text-dim";
export const panelBox = "rounded-lg border border-rule bg-panel px-5 py-4";
export const ghostButton =
  "rounded-md border border-rule bg-transparent px-3.5 py-2 text-ink hover:enabled:border-dim";
export const solidButton =
  "rounded-md border border-ink bg-ink px-5 py-2 font-semibold text-paper hover:enabled:opacity-[0.88] active:enabled:translate-y-px";
export const chipButton = (active = false) =>
  cx(
    "rounded-full border px-3 py-1 text-[13.5px]",
    active
      ? "border-ink bg-ink text-paper"
      : "border-rule bg-transparent text-dim hover:enabled:border-dim",
  );
export const tableHead =
  "sticky top-0 border-b border-rule bg-panel px-2 py-1.5 text-left font-medium text-dim";
export const tableCell =
  "max-w-[260px] overflow-hidden border-b border-rule px-2 py-[7px] align-top text-ellipsis whitespace-nowrap";
export const monoDim = "font-mono text-xs text-dim";
