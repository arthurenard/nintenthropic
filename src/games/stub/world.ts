/**
 * The stand-in range's scenery: a dusk sky, a plain of packed earth, a few
 * crates and posts. Built from primitives in code, so the stand-in needs no
 * downloads and loads instantly.
 */
import {
  BackSide,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SphereGeometry,
} from "three";

export const HORIZON = new Color("#e9b27a");
const ZENITH = new Color("#3d5a78");

/** A sky dome that fades from a warm horizon to a dusty blue overhead. */
function sky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { horizon: { value: HORIZON.clone() }, zenith: { value: ZENITH.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 horizon;
      uniform vec3 zenith;
      varying vec3 vDirection;
      void main() {
        float up = clamp(vDirection.y, 0.0, 1.0);
        vec3 colour = mix(horizon, zenith, pow(up, 0.55));
        // A low sun glow behind the far end of the range.
        float glow = pow(max(dot(vDirection, normalize(vec3(0.35, 0.08, -1.0))), 0.0), 24.0);
        gl_FragColor = vec4(colour + vec3(1.0, 0.72, 0.42) * glow * 0.55, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const dome = new Mesh(new SphereGeometry(400, 32, 16), material);
  dome.renderOrder = -1;
  return dome;
}

const wood = new MeshStandardMaterial({ color: "#8a6440", roughness: 0.9 });
const darkWood = new MeshStandardMaterial({ color: "#5e4129", roughness: 0.95 });

export function crate(size: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(size, size, size), wood);
  mesh.position.y = size / 2;
  return mesh;
}

/** A post from the ground up to `height`, for a bottle to stand on. */
export function post(height: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.09, height, 0.09), darkWood);
  mesh.position.y = height / 2;
  return mesh;
}

export function buildWorld(): { scene: Scene; props: Group } {
  const scene = new Scene();
  scene.background = HORIZON.clone();
  scene.fog = new Fog(HORIZON.clone(), 35, 140);
  scene.add(sky());

  const ground = new Mesh(
    new PlaneGeometry(400, 400, 1, 1),
    new MeshStandardMaterial({ color: "#b98a5e", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const sun = new DirectionalLight("#ffd9a8", 2.2);
  sun.position.set(-6, 9, 12);
  scene.add(sun, new HemisphereLight("#9fb6d0", "#7a5a3c", 1.1));

  // Cover the targets rise from, spread across the range.
  const props = new Group();
  const spots: [number, number, number][] = [
    [-7, -12, 1.1],
    [-2.5, -16, 1.0],
    [3, -13, 1.2],
    [8, -18, 1.1],
    [-11, -22, 1.3],
    [12, -25, 1.3],
    [0.5, -26, 1.4],
    [-5, -31, 1.4],
  ];
  for (const [x, z, size] of spots) {
    const box = crate(size);
    box.position.x = x;
    box.position.z = z;
    box.rotation.y = (x * 0.37) % 0.6;
    props.add(box);
  }
  // A line of fence posts down each side, for depth.
  for (let i = 0; i < 9; i++) {
    for (const side of [-1, 1]) {
      const fence = post(1.2);
      fence.position.set(side * 15, 0.6, -6 - i * 6);
      props.add(fence);
    }
  }
  scene.add(props);
  return { scene, props };
}

/** A tall pole with a small bell on top, far down the range: the secret. */
export function bellPost(): { group: Group; bell: Mesh } {
  const group = new Group();
  const pole = post(6);
  const bell = new Mesh(
    new CylinderGeometry(0.18, 0.34, 0.45, 16, 1, true),
    new MeshStandardMaterial({ color: "#c9a14a", metalness: 0.9, roughness: 0.35, side: 2 }),
  );
  bell.position.y = 6.2;
  group.add(pole, bell);
  group.position.set(-9, 0, -45);
  return { group, bell };
}
