/**
 * Dead of Night's standalone dev harness, served by Vite at
 * /src/games/night/dev.html (not part of the production build). The harness
 * itself - its query parameters and window.__harness - is shared by every
 * game: see src/dev/harness.ts. Dead of Night adds ?quiet=1 (the wave's own
 * dead stay in the fog, for staging screenshots with debug.send); ?wave=N
 * starts on that wave and ?god=1 lets the dead hurt but never kill.
 * window.__harness.game.debug has the night's own views and switches
 * (targets(), secrets(), send(kind, lane, along), match()...).
 */
import { runHarness } from "../../dev/harness";
import { DEAD_OF_NIGHT } from "../index";
import { createDeadOfNight } from "./index";
import { ALL_TIPS } from "./tips";

void runHarness({
  entry: DEAD_OF_NIGHT,
  tips: ALL_TIPS,
  create: (params) => {
    const assetBase = params.assetBase;
    return createDeadOfNight({
      startWave: params.wave,
      immortal: params.god,
      quiet: params.flag("quiet") === true,
      ...(assetBase === null ? {} : { assetBase }),
    });
  },
});
