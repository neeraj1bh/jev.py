import { panelSubtitle } from "../backends";
import type { PanelState } from "../types";
import { Answers } from "./Answers";
import { CompareTable } from "./CompareTable";
import { Panel } from "./Panel";
import { AnswerSkeleton } from "./Skeleton";

const idle: PanelState = { status: "idle", footer: "Waiting to run." };

const GENERATE_PANELS = [
  {
    key: "written",
    title: "Write the answers as text",
    subtitle: "generate JSON one token at a time, then parse it",
    info: "The model types its answers out as JSON, word by word, and the page reads them back. It is slower, and a model can go off-script.",
  },
  {
    key: "readout",
    title: "Read the answers off the logits",
    subtitle: "one pass over the state, a probability for every option",
    info: "The model reads the input once and scores every allowed answer at the same time. Nothing is typed out, so there is nothing to parse and no way to go off-script.",
  },
] as const;

function PanelAnswers({ state, truth }: { state?: PanelState; truth?: Record<string, string> }) {
  if (state?.status === "running" && !state.response) return <AnswerSkeleton />;
  if (!state?.response) return null;
  // Keyed by run so the probability bars grow again on every new result.
  return <Answers key={`${state.startedAt}-${state.ms}`} response={state.response} truth={truth} />;
}

interface CompareViewProps {
  names: string[];
  panels: PanelState[];
  questionIds: string[];
  truth?: Record<string, string>;
}

/** Every compare, two models or six, uses one table: a column per model, a row per question. */
export function CompareView({ names, panels, questionIds, truth }: CompareViewProps) {
  return <CompareTable names={names} panels={panels} questionIds={questionIds} truth={truth} />;
}

interface GenerateViewProps {
  panels: PanelState[];
  savedNames: string[] | null;
  writtenAsAnswers: boolean;
  onePass: boolean;
  truth?: Record<string, string>;
}

export function GenerateView({
  panels,
  savedNames,
  writtenAsAnswers,
  onePass,
  truth,
}: GenerateViewProps) {
  return (
    <main className="grid grid-cols-2 gap-3.5 max-[860px]:grid-cols-1">
      {GENERATE_PANELS.map((panel, k) => {
        const state = panels[k] ?? idle;
        const savedName = savedNames?.[k];
        return (
          <Panel
            key={panel.key}
            title={savedName ?? panel.title}
            subtitle={
              savedName
                ? panelSubtitle(savedName)
                : panel.key === "readout" && !onePass
                  ? "one request per question, sent in parallel"
                  : panel.subtitle
            }
            info={savedName ? undefined : panel.info}
            state={state}
          >
            {k === 0 && !writtenAsAnswers ? (
              <pre>{state.text ?? ""}</pre>
            ) : (
              <div className="max-h-[540px] overflow-auto">
                <PanelAnswers state={state} truth={truth} />
              </div>
            )}
          </Panel>
        );
      })}
    </main>
  );
}
