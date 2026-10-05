/**
 * Grip Prix's renderer: one WebGLRenderer, one scene, and for every viewport a
 * scissored draw from its own chase camera, with its own HTML HUD on top.
 *
 * Speed matters more than polish in the plumbing. The track is built once
 * into merged, frustum-culled chunks; scenery is instanced; particles are two
 * pooled point clouds; the karts are a dozen draw calls each. A frame with
 * four viewports walks the same scene four times, so everything static is
 * kept few and large. Dynamic resolution, from the engine, adjusts the pixel
 * count to hold the frame rate.
 */
import {
  Color,
  Group,
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Texture,
} from "three";
import { WebGLUnavailable } from "../../engine/common";
import { DynamicResolution } from "../../engine/dynamicResolution";
import { gpuName, guessTier, INITIAL_SCALE } from "../../engine/tier";
import type { KartView, RaceEvent, RaceRenderer, RaceView, RacerSetup, TrackDef } from "../contract";
import type { TrackTheme } from "../track/geometry";
import { ChaseCamera } from "./cameras";
import { Effects } from "./effects";
import { Hud } from "./hud";
import { KartActor, type ActorContext, type KartFactory } from "./kart";
import { createProceduralKart } from "./kartModel";
import { layoutViews, type ViewLayout } from "./layout";
import { pointScale } from "./points";
import { Skids } from "./skids";
import { QUALITY, type QualitySettings, type Tier } from "./quality";
import { Things } from "./things";
import { slotsFromThings, rowSlots, type BoxSlot } from "./world/boxes";
import { createWorld, type World } from "./world";
import { glowTexture } from "./world/textures";
import { styleFor } from "./world/themes";

export interface RaceRendererOptions {
  /** "auto" (the default) guesses from the GPU. */
  quality?: Tier | "auto";
  /** Makes a kart's model; the procedural toy by default, a glTF loader later. */
  kartFactory?: KartFactory;
  /**
   * The picture turns a spun-out kart round itself (true), or the sim already
   * turns its heading and the picture only follows it (false).
   */
  spinInModel?: boolean;
  /** Dress the track in another theme (the dev page, to see all three on one track). */
  theme?: TrackTheme;
  /** Fade instead of move; also follows the page's Reduce Motion. */
  reduceMotion?: boolean;
}

/** What the dev page and the tests can ask the renderer about itself. */
export interface RenderStats {
  gpu: string;
  tier: Tier;
  pixelRatio: number;
  resolutionScale: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  views: number;
}

export interface GripRenderer extends RaceRenderer {
  stats(): RenderStats;
  /** For looking at the whole world from anywhere (the dev page): replaces the first view's camera; null puts the chase camera back. */
  setDebugCamera(pose: { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number; fov?: number } | null): void;
}

