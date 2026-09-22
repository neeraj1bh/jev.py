import { X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { changeFolders, type FolderState, fetchFolders } from "../api";
import { cn, ghostButton } from "../styles";
import { Icon } from "./Icon";

const field =
  "min-w-0 flex-1 rounded-md border border-rule bg-paper px-3 py-1.5 font-mono text-[13px] text-ink outline-none placeholder:text-dim focus:border-dim";

/** Folders on this machine that already hold models, and the llama-server that runs GGUF files. */
export function ModelFolders({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<FolderState | null>(null);
  const [folder, setFolder] = useState("");
  const [server, setServer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchFolders().then(setState);
  }, []);

  const change = async (request: Parameters<typeof changeFolders>[0]) => {
    setBusy(true);
    setError("");
    try {
      setState(await changeFolders(request));
      setFolder("");
      setServer("");
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const submit = (event: FormEvent, request: Parameters<typeof changeFolders>[0]) => {
    event.preventDefault();
    change(request);
  };

  return (
    <section className="mt-5">
      <h3 className="mt-0 mb-1 text-xs font-medium text-dim">From a folder on this machine</h3>
      {state && state.folders.length > 0 && (
        <ul className="m-0 mb-2 list-none p-0">
          {state.folders.map(({ path, models }) => (
            <li key={path} className="flex items-center gap-3 border-b border-rule py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{path}</span>
              <span className="text-xs text-dim">
                {models} {models === 1 ? "model" : "models"}
              </span>
              <button
                type="button"
                aria-label={`Stop listing models from ${path}`}
                disabled={busy}
                onClick={() => change({ remove: path })}
                className="rounded-md border-0 bg-transparent p-1 text-dim transition-colors hover:bg-lift hover:text-ink"
              >
                <Icon icon={X} size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(event) => submit(event, { add: folder })} className="flex gap-2">
        <input
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          placeholder="/path/to/models"
          aria-label="Folder with models"
          spellCheck={false}
          className={field}
        />
        <button
          type="submit"
          disabled={busy || !folder.trim()}
          className={cn(ghostButton, "w-16 px-0 py-1.5 text-sm")}
        >
          Add
        </button>
      </form>
      {state?.has_gguf && (
        <form onSubmit={(event) => submit(event, { llama_server: server })} className="mt-3">
          <p className="mt-0 mb-1 text-xs text-dim">
            {state.llama_server ? (
              <>
                GGUF files run with <span className="font-mono">{state.llama_server}</span>
              </>
            ) : (
              "GGUF files need llama.cpp's llama-server program"
            )}
          </p>
          {!state.llama_server && (
            <div className="flex gap-2">
              <input
                value={server}
                onChange={(event) => setServer(event.target.value)}
                placeholder="/path/to/llama-server"
                aria-label="llama-server program"
                spellCheck={false}
                className={field}
              />
              <button
                type="submit"
                disabled={busy || !server.trim()}
                className={cn(ghostButton, "w-16 px-0 py-1.5 text-sm")}
              >
                Set
              </button>
            </div>
          )}
        </form>
      )}
      {error && <p className="mt-2 mb-0 text-xs text-warn">{error}</p>}
    </section>
  );
}
