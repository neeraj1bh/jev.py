import { cn } from "../../lib/styles";

interface FluxBarProps {
  /** How far along, 0 to 1; left out while the amount is not known, and the fill sweeps across. */
  share?: number;
  label: string;
  /** A settled amount rather than work under way: the fill keeps its glow but nothing moves. */
  settled?: boolean;
  className?: string;
}

/** An amount as a glowing fill that runs from sky blue at the start to deep blue at a full bar, so
 * a longer fill also ends darker, with a highlight gliding along it; the glide stops for people
 * who turn motion off. */
export function FluxBar({ share, label, settled, className }: FluxBarProps) {
  const percent =
    share === undefined ? undefined : Math.round(Math.min(Math.max(share, 0), 1) * 100);
  return (
    <span
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className={cn(
        "block h-2.5 overflow-hidden rounded-full bg-bar/60 shadow-[inset_0_1px_2px_rgb(0_0_0/0.14)]",
        className,
      )}
    >
      {percent !== 0 && (
        <span
          className={cn(
            "relative block h-full overflow-hidden rounded-full bg-linear-to-r from-flux-glow to-flux bg-no-repeat shadow-(--flux-shadow)",
            percent === undefined
              ? "w-2/5 animate-sweep motion-reduce:w-full motion-reduce:animate-none"
              : "min-w-2 origin-left animate-fill transition-[width] duration-500 ease-out motion-reduce:animate-none",
          )}
          // The gradient is as wide as the track, so the fill uncovers more of it as it grows.
          style={
            percent === undefined
              ? undefined
              : { width: `${percent}%`, backgroundSize: `${10000 / percent}% 100%` }
          }
        >
          {!settled && (
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/2 animate-sheen bg-linear-to-r from-transparent via-white/55 to-transparent mix-blend-screen motion-reduce:hidden"
            />
          )}
        </span>
      )}
    </span>
  );
}
