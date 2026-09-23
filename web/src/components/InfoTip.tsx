import { Info } from "@phosphor-icons/react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

import { Icon } from "./Icon";
import { tipBox } from "./Tip";

interface InfoTipProps {
  children: ReactNode;
  label?: string;
}

/** A small "i" that explains a term in plain words on hover or focus. */
export function InfoTip({ children, label = "What this means" }: InfoTipProps) {
  return (
    <Tooltip.Root delayDuration={120}>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-grid size-5 place-items-center rounded-full border-0 bg-transparent p-0 align-middle text-dim transition-colors hover:text-ink"
        >
          <Icon icon={Info} size={14} />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className={tipBox}>
          {children}
          <Tooltip.Arrow className="fill-panel" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
