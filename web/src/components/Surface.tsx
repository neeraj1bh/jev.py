import type { ReactNode } from "react";

import { cn, inset, labelText, shell } from "../styles";
import { type IconGlyph, IconTile } from "./Icon";

interface SurfaceProps {
  title?: ReactNode;
  icon?: IconGlyph;
  /** Quiet text after the title. */
  note?: ReactNode;
  /** Controls on the right of the header. */
  aside?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}

/** A card on the raised surface: the header sits on the tinted shell, the content on the inset. */
export function Surface(props: SurfaceProps) {
  const { title, icon, note, aside, className, bodyClassName, children } = props;
  return (
    <section className={cn(shell, className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 pt-2 pb-2.5">
          <h2 className="m-0 flex min-w-0 items-center gap-2 text-sm font-semibold text-ink">
            {icon && <IconTile icon={icon} />}
            <span className="min-w-0">
              {title} {note && <span className={cn(labelText, "font-normal")}>{note}</span>}
            </span>
          </h2>
          {aside}
        </div>
      )}
      <div className={cn(inset, "px-5 py-4", bodyClassName)}>{children}</div>
    </section>
  );
}
