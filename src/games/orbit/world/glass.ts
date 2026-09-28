/**
 * The seven panes as glass: clean and nearly invisible until something
 * strikes it, then marked where it struck - a chip, then cracks, then a
 * spider web - drawn into each pane's own texture and lit by the sun, so a
 * crack's facets catch the light as it comes through. Mending fades the
 * marks as the rules say. A pane that fails bursts outward and leaves a
 * jagged hole; then every window's shutter slams.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  ShaderMaterial,
  Vector2,
  Vector3,
  type BufferGeometry,
} from "three";
import type { Mark } from "../rules/panes";

const SIZE = 512;

const VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAGMENT = /* glsl */ `
uniform sampler2D tMarks;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uHole;
uniform float uBroken;
uniform float uFlash;
varying vec2 vUv;
varying vec3 vWorld;
varying vec3 vNormal;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 N = normalize(vNormal);
  if (dot(N, V) < 0.0) N = -N;
  vec4 m = texture2D(tMarks, vUv);
  // A failed pane: a jagged hole round where it gave way, shards left in the frame.
  if (uBroken > 0.0) {
    vec2 d = vUv - uHole.xy;
    float a = atan(d.y, d.x);
    float jag = 0.08 * sin(a * 7.0 + 1.3) + 0.05 * sin(a * 13.0 + 0.4) + 0.04 * sin(a * 29.0);
    if (length(d) < uHole.z * (1.0 + jag) * uBroken) discard;
  }
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 5.0);
  // The clean glass: all but invisible, a breath of reflection at a slant.
  vec3 col = vec3(0.6, 0.7, 0.8) * (0.015 + 0.3 * fres);
  float alpha = 0.02 + 0.4 * fres;
  // Each crack's face turned its own way (the texture's blue): some catch the sun.
  float tilt = (m.b - 0.5) * 1.6;
  vec3 Nc = normalize(N + vec3(tilt, -tilt * 0.7, tilt * 0.4));
  vec3 L = normalize(uSun);
  vec3 H = normalize(L + V);
  // Most of a crack is a faint grey line; the stretches turned to the sun flash.
  float catchLight = pow(max(dot(Nc, H), 0.0), 40.0) * 1.6 + max(dot(Nc, L), 0.0) * 0.12;
  float crack = m.r;
  float frost = m.g;
  vec3 lit = uSunColor * catchLight + vec3(0.1, 0.11, 0.13);
  col += crack * lit + frost * (uSunColor * 0.22 * max(dot(N, L), 0.0) + vec3(0.07, 0.075, 0.085));
  alpha = max(alpha, max(crack * 0.85, frost * 0.5));
  // The weld's blue light on the glass, and the strike's own.
  col += vec3(0.4, 0.6, 1.0) * uFlash * 0.4;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
`;

interface Pane {
  id: number;
  mesh: Mesh;
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  texture: CanvasTexture;
  material: ShaderMaterial;
  /** The marks drawn, as last drawn (id → how much showed). */
  drawn: Map<number, number>;
  shutter: Mesh;
  shutterT: number;
  normal: Vector3;
  localNormal: Vector3;
  center: Vector3;
}

