import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

const PREFIX = "jev-demo:";

function read<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** useState that survives a reload; a stored value that no longer fits is ignored. */
export function usePersistentState<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(() => read(key, fallback, isValid));

  useEffect(() => {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      // Storage can be full or blocked; the value still holds for this visit.
    }
  }, [key, value]);

  return [value, setValue];
}

export const isString = (value: unknown): value is string => typeof value === "string";
