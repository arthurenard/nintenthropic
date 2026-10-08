/**
 * The landmark gallery (src/kart/render/gallery.html): one landmark or hazard
 * at a time, on a straight road with a toy kart beside it for scale, in its
 * own world's sky and light. Built with the real placement code (landmarks/
 * place.ts), so what shows here is what shows in a race.
 *
 *   ?theme=kitchen&kind=teapot       a landmark (or a hazard, if the name is one)
 *   ?theme=meadow&kind=scenery:tree  the Blender-made variants of a kind of scenery (art/kart/world/), in a row
 *   &az=30&el=15&zoom=1              the camera, degrees round and above the target; zoom 1 frames it
 *   &offset=40                       how far right of the road (negative: left); spans ignore it
 *   &span=50  &scale=1.5  &turn=0.5  as a track's landmark would say
 *   &t=2  &freeze=1                  the race clock, and stop it
 *   &kart=0                          leave out the kart
 *   &art=0                           the code-built models, not the Blender-made ones (public/assets/kart/world-<theme>.glb)
 *
 * `window.__gallery`: `names` (this theme's), `show(kind, opts)`, `orbit(az, el, zoom)`, `time(t)`.
 * Drag to turn, wheel to zoom, left and right arrows for the previous and next.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { TrackGeometry, type HazardDef, type Landmark, type TrackDef, type TrackTheme } from "../track/geometry";
import { loadKartArt } from "./art";
import { createProceduralKart } from "./kartModel";
import { pointScale } from "./points";
import { Bank } from "./world/bank";
import { MeshBuilder, rgb } from "./world/builder";
import { HAZARDS, LANDMARKS, THEME_HAZARDS, THEME_LANDMARKS } from "./world/landmarks";
import { buildHazards, buildLandmarks, landmarkMaterials, type HazardLayer, type LandmarkLayer } from "./world/landmarks/place";
import { sceneryVariants } from "./world/sceneryArt";
import { createSky } from "./world/sky";
import { glowTexture } from "./world/textures";
import { styleFor } from "./world/themes";

const params = new URLSearchParams(location.search);
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const label = document.getElementById("label") as HTMLElement;

const GROUND: Record<TrackTheme, string> = {
  meadow: "#6fcf4b",
  canyon: "#efc98c",
  harbour: "#8d97ad",
  kitchen: "#e6d8c4",
  snow: "#e9f0fb",
  volcano: "#2a2630",
  funfair: "#4a3d5e",
  space: "#0a0c24",
  palm: "#f1dba4",
};

/** A long straight (1 km along +z) with a loop to close it. */
const GALLERY_TRACK: TrackDef = {
  id: "gallery",
  name: "Gallery",
  theme: "meadow",
  laps: 1,
  width: 14,
  itemRows: [],
  points: [
    { x: 0, z: 0 },
    { x: 0, z: 333 },
    { x: 0, z: 666 },
    { x: 0, z: 1000 },
    { x: -100, z: 1100 },
    { x: -300, z: 1100 },
    { x: -400, z: 1000 },
    { x: -400, z: 666 },
    { x: -400, z: 333 },
    { x: -400, z: 0 },
    { x: -300, z: -100 },
    { x: -100, z: -100 },
  ],
};

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = params.get("tone") === "aces" ? ACESFilmicToneMapping : NeutralToneMapping;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

const scene = new Scene();
const camera = new PerspectiveCamera(50, 1, 0.3, 4000);
const stage = new Group();
scene.add(stage);

let theme = (params.get("theme") as TrackTheme | null) ?? "meadow";
let sky: ReturnType<typeof createSky> | null = null;
let landmarks: LandmarkLayer | null = null;
let hazards: HazardLayer | null = null;
let kartRoot: Group | null = null;
let focus = new Vector3(0, 6, 500);
let radius = 30;
let az = Number(params.get("az") ?? 30);
let el = Number(params.get("el") ?? 14);
let zoom = Number(params.get("zoom") ?? 1);
let clock = Number(params.get("t") ?? 0);
let frozen = params.get("freeze") === "1";
let current = params.get("kind") ?? "";
const names = (): string[] => [...(THEME_LANDMARKS[theme] ?? []), ...(THEME_HAZARDS[theme] ?? []).map((h) => `hazard:${h.kind}`)];

const shadow = glowTexture(0, 1.0);
const geometry = TrackGeometry.build(GALLERY_TRACK);
const bank = new Bank(geometry);
const mats = landmarkMaterials();
const lit = new MeshLambertMaterial({ vertexColors: true });

