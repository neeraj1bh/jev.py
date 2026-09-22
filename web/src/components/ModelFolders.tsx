import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { changeFolders, type FolderState, fetchFolders } from "../api";
import { cn, ghostButton } from "../styles";
import { FolderPicker } from "./FolderPicker";
import { Icon } from "./Icon";
import { Modal } from "./Modal";

/** Folders on this machine that already hold models, and the llama-server that runs GGUF files. */
export function ModelFolders({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<FolderState | null>(null);
  const [picking, setPicking] = useState<"folder" | "program" | null>(null);
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
      setPicking(null);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          className={cn(ghostButton, "px-3 py-1.5 text-sm")}
          onClick={() => {
            setError("");
            setPicking("folder");
          }}
        >
          Choose a folder…
        </button>
        {state?.has_gguf && !state.llama_server && (
          <button
            type="button"
            disabled={busy}
            className={cn(ghostButton, "px-3 py-1.5 text-sm")}
            onClick={() => {
              setError("");
              setPicking("program");
            }}
          >
            Choose llama-server…
          </button>
        )}
      </div>
      <Modal
        open={picking !== null}
        onClose={() => setPicking(null)}
        className="w-[min(600px,calc(100vw-32px))] px-6 py-5"
      >
        <h2 className="mt-0 mb-3 text-[15px] font-semibold">
          {picking === "program" ? "Choose llama-server" : "Choose a folder with models"}
        </h2>
        {picking && (
          <FolderPicker
            pick={picking}
            onPick={(path) => change(picking === "folder" ? { add: path } : { llama_server: path })}
            onCancel={() => setPicking(null)}
            problem={error}
            onSearch={(path) => change({ find_llama_server: path })}
          />
        )}
      </Modal>
      {state?.has_gguf && state.llama_server && (
        <div className="mt-3 flex items-center gap-3 border-t border-rule pt-2">
          <span className="shrink-0 text-xs text-dim">llama-server</span>
          <span
            className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink"
            title={state.llama_server}
          >
            {state.llama_server}
          </span>
          <button
            type="button"
            disabled={busy}
            className={cn(ghostButton, "shrink-0 px-2.5 py-1 text-xs")}
            onClick={() => {
              setError("");
              setPicking("program");
            }}
          >
            Change
          </button>
        </div>
      )}
      {state?.has_gguf && !state.llama_server && (
        <p className="mt-2 mb-0 text-xs text-dim">
          GGUF files need llama.cpp's llama-server program.
        </p>
      )}
      {error && !picking && <p className="mt-2 mb-0 text-xs text-warn">{error}</p>}
    </section>
  );
}
