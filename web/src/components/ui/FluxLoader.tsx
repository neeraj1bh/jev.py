import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { FluxBar } from "./FluxBar";

const EASE = [0.22, 1, 0.36, 1] as const;
const text =
  "absolute inset-0 flex items-center justify-center text-center text-2xl font-semibold tracking-tight text-dim sm:text-3xl";

interface FluxLoaderProps {
  /** The step being waited on, in a word or two. */
  label: string;
  /** How far along, 0 to 1, when that is known. */
  share?: number;
}

/** What the page is waiting on: the step's name flies in from the back, letter by letter, over a
 * glowing bar that fills when the amount is known and sweeps when it is not. The name is plain
 * text for people who turn motion off. */
export function FluxLoader({ label, share }: FluxLoaderProps) {
  const still = useReducedMotion();
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6 px-2 pt-10 pb-6">
      <div aria-hidden className="relative h-12 w-full select-none perspective-[1000px]">
        {still ? (
          <div className={text}>{label}</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={label}
              className={text}
              style={{ transformStyle: "preserve-3d" }}
              initial={{ opacity: 0, z: -380, scale: 0.65, filter: "blur(14px)" }}
              animate={{
                opacity: [0, 1, 1, 1],
                z: [-380, 60, -8, 0],
                scale: [0.65, 1.08, 0.985, 1],
                filter: ["blur(14px)", "blur(0px)", "blur(0px)", "blur(0px)"],
              }}
              exit={{
                opacity: 0,
                z: 220,
                scale: 1.35,
                filter: "blur(10px)",
                transition: { duration: 0.45, ease: [0.7, 0, 0.84, 0] },
              }}
              transition={{ duration: 0.9, ease: EASE }}
            >
              <span className="inline-flex">
                {[...label].map((letter, index) => (
                  <motion.span
                    // biome-ignore lint/suspicious/noArrayIndexKey: letters of one label never reorder
                    key={index}
                    className="inline-block whitespace-pre"
                    initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.45, ease: EASE, delay: 0.18 + index * 0.035 }}
                  >
                    {letter}
                  </motion.span>
                ))}
              </span>
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <FluxBar share={share} label={label} className="h-5 w-full" />
    </div>
  );
}