function clearStage(): void {
  landmarks?.dispose();
  hazards?.dispose();
  landmarks = null;
  hazards = null;
  sky?.dispose();
  sky = null;
  while (stage.children.length) {
    const c = stage.children[0]!;
    c.removeFromParent();
    c.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.geometry && m.geometry !== sharedPlane) m.geometry.dispose();
    });
  }
}

const sharedPlane = new PlaneGeometry(1, 1);

function build(kind: string, opts: { offset?: number; span?: number; scale?: number; turn?: number; kart?: boolean } = {}): void {
  clearStage();
  current = kind;
  const style = styleFor(theme);
  sky = createSky(style);
  stage.add(sky.group);
  scene.background = new Color(style.fog.colour);
  scene.fog = new Fog(style.fog.colour, style.fog.near, style.fog.far);
  stage.add(new HemisphereLight(style.light.skyColour, style.light.groundColour, style.light.hemiIntensity));
  const sun = new DirectionalLight(style.light.sunColour, style.light.sunIntensity);
  sun.position.copy(sky.sunDir).multiplyScalar(200).add(new Vector3(0, 0, 500));
  sun.target.position.set(0, 0, 500);
  stage.add(sun, sun.target);
  renderer.toneMappingExposure = style.exposure;

  // The ground and the road.
  const ground = new Mesh(sharedPlane, new MeshBasicMaterial({ color: new Color(GROUND[theme]).multiplyScalar(0.8) }));
  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(6000, 6000, 1);
  ground.position.set(-200, -0.05, 500);
  stage.add(ground);
  const road = new MeshBuilder();
  const base = rgb(style.road.base);
  const edge = rgb(style.road.edge);
  for (let s = 0; s < 1100; s += 4) {
    const a = geometry.point(s, -7);
    const b = geometry.point(s, 7);
    const c = geometry.point(s + 4, 7);
    const d = geometry.point(s + 4, -7);
    const col = Math.floor(s / 12) % 2 === 0 ? base : [base[0] * 0.92, base[1] * 0.92, base[2] * 0.92];
    road.quad([a.x, 0.02, a.z], [b.x, 0.02, b.z], [c.x, 0.02, c.z], [d.x, 0.02, d.z], col as [number, number, number], col as [number, number, number], col as [number, number, number], col as [number, number, number], [0, 1, 0]);
    for (const side of [-7, 7]) {
      const e0 = geometry.point(s, side - 0.15);
      const e1 = geometry.point(s, side + 0.15);
      const e2 = geometry.point(s + 4, side + 0.15);
      const e3 = geometry.point(s + 4, side - 0.15);
      road.quad([e0.x, 0.03, e0.z], [e1.x, 0.03, e1.z], [e2.x, 0.03, e2.z], [e3.x, 0.03, e3.z], edge, edge, edge, edge, [0, 1, 0]);
    }
  }
  stage.add(new Mesh(road.build(), lit));

  const at = 500 / geometry.length;
  const env = { track: geometry, style, bank, groundAt: () => 0 };
  const isScenery = kind.startsWith("scenery:");
  const isHazard = !isScenery && (kind.startsWith("hazard:") || (!(kind in LANDMARKS) && kind in HAZARDS));
  const name = kind.replace(/^hazard:/, "");
  focus.set(0, 5, 500);
  radius = 30;
  if (isScenery) {
    // The variants side by side, centred on the focus, in the world's own scenery material.
    const variants = sceneryVariants(kind.slice("scenery:".length));
    const sceneryMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 });
    const widths = variants.map((g) => {
      g.computeBoundingBox();
      return Math.max(1, g.boundingBox!.max.x - g.boundingBox!.min.x);
    });
    const total = widths.reduce((a, w) => a + w + 1.2, 0);
    let x = -total / 2;
    variants.forEach((g, i) => {
      x += widths[i]! / 2 + 0.6;
      const mesh = new Mesh(g, sceneryMaterial);
      mesh.position.set(x, 0, 500);
      stage.add(mesh);
      x += widths[i]! / 2 + 0.6;
    });
    focus.set(0, 2, 500);
    radius = Math.max(4, total * 0.4);
  } else if (isHazard) {
    const motion = (THEME_HAZARDS[theme] ?? []).find((h) => h.kind === name)?.motion ?? "cross";
    const def: HazardDef = {
      kind: name,
      at,
      motion,
      period: 4,
      radius: Number(params.get("radius") ?? 1.4),
      span: motion === "cross" ? 6 : motion === "roll" ? 0.02 : motion === "orbit" ? 8 : undefined,
      offset: motion === "orbit" ? 12 : 0,
    };
    hazards = buildHazards(env, [def], mats, shadow);
    stage.add(hazards.group);
    radius = 4.5;
    focus.set(0, 1.4, 500);
  } else {
    const lm: Landmark = { kind: name, at, offset: opts.offset ?? (Number(params.get("offset") ?? 40)), span: opts.span, scale: opts.scale, turn: opts.turn };
    landmarks = buildLandmarks(env, [lm], mats);
    stage.add(landmarks.group);
    const box = new Box3().setFromObject(landmarks.group);
    if (!box.isEmpty()) {
      const centre = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      focus.copy(centre);
      focus.y = Math.max(1.5, centre.y * 0.8);
      radius = Math.max(size.x, size.y, size.z) * 0.85 + 8;
    }
  }
  if (!isScenery && opts.kart !== false && params.get("kart") !== "0") {
    const kart = createProceduralKart({ id: 0, colour: "#ff453a" });
    kartRoot = new Group();
    kartRoot.add(kart.root);
    kartRoot.position.set(isHazard ? 3.5 : 0, 0.02, 490);
    stage.add(kartRoot);
  }
  label.textContent = `${theme}: ${isScenery ? kind : name}${isHazard ? " (hazard)" : ""}`;
}

