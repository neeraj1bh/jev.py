import { type FormEvent, useState } from "react";

import { ApiError, saveKey } from "../api";
import { cn, ghostButton, labelText } from "../styles";
import type { Backend } from "../types";
import { Modal } from "./Modal";

interface KeyDialogProps {
  backend: Backend;
  onCancel: () => void;
  onSaved: (backendId: string) => void;
}

/** Asks for a hosted backend's key; the server checks it with one small request before it is used. */
export function KeyDialog({ backend, onCancel, onSaved }: KeyDialogProps) {
  const [key, setKey] = useState("");
  const [saveToEnv, setSaveToEnv] = useState(true);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError("");
    try {
      await saveKey(backend.id, key, saveToEnv);
      onSaved(backend.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Modal open onClose={onCancel} className="w-[min(440px,calc(100vw-32px))]">
      <form onSubmit={submit}>
        <h2 className="mt-0 mb-3.5 text-[15px] font-semibold">{backend.label} API key</h2>
        <label htmlFor="api-key" className={cn(labelText, "mb-1.5 block")}>
          {backend.key}
        </label>
        <input
          id="api-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          required
          value={key}
          onChange={(event) => setKey(event.target.value)}
          className="w-full rounded-md border border-rule bg-paper px-2.5 py-2 font-mono text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-dim"
        />
        <label className="mt-3 flex items-center gap-2 text-[13.5px] text-dim">
          <input
            type="checkbox"
            checked={saveToEnv}
            onChange={(event) => setSaveToEnv(event.target.checked)}
          />{" "}
          Also save to .env (git-ignored)
        </label>
        {error && <p className="mt-3 mb-0 text-[13.5px] text-warn">{error}</p>}
        <div className="mt-[18px] flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={checking}
            className="rounded-md border border-ink bg-ink px-4 py-2 font-semibold text-paper"
          >
            {checking ? "Checking…" : "Check and use"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
