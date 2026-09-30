import {
  BookOpen,
  Brain,
  Briefcase,
  Cloud,
  Cpu,
  Cube,
  Database,
  Globe,
  GraduationCap,
  HardDrives,
  type Icon,
  Scales,
  ShieldCheck,
  Smiley,
  Snowflake,
  Target,
  Translate,
} from "@phosphor-icons/react";

import type { Backend } from "./types";

const GROUP_ICONS: Record<string, Icon> = {
  local: Cpu,
  gguf: Cube,
  server: HardDrives,
  hosted: Cloud,
  gateway: Globe,
};

/** Every place a model can run, for a picture of them all. */
export const backendIcons = Object.values(GROUP_ICONS);

/** Where a model runs, told apart at a glance in menus and headers. */
export const backendIcon = (backend?: Backend): Icon =>
  GROUP_ICONS[backend?.group ?? "local"] ?? Cpu;

const SET_ICONS: Record<string, Icon> = {
  "Frozen benchmarks": Snowflake,
  "Sentiment and tone": Smiley,
  "Meaning and reading": BookOpen,
  Reasoning: Brain,
  "Knowledge and exams": GraduationCap,
  "Intent and topic": Target,
  "Contracts and business": Briefcase,
  "Safety and spam": ShieldCheck,
  "Other languages": Translate,
  "Which answer is better": Scales,
};

/** A dataset's icon comes from its group; a set outside the known groups gets a plain one. */
export const setIcon = (group?: string): Icon => (group && SET_ICONS[group]) || Database;
