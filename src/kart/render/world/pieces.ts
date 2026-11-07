/**
 * The timed moving set pieces, drawn (track/pieces.ts says what they are, track/hazards.ts where they are).
 *
 * Every piece is posed each frame from `hazardAt` and the race clock, the same pure function the sim spins karts
 * out with, so what a player sees hit them is what hit them. All of a kind are one InstancedMesh (a track's
 * crushers are one draw, its carts another), and the plain parts they share (a chain, a beam, a rail, a lamp post)
 * are one more instanced unit cube tinted per instance: a whole track of them costs a handful of draw calls, and a
 * frame allocates nothing.
 *
 * The telegraph is in the picture as well as the data: a crusher shakes and flushes red (and its shadow grows and
 * reddens on the road) before it falls, and a cart's lamp post glows before it crosses.
 */
import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Texture,
} from "three";
import type { HazardDef } from "../../track/geometry";
import { crushTop, hazardAt, type HazardPose } from "../../track/hazards";
import { isPieceKind } from "../../track/pieces";
import { MeshBuilder, rgb, shapes, xf, type Rgb } from "./builder";
import type { HazardLayer, LandmarkMaterials, PlaceEnv } from "./landmarks/place";

// ─── The models ──────────────────────────────────────────────────────────────

/** Each model stands on y = 0 (a crusher's underside, a ball's bottom), facing +z, `radius` metres across at its widest. */
interface PieceModel {
  build(b: MeshBuilder): void;
  radius: number;
}

const stone = (k: number): Rgb => [0.55 * k, 0.36 * k, 0.24 * k];
const STRIPE_Y = rgb("#f4c20d");
const STRIPE_K = rgb("#2a2420");

