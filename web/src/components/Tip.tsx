import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

export const tipBox =
  "z-30 max-w-[300px] animate-fade rounded-md border border-rule bg-panel px-3 py-2 text-[13px] leading-[1.45] font-normal text-ink shadow-[0_10px_28px_var(--color-shadow)]";

interface TipProps {
  content?: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
}

/** The page's own tooltip on any element, in place of the browser's; no content, no tooltip. */
export function Tip({ content, children, side }: TipProps) {
  if (!content) return children;
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side={side} sideOffset={6} collisionPadding={12} className={tipBox}>
          {content}
          <Tooltip.Arrow className="fill-panel" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
