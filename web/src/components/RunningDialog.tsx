import { cn, ghostButton } from "../styles";
import type { Backend } from "../types";
import { Modal } from "./Modal";

interface RunningDialogProps {
  open: boolean;
  models: Backend[];
  onClose: () => void;
  onStop: (backend: Backend) => void;
}

/** The models llama.cpp is running, each with a way to give its memory back. */
export function RunningDialog({ open, models, onClose, onStop }: RunningDialogProps) {
  return (
    <Modal open={open} onClose={onClose} className="w-[min(520px,calc(100vw-32px))] px-6 py-5">
      <h2 className="mt-0 mb-1 text-[15px] font-semibold">Running through llama.cpp</h2>
      <p className="mt-0 mb-3 text-xs text-dim">
        Each keeps its memory until it is stopped, or after 15 minutes unused.
      </p>
      <ul className="m-0 list-none p-0">
        {models.map((backend) => (
          <li
            key={backend.id}
            className="flex items-center gap-3 border-b border-rule py-2 last:border-b-0"
          >
            <span className="size-1.5 shrink-0 rounded-full bg-good" />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{backend.label}</span>
            <span className="font-mono text-xs text-dim tabular-nums">{backend.gb} GB</span>
            <button
              type="button"
              className={cn(ghostButton, "w-16 shrink-0 px-0 py-1 text-xs")}
              onClick={() => onStop(backend)}
            >
              Stop
            </button>
          </li>
        ))}
        {models.length === 0 && <li className="py-2 text-sm text-dim">Nothing is running.</li>}
      </ul>
      {models.length > 1 && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className={cn(ghostButton, "px-3 py-1.5 text-sm")}
            onClick={() => models.forEach(onStop)}
          >
            Stop all
          </button>
        </div>
      )}
    </Modal>
  );
}