const MODELS: Record<string, PieceModel> = {
  // A block of strata rock with a hazard-striped foot and an iron cap, hung from a piston.
  "rock-crusher": {
    radius: 2.2,
    build(b) {
      for (let i = 0; i < 6; i++) b.box(0, 0.2, -2.0 + i * 0.8, 4.3, 0.4, 0.4, i % 2 ? STRIPE_K : STRIPE_Y);
      b.box(0, 1.75, 0, 4.3, 2.6, 4.3, { bottom: rgb("#b4562f"), top: rgb("#e39a5d") });
      b.box(0, 1.2, 0, 4.4, 0.35, 4.4, rgb("#8a3d24"));
      b.box(0, 2.35, 0, 4.5, 0.3, 4.5, rgb("#c97b43"));
      b.box(0, 3.2, 0, 3.4, 0.5, 3.4, rgb("#3a3a46"));
    },
  },
  // A black iron ball with a yellow band and an eye on top for the chain.
  "wrecking-ball": {
    radius: 1.7,
    build(b) {
      b.blob(0, 1.7, 0, 1.7, 1.7, 1.7, { bottom: rgb("#17171d"), top: rgb("#4a4a58") }, 1);
      b.blob(0, 1.7, 0, 1.78, 0.3, 1.78, STRIPE_Y, 1);
      b.post(0, 3.2, 0, 0.35, 0.5, rgb("#8a8a96"));
    },
  },
  // An ore cart on wheels, heaped with gold-brown ore and a lamp on its nose.
  "ore-cart": {
    radius: 2,
    build(b) {
      b.box(0, 1.0, 0, 2.4, 1.3, 3.8, { bottom: rgb("#5a3a26"), top: rgb("#8a5a36") });
      b.box(0, 0.45, 0, 2.6, 0.3, 4.0, rgb("#2b2b33"));
      b.blob(0, 1.75, -0.1, 1.1, 0.55, 1.6, { bottom: rgb("#7a5a2a"), top: rgb("#e8b03a") }, 1);
      for (const x of [-1.15, 1.15]) for (const z of [-1.3, 1.3]) b.post(x, 0, z, 0.45, 0.25, rgb("#1c1c22"));
      b.blob(0, 1.5, 2.05, 0.3, 0.3, 0.3, rgb("#fff3b0"), 0);
    },
  },
  // A long ice spear, point down, with two smaller beside it.
  icicle: {
    radius: 1.5,
    build(b) {
      const ice = { bottom: rgb("#eaf8ff"), top: rgb("#7fb6e6") };
      const spear = (x: number, z: number, r: number, h: number) => b.add(shapesDown(), xfDown(x, h / 2, z, r, h), ice);
      spear(0, 0, 1.3, 5);
      spear(1.1, 0.5, 0.65, 3);
      spear(-0.9, -0.6, 0.55, 2.6);
    },
  },
  // A sweeper's ball: bright, glossy-looking and on its pole.
  "arm-ball": {
    radius: 1.3,
    build(b) {
      b.blob(0, 1.3, 0, 1.3, 1.3, 1.3, { bottom: rgb("#e1305b"), top: rgb("#ff9fb2") }, 1);
      b.blob(0, 1.3, 0, 1.36, 0.22, 1.36, rgb("#fff7d6"), 1);
    },
  },
  // A rollercoaster car, nose first.
  "coaster-car": {
    radius: 2,
    build(b) {
      b.box(0, 0.9, 0, 2.3, 1.0, 3.8, { bottom: rgb("#b31e3d"), top: rgb("#ff4d6d") });
      b.box(0, 1.55, -0.6, 2.0, 0.5, 1.6, rgb("#fff3d6"));
      b.box(0, 0.9, 1.9, 1.7, 0.7, 0.5, rgb("#ffd60a"));
      b.box(0, 0.3, 0, 2.5, 0.25, 4.0, rgb("#2b2b33"));
      b.blob(0, 2.0, -0.6, 0.45, 0.45, 0.45, rgb("#ffd1a1"), 0);
    },
  },
  // A funhouse wall panel, red and white striped, that slides across the way.
  "funhouse-panel": {
    radius: 2,
    build(b) {
      for (let i = 0; i < 6; i++) b.box(0, 1.6, -1.9 + i * 0.76, 0.5, 3.2, 0.76, i % 2 ? rgb("#fff3d6") : rgb("#e63950"));
      b.box(0, 3.3, 0, 0.7, 0.3, 4.1, rgb("#ffd60a"));
    },
  },
  // A funfair high-striker mallet: handle, big wooden head with a red band.
  mallet: {
    radius: 2.2,
    build(b) {
      b.box(0, 1.6, 0, 3.8, 2.6, 3.8, { bottom: rgb("#8a5a2c"), top: rgb("#d9a15f") });
      b.box(0, 1.6, 0, 3.9, 0.5, 3.9, rgb("#e63950"));
      b.box(0, 0.12, 0, 3.8, 0.24, 3.8, rgb("#fff3d6"));
      b.post(0, 2.9, 0, 0.4, 3.4, rgb("#c58b45"));
    },
  },
  // A pirate-ship ride's boat swinging on its arm.
  "swing-boat": {
    radius: 2,
    build(b) {
      b.box(0, 0.8, 0, 2.4, 1.1, 5.2, { bottom: rgb("#1f6fb5"), top: rgb("#4fb0ff") });
      b.box(0, 1.5, -2.3, 2.5, 1.6, 0.5, rgb("#ffd60a"));
      b.box(0, 1.5, 2.3, 2.5, 1.6, 0.5, rgb("#ffd60a"));
      b.post(0, 1.2, 0, 0.18, 2.6, rgb("#fff3d6"));
      b.box(0.4, 3.4, 0, 0.1, 0.8, 1.2, rgb("#e63950"));
    },
  },
};

const shapesDown = () => shapes.cone(6);
const xfDown = (x: number, y: number, z: number, r: number, h: number) => xf(x, y, z, r, h, r, 0, Math.PI);

