import { useEffect, useState } from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const darkQuery = () => matchMedia("(prefers-color-scheme: dark)");

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be blocked; fall back to the device setting.
  }
  return "system";
}

export const resolveTheme = (preference: ThemePreference) =>
  preference === "system" ? (darkQuery().matches ? "dark" : "light") : preference;

/** Light, dark, or the device's setting, kept in sync when the device switches. */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);

  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(preference);
    };
    apply();
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // The choice still applies for this visit.
    }
    if (preference !== "system") return;
    const query = darkQuery();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [preference]);

  return { preference, setPreference };
}
