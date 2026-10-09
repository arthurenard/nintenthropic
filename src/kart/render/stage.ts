/**
 * The driver stage: the chosen driver sitting in their kart, in the player's
 * kart colour, turning slowly on a softly lit plinth (drag to spin it). Made
 * for the Choose Your Driver screen, where it is the one WebGL renderer the
 * screen owns and is let go of with the screen (`dispose`).
 *
 * The kart is the race's own model (`createProceduralKart`: the Blender one
 * when its art is loaded, the code-built one before), lit the way the
 * meadow's morning lights it, with a rim of the player's colour from behind.
 * A new rider springs in on the plinth, the driver waving once. The canvas is
 * transparent: the page's sky is the background.
 *
 * Nothing here runs unless the screen asks: `start` begins the loop,
 * `stop` ends it (a page in the background does not draw), and with reduced
 * motion the kart stands still at a three-quarter view and the picture is
 * drawn only when something changes (a new rider, a drag, a resize).
 */
import {
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  Vector3,
  type Object3D,
} from "three";
import { WebGLUnavailable } from "../../engine/common";
import { loadStageArt } from "./art";
import type { KartModel } from "./kart";
import { createProceduralKart } from "./kartModel";
import { styleFor } from "./world/themes";

/** Who sits on the plinth. */
export interface Rider {
  /** characters.ts id. */
  character: string;
  /** The kart's colour, "#rrggbb". */
  colour: string;
  golden: boolean;
}

export interface StageOptions {
  /** Still: no turning of its own, no wave, drawn only when something changes. */
  reduceMotion?: boolean;
  /** A weak or hot device: half the frames, a pixel ratio of at most 1.5. */
  lowPower?: boolean;
}

export interface DriverStage {
  /** Puts this rider on the plinth: they spring in (at once, the first time). */
  show(rider: Rider): void;
  resize(width: number, height: number, dpr: number): void;
  /** Starts drawing, every frame the browser offers. */
  start(): void;
  /** Stops drawing (the screen is hidden or the page is). */
  stop(): void;
  /** Frames drawn so far (a test can tell the stage is alive). */
  readonly frames: number;
  dispose(): void;
}

const TAU = Math.PI * 2;
/** A three-quarter view from the front, where the driver's face and the kart's nose both show. */
const REST_YAW = 0.62;
/** The plinth: radius at the top, and its height. */
const PLINTH_R = 2.4;
const PLINTH_H = 0.34;
/** The top of the tallest driver in a kart, metres (the nine measure 2.6 to 2.9, a hand raised in a wave included). */
const HEAD_TOP = 3.05;
/** What the camera must see whole, wherever the kart has turned: the tallest head, the plinth's edge all round and its foot. */
const FRAME: readonly Vector3[] = [
  new Vector3(0, HEAD_TOP, 0),
  new Vector3(0, -PLINTH_H, PLINTH_R + 0.22),
  new Vector3(PLINTH_R + 0.22, -PLINTH_H, 0),
  new Vector3(-(PLINTH_R + 0.22), -PLINTH_H, 0),
  new Vector3(PLINTH_R * 0.72, -PLINTH_H, PLINTH_R * 0.72),
  new Vector3(-PLINTH_R * 0.72, -PLINTH_H, PLINTH_R * 0.72),
];
/** How long a rider takes to spring in, seconds, and how long the driver waves. */
const SPRING_FOR = 0.9;
const WAVE_FOR = 1.5;

/** A damped spring from 0 to 1 that overshoots a little: t in seconds. */
export function springIn(t: number): number {
  if (t <= 0) return 0;
  if (t >= SPRING_FOR) return 1;
  return 1 - Math.exp(-6.2 * t) * Math.cos(12.5 * t);
}

