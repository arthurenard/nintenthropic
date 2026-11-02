import { describe, expect, it } from "vitest";
import { Group, Texture } from "three";
import type { KartView } from "../contract";
import { TrackGeometry } from "../track/geometry";
import { MEADOW_LOOP } from "../track/tracks";
import { KartActor, type ActorContext, type KartPose } from "./kart";

const geo = TrackGeometry.build(MEADOW_LOOP);
const spot = geo.at(40);
const ctx: ActorContext = { track: geo, shadowTexture: new Texture(), lightTexture: new Texture(), night: false, spinInModel: true, laps: 3 };

function view(over: Partial<KartView> = {}): KartView {
  return {
    id: 0, x: spot.x, y: spot.y, z: spot.z, heading: Math.atan2(spot.tx, spot.tz), speed: 0, steer: 0, drift: 0, driftLevel: 0, boost: 0, spin: 0, hop: 0,
    offroad: false, surface: "road", trick: 0, rescue: 0, item: null, itemUses: 0, rolling: false, place: 1, lap: 1, lapProgress: 0, wrongWay: false, finished: null,
    ...over,
  };
}

/**
 * What a kart shows over `seconds` of frames at `fps`: `at(t)` says what the kart does then, `read` takes a number from the pose.
 * A twin that is calm (no wobble, no tremble) drives the same frames, and what is handed back is how far the first differs from it,
 * which is the wobble and the tremble alone, without the roll and pitch every kart has.
 */
function extra(id: number, seconds: number, fps: number, at: (t: number) => Partial<KartView>, read: (p: KartPose) => number): number[] {
  const poses: KartPose[] = [];
  const kart = (calm: boolean): KartActor => {
    const k = new KartActor(id, () => ({ root: new Group(), pose: (p: KartPose) => void (poses[poses.length] = { ...p }), dispose() {} }), { id, colour: "#ff0000" }, ctx);
    k.calm = calm;
    return k;
  };
  const out: number[] = [];
  const dt = 1 / fps;
  const [free, calm] = [kart(false), kart(true)];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    const v = view({ id, ...at(i * dt) });
    free.update(v, dt, ctx, i * dt);
    calm.update(v, dt, ctx, i * dt);
    out.push(read(poses[poses.length - 2]!) - read(poses[poses.length - 1]!));
  }
  return out;
}

const roll = (p: KartPose): number => p.roll;
const pitch = (p: KartPose): number => p.pitch;
const rms = (xs: number[]): number => Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / xs.length);

describe("the drift's wobble", () => {
  // A kart at 20 m/s that starts to drift half a second in; what is kept is the time from then on.
  const wobble = (side: 1 | -1, fps: number): number[] => extra(0, 1.5, fps, (t) => ({ speed: 20, drift: t < 0.5 ? 0 : side }), roll).slice(Math.round(0.5 * fps));

  it("rocks the body out toward the outside of the bend, then rings back and settles", () => {
    for (const fps of [60, 30]) {
      for (const side of [1, -1] as const) {
        const w = wobble(side, fps).map((x) => x * -side);
        // Out first, modestly: a peak of about 0.075 rad.
        expect(Math.max(...w)).toBeGreaterThan(0.06);
        expect(Math.max(...w)).toBeLessThan(0.09);
        expect(Math.min(...w.slice(0, 2))).toBeGreaterThan(0);
        // Then it swings back through the other side and out again, two or three times over, each smaller (the swings are the stretches
        // past a visible 0.008 rad: the first outward, then in, out, in).
        const swings: number[] = [];
        for (const x of w) {
          if (Math.abs(x) < 0.008) continue;
          if (swings.length === 0 || Math.sign(swings[swings.length - 1]!) !== Math.sign(x)) swings.push(x);
          else if (Math.abs(x) > Math.abs(swings[swings.length - 1]!)) swings[swings.length - 1] = x;
        }
        expect(swings.length - 1).toBeGreaterThanOrEqual(2);
        expect(swings.length - 1).toBeLessThanOrEqual(3);
        for (let i = 1; i < swings.length; i++) expect(Math.abs(swings[i]!)).toBeLessThan(Math.abs(swings[i - 1]!) * 0.6);
        // Still for the eye (under a third of a degree) by 0.8 s.
        expect(Math.max(...w.slice(Math.round(0.8 * fps)).map(Math.abs))).toBeLessThan(0.006);
      }
    }
  });

  it("rings the same at 30 and at 60 frames a second", () => {
    const quick = wobble(1, 60);
    const slow = wobble(1, 30);
    expect(Math.abs(Math.min(...slow) - Math.min(...quick))).toBeLessThan(0.012);
    for (let i = 3; i < slow.length - 1; i++) expect(Math.abs(slow[i]! - quick[i * 2 + 1]!)).toBeLessThan(0.012);
  });

  it("comes with every new drift, the other way round for the other side, and not for a kart that is not drifting", () => {
    const flip = extra(0, 1.5, 60, (t) => ({ speed: 20, drift: t < 0.5 ? 1 : -1 }), roll);
    expect(Math.min(...flip.slice(0, 30))).toBeLessThan(-0.06);
    expect(Math.max(...flip.slice(30, 60))).toBeGreaterThan(0.06);
    expect(rms(extra(0, 1.5, 60, () => ({ speed: 20 }), roll))).toBeLessThan(1e-9);
  });

  it("is left out for a player who asked for less motion", () => {
    // The calm kart is the twin in `extra`, so read it alone: it only rolls toward the drift (0.05), eased in, and never swings past.
    const poses: KartPose[] = [];
    const k = new KartActor(0, () => ({ root: new Group(), pose: (p: KartPose) => void (poses[poses.length] = { ...p }), dispose() {} }), { id: 0, colour: "#ff0000" }, ctx);
    k.calm = true;
    for (let i = 0; i < 60; i++) k.update(view({ speed: 20, drift: i < 12 ? 0 : 1 }), 1 / 60, ctx, i / 60);
    expect(Math.max(...poses.map((p) => Math.abs(p.roll)))).toBeLessThan(0.052);
  });
});

