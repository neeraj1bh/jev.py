import { useState } from "react";

import type { ConfirmRequest } from "../components/ui/ConfirmDialog";

/** The page's own confirm box; `ask` resolves true on the confirm button. */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const ask = (title: string, body: string, confirmLabel: string) =>
    new Promise<boolean>((resolve) =>
      setRequest({
        title,
        body,
        confirmLabel,
        resolve: (ok) => {
          setRequest(null);
          resolve(ok);
        },
      }),
    );

  return { request, ask };
}