const raycaster = new Raycaster();
const tmp = new Vector3();

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Glass {
  private readonly panes = new Map<number, Pane>();
  /** Where each mark was drawn on its pane (UV), worked out once. */
  private readonly uvs = new Map<number, Vector2>();
  private readonly sunDir = new Vector3(0, 1, 0);
  private readonly sunColor = new Color(1, 1, 1);
  private shuttering = false;

  constructor(meshes: Map<number, Mesh>, private readonly eye: Vector3) {
    for (const [id, mesh] of meshes) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = SIZE;
      const g = canvas.getContext("2d");
      if (!g) continue;
      const texture = new CanvasTexture(canvas);
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      const material = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: {
          tMarks: { value: texture },
          uSun: { value: this.sunDir },
          uSunColor: { value: this.sunColor },
          uHole: { value: new Vector3(0.5, 0.5, 0) },
          uBroken: { value: 0 },
          uFlash: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      mesh.material = material;
      mesh.renderOrder = 5;
      mesh.visible = true;
      g.clearRect(0, 0, SIZE, SIZE);
      // The pane's plane: centre and outward normal.
      const geo = mesh.geometry as BufferGeometry;
      geo.computeBoundingSphere();
      mesh.updateMatrixWorld(true);
      const center = geo.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld);
      const nrm = geo.getAttribute("normal");
      const normal = nrm ? new Vector3().fromBufferAttribute(nrm, 0).transformDirection(mesh.matrixWorld) : center.clone().sub(eye).normalize();
      if (normal.dot(center.clone().sub(eye)) < 0) normal.negate();
      // The outer shutter: the pane's own shape a hand's width outside, brushed metal.
      const shutter = new Mesh(geo, new MeshStandardMaterial({ color: "#8d9298", metalness: 0.9, roughness: 0.42, side: DoubleSide }));
      shutter.name = `shutter.${id}`;
      shutter.visible = false;
      shutter.renderOrder = 6;
      mesh.add(shutter);
      // The outward normal in the pane's own frame, for sliding the shutter along it.
      const localNormal = normal.clone().transformDirection(mesh.matrixWorld.clone().invert());
      this.panes.set(id, { id, mesh, canvas, g, texture, material, drawn: new Map(), shutter, shutterT: -1, normal, localNormal, center });
    }
  }

  /** The shutters' materials (to be tone-mapped with the rest). */
  get shutterMeshes(): Mesh[] {
    return [...this.panes.values()].map((p) => p.shutter);
  }

  setSun(dir: Vector3, colour: Color): void {
    this.sunDir.copy(dir);
    this.sunColor.copy(colour);
  }

  /** Where on its pane (UV) a mark is. */
  private uvOf(mark: Mark): Vector2 | null {
    const known = this.uvs.get(mark.id);
    if (known) return known;
    const pane = this.panes.get(mark.pane);
    if (!pane) return null;
    const p = tmp.set(mark.point.x, mark.point.y, mark.point.z);
    // From the eye to the point, and a little past: the pane is in between.
    const dir = p.clone().sub(this.eye);
    const len = dir.length();
    raycaster.set(this.eye, dir.normalize());
    raycaster.far = len + 1;
    const hits = raycaster.intersectObject(pane.mesh, false);
    let uv = hits[0]?.uv?.clone() ?? null;
    if (!uv) {
      // Just off the glass (a strike at its very edge): nearest the middle.
      raycaster.set(this.eye, pane.center.clone().sub(this.eye).normalize());
      uv = raycaster.intersectObject(pane.mesh, false)[0]?.uv?.clone() ?? new Vector2(0.5, 0.5);
    }
    this.uvs.set(mark.id, uv);
    return uv;
  }

  /** Draw what the rules' marks say, on any pane whose marks changed. */
  sync(marks: readonly Mark[]): void {
    const byPane = new Map<number, Mark[]>();
    for (const m of marks) {
      const list = byPane.get(m.pane) ?? [];
      list.push(m);
      byPane.set(m.pane, list);
    }
    for (const pane of this.panes.values()) {
      const list = byPane.get(pane.id) ?? [];
      let changed = list.length !== pane.drawn.size;
      for (const m of list) if (Math.abs((pane.drawn.get(m.id) ?? -1) - m.left) > 0.04) changed = true;
      if (!changed) continue;
      this.redraw(pane, list);
    }
  }

  private redraw(pane: Pane, marks: Mark[]): void {
    const g = pane.g;
    g.clearRect(0, 0, SIZE, SIZE);
    pane.drawn.clear();
    for (const m of marks) {
      const uv = this.uvOf(m);
      if (!uv) continue;
      pane.drawn.set(m.id, m.left);
      drawMark(g, uv.x * SIZE, (1 - uv.y) * SIZE, m.size, m.left, m.id);
    }
    pane.texture.needsUpdate = true;
  }

  /** The weld's light on a pane, 0..1. */
  weldLight(pane: number | null, amount: number): void {
    for (const p of this.panes.values()) p.material.uniforms["uFlash"]!.value = p.id === pane ? amount : 0;
  }

  /** A pane gives way where it was struck. */
  fail(pane: number, point: Vector3): void {
    const p = this.panes.get(pane);
    if (!p) return;
    const uv = this.uvOf({ id: -1 - pane, pane, point, size: "web", cost: 0, left: 1, at: 0 }) ?? new Vector2(0.5, 0.5);
    p.material.uniforms["uHole"]!.value.set(uv.x, uv.y, 0.6);
    p.material.uniforms["uBroken"]!.value = 0.001;
  }

  /** Every window's shutter comes down. */
  slam(): void {
    this.shuttering = true;
    let i = 0;
    for (const p of this.panes.values()) {
      p.shutter.visible = true;
      p.shutterT = -0.05 * i++;
    }
  }

  /** Where a pane is (its middle and outward normal). */
  pane(id: number): { center: Vector3; normal: Vector3 } | null {
    const p = this.panes.get(id);
    return p ? { center: p.center, normal: p.normal } : null;
  }

  update(dt: number): void {
    for (const p of this.panes.values()) {
      const broken = p.material.uniforms["uBroken"]!;
      if (broken.value > 0 && broken.value < 1) broken.value = Math.min(1, broken.value + dt * 9);
      if (!this.shuttering) continue;
      p.shutterT += dt;
      const t = Math.max(0, Math.min(1, p.shutterT / 0.28));
      // Slammed: fast, a small rebound, shut.
      const k = t < 1 ? t * t * (3 - 2 * t) : 1;
      const bounce = t >= 1 ? Math.exp(-(p.shutterT - 0.28) * 14) * Math.sin((p.shutterT - 0.28) * 40) * 0.04 : 0;
      p.shutter.position.copy(p.localNormal).multiplyScalar(0.08 + (1 - k) * 0.9 + bounce);
    }
  }

  reset(): void {
    this.shuttering = false;
    this.uvs.clear();
    for (const p of this.panes.values()) {
      p.material.uniforms["uBroken"]!.value = 0;
      p.material.uniforms["uFlash"]!.value = 0;
      p.shutter.visible = false;
      p.shutter.position.set(0, 0, 0);
      this.redraw(p, []);
    }
  }

  dispose(): void {
    for (const p of this.panes.values()) {
      p.texture.dispose();
      p.material.dispose();
      p.shutter.removeFromParent();
      (p.shutter.material as MeshStandardMaterial).dispose();
    }
  }
}

