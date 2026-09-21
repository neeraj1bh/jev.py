import type { ThemePreference } from "../hooks/useTheme";
import { cx } from "../styles";
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

const THEME_OPTIONS: [ThemePreference, string][] = [
  ["light", "Light"],
  ["dark", "Dark"],
  ["system", "Device"],
];

interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
}

export function Header({ mode, onModeChange, preference, onPreferenceChange }: HeaderProps) {
  return (
    <>
      <header className="flex items-center gap-3">
        <h1 className="m-0 font-display text-[22px] leading-none font-[650] tracking-[-0.01em] text-ink">
          jev.py
        </h1>
        <p className="m-0 ml-1.5 min-w-0 flex-1 text-sm text-dim max-[860px]:hidden">
          {LEDE[mode]}
        </p>
        <div className="inline-flex rounded-full border border-rule p-0.5" title="Theme">
          {THEME_OPTIONS.map(([option, name]) => (
            <button
              key={option}
              type="button"
              aria-pressed={preference === option}
              onClick={() => onPreferenceChange(option)}
              className={cx(
                "rounded-full border-0 px-2.5 py-0.5 text-[12.5px] transition-colors",
                preference === option
                  ? "bg-code text-ink"
                  : "bg-transparent text-dim hover:text-ink",
              )}
            >
              {name}
            </button>
          ))}
        </div>
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
