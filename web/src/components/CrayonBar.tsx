import { cn } from "../styles";

// One crayon per bar, from green at the best to red at the worst; plain colours, the same in
// both themes, so the fill reads as the value on either background.
const RAMP = ["#16a34a", "#eab308", "#f97316", "#dc2626"];

/** The crayon for a place between the best (0) and the worst (1), mixed between ramp stops. */
function crayon(tone: number) {
  const at = Math.min(Math.max(tone, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(at), RAMP.length - 2);
  const mix = Math.round((at - k) * 100);
  return `color-mix(in oklch, ${RAMP[k + 1]} ${mix}%, ${RAMP[k]})`;
}

/** Pen strokes leaning across the whole box, each a little off in lean, length, start and bow, as
 * a quick hand hatches; fixed offsets, so the box looks the same on every render. */
const HATCH = Array.from({ length: 64 }, (_, k) => {
  const x = k * 3.4 - 6;
  const lean = 8 + Math.sin(k * 1.7) * 2;
  const top = 4 + Math.abs(Math.sin(k * 2.9)) * 4;
  const bottom = 32 - Math.abs(Math.sin(k * 1.3)) * 4;
  const bow = Math.sin(k * 0.9) * 1.6;
  const midX = x + lean / 2 + bow;
  const midY = (top + bottom) / 2;
  return `M${x.toFixed(1)} ${bottom.toFixed(1)} Q${midX.toFixed(1)} ${midY.toFixed(1)} ${(x + lean).toFixed(1)} ${top.toFixed(1)}`;
}).join(" ");

// The fill's front edge leans the same way as the hatching.
const SLANT = "polygon(0 0, 100% 0, calc(100% - 8px) 100%, 0 100%)";

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
    <span className="relative block h-9 min-w-28 overflow-hidden border-2 border-ink/60 bg-panel">
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
          strokeOpacity={0.4}
          strokeWidth={1.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {share > 0 && (
        <span
          className={cn(
            "absolute inset-y-1 left-1 block min-w-3 origin-left transition-[width] duration-300",
            draw && "animate-fill motion-reduce:animate-none",
          )}
          style={{
            width: `calc(${share} * (100% - 0.5rem))`,
            background: crayon(tone),
            clipPath: SLANT,
          }}
        />
      )}
      <span className="absolute inset-0 grid place-items-center font-hand text-[22px] leading-none whitespace-nowrap text-ink">
        {text}
      </span>
    </span>
  );
}
