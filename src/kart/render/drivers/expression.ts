/**
 * A driver's brows and mouth, drawn live so they can change: set and
 * determined while racing, low and gritted in a hard bend, raised with an O
 * when dizzy or hit, arched over a wide open grin at a cheer or the finish.
 *
 * The modelled drivers (drivers.glb) no longer carry brows or smiles; this
 * puts them back on the head, pressed to its surface (the front of the head
 * is probed where each brow and the mouth go, as the eyelids do). One mesh
 * per driver, in the kart material, whose geometry is swapped for the mood:
 * a geometry per species and mood is built once and shared by every driver of
 * the species. The face is welded into the head's own mesh (the head's
 * geometry with the mood's face, made the first time a driver wears that
 * mood), so a change of face is a swap of geometry and costs no draw call
 * and no shader.
 *
 * Only the modelled drivers wear it (the code-built stand-ins have their own
 * brows and mouths built in).
 */
import { BufferGeometry, CatmullRomCurve3, Matrix4, TubeGeometry, Vector3, type Mesh } from "three";
import { MeshBuilder, mergeBaked, rgb, type Rgb } from "../kartBuilder";
import { SURF } from "../kartMaterial";
import type { Species } from "./types";

export type Mood = "calm" | "determined" | "effort" | "shocked" | "happy";
export const MOODS: readonly Mood[] = ["calm", "determined", "effort", "shocked", "happy"];

interface BrowSpec {
  /** The eye's x (the left one's), and the brow's height, length, slant (positive: the outer end up), arch and thickness. */
  x: number;
  y: number;
  length: number;
  slant: number;
  arch: number;
  r: number;
  colour: string;
}

interface MouthSpec {
  /** Half its width, the height it sits at, how far a smile droops at the middle, and the line's thickness. */
  half: number;
  y: number;
  depth: number;
  r: number;
  colour: string;
  /** A mouth too wide for an open shape (a frog's) opens narrower. */
  wide?: boolean;
}

interface FaceSpec {
  brow?: BrowSpec;
  mouth?: MouthSpec;
}

/** Where each species' brows and mouth are, in the head's space (the numbers its model was built to carry them at). */
export const FACES: Partial<Record<Species, FaceSpec>> = {
  rabbit: { brow: { x: 0.115, y: 0.118, length: 0.07, slant: 0.25, arch: 0.01, r: 0.0075, colour: "#8c7468" }, mouth: { half: 0.045, y: -0.098, depth: 0.016, r: 0.0052, colour: "#8a5a55" } },
  penguin: { brow: { x: 0.1, y: 0.105, length: 0.07, slant: 0.2, arch: 0.01, r: 0.0075, colour: "#232738" } },
  frog: { mouth: { half: 0.16, y: -0.095, depth: 0.04, r: 0.0062, colour: "#2f3a22", wide: true } },
  fox: { brow: { x: 0.118, y: 0.128, length: 0.085, slant: 0.3, arch: 0.012, r: 0.0085, colour: "#3a231d" }, mouth: { half: 0.075, y: -0.112, depth: 0.02, r: 0.0058, colour: "#3f2620" } },
  otter: { brow: { x: 0.115, y: 0.122, length: 0.075, slant: 0.28, arch: 0.01, r: 0.008, colour: "#3e281a" }, mouth: { half: 0.07, y: -0.145, depth: 0.025, r: 0.0055, colour: "#4a2e20" } },
  cat: { brow: { x: 0.115, y: 0.125, length: 0.07, slant: 0.3, arch: 0.01, r: 0.0075, colour: "#a85514" } },
  bear: { brow: { x: 0.13, y: 0.13, length: 0.08, slant: -0.15, arch: 0.012, r: 0.0095, colour: "#3a2113" }, mouth: { half: 0.055, y: -0.135, depth: 0.03, r: 0.0055, colour: "#1d1816" } },
  duck: { brow: { x: 0.125, y: 0.14, length: 0.075, slant: 0.3, arch: 0.012, r: 0.008, colour: "#9a7a14" } },
};

