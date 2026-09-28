/**
 * High Noon's standalone dev harness, served by Vite at
 * /src/games/western/dev.html (not part of the production build). The
 * harness itself - its query parameters and window.__handy - is shared by
 * every game: see src/dev/harness.ts. High Noon adds ?noon=1|0 (High Noon
 * for real, or not, whatever the clock says); ?wave=N starts on that wave
 * and ?god=1 lets hits hurt but never kill. window.__handy.game.debug has
 * High Noon's own views and switches (targets(), match(), gallery()...).
 */
import { runHarness } from "../../dev/harness";
import { HIGH_NOON } from "../index";
import { createHighNoon } from "./index";
import { ALL_TIPS } from "./tips";

void runHarness({
  entry: HIGH_NOON,
  tips: ALL_TIPS,
  create: (params) => {
    const noon = params.flag("noon");
    const assetBase = params.assetBase;
    return createHighNoon({
      startWave: params.wave,
      immortal: params.god,
      ...(noon === undefined ? {} : { noon }),
      ...(assetBase === null ? {} : { assetBase }),
    });
  },
});
