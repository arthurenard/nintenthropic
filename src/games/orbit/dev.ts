/**
 * Orbital Decay's standalone dev harness, served by Vite at
 * /src/games/orbit/dev.html (not part of the production build). The
 * harness itself - its query parameters and window.__harness - is shared by
 * every game: see src/dev/harness.ts. ?wave=N starts on that pass and
 * ?god=1 lets strikes crack the glass but never break a pane.
 * window.__harness.game.debug has the game's own views and switches (the
 * sky at any moment, a fragment of any kind sent at a pane, the drone,
 * the Derelict, each secret) for scripted play and screenshots.
 */
import { runHarness } from "../../dev/harness";
import { ORBITAL_DECAY } from "../index";
import { createOrbitalDecay } from "./index";
import { ALL_TIPS } from "./tips";

void runHarness({
  entry: ORBITAL_DECAY,
  tips: ALL_TIPS,
  create: (params) => {
    const assetBase = params.assetBase;
    return createOrbitalDecay({
      startPass: params.wave,
      immortal: params.god,
      ...(assetBase === null ? {} : { assetBase }),
    });
  },
});
