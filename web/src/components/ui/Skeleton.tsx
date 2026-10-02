import { cn } from "../../lib/styles";

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative block h-3 overflow-hidden rounded bg-lift after:absolute after:inset-y-0 after:left-0 after:w-1/2 after:animate-sheen after:bg-linear-to-r after:from-transparent after:via-flux-glow/40 after:to-transparent motion-reduce:after:hidden",
        className,
      )}
    />
  );
}

const PLACEHOLDER_KEYS = ["first", "second", "third", "fourth", "fifth"];

export function AnswerSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Waiting for answers">
      {PLACEHOLDER_KEYS.slice(0, rows).map((key) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-3.5 border-t border-rule py-[11px]"
        >
          <Skeleton className="w-24" />
          <div className="space-y-2">
            <Skeleton className="w-3/4" />
            <Skeleton className="w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
