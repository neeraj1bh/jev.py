import { cn } from "../styles";

// One crayon per bar, from green at the best to red at the worst; plain colours, the same in
// both themes, so the fill reads as the value on either background.
const RAMP = ["#16a34a", "#eab308", "#f97316", "#dc2626"];
const WIDTH = 200; // the drawing's own units; the box stretches them to the cell
const STEP = 3; // how far the pen moves along between strokes

/** The crayon for a place between the best (0) and the worst (1), mixed between ramp stops. */
function crayon(tone: number) {
  const at = Math.min(Math.max(tone, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(at), RAMP.length - 2);
  const mix = Math.round((at - k) * 100);
  return `color-mix(in oklch, ${RAMP[k + 1]} ${mix}%, ${RAMP[k]})`;
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

/** Thick up-and-down strokes as far as `share`, each turn a little higher or lower than the last. */
function scribble(share: number) {
  const end = share * WIDTH;
  const points = ["M4 29"];
  for (let x = 4, k = 0; x < end - 2; x += STEP, k++) {
    // a fixed wobble, so a bar looks the same on every render while it grows
    const wobble = Math.sin(k * 2.3) * 1.4;
    const y = k % 2 ? 29 + wobble : 7 + wobble;
    points.push(`L${Math.min(x + STEP, end - 2).toFixed(1)} ${y.toFixed(1)}`);
  }
  return points.join(" ");
}

interface CrayonBarProps {
  /** How much of the box the scribble fills, 0 to 1. */
  share: number;
  /** Where the value sits in this run, 0 for the best and 1 for the worst. */
  tone: number;
  text: string;
  /** Draw the scribble in once, when a finished run first shows; a live one grows by itself. */
  draw: boolean;
}

/** A hatched box scribbled in with one crayon as far as the amount, the number handwritten on top. */
export function CrayonBar({ share, tone, text, draw }: CrayonBarProps) {
  return (
    <span className="relative block h-9 min-w-28 overflow-hidden border-[1.5px] border-ink/60 bg-panel">
      <svg
        aria-hidden
        className="absolute inset-0 size-full"
        viewBox={`0 0 ${WIDTH} 36`}
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
        <svg
          aria-hidden
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${WIDTH} 36`}
          preserveAspectRatio="none"
        >
          <path
            d={scribble(share)}
            pathLength={1}
            fill="none"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            className={cn(draw && "animate-draw motion-reduce:animate-none")}
            style={{ stroke: crayon(tone), strokeDasharray: 1 }}
          />
        </svg>
      )}
      <span className="absolute inset-0 grid place-items-center">
        <span className="relative px-3">
          {/* Rubbed out behind the number, softly, so it reads over the scribble and the hatching. */}
          <span className="absolute -inset-x-1 -inset-y-0.5 bg-[radial-gradient(closest-side,var(--color-panel)_40%,transparent)]" />
          <span className="relative font-hand text-[22px] leading-none whitespace-nowrap text-ink">
            {text}
          </span>
        </span>
      </span>
    </span>
  );
}
