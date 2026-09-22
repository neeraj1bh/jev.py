import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { clearKey, fetchKeys } from "../api";
import { cn, ghostButton } from "../styles";
import type { KeyInfo } from "../types";
import { Icon } from "./Icon";
import { KeyForm } from "./KeyForm";
import { Modal } from "./Modal";
import { Skeleton } from "./Skeleton";

interface KeysDialogProps {
  open: boolean;
  onClose: () => void;
  /** A key changed, so what the pickers can use may have too. */
  onChanged: () => void;
}

/** Every key and token in one place: which are set, what each unlocks, and a way to set it. */
export function KeysDialog({ open, onClose, onChanged }: KeysDialogProps) {
  const [keys, setKeys] = useState<KeyInfo[] | null>(null);
  const [editing, setEditing] = useState("");
  const [clearing, setClearing] = useState("");

  useEffect(() => {
    if (open) fetchKeys().then(setKeys);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} className="w-[min(520px,calc(100vw-32px))] px-6 py-5">
      <h2 className="mt-0 mb-1 text-[15px] font-semibold">Keys and tokens</h2>
      <p className="mt-0 mb-3 text-xs text-dim">
        Kept on this machine. Each is checked with one small request first.
      </p>
      <ul className="m-0 list-none p-0">
        {keys === null &&
          ["a", "b", "c", "d"].map((k) => (
            <li key={k} className="border-b border-rule py-2.5 last:border-b-0">
              <Skeleton className="w-48" />
            </li>
          ))}
        {keys?.map((key) => (
          <li key={key.var} className="border-b border-rule py-2.5 last:border-b-0">
            <div className="flex items-center gap-3">
              <span
                role="img"
                aria-label={key.set ? "set" : "not set"}
                className={cn("size-1.5 shrink-0 rounded-full", key.set ? "bg-good" : "bg-rule")}
              />
              <span className="min-w-0 flex-1" title={key.unlocks}>
                <span className="block text-sm text-ink">{key.label}</span>
                <span className="block font-mono text-[11.5px] text-dim">{key.var}</span>
              </span>
              {!key.set && key.url && (
                <a
                  href={key.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-dim underline-offset-2 hover:text-ink hover:underline"
                >
                  Get a key
                </a>
              )}
              {key.set && (
                <button
                  type="button"
                  aria-label={`Remove the ${key.label} key`}
                  title={clearing === key.var ? "Click again to remove it from .env" : "Remove"}
                  className={cn(
                    "rounded-md border-0 bg-transparent p-1.5 transition-colors hover:bg-lift",
                    clearing === key.var ? "text-warn" : "text-dim hover:text-warn",
                  )}
                  onClick={async () => {
                    if (clearing !== key.var) {
                      setClearing(key.var);
                      return;
                    }
                    await clearKey(key.backend ?? key.var);
                    setClearing("");
                    fetchKeys().then(setKeys);
                    onChanged();
                  }}
                  onBlur={() => setClearing("")}
                >
                  <Icon icon={Trash2} size={14} />
                </button>
              )}
              <button
                type="button"
                className={cn(ghostButton, "w-20 px-0 py-1 text-xs")}
                onClick={() => setEditing(editing === key.var ? "" : key.var)}
              >
                {key.set ? "Replace" : "Add"}
              </button>
            </div>
            {editing === key.var && (
              <div className="mt-3">
                <KeyForm
                  target={key.backend ?? key.var}
                  label={key.label}
                  hint={
                    key.var === "LLAMACPP_URL"
                      ? "The llama-server address, e.g. http://localhost:8081/v1/chat/completions"
                      : `Paste your ${key.label} key`
                  }
                  secret={key.var !== "LLAMACPP_URL"}
                  onCancel={() => setEditing("")}
                  onSaved={() => {
                    setEditing("");
                    fetchKeys().then(setKeys);
                    onChanged();
                  }}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
    </Modal>
  );
}
