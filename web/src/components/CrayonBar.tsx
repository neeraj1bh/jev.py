import { cn } from "../styles";

// One crayon per bar, from green at the best to red at the worst; plain colours, the same in
// both themes, so the fill reads as the value on either background.
const RAMP = ["#3f9b4f", "#f0b429", "#ec7a1c", "#d7392b"];

/** The crayon for a place between the best (0) and the worst (1), mixed between ramp stops. */
function crayon(tone: number) {
  const at = Math.min(Math.max(tone, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(at), RAMP.length - 2);
  const mix = Math.round((at - k) * 100);
  return `color-mix(in oklab, ${RAMP[k + 1]} ${mix}%, ${RAMP[k]})`;
}

/** Thin leaning strokes across the whole box, each a little off in lean, length and start, as a
 * quick hand hatches; fixed offsets, so the box looks the same on every render. */
const HATCH = Array.from({ length: 96 }, (_, k) => {
  const x = k * 2.2 - 6;
  const lean = 7 + Math.sin(k * 1.7) * 2;
  const top = 3 + Math.abs(Math.sin(k * 2.9)) * 4;
  const bottom = 33 - Math.abs(Math.sin(k * 1.3)) * 4;
  return `M${x.toFixed(1)} ${bottom.toFixed(1)} L${(x + lean).toFixed(1)} ${top.toFixed(1)}`;
}).join(" ");

interface CrayonBarProps {
  /** How much of the box the colour fills, 0 to 1. */
  share: number;
  /** Where the value sits in this run, 0 for the best and 1 for the worst. */
  tone: number;
  text: string;
  /** Fill in once, when a finished run first shows; a live one grows by itself. */
  draw: boolean;
}

/** A hatched box filled with one colour as far as the amount, the number handwritten on top. */
export function CrayonBar({ share, tone, text, draw }: CrayonBarProps) {
  return (
    <span className="relative block h-9 min-w-28 overflow-hidden rounded-lg border-[1.5px] border-ink/35 bg-panel">
      <svg
        aria-hidden
        className="absolute inset-0 size-full"
        viewBox="0 0 200 36"
        preserveAspectRatio="none"
      >
        <path
          d={HATCH}
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity={0.3}
          strokeWidth={0.9}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {share > 0 && (
        <span
          className={cn(
            "absolute inset-y-1 left-1 block min-w-2 origin-left rounded-md transition-[width] duration-300",
            draw && "animate-fill motion-reduce:animate-none",
          )}
          style={{ width: `calc(${share} * (100% - 0.5rem))`, background: crayon(tone) }}
        />
      )}
      <span className="absolute inset-0 grid place-items-center">
        <span className="relative px-3">
          {/* Rubbed out behind the number, softly, so it reads over the colour and the hatching. */}
          <span className="absolute -inset-x-1 -inset-y-0.5 bg-[radial-gradient(closest-side,var(--color-panel)_40%,transparent)]" />
          <span className="relative font-hand text-[22px] leading-none whitespace-nowrap text-ink">
            {text}
          </span>
        </span>
      </span>
    </span>
  );
}
