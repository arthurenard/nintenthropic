/**
 * The driver stage: the chosen driver sitting in their kart, in the player's
 * kart colour, on a plinth in a small photo studio (drag to spin it). Made
 * for the Choose Your Driver screen, where it is the one WebGL renderer the
 * screen owns and is let go of with the screen (`dispose`).
 *
 * The kart is the race's own model (`createProceduralKart`: the Blender one
 * when its art is loaded, the code-built one before), drawn the way the race
 * draws it (ACES tone mapping, the physical clear-coat paint) but lit as a
 * product shot: a warm key light from the front left that throws the kart's
 * shadow on the plinth, a cool fill from the right, a rim of the player's
 * colour and a white one from behind, and soft studio boxes for the paint to
 * reflect. The plinth is a slightly glossy light grey disc with a thin ring of
 * the player's colour; the kart stands in a soft contact shadow.
 *
 * It rests at a front three-quarter, the driver's face in view. After a few
 * idle seconds it begins to turn slowly; choosing another driver brings it
 * round to the front again, and a drag let go of coasts to a stop. A new rider
 * springs in on the plinth, the driver waving once. The canvas is transparent:
 * the page's backdrop is the background.
 *
 * Nothing here runs unless the screen asks: `start` begins the loop,
 * `stop` ends it (a page in the background does not draw), and with reduced
 * motion the kart stands still at the three-quarter view and the picture is
 * drawn only when something changes (a new rider, a drag, a resize).
 */
import {
  Box3,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  RingGeometry,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WebGLUnavailable } from "../../engine/common";
