import type { Progress } from "../../hooks/useDownloads";
import { cn, ghostButton, inset, shell } from "../../lib/styles";
import { FluxBar } from "../ui/FluxBar";

const gb = (bytes: number) => (bytes / 1e9).toFixed(1);

interface DownloadBarProps {
  progress: Progress;
  label: (key: string) => string;
  onStop: (key: string) => void;
}

/** Models and sets coming down: what, how far, and Stop (each resumes later), pinned where it cannot be
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
          <div key={key} role="status" className={cn(shell, "animate-pop")}>
            <p className="m-0 flex items-center justify-between gap-3 px-2.5 pt-1 pb-2 text-sm">
              <span className="truncate font-semibold tracking-tight text-ink">
                Downloading {label(key)}
              </span>
              <span className="rounded-full bg-bar/70 px-2 py-0.5 font-mono text-[11px] whitespace-nowrap text-dim tabular-nums">
                {total ? `${Math.round(share * 100)}%` : "starting…"}
              </span>
            </p>
            <div className={cn(inset, "px-3.5 py-3")}>
              <FluxBar share={Math.max(share, 0.04)} label={`Downloading ${label(key)}`} />
              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="m-0 font-mono text-xs text-dim tabular-nums">
                  {detail} · resumes if stopped
                </p>
                <button
                  type="button"
                  className={cn(ghostButton, "px-2.5 py-1 text-xs")}
                  onClick={() => onStop(key)}
                >
                  Stop
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
