import { CircleNotchIcon, PlayIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";

import { cn, solidButton } from "../../lib/styles";
import { Icon } from "../ui/Icon";
import { Tip } from "../ui/Tip";

interface RunButtonProps {
  busy: boolean;
  replaying: boolean;
  noModel: boolean;
  onRun: () => void;
}

export function RunButton({ busy, replaying, noModel, onRun }: RunButtonProps) {
  return (
    <Tip content={noModel ? "Pick a model first" : undefined}>
      <button
        type="button"
        className={cn(solidButton, "min-w-[104px] overflow-hidden")}
        disabled={busy || replaying || noModel}
        onClick={onRun}
      >
        {/* The label changes in place, so the button says what it is doing. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={busy ? "running" : "run"}
            className="inline-flex items-center gap-1.5"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 36 }}
          >
            <Icon
              icon={busy ? CircleNotchIcon : PlayIcon}
              size={14}
              className={busy ? "animate-spin" : undefined}
            />
            {busy ? "Running…" : "Run"}
          </motion.span>
        </AnimatePresence>
      </button>
    </Tip>
  );
}
