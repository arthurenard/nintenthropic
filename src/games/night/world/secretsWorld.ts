import { Box3, Euler, Mesh, Quaternion, ShaderMaterial, Vector3, type Material, type MeshStandardMaterial, type Object3D } from "three";
import { turnRig, type Rig, type RigPool } from "../../../engine/world/character";
import type { Sound } from "../../../engine/world/sound";
import { EAT_OUT, SIGN_LETTERS, type SignLetter } from "../rules/secrets";
import type { Effects } from "./effects";
import type { Eyeshine } from "./eyes";
import type { Flashlight } from "./flashlight";
import type { RoadLayout } from "./road";
import { eyeFrame, eyesMaterial, shineEyes, type EyeFrame } from "./rigs";
import type { Stage } from "./stage";

const tmp = new Vector3();
const tmp2 = new Vector3();
const left = new Vector3();
const right = new Vector3();
const euler = new Euler();
const quat = new Quaternion();

/** The drive-in's picture: a scratchy black-and-white shadow play of a man fleeing a shambling figure. */
const SCREEN_FRAGMENT = /* glsl */ `
uniform float uT;
uniform float uOn;
varying vec3 vLocal;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float box(vec2 p, vec2 c, vec2 s) { vec2 d = abs(p - c) - s; return step(max(d.x, d.y), 0.0); }
float figure(vec2 p, vec2 at, float stride, float stoop) {
  // A head, a body leaning with its stoop, two legs scissoring with its stride.
  float f = 0.0;
  f += step(length(p - at - vec2(stoop * 0.5, 0.36)), 0.055);
  f += box(p, at + vec2(stoop * 0.25, 0.17), vec2(0.05, 0.13));
  f += box(p, at + vec2(sin(stride) * 0.06, -0.05), vec2(0.022, 0.1));
  f += box(p, at + vec2(-sin(stride) * 0.06, -0.05), vec2(0.022, 0.1));
  f += box(p, at + vec2(stoop + 0.1, 0.22 + stoop * 0.3), vec2(0.07, 0.018));
  return min(f, 1.0);
}
void main() {
  // The screen's own frame, 0..1 across and up.
  vec2 uv = vec2(vLocal.x / 22.0 + 0.5, vLocal.y / 10.0 + 0.5);
  float frame = floor(uT * 18.0);
  // The light of the projector, flickering, with a hot middle.
  float light = 0.72 + 0.1 * hash(frame) + 0.28 * (1.0 - length(uv - 0.5) * 1.3);
  vec2 p = (uv - 0.5) * vec2(2.2, 1.0);
  float run = mod(uT * 0.32, 1.6) - 0.8;
  float man = figure(p, vec2(run * 1.3 + 0.35, -0.2), uT * 9.0, 0.05);
  float dead = figure(p, vec2(run * 1.3 - 0.25, -0.22), uT * 4.0, 0.22);
  float shade = max(man, dead);
  // Scratches and dust on the film.
  float scratch = step(0.985, hash(floor(uv.x * 140.0) + frame * 3.1)) * step(0.4, hash(frame));
  float dust = step(0.9993, hash(dot(floor(uv * 180.0), vec2(1.0, 57.0)) + frame));
  float c = light * (1.0 - 0.92 * shade) - scratch * 0.4 + dust * 0.6;
  vec3 col = vec3(c) * vec3(0.95, 0.97, 1.0) * uOn * 1.6;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * The night's secrets made visible: the neon letters sputtering out (and
 * EAT), the scarecrow turning its head to follow you and gone when shot,
 * the booth's light out and the phones ringing, the drive-in's screen
 * flickering into a shadow play, the moon's two howls, the black cat on
 * its perches, the radio's ballad, the duck. The rules (rules/secrets.ts)
 * decide when a secret is found; this only makes it happen.
 */
export class SecretsWorld {
  /** Each letter's glow: where it is heading, and where it is. */
  private readonly letterGlow = new Map<SignLetter, { now: number; to: number; sputter: number }>();
  private readonly scarecrowCenter = new Vector3();
  private scarecrowTurn = 0;
  private scarecrowFollowing = false;
  private scarecrowGoneIn = -1;
  private readonly scarecrowHeadRest = 0;
  private boothLight: ShaderMaterial | null = null;
  private screenMaterial: ShaderMaterial | null = null;
  private screenPlaying = -1;
  private screenFrom: Material | null = null;
  private duckSpin = 0;
  private readonly duckRest = new Vector3();
  private radioOn = false;
  private readonly radioAt = new Vector3();
  // The cat.
  private readonly cat: Rig | null;
  private readonly catEyes: EyeFrame | null;
  private readonly catEyesMat: MeshStandardMaterial | null;
  private catSpot = 0;
  private catState: "sit" | "hiss" | "leap" = "sit";
  private catT = 0;
  private readonly catFrom = new Vector3();
  private readonly catTo = new Vector3();
  private catShine = 0;
  private time = 0;

  constructor(
    private readonly road: RoadLayout,
    private readonly stage: Stage,
    private readonly fx: Effects,
    private readonly sound: Sound,
    private readonly flashlight: Flashlight,
    private readonly eyeshine: Eyeshine,
    catPool: RigPool,
    private readonly eye: Vector3,
  ) {
    for (const l of SIGN_LETTERS) this.letterGlow.set(l, { now: 1, to: 1, sputter: 0 });
    const s = road.secrets;
    if (s.scarecrow) new Box3().setFromObject(s.scarecrow).getCenter(this.scarecrowCenter);
    const booth = s.boothLight as Mesh | null;
    if (booth?.isMesh && (booth.material as ShaderMaterial).isShaderMaterial) this.boothLight = booth.material as ShaderMaterial;
    if (s.duck) this.duckRest.copy(s.duck.position);
    if (s.radio) new Box3().setFromObject(s.radio).getCenter(this.radioAt);
    this.cat = catPool.take();
    this.catEyes = this.cat ? eyeFrame(this.cat.model) : null;
    this.catEyesMat = this.cat ? eyesMaterial(this.cat) : null;
    if (this.catEyesMat) shineEyes(this.catEyesMat, 0);
    if (this.cat) {
      this.cat.root.visible = true;
      this.cat.play("sit", 0, true);
      this.placeCat(0);
    }
  }

  // --- the sign ---------------------------------------------------------------------

  letterOut(letter: SignLetter): void {
    const g = this.letterGlow.get(letter);
    if (!g) return;
    g.to = 0.06;
    g.sputter = 0.7;
    const node = this.road.secrets.sign.get(letter);
    if (node) this.sound.at("night_neon", node.getWorldPosition(tmp), 1);
  }

  /** EAT: the sign sputters, and a groan from the fog sounds almost like approval. */
  eat(): void {
    for (const l of SIGN_LETTERS) {
      if (EAT_OUT.includes(l)) continue;
      const g = this.letterGlow.get(l);
      if (g) g.sputter = 1.2;
    }
    this.sound.play("night_groan", { volume: 0.7, rate: 0.78, distance: 55, pan: -0.2, delay: 0.9 });
  }

  relight(letters: readonly SignLetter[]): void {
    for (const l of letters) {
      const g = this.letterGlow.get(l);
      if (!g) continue;
      g.to = 1;
      g.sputter = 0.8;
    }
  }

  // --- the scarecrow --------------------------------------------------------------------

  /** Is the beam resting on the scarecrow now? */
  scarecrowLit(): boolean {
    const s = this.road.secrets.scarecrow;
    if (!s || !s.visible) return false;
    return this.flashlight.lightAt(this.scarecrowCenter) > 0.12;
  }

  scarecrowHere(): boolean {
    return this.road.secrets.scarecrow?.visible === true && this.scarecrowGoneIn < 0;
  }

  /** It turns its head, slowly, to follow you. */
  scarecrowTurns(): void {
    this.scarecrowFollowing = true;
    this.sound.at("night_scarecrow", this.scarecrowCenter, 1);
  }

  /** Shot, it is not there any more. */
  scarecrowShot(at: Vector3): void {
    tmp2.set(0, 1, 0);
    this.fx.impact("plant", at, tmp2, 0);
    this.scarecrowGoneIn = 0.18;
  }

  // --- the booth, the drive-in, the moon ----------------------------------------------------

  /** The booth's light shot out: the phone rings three times, and the motel's rings back. */
  boothRing(): void {
    if (this.boothLight) (this.boothLight.uniforms["uGlow"] as { value: number }).value = 0.03;
    const booth = this.road.secrets.boothLight?.getWorldPosition(new Vector3()) ?? new Vector3(6.5, 2, -26.5);
    const motel = this.road.secrets.motelPhone?.getWorldPosition(new Vector3()) ?? new Vector3(14, 1, -42);
    this.fx.glass(booth, tmp.set(0, -1, 0.4).normalize(), 6, booth.y - 2.4);
    this.sound.at("night_hit_glass", booth, 1);
    for (let i = 0; i < 3; i++) this.sound.at("night_phone_ring", booth, 1, 1, 0.9 + i * 2.6);
    for (let i = 0; i < 3; i++) this.sound.at("night_phone_ring", motel, 0.9, 0.93, 0.9 + 3 * 2.6 + 1.4 + i * 2.6);
  }

  /** The projector's lamp on the hill: the screen flickers on with its shadow play, then the fog rolls back. */
  driveIn(): void {
    const screen = this.stage.screen;
    if (!screen) return;
    if (!this.screenMaterial) {
      this.screenMaterial = new ShaderMaterial({
        uniforms: { uT: { value: 0 }, uOn: { value: 0 } },
        vertexShader: "varying vec3 vLocal; void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: SCREEN_FRAGMENT,
      });
    }
    if (!this.screenFrom) this.screenFrom = screen.material as Material;
    screen.material = this.screenMaterial;
    this.screenPlaying = 0;
    const lamp = this.road.secrets.driveInLamp?.getWorldPosition(new Vector3()) ?? new Vector3(-31, 2.4, -142);
    this.sound.loopAt("projector", "night_projector", lamp, 1);
  }

  moonShot(howl: "far" | "near" | null): void {
    if (howl === "far") this.sound.play("night_howl", { volume: 0.8, pan: 0.6, distance: 420, delay: 0.6 });
    if (howl === "near") this.sound.play("night_howl", { volume: 1, pan: -0.55, distance: 45, delay: 0.9 });
  }

  // --- the cat -------------------------------------------------------------------------------

  catCenter(): Vector3 | null {
    if (!this.cat || this.catState === "leap") return null;
    return tmp.copy(this.cat.root.position).setY(this.cat.root.position.y + 0.15);
  }

  /** A shot near the cat: it hisses, then leaps to its next perch. It survives everything. */
  catStartled(): void {
    if (!this.cat || this.catState !== "sit") return;
    this.catState = "hiss";
    this.catT = 0;
    this.cat.play("hiss", 0.05, false);
    this.sound.at("night_hiss", this.cat.root.position, 1);
  }

  private placeCat(spot: number): void {
    const spots = this.road.secrets.catSpots;
    if (!this.cat || spots.length === 0) return;
    this.catSpot = spot % spots.length;
    const p = spots[this.catSpot] as Vector3;
    this.cat.root.position.copy(p);
    this.cat.root.rotation.y = Math.atan2(this.eye.x - p.x, this.eye.z - p.z) + 0.6;
  }

  // --- the radio, the duck ---------------------------------------------------------------

  radio(on: boolean): void {
    if (on === this.radioOn) return;
    this.radioOn = on;
    if (on) this.sound.loopAt("radio", "night_ballad", this.radioAt, 1);
    else this.sound.stopLoop("radio");
  }

  duckSqueak(): void {
    this.duckSpin = 1;
    const d = this.road.secrets.duck;
    if (d) this.sound.at("night_squeak", d.getWorldPosition(tmp), 1, 0.95 + Math.random() * 0.1);
  }

  // --- every frame ---------------------------------------------------------------------------

  update(dt: number, fogThin: number): void {
    this.time += dt;
    // The letters: each easing toward its glow, sputtering on the way.
    for (const [letter, g] of this.letterGlow) {
      g.now += (g.to - g.now) * Math.min(1, dt * 5);
      let k = g.now;
      if (g.sputter > 0) {
        g.sputter -= dt;
        k *= Math.sin(this.time * 83 + letter.length * 7) > 0.1 ? 1 : 0.15;
      }
      const m = this.stage.letters.get(letter);
      if (m) (m.uniforms["uGlow"] as { value: number }).value = k;
    }
    // The scarecrow's head, following you once it has turned.
    const head = this.road.secrets.scarecrowHead;
    if (head && this.scarecrowFollowing) {
      this.scarecrowTurn = Math.min(1, this.scarecrowTurn + dt / 2.2);
      const parent = head.parent as Object3D | null;
      head.getWorldPosition(tmp);
      // Toward the eye, in the head's parent's own frame.
      const parentYaw = parent ? euler.setFromQuaternion(parent.getWorldQuaternion(quat), "YXZ").y : 0;
      const want = Math.atan2(this.eye.x - tmp.x, this.eye.z - tmp.z) - parentYaw;
      const e = this.scarecrowTurn * this.scarecrowTurn * (3 - 2 * this.scarecrowTurn);
      head.rotation.y = this.scarecrowHeadRest + (want - this.scarecrowHeadRest) * e + Math.sin(this.time * 0.7) * 0.03 * e;
    }
    if (this.scarecrowGoneIn >= 0) {
      this.scarecrowGoneIn -= dt;
      if (this.scarecrowGoneIn < 0) {
        const s = this.road.secrets.scarecrow;
        if (s) s.visible = false;
        this.scarecrowGoneIn = -1;
      }
    }
    // The drive-in's reel: twelve seconds of film, then it flickers out and the fog rolls back.
    if (this.screenPlaying >= 0 && this.screenMaterial) {
      this.screenPlaying += dt;
      const t = this.screenPlaying;
      const on = t < 0.6 ? (Math.sin(t * 60) > 0 ? t / 0.6 : 0.1) : t < 12 ? 1 : Math.max(0, 1 - (t - 12) / 1.5);
      this.screenMaterial.uniforms["uT"]!.value = t;
      this.screenMaterial.uniforms["uOn"]!.value = on * Math.max(0.35, fogThin);
      if (t > 13.5) {
        this.screenPlaying = -1;
        this.sound.stopLoop("projector");
        const screen = this.stage.screen;
        if (screen && this.screenFrom) screen.material = this.screenFrom;
      }
    }
    // The duck: a spin that slows, and a bob.
    const duck = this.road.secrets.duck;
    if (duck) {
      if (this.duckSpin > 0) {
        this.duckSpin = Math.max(0, this.duckSpin - dt * 0.7);
        duck.rotation.y += this.duckSpin * this.duckSpin * 24 * dt;
      }
      duck.position.y = this.duckRest.y + Math.sin(this.time * 2.1) * 0.006 + this.duckSpin * 0.03 * Math.abs(Math.sin(this.time * 14));
    }
    this.updateCat(dt);
  }

  private updateCat(dt: number): void {
    const cat = this.cat;
    if (!cat) return;
    this.catT += dt;
    if (this.catState === "hiss" && this.catT > 0.9) {
      this.catState = "leap";
      this.catT = 0;
      this.catFrom.copy(cat.root.position);
      const spots = this.road.secrets.catSpots;
      const next = spots[(this.catSpot + 1) % Math.max(1, spots.length)];
      this.catSpot = (this.catSpot + 1) % Math.max(1, spots.length);
      this.catTo.copy(next ?? this.catFrom);
      cat.play("leap", 0.05, false);
      turnRig(cat, Math.atan2(this.catTo.x - this.catFrom.x, this.catTo.z - this.catFrom.z), 1);
    }
    if (this.catState === "leap") {
      // Out of sight between perches: a leap, then gone into the dark, then there.
      const k = Math.min(1, this.catT / 0.9);
      cat.root.position.lerpVectors(this.catFrom, this.catTo, k);
      cat.root.position.y += Math.sin(k * Math.PI) * 1.2;
      cat.root.visible = k < 0.25 || k > 0.8;
      if (k >= 1) {
        this.catState = "sit";
        cat.root.visible = true;
        this.placeCat(this.catSpot);
        cat.play("sit", 0.2, true);
      }
    }
    cat.update(dt);
    // A cat's eyes shine in the beam too.
    const head = cat.bone("head");
    let target = 0;
    if (head && this.catEyes && cat.root.visible) {
      head.updateWorldMatrix(true, false);
      left.copy(this.catEyes.left).applyMatrix4(head.matrixWorld);
      right.copy(this.catEyes.right).applyMatrix4(head.matrixWorld);
      target = Math.min(1.2, this.flashlight.lightAt(tmp.copy(left).add(right).multiplyScalar(0.5)) * 0.8);
    }
    this.catShine += (target - this.catShine) * Math.min(1, dt * 14);
    if (this.catShine > 0.02) this.eyeshine.add(left, right, this.catShine);
    if (this.catEyesMat) shineEyes(this.catEyesMat, this.catShine);
  }

  /** Everything back as it was (a new night). */
  reset(): void {
    for (const g of this.letterGlow.values()) {
      g.now = 1;
      g.to = 1;
      g.sputter = 0;
    }
    const s = this.road.secrets;
    if (s.scarecrow) s.scarecrow.visible = true;
    if (s.scarecrowHead) s.scarecrowHead.rotation.y = this.scarecrowHeadRest;
    this.scarecrowFollowing = false;
    this.scarecrowTurn = 0;
    this.scarecrowGoneIn = -1;
    if (this.boothLight) (this.boothLight.uniforms["uGlow"] as { value: number }).value = 1;
    if (this.screenPlaying >= 0) {
      this.sound.stopLoop("projector");
      const screen = this.stage.screen;
      if (screen && this.screenFrom) screen.material = this.screenFrom;
    }
    this.screenPlaying = -1;
    this.radio(false);
    this.duckSpin = 0;
    if (s.duck) s.duck.rotation.y = 0;
    if (this.cat) {
      this.catState = "sit";
      this.cat.root.visible = true;
      this.cat.play("sit", 0, true);
      this.placeCat(0);
    }
  }
}
