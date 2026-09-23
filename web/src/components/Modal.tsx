import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

import { cn, inset } from "../styles";
import { type IconGlyph, IconTile } from "./Icon";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  onKeyDown?: (event: KeyboardEvent) => void;
  /** Focus the dialog itself rather than its first button, and take focus back when it is lost. */
  holdFocus?: boolean;
  /** Changes whenever the content moves on, e.g. the item index. */
  step?: unknown;
}

/** A native modal dialog: Esc or a click on the backdrop closes it. */
export function Modal({
  open,
  onClose,
  children,
  className,
  onKeyDown,
  holdFocus,
  step,
}: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      if (holdFocus) element.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open, holdFocus]);

  // A button that disables itself (Next on the last item) drops focus, and the arrow keys with it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each step on purpose
  useEffect(() => {
    const element = dialog.current;
    if (!holdFocus || !element?.open) return;
    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      (active instanceof HTMLButtonElement && active.disabled);
    if (lost) element.focus();
  }, [step, holdFocus]);

  return (
    <dialog
      ref={dialog}
      className={className}
      tabIndex={holdFocus ? -1 : undefined}
      // React passes a nested dialog's close event up to this one; only its own counts.
      onClose={(event) => event.target === dialog.current && onClose()}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

/** A round icon button for a dialog's header: previous, next, close. */
export function RoundButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-8 place-items-center rounded-full border-0 bg-panel text-dim shadow-[0_1px_2px_var(--color-shadow)] ring-1 ring-rule transition-colors hover:enabled:text-ink hover:enabled:ring-dim"
    >
      {children}
    </button>
  );
}

interface DialogFrameProps {
  title: ReactNode;
  icon?: IconGlyph;
  /** A mono pill after the title, e.g. "5 / 3,138". */
  badge?: ReactNode;
  subtitle?: ReactNode;
  /** Buttons at the top right. */
  actions?: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}

/** A dialog on the raised surface: header and footer on the tinted shell, content on the inset. */
export function DialogFrame(props: DialogFrameProps) {
  const { title, icon, badge, subtitle, actions, footer, bodyClassName, children } = props;
  return (
    <div className="flex max-h-[inherit] min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 px-3 pt-2 pb-3">
        {icon && <IconTile icon={icon} tone="ink" large />}
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
            {title}
            {badge !== undefined && (
              <span className="rounded-full bg-bar/70 px-2.5 py-0.5 font-mono text-[11px] font-medium text-dim tabular-nums">
                {badge}
              </span>
            )}
          </h2>
          {subtitle && <div className="mt-0.5 truncate text-xs text-dim">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-none items-center gap-1.5">{actions}</div>}
      </header>
      <div className={cn(inset, "min-h-0 flex-1 overflow-y-auto", bodyClassName)}>{children}</div>
      {footer && (
        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pt-2.5 pb-1 text-[11.5px] text-dim">
          {footer}
        </footer>
      )}
    </div>
  );
}
