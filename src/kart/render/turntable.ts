/**
 * A turntable for judging the kart model on its own (dev page,
 * `?turntable=1`): one kart on a plain floor in the meadow's light, seen from
 * `angle` degrees round (0 is straight behind) and `elev` degrees up, with
 * `steer`, `boost` and `lean` to see the poses. Not part of the game.
 */
import { Color, DirectionalLight, Fog, HemisphereLight, Mesh, MeshLambertMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, WebGLRenderer } from "three";
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
  const floor = new Mesh(new PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new MeshLambertMaterial({ color: new Color(style.road.base) }));
  scene.add(floor);
  scene.add(new HemisphereLight(style.light.skyColour, style.light.groundColour, style.light.hemiIntensity));
  const sun = new DirectionalLight(style.light.sunColour, style.light.sunIntensity);
  sun.position.set(...style.sky.sunDir).multiplyScalar(50);
  scene.add(sun);

  const kart = createProceduralKart({ id: 0, colour: params.get("colour") ?? "#FF453A" });
  scene.add(kart.root);

  const camera = new PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.1, 500);
  const angle = (Number(params.get("angle") ?? 0) * Math.PI) / 180;
  const elev = (Number(params.get("elev") ?? 18) * Math.PI) / 180;
  const dist = Number(params.get("dist") ?? 9);
  const spin = params.get("spin") === "1";
  const steer = Number(params.get("steer") ?? 0);
  const boost = Number(params.get("boost") ?? 0);
  const lean = Number(params.get("lean") ?? steer * 0.3);
  let t = 0;
  function frame(): void {
    t += 1 / 60;
    const a = angle + (spin ? t * 0.6 : 0);
    // Angle 0 is behind the kart (it faces +z, so behind is -z).
    camera.position.set(Math.sin(a + Math.PI) * dist * Math.cos(elev), 1 + Math.sin(elev) * dist, Math.cos(a + Math.PI) * dist * Math.cos(elev));
    camera.lookAt(0, 0.85, 0);
    kart.pose({
      steer,
      wheelSpin: t * 8,
      lean,
      roll: -steer * 0.08,
      pitch: 0,
      hop: 0,
      shake: 0,
      flame: boost,
      flicker: 0.5 + 0.5 * Math.sin(t * 60),
      slide: 0,
    });
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  frame();
  (window as unknown as { __grip: unknown }).__grip = { stats: () => ({ gpu: "turntable" }), fps: () => 60 };
  document.getElementById("loading")?.classList.add("done");
}
