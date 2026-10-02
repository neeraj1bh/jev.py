import { type FormEvent, useState } from "react";

import { cn, ghostButton } from "../../lib/styles";
import { Modal } from "../ui/Modal";
import { ModelFolders } from "./ModelFolders";

const HUB_ID = /^[\w.-]+\/[\w.-]+$/;

/** Small open chat models that need no licence click, smallest first. Download size in GB. */
const STARTERS = [
  { id: "Qwen/Qwen2.5-0.5B-Instruct", gb: 1.0 },
  { id: "Qwen/Qwen2.5-1.5B-Instruct", gb: 3.1 },
  { id: "HuggingFaceTB/SmolLM2-1.7B-Instruct", gb: 3.4 },
  { id: "Qwen/Qwen2.5-3B-Instruct", gb: 6.2 },
  { id: "Qwen/Qwen2.5-7B-Instruct", gb: 15.2 },
];

/** The memory a model needs here, when it is more than this machine has. */
function tooBig(gb: number, perGb?: number, have?: number) {
  if (!perGb || have === undefined) return "";
  const need = Math.round(gb * perGb);
  return need > have ? `needs ${need} GB, this machine has ${Math.round(have)}` : "";
}

interface AddModelDialogProps {
  open: boolean;
  /** Models already in the menu, so a starter shows as added. */
  listed: Set<string>;
  /** Memory a model needs per GB of download on this machine (1.3 at 16 bits, 2.6 at 32). */
  memoryPerGb?: number;
  /** This machine's memory, or the GPU's on CUDA. */
  memoryGb?: number;
  onClose: () => void;
  onAdd: (id: string) => Promise<void>;
  /** A folder was added or removed, so the menu's models changed. */
  onFoldersChanged: () => void;
}

/** Adds a model to the menu: from Hugging Face, checked on the Hub before anything downloads, or
 * from a folder on this machine that already holds models. */
export function AddModelDialog(props: AddModelDialogProps) {
  const { open, listed, memoryPerGb, memoryGb, onClose, onAdd, onFoldersChanged } = props;
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const add = async (model: string) => {
    if (!HUB_ID.test(model)) {
      setError("Use the id from the model's Hub page, such as Qwen/Qwen2.5-7B-Instruct.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAdd(model);
      setId("");
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add(id.trim());
  };

  return (
    <Modal open={open} onClose={onClose} className="w-[min(560px,calc(100vw-32px))] px-6 py-5">
      <h2 className="mt-0 mb-4 text-[15px] font-semibold">Add a model</h2>

      <h3 className="mt-0 mb-1 text-xs font-medium text-dim">Small models from Hugging Face</h3>
      <ul className="m-0 mb-5 list-none p-0">
        {STARTERS.map((starter) => {
          const warning = tooBig(starter.gb, memoryPerGb, memoryGb);
          return (
            <li
              key={starter.id}
              className="flex items-center gap-3 border-b border-rule py-2 last:border-b-0"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{starter.id.split("/")[1]}</span>
                {warning && <span className="block text-xs text-warn">{warning}</span>}
              </span>
              <span className="font-mono text-xs text-dim tabular-nums">
                {starter.gb.toFixed(1)} GB
              </span>
              <button
                type="button"
                disabled={busy || listed.has(starter.id)}
                className={cn(ghostButton, "w-16 px-0 py-1 text-xs disabled:text-dim")}
                onClick={() => add(starter.id)}
              >
                {listed.has(starter.id) ? "Added" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>

      <form onSubmit={submit}>
        <label htmlFor="hub-id" className="mb-1 block text-xs font-medium text-dim">
          Any other Hugging Face model
        </label>
        <div className="flex gap-2">
          <input
            id="hub-id"
            value={id}
            onChange={(event) => {
              setId(event.target.value);
              setError("");
            }}
            placeholder="owner/model"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-dim focus:border-dim"
          />
          <button
            type="submit"
            disabled={busy || !id.trim()}
            className={cn(ghostButton, "w-16 px-0 py-1.5 text-sm")}
          >
            {busy ? "…" : "Add"}
          </button>
        </div>
        {error && <p className="mt-2 mb-0 text-xs text-warn">{error}</p>}
      </form>

      {open && <ModelFolders onChanged={onFoldersChanged} />}
    </Modal>
  );
}
