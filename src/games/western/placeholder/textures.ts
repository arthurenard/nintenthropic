import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { mulberry32 } from "../rules/rng";

/**
 * Detail textures for the placeholder town, painted into canvases at load:
 * weathered planks, packed dirt, stone blocks, shingles. They are greyscale
 * multipliers over the vertex colours that carry the "baked" light, the same
 * split the real town makes between albedo and Cycles bake.
 */
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return [c, ctx];
}

function finish(c: HTMLCanvasElement, repeat = true): Texture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) {
    t.wrapS = RepeatWrapping;
    t.wrapT = RepeatWrapping;
  }
  t.anisotropy = 8;
  return t;
}

function grey(v: number, a = 1): string {
  const g = Math.max(0, Math.min(255, Math.round(v * 255)));
  return `rgba(${g},${g},${g},${a})`;
}

/** Horizontal weatherboards: eight to a tile, each its own tone, with grain and nail heads. */
export function planksTexture(seed = 1): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  const boards = 8;
  const bh = 256 / boards;
  for (let i = 0; i < boards; i++) {
    const tone = 0.8 + r() * 0.2;
    g.fillStyle = grey(tone);
    g.fillRect(0, i * bh, 256, bh);
    for (let k = 0; k < 26; k++) {
      g.fillStyle = grey(tone - 0.08 - r() * 0.08, 0.35);
      const y = i * bh + 2 + r() * (bh - 4);
      g.fillRect(r() * 256, y, 30 + r() * 120, 1);
    }
    // Butt joints: boards are not a tile wide.
    const joint = r() * 256;
    g.fillStyle = grey(0.45, 0.8);
    g.fillRect(joint, i * bh, 2, bh);
    g.fillStyle = grey(0.3, 0.9);
    g.fillRect(joint + 5, i * bh + bh * 0.5, 2, 2);
    g.fillStyle = grey(0.42, 1);
    g.fillRect(0, i * bh + bh - 2, 256, 2);
    g.fillStyle = grey(1, 0.25);
    g.fillRect(0, i * bh, 256, 1);
  }
  return finish(c);
}

/** Vertical boards (barn, doors). */
export function boardsTexture(seed = 2): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  const boards = 6;
  const bw = 256 / boards;
  for (let i = 0; i < boards; i++) {
    const tone = 0.78 + r() * 0.22;
    g.fillStyle = grey(tone);
    g.fillRect(i * bw, 0, bw, 256);
    for (let k = 0; k < 20; k++) {
      g.fillStyle = grey(tone - 0.1 - r() * 0.08, 0.35);
      g.fillRect(i * bw + 2 + r() * (bw - 4), r() * 256, 1, 30 + r() * 100);
    }
    g.fillStyle = grey(0.38, 1);
    g.fillRect(i * bw + bw - 2, 0, 2, 256);
  }
  return finish(c);
}

/** Packed dirt: soft blotches, grit and a few pebbles. */
export function dirtTexture(seed = 3): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(512, 512);
  g.fillStyle = grey(0.93);
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 10 + r() * 50;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const v = 0.82 + r() * 0.2;
    grad.addColorStop(0, grey(v, 0.35));
    grad.addColorStop(1, grey(v, 0));
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 5000; i++) {
    g.fillStyle = grey(0.65 + r() * 0.45, 0.5);
    g.fillRect(r() * 512, r() * 512, 1 + r() * 1.5, 1 + r() * 1.5);
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * 512;
    const y = r() * 512;
    g.fillStyle = grey(0.55, 0.6);
    g.beginPath();
    g.ellipse(x + 1, y + 1.5, 2 + r() * 3, 1.5 + r() * 2, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = grey(1.0, 0.8);
    g.beginPath();
    g.ellipse(x, y, 2 + r() * 2.5, 1.2 + r() * 1.5, 0, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c);
}

/** Dressed stone for the bank. */
export function stoneTexture(seed = 4): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  g.fillStyle = grey(0.6);
  g.fillRect(0, 0, 256, 256);
  const rows = 8;
  const rh = 256 / rows;
  for (let j = 0; j < rows; j++) {
    const off = (j % 2) * 32;
    for (let x = -64 + off; x < 256; x += 64) {
      g.fillStyle = grey(0.82 + r() * 0.18);
      g.fillRect(x + 2, j * rh + 2, 60, rh - 4);
      for (let k = 0; k < 12; k++) {
        g.fillStyle = grey(0.7 + r() * 0.3, 0.4);
        g.fillRect(x + 2 + r() * 58, j * rh + 2 + r() * (rh - 6), 2, 2);
      }
    }
  }
  return finish(c);
}

