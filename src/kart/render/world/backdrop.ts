/**
 * The far parts of each world that are not ground: the kitchen's tiled walls,
 * window and the floor far below the counter; the volcano's great cone and
 * its smoke; the ringed planet under the space ribbon; the palm island's sea.
 * Built once, big and few: a handful of draw calls.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  type Material,
} from "three";
import { seededRandom } from "../../../engine/random";
import { makePoints } from "../points";
import { MeshBuilder, mixRgb, rgb, scaleRgb, shapes, type Paint, type Rgb } from "./builder";
import { DROP_DEPTH } from "./features";
import { seaMaterial, type Own } from "./materials";
import { SEA_LEVEL, type Terrain } from "./terrain";
import type { ThemeStyle } from "./themes";

export interface Backdrop {
  group: Group;
  update(time: number): void;
  dispose(): void;
}

function checker(size: number, a: string, b: string, tiles = 2): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const t = size / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? a : b;
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/** A tiled wall: glazed tiles with grout lines and a soft reflection on each. */
function tileTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#cfc6b6";
  ctx.fillRect(0, 0, S, S);
  const rnd = seededRandom(5);
  const n = 4;
  const t = S / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const g = ctx.createLinearGradient(i * t, j * t, i * t + t, j * t + t);
      const tint = 238 + Math.floor(rnd() * 12);
      g.addColorStop(0, `rgb(${tint},${tint - 3},${tint - 12})`);
      g.addColorStop(1, `rgb(${tint - 16},${tint - 18},${tint - 26})`);
      ctx.fillStyle = g;
      ctx.fillRect(i * t + 3, j * t + 3, t - 6, t - 6);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(i * t + 8, j * t + 8, t * 0.4, 3);
    }
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function buildBackdrop(style: ThemeStyle, terrain: Terrain, own: Own): Backdrop | null {
  const group = new Group();
  const disposables: { dispose(): void }[] = [];
  const updates: ((t: number) => void)[] = [];
  const track = <T extends { dispose(): void }>(d: T): T => {
    disposables.push(d);
    own.push(d);
    return d;
  };
  const cx = (terrain.minX + terrain.maxX) / 2;
  const cz = (terrain.minZ + terrain.maxZ) / 2;
  const hx = (terrain.maxX - terrain.minX) / 2;
  const hz = (terrain.maxZ - terrain.minZ) / 2;

  switch (style.id) {
    case "kitchen":
      kitchen(group, track, cx, cz, hx, hz);
      break;
    case "volcano":
      volcano(group, track, cx, cz, hx, hz);
      break;
    case "space":
      space(group, track, updates, terrain, cx, cz, hx, hz);
      break;
    case "palm": {
      const sea = seaMaterial(style, own);
      const geo = track(new PlaneGeometry(7000, 7000, 1, 1));
      geo.rotateX(-Math.PI / 2);
      const mesh = new Mesh(geo, sea.material);
      mesh.position.set(cx, SEA_LEVEL, cz);
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      group.add(mesh);
      updates.push((t) => sea.update(t));
      break;
    }
    default:
      return null;
  }
  return {
    group,
    update(time) {
      for (const u of updates) u(time);
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.removeFromParent();
    },
  };
}

// ─── The kitchen: tiled walls, a window of gold light, the floor far below ──

