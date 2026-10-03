import { ColumnsIcon } from "@phosphor-icons/react";

import type { RunContext } from "../../hooks/run/context";
import type { Waiting } from "../../hooks/run/usePrepare";
import type { RunInput } from "../../hooks/run/useRunInput";
import type { RunView } from "../../hooks/run/useRunView";
import { makerIcons } from "../../lib/logos";
import { cn, inset, shell } from "../../lib/styles";
import { EmptyState } from "../ui/EmptyState";
import { FluxLoader } from "../ui/FluxLoader";
import { CompareTable } from "./CompareTable";
import { RaceClocks } from "./RaceClocks";
import { GenerateView } from "./ResultPanels";

interface RunPanelsProps {
  ctx: RunContext;
  view: RunView;
  input: RunInput;
  waiting: Waiting | null;
}

/** Below the input: the loader while a run gets ready, the verdict, and each model's answers. */
export function RunPanels({ ctx, view, input, waiting }: RunPanelsProps) {
  const { downloads, isCompare, compareModels, onePass, setOpenMenu } = ctx;
  const { panels, verdict, panelsVisible, panelsRef, compareNames } = view;
  const { savedNames, writtenAsAnswers } = view;
  const { questionIds, asked, labels } = input;

  const waitingOn = (waiting?.downloads ?? []).flatMap((id) => downloads[id] ?? []);

  const waitingTotal = waitingOn.reduce((sum, part) => sum + part.total, 0);

  const waitingShare = waitingTotal
    ? waitingOn.reduce((sum, part) => sum + part.done, 0) / waitingTotal
    : undefined;

  return (
    <>
      {waiting && <FluxLoader label={waiting.label} share={waitingShare} />}
      <p
        className={cn(
          "mt-4.5 mb-0 min-h-6.5 text-sm text-ink [&_b]:font-semibold [&_b]:text-good",
          waiting && "text-center text-dim",
        )}
      >
        {verdict}
      </p>

      <div ref={panelsRef} hidden={!panelsVisible}>
        {isCompare && panels.some((panel) => panel.status !== "idle") && (
          <RaceClocks names={compareNames} panels={panels} />
        )}
        {isCompare && compareModels.length === 0 ? (
          <div className={shell}>
            <div className={cn(inset, "overflow-hidden")}>
              <EmptyState
                icon={ColumnsIcon}
                around={makerIcons}
                title="Pick models to compare"
                action={{ label: "Choose models", onClick: () => setOpenMenu("models") }}
              >
                Compare sends the same questions to every model you pick and lines up their answers,
                probabilities and times.
              </EmptyState>
            </div>
          </div>
        ) : isCompare ? (
          <CompareTable
            names={compareNames}
            panels={panels}
            questionIds={questionIds}
            asked={asked}
            truth={labels}
          />
        ) : (
          <GenerateView
            panels={panels}
            savedNames={savedNames}
            writtenAsAnswers={writtenAsAnswers}
            onePass={onePass}
            truth={labels}
          />
        )}
      </div>
    </>
  );
}
