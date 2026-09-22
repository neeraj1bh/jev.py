import type { Progress } from "../hooks/useDownloads";
import { cn, ghostButton } from "../styles";

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

interface DownloadBarProps {
  progress: Progress;
  label: (key: string) => string;
  onStop: (key: string) => void;
}

/** Models and sets coming down: what, how far, and Stop for a model, pinned where it cannot be
 * missed. */
export function DownloadBar({ progress, label, onStop }: DownloadBarProps) {
  const entries = Object.entries(progress).filter(([key]) => key !== "gateway");
  if (!entries.length) return null;
  return (
    <div className="fixed right-4 bottom-4 z-20 flex w-[min(340px,calc(100vw-32px))] flex-col gap-2">
      {entries.map(([key, { done, total, unit }]) => {
        const model = unit === "bytes";
        const share = total ? Math.min(1, done / total) : 0;
        const detail = model
          ? `${gb(done)}${total ? ` of ${gb(total)}` : ""} GB`
          : `page ${Math.min(done + 1, total)} of ${total}`;
        return (
          <div
            key={key}
            role="status"
            className="animate-rise rounded-lg border border-rule bg-panel px-4 py-3 shadow-[0_12px_32px_var(--color-shadow)]"
          >
            <p className="m-0 flex items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-semibold text-ink">Downloading {label(key)}</span>
              <span className="font-mono text-xs whitespace-nowrap text-dim tabular-nums">
                {total ? `${Math.round(share * 100)}%` : "starting…"}
              </span>
            </p>
            <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-bar">
              <span
                className="block h-full rounded-full bg-ink/70 transition-[width] duration-300"
                style={{ width: `${Math.max(4, share * 100)}%` }}
              />
            </span>
            <div className="mt-1.5 flex items-center justify-between gap-3">
              <p className="m-0 font-mono text-xs text-dim tabular-nums">
                {detail} · {model ? "resumes if stopped" : "first time only"}
              </p>
              {model && (
                <button
                  type="button"
                  className={cn(ghostButton, "px-2.5 py-1 text-xs")}
                  onClick={() => onStop(key)}
                >
                  Stop
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
