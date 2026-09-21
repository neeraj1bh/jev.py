import { useEffect, useState } from "react";

export function useTheme() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.theme = theme;
    } catch {
      // Storage can be blocked; the theme still applies for this visit.
    }
  }, [theme]);

  return { theme, toggle: () => setTheme((current) => (current === "dark" ? "light" : "dark")) };
}
