/**
 * The results: who finished where, in what time, with their best lap, the
 * quickest lap of the race in gold. The host races again or goes back to the
 * lobby; a guest goes back to the lobby to wait for the host's next race.
 *
 * In a Grand Prix the table gains the points each place earned, and the way
 * on is the standings: the host presses Standings, or they come up by
 * themselves after a few seconds (the room does that; nobody on a sofa has to
 * touch a phone).
 */
import type { GrandPrixState, LobbyState, RaceResult, RacerSetup, Session } from "../contract";
import { $, element, setText } from "../../ui/dom";
import { photoFinish, type PhotoFinish } from "./eggs";
import { cupById, pointsFor } from "../grandprix";
import { lapsLabel, ordinal, raceTime } from "./format";
import { hostName, standingRows, type StandingRow } from "./roster";
import { colourDot, focusHeading } from "./ui";

export interface ResultsHooks {
  again(): void;
  lobby(): void;
  /** A Grand Prix: on to the standings. */
  next(): void;
}

export interface ResultsInput {
  result: RaceResult;
  lobby: LobbyState;
  session: Session;
  /** The race's grid, for names and colours (empty if never seen). */
  racers: readonly RacerSetup[];
  laps: number;
  trackName: string;
  /** A picture of the finish (the race's canvas as the closest one happened), for the photo finish, or null. */
  still?: string | null;
  /** Set in a Grand Prix: which race of which cup this was. */
  grandPrix?: GrandPrixState | null;
}

/** The photo finish stays this long, ms: a beat and a half, and then it fades. */
const PHOTO_FOR = 1750;

export class ResultsScreen {
  private photoTimer = 0;

  constructor(hooks: ResultsHooks) {
    $("results-again").addEventListener("click", () => hooks.again());
    $("results-lobby").addEventListener("click", () => hooks.lobby());
    $("results-next").addEventListener("click", () => hooks.next());
  }

  render({ result, lobby, session, racers, laps, trackName, still, grandPrix }: ResultsInput): void {
    const rows = standingRows(result, racers, lobby, session.device);
    const mine = rows.filter((row) => row.mine);
    const cup = grandPrix ? cupById(grandPrix.cup) : null;
    setText(
      "results-eyebrow",
      cup && grandPrix ? `${cup.name} · Race ${grandPrix.race + 1} of ${cup.tracks.length} · ${trackName} · ${lapsLabel(laps)}` : `${trackName} · ${lapsLabel(laps)}`,
    );
    // One of us on this screen: say how it went. Two on a camera, or none shown: just the results.
    const only = mine.length === 1 ? mine[0]! : null;
    setText("results-title", only ? (only.place === 1 ? "You Won" : `${ordinal(only.place)} Place`) : "Results");
    // The title wears the medal's colour when it is a podium place.
    const title = $("results-title");
    if (only && only.place <= 3) title.dataset.place = String(only.place);
    else delete title.dataset.place;

    const fastest = rows.find((row) => row.fastest);
    const sub = $("results-sub");
    sub.hidden = !fastest;
    if (fastest) setText(sub, `Fastest lap: ${fastest.name}, ${raceTime(fastest.bestLap)}.`);

    $("th-points").hidden = !grandPrix;
    $("standings-body").replaceChildren(
      ...rows.map((row, index) => {
        const tr = element("tr", row.mine ? "mine" : undefined);
        // The last place comes up first and the winner last; each row is in its player's colour.
        tr.style.setProperty("--r", String(rows.length - 1 - index));
        tr.style.setProperty("--colour", row.colour);
        tr.dataset.place = String(row.place);
        const place = element("td", "c-place");
        place.append(element("span", "medal", row.placeLabel));
        const name = element("td", "c-name");
        name.append(colourDot(row.colour), element("span", "c-driver", row.name));
        if (row.mine) name.append(element("span", "player-tag", "You"));
        const time = element("td", "c-time", raceTime(row.time));
        const best = element("td", row.fastest ? "c-best gold" : "c-best", raceTime(row.bestLap));
        tr.append(place, name, time, best);
        if (grandPrix) tr.append(element("td", "c-points", `+${pointsFor(row.place)}`));
        return tr;
      }),
    );

    // The host decides what happens next.
    const host = session.role !== "guest";
    $("results-again").hidden = !host || !!grandPrix;
    $("results-next").hidden = !host || !grandPrix;
    const back = $("results-lobby");
    // A guest in a cup has nowhere to go until it ends: the standings come up by themselves.
    back.hidden = !host && !!grandPrix;
    setText(back, grandPrix && host ? "End Grand Prix" : "Back to Lobby");
    back.classList.toggle("primary", !host && !grandPrix);
    back.classList.toggle("secondary", host || !!grandPrix);
    const wait = $("results-wait");
    wait.hidden = host && !grandPrix;
    if (grandPrix) setText(wait, "The standings come up in a moment.");
    else if (!host) setText(wait, `${hostName(lobby)} can start another race from the lobby.`);
    focusHeading($("results-title"));
    this.photo(photoFinish(result.standings), rows, still ?? null);
  }

  /** Two karts over the line together for a top-three place: a flash, the still, "Photo Finish!", and then the results. */
  private photo(finish: PhotoFinish | null, rows: readonly StandingRow[], still: string | null): void {
    const figure = $("photo-finish");
    const image = $<HTMLImageElement>("photo-finish-still");
    window.clearTimeout(this.photoTimer);
    figure.hidden = true;
    if (!finish) return;
    const name = (kart: number) => rows.find((row) => row.kart === kart)?.name ?? "";
    const by = finish.gap < 0.005 ? "by a hair" : `by ${finish.gap.toFixed(2)} s`;
    setText("photo-finish-words", `${name(finish.ahead)} edges out ${name(finish.behind)} ${by}.`);
    if (still) image.src = still;
    else image.removeAttribute("src");
    image.hidden = !still;
    void figure.offsetWidth; // restart its animation
    figure.hidden = false;
    this.photoTimer = window.setTimeout(() => (figure.hidden = true), PHOTO_FOR);
  }
}
