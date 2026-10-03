import {
  BookOpenIcon,
  BrainIcon,
  BriefcaseIcon,
  CloudIcon,
  CpuIcon,
  CubeIcon,
  DatabaseIcon,
  GlobeIcon,
  GraduationCapIcon,
  HardDrivesIcon,
  type Icon,
  ScalesIcon,
  ShieldCheckIcon,
  SmileyIcon,
  SnowflakeIcon,
  TargetIcon,
  TranslateIcon,
} from "@phosphor-icons/react";

import { makerIcon } from "./logos";
import type { Backend } from "./types";

/** A model's icon in menus and headers: its maker's mark, or where it runs when the maker has none. */
export const backendIcon = (backend?: Backend): Icon =>
  (backend && makerIcon(`${backend.provider ?? ""} ${backend.id} ${backend.label}`)) ??
  { local: CpuIcon, gguf: CubeIcon, server: HardDrivesIcon, hosted: CloudIcon, gateway: GlobeIcon }[
    backend?.group ?? "local"
  ] ??
  CpuIcon;

const SET_ICONS: Record<string, Icon> = {
  "Frozen benchmarks": SnowflakeIcon,
  "Sentiment and tone": SmileyIcon,
  "Meaning and reading": BookOpenIcon,
  Reasoning: BrainIcon,
  "Knowledge and exams": GraduationCapIcon,
  "Intent and topic": TargetIcon,
  "Contracts and business": BriefcaseIcon,
  "Safety and spam": ShieldCheckIcon,
  "Other languages": TranslateIcon,
  "Which answer is better": ScalesIcon,
};

/** A dataset's icon comes from its group; a set outside the known groups gets a plain one. */
export const setIcon = (group?: string): Icon => (group && SET_ICONS[group]) || DatabaseIcon;
