import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // 3000 first; when another dev server holds it, the next free port instead of failing
  server: { port: 3000, proxy: { "/v1": "http://localhost:8080" } },
  build: { outDir: "dist", emptyOutDir: true },
});
