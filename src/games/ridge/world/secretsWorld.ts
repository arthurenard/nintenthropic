/**
 * The valley's secrets, shown: the chapel's bell swinging (and ringing,
 * heard a second and a half after the shot, when its sound has crossed the
 * valley); the goat's leap to a higher ledge; the cheese rolling down the
 * lane, bouncing, all the way to the river; the yeti ducking behind its
 * rock and its footprints in the snow leading away; the dam's siren wailing
 * up the valley; the duck bobbing; the cliff giving your shot back three
 * times. Which were found is the rules' (rules/secrets.ts).
 */
import { Box3, CircleGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3, type Object3D } from "three";
import type { Sound } from "../../../engine/world/sound";
import { Polyline } from "../rules/path";
import type { V3 } from "../rules/types";
import type { Effects } from "./effects";
import type { Heightfield } from "./heightfield";
import type { ValleySecrets } from "./valley";

const SPEED_OF_SOUND = 343;
const tmp = new Vector3();

export class SecretsWorld {
  private bellSwing = 0;
  private bellSpin = 0;
  private cheese: { line: Polyline; s: number; speed: number; bounce: number; spin: number; done: boolean } | null = null;
  private readonly cheeseHome: { parent: Object3D | null; position: Vector3; quaternion: Quaternion } | null;
  private yetiT = -1;
  private readonly yetiHome: Vector3 | null;
  private readonly prints: InstancedMesh | null;
  private printsShown = 0;
  private printsTarget = 0;
  private readonly printSpots: Vector3[] = [];

