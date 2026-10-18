/**
 * Overwatch Ridge's standalone dev harness, served by Vite at
 * /src/games/ridge/dev.html (not part of the production build). The harness
 * itself - its query parameters and window.__harness - is shared by every
 * game: see src/dev/harness.ts. ?wave=N starts on stage N, ?god=1 lets hits
 * hurt but never kill, ?difficulty=relaxed shows the holdover dot, ?assist=0
 * turns Aim Assist off (the marks over the men go); Shift or the right
 * button looks through the scope. window.__harness.game.debug has
 * the game's own views and switches (targets(), aimFor(id), mission()...).
 */
import { runHarness } from "../../dev/harness";
import { OVERWATCH_RIDGE } from "../index";
import { createOverwatchRidge } from "./index";
import { ALL_TIPS } from "./tips";

void runHarness({
  entry: OVERWATCH_RIDGE,
  tips: ALL_TIPS,
  create: (params) => {
    const assetBase = params.assetBase;
    return createOverwatchRidge({
      startStage: params.wave,
      immortal: params.god,
      ...(assetBase === null ? {} : { assetBase }),
    });
  },
});