/** How a mood moves the brows: slant added, arch multiplied, lift in metres, thickness multiplied. */
const BROWS: Record<Mood, { slant: number; arch: number; lift: number; thick: number }> = {
  calm: { slant: -0.1, arch: 1, lift: 0, thick: 1 },
  determined: { slant: 0.2, arch: 0.6, lift: -0.008, thick: 1.25 },
  effort: { slant: 0.4, arch: 0.4, lift: -0.016, thick: 1.45 },
  shocked: { slant: -0.55, arch: 2.2, lift: 0.032, thick: 1 },
  happy: { slant: -0.3, arch: 2.6, lift: 0.022, thick: 1.05 },
};

const INK: Rgb = [0.05, 0.03, 0.04];
const TONGUE: Rgb = rgb("#e8607a");
const TEETH: Rgb = rgb("#f6f2ea");

/** The front of the head at (x, y): the highest z of its vertices within `r`, or null where there is no head. */
function frontAt(head: BufferGeometry, x: number, y: number, r: number): number | null {
  const p = head.getAttribute("position");
  let z = -Infinity;
  for (let i = 0; i < p.count; i++) {
    if (Math.abs(p.getX(i) - x) < r && Math.abs(p.getY(i) - y) < r) z = Math.max(z, p.getZ(i));
  }
  return Number.isFinite(z) ? z : null;
}

function surface(head: BufferGeometry, x: number, y: number): number {
  return frontAt(head, x, y, 0.025) ?? frontAt(head, x, y, 0.07) ?? 0.2;
}

const cache = new Map<string, BufferGeometry>();

/** A smooth thin tube through `points`. */
function thread(b: MeshBuilder, points: Vector3[], r: number, paint: Rgb): void {
  const g = new TubeGeometry(new CatmullRomCurve3(points), 8, r, 5, false);
  b.geometry(g, new Matrix4(), paint);
  g.dispose();
}

function brow(b: MeshBuilder, head: BufferGeometry, spec: BrowSpec, mood: Mood): void {
  const m = BROWS[mood];
  const paint = rgb(spec.colour);
  for (const sx of [-1, 1]) {
    const pts: Vector3[] = [];
    const n = 5;
    for (let k = 0; k < n; k++) {
      const t = -1 + (2 * k) / (n - 1);
      const px = sx * spec.x + t * spec.length * 0.5 * sx;
      // The brow's own height with the mood on it; the surface is read at its calm height (above the eye, the helmet's peak may come in).
      const calmY = spec.y + t * spec.length * 0.5 * spec.slant + spec.arch * (1 - t * t);
      const py = spec.y + m.lift + t * spec.length * 0.5 * (spec.slant + m.slant) + spec.arch * m.arch * (1 - t * t);
      const z = surface(head, px, calmY) + 0.004 - Math.max(0, m.lift) * 0.5;
      pts.push(new Vector3(px, py, z));
    }
    b.as(SURF.cloth, () => thread(b, pts, spec.r * m.thick, paint));
  }
}

