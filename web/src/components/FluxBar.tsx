import { cn } from "../styles";

interface FluxBarProps {
  /** How far along, 0 to 1. */
  share: number;
  label: string;
  className?: string;
}

/** Progress as a glowing blue fill with a highlight gliding along it; the glide stops for people
 * who turn motion off. */
export function FluxBar({ share, label, className }: FluxBarProps) {
  const percent = Math.round(Math.min(Math.max(share, 0), 1) * 100);
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
      <span
        className="relative block h-full min-w-2 overflow-hidden rounded-full bg-linear-to-r from-flux via-flux-glow via-55% to-flux shadow-(--flux-shadow) transition-[width] duration-500 ease-out"
        style={{ width: `${percent}%` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1/2 animate-sheen bg-linear-to-r from-transparent via-white/55 to-transparent mix-blend-screen motion-reduce:hidden"
        />
      </span>
    </span>
  );
}