/**
 * One mark on the glass, into the pane's texture: red for the crack lines,
 * green for the frosted crush round the pit, blue for how each crack's
 * face is turned (which ones catch the sun).
 */
function drawMark(g: CanvasRenderingContext2D, x: number, y: number, size: Mark["size"], left: number, seed: number): void {
  const r = seeded(seed * 9973 + 17);
  const scale = SIZE / 512;
  const reach = (size === "chip" ? 16 : size === "crack" ? 62 : 150) * scale * (0.85 + r() * 0.3);
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, left));
  g.globalCompositeOperation = "lighter";
  // The pit: a crushed, frosted star.
  const pit = (size === "chip" ? 5 : size === "crack" ? 9 : 16) * scale;
  const frost = g.createRadialGradient(x, y, 0, x, y, pit * 2.2);
  frost.addColorStop(0, "rgba(0, 220, 0, 1)");
  frost.addColorStop(0.5, "rgba(0, 120, 0, 0.6)");
  frost.addColorStop(1, "rgba(0, 0, 0, 0)");
  g.fillStyle = frost;
  g.beginPath();
  g.arc(x, y, pit * 2.2, 0, Math.PI * 2);
  g.fill();
  // Radial cracks, wandering as glass does, each with its own tilt.
  const rays = size === "chip" ? 4 + Math.floor(r() * 3) : size === "crack" ? 6 + Math.floor(r() * 4) : 10 + Math.floor(r() * 6);
  const ends: [number, number][] = [];
  for (let i = 0; i < rays; i++) {
    let a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.6;
    let px = x;
    let py = y;
    const len = reach * (0.45 + r() * 0.75);
    const steps = 6 + Math.floor(r() * 6);
    const tiltValue = Math.floor(r() * 255);
    g.strokeStyle = `rgb(255, 0, ${tiltValue})`;
    g.lineWidth = (size === "chip" ? 1.1 : 1.5) * scale;
    g.beginPath();
    g.moveTo(px, py);
    for (let s = 0; s < steps; s++) {
      a += (r() - 0.5) * 0.35;
      px += (Math.cos(a) * len) / steps;
      py += (Math.sin(a) * len) / steps;
      g.lineTo(px, py);
      // Now and then a branch.
      if (size !== "chip" && r() < 0.18) {
        const ba = a + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6);
        const bl = (len / steps) * (1 + r() * 2);
        g.moveTo(px, py);
        g.lineTo(px + Math.cos(ba) * bl, py + Math.sin(ba) * bl);
        g.moveTo(px, py);
      }
    }
    g.stroke();
    ends.push([a, len]);
  }
  // A web: rings of cracks joining the rays.
  if (size === "web") {
    const rings = 3 + Math.floor(r() * 2);
    for (let k = 1; k <= rings; k++) {
      const rad = (reach * k) / (rings + 1.2);
      g.strokeStyle = `rgb(220, 0, ${Math.floor(r() * 255)})`;
      g.lineWidth = 1.1 * scale;
      g.beginPath();
      for (let i = 0; i <= rays; i++) {
        const a = (i / rays) * Math.PI * 2 + (r() - 0.5) * 0.2;
        const rr = rad * (0.8 + r() * 0.4);
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    }
  }
  g.restore();
}