function mouth(b: MeshBuilder, head: BufferGeometry, spec: MouthSpec, mood: Mood): void {
  const paint = rgb(spec.colour);
  const at = (x: number, y: number): number => surface(head, x, y);
  const arc = (half: number, y: number, depth: number, r: number): void => {
    const pts: Vector3[] = [];
    const n = 7;
    for (let k = 0; k < n; k++) {
      const x = -half + (2 * half * k) / (n - 1);
      const yy = y - depth * (1 - (x / half) ** 2);
      pts.push(new Vector3(x, yy, at(x, yy) + 0.002));
    }
    b.as(SURF.cloth, () => thread(b, pts, r, paint));
  };
  const open = (rx: number, ry: number, y: number, tongue: number): void => {
    const z = at(0, y) - 0.004;
    b.as(SURF.cloth, () => b.blob(0, y, z, rx, ry, 0.014, INK, 1));
    if (tongue > 0) b.as(SURF.fur, () => b.blob(0, y - ry * 0.45, z + 0.004, rx * tongue, ry * 0.5, 0.012, TONGUE, 0));
  };
  const w = spec.wide ? 0.55 : 1;
  switch (mood) {
    case "calm":
      arc(spec.half, spec.y, spec.depth, spec.r);
      break;
    case "determined":
      arc(spec.half * 0.9, spec.y + 0.004, spec.depth * 0.4, spec.r * 1.15);
      break;
    case "effort": {
      // Teeth gritted: a thin dark slot with a row of white.
      const half = spec.half * 0.9 * (spec.wide ? 0.6 : 1);
      b.as(SURF.cloth, () => b.blob(0, spec.y, at(0, spec.y) - 0.003, half, 0.017, 0.012, INK, 1));
      b.as(SURF.fur, () => b.blob(0, spec.y + 0.004, at(0, spec.y) + 0.002, half * 0.8, 0.007, 0.01, TEETH, 0));
      break;
    }
    case "shocked":
      open(Math.max(0.024, spec.half * 0.36) * (spec.wide ? 0.6 : 1), 0.042, spec.y - 0.025, 0.7);
      break;
    case "happy":
      open(spec.half * 0.82 * w, 0.036, spec.y - spec.depth * 0.4 - 0.008, 0.55);
      arc(spec.half * 1.05 * w, spec.y + 0.012, spec.depth * 1.2, spec.r * 1.1);
      break;
  }
}

/** The face geometry for `species` in `mood`, in the head's space, or null when the species wears none. */
function faceGeometry(species: Species, head: BufferGeometry, mood: Mood): BufferGeometry | null {
  const spec = FACES[species];
  if (!spec) return null;
  // Heads differ by driver only through their colours, so a species' face is made once (keyed by what it read of the head).
  const key = `${species}|${mood}|${surface(head, spec.brow?.x ?? 0, spec.brow?.y ?? spec.mouth?.y ?? 0).toFixed(3)}`;
  let g = cache.get(key);
  if (!g) {
    const b = new MeshBuilder();
    if (spec.brow) brow(b, head, spec.brow, mood);
    if (spec.mouth) mouth(b, head, spec.mouth, mood);
    g = b.build();
    cache.set(key, g);
  }
  return g;
}

/** What a driver's mood is, from what the rig knows of them. */
export function moodOf(m: { happy: number; dizzy: number; steer: number; rest: number }): Mood {
  if (m.dizzy > 0.35) return "shocked";
  if (m.happy > 0.4) return "happy";
  if (Math.abs(m.steer) > 0.72) return "effort";
  if (m.rest < 0.5) return "determined";
  return "calm";
}

/** The brows and mouth on one driver's head. */
export class Face {
  private readonly faces: (BufferGeometry | null)[];
  /** The head with each mood's face welded on, made when first worn. */
  private readonly worn: (BufferGeometry | null)[] = MOODS.map(() => null);
  private mood: Mood = "calm";
  private since = -Infinity;

  /** `head` is the head's own geometry, `mesh` the mesh that draws it (its geometry is swapped for the mood's). */
  constructor(
    species: Species,
    private readonly head: BufferGeometry,
    private readonly mesh: Mesh,
  ) {
    this.faces = MOODS.map((m) => faceGeometry(species, head, m));
    if (!this.faces[0]) throw new Error("no face");
    this.show(0);
  }

  get current(): Mood {
    return this.mood;
  }

  private show(i: number): void {
    let g = this.worn[i];
    if (!g) {
      g = mergeBaked([
        { geometry: this.head, matrix: new Matrix4() },
        { geometry: this.faces[i] ?? this.faces[0]!, matrix: new Matrix4() },
      ]);
      this.worn[i] = g;
    }
    this.mesh.geometry = g;
  }

  /** Shows `mood` at `time`: a mood is held a moment before it gives way to a milder one, so a flick of the wheel does not flicker a face. */
  update(time: number, mood: Mood): void {
    if (mood !== this.mood) {
      const urgent = mood === "shocked" || mood === "happy" || this.mood === "calm";
      if (urgent || time - this.since > 0.22 || time < this.since) {
        this.mood = mood;
        this.since = time;
        this.show(MOODS.indexOf(mood));
      }
    }
  }

  dispose(): void {
    for (const g of this.worn) g?.dispose();
  }
}
