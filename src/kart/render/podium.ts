/**
 * The podium: the ceremony after a Grand Prix's last race. The top three
 * drivers stand in their karts on a three-step podium on a chequered stage,
 * each with a trophy turning above them (gold, silver, bronze), confetti
 * falling, and the camera swinging round the lot, lingering on the front.
 * One canvas of its own: `createPodium(canvas)` makes the scene, `show` puts
 * the winners on it, `frame(dt)` moves and draws it (call it every animation
 * frame), `dispose` lets everything go.
 *
 * The drivers are the same models the race uses (`KartFactory`, so a better
 * model drops in), posed with `emote: "cheer"` for a model that has the pose;
 * the karts also bob on the spot and the winner's wheel turns, so the
 * ceremony lives with any model.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  WebGLRenderer,
  type Texture,
} from "three";
import { WebGLUnavailable } from "../../engine/common";
import type { RacerSetup } from "../contract";
import type { KartFactory, KartModel, KartPose } from "./kart";
import { createProceduralKart } from "./kartModel";
import { TAU, clamp } from "./math";

/** A winner on the podium. */
export interface PodiumEntry {
  name: string;
  colour: string;
  /** Their driver (characters.ts). */
  character?: string;
  golden?: boolean;
}

export interface PodiumOptions {
  /** Makes the kart and driver for a winner (the race's own by default). */
  kartFactory?: KartFactory;
  /** No swinging camera, no bobbing, little confetti. */
  reduceMotion?: boolean;
}

export interface PodiumRenderer {
  /** Puts the winners on the podium: first, second, third (fewer is fine). */
  show(winners: readonly PodiumEntry[]): void;
  /** Moves the scene on by `dt` real seconds and draws it. */
  frame(dt: number): void;
  resize(width: number, height: number, dpr: number): void;
  dispose(): void;
}

/** Where each step stands (x, metres), how high (y) and the trophy's colour, by place - 1. */
const STEPS = [
  { place: 1, x: 0, height: 2.2, step: "#e0ad1c", trophy: "#ffd23f", scale: 1.15 },
  { place: 2, x: -3.9, height: 1.5, step: "#aab3bf", trophy: "#dfe5ec", scale: 0.9 },
  { place: 3, x: 3.9, height: 1.0, step: "#b3702f", trophy: "#d98a45", scale: 0.8 },
] as const;
const STEP_WIDTH = 3.7;
const STEP_DEPTH = 3.9;
/** Heading of each kart (radians): they look a little toward the winner. */
const TURN = [0, 0.32, -0.32] as const;
const CONFETTI = ["#ff453a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff9f0a", "#ffffff"];

function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The night behind the stage: deep blue above, a violet glow low down. */
function sky(): Texture {
  return canvasTexture(8, 256, (ctx) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, "#070b1d");
    gradient.addColorStop(0.55, "#1b1646");
    gradient.addColorStop(0.82, "#4a2a74");
    gradient.addColorStop(1, "#7a3a85");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 8, 256);
  });
}

/** A chequered floor, soft toward the edge. */
function chequers(): Texture {
  const texture = canvasTexture(256, 256, (ctx) => {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#2b2f45" : "#454c6c";
        ctx.fillRect(x * 128, y * 128, 128, 128);
      }
    }
  });
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(36, 36);
  texture.anisotropy = 4;
  return texture;
}

/** The front of a step: its place in big numerals, and the driver's name under it. */
function stepFace(place: number, name: string, colour: string, ratio: number): Texture {
  const w = 720;
  const h = Math.round(w / ratio);
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, w, h);
    const shade = ctx.createLinearGradient(0, 0, 0, h);
    shade.addColorStop(0, "rgba(255,255,255,0.22)");
    shade.addColorStop(1, "rgba(0,0,0,0.28)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "rgba(255,255,255,0.96)";
    const family = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", system-ui, sans-serif';
    const numeral = Math.min(h * 0.56, 300);
    ctx.font = `800 ${numeral}px ${family}`;
    ctx.fillText(String(place), w / 2, h * 0.58);
    let size = Math.min(h * 0.2, 64);
    ctx.font = `700 ${size}px ${family}`;
    while (ctx.measureText(name).width > w * 0.86 && size > 18) {
      size -= 2;
      ctx.font = `700 ${size}px ${family}`;
    }
    ctx.fillStyle = "rgba(20,20,30,0.82)";
    ctx.fillText(name, w / 2, h * 0.88);
  });
}

