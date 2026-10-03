import type { Dispatch, SetStateAction } from "react";

import type { Backend, Dataset, Mode, RunKind } from "../../lib/types";
import type { useConfirm } from "../useConfirm";
import type { Progress } from "../useDownloads";
import type { useToast } from "../useToast";

/** What every part of the Compare and Generate screen reads: the models on offer and the ones
 * picked, the tab, and the page's toast, confirm box and menus. */
export interface RunContext {
  backends: Record<string, Backend>;
  datasets: Dataset[];
  downloads: Progress;
  compareModels: string[];
  setCompareModels: Dispatch<SetStateAction<string[]>>;
  generateModel: string;
  setGenerateModel: Dispatch<SetStateAction<string>>;
  reload: () => Promise<Backend[]>;
  markDatasetLocal: (name: string) => void;
  mode: Mode;
  isCompare: boolean;
  onePass: boolean;
  runKind: RunKind;
  isLocal: (id: string) => boolean;
  readsWide: (models: string[]) => boolean;
  shortName: (id: string) => string;
  columnName: (id: string, kind?: RunKind) => string;
  toast: ReturnType<typeof useToast>;
  confirm: ReturnType<typeof useConfirm>;
  setKeysOpen: (open: boolean) => void;
  openMenu: string;
  setOpenMenu: (menu: string) => void;
  menuHandler: (id: string) => (open: boolean) => void;
}
