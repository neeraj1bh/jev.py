import type { Icon as Glyph } from "@phosphor-icons/react";

import { cn } from "../../lib/styles";

export type IconGlyph = Glyph;

interface IconProps {
  icon: Glyph;
  size?: 11 | 12 | 14 | 16 | 20 | 24;
  className?: string;
}

/** Phosphor at its bold weight, the way the reference interfaces draw theirs: small and solid. */
export function Icon({ icon: Glyph, size = 16, className }: IconProps) {
  return <Glyph size={size} weight="bold" aria-hidden className={cn("flex-none", className)} />;
}

const TONES = {
  idle: "bg-lift text-dim",
  ink: "bg-ink text-paper shadow-sm",
  good: "bg-good text-paper shadow-sm",
  warn: "bg-warn text-paper shadow-sm",
};

/** An icon on a small rounded tile: tinted while idle, filled once it is the chosen or live one. */
export function IconTile({
  icon,
  tone = "idle",
  large,
  className,
}: {
  icon: Glyph;
  tone?: keyof typeof TONES;
  large?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid flex-none place-items-center transition-colors duration-200",
        large ? "size-7 rounded-lg" : "size-[22px] rounded-md",
        TONES[tone],
        className,
      )}
    >
      <Icon icon={icon} size={large ? 14 : 12} />
    </span>
  );
}
