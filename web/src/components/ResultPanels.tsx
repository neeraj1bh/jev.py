import { panelSubtitle } from "../backends";
import type { PanelState } from "../types";
import { Answers } from "./Answers";
import { Panel } from "./Panel";

const idle: PanelState = { status: "idle", footer: "Waiting to run." };

const GENERATE_PANELS = [
  {
    key: "written",
    title: "Write the answers as text",
    subtitle: "generate JSON one token at a time, then parse it",
  },
  {
    key: "readout",
    title: "Read the answers off the logits",
    subtitle: "one pass over the state, a probability for every option",
  },
] as const;

function PanelAnswers({
  state,
  truth,
  compact,
}: {
  state?: PanelState;
  truth?: Record<string, string>;
  compact?: boolean;
}) {
  if (!state?.response) return null;
  // Keyed by run so the probability bars grow again on every new result.
  return (
    <Answers
      key={`${state.startedAt}-${state.ms}`}
      response={state.response}
      truth={truth}
      compact={compact}
    />
  );
}

interface CompareViewProps {
  names: string[];
  panels: PanelState[];
  truth?: Record<string, string>;
}

export function CompareView({ names, panels, truth }: CompareViewProps) {
  const compact = names.length > 2;
  return (
    <div
      style={{ "--columns": names.length <= 4 ? names.length : 3 } as React.CSSProperties}
      className="grid grid-cols-[repeat(var(--columns),minmax(0,1fr))] gap-3.5 max-[860px]:grid-cols-1"
    >
      {names.map((name, i) => (
        <Panel
          key={name}
          title={name}
          subtitle={panelSubtitle(name)}
          state={panels[i] ?? idle}
          compact={compact}
        >
          <div className="max-h-[540px] overflow-x-hidden overflow-y-auto">
            <PanelAnswers state={panels[i]} truth={truth} compact={compact} />
          </div>
        </Panel>
      ))}
    </div>
  );
}

interface GenerateViewProps {
  panels: PanelState[];
  savedNames: string[] | null;
  writtenAsAnswers: boolean;
  truth?: Record<string, string>;
}

export function GenerateView({ panels, savedNames, writtenAsAnswers, truth }: GenerateViewProps) {
  return (
    <main className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3.5 max-[860px]:grid-cols-1">
      {GENERATE_PANELS.map((panel, k) => {
        const state = panels[k] ?? idle;
        const savedName = savedNames?.[k];
        const title = savedName ?? panel.title;
        const subtitle = savedName ? panelSubtitle(savedName) : panel.subtitle;
        return (
          <Panel key={panel.key} title={title} subtitle={subtitle} state={state}>
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
