/**
 * Item boxes: glassy rainbow cubes that turn and bob above the road, a bright
 * question mark on every face (and its mirror image through the glass), a
 * glowing gem inside and a pool of coloured light beneath. All slots are drawn
 * as instances (a handful of draw calls for any number of boxes).
 *
 * Driving through one shatters it: the cube bursts into glassy shards that
 * tumble, glint and fall away, with a flash of coloured light, and the cube
 * pops back (with a little overshoot) when the sim says it has returned.
 *
 * What is drawn is exactly what the sim has: where the sim says which boxes
 * exist (ThingViews of kind "box") those are drawn, at their positions, hidden
 * while taken; otherwise the track's own `itemRows` give the positions, five
 * across the road. The sim takes a box when a kart's centre is within
 * `TUNING.items.pickupRadius` of it, which is a little more than the cube's
 * corner reaches plus the kart's half width (see BOX_SIZE).
 */
import {
  AdditiveBlending,
  BackSide,
  BufferGeometry,
  CanvasTexture,
  Color,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ThingView } from "../../contract";
import type { TrackGeometry } from "../../track/geometry";
import { damp } from "../math";
import { glowTexture } from "./textures";

/** How a row of boxes is laid (the sim's TUNING.items.boxesPerRow and rowSpread; boxes.test.ts checks they agree). */
const PER_ROW = 5;
const ROW_SPREAD = 0.68;

const CAPACITY = 64;
const SHARDS = 160;
const FLASHES = 10;

/** The cube's edge, metres. The sim's pickup radius is sized from this (items.test.ts and boxes.test.ts check it). */
export const BOX_SIZE = 1.6;
/** How high the cube's centre floats above the road. */
export const BOX_LIFT = 1.25;

export interface BoxSlot {
  id: number;
  x: number;
  y: number;
  z: number;
  active: boolean;
  /** A decoy: an item box that is not one. Its tells are a duller colour and a wink of the question mark every few seconds. */
  decoy?: boolean;
}

/**
 * The slots a track's own rows make: five boxes across the road at each row,
 * where the sim puts them (sim/plan.ts: a row spans 0.68 of the road's width).
 * Only used when the source sends no boxes of its own.
 */
export function rowSlots(track: TrackGeometry): BoxSlot[] {
  const out: BoxSlot[] = [];
  let id = 0;
  for (const at of track.def.itemRows) {
    const s = track.wrap(at * track.length);
    const c = track.at(s);
    const step = (c.width * ROW_SPREAD) / (PER_ROW - 1);
    for (let k = 0; k < PER_ROW; k++) {
      const p = track.point(s, (k - (PER_ROW - 1) / 2) * step);
      out.push({ id: id++, x: p.x, y: p.y, z: p.z, active: true });
    }
  }
  return out;
}

export function slotsFromThings(things: readonly ThingView[]): BoxSlot[] | null {
  let any = false;
  const out: BoxSlot[] = [];
  for (const t of things) {
    if (t.kind !== "box") continue;
    any = true;
    out.push({ id: t.id, x: t.x, y: t.y, z: t.z, active: t.active });
  }
  return any ? out : null;
}

/** The rainbow at hue 0..1 as linear RGB (a cosine palette). */
export function rainbow(h: number, out: [number, number, number] = [0, 0, 0]): [number, number, number] {
  const f = (o: number) => 0.5 + 0.5 * Math.cos(Math.PI * 2 * (h + o));
  out[0] = f(0);
  out[1] = f(0.33);
  out[2] = f(0.67);
  return out;
}

interface State {
  scale: number;
  seen: number;
  /** Was it there (taken or not) last frame? */
  was: boolean;
  decoy: boolean;
  x: number;
  y: number;
  z: number;
  hue: number;
}

// ── The glass ───────────────────────────────────────────────────────────────