describe("the engine's tremble", () => {
  // A kart that has held this speed for 2 s; what is kept is the last 1.5 s.
  const tremble = (speed: number, fps: number, id = 0): number[] => extra(id, 2, fps, () => ({ speed }), pitch).slice(Math.round(0.5 * fps));

  it("shivers a kart standing on the grid by a few thousandths of a radian, at 60 and at 30 frames a second", () => {
    for (const fps of [60, 30]) {
      const t = tremble(0, fps);
      expect(Math.max(...t.map(Math.abs))).toBeGreaterThan(0.003);
      expect(Math.max(...t.map(Math.abs))).toBeLessThan(0.0055);
    }
  });

  it("fades out as the kart picks up speed, and is gone by 5 m/s", () => {
    const still = rms(tremble(0, 60));
    const slow = rms(tremble(2.5, 60));
    const nearly = rms(tremble(4.2, 60));
    expect(slow).toBeLessThan(still);
    expect(slow).toBeGreaterThan(nearly);
    expect(nearly).toBeLessThan(still * 0.1);
    expect(rms(tremble(5, 60))).toBeLessThan(1e-9);
    expect(rms(tremble(20, 60))).toBeLessThan(1e-9);
  });

  it("does not move two karts in step", () => {
    const a = tremble(0, 60, 0);
    const b = tremble(0, 60, 1);
    expect(rms(a.map((x, i) => x - b[i]!))).toBeGreaterThan(rms(a) * 0.5);
  });

  it("is a buzz that moves every frame, never a stutter, at 60 and at 30 frames a second", () => {
    for (const fps of [60, 30]) {
      const t = tremble(0, fps);
      // Frame to frame the body moves by a good share of its swing (a slow frame that skipped over the buzz would show runs of
      // frames the same, or a lurch back and forth by the whole swing), and the swing is not mostly one side.
      let steady = 0;
      let worst = 0;
      for (let i = 1; i < t.length; i++) {
        const d = Math.abs(t[i]! - t[i - 1]!);
        worst = Math.max(worst, d);
        if (d < 0.0004) steady++;
      }
      expect(worst).toBeLessThan(0.0085);
      expect(steady / t.length).toBeLessThan(0.15);
      expect(Math.abs(t.reduce((s, x) => s + x, 0) / t.length)).toBeLessThan(0.0006);
    }
  });

  it("is left out for a player who asked for less motion, and for a kart in the air or spinning", () => {
    const poses: KartPose[] = [];
    const make = (): KartActor => new KartActor(0, () => ({ root: new Group(), pose: (p: KartPose) => void (poses[poses.length] = { ...p }), dispose() {} }), { id: 0, colour: "#ff0000" }, ctx);
    const calm = make();
    calm.calm = true;
    for (let i = 0; i < 90; i++) calm.update(view(), 1 / 60, ctx, i / 60);
    const pitches = poses.map((p) => p.pitch);
    // Whatever pitch it has is steady (its slope's), with nothing riding on it.
    expect(Math.max(...pitches.slice(60)) - Math.min(...pitches.slice(60))).toBeLessThan(5e-5);
    poses.length = 0;
    const spinning = make();
    for (let i = 0; i < 90; i++) spinning.update(view({ spin: 1 }), 1 / 60, ctx, i / 60);
    const spun = poses.map((p) => p.pitch);
    expect(Math.max(...spun.slice(60)) - Math.min(...spun.slice(60))).toBeLessThan(5e-5);
  });
});
