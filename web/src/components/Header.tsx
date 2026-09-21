import { cx, labelText } from "../styles";
import type { Mode } from "../types";

const TABS: [Mode, string][] = [
  ["compare", "Compare"],
  ["generate", "Generate vs readout"],
  ["past", "Past runs"],
];

const LEDE: Record<Mode, string> = {
  compare: "The same questions to several models, side by side.",
  generate: "One model, two ways to ask it the same questions.",
  past: "Batches you ran, saved on this machine.",
};

interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  theme: string;
  onThemeToggle: () => void;
}

export function Header({ mode, onModeChange, theme, onThemeToggle }: HeaderProps) {
  return (
    <>
      <header className="flex items-center gap-3">
        <h1 className="m-0 font-display text-[22px] leading-none font-[650] tracking-[-0.01em] text-ink">
          jev.py
        </h1>
        <p className="m-0 ml-1.5 min-w-0 flex-1 text-sm text-dim max-[860px]:hidden">
          {LEDE[mode]}
        </p>
        <button
          type="button"
          className={cx(labelText, "rounded-full border border-rule bg-transparent px-3 py-1")}
          title="Switch light and dark"
          onClick={onThemeToggle}
        >
          {theme === "dark" ? "Light" : "Dark"}
        </button>
      </header>
      <nav className="mt-[18px] mb-4 flex gap-[22px] border-b border-rule max-[600px]:[scrollbar-width:none] max-[600px]:overflow-x-auto max-[600px]:overflow-y-hidden">
        {TABS.map(([tab, title]) => (
          <button
            key={tab}
            type="button"
            onClick={() => onModeChange(tab)}
            className={cx(
              "flex-none rounded-none border-0 bg-transparent px-0 pt-[9px] pb-2.5 text-sm whitespace-nowrap",
              tab === mode
                ? "text-ink shadow-[inset_0_-2px_0_var(--color-ink)]"
                : "text-dim hover:text-ink-2",
            )}
          >
            {title}
          </button>
        ))}
      </nav>
    </>
  );
}
