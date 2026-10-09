// Boots the app: the styles, then the page's controller.
import "./ui/base.css";
import "./app/landing.css";
import "./app/screens.css";
import "./app/play.css";
import "./app/settings.css";
import { App, type AppOptions } from "./app/app";

async function main(): Promise<void> {
  let options: AppOptions = {};
  // Test hooks exist only outside production builds; this branch is removed
  // from a production bundle entirely.
  if (import.meta.env.MODE !== "production") {
    const hooks = await import("./app/testHooks");
    options = hooks.testOptions(new URLSearchParams(location.search));
    const app = new App(options);
    hooks.installTestHooks(app, options);
    app.boot();
    return;
  }
  new App(options).boot();
}

void main();
