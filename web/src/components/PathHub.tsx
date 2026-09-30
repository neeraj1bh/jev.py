import { cn } from "../styles";
import { Aurora } from "./Aurora";
import { Icon, type IconGlyph } from "./Icon";

// Where each surrounding icon sits in a 320 by 160 box and the line that reaches it from the
// centre, ordered so that any count stays balanced around the middle.
const SLOTS = [
  { x: 72, y: 28, path: "M 152 80 V 38 Q 152 28 142 28 H 72" },
  { x: 284, y: 80, path: "M 160 80 H 284" },
  { x: 72, y: 132, path: "M 152 80 V 122 Q 152 132 142 132 H 72" },
  { x: 248, y: 28, path: "M 168 80 V 38 Q 168 28 178 28 H 248" },
  { x: 36, y: 80, path: "M 160 80 H 36" },
  { x: 248, y: 132, path: "M 168 80 V 122 Q 168 132 178 132 H 248" },
];

const tile =
  "absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center bg-panel shadow-(--surface-shadow)";

/** An icon joined by lines to what surrounds it, over a dotted ground, a blue pulse running out
 * along each line; the pulses stop for people who turn motion off. */
export function PathHub({ icon, around }: { icon: IconGlyph; around: IconGlyph[] }) {
  const nodes = SLOTS.flatMap((slot, k) => {
    const glyph = around[k];
    return glyph ? [{ ...slot, glyph }] : [];
  });
  return (
    <div aria-hidden className="relative aspect-2/1 w-full max-w-80">
      <Aurora className="opacity-25 [mask-image:radial-gradient(closest-side,black,transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle,var(--color-bar)_1px,transparent_1px)] bg-[length:16px_16px] [mask-image:radial-gradient(closest-side,black_45%,transparent)]" />
      <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 320 160" fill="none">
        {nodes.map(({ path }, k) => (
          <g key={path}>
            <path d={path} stroke="var(--color-rule)" />
            <path
              d={path}
              pathLength={100}
              stroke="var(--color-flux)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="16 84"
              className="animate-travel drop-shadow-[0_0_3px_var(--color-flux-glow)] motion-reduce:hidden"
              style={{ animationDelay: `${k * -0.7}s` }}
            />
          </g>
        ))}
      </svg>
      {nodes.map(({ x, y, path, glyph }) => (
        <span
          key={path}
          className={cn(tile, "size-9 rounded-lg text-dim")}
          style={{ left: `${x / 3.2}%`, top: `${y / 1.6}%` }}
        >
          <Icon icon={glyph} size={16} />
        </span>
      ))}
      <span className={cn(tile, "top-1/2 left-1/2 size-11 rounded-xl text-ink")}>
        <Icon icon={icon} size={20} />
      </span>
    </div>
  );
}
