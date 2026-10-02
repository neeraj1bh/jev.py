import { Info, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { Icon } from "./Icon";

/** One message at the bottom, as a dark capsule that grows out of a dot, with a way to close it. */
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const reduce = useReducedMotion();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-20 flex justify-center px-4">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message}
            role="alert"
            initial={reduce ? false : { opacity: 0, scale: 0.6, filter: "blur(6px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(4px)" }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="pointer-events-auto flex max-w-[560px] items-start gap-2.5 rounded-3xl bg-ink py-2.5 pr-2 pl-3.5 text-sm leading-snug text-paper shadow-(--surface-shadow)"
          >
            <Icon icon={Info} size={16} className="mt-px flex-none opacity-60" />
            <span className="min-w-0">{message}</span>
            <button
              type="button"
              aria-label="Close"
              className="-my-0.5 flex-none rounded-full border-0 bg-transparent p-1 text-paper/60 transition-colors hover:bg-paper/10 hover:text-paper"
              onClick={onClose}
            >
              <Icon icon={X} size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
