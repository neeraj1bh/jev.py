import { useCallback, useRef, useState } from "react";

const TOAST_MS = 10_000;

export function useToast() {
  const [message, setMessage] = useState("");
  const timer = useRef(0);

  const show = useCallback((text: string) => {
    setMessage(text);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(""), TOAST_MS);
  }, []);

  const hide = useCallback(() => setMessage(""), []);

  return { message, show, hide };
}