function placeCamera(): void {
  const d = (radius * 1.9) / Math.max(0.1, zoom);
  const a = (az * Math.PI) / 180;
  const e = (el * Math.PI) / 180;
  camera.position.set(focus.x + Math.sin(a) * Math.cos(e) * d, focus.y + Math.sin(e) * d, focus.z + Math.cos(a) * Math.cos(e) * d);
  camera.lookAt(focus);
}

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  pointScale.value = (h * renderer.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
}

window.addEventListener("resize", resize);
let drag: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => (drag = { x: e.clientX, y: e.clientY }));
window.addEventListener("pointerup", () => (drag = null));
window.addEventListener("pointermove", (e) => {
  if (!drag) return;
  az -= (e.clientX - drag.x) * 0.4;
  el = Math.max(-5, Math.min(85, el + (e.clientY - drag.y) * 0.3));
  drag = { x: e.clientX, y: e.clientY };
});
window.addEventListener("wheel", (e) => {
  zoom = Math.max(0.2, Math.min(8, zoom * Math.exp(-e.deltaY * 0.001)));
});
window.addEventListener("keydown", (e) => {
  const list = names();
  const i = Math.max(0, list.indexOf(current.startsWith("hazard:") || current in LANDMARKS ? current : `hazard:${current}`));
  if (e.key === "ArrowRight") build(list[(i + 1) % list.length]!);
  if (e.key === "ArrowLeft") build(list[(i - 1 + list.length) % list.length]!);
  if (e.key === " ") frozen = !frozen;
});

let artLoaded = false;
(window as unknown as { __gallery: unknown }).__gallery = {
  get names() {
    return names();
  },
  async show(kind: string, opts: { theme?: TrackTheme; offset?: number; span?: number; scale?: number; turn?: number; kart?: boolean } = {}) {
    if (opts.theme) theme = opts.theme;
    await loadArt();
    build(kind, opts);
  },
  orbit(newAz: number, newEl: number, newZoom = 1) {
    az = newAz;
    el = newEl;
    zoom = newZoom;
  },
  time(t: number) {
    clock = t;
  },
  setTheme(t: TrackTheme) {
    theme = t;
  },
  get ready() {
    return artLoaded;
  },
};

/** The Blender-made models of this theme's world, unless `?art=0` asks for the code-built ones. */
async function loadArt(): Promise<void> {
  if (params.get("art") !== "0") await loadKartArt(theme);
}

resize();
void loadArt().then(() =>
  build(current || names()[0] || "windmill", {
    offset: params.has("offset") ? Number(params.get("offset")) : undefined,
    span: params.has("span") ? Number(params.get("span")) : undefined,
    scale: params.has("scale") ? Number(params.get("scale")) : undefined,
    turn: params.has("turn") ? Number(params.get("turn")) : undefined,
  }),
);

let last = performance.now();
const loop = (now: number): void => {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!frozen) clock += dt;
  landmarks?.update(clock);
  hazards?.update(clock, dt);
  if (sky) sky.group.position.copy(camera.position);
  placeCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
