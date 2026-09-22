import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { chipButton } from "../styles";
import { Icon } from "./Icon";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: { label: string; onClick: () => void };
}

/** What an empty list means and what to do next, instead of a blank table. */
export function EmptyState({ icon, title, children, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="grid size-9 place-items-center rounded-full border border-rule text-dim">
        <Icon icon={icon} size={16} />
      </span>
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
