import { Info, X } from "lucide-react";

import { Icon } from "./Icon";

/** One quiet message at the bottom: the panel's own colours, a soft shadow, and a way to close it. */
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-[560px] animate-rise items-start gap-3 rounded-lg border border-rule bg-panel py-3 pr-2 pl-3.5 text-sm leading-snug text-ink shadow-[0_12px_32px_var(--color-shadow)]"
      >
        <Icon icon={Info} size={16} className="mt-px flex-none text-dim" />
        <span className="min-w-0">{message}</span>
        <button
          type="button"
          aria-label="Close"
          className="-my-0.5 flex-none rounded-md border-0 bg-transparent p-1 text-dim transition-colors hover:bg-lift hover:text-ink"
          onClick={onClose}
        >
          <Icon icon={X} size={14} />
        </button>
      </div>
    </div>
  );
}