/** The kinds this layer draws (from the model list), for the tests and the gallery. */
export const PIECE_MODELS: readonly string[] = Object.keys(MODELS);

// ─── The layer ───────────────────────────────────────────────────────────────

const _m = new Matrix4();
const _q = new Quaternion();
const _q2 = new Quaternion();
const _p = new Vector3();
const _s = new Vector3();
const _a = new Vector3();
const _b = new Vector3();
const _up = new Vector3(0, 1, 0);
const _fwd = new Vector3(0, 0, 1);
const _c = new Color();
const WHITE = new Color(1, 1, 1);

interface Kind {
  mesh: InstancedMesh;
  /** The defs drawn by this mesh, in instance order. */
  defs: HazardDef[];
  near: number[];
  scale: number;
}

/** Is `def` one the instanced layer draws? */
export function isPiece(def: HazardDef): boolean {
  return isPieceKind(def.kind) && def.kind in MODELS;
}

/**
 * Builds the layer for the pieces among `defs`. `mats.lit` draws the solid models, a tinted unit cube the parts
 * (chains, beams, rails, lamp posts) and `shadow` the blob that grows on the road under a crusher about to fall.
 */
export function buildPieces(env: PlaceEnv, defs: readonly HazardDef[], mats: LandmarkMaterials, shadow: Texture): HazardLayer {
  const { track } = env;
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const kinds = new Map<string, Kind>();
  for (const def of defs) {
    if (!isPiece(def)) continue;
    let k = kinds.get(def.kind);
    if (!k) {
      const model = MODELS[def.kind]!;
      const b = new MeshBuilder();
      model.build(b);
      const geo = b.build();
      disposables.push(geo);
      const mesh = new InstancedMesh(geo, mats.lit, 1);
      k = { mesh, defs: [], near: [], scale: 1 };
      kinds.set(def.kind, k);
    }
    k.defs.push(def);
    k.near.push(def.at * track.length);
  }
  const all: Kind[] = [...kinds.values()];
  for (const k of all) {
    const model = MODELS[k.defs[0]!.kind]!;
    k.scale = k.defs[0]!.radius / model.radius;
    // Rebuild at the right count (an InstancedMesh cannot grow).
    const mesh = new InstancedMesh(k.mesh.geometry as BufferGeometry, mats.lit, k.defs.length);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.instanceColor = null;
    mesh.setColorAt(0, WHITE);
    for (let i = 0; i < k.defs.length; i++) mesh.setColorAt(i, WHITE);
    mesh.frustumCulled = false;
    k.mesh.dispose();
    k.mesh = mesh;
    group.add(mesh);
  }

  // Parts: a unit cube, tinted per instance. Up to six per piece (chain, beam, two posts, lamp, rails).
  const pieceDefs = all.flatMap((k) => k.defs);
  const partCap = Math.max(1, pieceDefs.length * 8);
  const cube1 = new MeshBuilder();
  cube1.box(0, 0, 0, 1, 1, 1, [1, 1, 1]);
  const cubeGeo = cube1.build();
  disposables.push(cubeGeo);
  const parts = new InstancedMesh(cubeGeo, mats.lit, partCap);
  parts.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < partCap; i++) parts.setColorAt(i, WHITE);
  parts.frustumCulled = false;
  parts.count = 0;
  group.add(parts);

  // Shadows on the road: a plane per piece that casts one, tinted dark and reddening as it is about to act.
  const shadowCount = pieceDefs.length;
  const quad = new PlaneGeometry(1, 1);
  quad.rotateX(-Math.PI / 2);
  disposables.push(quad);
  const shadowMat = new MeshBasicMaterial({ map: shadow, color: 0xffffff, transparent: true, opacity: 0.6, depthWrite: false, fog: false });
  disposables.push(shadowMat);
  const shadows = new InstancedMesh(quad, shadowMat, Math.max(1, shadowCount));
  shadows.instanceMatrix.setUsage(DynamicDrawUsage);
  for (let i = 0; i < Math.max(1, shadowCount); i++) shadows.setColorAt(i, WHITE);
  shadows.frustumCulled = false;
  shadows.renderOrder = 2;
  shadows.count = 0;
  group.add(shadows);
  for (const k of all) disposables.push({ dispose: () => k.mesh.dispose() });
  disposables.push({ dispose: () => parts.dispose() }, { dispose: () => shadows.dispose() });

  let partN = 0;
  let shadowN = 0;

  /** A unit cube from `a` to `b`, `t` thick, tinted `colour`. */
  function rod(ax: number, ay: number, az: number, bx: number, by: number, bz: number, t: number, colour: Color): void {
    if (partN >= partCap) return;
    _a.set(ax, ay, az);
    _b.set(bx, by, bz);
    const len = _a.distanceTo(_b);
    if (len < 1e-4) return;
    _p.copy(_a).add(_b).multiplyScalar(0.5);
    _b.sub(_a).divideScalar(len);
    _q.setFromUnitVectors(_fwd, _b);
    _s.set(t, t, len);
    parts.setMatrixAt(partN, _m.compose(_p, _q, _s));
    parts.setColorAt(partN, colour);
    partN++;
  }
  /** An axis-aligned cube at `x, y, z` of size `sx, sy, sz`, yawed by `yaw`. */
  function cube(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, colour: Color): void {
    if (partN >= partCap) return;
    _q.setFromAxisAngle(_up, yaw);
    parts.setMatrixAt(partN, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)));
    parts.setColorAt(partN, colour);
    partN++;
  }
  function blobShadow(x: number, y: number, z: number, size: number, colour: Color): void {
    if (shadowN >= shadows.instanceMatrix.count) return;
    shadows.setMatrixAt(shadowN, _m.compose(_p.set(x, y + 0.07, z), _q.identity(), _s.set(size, 1, size)));
    shadows.setColorAt(shadowN, colour);
    shadowN++;
  }

  const IRON = new Color(0.16, 0.16, 0.2);
  const BEAM = new Color(0.22, 0.2, 0.24);
  const RAIL = new Color(0.45, 0.42, 0.4);
  const SLEEPER = new Color(0.22, 0.13, 0.07);
  const POST = new Color(0.12, 0.12, 0.15);
  const ICE = new Color(0.55, 0.78, 0.95);
  const TIMBER = new Color(0.42, 0.26, 0.14);
  const CANDY = new Color(1.0, 0.86, 0.86);
  const GOLD = new Color(1.6, 1.15, 0.3);
  /** Things drawn once for a group of pieces (a gantry over a row of crushers, a sweeper's hub): this frame's keys. */
  const seen = new Set<number>();
  const tint = new Color();
  const shade = new Color();

  /** The instance colour for a piece about to act: its own colours flushing to hot, in a pulse that quickens. */
  function flush(warn: number, time: number, into: Color): Color {
    if (warn <= 0) return into.copy(WHITE);
    const pulse = 0.55 + 0.45 * Math.sin(time * (10 + warn * 14));
    const k = warn * pulse;
    return into.setRGB(1 + 1.6 * k, 1 - 0.55 * k, 1 - 0.7 * k);
  }

  function roadAt(pose: HazardPose, kind: Kind, index: number): number {
    let proj = track.project(pose.x, pose.z, kind.near[index]);
    if (Math.hypot(proj.sample.x - pose.x, proj.sample.z - pose.z) > 60) proj = track.project(pose.x, pose.z);
    kind.near[index] = proj.s;
    return proj.sample.y + env.bank.lift(proj.s, proj.offset);
  }

  return {
    group,
    update(time) {
      partN = 0;
      shadowN = 0;
      seen.clear();
      for (const kind of all) {
        const mesh = kind.mesh;
        for (let i = 0; i < kind.defs.length; i++) {
          const def = kind.defs[i]!;
          const pose = hazardAt(track, def, time);
          const roadY = roadAt(pose, kind, i);
          const model = MODELS[def.kind]!;
          let yaw = pose.heading;
          let y = roadY + pose.y;
          let x = pose.x;
          let z = pose.z;
          const sx = kind.scale;
          let tilt = 0;
          let hidden = false;
          switch (def.motion) {
            case "crush": {
              // The shake: a rattle sideways and a tilt that grows through the warning.
              const rattle = pose.warn < 1 ? pose.warn * 0.16 * Math.sin(time * 52 + i * 3) : 0;
              _a.set(Math.cos(pose.heading), 0, -Math.sin(pose.heading));
              x += _a.x * rattle;
              z += _a.z * rattle;
              yaw += rattle * 0.05;
              if (def.kind === "icicle") {
                // Hangs from the cave's roof: only the root of it shows.
                rod(x, y + 4.5 * kind.scale, z, x, y + 7 * kind.scale, z, 2.2 * kind.scale, ICE);
              } else {
                // A piston up to a gantry across the road (one for each row of them), on posts beyond the barrier.
                const centre = def.at * track.length;
                const beamY = roadY + crushTop(def) + 4.4 * kind.scale + 2.5;
                rod(x, y + (def.kind === "mallet" ? 5.6 : 3.4) * kind.scale, z, x, beamY, z, 0.9 * kind.scale, IRON);
                if (!seen.has(centre)) {
                  seen.add(centre);
                  const h = track.heading(centre);
                  const half = track.at(centre).width / 2 + 8;
                  const gx = Math.cos(h);
                  const gz = -Math.sin(h);
                  const c = track.point(centre, 0);
                  const wood = def.kind === "mallet" ? CANDY : TIMBER;
                  rod(c.x - gx * half, beamY + 0.5, c.z - gz * half, c.x + gx * half, beamY + 0.5, c.z + gz * half, 1.1, wood);
                  rod(c.x - gx * half, beamY + 0.5, c.z - gz * half, c.x - gx * half, roadY - 2, c.z - gz * half, 1.2, wood);
                  rod(c.x + gx * half, beamY + 0.5, c.z + gz * half, c.x + gx * half, roadY - 2, c.z + gz * half, 1.2, wood);
                }
              }
              blobShadow(x, roadY, z, def.radius * (1.8 + 1.2 * Math.min(1, pose.warn)) * (pose.y > 0.5 ? 1 : 1.05), shade.setRGB(0.03 + 0.7 * pose.warn * pose.warn, 0.04, 0.09 * (1 - pose.warn)));
              break;
            }
            case "swing": {
              // Chain from a trolley on a beam above the road to the ball's eye.
              const c = track.point(def.at * track.length, def.offset ?? 0);
              const hubY = roadY + 12;
              const eyeY = y + 3.45 * kind.scale;
              rod(c.x, hubY, c.z, x, eyeY, z, 0.28, IRON);
              const half = track.at(def.at * track.length).width / 2 + 9;
              const h = track.heading(def.at * track.length);
              // The beam across the road, on a post at each end beyond the barrier.
              const dx = Math.cos(h);
              const dz = -Math.sin(h);
              rod(c.x - dx * half, hubY + 0.4, c.z - dz * half, c.x + dx * half, hubY + 0.4, c.z + dz * half, 0.8, BEAM);
              rod(c.x - dx * half, hubY + 0.4, c.z - dz * half, c.x - dx * half, roadY - 2, c.z - dz * half, 0.9, POST);
              rod(c.x + dx * half, hubY + 0.4, c.z + dz * half, c.x + dx * half, roadY - 2, c.z + dz * half, 0.9, POST);
              blobShadow(x, roadY, z, def.radius * 2.2 * Math.max(0.5, 1 - pose.y / 6), shade.setRGB(0.03, 0.04, 0.09));
              tilt = 0;
              yaw = 0;
              break;
            }
            case "slide": {
              hidden = !pose.active;
              // Rails across the road under its path (sleepers, two rails), and a lamp post at the way in.
              const centre = def.at * track.length;
              const half = Math.abs(def.span ?? track.at(centre).width / 2 + 3);
              const d = (def.span ?? 1) < 0 ? -1 : 1;
              const h = track.heading(centre);
              const dx = Math.cos(h);
              const dz = -Math.sin(h);
              const c = track.point(centre, def.offset ?? 0);
              const gy = roadAtCentre(centre, def.offset ?? 0);
              for (const side of [-0.8, 0.8]) rod(c.x - dx * half - dz * side, gy + 0.12, c.z - dz * half + dx * side, c.x + dx * half - dz * side, gy + 0.12, c.z + dz * half + dx * side, 0.16, RAIL);
              for (let n = -2; n <= 2; n++) cube(c.x + dx * n * (half / 2.2) * 0.9, gy + 0.05, c.z + dz * n * (half / 2.2) * 0.9, 0.35, 0.1, 2.2, h, SLEEPER);
              // A lamp on a post where it comes in.
              const ex = c.x - dx * half * d;
              const ez = c.z - dz * half * d;
              cube(ex, gy + 1.6, ez, 0.25, 3.2, 0.25, 0, POST);
              flush(pose.warn, time, tint);
              tint.r = tint.r * 0.35 + (pose.warn > 0 ? 2.2 * (0.5 + 0.5 * Math.sin(time * 16)) : 0.1);
              tint.g = pose.warn > 0 ? 0.1 : 0.12;
              tint.b = pose.warn > 0 ? 0.08 : 0.12;
              cube(ex, gy + 3.35, ez, 0.7, 0.55, 0.7, 0, tint);
              if (!hidden) blobShadow(x, roadY, z, def.radius * 2.2, shade.setRGB(0.03, 0.04, 0.09));
              break;
            }
            case "orbit": {
              // The pole from the hub to the ball, and (once for the whole sweeper) a post at the hub.
              const c = track.point(def.at * track.length, def.offset ?? 0);
              const hubKey = def.at * 1e4 + (def.offset ?? 0);
              rod(c.x, roadY + 1.2, c.z, x, roadY + 1.3 * kind.scale, z, 0.5, def.kind === "arm-ball" ? CANDY : IRON);
              if (!seen.has(hubKey)) {
                seen.add(hubKey);
                rod(c.x, roadY, c.z, c.x, roadY + 5.5, c.z, 1.1, def.kind === "arm-ball" ? CANDY : IRON);
                rod(c.x, roadY + 5.5, c.z, c.x, roadY + 6.3, c.z, 1.6, GOLD);
              }
              blobShadow(x, roadY, z, def.radius * 2.2, shade.setRGB(0.03, 0.04, 0.09));
              break;
            }
            default:
              blobShadow(x, roadY, z, def.radius * 2.2, shade.setRGB(0.03, 0.04, 0.09));
          }
          _q.setFromAxisAngle(_up, yaw);
          if (tilt) {
            _q2.setFromAxisAngle(_fwd, tilt);
            _q.multiply(_q2);
          }
          if (hidden) {
            mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
          } else {
            mesh.setMatrixAt(i, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sx, sx)));
          }
          mesh.setColorAt(i, flush(pose.warn, time, tint));
        }
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
      parts.count = partN;
      parts.instanceMatrix.needsUpdate = true;
      if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
      shadows.count = shadowN;
      shadows.instanceMatrix.needsUpdate = true;
      if (shadows.instanceColor) shadows.instanceColor.needsUpdate = true;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };

  function roadAtCentre(s: number, offset: number): number {
    const p = track.at(s);
    return p.y + env.bank.lift(s, offset);
  }
}
