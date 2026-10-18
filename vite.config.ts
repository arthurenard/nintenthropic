/// <reference types="vitest/config" />
import { defineConfig, type Plugin, type UserConfig } from "vite";
import pkg from "./package.json" with { type: "json" };

// A static site: `npm run build` writes dist/, which any static host can serve.
// `base` is relative so the same build works at a domain root or under a path
// such as GitHub Pages' /<repo>/.

/**
 * Runtime files that come from npm packages but have to be served as plain
 * files: MediaPipe's WebAssembly, which the tracker loads by URL with its own
 * loader script. They are copied from node_modules into public/ whenever Vite
 * starts, so dev and build serve exactly the installed version and nothing
 * vendored is committed (public/mediapipe ignores its contents).
 *
 * Three's Draco decoder needs no copy: since r186 DRACOLoader names its
 * decoder files with `new URL(..., import.meta.url)`, which Vite serves from
 * node_modules in dev and emits, hashed, into the build.
 */
const VENDOR = [
  {
    from: "node_modules/@mediapipe/tasks-vision/wasm",
    to: "public/mediapipe",
    // The ES-module build, which the tracker's worker loads (a module worker
    // cannot run the classic loader script), and the classic SIMD and plain
    // builds for tracking on the page itself where workers cannot do it.
    files: [
      "vision_wasm_module_internal.js",
      "vision_wasm_module_internal.wasm",
      "vision_wasm_internal.js",
      "vision_wasm_internal.wasm",
      "vision_wasm_nosimd_internal.js",
      "vision_wasm_nosimd_internal.wasm",
    ],
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

/**
 * `npm run party` (mode "party"): the game on the local network for a living
 * room. A phone's camera works only on a secure page, so it is served over
 * HTTPS with a self-signed certificate (the phone asks once whether to trust
 * it), on every address of this computer, on a port of its own so the
 * ordinary dev server can run beside it. The computer's address on the network
 * is found now and baked into the page (`__GRIP_LAN_ORIGIN__`), so the lobby's
 * code and link name the computer, never "127.0.0.1".
 */
const PARTY_PORT = 5190;

/*
 * Which of the computer's network addresses a friend's phone should be sent
 * to (`npm run party`, below). Pure: the caller hands over what
 * `os.networkInterfaces()` says, and src/kart/app/lan.test.ts checks it. It
 * lives in this file because a config that imports its own helpers by path
 * needs file extensions the type check does not accept.
 */
/** The parts of one entry of `os.networkInterfaces()` this needs. */
export interface InterfaceAddress {
  address: string;
  /** "IPv4", or 4 on newer versions of Node. */
  family: string | number;
  internal: boolean;
}

export type Interfaces = Record<string, readonly InterfaceAddress[] | undefined>;

/**
 * How likely an address is to be the Wi-Fi or Ethernet a living room shares:
 * home routers hand out 192.168.x.x, then 10.x.x.x, then 172.16-31.x.x. Link-local
 * addresses (169.254.x.x) mean no network was found, so they come last.
 */
function rank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  const second = Number(address.split(".")[1]);
  if (address.startsWith("172.") && second >= 16 && second <= 31) return 2;
  if (address.startsWith("169.254.")) return 4;
  return 3;
}

/** The best IPv4 address of this computer on a network, or null when it is on none. */
export function pickLanAddress(interfaces: Interfaces): string | null {
  const found: { address: string; rank: number; name: string }[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      const v4 = entry.family === "IPv4" || entry.family === 4;
      if (v4 && !entry.internal) found.push({ address: entry.address, rank: rank(entry.address), name });
    }
  }
  // The best rank, then the interface name (en0 before en5 before a bridge), so the choice is the same every time.
  found.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  return found[0]?.address ?? null;
}

/** "https://192.168.1.20:5190" for this address, or null. */
export function lanOrigin(interfaces: Interfaces, port: number, secure = true): string | null {
  const address = pickLanAddress(interfaces);
  return address ? `${secure ? "https" : "http"}://${address}:${port}` : null;
}


