import { type ReactNode, useEffect, useRef } from "react";

import { cn } from "../styles";

const arrow =
  "after:ml-1 after:size-1.5 after:-translate-y-0.5 after:rotate-45 after:border-r-[1.5px] after:border-b-[1.5px] after:content-['']";

interface DropdownProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  button: ReactNode;
  children: ReactNode;
  title?: string;
  active?: boolean;
  compact?: boolean;
  buttonClassName?: string;
  menuClassName?: string;
}

export function Dropdown({
  open,
  onOpenChange,
  button,
  children,
  title,
  active,
  compact,
  buttonClassName,
  menuClassName,
}: DropdownProps) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    // Deferred so the click that opened the menu does not close it.
    const timer = setTimeout(() => document.addEventListener("click", onClick));
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={root} className="relative min-w-0">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => onOpenChange(!open)}
        className={cn(
          "inline-flex items-center gap-[9px] rounded-full border",
          arrow,
          compact ? "px-3 py-1 text-[13.5px]" : "px-3.5 py-1.5 text-sm",
          active
            ? "border-ink bg-ink text-paper after:border-paper"
            : cn(
                "border-rule after:border-dim hover:border-dim",
                compact ? "bg-transparent text-dim" : "bg-paper text-ink",
              ),
          buttonClassName,
        )}
      >
        {button}
      </button>
      {open && (
        <div
          role="listbox"
          className={cn(
            "absolute top-[calc(100%+6px)] left-0 z-10 max-h-[70vh] w-[320px] max-w-[calc(100vw-32px)] overflow-x-hidden overflow-y-auto rounded-lg border border-rule bg-panel p-1.5 shadow-[0_10px_28px_var(--color-shadow)] flex flex-col gap-0.5 animate-fade",
            menuClassName,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuHeading({ children }: { children: ReactNode }) {
  return <h3 className="mx-2 mt-2.5 mb-0.5 text-xs font-medium text-dim first:mt-1">{children}</h3>;
}

interface MenuItemProps {
  label: ReactNode;
  detail: ReactNode;
  onSelect: () => void;
  selected?: boolean;
  disabled?: boolean;
  highlightDetail?: boolean;
  title?: string;
}

export function MenuItem({
  label,
  detail,
  onSelect,
  selected,
  disabled,
  highlightDetail,
  title,
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={!!selected}
      disabled={disabled}
      title={title}
      onClick={onSelect}
      className="flex w-full items-baseline justify-between gap-3 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-sm text-ink transition-colors duration-150 hover:enabled:bg-code disabled:text-dim disabled:opacity-100 aria-selected:bg-code"
    >
      <span>{label}</span>
      <span className={cn("text-xs whitespace-nowrap", highlightDetail ? "text-good" : "text-dim")}>
        {detail}
      </span>
    </button>
  );
}

export function MenuHint({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div className="mx-2 -mt-0.5 mb-1.5 text-xs whitespace-nowrap text-dim" title={title}>
      {children}
    </div>
  );
}
