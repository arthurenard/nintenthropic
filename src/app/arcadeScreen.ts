/**
 * The arcade drawn for the game chosen: its card marked in the row, its name,
 * words and poster in the hero, and under them Play (or Coming Soon, for a
 * game still to come), how the player plays and the switch to the other way,
 * Adjust Aim for a hand with a saved aim, and the best to beat. The privacy
 * sheet, opened from here, is told which games read an eye.
 */
import type { Difficulty, GameEntry, InputKind } from "../engine/types";
import { ARCADE, playable } from "../games/index";
import { $, icon, setText } from "../ui/dom";
import { formatScore } from "../ui/format";
import { touchOnly } from "../ui/touch";
import type { HeroArt, Shelf } from "./arcade";
import { controlClass, hasSavedAim, readBest } from "./prefs";
import { difficultyLabel } from "./results";

/** What the arcade says around the game chosen. */
export interface ArcadeState {
  /** How the player plays now. */
  control: InputKind;
  /** A game is getting ready: Play waits for it. */
  busy: boolean;
  /** A scripted hand plays (dev and test builds): there is no other way to switch to. */
  scripted: boolean;
  /** The difficulty chosen in Settings: the best shown is the one at it. */
  difficulty: Difficulty;
}

export function drawArcade(entry: GameEntry, shelf: Shelf, hero: HeroArt, state: ArcadeState): void {
  sayWhoReadsTheEye();
  shelf.show(entry);
  setText("feature-title", entry.title);
  setText("feature-about", entry.about ?? entry.blurb);
  // The game's poster, full-bleed; its light stands in until it loads, or while there is none.
  hero.show(entry);
  // A game still to come is named and described, and cannot be played.
  const here = playable(entry);
  $("feature-actions").hidden = !here;
  $("start-control").hidden = !here;
  $("feature-soon").hidden = here;
  const label = $("control-label");
  const hand = state.control === "hand";
  label.replaceChildren(icon(hand ? "hand" : "mouse"), hand ? "Finger Pistol" : state.control === "touch" ? "Touch" : "Mouse or Trackpad");
  setText("switch-control", hand ? (touchOnly() ? "Use Touch" : "Use Mouse or Trackpad") : "Use Finger Pistol");
  $("switch-control").hidden = state.scripted;
  $("adjust").hidden = !(here && hand && hasSavedAim());
  $<HTMLButtonElement>("play").disabled = state.busy;
  showBest(entry, state);
}

/** The privacy sheet names the games that read an eye (for the scope), and says nothing of it when none does. */
function sayWhoReadsTheEye(): void {
  const names = ARCADE.filter((game) => game.uses?.eye).map((game) => game.title);
  const line = $("privacy-eye");
  line.hidden = names.length === 0;
  if (!names.length) return;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  setText(
    line,
    `In ${list} it also reads whether one of your eyes is closed, for the scope: only that, only in ${names.length > 1 ? "those games" : "that game"}, and in Settings’ Eye Test when you start it. Nothing leaves this computer.`,
  );
}

/** The best to beat with this control at this difficulty, under the Play button; nothing before there is one. */
function showBest(entry: GameEntry, { control, difficulty }: ArcadeState): void {
  const best = playable(entry) ? readBest(entry.id, difficulty, controlClass(control)) : null;
  const line = $("home-best");
  line.hidden = !best;
  if (!best) return;
  const level = difficultyLabel(difficulty);
  setText(line, `${level ? `Your best on ${level}` : "Your best"}: ${formatScore(best.score)}${best.outcome ? ` · ${best.outcome}` : ""}`);
}
