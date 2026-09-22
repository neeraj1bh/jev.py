import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

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
