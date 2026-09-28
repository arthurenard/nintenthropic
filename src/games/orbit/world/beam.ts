/**
 * The point-defence laser's beam: a thin, bright line from the emitter on
 * the truss below the window to whatever it hit (or out into the dark),
 * there and gone in a blink with a shimmer along it. Drawn as a ribbon
 * turned to face the eye, a few pixels wide at any distance, so it reads as
 * light rather than a rod. Silent outside, like everything else.
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial, Vector3, type Object3D } from "three";

const VERTEX = /* glsl */ `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uGlow;
uniform float uLife;
uniform float uSeed;
varying vec2 vUv;
float hash(float x) { return fract(sin(x * 91.3458 + uSeed) * 47453.5453); }
void main() {
  float v = vUv.y;
  // (v * v, not pow: pow is undefined for a negative base.)
  float core = exp(-(v * v) / (0.22 * 0.22));
  float glow = exp(-(v * v) / (0.6 * 0.6)) * 0.5;
  // A shimmer along it, the optics' flutter: gentle, never a dotted line.
  float u = vUv.x;
  float shimmer = 0.88 + 0.12 * sin(u * 9.0 + uSeed * 7.0) * sin(u * 4.0 - uSeed * 3.0 + uLife * 20.0);
  // Brightest at the emitter's end for the first instant, even along it after.
  float fade = uLife * uLife;
  vec3 c = (uCore * core + uGlow * glow) * shimmer * fade;
  gl_FragColor = vec4(c, 1.0);
}
`;

interface Beam {
  mesh: Mesh;
  material: ShaderMaterial;
  positions: Float32Array;
  from: Vector3;
  to: Vector3;
  life: number;
  duration: number;
}

const side = new Vector3();
const dir = new Vector3();
const toCam = new Vector3();
const mid = new Vector3();

export class LaserBeams {
  private readonly beams: Beam[] = [];
  private next = 0;
  /** Settings.reducedFlashing: a softer, longer line. */
  reducedFlashing = false;
  golden = false;

  constructor(parent: Object3D, count = 6) {
    for (let i = 0; i < count; i++) {
      const g = new BufferGeometry();
      const positions = new Float32Array(12);
      g.setAttribute("position", new BufferAttribute(positions, 3));
      g.setAttribute("aUv", new BufferAttribute(new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), 2));
      g.setIndex([0, 2, 1, 1, 2, 3]);
      const material = new ShaderMaterial({
        vertexShader: VERTEX,
        fragmentShader: FRAGMENT,
        uniforms: { uCore: { value: new Color() }, uGlow: { value: new Color() }, uLife: { value: 0 }, uSeed: { value: 0 } },
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: DoubleSide,
      });
      const mesh = new Mesh(g, material);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = 7;
      parent.add(mesh);
      this.beams.push({ mesh, material, positions, from: new Vector3(), to: new Vector3(), life: 0, duration: 0.12 });
    }
  }

  /** A shot: from the emitter to `to` (or, "weld", the drone's thin blue welding beam on the glass). */
  fire(from: Vector3, to: Vector3, kind: "shot" | "weld" = "shot"): void {
    const b = this.beams[this.next] as Beam;
    this.next = (this.next + 1) % this.beams.length;
    b.from.copy(from);
    b.to.copy(to);
    b.duration = kind === "weld" ? 0.22 : this.reducedFlashing ? 0.3 : 0.13;
    b.life = b.duration;
    b.mesh.visible = true;
    const k = this.reducedFlashing ? 0.3 : 1;
    const u = b.material.uniforms;
    if (kind === "weld") {
      (u["uCore"]!.value as Color).setRGB(1.6 * k, 2.4 * k, 3.4 * k);
      (u["uGlow"]!.value as Color).setRGB(0.2 * k, 0.5 * k, 1.4 * k);
    } else if (this.golden) {
      (u["uCore"]!.value as Color).setRGB(9 * k, 7.2 * k, 3 * k);
      (u["uGlow"]!.value as Color).setRGB(2.6 * k, 1.6 * k, 0.3 * k);
    } else {
      (u["uCore"]!.value as Color).setRGB(8 * k, 7.4 * k, 7 * k);
      (u["uGlow"]!.value as Color).setRGB(2.8 * k, 0.55 * k, 0.35 * k);
    }
    u["uSeed"]!.value = Math.random() * 100;
  }

  /** Each frame: fade the live beams, and turn them to face the eye. */
  update(dt: number, eye: Vector3, pixelWidth: number): void {
    for (const b of this.beams) {
      if (b.life <= 0) {
        b.mesh.visible = false;
        continue;
      }
      b.life -= dt;
      const t = Math.max(0, b.life / b.duration);
      b.material.uniforms["uLife"]!.value = t;
      dir.copy(b.to).sub(b.from);
      mid.copy(b.from).addScaledVector(dir, 0.5);
      toCam.copy(eye).sub(mid);
      side.copy(dir).cross(toCam).normalize();
      // Half a width, in metres, that is a few pixels at each end's distance.
      const wa = b.from.distanceTo(eye) * pixelWidth;
      const wb = b.to.distanceTo(eye) * pixelWidth;
      const p = b.positions;
      p[0] = b.from.x - side.x * wa;
      p[1] = b.from.y - side.y * wa;
      p[2] = b.from.z - side.z * wa;
      p[3] = b.from.x + side.x * wa;
      p[4] = b.from.y + side.y * wa;
      p[5] = b.from.z + side.z * wa;
      p[6] = b.to.x - side.x * wb;
      p[7] = b.to.y - side.y * wb;
      p[8] = b.to.z - side.z * wb;
      p[9] = b.to.x + side.x * wb;
      p[10] = b.to.y + side.y * wb;
      p[11] = b.to.z + side.z * wb;
      const attr = b.mesh.geometry.getAttribute("position") as BufferAttribute;
      attr.needsUpdate = true;
    }
  }

  clear(): void {
    for (const b of this.beams) {
      b.life = 0;
      b.mesh.visible = false;
    }
  }

  dispose(): void {
    for (const b of this.beams) {
      b.mesh.removeFromParent();
      b.mesh.geometry.dispose();
      b.material.dispose();
    }
  }
}
