import { motion } from "motion/react";

/** The tinted track of a segmented control; the chosen option wears a SegmentPill. */
export const segmentTrack = "inline-flex rounded-full bg-lift p-0.5";

/** A white pill behind the chosen option that slides to the next one picked in the same group. */
export function SegmentPill({ group }: { group: string }) {
  return (
    <motion.span
      aria-hidden
      layoutId={group}
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
      className="absolute inset-0 rounded-full bg-panel shadow-[0_1px_2px_var(--color-shadow)] ring-1 ring-rule"
    />
  );
}
