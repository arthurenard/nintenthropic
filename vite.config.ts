/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// A static site: `npm run build` writes dist/, which any static host can serve.
// `base` is relative so the same build works at a domain root or under a path
// such as GitHub Pages' /<repo>/.
export default defineConfig({
  base: "./",
  build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0 },
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