/** A soft round shadow for the kart to stand in. */
function blob(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  gradient.addColorStop(0, "rgba(10,20,48,0.5)");
  gradient.addColorStop(0.55, "rgba(10,20,48,0.22)");
  gradient.addColorStop(1, "rgba(10,20,48,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * Makes the stage on `canvas`, once the modelled karts and drivers are
 * loaded (or found missing: the code-built ones stand in). Throws
 * WebGLUnavailable where there is no WebGL.
 */
export async function createDriverStage(canvas: HTMLCanvasElement, options: StageOptions = {}): Promise<DriverStage> {
  await loadStageArt();
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch {
    throw new WebGLUnavailable();
  }
  const calm = options.reduceMotion ?? false;
  const low = options.lowPower ?? false;
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setClearColor(new Color(0x000000), 0);

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };

  const style = styleFor("meadow");
  const scene = new Scene();
  scene.add(new HemisphereLight(style.light.skyColour, style.light.groundColour, style.light.hemiIntensity * 0.5));
  const sun = new DirectionalLight(style.light.sunColour, style.light.sunIntensity * 1.6);
  sun.position.set(-5, 8, 7);
  scene.add(sun);
  // From behind, in the player's colour: it lifts the kart off the sky and says whose it is.
  const rim = new DirectionalLight(0xffffff, 1.5);
  rim.position.set(4, 3.2, -7);
  scene.add(rim);

  // The plinth: a low disc of pale ceramic, a ring of the player's colour set into it, a soft shadow under the kart.
  const plinth = new Group();
  const slab = new Mesh(
    own(new CylinderGeometry(PLINTH_R, PLINTH_R + 0.22, PLINTH_H, 96)),
    own(new MeshStandardMaterial({ color: 0xf2f5fb, roughness: 0.55, metalness: 0.05 })),
  );
  slab.position.y = -PLINTH_H / 2;
  plinth.add(slab);
  const ringMaterial = own(new MeshBasicMaterial({ color: new Color("#ffffff"), transparent: true, opacity: 0.95 }));
  const ring = new Mesh(own(new RingGeometry(PLINTH_R - 0.34, PLINTH_R - 0.24, 128)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  plinth.add(ring);
  const haloMaterial = own(new MeshBasicMaterial({ color: new Color("#ffffff"), transparent: true, opacity: 0.22, depthWrite: false }));
  const halo = new Mesh(own(new RingGeometry(PLINTH_R - 0.24, PLINTH_R - 0.02, 128)), haloMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.003;
  plinth.add(halo);
  const shadowTexture = own(blob());
  const shadow = new Mesh(own(new CircleGeometry(2.6, 48)), own(new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.006;
  plinth.add(shadow);
  scene.add(plinth);

  const camera = new PerspectiveCamera(24, 1, 0.5, 80);
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 480;

  // Riders already built stay built (flipping between drivers is the point of the screen); all are let go with the stage.
  const built = new Map<string, KartModel>();
  let current: { key: string; model: KartModel } | null = null;
  let since = 0;
  let spin = REST_YAW;
  let velocity = 0;
  let idle = 0;
  let dragging: { id: number; x: number } | null = null;
  let clock = 0;
  let frames = 0;
  let running = false;
  let raf = 0;
  let last = 0;
  let skip = false;
  let disposed = false;
  /** Something changed since the last picture (a rider, the size, a drag): with reduced motion, the only reason to draw. */
  let dirty = true;
  let rimColour = new Color("#ffffff");

  /** Aims the camera from `aim` metres up the middle, `distance` away, a little above the plinth. */
  const aimFrom = (aim: number, distance: number): void => {
    const lift = 0.2;
    camera.position.set(0, aim + distance * Math.sin(lift), distance * Math.cos(lift));
    camera.lookAt(0, aim, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  /** Is all of what must be seen in the picture, with a little room all round? */
  const sees = (): boolean =>
    FRAME.every((point) => {
      const v = point.clone().project(camera);
      return Math.abs(v.x) <= 0.96 && Math.abs(v.y) <= 0.92;
    });

  const place = (): void => {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    // The nearest the camera can stand and still see the whole plinth and the tallest driver's head, found by looking:
    // for each height to aim at, back off until everything fits, and keep the aim that needed the least room.
    let best = { aim: 1, distance: 40 };
    for (let aim = 0.5; aim <= 1.6; aim += 0.1) {
      for (let distance = 6; distance < best.distance; distance += 0.25) {
        aimFrom(aim, distance);
        if (sees()) {
          best = { aim, distance };
          break;
        }
      }
    }
    aimFrom(best.aim, best.distance);
  };

  const key = (rider: Rider): string => `${rider.character}|${rider.colour}|${rider.golden ? 1 : 0}`;

  const draw = (): void => {
    if (disposed) return;
    const t = current ? since : 0;
    if (current) {
      const root: Object3D = current.model.root;
      const grow = calm ? 1 : Math.max(0.001, springIn(t));
      root.scale.setScalar(grow);
      // The rider turns in as they land, a half turn that settles into the spin.
      const entering = calm ? 0 : (1 - Math.min(1, t / SPRING_FOR)) ** 3 * Math.PI * 0.8;
      root.rotation.y = spin + entering;
      current.model.pose({
        steer: calm ? 0 : Math.sin(clock * 0.9) * 0.3,
        wheelSpin: clock * 1.2,
        lean: calm ? 0 : Math.sin(clock * 0.9) * 0.1,
        roll: 0,
        pitch: 0,
        hop: 0,
        shake: 0,
        flame: 0,
        flicker: 0,
        slide: 0,
        time: calm ? 0 : clock,
        emote: !calm && t < WAVE_FOR ? "wave" : null,
      });
    }
    // The ring breathes a little the moment a rider lands.
    const flash = calm ? 0 : Math.max(0, 1 - since / 0.8);
    haloMaterial.opacity = 0.22 + flash * 0.4;
    ring.scale.setScalar(1 + flash * 0.03);
    rim.color.copy(rimColour);
    renderer.render(scene, camera);
    frames++;
  };

  const frame = (now: number): void => {
    if (!running || disposed) return;
    raf = requestAnimationFrame(frame);
    if (low) {
      skip = !skip;
      if (skip) return;
    }
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    clock += dt;
    since += dt;
    if (dragging) {
      idle = 0;
    } else {
      idle += dt;
      // Let go of a drag and it coasts, then the plinth's own slow turn takes over.
      spin += velocity * dt;
      velocity *= Math.exp(-3.2 * dt);
      if (!calm && idle > 1.6) spin += 0.42 * Math.min(1, (idle - 1.6) / 1.2) * dt;
    }
    spin %= TAU;
    if (calm && !dirty && !dragging && Math.abs(velocity) < 0.002) return;
    dirty = false;
    draw();
  };

  const onDown = (event: PointerEvent): void => {
    dragging = { id: event.pointerId, x: event.clientX };
    velocity = 0;
    canvas.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent): void => {
    if (!dragging || event.pointerId !== dragging.id) return;
    const dx = event.clientX - dragging.x;
    dragging.x = event.clientX;
    spin += dx * 0.011;
    velocity = dx * 0.011 * 60 * 0.5;
    dirty = true;
    if (!running) draw();
  };
  const onUp = (event: PointerEvent): void => {
    if (dragging && event.pointerId === dragging.id) {
      dragging = null;
      canvas.releasePointerCapture?.(event.pointerId);
    }
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  const setSize = (w: number, h: number, dpr: number): void => {
    width = Math.max(1, w);
    height = Math.max(1, h);
    renderer.setPixelRatio(Math.max(0.75, Math.min(dpr, low ? 1.5 : 2)));
    renderer.setSize(width, height, false);
    place();
    dirty = true;
    if (!running) draw();
  };
  setSize(width, height, window.devicePixelRatio || 1);

  return {
    show(rider) {
      if (disposed) return;
      const wanted = key(rider);
      if (current?.key === wanted) return;
      if (current) scene.remove(current.model.root);
      let model = built.get(wanted);
      if (!model) {
        model = createProceduralKart({ id: 0, colour: rider.colour, character: rider.character, golden: rider.golden });
        built.set(wanted, model);
      }
      model.root.position.set(0, 0, 0);
      scene.add(model.root);
      current = { key: wanted, model };
      since = 0;
      rimColour = new Color(rider.colour).lerp(new Color("#ffffff"), 0.25);
      ringMaterial.color.set(rider.colour);
      haloMaterial.color.set(rider.colour);
      dirty = true;
      if (!running) draw();
    },
    resize: setSize,
    start() {
      if (running || disposed) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    get frames() {
      return frames;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      running = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      for (const model of built.values()) model.dispose();
      built.clear();
      for (const thing of owned) thing.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
