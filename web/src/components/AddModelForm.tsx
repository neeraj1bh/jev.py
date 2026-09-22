import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";

import { cn, ghostButton } from "../styles";
import { Icon } from "./Icon";

const HUB_ID = /^[\w.-]+\/[\w.-]+$/;

/** A Hugging Face model id; the server checks it on the Hub before anything downloads. */
export function AddModelForm({ onAdd }: { onAdd: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm text-dim transition-colors hover:bg-lift hover:text-ink"
      >
        <Icon icon={Plus} size={14} />
        Add a model from Hugging Face
      </button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const model = id.trim();
    if (!HUB_ID.test(model)) {
      setError("Use the id from the model's Hub page, such as Qwen/Qwen2.5-7B-Instruct.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onAdd(model);
      setId("");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-1 my-1 flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        <input
          // biome-ignore lint/a11y/noAutofocus: the field opens because the viewer asked for it
          autoFocus
          value={id}
          onChange={(event) => {
            setId(event.target.value);
            setError("");
          }}
          placeholder="Qwen/Qwen2.5-7B-Instruct"
          aria-label="Hugging Face model id"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper px-2.5 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-dim focus:border-dim"
        />
        <button type="submit" disabled={busy} className={cn(ghostButton, "py-1.5 text-sm")}>
          {busy ? "Checking…" : "Add"}
        </button>
      </div>
      <p className={cn("m-0 px-1 text-xs", error ? "text-warn" : "text-dim")}>
        {error || "Checked on the Hub first. It downloads the first time it runs."}
      </p>
    </form>
  );
}
