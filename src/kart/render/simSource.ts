/**
 * The real sim as the dev page's race (dev.html?sim=1), for seeing what the
 * sim's items and events look like with the real numbers: eight bots on the
 * track, kart 0 the sharpest of them (so it leads), the camera on kart 0.
 *
 *   ?sim=1            the real sim instead of demo.ts
 *   ?item=storm       give this item ...
 *   ?holder=7         ... to this kart (0 by default) ...
 *   ?use=12           ... and have it used this many seconds into the race (default: 1 s after Go; a big number: never)
 *   ?drive=1          kart 0 is a person: the keyboard drives it
 *
 * Bots use items by themselves too, so a long run shows every kind.
 */
import type { DriveInput, ItemKind, RaceSetup, RaceView, RacerSetup, TrackDef } from "../contract";
import { BOT_COLOURS, IDLE_INPUT, PLAYER_COLOURS, TICK } from "../contract";
import { createSimRace, type SimRace } from "../sim/race";
import { KART_AT } from "../sim/snapshot";
import { ITEM_KINDS, ITEM_USES } from "../sim/state";
import { TrackGeometry } from "../track/geometry";
import type { DemoInput, RaceViewSource } from "./demo";

const NAMES = ["You", "Ana", "Ben", "Cleo", "Dot", "Eli", "Fay", "Gus"];
const GO_SECONDS = 3.5;

export interface SimSourceOptions {
  karts?: number;
  laps?: number;
  seed?: number;
  item?: ItemKind;
  holder?: number;
  /** Race seconds (from the green light) at which the held item is used. */
  use?: number;
  drive?: boolean;
}

export class SimSource implements RaceViewSource {
  readonly racers: RacerSetup[];
  private race!: SimRace;
  private acc = 0;
  private presses = 0;
  private used = false;
  /** Accepted so the dev page treats this like the demo; the sim always sends its boxes as things. */
  boxesAsThings = true;
  private readonly geometry: TrackGeometry;

  constructor(
    readonly track: TrackDef,
    private readonly options: SimSourceOptions = {},
  ) {
    this.geometry = TrackGeometry.build(track);
    const n = Math.max(2, Math.min(8, options.karts ?? 8));
    this.racers = Array.from({ length: n }, (_, i) => ({
      id: i,
      name: NAMES[i] ?? `Kart ${i + 1}`,
      colour: i < 4 ? PLAYER_COLOURS[i]! : BOT_COLOURS[i - 4]!,
      player: i === 0 && options.drive ? 0 : null,
      // The sharpest first, so kart 0 leads and the camera sees the race from the front.
      skill: Math.max(0.2, 1 - i * 0.08),
    }));
    this.restart();
  }

  restart(): void {
    const setup: RaceSetup = { track: this.track, laps: this.options.laps ?? this.track.laps, seed: this.options.seed ?? 5, racers: this.racers };
    this.race = createSimRace(setup);
    this.acc = 0;
    this.presses = 0;
    this.used = false;
  }

  /** Steps the race to the green light. */
  skipCountdown(): void {
    while (this.race.tick < GO_SECONDS * 60) this.race.step(new Map());
  }

  /** Puts a kart on the track at this share of the lap, this far right of the centre line, at this speed. */
  teleport(id: number, fraction: number, offset = 0, speed = 20): void {
    const s = fraction * this.geometry.length;
    const p = this.geometry.point(s, offset);
    const h = this.geometry.heading(s);
    this.patch(id, { x: p.x, z: p.z, s, offset, progress: s, heading: h, vx: Math.sin(h) * speed, vz: Math.cos(h) * speed });
  }

  private patch(id: number, values: Partial<Record<keyof typeof KART_AT, number>>): void {
    const snap = JSON.parse(JSON.stringify(this.race.snapshot())) as { k: number[][] };
    const row = snap.k[id]!;
    for (const [name, value] of Object.entries(values)) row[KART_AT[name as keyof typeof KART_AT]] = value;
    this.race.restore(snap as never);
  }

  /** Puts an item in a kart's hand and has it used on the next tick. */
  private forceUse(id: number, item: ItemKind): void {
    const snap = JSON.parse(JSON.stringify(this.race.snapshot())) as { k: number[][] };
    const row = snap.k[id]!;
    row[KART_AT.item] = ITEM_KINDS.indexOf(item);
    row[KART_AT.uses] = ITEM_USES[item] ?? 1;
    row[KART_AT.roll] = 0;
    row[KART_AT.rolled] = -1;
    if (row[KART_AT.ai] === 1) {
      row[KART_AT.presses] = row[KART_AT.botPresses]! - 1;
    } else {
      this.presses++;
      row[KART_AT.presses] = this.presses - 1;
    }
    this.race.restore(snap as never);
  }

  private give(id: number, item: ItemKind): void {
    const snap = JSON.parse(JSON.stringify(this.race.snapshot())) as { k: number[][] };
    const row = snap.k[id]!;
    row[KART_AT.item] = ITEM_KINDS.indexOf(item);
    row[KART_AT.uses] = ITEM_USES[item] ?? 1;
    row[KART_AT.roll] = 0;
    row[KART_AT.rolled] = -1;
    this.race.restore(snap as never);
  }

  step(dt: number, input: DemoInput | null): void {
    this.acc += Math.min(dt, 0.1);
    const o = this.options;
    while (this.acc >= TICK) {
      this.acc -= TICK;
      const time = this.race.tick / 60 - GO_SECONDS;
      if (o.item && !this.used && time >= ((o.use ?? 1) >= 900 ? 1 : (o.use ?? 1))) {
        this.used = true;
        const holder = o.holder ?? 0;
        if ((o.use ?? 1) < 900) this.forceUse(holder, o.item);
        else this.give(holder, o.item);
      }
      const inputs = new Map<number, DriveInput>();
      if (o.drive) {
        if (input) {
          this.presses = Math.max(this.presses, input.itemPresses);
          inputs.set(0, { steer: input.steer, throttle: input.throttle, brake: input.brake, drift: input.drift, itemPresses: this.presses });
        } else {
          inputs.set(0, { ...IDLE_INPUT, throttle: 1, itemPresses: this.presses });
        }
      }
      this.race.step(inputs);
    }
  }

  view(): RaceView {
    return this.race.view();
  }
}
