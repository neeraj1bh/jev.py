import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 3000, strictPort: true, proxy: { "/v1": "http://localhost:8080" } },
  build: { outDir: "dist", emptyOutDir: true },
});
