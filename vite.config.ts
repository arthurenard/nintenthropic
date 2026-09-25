/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";

// A static site: `npm run build` writes dist/, which any static host can serve.
// `base` is relative so the same build works at a domain root or under a path
// such as GitHub Pages' /<repo>/.

/**
 * Runtime files that come from npm packages but have to be served as plain
 * files: MediaPipe's WebAssembly (the tracker loads it by URL, with its own
 * loader script) and three's Draco decoder (DRACOLoader starts it in a worker
 * from a URL). They are copied from node_modules into public/ whenever Vite
 * starts, so dev and build serve exactly the installed versions and nothing
 * vendored is committed (public/mediapipe and public/draco ignore their
 * contents).
 */
const VENDOR = [
  {
    from: "node_modules/@mediapipe/tasks-vision/wasm",
    to: "public/mediapipe",
    // The SIMD build every current browser runs, and the plain one for the
    // few that cannot; the tracker picks between them at run time.
    files: [
      "vision_wasm_internal.js",
      "vision_wasm_internal.wasm",
      "vision_wasm_nosimd_internal.js",
      "vision_wasm_nosimd_internal.wasm",
    ],
  },
  {
    from: "node_modules/three/examples/jsm/libs/draco/gltf",
    to: "public/draco",
    // The glTF-only decoder: a third smaller than the general one.
    files: ["draco_decoder.js", "draco_decoder.wasm", "draco_wasm_wrapper.js"],
  },
];

/** The handful of node:fs calls the copy needs; imported at run time so the
 * browser-facing type check does not need Node's type definitions. */
interface FileSystem {
  mkdirSync(path: string, options: { recursive: true }): void;
  copyFileSync(from: string, to: string): void;
  statSync(path: string, options: { throwIfNoEntry: false }): { size: number; mtimeMs: number } | undefined;
}

function vendorFiles(): Plugin {
  return {
    name: "handy:vendor-files",
    async configResolved(config) {
      const fs = (await import("node:fs" as string)) as FileSystem;
      for (const { from, to, files } of VENDOR) {
        fs.mkdirSync(`${config.root}/${to}`, { recursive: true });
        for (const file of files) {
          const source = `${config.root}/${from}/${file}`;
          const target = `${config.root}/${to}/${file}`;
          const have = fs.statSync(target, { throwIfNoEntry: false });
          const want = fs.statSync(source, { throwIfNoEntry: false });
          if (!want) throw new Error(`${source} is missing: run npm ci`);
          // Copied again only when the package changed underneath it.
          if (!have || have.size !== want.size || have.mtimeMs < want.mtimeMs) {
            fs.copyFileSync(source, target);
          }
        }
      }
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [vendorFiles()],
  build: { target: "es2022", sourcemap: true, assetsInlineLimit: 0 },
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4173 },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
