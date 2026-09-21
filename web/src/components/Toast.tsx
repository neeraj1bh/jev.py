export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="fixed bottom-6 left-1/2 z-20 flex max-w-[min(560px,calc(100vw-32px))] -translate-x-1/2 items-start gap-3.5 rounded-md border border-l-[3px] border-warn bg-panel py-3 pr-3.5 pl-4 text-sm text-ink shadow-[0_10px_28px_var(--color-shadow)]"
    >
      <span>{message}</span>
      <button
        type="button"
        aria-label="Close"
        className="flex-none border-0 bg-transparent px-0.5 text-lg leading-none text-dim"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