import { loadStageArt } from "./art";
import type { KartModel } from "./kart";
import { createProceduralKart } from "./kartModel";
import { outliving } from "./outliving";
import { PostChain } from "./post";
import { LOOKS } from "./world/look";

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
/** The resting view: a three-quarter from the front, where the driver's face and the kart's nose both show. */
const REST_YAW = 0.5;
/** Idle this long, seconds, and the plinth begins to turn by itself, slowly (a drag, or a new rider, starts the wait again). */
const TURN_AFTER = 3.4;
/** How fast it turns once it is going, radians a second, and how long it takes to get there. */
const TURN_RATE = 0.36;
const TURN_EASE = 1.6;
/** How quickly a turned kart comes back to the front three-quarter when another driver is chosen (1 / seconds). */
const SETTLE_RATE = 3.4;
/** The plinth: radius at the top, and its height. */
const PLINTH_R = 2.15;
const PLINTH_H = 0.34;
/** The top of the tallest driver in a kart, metres (the nine measure 2.6 to 2.9, a hand raised in a wave included). */
const HEAD_TOP = 3.05;
/** How far the plinth's soft shadow on the ground reaches beyond its top edge, metres (the picture must hold it, or it is cut short by the canvas). */
const SHADOW_R = 0.62;
/** What the camera must see whole, wherever the kart has turned: the tallest head, the plinth's edge all round and its foot. */
const FRAME: readonly Vector3[] = [
  new Vector3(0, HEAD_TOP, 0),
  new Vector3(0, -PLINTH_H, PLINTH_R + 0.22),
  new Vector3(PLINTH_R + 0.22, -PLINTH_H, 0),
  new Vector3(-(PLINTH_R + 0.22), -PLINTH_H, 0),
  new Vector3(PLINTH_R * 0.72, -PLINTH_H, PLINTH_R * 0.72),
  new Vector3(-PLINTH_R * 0.72, -PLINTH_H, PLINTH_R * 0.72),
  new Vector3(PLINTH_R + SHADOW_R - 0.12, -PLINTH_H, 0),
  new Vector3(-(PLINTH_R + SHADOW_R - 0.12), -PLINTH_H, 0),
  new Vector3(0, -PLINTH_H, PLINTH_R + SHADOW_R - 0.12),
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

/** The angle in `spin`'s turn that is nearest to `to` (so a kart turned round three times comes back the short way). */
export function nearestTurn(spin: number, to: number): number {
  return to + TAU * Math.round((spin - to) / TAU);
}

/** A soft round fall-off of `rgb` (0..255 each) from `centre` opacity to nothing at the edge, for a shadow. */
function softDisc(rgb: string, centre: number, hold = 0.35): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 126);
  gradient.addColorStop(0, `rgba(${rgb},${centre})`);
  gradient.addColorStop(hold, `rgba(${rgb},${centre * 0.62})`);
  gradient.addColorStop(0.72, `rgba(${rgb},${centre * 0.16})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** The plinth's body: a low disc with a softly rounded top edge and a slight flare to its foot, turned on a lathe. */
function plinthProfile(): Vector2[] {
  const R = PLINTH_R;
  const H = PLINTH_H;
  return [
    new Vector2(0, 0),
    new Vector2(R - 0.5, 0),
    new Vector2(R - 0.1, 0),
    new Vector2(R - 0.03, -0.012),
    new Vector2(R + 0.015, -0.05),
    new Vector2(R + 0.04, -0.11),
    new Vector2(R + 0.22, -H + 0.03),
    new Vector2(R + 0.225, -H),
    new Vector2(R * 0.5, -H),
    new Vector2(0, -H),
  ];
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
  // The picture is graded the way the race's is (post.ts: the meadow's look, ACES with its vibrance, contrast and split tone), so the
  // paint is as rich here as it is on the road; the scene itself is drawn in linear light.
  renderer.toneMapping = NoToneMapping;
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(new Color(0x000000), 0);

  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(thing: T): T => {
    owned.push(thing);
    return thing;
  };

  const scene = new Scene();
  // Soft studio boxes for the clear coat to reflect (a neutral room: no blue sky to tint the paint).
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const studio = pmrem.fromScene(room, 0.03);
  pmrem.dispose();
  room.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as { dispose(): void }).dispose();
    }
  });
  own(studio);
  scene.environment = studio.texture;
  scene.environmentIntensity = 0.4;

  // The key: warm, high, from the front left; it throws the kart's shadow on the plinth.
  const key = new DirectionalLight(0xfff0dc, 2.2);
  key.position.set(-5.2, 8.4, 6.2);
  key.target.position.set(0, 0.6, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(low ? 1024 : 2048, low ? 1024 : 2048);
  key.shadow.camera.left = -3.6;
  key.shadow.camera.right = 3.6;
  key.shadow.camera.top = 3.6;
  key.shadow.camera.bottom = -3.6;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 24;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key, key.target);
  // The fill: cool and low from the right, so the shadow side keeps its colour and its shape.
  const fill = new DirectionalLight(0xd2e2ff, 0.6);
  fill.position.set(6.5, 2.6, 4.6);
  scene.add(fill);
  // A little sky and ground, so nothing goes to black.
  scene.add(new HemisphereLight(0xeaf1ff, 0x7b8496, 0.2));
  // Two rims from behind: the player's colour on the right, a white one on the left, to cut the kart out of the backdrop.
  const rim = new DirectionalLight(0xffffff, 2.0);
  rim.position.set(4.4, 3.4, -7);
  scene.add(rim);
  const edge = new DirectionalLight(0xf2f6ff, 0.8);
  edge.position.set(-5.5, 3.2, -6);
  scene.add(edge);

  // The plinth: a pale grey disc with a gloss to it, a thin ring of the player's colour set into its top.
  const plinth = new Group();
  const slab = new Mesh(
    own(new LatheGeometry(plinthProfile(), 128)),
    own(new MeshPhysicalMaterial({ color: 0xaab5c6, roughness: 0.46, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.22, envMapIntensity: 0.8 })),
  );
  slab.receiveShadow = true;
  plinth.add(slab);
  // The ring keeps its true colour (no tone mapping), thin and crisp.
  const ringMaterial = own(new MeshBasicMaterial({ color: new Color("#ffffff"), toneMapped: false, transparent: true, opacity: 1 }));
  const ring = new Mesh(own(new RingGeometry(PLINTH_R - 0.36, PLINTH_R - 0.305, 192)), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  plinth.add(ring);
  // The plinth's own soft shadow on the ground it stands on (the page's backdrop), wider than it is.
  const groundShadow = new Mesh(
    own(new CircleGeometry(PLINTH_R + SHADOW_R, 64)),
    own(new MeshBasicMaterial({ map: own(softDisc("22,32,56", 0.34, 0.5)), toneMapped: false, transparent: true, depthWrite: false })),
  );
  groundShadow.rotation.x = -Math.PI / 2;
  groundShadow.position.set(0.12, -PLINTH_H - 0.01, 0.16);
  plinth.add(groundShadow);
  // The contact shadow under the kart: a tight, dark pool that turns with it and says it is sitting on the plinth.
  const contact = new Group();
  const contactDisc = new Mesh(
    own(new PlaneGeometry(1, 1)),
    own(new MeshBasicMaterial({ map: own(softDisc("14,20,36", 0.62, 0.3)), toneMapped: false, transparent: true, depthWrite: false })),
  );
  contactDisc.rotation.x = -Math.PI / 2;
  contactDisc.position.y = 0.007;
  contact.add(contactDisc);
  plinth.add(contact);
  scene.add(plinth);

  const camera = new PerspectiveCamera(24, 1, 0.5, 80);
  // The race's own post chain with the meadow's look, without its warm light tint (it would make the plinth blush) or its vignette; the bloom is a breath, for the lamps.
  const post = new PostChain(renderer, low ? "low" : "high", (target) => {
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
  });
  post.setLook({ ...LOOKS.meadow, vignette: 0, shadowTint: [0.97, 0.99, 1.04], highlightTint: [1, 1, 1], bloom: { threshold: 1.1, intensity: 0.16, radius: 0.6 } });
  let width = canvas.clientWidth || 640;
  let height = canvas.clientHeight || 480;

  // Riders already built stay built (flipping between drivers is the point of the screen); all are let go with the stage.
  const built = new Map<string, { model: KartModel; footprint: Vector2 }>();
  let current: { key: string; model: KartModel; footprint: Vector2 } | null = null;
  let since = 0;
  let spin = REST_YAW;
  let velocity = 0;
  let idle = 0;
  /** Coming round to the front three-quarter (a new driver was chosen). */
  let settling = false;
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
  const rimColour = new Color("#ffffff");

  /** Aims the camera from `aim` metres up the middle, `distance` away, a little above the plinth. */
  const aimFrom = (aim: number, distance: number): void => {
    const lift = 0.17;
    camera.position.set(0, aim + distance * Math.sin(lift), distance * Math.cos(lift));
    camera.lookAt(0, aim, 0);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
  };
  /** Is all of what must be seen in the picture, with a little room all round? */
  const sees = (): boolean =>
    FRAME.every((point) => {
      const v = point.clone().project(camera);
      return Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.95;
    });

  const place = (): void => {
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
    // The nearest the camera can stand and still see the whole plinth and the tallest driver's head, found by looking:
    // for each height to aim at, back off until everything fits, and keep the aim that needed the least room.
    let best = { aim: 1, distance: 40 };
    for (let aim = 0.5; aim <= 1.8; aim += 0.1) {
      for (let distance = 6; distance < best.distance; distance += 0.1) {
        aimFrom(aim, distance);
        if (sees()) {
          best = { aim, distance };
          break;
        }
      }
    }
    aimFrom(best.aim, best.distance);
  };

  const key_ = (rider: Rider): string => `${rider.character}|${rider.colour}|${rider.golden ? 1 : 0}`;

  /** The kart's footprint on the plinth (width and length in metres), measured once with it standing straight. */
  const measure = (model: KartModel): Vector2 => {
    model.root.rotation.set(0, 0, 0);
    model.root.scale.setScalar(1);
    model.root.updateMatrixWorld(true);
    const box = new Box3().setFromObject(model.root);
    return new Vector2(Math.max(1.2, box.max.x - box.min.x), Math.max(1.8, box.max.z - box.min.z));
  };

  /** Every part of the kart and its driver throws a shadow (the models flag only their bodies). */
  const casting = (root: Object3D): void => {
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (mesh.isMesh) mesh.castShadow = true;
    });
  };

  const draw = (): void => {
    if (disposed) return;
    const t = current ? since : 0;
    if (current) {
      const root: Object3D = current.model.root;
      const grow = calm ? 1 : Math.max(0.001, springIn(t));
      root.scale.setScalar(grow);
      // The rider turns in as they land, about a third of a turn that settles into the spin.
      const entering = calm ? 0 : (1 - Math.min(1, t / SPRING_FOR)) ** 3 * Math.PI * 0.6;
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
        rest: calm ? 0 : 1,
      });
      // The contact shadow follows the kart's footprint, its turn and its landing.
      contact.rotation.y = root.rotation.y;
      contactDisc.scale.set(current.footprint.x * 1.28 * grow, current.footprint.y * 1.2 * grow, 1);
    }
    // The ring flares a little the moment a rider lands.
    const flash = calm ? 0 : Math.max(0, 1 - since / 0.8);
    ring.scale.setScalar(1 + flash * 0.025);
    ringMaterial.opacity = 0.9 + flash * 0.1;
    rim.color.copy(rimColour);
    post.render(1 / 60);
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
      settling = false;
    } else {
      idle += dt;
      // Let go of a drag and it coasts.
      spin += velocity * dt;
      velocity *= Math.exp(-3.2 * dt);
      if (settling) {
        // A new driver: come back round to the front three-quarter, by the short way.
        const to = nearestTurn(spin, REST_YAW);
        const rest = Math.abs(to - spin);
        spin += (to - spin) * (1 - Math.exp(-SETTLE_RATE * dt));
        if (rest < 0.002) {
          spin = to;
          settling = false;
        }
        idle = Math.min(idle, 0.5);
      } else if (!calm && idle > TURN_AFTER) {
        // Idle for a while: the plinth's own slow turn, eased in.
        spin += TURN_RATE * Math.min(1, (idle - TURN_AFTER) / TURN_EASE) * dt;
      }
    }
    spin %= TAU;
    if (calm && !dirty && !dragging && Math.abs(velocity) < 0.002) return;
    dirty = false;
    draw();
  };

  const onDown = (event: PointerEvent): void => {
    dragging = { id: event.pointerId, x: event.clientX };
    velocity = 0;
    settling = false;
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
    post.setSize(width, height);
    post.setTiles([{ x: 0, y: 0, w: width, h: height }], width, height);
    place();
    dirty = true;
    if (!running) draw();
  };
  setSize(width, height, window.devicePixelRatio || 1);

  return {
    show(rider) {
      if (disposed) return;
      const wanted = key_(rider);
      if (current?.key === wanted) return;
      const first = current === null;
      if (current) scene.remove(current.model.root);
      let entry = built.get(wanted);
      if (!entry) {
        const model = createProceduralKart({ id: 0, colour: rider.colour, character: rider.character, golden: rider.golden });
        casting(model.root);
        entry = { model, footprint: measure(model) };
        built.set(wanted, entry);
      }
      entry.model.root.position.set(0, 0, 0);
      scene.add(entry.model.root);
      current = { key: wanted, model: entry.model, footprint: entry.footprint };
      since = 0;
      idle = 0;
      velocity = 0;
      // The next driver comes round to the front three-quarter (at once, with reduced motion).
      if (calm || first) spin = REST_YAW;
      else settling = true;
      rimColour.set(rider.colour).lerp(new Color("#ffffff"), 0.4);
      ringMaterial.color.set(rider.colour);
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
      // Else the karts' shared material and three's shared table keep this renderer (outliving.ts).
      const shared = outliving(renderer, scene);
      for (const { model } of built.values()) model.dispose();
      built.clear();
      for (const thing of owned) thing.dispose();
      key.shadow.map?.dispose();
      post.dispose();
      for (const thing of shared) thing.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