/** A cup with two handles on a plinth, `height` about 2.2 at scale 1. */
function trophy(colour: string): { group: Group; dispose: () => void } {
  const material = new MeshPhongMaterial({ color: new Color(colour), specular: 0xffffff, shininess: 90, emissive: new Color(colour), emissiveIntensity: 0.28, side: DoubleSide });
  const profile = [
    [0.62, 0], [0.62, 0.1], [0.5, 0.16], [0.16, 0.24], [0.11, 0.34], [0.11, 0.62], [0.2, 0.74], [0.5, 0.92], [0.7, 1.3], [0.74, 1.7], [0.7, 2.0], [0.62, 2.0], [0.62, 1.94], [0.64, 1.7], [0.6, 1.34], [0.4, 1.02], [0.0, 0.9],
  ].map(([x, y]) => new Vector2(x, y));
  const bowl = new LatheGeometry(profile, 28);
  const handle = new TorusGeometry(0.36, 0.06, 10, 20, Math.PI);
  const group = new Group();
  group.add(new Mesh(bowl, material));
  for (const side of [-1, 1]) {
    const arm = new Mesh(handle, material);
    arm.position.set(side * 0.74, 1.46, 0);
    arm.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    group.add(arm);
  }
  return {
    group,
    dispose() {
      bowl.dispose();
      handle.dispose();
      material.dispose();
    },
  };
}

interface Standing {
  place: number;
  model: KartModel;
  trophy: Group;
  /** Where its kart rests, metres. */
  x: number;
  y: number;
  phase: number;
}

