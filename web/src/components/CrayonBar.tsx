import { cn } from "../styles";

// One crayon per bar, from green at the best to red at the worst; plain colours, the same in
// both themes, so the fill reads as the value on either background.
const RAMP = ["#3f9b4f", "#f0b429", "#ec7a1c", "#d7392b"];
const WIDTH = 200; // the scribble's own units; the box stretches it to the cell
const STEP = 2.5; // how far the pen moves along between strokes

/** The crayon for a place between the best (0) and the worst (1), mixed between ramp stops. */
function crayon(tone: number) {
  const at = Math.min(Math.max(tone, 0), 1) * (RAMP.length - 1);
  const k = Math.min(Math.floor(at), RAMP.length - 2);
  const mix = Math.round((at - k) * 100);
  return `color-mix(in oklab, ${RAMP[k + 1]} ${mix}%, ${RAMP[k]})`;
}

/** Up-and-down pen strokes as far as `share`, each turn a little higher or lower than the last. */
function scribble(share: number) {
  const end = share * WIDTH;
  const points = ["M3 29.5"];
  for (let x = 3, k = 0; x < end - 1; x += STEP, k++) {
    // a fixed wobble, so a bar looks the same on every render while it grows
    const wobble = Math.sin(k * 2.3) * 1.2;
    points.push(
      `L${Math.min(x + STEP, end - 1).toFixed(1)} ${k % 2 ? 29.5 + wobble : 6.5 + wobble}`,
    );
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

/** A box scribbled in with one crayon as far as the amount, the number handwritten on top. */
export function CrayonBar({ share, tone, text, draw }: CrayonBarProps) {
  return (
    <span className="relative block h-9 min-w-28 overflow-hidden rounded-lg border border-rule bg-panel">
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
            strokeWidth={3.5}
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
          {/* Rubbed out behind the number, softly, so it reads over the scribble. */}
          <span className="absolute -inset-x-1 -inset-y-0.5 bg-[radial-gradient(closest-side,var(--color-panel)_40%,transparent)]" />
          <span className="relative font-hand text-[22px] leading-none whitespace-nowrap text-ink">
            {text}
          </span>
        </span>
      </span>
    </span>
  );
}
