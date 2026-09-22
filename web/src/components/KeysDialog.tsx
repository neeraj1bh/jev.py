import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";

import { fetchKeys } from "../api";
import { chipButton, cn, labelText } from "../styles";
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

  useEffect(() => {
    if (open) fetchKeys().then(setKeys);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} className="w-[min(620px,calc(100vw-32px))] px-6 py-5">
      <h2 className="mt-0 mb-1 text-[15px] font-semibold">Keys and tokens</h2>
      <p className={cn(labelText, "mt-0 mb-4")}>
        Each is checked with one small request before it is used. Values never leave this machine
        and are not shown again.
      </p>
      <ul className="m-0 list-none p-0">
        {keys === null &&
          ["a", "b", "c", "d"].map((k) => (
            <li key={k} className="border-t border-rule py-3">
              <Skeleton className="w-48" />
            </li>
          ))}
        {keys?.map((key) => (
          <li key={key.var} className="border-t border-rule py-3 first:border-t-0">
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{key.label}</span>
                <span className={cn(labelText, "block")}>
                  {key.unlocks} · <span className="font-mono text-xs">{key.var}</span>
                </span>
              </span>
              <span className={cn("text-xs", key.set ? "text-good" : "text-dim")}>
                {key.set ? "set" : "not set"}
              </span>
              {key.url && (
                <a
                  href={key.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Get a ${key.label} key`}
                  className="grid size-7 place-items-center rounded-md text-dim transition-colors hover:bg-lift hover:text-ink"
                >
                  <Icon icon={ExternalLink} size={14} />
                </a>
              )}
              <button
                type="button"
                className={chipButton(editing === key.var)}
                onClick={() => setEditing(editing === key.var ? "" : key.var)}
              >
                {key.set ? "Replace" : "Set"}
              </button>
            </div>
            {editing === key.var && (
              <div className="mt-3">
                <KeyForm
                  target={key.backend ?? key.var}
                  label={key.label}
                  hint={
                    key.var === "LLAMACPP_URL"
                      ? "http://localhost:8081/v1/chat/completions"
                      : key.var
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
