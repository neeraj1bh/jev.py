import type { Icon as Glyph } from "@phosphor-icons/react";

import { cn } from "../../lib/styles";

export type IconGlyph = Glyph;

interface IconProps {
  icon: Glyph;
  size?: 11 | 12 | 14 | 16 | 20 | 24;
  className?: string;
}

export function Icon({ icon: Glyph, size = 16, className }: IconProps) {
  return <Glyph size={size} weight="bold" aria-hidden className={cn("flex-none", className)} />;
}

const TONES = {
  idle: "bg-lift text-dim",
  ink: "bg-ink text-paper shadow-sm",
  good: "bg-good text-paper shadow-sm",
  warn: "bg-warn text-paper shadow-sm",
};

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
        large ? "size-7 rounded-lg" : "size-5.5 rounded-md",
        TONES[tone],
        className,
      )}
    >
      <Icon icon={icon} size={large ? 14 : 12} />
    </span>
  );
}
