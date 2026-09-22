import { type FormEvent, useState } from "react";

import { ApiError, saveKey } from "../api";
import { cn, ghostButton, labelText } from "../styles";

interface KeyFormProps {
  /** A backend id (remote:deepseek) or a key name (HF_TOKEN), as the server takes it. */
  target: string;
  label: string;
  /** Shown above the field: the .env name, or what to type. */
  hint: string;
  secret?: boolean;
  onCancel: () => void;
  onSaved: () => void;
}

/** One key or address, checked by the server with one small request before it is used. */
export function KeyForm({ target, label, hint, secret = true, onCancel, onSaved }: KeyFormProps) {
  const [value, setValue] = useState("");
  const [saveToEnv, setSaveToEnv] = useState(true);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const id = `key-${target}`;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setChecking(true);
    setError("");
    try {
      await saveKey(target, value, saveToEnv);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor={id} className={cn(labelText, "mb-1.5 block")}>
        {hint}
      </label>
      <input
        id={id}
        type={secret ? "password" : "url"}
        autoComplete="off"
        spellCheck={false}
        required
        aria-label={label}
        value={value}
        onChange={(event) => setValue(event.target.value)}
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
      <div className="mt-4 flex justify-end gap-2">
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
  );
}
