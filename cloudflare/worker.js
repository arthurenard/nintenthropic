// @ts-check
/**
 * The site on Cloudflare: a Worker in front of the built game (dist/, served
 * by Cloudflare as static files, free and without a bandwidth cap). Cloudflare
 * runs this script only for /api/ (wrangler.jsonc's `run_worker_first`), so
 * every other request is a plain file and never counts as a Worker request.
 *
 * The one route is Grip Prix's relay logins, the same function Vercel runs
 * (api/ice.js): on Cloudflare the TURN key comes as the Worker's secrets,
 * TURN_KEY_ID and TURN_KEY_API_TOKEN, in `env`.
 *
 * Lives outside api/, which Vercel would deploy as a function of its own.
 */
import { answer } from "../api/ice.js";

/**
 * @typedef {import("../api/ice.js").IceEnv & { ASSETS: { fetch: (request: Request) => Promise<Response> } }} WorkerEnv
 */

export default {
  /**
   * @param {Request} request
   * @param {WorkerEnv} env
   */
  fetch(request, env) {
    if (new URL(request.url).pathname === "/api/ice.json") return answer(request, env);
    return env.ASSETS.fetch(request);
  },
};