function kitchen(group: Group, track: <T extends { dispose(): void }>(d: T) => T, cx: number, cz: number, hx: number, hz: number): void {
  const floorY = -(DROP_DEPTH.kitchen + 8) - 0.5;
  // The floor of the room, black and cream squares fading away into the haze.
  const floorTex = track(checker(256, "#efe4cf", "#7f95ab", 2));
  floorTex.repeat.set(1200, 1200);
  const floorGeo = track(new PlaneGeometry(33600, 33600));
  floorGeo.rotateX(-Math.PI / 2);
  const floor = new Mesh(floorGeo, track(new MeshLambertMaterial({ map: floorTex })));
  floor.position.set(cx, floorY, cz);
  floor.frustumCulled = false;
  group.add(floor);

  // Two walls make the corner of the room the counter is pushed into: the window wall (the sun side) and a side wall.
  const tiles = track(tileTexture());
  const wallTop = 330;
  const tileTop = 74;
  const plaster = rgb("#f0dcc0");
  const cab = rgb("#f1e6d0");
  const cabDark = rgb("#c9aa7c");
  const wallMat = track(new MeshLambertMaterial({ map: tiles }));
  const solid = track(new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  const glow = track(new MeshBasicMaterial({ vertexColors: true, side: DoubleSide }));
  const south = cz - hz * 0.93;
  const west = cx - hx * 0.93;
  const wallLen = Math.max(hx, hz) * 2.6;
  const addWall = (alongX: boolean) => {
    // Tiles from the counter up, rows of them below as cabinet fronts, plaster above.
    const geo = track(new PlaneGeometry(wallLen, tileTop));
    const uv = geo.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (wallLen / 12), uv.getY(i) * (tileTop / 12));
    const m = new Mesh(geo, wallMat);
    if (alongX) {
      m.position.set(cx, tileTop / 2, south);
    } else {
      m.rotation.y = Math.PI / 2;
      m.position.set(west, tileTop / 2, cz);
    }
    group.add(m);
  };
  addWall(true);
  addWall(false);

  const b = new MeshBuilder();
  const g = new MeshBuilder();
  // Plaster above the tiles, cabinets under the counter and above, along both walls.
  const box = (alongX: boolean, u: number, y: number, w: number, h: number, depth: number, c: Paint, glowing = false) => {
    const target = glowing ? g : b;
    if (alongX) target.box(u, y, south + depth / 2, w, h, depth, c);
    else target.box(west + depth / 2, y, u, depth, h, w, c);
  };
  for (const alongX of [true, false]) {
    const origin = alongX ? cx : cz;
    const half = wallLen / 2;
    box(alongX, origin, (wallTop + tileTop) / 2, wallLen, wallTop - tileTop, 1.5, plaster);
    // Wall cabinets, a row of doors at head height.
    for (let u = -half + 30; u < half - 30; u += 74) {
      box(alongX, origin + u, 128, 66, 56, 22, { bottom: scaleRgb(cab, 0.8), top: cab });
      box(alongX, origin + u, 128, 56, 46, 22.6, cabDark);
      box(alongX, origin + u + 24, 112, 2.2, 14, 24.4, rgb("#d6dbe4"));
    }
    // Cabinet fronts under the counter, below the floor of the picture's reach: only the faces near the counter edge show.
    box(alongX, origin, -26, wallLen, 52, 1.5, cab);
  }
  // The window in the south wall: a bright pane in a white frame, with a halo of afternoon.
  const wx = cx + hx * 0.12;
  const wy = 46;
  const ww = 150;
  const wh = 120;
  const frame = rgb("#fbfaf6");
  const wall0 = south;
  g.box(wx, wy + wh / 2, wall0 + 2, ww, wh, 0.4, [3.4, 2.5, 1.3]);
  g.box(wx, wy + wh * 0.85, wall0 + 2.1, ww, wh * 0.3, 0.4, [3.0, 2.6, 1.9]);
  b.box(wx, wy - 3, wall0 + 4, ww + 12, 6, 9, frame);
  b.box(wx, wy + wh + 3, wall0 + 3, ww + 10, 6, 6, frame);
  for (const sx of [-1, 1]) b.box(wx + sx * (ww / 2 + 3), wy + wh / 2, wall0 + 3, 6, wh + 12, 6, frame);
  b.box(wx, wy + wh / 2, wall0 + 3, 4, wh, 4, frame);
  b.box(wx, wy + wh * 0.5, wall0 + 3, ww, 4, 4, frame);
  const solidGeo = track(b.build());
  const glowGeo = track(g.build());
  group.add(new Mesh(solidGeo, solid), new Mesh(glowGeo, glow));
  // The glow around the window, a big soft sprite.
  const halo = makePoints(2, true);
  const pos = halo.geometry.getAttribute("position");
  const col = halo.geometry.getAttribute("aColour");
  const size = halo.geometry.getAttribute("aSize");
  pos.setXYZ(0, wx, wy + wh / 2, wall0 + 14);
  col.setXYZW(0, 1.0, 0.72, 0.36, 0.55);
  size.setX(0, 330);
  pos.setXYZ(1, wx, wy + wh / 2, wall0 + 30);
  col.setXYZW(1, 1.0, 0.85, 0.55, 0.35);
  size.setX(1, 170);
  halo.renderOrder = 4;
  group.add(halo);
  track({
    dispose() {
      halo.geometry.dispose();
      (halo.material as Material).dispose();
    },
  });
}

// ─── The volcano: a great cone with a lit crater and a plume of smoke ───────

