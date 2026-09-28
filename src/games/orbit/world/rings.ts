/**
 * The window's heads-up display: a soft ring round anything coming at the
 * glass, drawn once it is within the ring's lead of impact (5 s, 7 s on
 * Relaxed), with its closing seconds beside it and an arc that runs down
 * with them - white, turning the warning's orange for the last two. Things
 * that will miss get no ring. Drawn over the finished picture, crisp at the
 * screen's own resolution, as the page's crosshair is.
 */
import {
  CanvasTexture,
  Color,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  type WebGLRenderer,
} from "three";

const RING_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

const RING_FRAGMENT = /* glsl */ `
uniform float uRadius;
uniform float uHalf;
uniform float uFrac;
uniform float uAlpha;
uniform vec3 uColor;
uniform float uPx;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * 2.0 * uHalf;
  float d = length(p);
  float w = uPx;
  // The ring: a hairline, softly glowing.
  float line = 1.0 - smoothstep(0.6 * w, 1.4 * w, abs(d - uRadius));
  float halo = exp(-pow((d - uRadius) / (5.0 * w), 2.0)) * 0.18;
  // The arc of seconds left, clockwise from the top.
  float a = atan(p.x, p.y);
  float turn = fract(a / 6.2831853 + 1.0);
  float arc = (1.0 - smoothstep(1.2 * w, 2.2 * w, abs(d - uRadius - 4.0 * w))) * step(turn, uFrac);
  float alpha = max(line * 0.55, arc) + halo;
  gl_FragColor = vec4(uColor, alpha * uAlpha);
}
`;

const GLYPH_FRAGMENT = /* glsl */ `
uniform sampler2D tGlyphs;
uniform float uGlyph;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec4 g = texture2D(tGlyphs, vec2((uGlyph + vUv.x) / 11.0, vUv.y));
  gl_FragColor = vec4(uColor, g.a * uAlpha);
}
`;

const GLYPHS = "0123456789.";

/** The digits and the point, white on clear, in the system face with tabular figures. */
function glyphAtlas(): CanvasTexture {
  const cell = 64;
  const c = document.createElement("canvas");
  c.width = cell * GLYPHS.length;
  c.height = cell;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `600 ${cell * 0.78}px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", Roboto, system-ui, sans-serif`;
    for (let i = 0; i < GLYPHS.length; i++) g.fillText(GLYPHS[i] as string, cell * i + cell / 2, cell * 0.54);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

interface Ring {
  ring: Mesh;
  material: ShaderMaterial;
  glyphs: { mesh: Mesh; material: ShaderMaterial }[];
  used: boolean;
  alpha: number;
}

export interface RingShown {
  /** Where, in viewport fractions. */
  x: number;
  y: number;
  /** Its radius in CSS pixels. */
  radius: number;
  /** Seconds to impact. */
  seconds: number;
  /** The ring's lead (5 or 7 s): the arc's full turn. */
  lead: number;
}

// Drawn straight to the screen, after the picture is finished: display values, not linear.
const WHITE = new Color().setRGB(1, 1, 1);
const ORANGE = new Color().setRGB(1, 159 / 255, 10 / 255);

export class ProximityRings {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(0, 1, 1, 0, -1, 1);
  private readonly rings: Ring[] = [];
  private readonly atlas = glyphAtlas();
  private width = 1280;
  private height = 720;
  private dpr = 1;

  constructor(count = 14) {
    const quad = new PlaneGeometry(1, 1);
    for (let i = 0; i < count; i++) {
      const material = new ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: {
          uRadius: { value: 20 },
          uHalf: { value: 30 },
          uFrac: { value: 1 },
          uAlpha: { value: 0 },
          uColor: { value: new Color(1, 1, 1) },
          uPx: { value: 1 },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
      });
      const ring = new Mesh(quad, material);
      ring.visible = false;
      ring.frustumCulled = false;
      this.scene.add(ring);
      const glyphs: Ring["glyphs"] = [];
      for (let k = 0; k < 3; k++) {
        const gm = new ShaderMaterial({
          vertexShader: RING_VERTEX,
          fragmentShader: GLYPH_FRAGMENT,
          uniforms: { tGlyphs: { value: this.atlas }, uGlyph: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: new Color(1, 1, 1) } },
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
        const mesh = new Mesh(quad, gm);
        mesh.visible = false;
        mesh.frustumCulled = false;
        this.scene.add(mesh);
        glyphs.push({ mesh, material: gm });
      }
      this.rings.push({ ring, material, glyphs, used: false, alpha: 0 });
    }
  }

  resize(width: number, height: number, dpr: number): void {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = height;
    this.camera.bottom = 0;
    this.camera.updateProjectionMatrix();
  }

  /** Show exactly these rings this frame (in CSS pixels; drawn at the device's). */
  show(list: readonly RingShown[], dt: number): void {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i] as Ring;
      const s = list[i];
      if (!s) {
        r.alpha = Math.max(0, r.alpha - dt * 8);
        r.material.uniforms["uAlpha"]!.value = r.alpha;
        if (r.alpha <= 0) {
          r.ring.visible = false;
          for (const g of r.glyphs) g.mesh.visible = false;
        }
        continue;
      }
      r.alpha = Math.min(1, r.alpha + dt * 6);
      const x = s.x * this.width;
      const y = (1 - s.y) * this.height;
      const half = s.radius + 12;
      r.ring.visible = true;
      r.ring.position.set(x, y, 0);
      r.ring.scale.set(half * 2, half * 2, 1);
      const u = r.material.uniforms;
      u["uRadius"]!.value = s.radius;
      u["uHalf"]!.value = half;
      u["uFrac"]!.value = Math.max(0, Math.min(1, s.seconds / s.lead));
      u["uAlpha"]!.value = r.alpha * 0.92;
      u["uPx"]!.value = 1 / Math.max(1, this.dpr) + 0.5;
      const colour = s.seconds <= 2 ? ORANGE : WHITE;
      (u["uColor"]!.value as Color).copy(colour);
      // The seconds, beside it, one decimal: "2.4".
      const text = (Math.max(0, Math.floor(s.seconds * 10) / 10)).toFixed(1);
      const size = 15;
      let gx = x + s.radius * 0.72 + 6;
      const gy = y - s.radius * 0.72 - 8;
      r.glyphs.forEach((g, k) => {
        const ch = text[k];
        if (!ch) {
          g.mesh.visible = false;
          return;
        }
        const w = ch === "." ? size * 0.34 : size * 0.6;
        g.mesh.visible = true;
        g.mesh.position.set(gx + w / 2, gy, 0);
        g.mesh.scale.set(size, size, 1);
        g.material.uniforms["uGlyph"]!.value = GLYPHS.indexOf(ch);
        g.material.uniforms["uAlpha"]!.value = r.alpha;
        (g.material.uniforms["uColor"]!.value as Color).copy(colour);
        gx += w;
      });
    }
  }

  render(renderer: WebGLRenderer): void {
    if (!this.rings.some((r) => r.ring.visible)) return;
    const auto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = auto;
  }

  clear(): void {
    for (const r of this.rings) {
      r.alpha = 0;
      r.ring.visible = false;
      for (const g of r.glyphs) g.mesh.visible = false;
    }
  }

  dispose(): void {
    this.atlas.dispose();
    for (const r of this.rings) {
      r.material.dispose();
      for (const g of r.glyphs) g.material.dispose();
    }
  }
}
