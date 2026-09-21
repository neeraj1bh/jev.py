import type { LucideIcon } from "lucide-react";

import { cn } from "../styles";

interface IconProps {
  icon: LucideIcon;
  size?: 14 | 16 | 20;
  className?: string;
}

/** One size and stroke for every icon, so they never outweigh the text beside them. */
export function Icon({ icon: Glyph, size = 16, className }: IconProps) {
  return (
    <Glyph size={size} strokeWidth={1.75} aria-hidden className={cn("flex-none", className)} />
  );
}