function volcano(group: Group, track: <T extends { dispose(): void }>(d: T) => T, cx: number, cz: number, hx: number, hz: number): void {
  const rnd = seededRandom(77);
  const b = new MeshBuilder();
  const g = new MeshBuilder();
  const smoke = new MeshBuilder();
  const baseX = cx + hx * 0.18;
  const baseZ = cz + hz * 0.96;
  const R = Math.min(hx, hz) * 0.62;
  const H = 360;
  const rock = rgb("#1b1820");
  const rockLight = rgb("#463f4a");
  // The cone: rings of facets with ridges, the lower slopes buried in the haze.
  const rings = 9;
  const sides = 22;
  const ringPt = (k: number, a: number) => {
    const t = k / rings;
    const r = R * Math.pow(1 - t, 1.25) + 34 * (1 - t) * (1 - t) * 0;
    const ridge = 1 + 0.12 * Math.sin(a * 7 + k * 0.6) + 0.07 * Math.sin(a * 13);
    const rr = k === rings ? 38 : r * ridge;
    return [baseX + Math.cos(a) * rr, -30 + t * H * (1 + 0.04 * Math.sin(a * 3)), baseZ + Math.sin(a) * rr] as const;
  };
  for (let k = 0; k < rings; k++) {
    for (let j = 0; j < sides; j++) {
      const a0 = (j / sides) * Math.PI * 2;
      const a1 = ((j + 1) / sides) * Math.PI * 2;
      const c0 = mixRgb(rock, rockLight, ((k / rings) * 0.7 + (j % 3) * 0.1));
      const c1 = mixRgb(rock, rockLight, (((k + 1) / rings) * 0.7 + (j % 3) * 0.1));
      b.quad(ringPt(k, a0), ringPt(k, a1), ringPt(k + 1, a1), ringPt(k + 1, a0), c0, c0, c1, c1);
    }
  }
  // Rivers of lava down the flanks, zigzagging.
  for (let s = 0; s < 7; s++) {
    const a = (s / 7) * Math.PI * 2 + rnd() * 0.3;
    let prev = ringPt(rings, a);
    let aa = a;
    for (let k = rings - 1; k >= 2; k--) {
      aa += (rnd() - 0.5) * 0.22;
      const p = ringPt(k, aa);
      const w = 5 + (rings - k) * 1.1;
      g.rod([prev[0], prev[1] + 0.8, prev[2]], [p[0], p[1] + 0.8, p[2]], w, [3.6 - (rings - k) * 0.2, 1.1, 0.16]);
      prev = p;
    }
  }
  // The crater's glow and the smoke, rising and leaning with the wind.
  g.blob(baseX, H - 30 + 10, baseZ, 42, 10, 42, [4, 1.6, 0.3], 1);
  for (let k = 0; k < 14; k++) {
    const t = k / 13;
    const r = 40 + t * 120;
    smoke.blob(baseX + t * t * 260 + (rnd() - 0.5) * 30, H + 30 + t * 520, baseZ + (rnd() - 0.5) * 40, r, r * 0.8, r, mixRgb(rgb("#3a2a2e"), rgb("#7a5148"), t * 0.5 + rnd() * 0.2), 1);
  }
  const lit = track(new MeshLambertMaterial({ vertexColors: true }));
  const emissive = track(new MeshBasicMaterial({ vertexColors: true, fog: false }));
  const smokeMat = track(new MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, emissive: new Color(0.12, 0.04, 0.03) }));
  const mesh = new Mesh(track(b.build()), lit);
  const glowMesh = new Mesh(track(g.build()), emissive);
  const smokeMesh = new Mesh(track(smoke.build()), smokeMat);
  smokeMesh.renderOrder = 2;
  for (const m of [mesh, glowMesh, smokeMesh]) m.frustumCulled = false;
  group.add(mesh, glowMesh, smokeMesh);
}

// ─── Space: a ringed planet below the road, moons, a far sun's glare ────────

