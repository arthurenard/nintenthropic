/**
 * What the six newer items look like, beyond the particles (effects.ts):
 *
 *   comet      a bubble of gold and rainbow round the kart, a glow and a
 *              sparkling trail behind it; it blinks as the six seconds run out
 *   storm      a dark cloud over each kart it zaps, raining, a bolt from it
 *              to the kart, and the kart squashed flat and trembling
 *   skyrocket  a ring on the road under its target (the radius of the
 *              burst), and the burst itself: a flash, a dome, a ring of fire
 *   blast      a shockwave: a dome and a ring spreading to the blast radius
 *   puck3      the pucks left to fire, orbiting the kart
 *   decoy      shards of a box, when it is driven into
 *
 * The rocket and the decoy themselves are things (things.ts, world/boxes.ts).
 * Everything is pooled or per kart; nothing is allocated while racing apart
 * from the first time a kart needs a cloud or a bubble.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  FrontSide,
  Group,
  IcosahedronGeometry,
  Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  type Object3D,
} from "three";
import type { KartView, RaceEvent, RaceView, ThingView } from "../contract";
import type { Effects } from "./effects";
import { clamp, damp } from "./math";

/** What the sim does, in the picture's terms (tuning.ts has the real numbers). */
const BURST_RADIUS = 9;
const BLAST_RADIUS = 7;
const ZAP_SECONDS = 3;
const COMET_SECONDS = 6;
const SQUASH_SECONDS = 0.7;

type Rgb = readonly [number, number, number];

// ── A flat ring, a disc and a half dome: a shockwave, a warning ──────────────
const RING = new RingGeometry(0.86, 1, 72).rotateX(-Math.PI / 2);
const DISC = new CircleGeometry(1, 48).rotateX(-Math.PI / 2);
const DOME = new SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);

function glowMaterial(side: typeof DoubleSide | typeof FrontSide = DoubleSide): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side });
}

class Zone {
  readonly group = new Group();
  private readonly ring = new Mesh(RING, glowMaterial());
  private readonly disc = new Mesh(DISC, glowMaterial());
  private readonly dome = new Mesh(DOME, glowMaterial(FrontSide));

  constructor() {
    this.ring.renderOrder = 7;
    this.disc.renderOrder = 6;
    this.dome.renderOrder = 8;
    this.group.add(this.disc, this.ring, this.dome);
    this.group.visible = false;
  }

  /** Puts it down at (x, y, z) with this radius, colour and strengths (0..1) of its ring, disc and dome. */
  set(x: number, y: number, z: number, radius: number, c: Rgb, ring: number, disc: number, dome: number): void {
    this.group.visible = ring > 0.01 || disc > 0.01 || dome > 0.01;
    this.group.position.set(x, y, z);
    this.group.scale.set(radius, radius, radius);
    for (const [mesh, strength] of [[this.ring, ring], [this.disc, disc], [this.dome, dome]] as const) {
      const m = mesh.material as MeshBasicMaterial;
      m.color.setRGB(c[0], c[1], c[2]);
      m.opacity = clamp(strength, 0, 1);
    }
  }

  hide(): void {
    this.group.visible = false;
  }

  dispose(): void {
    for (const m of [this.ring, this.disc, this.dome]) (m.material as Material).dispose();
  }
}

interface Wave {
  zone: Zone;
  age: number;
  life: number;
  radius: number;
  y: number;
  x: number;
  z: number;
  colour: Rgb;
  dome: number;
}

// ── A lightning bolt: jagged crossed ribbons ───────────────────────────────
const SEGMENTS = 9;

interface Bolt {
  mesh: Mesh;
  pos: Float32Array;
  age: number;
  life: number;
  x: number;
  z: number;
  base: number;
}

function boltMesh(material: Material): Bolt {
  const geometry = new BufferGeometry();
  const pos = new Float32Array(SEGMENTS * 8 * 3);
  const index: number[] = [];
  for (let i = 0; i < SEGMENTS * 2; i++) {
    const v = i * 4;
    index.push(v, v + 1, v + 2, v, v + 2, v + 3);
  }
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setIndex(index);
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 9;
  return { mesh, pos, age: 1, life: 1, x: 0, z: 0, base: 0 };
}

