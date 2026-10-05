// Grip Prix's page: the styles, the real parts behind the screens, and the screens' controller.
import "../ui/base.css";
import "../app/settings.css";
import "./app/race.css";
import { KartApp } from "./app/app";
import { joinParam, lanAddress } from "./app/format";
import { createRealServices, type RealServicesOptions } from "./app/services.real";

/**
 * The computer's own address on the network, set when the page is served by
 * `npm run party` (vite.config.ts), so the lobby's code and link point
 * a phone at the computer rather than at "127.0.0.1", which on a phone means
 * the phone itself. Not set anywhere else.
 */
declare const __GRIP_LAN_ORIGIN__: string | undefined;
const LAN: string | undefined = typeof __GRIP_LAN_ORIGIN__ === "string" && __GRIP_LAN_ORIGIN__ ? __GRIP_LAN_ORIGIN__ : undefined;

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const options: RealServicesOptions = {};
  // Test hooks exist only outside production builds; this branch is removed
  // from a production bundle entirely.
  if (import.meta.env.MODE !== "production") {
    const hooks = await import("./app/testHooks");
    options.fail = params.get("fail");
    options.standIn = hooks.standIn(params);
  }
  const app = new KartApp(createRealServices(options), {
    // ?net=local: tabs of one browser stand in for the internet (the net layer reads it).
    net: params.get("net") === "local" ? "local" : undefined,
    // ?join=CODE (a scanned QR code): straight to joining.
    join: joinParam(location.search),
    // The link a friend scans.
    page: () => lanAddress(location.href, LAN),
  });
  if (import.meta.env.MODE !== "production") (await import("./app/testHooks")).installState(app);
  app.boot();
}

void main();
