/**
 * A turntable for judging the kart model on its own (dev page,
 * `?turntable=1`): a kart on a plain floor in the meadow's light, seen from
 * `angle` degrees round (0 is straight behind) and `elev` degrees up, with
 * `steer`, `boost` and `lean` to see the poses. Not part of the game.
 *
 *   ?character=bun      the driver (characters.ts id); ?golden=1 the golden kart
 *   ?all=1              all nine drivers at once, one viewport each (3 x 3)
 *   ?emote=cheer|wave   the driver's gesture; ?finished=1 the finish bounce; ?dizzy=1 a spin-out
 *   ?t=1.2              freeze the clock there (for a steady picture)
 *   ?dist=9 ?elev=18 ?angle=0 ?look=0.85   the camera (look: the height it aims at)
 *   ?spin=1 ?steer=0.5 ?boost=1 ?colour=%23FF453A
 */
import { Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshLambertMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from "three";
import { CHARACTERS } from "../characters";
import { BOT_COLOURS, PLAYER_COLOURS, type Emote } from "../contract";
import type { KartModel } from "./kart";
import { createProceduralKart } from "./kartModel";
import { styleFor } from "./world/themes";

export function runTurntable(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const style = styleFor((params.get("theme") as "meadow" | "canyon" | "harbour" | null) ?? "meadow");
  const scene = new Scene();
  scene.background = new Color(style.sky.horizon);
  scene.fog = new Fog(style.fog.colour, 40, 200);
  const floor = new Mesh(new PlaneGeometry(600, 600).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: new Color(style.road.base) }));
  scene.add(floor);
  scene.add(new HemisphereLight(style.light.skyColour, style.light.groundColour, style.light.hemiIntensity));
  const sun = new DirectionalLight(style.light.sunColour, style.light.sunIntensity);
  sun.position.set(...style.sky.sunDir).multiplyScalar(50);
  scene.add(sun);

  const golden = params.get("golden") === "1";
  const colours = [...PLAYER_COLOURS, ...BOT_COLOURS];
  const all = params.get("all") === "1";
  const wanted = all ? CHARACTERS.map((c) => c.id) : [params.get("character") ?? undefined];
  const karts: { model: KartModel; x: number; z: number }[] = wanted.map((character, i) => {
    const model = createProceduralKart({ id: i, colour: all ? colours[i % colours.length]! : (params.get("colour") ?? "#FF453A"), character, golden });
    // Far apart, so the other karts are out of each viewport's picture.
    const x = all ? ((i % 3) - 1) * 40 : 0;
    const z = all ? (Math.floor(i / 3) - 1) * 70 : 0;
    model.root.position.set(x, 0, z);
    scene.add(model.root);
    return { model, x, z };
  });

  const camera = new PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 500);
  const angle = (Number(params.get("angle") ?? 0) * Math.PI) / 180;
  const elev = (Number(params.get("elev") ?? 18) * Math.PI) / 180;
  const dist = Number(params.get("dist") ?? 9);
  const look = Number(params.get("look") ?? 0.85);
  const spin = params.get("spin") === "1";
  const steer = Number(params.get("steer") ?? 0);
  const boost = Number(params.get("boost") ?? 0);
  const lean = Number(params.get("lean") ?? steer * 0.3);
  const emote = (params.get("emote") as Emote | null) ?? null;
  const finished = params.get("finished") === "1";
  const dizzy = params.get("dizzy") === "1";
  const frozen = params.has("t") ? Number(params.get("t")) : null;
  const w = window.innerWidth;
  const h = window.innerHeight;
  const cols = all ? 3 : 1;
  const rows = all ? 3 : 1;
  let t = 0;
  function frame(): void {
    t += 1 / 60;
    const now = frozen ?? t;
    const a = angle + (spin ? now * 0.6 : 0);
    renderer.setScissorTest(all);
    karts.forEach(({ model, x, z }, i) => {
      model.pose({
        steer,
        wheelSpin: now * 8,
        lean,
        roll: -steer * 0.08,
        pitch: 0,
        hop: 0,
        shake: 0,
        flame: boost,
        flicker: 0.5 + 0.5 * Math.sin(now * 60),
        slide: 0,
        time: now,
        emote,
        finished,
        dizzy,
      });
      // Angle 0 is behind the kart (it faces +z, so behind is -z).
      camera.position.set(x + Math.sin(a + Math.PI) * dist * Math.cos(elev), 1 + Math.sin(elev) * dist, z + Math.cos(a + Math.PI) * dist * Math.cos(elev));
      camera.lookAt(x, look, z);
      if (all) {
        const vw = Math.floor(w / cols);
        const vh = Math.floor(h / rows);
        const vx = (i % cols) * vw;
        const vy = h - (Math.floor(i / cols) + 1) * vh;
        renderer.setViewport(vx, vy, vw, vh);
        renderer.setScissor(vx, vy, vw, vh);
        camera.aspect = vw / vh;
      } else {
        camera.aspect = w / h;
      }
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    });
    requestAnimationFrame(frame);
  }
  frame();
  (window as unknown as { __grip: unknown }).__grip = { stats: () => ({ gpu: "turntable" }), fps: () => 60 };
  document.getElementById("loading")?.classList.add("done");
}
