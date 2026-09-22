import {
  Columns3,
  History,
  KeyRound,
  type LucideIcon,
  Monitor,
  Moon,
  Split,
  Square,
  Sun,
  Trophy,
} from "lucide-react";
import { motion } from "motion/react";

import type { ThemePreference } from "../hooks/useTheme";
import { cn } from "../styles";
import type { Mode } from "../types";
import { Icon } from "./Icon";
import { Tip } from "./Tip";

const TABS: { mode: Mode; name: string; icon: LucideIcon }[] = [
  { mode: "compare", name: "Compare", icon: Columns3 },
  { mode: "generate", name: "Generate vs readout", icon: Split },
  { mode: "benchmark", name: "Benchmark", icon: Trophy },
  { mode: "past", name: "Past runs", icon: History },
];

const THEMES: { preference: ThemePreference; name: string; icon: LucideIcon }[] = [
  { preference: "light", name: "Light", icon: Sun },
  { preference: "dark", name: "Dark", icon: Moon },
  { preference: "system", name: "Device", icon: Monitor },
];

const LEDE: Record<Mode, string> = {
  compare: "The same questions to several models, side by side.",
  generate: "One model, two ways to ask it the same questions.",
  benchmark: "Many models on one set, and how they rank.",
  past: "Batches you ran, saved on this machine.",
};

interface HeaderProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  preference: ThemePreference;
  onPreferenceChange: (preference: ThemePreference) => void;
  onOpenKeys: () => void;
  /** The GGUF models llama.cpp is running now; the button opens the list. */
  running: { labels: string[]; onOpen: () => void };
}

export function Header({
  mode,
  onModeChange,
  preference,
  onPreferenceChange,
  onOpenKeys,
  running,
}: HeaderProps) {
  return (
    <>
      <header className="flex items-center gap-3">
        <h1 className="m-0 font-display text-[22px] leading-none font-[650] tracking-[-0.01em] text-ink">
          jev.py
        </h1>
        <p className="m-0 ml-1.5 min-w-0 flex-1 text-sm text-dim max-[860px]:hidden">
          {LEDE[mode]}
        </p>
        {running.labels.length > 0 && (
          <button
            type="button"
            title={`Running: ${running.labels.join(", ")}`}
            onClick={running.onOpen}
            className="flex max-w-[220px] shrink-0 items-center gap-1.5 rounded-full border border-rule bg-transparent py-1 pr-2 pl-2.5 text-[13px] whitespace-nowrap text-dim transition-colors hover:border-dim hover:text-ink"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-good" />
            <span className="min-w-0 truncate">
              {running.labels.length === 1
                ? running.labels[0]
                : `${running.labels.length} models running`}
            </span>
            <Icon icon={Square} size={14} />
          </button>
        )}
        <Tip content="Keys and tokens">
          <button
            type="button"
            aria-label="Keys and tokens"
            onClick={onOpenKeys}
            className="grid size-8 place-items-center rounded-full border border-rule bg-transparent text-dim transition-colors hover:border-dim hover:text-ink"
          >
            <Icon icon={KeyRound} size={14} />
          </button>
        </Tip>
        <div className="inline-flex rounded-full border border-rule p-0.5">
          {THEMES.map((theme) => (
            <Tip key={theme.preference} content={theme.name}>
              <button
                type="button"
                aria-pressed={preference === theme.preference}
                aria-label={`${theme.name} theme`}
                onClick={() => onPreferenceChange(theme.preference)}
                className={cn(
                  "grid size-7 place-items-center rounded-full border-0 transition-colors",
                  preference === theme.preference
                    ? "bg-lift text-ink"
                    : "bg-transparent text-dim hover:text-ink",
                )}
              >
                <Icon icon={theme.icon} size={14} />
              </button>
            </Tip>
          ))}
        </div>
      </header>
      <nav className="mt-[18px] mb-4 flex gap-[22px] border-b border-rule max-[600px]:overflow-x-auto max-[600px]:overflow-y-hidden max-[600px]:[scrollbar-width:none]">
        {TABS.map((tab) => {
          const active = tab.mode === mode;
          return (
            <button
              key={tab.mode}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onModeChange(tab.mode)}
              className={cn(
                "relative flex flex-none items-center gap-1.5 rounded-none border-0 bg-transparent px-0 pt-[9px] pb-2.5 text-sm whitespace-nowrap transition-colors",
                active ? "text-ink" : "text-dim hover:text-ink",
              )}
            >
              <Icon icon={tab.icon} size={14} />
              {tab.name}
              {active && (
                <motion.span
                  layoutId="tab-underline"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-ink"
                />
              )}
            </button>
          );
        })}
      </nav>
    </>
  );
}
