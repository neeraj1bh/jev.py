import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";

const saved = (() => {
  try {
    return localStorage.theme as string | undefined;
  } catch {
    return undefined;
  }
})();
document.documentElement.dataset.theme =
  saved ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
