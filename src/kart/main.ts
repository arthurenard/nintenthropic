// Grip Prix's page: the styles, the services, and the screens' controller.
import "../ui/base.css";
import "../app/settings.css";
import "./app/race.css";
import { KartApp } from "./app/app";
import { joinParam } from "./app/format";

// ──────────────────────────────────────────────────────────────────────────
// WIRING POINT: the one line that chooses what stands behind the screens.
// Today it is the stand-ins in app/fakes.ts. To go live, write a
// `createServices(): Services | Promise<Services>` that builds app/services.ts's
// `Services` from net/, input/, render/ and tracking/, and import it here
// instead of `createFakeServices`. Nothing else in the page changes.
import { createFakeServices as createServices } from "./app/fakes";
// ──────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const services = await createServices();
  new KartApp(services, {
    // ?net=local: tabs of one browser stand in for the internet (the net layer reads it).
    net: params.get("net") === "local" ? "local" : undefined,
    // ?join=CODE (a scanned QR code): straight to joining.
    join: joinParam(location.search),
  }).boot();
}

void main();
