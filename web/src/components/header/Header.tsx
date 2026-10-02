import {
  ArrowsSplit,
  ClockCounterClockwise,
  Columns,
  Key,
  Monitor,
  Moon,
  Stop,
  Sun,
  Trophy,
} from "@phosphor-icons/react";
import { motion } from "motion/react";

import type { ThemePreference } from "../../hooks/useTheme";
import { cn } from "../../lib/styles";
import type { Mode } from "../../lib/types";
import { Icon, type IconGlyph } from "../ui/Icon";
import { SegmentPill, segmentTrack } from "../ui/Segment";
import { Tip } from "../ui/Tip";
import { ShareMenu } from "./ShareMenu";

const TABS: { mode: Mode; name: string; icon: IconGlyph }[] = [
  { mode: "compare", name: "Compare", icon: Columns },
  { mode: "generate", name: "Generate vs readout", icon: ArrowsSplit },
  { mode: "benchmark", name: "Benchmark", icon: Trophy },
  { mode: "past", name: "Past runs", icon: ClockCounterClockwise },
];

const THEMES: { preference: ThemePreference; name: string; icon: IconGlyph }[] = [
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
            <Icon icon={Stop} size={14} />
          </button>
        )}
        <ShareMenu />
        <Tip content="Keys and tokens">
          <button
            type="button"
            aria-label="Keys and tokens"
            onClick={onOpenKeys}
            className="grid size-8 place-items-center rounded-full border border-rule bg-transparent text-dim transition-colors hover:border-dim hover:text-ink"
          >
            <Icon icon={Key} size={14} />
          </button>
        </Tip>
        <div className={segmentTrack}>
          {THEMES.map((theme) => (
            <Tip key={theme.preference} content={theme.name}>
              <button
                type="button"
                aria-pressed={preference === theme.preference}
                aria-label={`${theme.name} theme`}
                onClick={() => onPreferenceChange(theme.preference)}
                className={cn(
                  "relative grid size-7 place-items-center rounded-full border-0 bg-transparent transition-colors",
                  preference === theme.preference ? "text-ink" : "text-dim hover:text-ink",
                )}
              >
                {preference === theme.preference && <SegmentPill group="theme" />}
                <Icon icon={theme.icon} size={14} className="relative" />
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
