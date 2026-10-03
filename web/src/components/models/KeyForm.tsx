import { CircleNotchIcon, GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useState } from "react";

import { ApiError, saveKey } from "../../lib/api";
import { cn, ghostButton, solidButton } from "../../lib/styles";
import { Icon } from "../ui/Icon";

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

  const submit = async (event: SubmitEvent) => {
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
      <label htmlFor={id} className="mb-1.5 block text-xs text-dim">
        {hint}
      </label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-xl bg-panel px-3 py-2 shadow-[0_1px_2px_var(--color-shadow)] ring-1 transition-shadow focus-within:ring-dim",
          error ? "ring-warn" : "ring-rule",
        )}
      >
        <Icon icon={secret ? LockSimpleIcon : GlobeIcon} size={14} className="text-dim" />
        <input
          id={id}
          type={secret ? "password" : "url"}
          autoComplete="off"
          spellCheck={false}
          required
          aria-label={label}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-[13px] text-ink outline-none placeholder:text-dim"
          placeholder={secret ? undefined : "http://localhost:8081/v1/chat/completions"}
        />
      </div>
      {error && <p className="mt-2 mb-0 text-[13px] text-warn">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="mr-auto flex cursor-pointer items-center gap-2 text-[13px] text-dim">
          <input
            type="checkbox"
            checked={saveToEnv}
            onChange={(event) => setSaveToEnv(event.target.checked)}
            className="size-3.5 accent-ink"
          />
          Also save to <span className="font-mono">.env</span>
        </label>
        <button
          type="button"
          className={cn(ghostButton, "px-3 py-1.5 text-[13px]")}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={checking}
          className={cn(solidButton, "px-3.5 py-1.5 text-[13px]")}
        >
          {checking && <Icon icon={CircleNotchIcon} size={12} className="animate-spin" />}
          {checking ? "Checking…" : "Check and use"}
        </button>
      </div>
    </form>
  );
}
