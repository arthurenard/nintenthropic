/**
 * Grip Prix's renderer: one WebGLRenderer, one scene, and for every viewport a
 * scissored draw from its own chase camera, with its own HTML HUD on top.
 *
 * Every frame, each view is drawn (scissored) into one multisampled HDR
 * target, with the sun's shadow map re-aimed at that view's kart first; then
 * ONE post pass over the whole canvas does bloom, the tone curve, the theme's
 * colour grade and a vignette per view (post.ts). The world's light that does
 * not move (the sun's shadow on the static scenery, its ambient occlusion) is
 * baked once at load (world/bake.ts); the sky is the scene's environment, so
 * everything glossy reflects the world it is in.
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
  Mesh,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Object3D,
  type Texture,
  type WebGLRenderTarget,
} from "three";
import { WebGLUnavailable } from "../../engine/common";
import { DynamicResolution } from "../../engine/dynamicResolution";
import { gpuName, guessTier, INITIAL_SCALE } from "../../engine/tier";
import type { KartView, RaceEvent, RaceRenderer, RaceView, RacerSetup, TrackDef } from "../contract";
import type { TrackTheme } from "../track/geometry";
import { ChaseCamera } from "./cameras";
import { Effects } from "./effects";
import { RenderEggs } from "./eggs";
import { Hud } from "./hud";
import { ItemFx } from "./itemfx";
import { KartActor, type ActorContext, type KartFactory } from "./kart";
import { createProceduralKart } from "./kartModel";
import { layoutViews, type ViewLayout } from "./layout";
import { PostChain, type DrawViews } from "./post";
import { pointScale } from "./points";
import { Skids } from "./skids";
import { QUALITY, type QualitySettings, type Tier } from "./quality";
import { Things } from "./things";
import { slotsFromThings, rowSlots, type BoxSlot } from "./world/boxes";
import { createWorld, type World } from "./world";
import { kartMaterial } from "./kartMaterial";
import { addBakedSun, makeBakeUniforms, shareBake } from "./world/shading";
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
      // Anti-aliasing is the post chain's (MSAA on its HDR target, or SMAA), not the canvas's.
      antialias: false,
      alpha: false,
      stencil: false,
      powerPreference: "high-performance",
    });
  } catch {
    // The same error the shooting games throw, so the page can show the same message.
    throw new WebGLUnavailable();
  }
  renderer.outputColorSpace = SRGBColorSpace;
  // The post chain's grade is the tone map; the scene renders in linear HDR.
  renderer.toneMapping = NoToneMapping;
  renderer.autoClear = false;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(new Color(0x0b0b0d), 1);

  const gpu = gpuName(renderer.getContext());
  const guessed = guessTier(gpu, typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 4 : 4);
  const tier: Tier = options.quality && options.quality !== "auto" ? options.quality : guessed;
  const settings: QualitySettings = QUALITY[tier];
  const resolution = new DynamicResolution({ initial: INITIAL_SCALE[tier] });
  renderer.shadowMap.enabled = settings.shadowMap > 0;

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
  /** Honk bubbles, the duck's flight and the Fun Fair's fireworks (eggs.ts). */
  const eggs = new RenderEggs(hudRoot, dynamic, calm);

  const factory = options.kartFactory ?? createProceduralKart;
  const shadowTexture: Texture = glowTexture(0.0, 1.0);
  const lightTexture: Texture = glowTexture(0.0, 1.5);

  /** The karts' material reads the world's baked sun shadow through uniforms of its own. */
  const kartBake = makeBakeUniforms();
  let world: World | null = null;
  let effects: Effects | null = null;
  let things: Things | null = null;
  let itemFx: ItemFx | null = null;
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
  /** The race's laps, from the latest view: a kart past them has finished. */
  let raceLaps = Infinity;
  let disposed = false;
  let ctxLost = false;
  let boxSlots: BoxSlot[] = [];
  const boxLift = new Map<number, number>();
  let debugCamera: PerspectiveCamera | null = null;
  /** The views of the frame being drawn: the post chain's first pass walks them. */
  const frameViews: { rect: { x: number; y: number; w: number; h: number }; eye: PerspectiveCamera; at: { x: number; y: number; z: number } }[] = [];

  /** Draws every view, scissored, into the post chain's HDR target. */
  const drawViews: DrawViews = (target: WebGLRenderTarget) => {
    if (!world) return;
    const pr = target.width / Math.max(1, width);
    renderer.setRenderTarget(target);
    target.scissorTest = false;
    target.viewport.set(0, 0, target.width, target.height);
    renderer.setRenderTarget(target);
    renderer.clear(true, true, false);
    target.scissorTest = true;
    for (const v of frameViews) {
      const x = Math.floor(v.rect.x * pr);
      const w = Math.min(target.width - x, Math.ceil(v.rect.w * pr));
      const h = Math.ceil(v.rect.h * pr);
      const y = Math.max(0, target.height - Math.floor(v.rect.y * pr) - h);
      target.viewport.set(x, y, w, h);
      target.scissor.set(x, y, w, h);
      renderer.setRenderTarget(target);
      world.sky.group.position.copy(v.eye.position);
      const fovRad = (v.eye.fov * Math.PI) / 180;
      pointScale.value = (h) / (2 * Math.tan(fovRad / 2));
      world.focusSun(v.at.x, v.at.y, v.at.z);
      renderer.render(scene, v.eye);
    }
    target.scissorTest = false;
  };
  const post = new PostChain(renderer, tier, drawViews);

  /** Everything solid that moves casts a shadow and receives one; particles, glows and glass do not. */
  const markShadows = (root: Object3D) => {
    root.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || o.userData.shadowed) return;
      o.userData.shadowed = true;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      if (!mat || (mat.transparent && mat.opacity < 0.99) || mat.blending !== 1) return;
      m.castShadow = true;
      m.receiveShadow = true;
    });
  };
  let shadowSweep = 0;

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
    post.setSize(width, height);
    post.setTiles(layout.views, width, height);
    hud.setDpr(Math.min(dpr, 2));
  };

  const relayout = () => {
    layout = layoutViews(viewKarts.length, width, height);
    while (cameras.length < viewKarts.length) cameras.push(new ChaseCamera());
    cameras.length = viewKarts.length;
    for (const c of cameras) c.calm = calm;
    hud.setViews(layout, viewKarts);
    eggs.setViews(viewKarts.length);
  };

  const makeActor = (r: Pick<RacerSetup, "id" | "colour" | "character" | "golden">): KartActor => {
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
    surface: (x, z, hint) => world!.surfaceLift(x, z, hint),
    rollAt: (distance) => world!.bank.rollAt(distance),
    dynamic,
    laps: raceLaps,
  });

  const disposeWorld = () => {
    for (const a of actors.values()) a.dispose();
    actors = new Map();
    effects?.dispose();
    effects = null;
    things?.dispose();
    things = null;
    itemFx?.dispose();
    itemFx = null;
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
      world.prepare(renderer, scene);
      shareBake(kartBake, world.bake);
      addBakedSun(kartMaterial(), kartBake);
      post.setLook(world.look);
      scene.background = null;
      effects = new Effects(settings.particles);
      effects.calm = calm;
      effects.world = world.style.id;
      const dust = new Color(world.style.dust);
      effects.setDustColour(dust.r, dust.g, dust.b);
      dynamic.add(effects.group);
      things = new Things(effects);
      dynamic.add(things.group);
      itemFx = new ItemFx(effects, { geometry: things.puck, material: things.lit });
      dynamic.add(itemFx.group);
      skids = new Skids();
      dynamic.add(skids.mesh);
      for (const r of racers) makeActor(r);
      markShadows(dynamic);
      hud.setTrack(world.geometry, racers);
      eggs.load(world.style.id, world.geometry);
      boxSlots = rowSlots(world.geometry);
      boxLift.clear();
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
      if (!world || !effects || !things || !itemFx || !skids || disposed || ctxLost) return;
      const dt = Math.min(0.1, Math.max(0, dtRaw));
      time += dt;
      if (dtRaw > 0 && resolution.sample(dtRaw * 1000)) applySize();

      // A new race starts the tick count over.
      if (view.tick < lastTick - 5) {
        lastEventId = -1;
        effects.clear();
        itemFx.clear();
        skids.clear();
        hud.resetRace();
        eggs.reset();
        for (const c of cameras) c.reset();
      }
      lastTick = view.tick;
      raceLaps = view.laps;

      // Karts, standing where the road really is (its banking and any ramp lift them) and, when they have fallen, where the drone has them.
      const byId = new Map<number, KartView>();
      const ctx = actorContext();
      for (const k0 of view.karts) {
        let a = actors.get(k0.id);
        if (!a) {
          const r = view.racers.find((x) => x.id === k0.id) ?? { id: k0.id, colour: "#ffffff" };
          a = makeActor(r);
        }
        a.update(k0, dt, ctx, time);
        // Everything below this line sees the kart as drawn.
        const k: KartView = { ...k0, x: a.x, y: a.roadY, z: a.z };
        byId.set(k.id, k);
        effects.kart(k, dt, k0.rescue > 0 ? { x: a.x, y: a.y, z: a.z, falling: a.falling } : undefined);
        if (k0.rescue <= 0) skids.kart(k);
        if (world.style.night && k0.rescue <= 0) {
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

      itemFx.update(view, byId, actors, dt, time);

      // Item boxes: the sim's if it sends any, else the track's own rows. A banked road lifts them like everything else on it.
      const sent = slotsFromThings(view.things);
      boxSlots = sent ?? boxSlots;
      const lifted = boxSlots.map((slot) => {
        let lift = boxLift.get(slot.id);
        if (lift === undefined) {
          lift = world!.surfaceLift(slot.x, slot.z).lift;
          boxLift.set(slot.id, lift);
        }
        return lift === 0 ? slot : { ...slot, y: slot.y + lift };
      });
      // Decoys are boxes that are not: drawn with the rest, with their tells.
      for (const t of view.things) {
        if (t.kind === "decoy") lifted.push({ id: t.id, x: t.x, y: t.y + world.surfaceLift(t.x, t.z).lift, z: t.z, active: true, decoy: true });
      }
      world.boxes.update(lifted, time, dt, (x, y, z, r, g, b) => effects!.glowNow(x, y, z, 2.4, r * 1.2, g * 1.2, b * 1.2, 0.28));
      things.update(
        view.things.map((t) => (t.kind === "box" ? t : { ...t, y: t.y + world!.surfaceLift(t.x, t.z).lift })),
        time,
      );

      // Events, once each.
      const kartAt = (id: number) => byId.get(id);
      for (const e of view.events as readonly RaceEvent[]) {
        if (e.id <= lastEventId) continue;
        lastEventId = e.id;
        effects.onEvent(e, kartAt);
        itemFx.onEvent(e, kartAt);
        eggs.onEvent(e, view.racers, time);
        const shake = e.type === "bump" ? 0.35 : e.type === "wall" ? 0.5 : e.type === "hit" ? 0.8 : e.type === "strike" && e.item !== "storm" ? 0.6 : 0;
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

      world.update(time, dt, view.time);
      effects.update(dt);
      eggs.update(dt);
      skids.update(dt);

      // Cameras, then the post chain draws every view and grades the result once.
      renderer.info.reset();
      if (++shadowSweep % 45 === 1) markShadows(dynamic);
      frameViews.length = 0;
      viewKarts.forEach((id, i) => {
        const rect = layout.views[i];
        const kart = byId.get(id);
        const cam = cameras[i];
        if (!rect || !kart || !cam) return;
        const actor = actors.get(id);
        const follow = actor ? { ...kart, x: actor.anchor.x, y: actor.anchor.y, z: actor.anchor.z } : kart;
        cam.update(follow, view, dt, rect.w / rect.h);
        let eye = cam.camera;
        if (debugCamera && i === 0) {
          debugCamera.aspect = rect.w / rect.h;
          debugCamera.updateProjectionMatrix();
          eye = debugCamera;
        }
        frameViews.push({ rect, eye, at: { x: follow.x, y: follow.y, z: follow.z } });
      });
      post.setTiles(layout.views, width, height);
      post.render(dt);
      frameViews.forEach((v, i) => eggs.view(i, v.rect, v.eye, kartAt, time));
      eggs.end(time);

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
      eggs.dispose();
      hud.dispose();
      post.dispose();
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
