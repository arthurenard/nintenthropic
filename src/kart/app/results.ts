/**
 * The results: who finished where, in what time, with their best lap, the
 * quickest lap of the race in gold. The host races again or goes back to the
 * lobby; a guest goes back to the lobby to wait for the host's next race.
 *
 * In a Grand Prix the table gains the points each place earned, and the way
 * on is the standings: the host presses Standings, or they come up by
 * themselves after a few seconds (the room does that; nobody on a sofa has to
 * touch a phone).
 *
 * Beside the table (above it on a narrow screen), the players' finish-line
 * photos: each wheel player's camera as their kart crossed the line, with their
 * place and time (finishGallery.ts).
 */
import type { GrandPrixState, LobbyState, RaceResult, RacerSetup, Session } from "../contract";
import { $, element, setText } from "../../ui/dom";
import { photoFinish, resultLine, sofaLine, type PhotoFinish } from "./eggs";
import { FinishGallery, type ShotCard } from "./finishGallery";
import { sharePhotos } from "./finishShare";
import { cupById, pointsFor } from "../grandprix";
import { lapsLabel, ordinal, raceTime } from "./format";
import { hostName, standingRows, type StandingRow } from "./roster";
import { colourDot, focusHeading } from "./ui";

export interface ResultsHooks {
  again(): void;
  lobby(): void;
  /** A Grand Prix: on to the standings. */
  next(): void;
  /** The photo finish's flash goes off (its shutter is heard). */
  photo?(): void;
}

export interface ResultsInput {
  result: RaceResult;
  lobby: LobbyState;
  session: Session;
  /** The race's grid, for names and colours (empty if never seen). */
  racers: readonly RacerSetup[];
  laps: number;
  trackName: string;
  /** The track raced (for the shared picture's backdrop). */
  trackId?: string;
  /** A picture of the finish (the race's canvas as the last close finish happened), for the photo finish, or null. */
  still?: string | null;
  /** Set in a Grand Prix: which race of which cup this was. */
  grandPrix?: GrandPrixState | null;
  /** How many times each kart was carried back to the road by the drone, as this screen saw it. */
  rescues?: ReadonlyMap<number, number>;
  /** This race's finish-line photos so far, by kart (more may come: `ResultsScreen.addPhoto`). */
  photos?: ReadonlyMap<number, string>;
  /** Other devices' wheel players' karts, whose photos may still come: with none of them and no photo, there are no cards. */
  cameras?: ReadonlySet<number>;
}

/** The photo finish stays this long, ms: a beat and a half, and then it fades. */
const PHOTO_FOR = 1750;

export class ResultsScreen {
  private photoTimer = 0;
  private readonly gallery = new FinishGallery(() => this.offerShare());
  /** The players' cards as last shown (a photo that comes later is put on its card). */
  private cards: ShotCard[] = [];
  /** What the shared picture says about the race: its track and what kind of race it was. */
  private race = { trackId: "", trackName: "", detail: "" };
  private sharing = false;

  constructor(private readonly hooks: ResultsHooks) {
    $("results-again").addEventListener("click", () => hooks.again());
    $("results-lobby").addEventListener("click", () => hooks.lobby());
    $("results-next").addEventListener("click", () => hooks.next());
    $("results-share").addEventListener("click", () => void this.share());
  }

  /** Share is offered once there is a photo to share. */
  private offerShare(): void {
    $("results-share").hidden = !this.gallery.hasPhotos;
  }

  /** The photos as one picture, to the share sheet or the Downloads: made only now, when asked. */
  private async share(): Promise<void> {
    if (this.sharing || !this.gallery.hasPhotos) return;
    this.sharing = true;
    const button = $<HTMLButtonElement>("results-share");
    button.disabled = true;
    try {
      await sharePhotos({ cards: this.gallery.pictures(), ...this.race });
    } finally {
      this.sharing = false;
      button.disabled = false;
    }
  }

  render({ result, lobby, session, racers, laps, trackName, trackId, still, grandPrix, rescues, photos, cameras }: ResultsInput): void {
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

    // Under it, a word on how it went for that one player (or, for friends on one screen, who beat whom), and who set the
    // fastest lap.
    const first = rows.find((row) => row.place === 1);
    const line = only
      ? resultLine({
          place: only.place,
          field: rows.length,
          time: only.time,
          winner: first?.name ?? "",
          winnerTime: first?.time ?? null,
          secondTime: rows.find((row) => row.place === 2)?.time ?? null,
          rescues: rescues?.get(only.kart) ?? 0,
        })
      : sofaLine([...mine].sort((a, b) => a.place - b.place).map((row) => row.name));
    const fastest = rows.find((row) => row.fastest);
    const words = [line, fastest ? `Fastest lap: ${fastest.name}, ${raceTime(fastest.bestLap)}.` : null].filter(Boolean).join(" ");
    const sub = $("results-sub");
    sub.hidden = !words;
    setText(sub, words);

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
    this.race = {
      trackId: trackId ?? "",
      trackName,
      detail: cup && grandPrix ? `${cup.name} · Race ${grandPrix.race + 1} of ${cup.tracks.length}` : lapsLabel(laps),
    };
    this.shots(rows, lobby, racers, photos ?? new Map(), cameras ?? new Set());
    focusHeading($("results-title"));
    this.photo(photoFinish(result.standings), rows, still ?? null);
  }

  /** Lets go of the photos (the room is left): none is kept on the page. */
  forgetPhotos(): void {
    this.cards = [];
    this.gallery.show([]);
  }

  /** A finish-line photo that came after the results were up (another device's, or one still being made). */
  addPhoto(kart: number, photo: string): void {
    const card = this.cards.find((candidate) => candidate.kart === kart);
    if (!card) return;
    const first = !this.cards.some((candidate) => candidate.photo);
    card.photo = photo;
    // The first photo of a race nobody expected one from brings the cards; otherwise it develops on its own.
    if (first && $("finish-photos").hidden) this.gallery.show(this.cards, this.race.trackId);
    else this.gallery.add(kart, photo);
  }

  /** The players' cards, in finishing order: their photos where there are some, their drivers' portraits where not. */
  private shots(
    rows: readonly StandingRow[],
    lobby: LobbyState,
    racers: readonly RacerSetup[],
    photos: ReadonlyMap<number, string>,
    cameras: ReadonlySet<number>,
  ): void {
    this.cards = rows
      .filter((row) => !row.bot)
      .map((row) => {
        const slot = lobby.karts[row.kart];
        const character = racers.find((racer) => racer.id === row.kart)?.character ?? lobby.players.find((player) => player.slot === slot)?.character;
        const { kart, place, placeLabel, name, colour, time } = row;
        return { kart, place, placeLabel, name, colour, time, field: rows.length, character, photo: photos.get(kart) ?? null };
      });
    const any = this.cards.some((card) => card.photo || cameras.has(card.kart));
    this.gallery.show(any ? this.cards : [], this.race.trackId);
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
    this.hooks.photo?.();
    this.photoTimer = window.setTimeout(() => (figure.hidden = true), PHOTO_FOR);
  }
}
