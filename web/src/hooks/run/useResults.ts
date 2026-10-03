import { useRef, useState } from "react";

import type { Row } from "../../lib/types";
import { useBatchReplay } from "../useBatchReplay";
import type { RunView } from "./useRunView";

/** The batch table: its rows and columns, the file they are logged to, the item open in the item
 * dialog, and its replay. */
export function useResults({ setRecording, setPanelsVisible, closeSavedRun }: RunView) {
  const [rows, setRows] = useState<Row[]>([]);

  const [columns, setColumns] = useState<string[]>([]);

  const [tableVisible, setTableVisible] = useState(false);

  const [resultsOpen, setResultsOpen] = useState(false);

  const [logFile, setLogFile] = useState({ text: "", path: "" });

  const [openItem, setOpenItem] = useState<{
    index: number;
    direction: "" | "forward" | "back";
    open: boolean;
  } | null>(null);

  const rowsRef = useRef<Row[]>([]);

  const batchKey = useRef("");

  const generateBatch = useRef(false);

  const batchReplay = useBatchReplay(rows);

  const replaceRows = (next: Row[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  /** A new input, model or tab: the table, summary and any open saved run no longer apply. */
  const clearBatch = () => {
    batchReplay.stop();
    setResultsOpen(false);
    replaceRows([]);
    batchKey.current = "";
    setRecording(null);
    setTableVisible(false);
    setPanelsVisible(true);
    setOpenItem(null);
    closeSavedRun();
  };

  return {
    rows,
    rowsRef,
    replaceRows,
    columns,
    setColumns,
    tableVisible,
    setTableVisible,
    resultsOpen,
    setResultsOpen,
    logFile,
    setLogFile,
    openItem,
    setOpenItem,
    batchKey,
    generateBatch,
    batchReplay,
    clearBatch,
  };
}

export type Results = ReturnType<typeof useResults>;
