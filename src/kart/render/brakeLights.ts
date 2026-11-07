/**
 * The brake lights: when a kart slows hard, its tail lamps flare. They are a
 * second skin laid a hair over the tail lamps (the art's own, or the
 * code-built kart's two bars), in one shared additive material, so the lamps
 * burn a hot red-white over their steady glow and the bloom takes them. One
 * extra draw call while a kart brakes, none when it does not (the mesh is
 * hidden), and no shader of its own.
 */
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Vector3 } from "three";
import type { Base } from "./kartArt";
import { MeshBuilder } from "./kartBuilder";

/** The lamps' hot colour, over-bright so the bloom takes it. */
const HOT: readonly [number, number, number] = [1.25, 0.07, 0.04];

let material: MeshBasicMaterial | null = null;

/** The one material every kart's brake lights share. */
function brakeMaterial(): MeshBasicMaterial {
  material ??= new MeshBasicMaterial({ vertexColors: true, blending: AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0.95 });
  return material;
}

export interface BrakeLights {
  mesh: Mesh;
  /** 0 off .. 1 full: lit and a little larger as the brake bites. */
  show(amount: number): void;
}

/** The art's tail lamps as a skin over them, about their own middle, or null if the art has none. */
function skinOf(base: Base): { geometry: BufferGeometry; at: Vector3 } | null {
  const mask = base.tail;
  const src = base.geometry;
  if (!mask || !src.index) return null;
  const pos = src.getAttribute("position");
  const nor = src.getAttribute("normal");
  const idx = src.index;
  const used = new Map<number, number>();
  const position: number[] = [];
  const index: number[] = [];
  const lift = 0.014;
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    if (!mask[a] || !mask[b] || !mask[c]) continue;
    for (const v of [a, b, c]) {
      let at = used.get(v);
      if (at === undefined) {
        at = position.length / 3;
        used.set(v, at);
        position.push(pos.getX(v) + nor.getX(v) * lift, pos.getY(v) + nor.getY(v) * lift, pos.getZ(v) + nor.getZ(v) * lift);
      }
      index.push(at);
    }
  }
  if (!index.length) return null;
  const centre = new Vector3();
  for (let i = 0; i < position.length; i += 3) centre.add(new Vector3(position[i], position[i + 1], position[i + 2]));
  centre.multiplyScalar(3 / position.length);
  // About the middle across, so growing it spreads the lamps in height and depth only.
  centre.x = 0;
  const colour: number[] = [];
  for (let i = 0; i < position.length; i += 3) {
    position[i + 1]! -= centre.y;
    position[i + 2]! -= centre.z;
    colour.push(HOT[0], HOT[1], HOT[2]);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(position, 3));
  g.setAttribute("color", new Float32BufferAttribute(colour, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return { geometry: g, at: centre };
}

/** The code-built kart's two bars (kartModel.ts puts its lamps there). */
function barsOf(): { geometry: BufferGeometry; at: Vector3 } {
  const b = new MeshBuilder();
  for (const sx of [-1, 1]) b.slab(sx * 0.4, 0, 0, 0.23, 0.08, 0.06, 0.025, [HOT[0], HOT[1], HOT[2]]);
  const g = b.build();
  g.deleteAttribute("aSurf");
  g.deleteAttribute("normal");
  return { geometry: g, at: new Vector3(0, 0.86, -1.31) };
}

/** Brake lights for a kart made from `base` (the art's body) or, with none, for the code-built one; null if the art has no tail lamps. */
export function brakeLights(base: Base | null): BrakeLights | null {
  const skin = base ? skinOf(base) : barsOf();
  if (!skin) return null;
  const mesh = new Mesh(skin.geometry, brakeMaterial());
  mesh.position.copy(skin.at);
  mesh.visible = false;
  mesh.renderOrder = 11;
  mesh.frustumCulled = false;
  return {
    mesh,
    show(amount) {
      const on = amount > 0.04;
      mesh.visible = on;
      if (on) {
        const s = 0.9 + 0.3 * Math.min(1, amount);
        mesh.scale.set(1, s, s);
      }
    },
  };
}