export function createPodium(canvas: HTMLCanvasElement, options: PodiumOptions = {}): PodiumRenderer {
  const dpr0 = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: dpr0 < 2, alpha: false, stencil: false, powerPreference: "high-performance" });
  } catch {
    throw new WebGLUnavailable();
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  const calm =
    options.reduceMotion ??
    (typeof document !== "undefined" && (document.documentElement.hasAttribute("data-reduce-motion") || (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)));
  const factory = options.kartFactory ?? createProceduralKart;

  const disposables: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T): T => {
    disposables.push(thing);
    return thing;
  };

  const scene = new Scene();
  scene.background = own(sky());
  scene.fog = new Fog(0x3a2468, 34, 78);
  scene.add(own(new HemisphereLight(0xb9c4ff, 0x30244f, 1.35)));
  const key = new DirectionalLight(0xfff1d6, 2.6);
  key.position.set(5, 12, 14);
  scene.add(key);
  const rim = new PointLight(0xff7ad9, 90, 40, 1.6);
  rim.position.set(-9, 6, -6);
  scene.add(rim);
  const rimB = new PointLight(0x5aa9ff, 90, 40, 1.6);
  rimB.position.set(9, 6, -6);
  scene.add(rimB);

  // The stage.
  const floorTexture = own(chequers());
  const floorGeometry = own(new CircleGeometry(70, 96));
  floorGeometry.rotateX(-Math.PI / 2);
  const floorMaterial = own(new MeshLambertMaterial({ map: floorTexture }));
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.position.y = -0.02;
  scene.add(floor);

  const stage = new Group();
  scene.add(stage);
  const winners = new Group();
  scene.add(winners);

  // Confetti.
  const pieces = calm ? 36 : 170;
  const confettiGeometry = own(new PlaneGeometry(0.2, 0.12));
  const confettiMaterial = own(new MeshBasicMaterial({ side: DoubleSide }));
  const confetti = new InstancedMesh(confettiGeometry, confettiMaterial, pieces);
  const flake = Array.from({ length: pieces }, (_, i) => ({
    x: (Math.random() - 0.5) * 20,
    y: Math.random() * 12,
    z: (Math.random() - 0.5) * 12 + 1,
    fall: 1.1 + Math.random() * 1.3,
    sway: Math.random() * TAU,
    spin: 2 + Math.random() * 5,
    turn: Math.random() * TAU,
    size: 0.7 + Math.random() * 0.9,
    colour: CONFETTI[i % CONFETTI.length]!,
  }));
  flake.forEach((f, i) => confetti.setColorAt(i, new Color(f.colour)));
  confetti.frustumCulled = false;
  scene.add(confetti);
  const dummy = new Object3D();

  let standings: Standing[] = [];
  let built: { dispose(): void }[] = [];
  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;
  let time = 0;
  let disposed = false;
  const camera = new PerspectiveCamera(32, width / height, 0.5, 200);

  const clearWinners = () => {
    for (const standing of standings) standing.model.dispose();
    for (const thing of built) thing.dispose();
    standings = [];
    built = [];
    winners.clear();
    stage.clear();
  };

  const frameCamera = () => {
    const aspect = width / height;
    camera.aspect = aspect;
    camera.fov = sheet() ? 44 : 32;
    camera.updateProjectionMatrix();
    // A side panel takes the right of a wide window, a sheet the foot of a tall one (race.css decides which, by the
    // same measure): the podium sits in what is left, with the cup's name above it.
    camera.clearViewOffset();
    if (sheet()) camera.setViewOffset(width, height, 0, height * 0.12, width, height);
    else camera.setViewOffset(width, height, width * 0.15, -height * 0.13, width, height);
  };

  /** The standings are a sheet at the foot, not a panel at the side. */
  const sheet = (): boolean => width <= 900 || width <= height;

  const place = (): void => {
    const half = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = width / height;
    // Far enough that the whole podium and the trophies over it fit, at the window's shape.
    const fitWidth = (sheet() ? 6.4 : 8.8) / (half * aspect);
    const fitHeight = (sheet() ? 5.6 : 6.9) / half;
    swingDistance = Math.max(fitWidth, fitHeight, 12);
  };
  let swingDistance = 18;
  frameCamera();
  place();

  const setSize = (w: number, h: number, dpr: number) => {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setPixelRatio(Math.max(0.5, Math.min(dpr, 2)));
    renderer.setSize(width, height, false);
    frameCamera();
    place();
  };
  setSize(width, height, dpr0);

  return {
    show(entries) {
      clearWinners();
      entries.slice(0, 3).forEach((entry, index) => {
        const spec = STEPS[index]!;
        const geometry = new BoxGeometry(STEP_WIDTH, spec.height, STEP_DEPTH);
        const side = new MeshLambertMaterial({ color: new Color(spec.step).multiplyScalar(0.8) });
        const top = new MeshLambertMaterial({ color: new Color(spec.step).multiplyScalar(1.05) });
        const faceTexture = stepFace(spec.place, entry.name, spec.step, STEP_WIDTH / spec.height);
        const face = new MeshLambertMaterial({ map: faceTexture });
        const step = new Mesh(geometry, [side, side, top, side, face, side]);
        step.position.set(spec.x, spec.height / 2, 0);
        stage.add(step);
        built.push(geometry, side, top, face, faceTexture);

        const racer: RacerSetup = { id: index, name: entry.name, colour: entry.colour, player: null, character: entry.character, golden: entry.golden };
        const model = factory(racer);
        model.root.position.set(spec.x, spec.height, 0.1);
        model.root.rotation.y = TURN[index]!;
        winners.add(model.root);

        const cup = trophy(spec.trophy);
        cup.group.scale.setScalar(spec.scale * 0.8);
        cup.group.position.set(spec.x, spec.height + 2.7, 0);
        winners.add(cup.group);
        built.push(cup);
        standings.push({ place: spec.place, model, trophy: cup.group, x: spec.x, y: spec.height, phase: index * 1.7 });
      });
    },

    frame(dt) {
      if (disposed) return;
      dt = clamp(dt, 0, 0.1);
      time += dt;
      for (const standing of standings) {
        const t = time + standing.phase;
        const bob = calm ? 0 : Math.max(0, Math.sin(t * 4.2)) * 0.22 * (standing.place === 1 ? 1.25 : 1);
        const pose: KartPose = {
          steer: calm ? 0 : Math.sin(t * 1.6) * 0.5,
          wheelSpin: t * 1.5,
          lean: calm ? 0 : Math.sin(t * 2.1) * 0.25,
          roll: 0,
          pitch: 0,
          hop: bob,
          shake: 0,
          flame: 0,
          flicker: 0,
          slide: 0,
          // A driver that has the pose cheers; the rest take no notice.
          ...({ emote: "cheer" } as object),
        };
        standing.model.pose(pose);
        standing.trophy.rotation.y = calm ? 0.4 : t * 1.1;
        standing.trophy.position.y = standing.y + 2.7 + (calm ? 0 : Math.sin(t * 2) * 0.12);
      }
      // The camera swings to and fro round the front of the podium, never to its back.
      const swing = calm ? 0.28 : Math.sin(time * 0.38) * 0.62;
      const rise = calm ? 0 : Math.sin(time * 0.23) * 0.5;
      camera.position.set(Math.sin(swing) * swingDistance, 3.9 + rise, Math.cos(swing) * swingDistance);
      camera.lookAt(0, 2.5, 0);
      // Confetti falls, sways and tumbles; a piece that lands goes back up.
      for (let i = 0; i < flake.length; i++) {
        const f = flake[i]!;
        f.y -= f.fall * dt;
        f.sway += dt * 1.4;
        if (f.y < 0.05) {
          f.y = 11 + Math.random() * 3;
          f.x = (Math.random() - 0.5) * 20;
          f.z = (Math.random() - 0.5) * 12 + 1;
        }
        dummy.position.set(f.x + Math.sin(f.sway) * 0.6, f.y, f.z + Math.cos(f.sway * 0.8) * 0.4);
        dummy.rotation.set(time * f.spin + f.turn, time * f.spin * 0.7, f.turn);
        dummy.scale.setScalar(f.size);
        dummy.updateMatrix();
        confetti.setMatrixAt(i, dummy.matrix);
      }
      confetti.instanceMatrix.needsUpdate = true;
      renderer.render(scene, camera);
    },

    resize: setSize,

    dispose() {
      if (disposed) return;
      disposed = true;
      clearWinners();
      for (const thing of disposables) thing.dispose();
      confetti.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
