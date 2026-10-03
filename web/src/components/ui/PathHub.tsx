import { cn } from "../../lib/styles";
import { Aurora } from "./Aurora";
import { Icon, type IconGlyph } from "./Icon";

// Where each surrounding icon sits in a 564 by 410 box and the line that reaches it from the
// centre (282, 205): straight to the sides, up or down then out with one rounded turn to the
// corners. Ordered so that three make a triangle and six fill both sides evenly.
const SLOTS = [
  { x: 160, y: 75, path: "M 262 205 V 90 Q 262 75 247 75 H 160" },
  { x: 460, y: 205, path: "M 282 205 H 460" },
  { x: 160, y: 335, path: "M 262 205 V 320 Q 262 335 247 335 H 160" },
  { x: 404, y: 75, path: "M 302 205 V 90 Q 302 75 317 75 H 404" },
  { x: 104, y: 205, path: "M 282 205 H 104" },
  { x: 404, y: 335, path: "M 302 205 V 320 Q 302 335 317 335 H 404" },
];

const tile =
  "absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center bg-panel shadow-(--surface-shadow)";

export function PathHub({ icon, around }: { icon: IconGlyph; around: IconGlyph[] }) {
  const nodes = SLOTS.flatMap((slot, k) => {
    const glyph = around[k];
    return glyph ? [{ ...slot, glyph }] : [];
  });
  return (
    <div aria-hidden className="relative aspect-564/410 w-full max-w-120">
      <Aurora className="opacity-35 mask-[radial-gradient(closest-side,black,transparent)]" />
      <svg aria-hidden className="absolute inset-0 size-full" viewBox="0 0 564 410" fill="none">
        {nodes.map(({ path }, k) => (
          <g key={path}>
            <path d={path} stroke="var(--color-rule)" />
            <path
              d={path}
              pathLength={100}
              stroke="var(--color-flux)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray="14 86"
              className="animate-travel drop-shadow-[0_0_4px_var(--color-flux-glow)] motion-reduce:hidden"
              style={{ animationDelay: `${k * -0.9}s` }}
            />
          </g>
        ))}
      </svg>
      {nodes.map(({ x, y, path, glyph }) => (
        <span
          key={path}
          className={cn(tile, "size-9 rounded-lg text-ink sm:size-12 sm:rounded-xl")}
          style={{ left: `${(x / 564) * 100}%`, top: `${(y / 410) * 100}%` }}
        >
          <Icon icon={glyph} size={24} className="size-4 sm:size-6" />
        </span>
      ))}
      <span className={cn(tile, "top-1/2 left-1/2 rounded-xl p-1 sm:rounded-2xl sm:p-1.5")}>
        <span className="absolute inset-0 animate-breathe rounded-[inherit] border-2 border-flux/40 motion-reduce:hidden" />
        <span className="grid size-9 place-items-center rounded-lg bg-ink text-paper sm:size-12 sm:rounded-xl">
          <Icon icon={icon} size={24} className="size-4 sm:size-6" />
        </span>
      </span>
    </div>
  );
}
