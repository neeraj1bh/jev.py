import { Check, X } from "@phosphor-icons/react";

import { Icon } from "./Icon";

export function CheckMark({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block align-[-0.15em] [&>svg]:block"
      role="img"
      aria-label={ok ? "right" : "wrong"}
    >
      <Icon icon={ok ? Check : X} size={14} />
    </span>
  );
}
