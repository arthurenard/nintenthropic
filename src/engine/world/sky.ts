/**
 * An equirectangular sky, rendered in Blender (Nishita, clouds, the distant
 * hills), as a world's background and - through PMREM - as the environment
 * light for everything that moves in front of the baked scenery, so a
 * character is lit by the same sky it stands under.
 */
import { Color, EquirectangularReflectionMapping, PMREMGenerator, SRGBColorSpace, type Scene, type Texture, type WebGLRenderer } from "three";

export class SkyLight {
  private readonly target: ReturnType<PMREMGenerator["fromEquirectangular"]>;

  /**
   * Hangs `sky` behind `scene` and lights the scene's physical materials
   * with it at `intensity` (1 is the sky as it is).
   */
  constructor(renderer: WebGLRenderer, scene: Scene, sky: Texture, intensity = 1) {
    scene.background = sky;
    const pmrem = new PMREMGenerator(renderer);
    this.target = pmrem.fromEquirectangular(sky);
    pmrem.dispose();
    scene.environment = this.target.texture;
    scene.environmentIntensity = intensity;
  }

  dispose(): void {
    this.target.dispose();
  }
}

/** A sky image loaded from a file, made ready to be one (the mapping and colour space three needs). */
export function asSky(texture: Texture): Texture {
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/**
 * The colour of the horizon straight ahead (down −Z), sampled from an
 * equirectangular sky image: what the haze between the eye and the far end
 * of a world is tinted, so the fog meets the sky without a seam. Null if the
 * image cannot be read (it has no size yet, or no 2D canvas).
 */
export function horizonColour(texture: Texture): Color | null {
  const img = texture.image as CanvasImageSource & { width?: number; height?: number };
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!w || !h) return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 32;
  const g = c.getContext("2d");
  if (!g) return null;
  g.drawImage(img, 0, 0, 64, 32);
  // Three's equirect mapping puts −Z at u = 0.25; the horizon at v = 0.5.
  const d = g.getImageData(15, 15, 3, 2).data;
  let r = 0;
  let gg = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i] as number;
    gg += d[i + 1] as number;
    b += d[i + 2] as number;
  }
  const n = d.length / 4;
  return new Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, SRGBColorSpace);
}