  constructor(
    private readonly s: ValleySecrets,
    private readonly effects: Effects,
    private readonly sound: Sound,
    private readonly heightfield: Heightfield,
    private readonly cheesePath: V3[],
    private readonly eye: Vector3,
  ) {
    this.cheeseHome = s.cheese ? { parent: s.cheese.parent, position: s.cheese.position.clone(), quaternion: s.cheese.quaternion.clone() } : null;
    this.yetiHome = s.yeti ? s.yeti.position.clone() : null;
    // The yeti's footprints: a line of dents in the snow leading away over the snowfield.
    if (s.yeti) {
      const base = s.yeti.getWorldPosition(new Vector3());
      // Across the snowfield and up, away from the ridge: a line seen from the side reads at any range.
      const away = new Vector3(base.x, 0, base.z).normalize();
      const step = new Vector3(-away.z, 0, away.x).multiplyScalar(0.8).addScaledVector(away, 0.6).normalize();
      for (let i = 0; i < 24; i++) {
        const side = i % 2 === 0 ? 0.5 : -0.5;
        const p = new Vector3(base.x + step.x * (i + 2) * 1.8 - step.z * side, 0, base.z + step.z * (i + 2) * 1.8 + step.x * side);
        p.y = heightfield.height(p.x, p.z) + 0.05;
        this.printSpots.push(p);
      }
      const mat = new MeshBasicMaterial({ color: "#56627c", transparent: true, opacity: 0.85, depthWrite: false, name: "footprints" });
      // A yeti's feet, big enough to read through the scope at almost two kilometres.
      const geo = new CircleGeometry(0.5, 10);
      geo.rotateX(-Math.PI / 2);
      geo.scale(1, 1, 1.6);
      this.prints = new InstancedMesh(geo, mat, this.printSpots.length);
      this.prints.count = 0;
      this.prints.frustumCulled = false;
      const m = new Matrix4();
      this.printSpots.forEach((p, i) => this.prints!.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z)));
      s.yeti.parent?.add(this.prints);
    } else {
      this.prints = null;
    }
  }

  /** Seconds until a sound from `at` reaches the player. */
  private late(at: Vector3): number {
    return at.distanceTo(this.eye) / SPEED_OF_SOUND;
  }

  /** The bell struck: it swings, and rings - heard when the sound has crossed the valley. Returns the delay. */
  bell(at: Vector3, normal: Vector3): number {
    this.bellSpin += 2.4;
    this.effects.impact("metal", at, normal, normal);
    this.sound.at("ridge_church_bell", at, 1);
    return this.late(at);
  }

  bellCentre(out: Vector3): Vector3 | null {
    // The bell's shoulder, just under the yoke it hangs from: the part the belfry's sill never hides.
    return this.s.bell ? this.s.bell.getWorldPosition(out).add(tmp.set(0, -0.25, 0)) : null;
  }

  /** The loudspeaker: a long wail up the valley. Returns when it is heard. */
  siren(): number {
    if (!this.s.siren) return 0;
    const at = this.s.siren.getWorldPosition(new Vector3());
    this.sound.at("ridge_siren", at, 1);
    return this.late(at);
  }

  /** The wedge knocked out: the cheese rolls off the cart and down the lane to the river. */
  cheeseRoll(): number {
    const c = this.s.cheese;
    if (!c || this.cheese || this.cheesePath.length < 2) return 0;
    const start = c.getWorldPosition(new Vector3());
    c.removeFromParent();
    c.position.copy(start);
    this.s.cheese!.rotation.set(Math.PI / 2, 0, 0);
    const root = this.s.yeti?.parent ?? this.s.bell?.parent ?? null;
    root?.add(c);
    this.cheese = { line: new Polyline([{ x: start.x, y: start.y, z: start.z }, ...this.cheesePath.slice(1)]), s: 0, speed: 0.5, bounce: 0, spin: 0, done: false };
    this.sound.at("ridge_cheese_roll", start, 1);
    return this.late(start);
  }

  /** The rock by the yeti struck: it ducks behind it, and footprints lead away over the snow. */
  yeti(): number {
    if (!this.s.yeti || this.yetiT >= 0) return 0;
    this.yetiT = 0;
    const at = this.s.yeti.getWorldPosition(new Vector3());
    this.sound.at("ridge_yeti", at, 1, 1, 0.4);
    this.printsTarget = this.printSpots.length;
    return this.late(at);
  }

  /** The duck bobs where it was hit. */
  duck(at: Vector3): void {
    this.effects.splash(at, 0.25);
    this.sound.at("ridge_duck_squeak", at, 1);
  }

  /**
   * The great cliff gives the shot back three times, the last like a
   * distant shot from someone else. Returns when the last is heard.
   */
  echo(): number {
    const cliff = this.s.cliff ? this.s.cliff.getWorldPosition(new Vector3()) : new Vector3(-360, 60, -960);
    const back = (2 * cliff.distanceTo(this.eye)) / SPEED_OF_SOUND;
    this.sound.play("ridge_echo", { volume: 0.9, delay: back, pan: -0.3 });
    this.sound.play("ridge_echo", { volume: 0.6, delay: back + 0.95, pan: -0.5 });
    this.sound.play("ridge_far_shot", { volume: 0.55, delay: back + 2.1, pan: -0.6, distance: 900 });
    return back + 2.3;
  }

  update(dt: number): void {
    // The bell: a heavy pendulum on its yoke.
    if (this.s.bell) {
      this.bellSpin += (-6 * this.bellSwing - 0.35 * this.bellSpin) * dt;
      this.bellSwing += this.bellSpin * dt;
      this.s.bell.rotation.x = this.bellSwing * 0.6;
    }
    // The cheese: rolling faster downhill, bouncing on the ruts, splashing into the river at the end.
    const c = this.cheese;
    if (c && !c.done && this.s.cheese) {
      c.speed = Math.min(9, c.speed + dt * 3.2);
      c.s += c.speed * dt;
      const p = c.line.pointAt(c.s, { x: 0, y: 0, z: 0 });
      c.bounce = Math.max(0, c.bounce + dt * 6 - (c.bounce > 0.5 ? 0 : 0)) % 1;
      const hop = Math.abs(Math.sin(c.s * 0.9)) * Math.min(0.6, c.speed * 0.08);
      const ground = this.heightfield.height(p.x, p.z);
      this.s.cheese.position.set(p.x, Math.max(ground, p.y) + 0.42 + hop, p.z);
      this.s.cheese.rotation.set(Math.PI / 2, 0, c.line.headingAt(c.s) + Math.PI / 2);
      c.spin += (c.speed * dt) / 0.42;
      this.s.cheese.rotateY(c.spin);
      if (c.s >= c.line.length) {
        c.done = true;
        this.effects.splash(this.s.cheese.position.clone(), 1.2);
        this.sound.at("ridge_hit_water", this.s.cheese.position, 1);
        this.s.cheese.visible = false;
      }
    }
    // The yeti ducks down and away behind the rock over half a second.
    if (this.yetiT >= 0 && this.s.yeti && this.yetiHome) {
      this.yetiT += dt;
      const k = Math.min(1, this.yetiT / 0.5);
      this.s.yeti.position.copy(this.yetiHome).add(tmp.set(-2.5 * k, -2.6 * k * k, 0));
      if (k >= 1) this.s.yeti.visible = false;
    }
    if (this.prints && this.printsShown < this.printsTarget) {
      this.printsShown = Math.min(this.printsTarget, this.printsShown + dt * 6);
      this.prints.count = Math.floor(this.printsShown);
    }
  }

  /** The valley as it was before this game's mischief. */
  reset(): void {
    this.bellSwing = 0;
    this.bellSpin = 0;
    if (this.s.cheese && this.cheeseHome) {
      this.s.cheese.removeFromParent();
      this.cheeseHome.parent?.add(this.s.cheese);
      this.s.cheese.position.copy(this.cheeseHome.position);
      this.s.cheese.quaternion.copy(this.cheeseHome.quaternion);
      this.s.cheese.visible = true;
    }
    this.cheese = null;
    if (this.s.yeti && this.yetiHome) {
      this.s.yeti.position.copy(this.yetiHome);
      this.s.yeti.visible = true;
    }
    this.yetiT = -1;
    this.printsShown = 0;
    this.printsTarget = 0;
    if (this.prints) this.prints.count = 0;
  }

  /** Points of the secrets to aim at, for the harness. */
  points(): Record<string, Vector3 | null> {
    const top = (o: Object3D | null) => {
      if (!o) return null;
      o.updateMatrixWorld(true);
      const box = new Box3().setFromObject(o);
      if (box.isEmpty()) return o.getWorldPosition(new Vector3());
      const c = box.getCenter(new Vector3());
      c.y = box.max.y - Math.min(0.5, (box.max.y - box.min.y) * 0.2);
      return c;
    };
    // The middle of what can be seen of it (a cliff's skin sits at the origin, its shape in the world).
    const w = (o: Object3D | null) => {
      if (!o) return null;
      o.updateMatrixWorld(true);
      const box = new Box3().setFromObject(o);
      return box.isEmpty() ? o.getWorldPosition(new Vector3()) : box.getCenter(new Vector3());
    };
    return {
      bell: this.bellCentre(new Vector3()),
      siren: w(this.s.siren),
      wedge: w(this.s.wedge),
      // The top of the yeti's rock: it stands on a far snowfield whose nearer ridge hides its foot.
      yetiRock: top(this.s.yetiRock),
      cliff: w(this.s.cliff),
    };
  }
}