// ── The comet's bubble ─────────────────────────────────────────────────────
function auraMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uAlpha;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.7);
        float h = uTime * 0.6 + vP.y * 0.55 + vP.z * 0.3;
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
        vec3 gold = vec3(1.0, 0.78, 0.3);
        vec3 c = mix(gold, rainbow, 0.5);
        float a = (0.1 + 0.8 * f) * uAlpha;
        gl_FragColor = vec4(c * 1.4, a);
      }`,
  });
}

interface Aura {
  mesh: Mesh;
  material: ShaderMaterial;
  alpha: number;
  parent: Object3D;
}

interface Cloud {
  group: Group;
  scale: number;
  rain: number;
}

/** What the picture needs of a kart's model: the group it moves. */
export interface ActorHandle {
  root: Object3D;
}

export class ItemFx {
  readonly group = new Group();
  private readonly waves: Wave[] = [];
  private readonly warnings = new Map<number, Zone>();
  private readonly bolts: Bolt[] = [];
  private readonly boltMaterial = new MeshBasicMaterial({ color: new Color(1.5, 1.7, 3.2), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
  private readonly cloudGeometry = new IcosahedronGeometry(1, 1);
  private readonly cloudDark = new MeshLambertMaterial({ color: 0x4a5168, emissive: 0x151823, flatShading: true });
  private readonly cloudLight = new MeshLambertMaterial({ color: 0x626b86, emissive: 0x1a1e2b, flatShading: true });
  private readonly clouds = new Map<number, Cloud>();
  private readonly auras = new Map<number, Aura>();
  private readonly auraGeometry = new SphereGeometry(1, 28, 18);
  private readonly orbits = new Map<number, Group>();
  private readonly squashed = new Set<number>();
  /** A storm cloud's puffs and a comet's bubble that nobody has, hidden (see the constructor). */
  private readonly standInAura = auraMaterial();
  private lightning = 0;
  private rnd = 11;
  private nextWave = 0;
  private nextBolt = 0;

  constructor(
    private readonly fx: Effects,
    /** The puck model, for the pucks that orbit a kart holding three. */
    private readonly puck: { geometry: BufferGeometry; material: Material },
  ) {
    for (let i = 0; i < 10; i++) {
      const zone = new Zone();
      this.group.add(zone.group);
      this.waves.push({ zone, age: 1, life: 1, radius: 1, y: 0, x: 0, z: 0, colour: [1, 1, 1], dome: 0 });
    }
    for (let i = 0; i < 8; i++) {
      const bolt = boltMesh(this.boltMaterial);
      this.group.add(bolt.mesh);
      this.bolts.push(bolt);
    }
    // The clouds and bubbles are made when a kart first needs one; these hidden stand-ins are shown by the renderer's
    // warm-up, so their shaders are built behind the loading screen rather than at the first storm or comet (a stall of
    // 300 ms and more), and they hold on to them all race (a comet's bubble lets its own material go when it ends).
    const standIn = new Group();
    standIn.add(new Mesh(this.cloudGeometry, this.cloudDark), new Mesh(this.cloudGeometry, this.cloudLight), new Mesh(this.auraGeometry, this.standInAura));
    standIn.visible = false;
    this.group.add(standIn);
  }

  private r(): number {
    this.rnd = (this.rnd * 16807) % 2147483647;
    return (this.rnd - 1) / 2147483646;
  }

  // ── Events ────────────────────────────────────────────────────────────────
  private wave(x: number, y: number, z: number, radius: number, colour: Rgb, life: number, dome: number): void {
    const w = this.waves[this.nextWave]!;
    this.nextWave = (this.nextWave + 1) % this.waves.length;
    w.age = 0;
    w.life = life;
    w.radius = radius;
    w.x = x;
    w.y = y + 0.16;
    w.z = z;
    w.colour = colour;
    w.dome = dome;
  }

  /** A bolt from `top` m up down to the road at (x, z). */
  private bolt(x: number, y: number, z: number, top: number): void {
    const b = this.bolts[this.nextBolt]!;
    this.nextBolt = (this.nextBolt + 1) % this.bolts.length;
    b.age = 0;
    b.life = 0.42;
    b.x = x;
    b.z = z;
    b.base = y;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const wobble = i === SEGMENTS ? 0 : (0.25 + Math.sin(Math.PI * t)) * 0.9;
      pts.push([x + (this.r() - 0.5) * 2 * wobble, y + 0.3 + top * (1 - t), z + (this.r() - 0.5) * 2 * wobble]);
    }
    let o = 0;
    for (let i = 0; i < SEGMENTS; i++) {
      const w0 = 0.17 * (1 - 0.5 * (i / SEGMENTS));
      const w1 = 0.17 * (1 - 0.5 * ((i + 1) / SEGMENTS));
      const [x0, y0, z0] = pts[i]!;
      const [x1, y1, z1] = pts[i + 1]!;
      const quad = (ax: number, az: number): void => {
        const v = [x0 - ax * w0, y0, z0 - az * w0, x0 + ax * w0, y0, z0 + az * w0, x1 + ax * w1, y1, z1 + az * w1, x1 - ax * w1, y1, z1 - az * w1];
        b.pos.set(v, o);
        o += 12;
      };
      quad(1, 0);
      quad(0, 1);
    }
    (b.mesh.geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
    b.mesh.visible = true;
  }

  onEvent(e: RaceEvent, kartAt: (id: number) => KartView | undefined): void {
    const fx = this.fx;
    switch (e.type) {
      case "strike": {
        const k = kartAt(e.kart);
        const y = k ? k.y : 0;
        if (e.item === "storm") {
          this.bolt(e.x, y, e.z, 4.2);
          fx.flash(e.x, y + 0.9, e.z, 4, 0.8, 0.95, 2.0, 0.25);
          fx.sparksBurst(e.x, y + 0.9, e.z, 16, 6, false);
          fx.puff(e.x, y + 0.5, e.z, 5, 1.1, 2.5);
          this.lightning = 1;
        } else if (e.item === "skyrocket") {
          this.wave(e.x, y, e.z, BURST_RADIUS, [2.2, 1.0, 0.25], 0.95, 0.4);
          this.wave(e.x, y, e.z, BURST_RADIUS * 0.6, [2.4, 2.0, 1.4], 0.5, 0.4);
          fx.flash(e.x, y + 1.8, e.z, 8, 2.0, 1.3, 0.6, 0.3);
          fx.fireworks(e.x, y + 1.2, e.z, 90, 15, true);
          fx.sparksBurst(e.x, y + 1.2, e.z, 30, 11, true);
          for (let i = 0; i < 16; i++) fx.smoke(e.x + (this.r() - 0.5) * 6, y + 0.6 + this.r() * 3, e.z + (this.r() - 0.5) * 6, 2.4, 1.8, 3);
        } else {
          this.wave(e.x, y, e.z, BLAST_RADIUS, [0.8, 1.7, 2.3], 0.65, 0.4);
          this.wave(e.x, y, e.z, BLAST_RADIUS * 0.55, [2.2, 2.2, 2.4], 0.4, 0.2);
          fx.flash(e.x, y + 1.0, e.z, 5, 0.7, 1.3, 2.0, 0.25);
          fx.fireworks(e.x, y + 0.6, e.z, 36, 9, false);
          fx.puff(e.x, y + 0.4, e.z, 10, 1.7, 5.5);
        }
        return;
      }
      case "use": {
        const k = kartAt(e.kart);
        if (!k) return;
        if (e.item === "comet") {
          this.wave(k.x, k.y, k.z, 3.4, [2.2, 1.7, 0.5], 0.6, 0.3);
          for (let i = 0; i < 30; i++) fx.sparkle(k.x + (this.r() - 0.5) * 2, k.y + 0.4 + this.r() * 1.6, k.z + (this.r() - 0.5) * 2, this.r(), 0.4, 0.8, 2, 0.4);
        } else if (e.item === "skyrocket") {
          fx.sparksBurst(k.x, k.y + 1.6, k.z, 14, 6, true);
          for (let i = 0; i < 8; i++) fx.smoke(k.x + (this.r() - 0.5) * 1.5, k.y + 1 + this.r(), k.z + (this.r() - 0.5) * 1.5, 1.4, 1.4, 1.5);
        }
        return;
      }
      case "hit": {
        const k = kartAt(e.kart);
        if (!k) return;
        if (e.cause === "decoy") {
          // A box that was not one: it bursts into shards of every colour.
          for (let i = 0; i < 26; i++) fx.sparkle(k.x + (this.r() - 0.5) * 1.2, k.y + 0.6 + this.r(), k.z + (this.r() - 0.5) * 1.2, this.r(), 0.38, 0.7, 3.5);
          fx.puff(k.x, k.y + 0.6, k.z, 8, 1.7, 3);
        } else if (e.cause === "comet") {
          for (let i = 0; i < 18; i++) fx.sparkle(k.x, k.y + 0.8 + this.r(), k.z, 0.12, 0.45, 0.7, 3, 0.7);
        }
        return;
      }
      default:
        return;
    }
  }

  // ── Every frame ───────────────────────────────────────────────────────────
  update(view: RaceView, byId: ReadonlyMap<number, KartView>, actors: ReadonlyMap<number, ActorHandle>, dt: number, time: number): void {
    const fx = this.fx;

    // Waves spread and fade.
    for (const w of this.waves) {
      if (w.age >= w.life) {
        w.zone.hide();
        continue;
      }
      w.age += dt;
      const u = clamp(w.age / w.life, 0, 1);
      const out = 1 - (1 - u) ** 3;
      w.zone.set(w.x, w.y, w.z, Math.max(0.1, w.radius * out), w.colour, (1 - u) ** 1.4, 0.16 * (1 - u) ** 2, w.dome * (1 - u) ** 2);
    }

    // Bolts flicker out.
    for (const b of this.bolts) {
      if (b.age >= b.life) continue;
      b.age += dt;
      const u = b.age / b.life;
      if (u >= 1) {
        b.mesh.visible = false;
        continue;
      }
      b.mesh.visible = u < 0.3 || (u > 0.38 && u < 0.72);
      fx.glowNow(b.x, b.base + 0.8, b.z, 6.5 * (1 - u * 0.6), 0.8, 1.0, 2.4, 0.9 * (1 - u));
    }
    this.lightning = damp(this.lightning, 0, 9, dt);
    // A bolt lights every cloud from inside for a moment.
    this.cloudDark.emissive.setRGB(0.08 + 0.55 * this.lightning, 0.09 + 0.6 * this.lightning, 0.13 + 0.9 * this.lightning);
    this.cloudLight.emissive.setRGB(0.1 + 0.6 * this.lightning, 0.12 + 0.65 * this.lightning, 0.17 + 1.0 * this.lightning);

    // The skyrocket's warning: a ring where its burst will fall, growing hotter as it nears.
    const warned = new Set<number>();
    for (const t of view.things) {
      if (t.kind !== "skyrocket" || t.target === undefined) continue;
      const k = byId.get(t.target);
      if (!k) continue;
      warned.add(t.id);
      let zone = this.warnings.get(t.id);
      if (!zone) {
        zone = new Zone();
        this.group.add(zone.group);
        this.warnings.set(t.id, zone);
      }
      const near = 1 - clamp(Math.hypot(t.x - k.x, t.z - k.z) / 70, 0, 1);
      const pulse = 0.55 + 0.45 * Math.sin(time * (7 + near * 10));
      zone.set(k.x, k.y + 0.16, k.z, BURST_RADIUS, [2.2, 0.28 + 0.2 * pulse, 0.18], (0.35 + 0.55 * near) * (0.6 + 0.4 * pulse), 0.1 + 0.2 * near * pulse, 0);
    }
    for (const [id, zone] of this.warnings) {
      if (warned.has(id)) continue;
      zone.hide();
      this.group.remove(zone.group);
      zone.dispose();
      this.warnings.delete(id);
    }

    for (const k of view.karts) {
      const shown = byId.get(k.id) ?? k;
      const actor = actors.get(k.id);
      this.comet(k, shown, actor, dt, time);
      this.zapped(k, shown, actor, dt, time);
      this.orbit(k, shown, dt, time);
    }
  }

  private comet(k: KartView, at: KartView, actor: ActorHandle | undefined, dt: number, time: number): void {
    const fx = this.fx;
    const on = (k.comet ?? 0) > 0 && k.rescue <= 0;
    let aura = this.auras.get(k.id);
    if (!on && !aura) return;
    if (on && actor && (!aura || aura.parent !== actor.root)) {
      if (aura) aura.parent.remove(aura.mesh);
      const material = auraMaterial();
      const mesh = new Mesh(this.auraGeometry, material);
      mesh.scale.set(1.5, 1.05, 2.2);
      mesh.position.set(0, 0.85, 0.15);
      mesh.renderOrder = 5;
      actor.root.add(mesh);
      aura = { mesh, material, alpha: 0, parent: actor.root };
      this.auras.set(k.id, aura);
    }
    if (!aura) return;
    const left = k.comet ?? 0;
    // It blinks as it runs out.
    const blink = left < 1.5 ? 0.55 + 0.45 * Math.sin(time * 26) : 1;
    aura.alpha = damp(aura.alpha, on ? blink : 0, 14, dt);
    aura.material.uniforms.uTime!.value = time;
    aura.material.uniforms.uAlpha!.value = aura.alpha;
    if (!on && aura.alpha < 0.02) {
      aura.parent.remove(aura.mesh);
      aura.material.dispose();
      this.auras.delete(k.id);
      return;
    }
    if (!on) return;
    const hue = (time * 0.9) % 1;
    fx.glowNow(at.x, at.y + 0.9, at.z, 5.2, 1.5 + Math.sin(hue * 6.28) * 0.5, 1.15 + Math.sin(hue * 6.28 + 2.1) * 0.4, 0.5 + Math.sin(hue * 6.28 + 4.2) * 0.4, 0.38 * Math.min(1, left / 0.4));
    // A trail of sparkles from the tail, and now and then a gold star about it.
    const fxz = Math.sin(at.heading);
    const fzz = Math.cos(at.heading);
    for (let i = 0; i < 3; i++) {
      const back = 1.2 + this.r() * 0.6;
      fx.sparkle(at.x - fxz * back + (this.r() - 0.5) * 0.9, at.y + 0.35 + this.r() * 0.9, at.z - fzz * back + (this.r() - 0.5) * 0.9, (hue + this.r() * 0.35) % 1, 0.34 + this.r() * 0.2, 0.55, 0.5, 0.35);
    }
    if (this.r() < dt * 22) fx.sparkle(at.x + (this.r() - 0.5) * 3, at.y + 0.5 + this.r() * 1.6, at.z + (this.r() - 0.5) * 3, 0.13, 0.55, 0.45, 1.5, 0.85);
  }

  private zapped(k: KartView, at: KartView, actor: ActorHandle | undefined, dt: number, time: number): void {
    const fx = this.fx;
    const zap = k.zapped ?? 0;
    let cloud = this.clouds.get(k.id);
    if (zap > 0 && !cloud) {
      const group = new Group();
      const puffs: [number, number, number, number, boolean][] = [
        [0, 0.12, 0, 0.95, true],
        [-0.95, -0.08, 0.2, 0.74, false],
        [0.95, -0.08, -0.12, 0.78, false],
        [-0.4, 0.38, -0.45, 0.66, false],
        [0.45, 0.36, 0.4, 0.7, true],
        [0.05, -0.18, 0.62, 0.6, false],
        [-0.05, -0.2, -0.6, 0.58, false],
        [-1.45, -0.2, -0.1, 0.5, true],
        [1.5, -0.18, 0.3, 0.52, false],
      ];
      for (const [x, y, z, s, light] of puffs) {
        const m = new Mesh(this.cloudGeometry, light ? this.cloudLight : this.cloudDark);
        m.position.set(x, y, z);
        m.scale.set(s, s * 0.7, s);
        group.add(m);
      }
      this.group.add(group);
      cloud = { group, scale: 0, rain: 0 };
      this.clouds.set(k.id, cloud);
    }
    if (cloud) {
      const want = zap > 0.3 ? 1 : zap > 0 ? zap / 0.3 : 0;
      cloud.scale = damp(cloud.scale, want, 10, dt);
      if (zap <= 0 && cloud.scale < 0.03) {
        this.group.remove(cloud.group);
        this.clouds.delete(k.id);
        cloud = undefined;
      } else {
        const s = Math.max(0.01, cloud.scale);
        cloud.group.scale.set(s, s, s);
        cloud.group.position.set(at.x + Math.sin(time * 1.9 + k.id) * 0.2, at.y + 3.7 + Math.sin(time * 2.6 + k.id) * 0.15, at.z);
        cloud.group.rotation.y = time * 0.4 + k.id;
        if (zap > 0) {
          cloud.rain += 70 * dt;
          while (cloud.rain >= 1) {
            cloud.rain -= 1;
            fx.rain(at.x + (this.r() - 0.5) * 2.4, at.y + 3.3, at.z + (this.r() - 0.5) * 2.4);
          }
        }
      }
    }

    // The kart under it: flattened at the strike, then trembling as it crawls.
    if (actor && zap > 0 && k.rescue <= 0) {
      const elapsed = ZAP_SECONDS - zap;
      const squash = elapsed < SQUASH_SECONDS ? (1 - elapsed / SQUASH_SECONDS) ** 1.5 : 0;
      const tremble = 0.06 + 0.1 * squash;
      actor.root.scale.set(1 + 0.22 * squash, 1 - 0.42 * squash, 1 + 0.22 * squash);
      actor.root.position.x += Math.sin(time * 83 + k.id) * tremble;
      actor.root.position.z += Math.cos(time * 71 + k.id * 2) * tremble;
      this.squashed.add(k.id);
      if (this.r() < dt * 16) fx.sparksBurst(at.x, at.y + 0.9, at.z, 2, 3.5, false);
    } else if (actor && this.squashed.has(k.id)) {
      actor.root.scale.set(1, 1, 1);
      this.squashed.delete(k.id);
    }
  }

  private orbit(k: KartView, at: KartView, dt: number, time: number): void {
    const holding = k.item === "puck3" && !k.rolling && k.rescue <= 0 ? Math.max(0, Math.min(3, k.itemUses)) : 0;
    let ring = this.orbits.get(k.id);
    if (holding === 0) {
      if (ring) {
        this.group.remove(ring);
        this.orbits.delete(k.id);
      }
      return;
    }
    if (!ring) {
      ring = new Group();
      for (let i = 0; i < 3; i++) {
        const m = new Mesh(this.puck.geometry, this.puck.material);
        m.scale.set(0.8, 0.8, 0.8);
        ring.add(m);
      }
      this.group.add(ring);
      this.orbits.set(k.id, ring);
    }
    ring.position.set(at.x, at.y + at.hop + 0.8, at.z);
    void dt;
    ring.children.forEach((m, i) => {
      m.visible = i < holding;
      const a = time * 3.4 + (i * Math.PI * 2) / holding;
      m.position.set(Math.cos(a) * 1.85, Math.sin(time * 5 + i * 2) * 0.1, Math.sin(a) * 1.85);
      m.rotation.set(0.28 * Math.cos(a), time * 12 + i, 0.28 * Math.sin(a));
    });
  }

  clear(): void {
    for (const w of this.waves) {
      w.age = w.life;
      w.zone.hide();
    }
    for (const b of this.bolts) {
      b.age = b.life;
      b.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const w of this.waves) w.zone.dispose();
    for (const z of this.warnings.values()) z.dispose();
    for (const b of this.bolts) b.mesh.geometry.dispose();
    for (const a of this.auras.values()) {
      a.parent.remove(a.mesh);
      a.material.dispose();
    }
    this.auras.clear();
    this.boltMaterial.dispose();
    this.cloudGeometry.dispose();
    this.cloudDark.dispose();
    this.cloudLight.dispose();
    this.standInAura.dispose();
    this.auraGeometry.dispose();
  }
}

export type { ThingView };
