import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const originalSrc = resolve(root, "../vendor/screenshot-to-spark-0332/src");

export default defineConfig({
  root,
  base: "/para-lojas/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // Somente destinos dos botões são adaptados à aplicação hospedeira.
      { find: "@/lib/links", replacement: resolve(root, "links.ts") },
      { find: "@", replacement: originalSrc },
    ],
  },
  build: {
    outDir: resolve(root, "../dist/para-lojas"),
    emptyOutDir: true,
    target: "es2022",
  },
});
