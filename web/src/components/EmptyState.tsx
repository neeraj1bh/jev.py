import type { ReactNode } from "react";
import { chipButton } from "../styles";
import type { IconGlyph } from "./Icon";
import { Icon } from "./Icon";
import { PathHub } from "./PathHub";

interface EmptyStateProps {
  icon: IconGlyph;
  /** What the icon connects to, drawn around it on lines; without it the icon stands alone. */
  around?: IconGlyph[];
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}

/** What an empty list means and what to do next, instead of a blank table. */
export function EmptyState({ icon, around, title, children, action }: EmptyStateProps) {
  return (
    <div className="relative isolate flex flex-col items-center gap-2 px-6 py-10 text-center">
      {around && (
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(circle,var(--color-bar)_1px,transparent_1px)] bg-[length:24px_24px] bg-center [mask-image:radial-gradient(black_45%,transparent)]"
        />
      )}
      {around ? (
        <PathHub icon={icon} around={around} />
      ) : (
        <span className="grid size-9 place-items-center rounded-full border border-rule text-dim">
          <Icon icon={icon} size={16} />
        </span>
      )}
      <p className="m-0 text-sm font-semibold text-ink">{title}</p>
      <p className="m-0 max-w-sm text-[13px] text-dim">{children}</p>
      {action && (
        <button type="button" className={chipButton()} onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
