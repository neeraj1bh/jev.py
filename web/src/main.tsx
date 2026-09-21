import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import { readPreference, resolveTheme } from "./hooks/useTheme";
import "./index.css";

document.documentElement.dataset.theme = resolveTheme(readPreference());

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
