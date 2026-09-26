import type { V3 } from "./raymath";
import { copy, lerp, smooth } from "./bandit";
import { range, type Random } from "./rng";
import { HANDS_UP_TIME, TOWNSFOLK_OUT, TOWNSFOLK_PEEK } from "./tuning";
import type { Cover, TownsfolkRole, TownsfolkState } from "./types";

export interface TownsfolkEvents {
  townsfolkAppear(p: Townsperson): void;
  townsfolkHide(p: Townsperson): void;
  townsfolkGone(p: Townsperson): void;
}

/**
 * An innocent of Dust Creek who comes to a door or window to see what the
 * noise is — the barber, a woman on the hotel balcony, the bartender, the
 * undertaker, and (if you ring for him) the preacher. No gun, pale clothes,
 * and hands up whenever bullets fly.
 */
export class Townsperson {
  state: TownsfolkState = "hidden";
  t = 0;
  dur = 0;
  readonly pos: V3 = { x: 0, y: 0, z: 0 };
  exposure = 0;
  visible = false;
  handsUpUntil = -1;
  shot = false;

  constructor(
    readonly id: number,
    readonly role: TownsfolkRole,
    readonly cover: Cover,
    /** How long they stay out once they have come to look. */
    private readonly stay: number,
  ) {
    copy(this.pos, cover.hidden);
  }

  static create(id: number, role: TownsfolkRole, cover: Cover, random: Random): Townsperson {
    const p = new Townsperson(id, role, cover, range(random, TOWNSFOLK_OUT[0], TOWNSFOLK_OUT[1]));
    p.enter("hidden", range(random, 0.2, 0.5));
    return p;
  }

  get shootable(): boolean {
    return this.visible && this.state !== "gone";
  }

  handsUp(now: number): boolean {
    return now < this.handsUpUntil;
  }

  bulletsFly(now: number): void {
    if (this.visible) this.handsUpUntil = now + HANDS_UP_TIME;
  }

  private enter(state: TownsfolkState, dur: number): void {
    this.state = state;
    this.t = 0;
    this.dur = dur;
  }

  hit(): void {
    this.shot = true;
    this.enter("hurt", 0.7);
  }

  /** Send them back inside early (the wave ended). */
  dismiss(events: TownsfolkEvents): void {
    if (this.state === "peeking" || this.state === "out") {
      this.enter("leaving", TOWNSFOLK_PEEK);
      events.townsfolkHide(this);
    } else if (this.state === "hidden") {
      this.state = "gone";
      events.townsfolkGone(this);
    }
  }

  step(dt: number, events: TownsfolkEvents): void {
    if (this.state === "gone") return;
    this.t += dt;
    switch (this.state) {
      case "hidden":
        if (this.t >= this.dur) {
          this.enter("peeking", TOWNSFOLK_PEEK);
          // Seen from the threshold on, as a bandit is (see Cover.ready).
          copy(this.pos, this.cover.ready ?? this.cover.hidden);
          this.visible = true;
          events.townsfolkAppear(this);
        }
        break;
      case "peeking": {
        const p = Math.min(1, this.t / this.dur);
        this.exposure = p;
        lerp(this.pos, this.cover.ready ?? this.cover.hidden, this.cover.exposed, smooth(p));
        if (p >= 1) this.enter("out", this.stay);
        break;
      }
      case "out":
        if (this.t >= this.dur) {
          this.enter("leaving", TOWNSFOLK_PEEK);
          events.townsfolkHide(this);
        }
        break;
      case "hurt":
        if (this.t >= this.dur) {
          this.enter("leaving", TOWNSFOLK_PEEK);
          events.townsfolkHide(this);
        }
        break;
      case "leaving": {
        const p = Math.min(1, this.t / this.dur);
        this.exposure = 1 - p;
        lerp(this.pos, this.cover.exposed, this.cover.ready ?? this.cover.hidden, smooth(p));
        if (p >= 1) {
          copy(this.pos, this.cover.hidden);
          this.visible = false;
          this.state = "gone";
          events.townsfolkGone(this);
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Who lives behind a cover, going by its name; anyone else is a passer-by. */
export function roleForCover(cover: Cover, random: Random): TownsfolkRole {
  const id = cover.id.toLowerCase();
  if (id.includes("barber")) return "barber";
  if (id.includes("hotel")) return "woman";
  if (id.includes("saloon")) return "bartender";
  if (id.includes("undertaker") || id.includes("coffin")) return "undertaker";
  const roles: TownsfolkRole[] = ["barber", "woman", "bartender", "undertaker"];
  return roles[Math.min(roles.length - 1, Math.floor(random() * roles.length))] as TownsfolkRole;
}
