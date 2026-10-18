/**
 * What every shooter tells the HUD the same way: an award's words, a popup
 * over a point of the world, a round's bonuses, the golden weapon's arrival,
 * the streak's readout, the hint line when its words change, and the hurt as
 * the picture, the HUD and the sound show it.
 */
import { Vector3, type Camera } from "three";
import type { HintLine } from "./rules/hints";
import type { HudSink, Readout } from "./types";
import type { Schedule } from "./round";
import type { Sound } from "./world/sound";

/** A popup's colour: plain, gold for something special, red for a mistake. */
export type PopupTone = "" | "gold" | "danger";

/** An award as its popup says it: "+1,250 Headshot · Long Shot", "−200 Townsperson". */
export function awardText(award: { points: number; labels: readonly string[] }): string {
  const sign = award.points >= 0 ? "+" : "−";
  const label = award.labels.length ? ` ${award.labels.join(" · ")}` : "";
  return `${sign}${Math.abs(award.points).toLocaleString("en-US")}${label}`;
}

const ndc = new Vector3();

/** Where a point of the world is in the view, in viewport fractions (0,0 top-left), or null if it is behind the eye. */
export function viewportOf(camera: Camera, at: Vector3): { x: number; y: number } | null {
  ndc.copy(at).project(camera);
  if (ndc.z > 1) return null;
  return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2 };
}

/** A popup over a point of the world, kept clear of the view's edges; none for a point behind the eye. */
export function popupAt(hud: HudSink, camera: Camera, at: Vector3, text: string, tone: PopupTone = ""): void {
  const p = viewportOf(camera, at);
  if (!p) return;
  hud.popup(Math.min(0.94, Math.max(0.06, p.x)), Math.min(0.9, Math.max(0.1, p.y)), text, tone);
}

/**
 * A round's bonuses, one line after another in the middle of the view as its
 * card comes: the accuracy first ("+400 Accuracy 80%"), then each bonus the
 * round earned (`[points, name, tone]`), in the order given.
 */
export function showBonuses(
  hud: HudSink,
  schedule: Schedule,
  round: { accuracy: number; accuracyPoints: number },
  bonuses: readonly (readonly [points: number, name: string, tone: "" | "gold"])[],
): void {
  const lines: [string, "" | "gold"][] = [];
  if (round.accuracyPoints > 0) lines.push([`+${round.accuracyPoints} Accuracy ${Math.round(round.accuracy * 100)}%`, ""]);
  for (const [points, name, tone] of bonuses) if (points > 0) lines.push([`+${points} ${name}`, tone]);
  lines.forEach(([text, tone], i) => schedule.later(0.35 + i * 0.45, () => hud.popup(0.5, 0.56 + i * 0.05, text, tone)));
}

/** The golden weapon at the start of a round: the corner's weapon gilded, its flourish (`cue`), and its name over the view. */
export function announceGolden(hud: HudSink, sound: Pick<Sound, "play">, schedule: Schedule, cue: string, name: string): void {
  hud.weaponFinish?.("gold");
  sound.play(cue, { volume: 0.8, delay: 0.4 });
  schedule.later(1.0, () => hud.popup(0.5, 0.62, name, "gold"));
}

/** The streak's readout in the corner panel: its multiplier, a meter full at ×4, and a warning colour there. */
export function streakReadout(multiplier: number): Readout {
  return { label: "Streak", value: `×${multiplier}`, meter: (multiplier - 1) / 3, tone: multiplier >= 4 ? "warning" : "" };
}

/** The hint line as the HUD shows it: told only when its words change. */
export class HintShown {
  private text: string | null = null;

  /** Tell the HUD what `line` shows now, unless it shows that already. */
  tell(hud: HudSink, line: HintLine): void {
    const text = line.text;
    if (text === this.text) return;
    this.text = text;
    hud.hint(text);
  }
}

/**
 * The player's hurt as the game shows it. The picture reacts at once to a
 * hit and recovers with the regeneration; with Reduce Flashing the red and
 * the grey close in over a quarter of a second instead, so a hit never
 * darkens the whole view in one frame. The HUD's health and the sound's
 * hurt filter (and with it the heartbeat) follow once it has moved enough to
 * notice.
 */
export class HurtShown {
  /** The hurt as drawn now, 0..1: a game sets it back to 0 for a fresh start (a new round, a breather). */
  value = 0;
  private told = -1;
  private filtered = -1;

  /** Ease toward the player's hurt now (PlayerHealth.hurt) over `dt` seconds; returns the hurt to draw. */
  ease(hurt: number, dt: number, reducedFlashing: boolean): number {
    const shown = this.value;
    if (hurt <= shown) this.value = shown + (hurt - shown) * Math.min(1, dt * 4);
    else this.value = reducedFlashing ? shown + (hurt - shown) * Math.min(1, dt * 10) : hurt;
    return this.value;
  }

  /** Tell the HUD's health and the sound's hurt filter, if the hurt has moved enough since they were last told. */
  tell(hud: HudSink, sound: Pick<Sound, "filter">): void {
    const h = this.value;
    if (Math.abs(h - this.told) > 0.01) {
      this.told = h;
      hud.health(h);
    }
    if (Math.abs(h - this.filtered) > 0.02) {
      this.filtered = h;
      sound.filter("hurt", h);
    }
  }

  /** A new round's HUD: its health is told afresh on the next frame. */
  retell(): void {
    this.told = -1;
  }
}
