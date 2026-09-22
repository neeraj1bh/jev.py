export interface Download {
  what: string;
  done: number;
  total: number;
  unit: string;
}

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

/** A model or set coming down: what, how far, and a bar, pinned where it cannot be missed. */
export function DownloadBar({ download }: { download: Download | null }) {
  if (!download) return null;
  const { what, done, total, unit } = download;
  const share = total ? Math.min(1, done / total) : 0;
  const detail =
    unit === "bytes"
      ? `${gb(done)}${total ? ` of ${gb(total)}` : ""} GB`
      : `page ${Math.min(done + 1, total)} of ${total}`;
  return (
    <div
      role="status"
      className="fixed right-4 bottom-4 z-20 w-[min(340px,calc(100vw-32px))] animate-rise rounded-lg border border-rule bg-panel px-4 py-3 shadow-[0_12px_32px_var(--color-shadow)]"
    >
      <p className="m-0 flex justify-between gap-3 text-sm">
        <span className="truncate font-semibold text-ink">Downloading {what}</span>
        <span className="font-mono text-xs whitespace-nowrap text-dim tabular-nums">
          {total ? `${Math.round(share * 100)}%` : ""}
        </span>
      </p>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-bar">
        <span
          className="block h-full rounded-full bg-ink/70 transition-[width] duration-300"
          style={{ width: `${Math.max(4, share * 100)}%` }}
        />
      </span>
      <p className="mt-1.5 mb-0 font-mono text-xs text-dim tabular-nums">
        {detail} · first time only, saved on this machine
      </p>
    </div>
  );
}
