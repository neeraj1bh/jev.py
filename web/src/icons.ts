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

import { makerIcon } from "./logos";
import type { Backend } from "./types";

/** A model's icon in menus and headers: its maker's mark, or where it runs when the maker has none. */
export const backendIcon = (backend?: Backend): Icon =>
  (backend && makerIcon(`${backend.provider ?? ""} ${backend.id} ${backend.label}`)) ??
  { local: Cpu, gguf: Cube, server: HardDrives, hosted: Cloud, gateway: Globe }[
    backend?.group ?? "local"
  ] ??
  Cpu;

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
