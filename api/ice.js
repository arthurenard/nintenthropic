// @ts-check
/**
 * Grip Prix's relay logins: a Vercel function. A room's devices ask here
 * (POST api/ice.json) for the ICE servers to reach each other through: STUN
 * always, and a login for Cloudflare's TURN relay when this deployment holds a
 * TURN key, so two devices that cannot reach each other directly (different
 * networks, a strict router) still meet, through the relay.
 *
 * The key (TURN_KEY_ID and TURN_KEY_API_TOKEN, set in Vercel's settings)
 * never reaches a page: each answer is a fresh login that lapses after a day.
 * Without a key, or when Cloudflare does not answer in time, the answer is
 * STUN alone, which is how rooms worked before: devices meet only where they
 * can reach each other directly.
 *
 * Only the game's own pages are answered, by their Origin (which a browser
 * sends with every POST), so another site cannot spend the relay. The path has
 * an extension (vercel.json maps it here) because arthurenard.me, which serves
 * the game under /super-claude-bros/, sends a path without one to a trailing
 * slash.
 *
 * The page's side is src/kart/net/ice.ts; ice.test.ts there holds both to it.
 * Plain JavaScript (typed by the comments, checked by `tsc`), so Vercel runs
 * it as it is: the project's TypeScript (7) has no compiler API for Vercel to
 * build a .ts function with.
 */

/** @typedef {{ urls: string | string[], username?: string, credential?: string }} IceServer */
/**
 * @typedef {object} IceAnswer
 * @property {IceServer[]} iceServers
 * @property {boolean} relay Whether a relay is among them.
 * @property {number} ttl How long the logins last, seconds.
 */
/** @typedef {{ TURN_KEY_ID?: string, TURN_KEY_API_TOKEN?: string }} IceEnv */

/** @type {IceServer[]} */
export const DIRECT_SERVERS = [{ urls: "stun:stun.cloudflare.com:3478" }, { urls: "stun:stun.l.google.com:19302" }];
/** How long a relay login lasts, seconds: longer than any evening of racing (Cloudflare allows two days). */
export const TTL = 86400;
/** STUN alone is asked again after this long, seconds, so a key set later is picked up without a reload. */
const DIRECT_TTL = 600;
const CLOUDFLARE_MS = 3000;
const ORIGINS = new Set(["https://www.arthurenard.me", "https://arthurenard.me"]);

/**
 * The game's own pages: the live site, this project's Vercel addresses, and a dev server on this computer.
 * @param {string | null} origin
 */
export function allowed(origin) {
  if (!origin) return false;
  if (ORIGINS.has(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol === "https:" && url.hostname.endsWith(".vercel.app") && url.hostname.startsWith("super-claude-bros")) return true;
  return url.hostname === "localhost" || url.hostname === "127.0.0.1";
}

/**
 * Browsers block port 53, so a server there only costs a timeout.
 * @param {string} url
 */
const blocked = (url) => /:53(\?|$)/.test(url);

/**
 * Cloudflare's servers, less the ones a browser cannot use; null if the answer is not what Cloudflare documents.
 * @param {unknown} body
 * @returns {IceServer[] | null}
 */
export function usable(body) {
  const list = /** @type {{ iceServers?: unknown } | null} */ (body)?.iceServers;
  if (!Array.isArray(list)) return null;
  /** @type {IceServer[]} */
  const out = [];
  for (const entry of list) {
    const e = /** @type {Partial<IceServer> | null} */ (entry);
    /** @type {unknown[]} */
    const given = typeof e?.urls === "string" ? [e.urls] : Array.isArray(e?.urls) ? e.urls : [];
    const urls = given.filter(/** @returns {u is string} */ (u) => typeof u === "string" && /^(stun|turns?):/.test(u) && !blocked(u));
    if (urls.length === 0) continue;
    /** @type {IceServer} */
    const server = { urls };
    if (typeof e?.username === "string") server.username = e.username;
    if (typeof e?.credential === "string") server.credential = e.credential;
    out.push(server);
  }
  return out.some((s) => [s.urls].flat().some((u) => u.startsWith("turn"))) ? out : null;
}

/**
 * @param {number} status
 * @param {unknown} body
 */
const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** @returns {IceAnswer} */
const direct = () => ({ iceServers: DIRECT_SERVERS, relay: false, ttl: DIRECT_TTL });

/**
 * @param {Request} request
 * @param {IceEnv} env
 * @param {typeof fetch} [fetcher]
 * @returns {Promise<Response>}
 */
export async function answer(request, env, fetcher = fetch) {
  if (request.method !== "POST") return json(405, direct());
  if (!allowed(request.headers.get("origin"))) return json(403, direct());
  const id = env.TURN_KEY_ID?.trim();
  const token = env.TURN_KEY_API_TOKEN?.trim();
  if (!id || !token) return json(200, direct());
  try {
    const reply = await fetcher(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ ttl: TTL }),
      signal: AbortSignal.timeout(CLOUDFLARE_MS),
    });
    const servers = reply.ok ? usable(await reply.json()) : null;
    if (servers) {
      /** @type {IceAnswer} */
      const relayed = { iceServers: servers, relay: true, ttl: TTL };
      return json(200, relayed);
    }
  } catch {
    /* Cloudflare is slow or down: STUN alone still connects most rooms on one network */
  }
  return json(200, direct());
}

/**
 * Vercel's environment, without asking for Node's types (the root tsconfig has the page's).
 * @returns {IceEnv}
 */
const envOf = () => /** @type {{ process?: { env?: IceEnv } }} */ (globalThis).process?.env ?? {};

export default {
  /** @param {Request} request */
  fetch: (request) => answer(request, envOf()),
};
