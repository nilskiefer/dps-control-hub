// Standalone SPA build for GitHub Pages — independent of TanStack Start / Cloudflare.
// Run: `bun run build:spa` → outputs static site to `dist-spa/`.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  // "./" makes the build work at any subpath, including https://<user>.github.io/<repo>/
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  build: {
    outDir: "dist-spa",
    emptyOutDir: true,
    sourcemap: false,
  },
});