interface Network {
  networkInterfaces(): Interfaces;
}

/** Says, when the server is up, which page the TV opens and what friends will scan. */
function partyBanner(origin: string | null): Plugin {
  return {
    name: "handy:party-banner",
    configureServer(server) {
      server.httpServer?.once("listening", () => {
        const log = (text: string) => server.config.logger.info(text);
        log("");
        log("  Grip Prix party");
        log(`    On the big screen, open  https://localhost:${PARTY_PORT}/race.html  and choose Host a Race.`);
        if (origin) log(`    Friends scan the code in the lobby (it points at ${origin}/race.html).`);
        else log("    No network address was found for this computer: connect it to Wi-Fi, then start again.");
        log("    The first time, each browser asks whether to trust this computer's certificate: say yes.");
        log("");
      });
    },
  };
}

/**
 * Dev only: Grip Prix's renderer dev pages (src/kart/render/dev.html, gallery.html) sit a few folders
 * down, so the models they load by a path relative to the page (assets/kart/world-kitchen.glb) would
 * be looked for in src/kart/render/assets/ and fall back to the code-built stand-ins. Served from public/.
 */
function devPagesAssets(): Plugin {
  const prefix = "/src/kart/render/assets/";
  return {
    name: "handy:dev-pages-assets",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, _res, next) => {
        const req = request as { url?: string };
        if (req.url?.startsWith(prefix)) req.url = `/assets/${req.url.slice(prefix.length)}`;
        next();
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const party = mode === "party";
  // Where node_modules really is: a worktree links it to the main checkout's, outside the folder the dev server
  // may read from, and Three's Draco decoder was refused there (every Blender model fell back to its stand-in).
  const fs = (await import("node:fs" as string)) as { realpathSync(path: URL): string };
  const modules = fs.realpathSync(new URL("./node_modules", import.meta.url));
  let origin: string | null = null;
  const plugins: Plugin[] = [vendorFiles(), devPagesAssets()];
  if (party) {
    const os = (await import("node:os" as string)) as Network;
    origin = lanOrigin(os.networkInterfaces(), PARTY_PORT);
    const { default: basicSsl } = await import("@vitejs/plugin-basic-ssl");
    plugins.push(basicSsl(), partyBanner(origin));
  }
  return baseConfig(party, origin, plugins, modules);
});

function baseConfig(party: boolean, origin: string | null, plugins: Plugin[], modules: string): UserConfig {
  return {
    base: "./",
    plugins,
    // Each checkout pre-bundles its dependencies into its own folder. A worktree links node_modules to the main
    // checkout's, so with the default (node_modules/.vite) a worktree's dev server rewrote the main one's bundles
    // with paths counted from the worktree, and Three's Draco decoder was looked for in the wrong place: every
    // Blender model fell back to its code-built stand-in.
    cacheDir: ".vite",
    // Handy's version, for Settings' About (src/app/settings.ts); in a party, where the computer is on the network.
    define: {
      __HANDY_VERSION__: JSON.stringify(pkg.version),
      ...(party && origin ? { __GRIP_LAN_ORIGIN__: JSON.stringify(origin) } : {}),
    },
    build: {
      target: "es2022",
      sourcemap: true,
      assetsInlineLimit: 0,
      // Two pages: the arcade, and Grip Prix on its own page (src/kart/main.ts).
      rollupOptions: { input: { index: "index.html", race: "race.html" } },
    },
    // The tracking worker is an ES module: it loads MediaPipe's module build.
    worker: { format: "es" },
    // A party listens on every address of this computer, on a port it can say out loud (the page names it).
    server: {
      ...(party ? { host: true, port: PARTY_PORT, strictPort: true } : { host: "127.0.0.1", port: 5173 }),
      fs: { allow: [".", modules] },
    },
    preview: { host: "127.0.0.1", port: 4173 },
    test: { environment: "node", include: ["src/**/*.test.ts"] },
  };
}
