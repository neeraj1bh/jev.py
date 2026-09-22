import { ArrowUp, FileCog, Folder } from "lucide-react";
import { useEffect, useState } from "react";

import { browse, type Listing } from "../api";
import { chipButton, cn, ghostButton, solidButton } from "../styles";
import { Icon } from "./Icon";

interface FolderPickerProps {
  /** "folder" picks the folder being shown; "program" picks a llama-server file inside it. */
  pick: "folder" | "program";
  onPick: (path: string) => void;
  onCancel: () => void;
}

const row =
  "flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-lift";

/** Browses the machine jev.py runs on; a page cannot read a folder's path from the browser. */
export function FolderPicker({ pick, onPick, onCancel }: FolderPickerProps) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [hidden, setHidden] = useState(false);

  const open = (path: string, showHidden = hidden) =>
    browse(path, pick === "program", showHidden)
      .then((next) => {
        setListing(next);
        setError("");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));

  // biome-ignore lint/correctness/useExhaustiveDependencies: opens the home folder once
  useEffect(() => {
    open("");
  }, []);

  return (
    <div className="rounded-md border border-rule">
      <div className="flex flex-wrap gap-1.5 border-b border-rule p-2">
        {listing?.roots.map((root) => (
          <button
            key={root}
            type="button"
            className={cn(chipButton(listing.path === root), "px-2.5 py-0.5 text-xs")}
            onClick={() => open(root)}
          >
            {root}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-b border-rule px-2 py-1.5">
        <button
          type="button"
          aria-label="Up one folder"
          disabled={!listing?.parent}
          onClick={() => listing?.parent && open(listing.parent)}
          className="rounded-md border-0 bg-transparent p-1 text-dim transition-colors hover:bg-lift hover:text-ink disabled:opacity-40"
        >
          <Icon icon={ArrowUp} size={14} />
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink" title={listing?.path}>
          {listing?.path ?? "…"}
        </span>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-dim">
          <input
            type="checkbox"
            checked={hidden}
            onChange={(event) => {
              setHidden(event.target.checked);
              if (listing) open(listing.path, event.target.checked);
            }}
          />
          Show hidden
        </label>
      </div>
      <ul className="m-0 h-80 list-none overflow-y-auto p-1">
        {listing?.folders.map((folder) => (
          <li key={folder.path}>
            <button type="button" className={row} onClick={() => open(folder.path)}>
              <Icon icon={Folder} size={14} className="shrink-0 text-dim" />
              <span className="min-w-0 flex-1 truncate">{folder.name}</span>
              {folder.models && <span className="text-xs text-good">models</span>}
            </button>
          </li>
        ))}
        {listing?.files.map((file) => (
          <li key={file.path}>
            <button type="button" className={row} onClick={() => onPick(file.path)}>
              <Icon icon={FileCog} size={14} className="shrink-0 text-dim" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="text-xs text-dim">use this</span>
            </button>
          </li>
        ))}
        {listing && !listing.folders.length && !listing.files.length && (
          <li className="px-2 py-1.5 text-xs text-dim">Nothing here.</li>
        )}
      </ul>
      {error && <p className="m-0 border-t border-rule px-3 py-2 text-xs text-warn">{error}</p>}
      <div className="flex justify-end gap-2 border-t border-rule p-2">
        <button type="button" className={cn(ghostButton, "px-3 py-1 text-sm")} onClick={onCancel}>
          Cancel
        </button>
        {pick === "folder" && (
          <button
            type="button"
            disabled={!listing}
            className={cn(solidButton, "px-3 py-1 text-sm")}
            onClick={() => listing && onPick(listing.path)}
          >
            Use this folder
          </button>
        )}
      </div>
    </div>
  );
}