/** Wooden shingles. */
export function shinglesTexture(seed = 5): Texture {
  const r = mulberry32(seed);
  const [c, g] = canvas(256, 256);
  g.fillStyle = grey(0.5);
  g.fillRect(0, 0, 256, 256);
  const rows = 10;
  const rh = 256 / rows;
  for (let j = 0; j < rows; j++) {
    let x = -r() * 20;
    while (x < 256) {
      const w = 14 + r() * 16;
      g.fillStyle = grey(0.75 + r() * 0.25);
      g.fillRect(x + 1, j * rh, w - 2, rh - 3);
      g.fillStyle = grey(0.45, 0.8);
      g.fillRect(x + 1, j * rh + rh - 4, w - 2, 2);
      x += w;
    }
  }
  return finish(c);
}

/** A plain white texel, for surfaces with no detail. */
export function plainTexture(): Texture {
  const [c, g] = canvas(4, 4);
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 4, 4);
  return finish(c);
}

/** A painted sign board: the letters sun-faded, the board's edge darker. */
export function signTexture(text: string, board: string, ink: string, width = 1024, height = 192): Texture {
  const [c, g] = canvas(width, height);
  g.fillStyle = board;
  g.fillRect(0, 0, width, height);
  const r = mulberry32(text.length * 97 + 7);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
    g.fillRect(0, r() * height, width, 1 + r() * 2);
  }
  g.strokeStyle = "rgba(0,0,0,0.45)";
  g.lineWidth = 10;
  g.strokeRect(5, 5, width - 10, height - 10);
  g.fillStyle = ink;
  const size = Math.floor(height * 0.56);
  g.font = `700 ${size}px "Rockwell", "Georgia", "Times New Roman", serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  const letters = text.split("").join(String.fromCharCode(8202));
  g.fillText(letters, width / 2, height / 2 + size * 0.04, width - 60);
  // Weathering: flecks of paint gone.
  for (let i = 0; i < 400; i++) {
    g.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
    g.fillRect(r() * width, r() * height, 1 + r() * 3, 1 + r() * 2);
  }
  return finish(c, false);
}

/**
 * The wanted poster of secret 7: a finger-gun hand, "WANTED — THE HAND.
 * $5,000", on yellowed paper.
 */
export function wantedPosterTexture(): Texture {
  const [c, g] = canvas(256, 360);
  const grad = g.createLinearGradient(0, 0, 256, 360);
  grad.addColorStop(0, "#efe0b8");
  grad.addColorStop(1, "#d9c28e");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 360);
  g.fillStyle = "#2a1f14";
  g.textAlign = "center";
  g.font = '700 52px "Rockwell", "Georgia", serif';
  g.fillText("WANTED", 128, 62);
  g.font = '600 20px "Georgia", serif';
  g.fillText("— THE HAND —", 128, 92);
  // The hand: a fist with the index finger out and the thumb up.
  g.save();
  g.translate(128, 190);
  g.fillStyle = "#3a2c1d";
  g.strokeStyle = "#2a1f14";
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(-48, -22, 70, 58, 16); // fist
  g.fill();
  g.beginPath();
  g.roundRect(8, -20, 78, 20, 10); // index finger
  g.fill();
  g.beginPath();
  g.roundRect(-30, -58, 20, 44, 10); // thumb
  g.fill();
  g.fillStyle = "#efe0b8";
  for (let i = 0; i < 3; i++) g.fillRect(-40 + i * 16, 8, 2, 20); // knuckle lines
  g.restore();
  g.fillStyle = "#2a1f14";
  g.font = '700 48px "Rockwell", "Georgia", serif';
  g.fillText("$5,000", 128, 300);
  g.font = '400 16px "Georgia", serif';
  g.fillText("DEAD OR ALIVE", 128, 330);
  const r = mulberry32(11);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(90,60,20,${r() * 0.12})`;
    g.fillRect(r() * 256, r() * 360, 2 + r() * 6, 1 + r() * 4);
  }
  return finish(c, false);
}
