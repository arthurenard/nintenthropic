/**
 * What ended the run, said the way you would point it out, and the one
 * thing that would help most next time (the results card's note). And the
 * words for the fall's title card.
 *
 * A place is a phrase with its preposition, as the valley's plan names it:
 * "in the chapel tower", "at the checkpoint", "on the far ledge".
 */
import type { Ending, HostileRole } from "./types";

/** The results card's outcome, in a few words: "Spotted on Stage 4". */
export function endingOutcome(ending: Ending | null, stage: number): string {
  if (!ending) return `Stage ${stage}`;
  switch (ending.kind) {
    case "fell":
      return `Spotted on Stage ${stage}`;
    case "convoy":
      return `Convoy Crossed on Stage ${stage}`;
    case "officer":
      return `Officer Escaped on Stage ${stage}`;
  }
}

/** Who it was, as the note names him. */
function who(by: HostileRole): string {
  switch (by) {
    case "sniper":
      return "The counter-sniper";
    case "gunner":
      return "A machine-gunner";
    case "mortar":
      return "A mortar";
    default:
      return "A rifleman";
  }
}

const at = (place: string) => (place ? ` ${place}` : "");

/** The note under the outcome: what did it, and what would help. */
export function endingNote(ending: Ending): string {
  switch (ending.kind) {
    case "convoy":
      return "The convoy crossed the bridge. The driver is the quick stop; the engine takes three.";
    case "officer":
      return "The officer reached the tunnel. At 900 m the wind matters: aim into it.";
    case "fell":
      switch (ending.by) {
        case "sniper":
          return `${who(ending.by)}${at(ending.place)}. His scope glints before he fires. Find it first.`;
        case "gunner":
          return `${who(ending.by)}${at(ending.place)}. Gunners only open up once the valley is alerted, so work quietly.`;
        case "mortar":
          return `${who(ending.by)}${at(ending.place)}. Mortars only fire on alert, so keep the valley quiet.`;
        default:
          return `${who(ending.by)}${at(ending.place)}. Keep the valley quiet and nobody looks up at the ridge.`;
      }
  }
}

/** The fall's title card, in the results' own words: "Spotted on Stage 4", and what did it under it. */
export function fallCard(ending: Ending, stage: number): { title: string; line: string } {
  const title = endingOutcome(ending, stage);
  switch (ending.kind) {
    case "convoy":
      return { title, line: "The lead truck is over the bridge." };
    case "officer":
      return { title, line: "He reached the tunnel." };
    case "fell":
      return { title, line: `${who(ending.by)}${at(ending.place)}.` };
  }
}
