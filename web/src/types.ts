import type { ReactNode } from "react";

export type Mode = "compare" | "generate" | "past";
export type RunKind = "cmp" | "gen";
export type BackendGroup = "local" | "server" | "hosted" | "gateway";

export interface Backend {
  id: string;
  label: string;
  group: BackendGroup;
  ready: boolean;
  gb?: number;
  device?: string;
  path?: string;
  need_gb?: number;
  have_gb?: number;
  url?: string;
  key?: string;
  max?: number | null;
  /** For gateway models: who made the model, e.g. "qwen". */
  provider?: string;
}

export interface Dataset {
  name: string;
  options: number | null;
  local: boolean;
  about?: string;
}

export type Answer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> };

export interface Response {
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number };
  latency_ms?: number;
  error?: { message: string };
}

export interface Question {
  type: Answer["type"];
  instructions?: string;
  criteria?: Record<string, string | null> | string[];
}

export interface Request {
  state: unknown;
  questions: Record<string, Question>;
}

export interface Item extends Request {
  truth: Record<string, string>;
  source: string;
  options?: number;
  left?: number;
}

export interface Side {
  ms: number;
  response: Response;
}

export interface Row {
  item: Item;
  sides: Side[];
  isNew?: boolean;
}

export interface SavedRun {
  name: string;
  mode: RunKind;
  dataset: string;
  backends: string[];
  items: number;
  score?: Record<string, [number, number]>;
}

export interface PanelState {
  status: "idle" | "running" | "done";
  footer: string;
  startedAt?: number;
  cap?: number;
  ms?: number;
  response?: Response;
  text?: string;
  fastest?: boolean;
}

export interface RecordedSide {
  ms: number;
  response: Response;
  footer: string;
}

export interface GeneratedText {
  ms: number;
  parsed: Record<string, unknown> | null;
  chunks: [number, string][];
  text: string;
  footer: string;
}

export interface Recording {
  verdict: ReactNode;
  /** The batch row this came from, so a replay can point at it. */
  row?: number;
  sides?: RecordedSide[];
  readout?: RecordedSide;
  written?: GeneratedText;
}
