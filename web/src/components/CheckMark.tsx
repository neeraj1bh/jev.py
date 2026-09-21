import { Check, X } from "lucide-react";

import { Icon } from "./Icon";

export function CheckMark({ ok }: { ok: boolean }) {
  return (
    <span className="inline-flex translate-y-[2px]" role="img" aria-label={ok ? "right" : "wrong"}>
      <Icon icon={ok ? Check : X} size={14} />
    </span>
  );
}
