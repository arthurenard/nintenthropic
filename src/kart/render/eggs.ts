/**
 * The picture's side of Grip Prix's small delights, behind one door so the
 * renderer needs only a few lines for all of them:
 *
 *   - a `horn` puts a "Honk!" bubble over the kart in every viewport that sees it (the duck quacks, the robot beeps)
 *   - a `duck` sends the world's rubber duck off for a day (landmarks/duckFlight.ts)
 *   - a player's win on the Fun Fair sets off fireworks over the finish line
 */
import type { Group, PerspectiveCamera } from "three";
import type { KartView, RaceEvent, RacerSetup } from "../contract";
import type { TrackGeometry, TrackTheme } from "../track/geometry";
import { Bubbles } from "./bubbles";
import type { Species } from "./drivers";
import { Fireworks } from "./fireworks";
import { shownSpecies } from "./kartModel";
import type { Rect } from "./layout";
import { flyDuck, resetDuck } from "./world/landmarks/duckFlight";

/** What a driver's horn says: Dabble quacks, Rivet beeps, everyone else honks. */
export function honkWord(species: Species): string {
  return species === "duck" ? "Quack!" : species === "robot" ? "Beep." : "Honk!";
}

export class RenderEggs {
  readonly bubbles: Bubbles;
  readonly fireworks = new Fireworks();
  private theme: TrackTheme | null = null;
  private line: { x: number; y: number; z: number; heading: number } | null = null;

  constructor(root: HTMLElement, parent: Group, calm: boolean) {
    this.bubbles = new Bubbles(root);
    parent.add(this.fireworks.group);
    this.setCalm(calm);
  }

  setCalm(calm: boolean): void {
    this.bubbles.calm = calm;
    this.fireworks.calm = calm;
  }

  /** A track has been built: where its finish line is, and what world it is. */
  load(theme: TrackTheme, geometry: TrackGeometry): void {
    this.theme = theme;
    const at = geometry.point(0, 0);
    this.line = { x: at.x, y: at.y, z: at.z, heading: geometry.heading(0) };
    this.reset();
  }

  /** A new race. */
  reset(): void {
    this.bubbles.clear();
    this.fireworks.clear();
    resetDuck();
  }

  setViews(count: number): void {
    this.bubbles.setViews(count);
  }

  /** `time` is the renderer's clock, the one the world's landmarks are animated on. */
  onEvent(e: RaceEvent, racers: readonly RacerSetup[], time: number): void {
    switch (e.type) {
      case "horn":
        // The bubble speaks for whoever is in the kart (the one the picture shows, for a racer who chose nobody).
        this.bubbles.say(e.kart, honkWord(shownSpecies(racers.find((r) => r.id === e.kart) ?? { id: e.kart })), time);
        break;
      case "duck":
        flyDuck(time);
        break;
      case "finish":
        if (e.place === 1 && this.theme === "funfair" && this.line && racers.find((r) => r.id === e.kart)?.player != null) this.fireworks.start(this.line, this.line.heading, e.tick + 1);
        break;
    }
  }

  update(dt: number): void {
    this.fireworks.update(dt);
  }

  /** After viewport `index` has been drawn from `eye`. */
  view(index: number, rect: Rect, eye: PerspectiveCamera, kartAt: (id: number) => KartView | undefined, time: number): void {
    this.bubbles.place(index, rect, eye, kartAt, time);
  }

  /** After every viewport. */
  end(time: number): void {
    this.bubbles.end(time);
  }

  dispose(): void {
    this.bubbles.dispose();
    this.fireworks.clear();
    this.fireworks.group.removeFromParent();
    this.fireworks.dispose();
  }
}
