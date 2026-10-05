/**
 * The results: who finished where, in what time, with their best lap, the
 * quickest lap of the race in gold. The host races again or goes back to the
 * lobby; a guest goes back to the lobby to wait for the host's next race.
 */
import type { LobbyState, RaceResult, RacerSetup, Session } from "../contract";
import { $, element, setText } from "../../ui/dom";
import { lapsLabel, ordinal, raceTime } from "./format";
import { hostName, standingRows } from "./roster";
import { colourDot, focusHeading } from "./ui";

export interface ResultsHooks {
  again(): void;
  lobby(): void;
}

export interface ResultsInput {
  result: RaceResult;
  lobby: LobbyState;
  session: Session;
  /** The race's grid, for names and colours (empty if never seen). */
  racers: readonly RacerSetup[];
  laps: number;
  trackName: string;
}

export class ResultsScreen {
  constructor(hooks: ResultsHooks) {
    $("results-again").addEventListener("click", () => hooks.again());
    $("results-lobby").addEventListener("click", () => hooks.lobby());
  }

  render({ result, lobby, session, racers, laps, trackName }: ResultsInput): void {
    const rows = standingRows(result, racers, lobby, session.device);
    const mine = rows.filter((row) => row.mine);
    setText("results-eyebrow", `${trackName} · ${lapsLabel(laps)}`);
    // One of us on this screen: say how it went. Two on a camera, or none shown: just the results.
    const only = mine.length === 1 ? mine[0]! : null;
    setText("results-title", only ? (only.place === 1 ? "You Won" : `${ordinal(only.place)} Place`) : "Results");

    const fastest = rows.find((row) => row.fastest);
    const sub = $("results-sub");
    sub.hidden = !fastest;
    if (fastest) setText(sub, `Fastest lap: ${fastest.name}, ${raceTime(fastest.bestLap)}.`);

    $("standings-body").replaceChildren(
      ...rows.map((row) => {
        const tr = element("tr", row.mine ? "mine" : undefined);
        const place = element("td", "c-place", row.placeLabel);
        const name = element("td", "c-name");
        name.append(colourDot(row.colour), element("span", "c-driver", row.name));
        if (row.mine) name.append(element("span", "player-tag", "You"));
        const time = element("td", "c-time", raceTime(row.time));
        const best = element("td", row.fastest ? "c-best gold" : "c-best", raceTime(row.bestLap));
        tr.append(place, name, time, best);
        return tr;
      }),
    );

    // The host decides what happens next.
    const host = session.role !== "guest";
    $("results-again").hidden = !host;
    const back = $("results-lobby");
    back.classList.toggle("primary", !host);
    back.classList.toggle("secondary", host);
    const wait = $("results-wait");
    wait.hidden = host;
    if (!host) setText(wait, `${hostName(lobby)} can start another race from the lobby.`);
    focusHeading($("results-title"));
  }
}
