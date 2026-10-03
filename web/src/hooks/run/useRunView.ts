import { type ReactNode, useRef, useState } from "react";

import type { Recording } from "../../lib/types";
import { usePanels } from "../usePanels";
import type { RunContext } from "./context";

/** What the screen shows for the latest run: its panels and verdict, the recording Replay plays
 * back, and a saved run's column names while one is open. */
export function useRunView({ backends, compareModels, isCompare }: RunContext) {
  const {
    panels,
    setPanels,
    reset: resetPanelStates,
    update: updatePanel,
    markFastest,
  } = usePanels();
  const [verdict, setVerdict] = useState<ReactNode>("Run to compare.");

  const [panelsVisible, setPanelsVisible] = useState(true);

  const [writtenAsAnswers, setWrittenAsAnswers] = useState(false);

  const [savedNames, setSavedNames] = useState<string[] | null>(null);

  const [recording, setRecording] = useState<Recording | null>(null);

  const [busy, setBusy] = useState(false);

  const [replaying, setReplaying] = useState(false);

  const exampleResults = useRef<Record<string, Recording>>({});

  const panelsRef = useRef<HTMLDivElement>(null);
  const compareNames = savedNames ?? compareModels.map((id) => backends[id]?.label ?? id);

  const resetPanels = (count = isCompare ? compareNames.length : 2) => {
    resetPanelStates(count);
    setPanelsVisible(true);
    setVerdict("Run to compare.");
    setRecording(null);
  };

  const closeSavedRun = () => {
    setSavedNames(null);
    setWrittenAsAnswers(false);
  };

  const showExampleResult = (recorded: Recording) => {
    const { written, readout } = recorded;
    if (!written || !readout) return;
    setPanels([
      { status: "done", ms: written.ms, text: written.text, footer: written.footer },
      { status: "done", ms: readout.ms, response: readout.response, footer: readout.footer },
    ]);
    setVerdict(recorded.verdict);
    setRecording(recorded);
    setPanelsVisible(true);
  };

  return {
    panels,
    setPanels,
    resetPanelStates,
    updatePanel,
    markFastest,
    verdict,
    setVerdict,
    panelsVisible,
    setPanelsVisible,
    writtenAsAnswers,
    setWrittenAsAnswers,
    savedNames,
    setSavedNames,
    recording,
    setRecording,
    busy,
    setBusy,
    replaying,
    setReplaying,
    exampleResults,
    panelsRef,
    compareNames,
    resetPanels,
    closeSavedRun,
    showExampleResult,
  };
}

export type RunView = ReturnType<typeof useRunView>;
