import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "@fontsource/nanum-pen-script/latin-400.css";
import { Provider as TooltipProvider } from "@radix-ui/react-tooltip";
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
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