function space(group: Group, track: <T extends { dispose(): void }>(d: T) => T, updates: ((t: number) => void)[], terrain: Terrain, cx: number, cz: number, hx: number, hz: number): void {
  const rnd = seededRandom(3);
  const b = new MeshBuilder();
  const glassRing = new MeshBuilder();
  const R = 900;
  const centre = [cx - hx * 0.15, -R * 0.95 - 160, cz + hz * 0.45] as const;
  const bands: Rgb[] = ["#e8c58c", "#d79a5c", "#b8683e", "#f3dcb4", "#c98a58", "#8f4f3a", "#e8b680"].map(rgb);
  // The planet: a faceted ball with bands of colour by latitude and a stormy swirl.
  const shape = shapes.ball(2);
  const pos = shape.positions;
  const col = (y: number, x: number, z: number): Rgb => {
    const lat = y;
    const band = bands[Math.floor(((lat + 1) / 2) * bands.length * 1.6 + Math.sin(x * 4 + z * 3) * 0.35) % bands.length]!;
    const storm = Math.exp(-(((x - 0.55) ** 2 + (y + 0.25) ** 2 + (z - 0.4) ** 2) / 0.04));
    return mixRgb(band, rgb("#fff0d8"), storm * 0.6);
  };
  for (let i = 0; i < pos.length; i += 9) {
    const p = [0, 1, 2].map((k) => [pos[i + k * 3]!, pos[i + k * 3 + 1]!, pos[i + k * 3 + 2]!] as const);
    const cm = [(p[0]![0] + p[1]![0] + p[2]![0]) / 3, (p[0]![1] + p[1]![1] + p[2]![1]) / 3, (p[0]![2] + p[1]![2] + p[2]![2]) / 3];
    const c = col(cm[1]!, cm[0]!, cm[2]!);
    const w = p.map(([x, y, z]) => [centre[0] + x * R, centre[1] + y * R, centre[2] + z * R] as [number, number, number]);
    b.tri(w[0]!, w[1]!, w[2]!, c);
  }
  // The rings: flat annuli, tilted, in a few bands of different density.
  const tilt = 0.42;
  const ringBand = (r0: number, r1: number, colour: Rgb, glass: boolean) => {
    const seg = 64;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2;
      const a1 = ((k + 1) / seg) * Math.PI * 2;
      const pt = (r: number, a: number): [number, number, number] => {
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        return [centre[0] + x, centre[1] + z * Math.sin(tilt), centre[2] + z * Math.cos(tilt)];
      };
      (glass ? glassRing : b).quad(pt(r0, a0), pt(r1, a0), pt(r1, a1), pt(r0, a1), colour);
    }
  };
  ringBand(R * 1.35, R * 1.55, rgb("#d9c2a0"), false);
  ringBand(R * 1.58, R * 1.9, rgb("#b09a82"), true);
  ringBand(R * 1.93, R * 2.1, rgb("#e5d3b6"), false);
  // Moons.
  b.blob(cx + hx * 0.8, 260, cz - hz * 0.7, 70, 70, 70, { bottom: rgb("#6c6a82"), top: rgb("#cfcde6") }, 2);
  b.blob(cx - hx * 1.1, 520, cz + hz * 0.2, 36, 36, 36, { bottom: rgb("#8a5a50"), top: rgb("#e8b8a8") }, 1);
  const mat = track(new MeshLambertMaterial({ vertexColors: true, fog: false }));
  const glassMat = track(new MeshLambertMaterial({ vertexColors: true, fog: false, transparent: true, opacity: 0.45, depthWrite: false, side: DoubleSide }));
  const planet = new Mesh(track(b.build()), mat);
  const rings = new Mesh(track(glassRing.build()), glassMat);
  planet.frustumCulled = rings.frustumCulled = false;
  group.add(planet, rings);
  // Specks of dust and ice drifting between the road and the stars.
  const count = 700;
  const dust = makePoints(count, true);
  const dp = dust.geometry.getAttribute("position");
  const dc = dust.geometry.getAttribute("aColour");
  const ds = dust.geometry.getAttribute("aSize");
  for (let i = 0; i < count; i++) {
    dp.setXYZ(i, cx + (rnd() * 2 - 1) * hx * 1.3, -80 + rnd() * 260, cz + (rnd() * 2 - 1) * hz * 1.3);
    const warm = rnd();
    dc.setXYZW(i, 0.7 + warm * 0.3, 0.8, 1.0 - warm * 0.2, 0.25 + rnd() * 0.5);
    ds.setX(i, 0.7 + rnd() * 1.3);
  }
  dp.needsUpdate = dc.needsUpdate = ds.needsUpdate = true;
  group.add(dust);
  track({
    dispose() {
      dust.geometry.dispose();
      (dust.material as Material).dispose();
    },
  });
  updates.push((t) => {
    planet.rotation.y = t * 0.0006;
  });
}
