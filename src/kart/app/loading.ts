/**
 * The loading screen: while a race's world is built, the track's postcard
 * fills the window (blurred and darkened, so the words keep their contrast),
 * with the track's name big, its cup (and, in a Grand Prix, which race of the
 * cup this is), a progress bar, and a tip for whatever this player drives
 * with (hands, keys or a pad) that changes every few seconds. The race screen asks for it and tells it how far the
 * world has got; this knows nothing of the race.
 */
import type { DriverControl, GrandPrixState, LobbySettings } from "../contract";
import { $, element, icon, setText } from "../../ui/dom";
import { cupById, trackOfRace } from "../grandprix";
import { trackById } from "../track/tracks";
import { tipsFor } from "./eggs";
import { lapsLabel } from "./format";
import { cupOfTrack, outlinePicture, postcardUrl } from "./trackArt";
import { calm, setBar } from "./ui";

/** What the screen says about the race being loaded. */
export interface RaceWords {
  trackId: string;
  trackName: string;
  /** "Acorn Cup · Race 2 of 4", or "Acorn Cup · 3 laps". */
  eyebrow: string;
}

/** The track and the cup, and where in the cup, from the room's settings and its Grand Prix (if one is under way). */
export function raceWords(settings: Pick<LobbySettings, "track" | "laps" | "mirror">, grandPrix: Pick<GrandPrixState, "cup" | "race"> | null | undefined): RaceWords {
  const trackId = trackOfRace(settings, grandPrix);
  const track = trackById(trackId);
  const mirror = settings.mirror ? " · Mirror" : "";
  if (grandPrix) {
    const cup = cupById(grandPrix.cup);
    return { trackId, trackName: track.name, eyebrow: `${cup.name} · Race ${grandPrix.race + 1} of ${cup.tracks.length}${mirror}` };
  }
  const where = cupOfTrack(trackId);
  return { trackId, trackName: track.name, eyebrow: `${where?.cup ?? "Secret Track"} · ${lapsLabel(settings.laps)}${mirror}` };
}

/** How long each tip stays, ms. */
const TIP_FOR = 3400;

export class LoadingScreen {
  private timer = 0;
  private tips: string[] = [];
  private at = 0;
  private shown = "";

  /** Shows the race being loaded, with tips for whoever is holding these controls. */
  begin(words: RaceWords, kind: DriverControl["kind"] | null): void {
    setText("loading-cup", words.eyebrow);
    setText("loading-track", words.trackName);
    const art = $("loading-art");
    // The track's own picture first, so the screen is never bare; the postcard fades in over it.
    const outline = $("loading-outline");
    outline.replaceChildren(outlinePicture(trackById(words.trackId)));
    const image = $<HTMLImageElement>("loading-postcard");
    if (this.shown !== words.trackId) {
      this.shown = words.trackId;
      image.hidden = true;
      image.classList.remove("ready");
      image.onload = () => {
        image.hidden = false;
        requestAnimationFrame(() => image.classList.add("ready"));
      };
      image.onerror = () => {
        image.hidden = true;
      };
      image.src = postcardUrl(words.trackId);
    }
    art.dataset.theme = trackById(words.trackId).theme;
    this.tips = tipsFor(kind);
    this.at = Math.floor(Math.random() * this.tips.length);
    this.tip(true);
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tip(false), TIP_FOR);
  }

  /** How far the world has got (and whether the screen is still up). */
  progress(on: boolean, fraction: number): void {
    $("race-loading").hidden = !on;
    setBar($("race-loading-bar"), fraction);
    const percent = Math.round(fraction * 100);
    setText("race-loading-title", percent > 0 && on ? `Getting ready… ${percent}%` : "Getting ready…");
    if (!on) window.clearInterval(this.timer);
  }

  /** The race screen is going: no more tips. */
  end(): void {
    window.clearInterval(this.timer);
  }

  private tip(first: boolean): void {
    const line = $("loading-tip");
    const next = this.tips[this.at % this.tips.length] ?? "";
    this.at++;
    const set = () => {
      line.replaceChildren(icon("hand"), element("span", undefined, next));
      line.classList.remove("out");
    };
    if (first || calm()) {
      set();
      return;
    }
    line.classList.add("out");
    window.setTimeout(set, 260);
  }
}