const VERTEX = /* glsl */ `
attribute vec4 aInfo;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vLocal;
void main() {
  mat4 im = instanceMatrix;
  vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(im) * normal);
  vV = normalize(-mv.xyz);
  vUv = uv;
  vInfo = aInfo;
  vLocal = position;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uMark;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vLocal;

vec3 rainbow(float h) {
  return 0.5 + 0.5 * cos(6.28318 * (h + vec3(0.0, 0.33, 0.67)));
}

void main() {
  vec3 N = normalize(vN);
  #ifdef BACK
    N = -N;
  #endif
  vec3 V = normalize(vV);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);
  float hue = vInfo.x + uTime * 0.13 + vLocal.y * 0.22 + vLocal.x * 0.12;
  vec3 col = rainbow(hue);
  // A decoy is a little duller.
  col = mix(vec3(dot(col, vec3(0.34))), col, mix(1.0, 0.8, vInfo.y));
  vec3 glass = mix(vec3(0.82, 0.9, 1.0), col, 0.5);
  vec3 L = normalize(vec3(-0.45, 0.8, 0.5));
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), 70.0);
  float spec2 = pow(max(dot(N, normalize(vec3(0.7, -0.2, 0.6) + V)), 0.0), 36.0) * 0.4;
  #ifdef SHARD
    float a = 0.3 + 0.5 * fres;
    vec3 c = glass * (0.6 + 2.2 * fres) + col * 0.7 + vec3(spec * 4.0 + spec2 * 2.0);
    a = clamp(a + spec, 0.0, 1.0) * vInfo.w;
  #else
    // The mark; a decoy's gives a wink every few seconds.
    float wink = 1.0 - vInfo.y * smoothstep(0.82, 0.9, fract(uTime * 0.31 + vInfo.z)) * (1.0 - smoothstep(0.92, 1.0, fract(uTime * 0.31 + vInfo.z)));
    float mark = texture2D(uMark, vUv).a * wink;
    float a = 0.14 + 0.5 * fres + mark * 0.9 + spec * 0.9;
    vec3 c = glass * (0.3 + 1.7 * fres) + col * 0.55 + mix(vec3(1.0), col, 0.3) * 3.2 * mark + vec3(spec * 3.0 + spec2);
    a = clamp(a, 0.0, 0.96) * vInfo.w;
    #ifdef BACK
      c *= 0.62;
      a *= 0.7;
    #endif
  #endif
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/** A swelling bubble of coloured light that is bright at its rim and clear in the middle (so it never blanks out what is inside it). */
function flashMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        mat4 im = instanceMatrix;
        vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
        vN = normalize(normalMatrix * mat3(im) * normal);
        vV = normalize(-mv.xyz);
        vC = instanceColor;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vC;
      void main() {
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float rim = pow(1.0 - ndv, 1.8);
        gl_FragColor = vec4(vC * (rim * 1.3 + 0.05), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function glassMaterial(mark: Texture, o: { back?: boolean; shard?: boolean; double?: boolean }): ShaderMaterial {
  const defines: Record<string, string> = {};
  if (o.back) defines.BACK = "";
  if (o.shard) defines.SHARD = "";
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMark: { value: mark } },
    defines,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    side: o.double ? DoubleSide : o.back ? BackSide : FrontSide,
  });
}

/** A bold question mark with a soft glow, drawn on a canvas (no font needed). */
function markTexture(): Texture {
  try {
    const S = 256;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, S, S);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const draw = (width: number, blur: number, alpha: number) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.shadowColor = "white";
      ctx.shadowBlur = blur;
      ctx.strokeStyle = "white";
      ctx.fillStyle = "white";
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(128, 94, 42, Math.PI * 1.08, Math.PI * 2.42, false);
      ctx.bezierCurveTo(168, 136, 128, 132, 128, 160);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(128, 160);
      ctx.lineTo(128, 172);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(128, 208, width * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    draw(34, 30, 0.7);
    draw(30, 0, 1);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  } catch {
    const t = new DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
}

/** A jagged flat sliver of glass, about 0.4 m across, for the shards. */
function shardGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const v = [
    [-0.22, 0, -0.16],
    [0.24, 0, -0.1],
    [0.02, 0, 0.3],
    [0.04, 0.07, -0.02],
  ];
  const faces = [
    [0, 2, 1],
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
  ];
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (const f of faces) {
    a.fromArray(v[f[0]!]!);
    b.fromArray(v[f[1]!]!);
    c.fromArray(v[f[2]!]!);
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    for (const p of [a, b, c]) {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(p.x + 0.5, p.z + 0.5);
    }
  }
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

export class ItemBoxes {
  readonly group = new Group();
  private readonly back: InstancedMesh;
  private readonly front: InstancedMesh;
  private readonly core: InstancedMesh;
  private readonly pool: InstancedMesh;
  private readonly shards: InstancedMesh;
  private readonly flashes: InstancedMesh;
  private readonly info: InstancedBufferAttribute;
  private readonly shardInfo: InstancedBufferAttribute;
  private readonly materials: ShaderMaterial[] = [];
  private readonly states = new Map<number, State>();
  private readonly resources: { dispose(): void }[] = [];
  private frameNo = 0;
  private rnd = 7;

  // The shards in flight (flat arrays, one slot each).
  private readonly sPos = new Float32Array(SHARDS * 3);
  private readonly sVel = new Float32Array(SHARDS * 3);
  private readonly sRot = new Float32Array(SHARDS * 3);
  private readonly sSpin = new Float32Array(SHARDS * 3);
  private readonly sAge = new Float32Array(SHARDS).fill(9);
  private readonly sLife = new Float32Array(SHARDS).fill(1);
  private readonly sSize = new Float32Array(SHARDS);
  private readonly sHue = new Float32Array(SHARDS);
  private readonly sFloor = new Float32Array(SHARDS);
  private nextShard = 0;
  // And the flashes.
  private readonly fAge = new Float32Array(FLASHES).fill(9);
  private readonly fAt = new Float32Array(FLASHES * 3);
  private readonly fHue = new Float32Array(FLASHES);
  private nextFlash = 0;

  constructor() {
    const mark = markTexture();
    this.resources.push(mark);

    const shellGeo = new RoundedBoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE, 5, 0.24);
    this.info = new InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4).setUsage(DynamicDrawUsage);
    shellGeo.setAttribute("aInfo", this.info);
    const backMat = glassMaterial(mark, { back: true });
    const frontMat = glassMaterial(mark, {});
    this.materials.push(backMat, frontMat);
    this.back = new InstancedMesh(shellGeo, backMat, CAPACITY);
    this.front = new InstancedMesh(shellGeo, frontMat, CAPACITY);

    const coreGeo = new IcosahedronGeometry(0.34, 1);
    const coreMat = new MeshBasicMaterial({ color: 0xffffff, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false });
    this.core = new InstancedMesh(coreGeo, coreMat, CAPACITY);

    const poolTex = glowTexture(0, 1.1);
    const poolGeo = new PlaneGeometry(4.2, 4.2);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new MeshBasicMaterial({ map: poolTex, transparent: true, blending: AdditiveBlending, depthWrite: false, opacity: 0.8, fog: true });
    this.pool = new InstancedMesh(poolGeo, poolMat, CAPACITY);

    const shardGeo = shardGeometry();
    this.shardInfo = new InstancedBufferAttribute(new Float32Array(SHARDS * 4), 4).setUsage(DynamicDrawUsage);
    shardGeo.setAttribute("aInfo", this.shardInfo);
    const shardMat = glassMaterial(mark, { shard: true, double: true });
    this.materials.push(shardMat);
    this.shards = new InstancedMesh(shardGeo, shardMat, SHARDS);

    const flashGeo = new IcosahedronGeometry(1, 2);
    const flashMat = flashMaterial();
    this.flashes = new InstancedMesh(flashGeo, flashMat, FLASHES);

    this.resources.push(shellGeo, backMat, frontMat, coreGeo, coreMat, poolTex, poolGeo, poolMat, shardGeo, shardMat, flashGeo, flashMat);
    for (const m of [this.back, this.front, this.core, this.pool, this.shards, this.flashes]) {
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.shards.count = SHARDS;
    this.flashes.count = FLASHES;
    this.pool.renderOrder = 4;
    this.back.renderOrder = 5;
    this.core.renderOrder = 5;
    this.front.renderOrder = 6;
    this.shards.renderOrder = 7;
    this.flashes.renderOrder = 8;
    this.group.renderOrder = 6;
    // Shards and flashes start out of sight.
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < SHARDS; i++) this.shards.setMatrixAt(i, zero);
    for (let i = 0; i < FLASHES; i++) this.flashes.setMatrixAt(i, zero);
    this.shards.instanceMatrix.needsUpdate = true;
    this.flashes.instanceMatrix.needsUpdate = true;
    this.flashes.setColorAt(0, new Color(0, 0, 0));
  }

  private r(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  /** The cube bursts: shards flung out, a flash of its colour. */
  private shatter(x: number, y: number, z: number, hue: number, decoy: boolean): void {
    const n = decoy ? 30 : 26;
    for (let k = 0; k < n; k++) {
      const i = this.nextShard;
      this.nextShard = (this.nextShard + 1) % SHARDS;
      // Out from the cube's middle, mostly sideways and up.
      const a = this.r() * Math.PI * 2;
      const up = 0.3 + this.r() * 1.0;
      const speed = 2.6 + this.r() * 5.2;
      this.sPos[i * 3] = x + (this.r() - 0.5) * BOX_SIZE * 0.7;
      this.sPos[i * 3 + 1] = y + (this.r() - 0.5) * BOX_SIZE * 0.7;
      this.sPos[i * 3 + 2] = z + (this.r() - 0.5) * BOX_SIZE * 0.7;
      this.sVel[i * 3] = Math.cos(a) * speed;
      this.sVel[i * 3 + 1] = up * speed * 0.9 + 1.5;
      this.sVel[i * 3 + 2] = Math.sin(a) * speed;
      this.sRot[i * 3] = this.r() * 6.28;
      this.sRot[i * 3 + 1] = this.r() * 6.28;
      this.sRot[i * 3 + 2] = this.r() * 6.28;
      this.sSpin[i * 3] = (this.r() - 0.5) * 22;
      this.sSpin[i * 3 + 1] = (this.r() - 0.5) * 22;
      this.sSpin[i * 3 + 2] = (this.r() - 0.5) * 22;
      this.sAge[i] = 0;
      this.sLife[i] = 0.55 + this.r() * 0.55;
      this.sSize[i] = 0.35 + this.r() * 0.6;
      this.sHue[i] = (hue + (this.r() - 0.5) * 0.45 + 1) % 1;
      this.sFloor[i] = y - BOX_LIFT + 0.08;
    }
    const f = this.nextFlash;
    this.nextFlash = (this.nextFlash + 1) % FLASHES;
    this.fAge[f] = 0;
    this.fAt[f * 3] = x;
    this.fAt[f * 3 + 1] = y;
    this.fAt[f * 3 + 2] = z;
    this.fHue[f] = hue;
  }

  update(slots: readonly BoxSlot[], time: number, dt: number, glow?: (x: number, y: number, z: number, r: number, g: number, b: number) => void): void {
    this.frameNo++;
    for (const m of this.materials) m.uniforms.uTime!.value = time;
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3();
    const colour = new Color();
    const rgb: [number, number, number] = [0, 0, 0];
    const I = this.info.array as Float32Array;
    let n = 0;
    for (const slot of slots) {
      if (n >= CAPACITY) break;
      const decoy = slot.decoy === true;
      let st = this.states.get(slot.id);
      if (!st) {
        st = { scale: slot.active && !decoy ? 1 : 0, seen: 0, was: slot.active, decoy, x: slot.x, y: slot.y, z: slot.z, hue: 0 };
        this.states.set(slot.id, st);
      }
      st.seen = this.frameNo;
      st.decoy = decoy;
      st.x = slot.x;
      st.y = slot.y;
      st.z = slot.z;
      const phase = slot.id * 1.7;
      const hue = ((slot.id * 0.173) % 1 + 1) % 1;
      st.hue = (hue + time * 0.13) % 1;
      // Taken: it bursts, and is gone at once (the shards stand in for it).
      if (st.was && !slot.active) {
        this.shatter(slot.x, slot.y + BOX_LIFT, slot.z, st.hue, false);
        st.scale = 0;
      }
      st.was = slot.active;
      st.scale = slot.active ? damp(st.scale, 1, 9, dt) : 0;
      // A tiny overshoot as it returns, so it pops rather than fades.
      const pop = slot.active && st.scale < 0.98 ? 1 + Math.sin(st.scale * Math.PI) * 0.14 : 1;
      const sc = st.scale * pop;
      if (sc < 0.02) continue;
      const bob = Math.sin(time * 2.0 + phase) * 0.12;
      p.set(slot.x, slot.y + BOX_LIFT + bob, slot.z);
      e.set(Math.sin(time * 0.9 + phase) * 0.3 + 0.35, time * (decoy ? 1.42 : 1.3) + phase, Math.cos(time * 0.7 + phase) * 0.28, "YXZ");
      q.setFromEuler(e);
      m.compose(p, q, s.set(sc, sc, sc));
      this.back.setMatrixAt(n, m);
      this.front.setMatrixAt(n, m);
      I[n * 4] = hue;
      I[n * 4 + 1] = decoy ? 1 : 0;
      I[n * 4 + 2] = (phase * 0.37) % 1;
      I[n * 4 + 3] = 1;
      // The gem turns the other way, breathes, and shines in the box's colour.
      e.set(time * 1.7 + phase, -time * 2.2 + phase, 0);
      q.setFromEuler(e);
      const breathe = sc * (0.85 + Math.sin(time * 4 + phase) * 0.12);
      m.compose(p, q, s.set(breathe, breathe, breathe));
      this.core.setMatrixAt(n, m);
      p.set(slot.x, slot.y + 0.07, slot.z);
      m.compose(p, q.identity(), s.set(sc, sc, sc));
      this.pool.setMatrixAt(n, m);
      rainbow(st.hue, rgb);
      const sat = decoy ? 0.8 : 1;
      const lum = (rgb[0] + rgb[1] + rgb[2]) / 3;
      colour.setRGB(lum + (rgb[0] - lum) * sat, lum + (rgb[1] - lum) * sat, lum + (rgb[2] - lum) * sat);
      this.core.setColorAt(n, colour.clone().multiplyScalar(2.2));
      this.pool.setColorAt(n, colour);
      if (glow && sc > 0.5) glow(slot.x, slot.y + BOX_LIFT, slot.z, colour.r, colour.g, colour.b);
      n++;
    }
    for (const mesh of [this.back, this.front, this.core, this.pool]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.info.needsUpdate = true;

    // A decoy that has gone (driven into, blasted) bursts where it was; forget slots that have gone (a new race).
    for (const [id, st] of this.states) {
      if (st.seen === this.frameNo) continue;
      if (st.decoy && st.scale > 0.4 && this.frameNo - st.seen < 2) this.shatter(st.x, st.y + BOX_LIFT, st.z, st.hue, true);
      if (this.frameNo - st.seen > 2 || st.decoy) this.states.delete(id);
    }

    this.stepShards(dt);
  }

  /** Shards fly, tumble, bounce once off the road, shrink and fade; flashes swell and fade. */
  private stepShards(dt: number): void {
    const m = new Matrix4();
    const q = new Quaternion();
    const e = new Euler();
    const p = new Vector3();
    const s = new Vector3();
    const zero = new Matrix4().makeScale(0, 0, 0);
    const rgb: [number, number, number] = [0, 0, 0];
    const S = this.shardInfo.array as Float32Array;
    for (let i = 0; i < SHARDS; i++) {
      const age = this.sAge[i]!;
      if (age >= this.sLife[i]!) {
        if (age < 8) {
          this.shards.setMatrixAt(i, zero);
          this.sAge[i] = 9;
        }
        continue;
      }
      this.sAge[i] = age + dt;
      this.sVel[i * 3 + 1] = this.sVel[i * 3 + 1]! - 16 * dt;
      const drag = Math.exp(-0.9 * dt);
      this.sVel[i * 3] = this.sVel[i * 3]! * drag;
      this.sVel[i * 3 + 2] = this.sVel[i * 3 + 2]! * drag;
      for (let k = 0; k < 3; k++) {
        this.sPos[i * 3 + k] = this.sPos[i * 3 + k]! + this.sVel[i * 3 + k]! * dt;
        this.sRot[i * 3 + k] = this.sRot[i * 3 + k]! + this.sSpin[i * 3 + k]! * dt;
      }
      if (this.sPos[i * 3 + 1]! < this.sFloor[i]! && this.sVel[i * 3 + 1]! < 0) {
        this.sPos[i * 3 + 1] = this.sFloor[i]!;
        this.sVel[i * 3 + 1] = -this.sVel[i * 3 + 1]! * 0.35;
        this.sVel[i * 3] = this.sVel[i * 3]! * 0.6;
        this.sVel[i * 3 + 2] = this.sVel[i * 3 + 2]! * 0.6;
        this.sSpin[i * 3] = this.sSpin[i * 3]! * 0.5;
        this.sSpin[i * 3 + 1] = this.sSpin[i * 3 + 1]! * 0.5;
        this.sSpin[i * 3 + 2] = this.sSpin[i * 3 + 2]! * 0.5;
      }
      const u = this.sAge[i]! / this.sLife[i]!;
      const fade = 1 - Math.max(0, (u - 0.55) / 0.45) ** 1.5;
      const size = this.sSize[i]! * (0.5 + 0.5 * fade) * (u < 0.08 ? u / 0.08 : 1);
      p.set(this.sPos[i * 3]!, this.sPos[i * 3 + 1]!, this.sPos[i * 3 + 2]!);
      e.set(this.sRot[i * 3]!, this.sRot[i * 3 + 1]!, this.sRot[i * 3 + 2]!);
      q.setFromEuler(e);
      m.compose(p, q, s.set(size, size, size));
      this.shards.setMatrixAt(i, m);
      S[i * 4] = this.sHue[i]!;
      S[i * 4 + 1] = 0;
      S[i * 4 + 2] = 0;
      S[i * 4 + 3] = fade;
    }
    this.shards.instanceMatrix.needsUpdate = true;
    this.shardInfo.needsUpdate = true;

    const colour = new Color();
    for (let f = 0; f < FLASHES; f++) {
      const age = this.fAge[f]!;
      if (age >= 0.3) {
        if (age < 8) {
          this.flashes.setMatrixAt(f, zero);
          this.flashes.setColorAt(f, colour.setRGB(0, 0, 0));
          this.fAge[f] = 9;
        }
        continue;
      }
      this.fAge[f] = age + dt;
      const u = Math.min(1, this.fAge[f]! / 0.3);
      const radius = 0.4 + 1.5 * (1 - (1 - u) ** 3);
      const a = (1 - u) ** 1.6;
      p.set(this.fAt[f * 3]!, this.fAt[f * 3 + 1]!, this.fAt[f * 3 + 2]!);
      m.compose(p, q.identity(), s.set(radius, radius, radius));
      this.flashes.setMatrixAt(f, m);
      rainbow(this.fHue[f]!, rgb);
      colour.setRGB(rgb[0] * 0.7 + 0.3, rgb[1] * 0.7 + 0.3, rgb[2] * 0.7 + 0.3).multiplyScalar(2.2 * a);
      this.flashes.setColorAt(f, colour);
    }
    this.flashes.instanceMatrix.needsUpdate = true;
    if (this.flashes.instanceColor) this.flashes.instanceColor.needsUpdate = true;
  }

  /** World positions of the boxes now showing, for the pickup sparkle. */
  nearest(x: number, z: number, within: number, slots: readonly BoxSlot[]): BoxSlot | null {
    let best: BoxSlot | null = null;
    let bestD = within * within;
    for (const s of slots) {
      const d = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  dispose(): void {
    for (const r of this.resources) r.dispose();
    for (const m of [this.back, this.front, this.core, this.pool, this.shards, this.flashes]) m.dispose();
  }
}