export function createRaceRenderer(canvas: HTMLCanvasElement, hudRoot: HTMLElement, options: RaceRendererOptions = {}): GripRenderer {
  const dprNow = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({
      canvas,
      // A retina screen hides the jaggies already; MSAA there would cost a lot for little.
      antialias: dprNow < 2,
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
    });
  } catch {
    // The same error the shooting games throw, so the page can show the same message.
    throw new WebGLUnavailable();
  }
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;
  renderer.setClearColor(new Color(0x0b0b0d), 1);

  const gpu = gpuName(renderer.getContext());
  const guessed = guessTier(gpu, typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4);
  const tier: Tier = options.quality && options.quality !== "auto" ? options.quality : guessed;
  const settings: QualitySettings = QUALITY[tier];
  const resolution = new DynamicResolution({ initial: INITIAL_SCALE[tier] });

  const calm =
    options.reduceMotion ??
    (typeof document !== "undefined" &&
      (document.documentElement.hasAttribute("data-reduce-motion") ||
        (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches)));
  const hud = new Hud(hudRoot, { blur: settings.glassBlur, calm });

  const scene = new Scene();
  const dynamic = new Group();
  scene.add(dynamic);
  const kartGroup = new Group();
  dynamic.add(kartGroup);

  const factory = options.kartFactory ?? createProceduralKart;
  const shadowTexture: Texture = glowTexture(0.0, 1.0);
  const lightTexture: Texture = glowTexture(0.0, 1.5);

  let world: World | null = null;
  let effects: Effects | null = null;
  let things: Things | null = null;
  let skids: Skids | null = null;
  let actors = new Map<number, KartActor>();
  let racers: readonly RacerSetup[] = [];
  let layout: ViewLayout = { views: [], free: null };
  let viewKarts: number[] = [0];
  let cameras: ChaseCamera[] = [];
  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;
  let dpr = dprNow;
  let time = 0;
  let lastEventId = -1;
  let lastTick = 0;
  let disposed = false;
  let ctxLost = false;
  let boxSlots: BoxSlot[] = [];
  let debugCamera: PerspectiveCamera | null = null;

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    ctxLost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    ctxLost = false;
  });

  const pixelRatio = () => Math.max(0.5, Math.min(dpr, settings.pixelRatioCap) * resolution.scale);

  const applySize = () => {
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    hud.setDpr(Math.min(dpr, 2));
  };

  const relayout = () => {
    layout = layoutViews(viewKarts.length, width, height);
    while (cameras.length < viewKarts.length) cameras.push(new ChaseCamera());
    cameras.length = viewKarts.length;
    for (const c of cameras) c.calm = calm;
    hud.setViews(layout, viewKarts);
  };

  const makeActor = (r: Pick<RacerSetup, "id" | "colour">): KartActor => {
    const ctx = actorContext();
    const a = new KartActor(r.id, factory, r, ctx);
    kartGroup.add(a.root);
    actors.set(r.id, a);
    return a;
  };

  const actorContext = (): ActorContext => ({
    track: world!.geometry,
    shadowTexture,
    lightTexture,
    night: world!.style.night,
    spinInModel: options.spinInModel ?? true,
  });

  const disposeWorld = () => {
    for (const a of actors.values()) a.dispose();
    actors = new Map();
    effects?.dispose();
    effects = null;
    things?.dispose();
    things = null;
    skids?.dispose();
    skids = null;
    world?.dispose();
    world = null;
  };

  const api: GripRenderer = {
    async load(track: TrackDef, racerSetups: readonly RacerSetup[], onProgress?: (fraction: number) => void): Promise<void> {
      disposeWorld();
      racers = racerSetups;
      const style = options.theme ? styleFor(options.theme) : undefined;
      const built = await createWorld(track, settings, (f) => onProgress?.(f * 0.95), style);
      if (disposed) {
        built.dispose();
        return;
      }
      world = built;
      scene.add(world.group);
      scene.fog = null;
      world.install(scene);
      scene.background = null;
      effects = new Effects(settings.particles);
      effects.calm = calm;
      const dust = new Color(world.style.dust);
      effects.setDustColour(dust.r, dust.g, dust.b);
      dynamic.add(effects.group);
      things = new Things(effects);
      dynamic.add(things.group);
      skids = new Skids();
      dynamic.add(skids.mesh);
      for (const r of racers) makeActor(r);
      hud.setTrack(world.geometry, racers);
      boxSlots = rowSlots(world.geometry);
      lastEventId = -1;
      hud.resetRace();
      time = 0;
      for (const c of cameras) c.reset();
      relayout();
      applySize();
      onProgress?.(1);
    },

    setViews(karts: readonly number[]): void {
      viewKarts = karts.length ? [...karts].slice(0, 4) : [0];
      relayout();
      for (const c of cameras) c.reset();
    },

    frame(view: RaceView, dtRaw: number): void {
      if (!world || !effects || !things || !skids || disposed || ctxLost) return;
      const dt = Math.min(0.1, Math.max(0, dtRaw));
      time += dt;
      if (dtRaw > 0 && resolution.sample(dtRaw * 1000)) applySize();

      // A new race starts the tick count over.
      if (view.tick < lastTick - 5) {
        lastEventId = -1;
        effects.clear();
        skids.clear();
        hud.resetRace();
        for (const c of cameras) c.reset();
      }
      lastTick = view.tick;

      const byId = new Map<number, KartView>();
      for (const k of view.karts) byId.set(k.id, k);

      // Karts.
      const ctx = actorContext();
      for (const k of view.karts) {
        let a = actors.get(k.id);
        if (!a) {
          const r = view.racers.find((x) => x.id === k.id) ?? { id: k.id, colour: "#ffffff" };
          a = makeActor(r);
        }
        a.update(k, dt, ctx, time);
        effects.kart(k, dt);
        skids.kart(k);
        if (world.style.night) {
          const fx = Math.sin(k.heading);
          const fz = Math.cos(k.heading);
          const rx = -Math.cos(k.heading);
          const rz = Math.sin(k.heading);
          for (const s of [-1, 1]) {
            effects.glowNow(k.x + fx * 1.55 + rx * s * 0.2, k.y + 0.52, k.z + fz * 1.55 + rz * s * 0.2, 1.0, 1.0, 0.92, 0.7, 0.8);
            effects.glowNow(k.x - fx * 1.3 + rx * s * 0.4, k.y + 0.9, k.z - fz * 1.3 + rz * s * 0.4, 0.55, 1.0, 0.1, 0.08, 0.7);
          }
        }
      }

      // Item boxes: the sim's if it sends any, else the track's own rows.
      boxSlots = slotsFromThings(view.things) ?? boxSlots;
      world.boxes.update(boxSlots, time, dt, (x, y, z, r, g, b) => effects!.glowNow(x, y, z, 2.4, r * 1.2, g * 1.2, b * 1.2, 0.28));
      things.update(view.things, time);

      // Events, once each.
      const kartAt = (id: number) => byId.get(id);
      for (const e of view.events as readonly RaceEvent[]) {
        if (e.id <= lastEventId) continue;
        lastEventId = e.id;
        effects.onEvent(e, kartAt);
        const shake = e.type === "bump" ? 0.35 : e.type === "wall" ? 0.5 : e.type === "hit" ? 0.8 : 0;
        if (shake > 0) {
          viewKarts.forEach((id, i) => {
            const involved = e.type === "bump" ? e.a === id || e.b === id : "kart" in e && e.kart === id;
            if (involved) cameras[i]?.kick(shake);
          });
        }
      }

      // The start lights.
      if (view.phase === "countdown") world.setStartLights(view.countdown > 3 ? 0 : 4 - Math.ceil(Math.max(0.001, view.countdown)));
      else world.setStartLights(view.time < 1.6 ? "go" : "off");

      world.update(time, dt);
      effects.update(dt);
      skids.update(dt);

      // Draw.
      renderer.info.reset();
      const pr = renderer.getPixelRatio();
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, width, height);
      renderer.clear(true, true, false);
      renderer.setScissorTest(true);
      viewKarts.forEach((id, i) => {
        const rect = layout.views[i];
        const kart = byId.get(id);
        const cam = cameras[i];
        if (!rect || !kart || !cam) return;
        cam.update(kart, view, dt, rect.w / rect.h);
        let eye = cam.camera;
        if (debugCamera && i === 0) {
          debugCamera.aspect = rect.w / rect.h;
          debugCamera.updateProjectionMatrix();
          eye = debugCamera;
        }
        world!.sky.group.position.copy(eye.position);
        const fovRad = (eye.fov * Math.PI) / 180;
        pointScale.value = (rect.h * pr) / (2 * Math.tan(fovRad / 2));
        const y = height - rect.y - rect.h;
        renderer.setViewport(rect.x, y, rect.w, rect.h);
        renderer.setScissor(rect.x, y, rect.w, rect.h);
        renderer.render(scene, eye);
      });
      renderer.setScissorTest(false);

      hud.update(view, dt);
    },

    resize(w: number, h: number, ratio: number): void {
      width = Math.max(1, Math.floor(w));
      height = Math.max(1, Math.floor(h));
      dpr = ratio || 1;
      applySize();
      relayout();
    },

    dispose(): void {
      disposed = true;
      disposeWorld();
      hud.dispose();
      shadowTexture.dispose();
      lightTexture.dispose();
      renderer.dispose();
    },

    setDebugCamera(pose) {
      if (!pose) {
        debugCamera = null;
        return;
      }
      debugCamera = new PerspectiveCamera(pose.fov ?? 60, 1, 0.5, 2600);
      debugCamera.position.set(pose.x, pose.y, pose.z);
      debugCamera.lookAt(pose.lookX, pose.lookY, pose.lookZ);
    },

    stats(): RenderStats {
      return {
        gpu,
        tier,
        pixelRatio: renderer.getPixelRatio(),
        resolutionScale: resolution.scale,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        views: viewKarts.length,
      };
    },
  };
  renderer.info.autoReset = false;
  applySize();
  relayout();
  return api;
}
