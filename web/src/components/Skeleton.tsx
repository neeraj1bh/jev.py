import { cn } from "../styles";

/** A soft placeholder block while something loads; still for people who turn motion off. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-3 animate-pulse rounded bg-lift motion-reduce:animate-none",
        className,
      )}
    />
  );
}

/** Placeholder answer rows for a panel that is waiting on a model. */
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
