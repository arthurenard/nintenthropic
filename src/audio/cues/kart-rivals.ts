/**
 * The Revenge sting (rivals.ts): you spun out the kart that had been after you.
 * Short and cheeky, never mean: a punchy brass pair up a fifth (G, then the D
 * above), a chime on top and a small thump under it, in G major with the rest.
 */
import type { Mono } from "../dsp/signal";
import type { Take } from "../dsp/take";
import { thump } from "./kit";
import { CHIME, GLASS, STAB, note } from "./kart-synth";

export function revenge(t: Take): Mono {
  const out = t.canvas(0.95);
  note(out, t, STAB, 0, 67, 0.12, 0.85, 0.55);
  note(out, t, STAB, 0.11, 74, 0.2, 0.95, 0.6);
  note(out, t, CHIME, 0.11, 86, 0.3, 0.8, 0.5);
  note(out, t, GLASS, 0.2, 98, 0.15, 0.6, 0.2);
  t.put(out, thump(t, 0.1, 160, 70, 0.001, 0.025), 0, 0.5);
  return out;
}
