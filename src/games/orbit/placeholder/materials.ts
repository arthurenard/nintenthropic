/**
 * The placeholders' materials: the station's white paint and beta cloth,
 * gold and silver foil, bare aluminium, solar cells - physically based and
 * lit at run time, as the art's station is - with small canvas textures
 * painted at load (no image files) for what a flat colour cannot say.
 */
import { CanvasTexture, Color, MeshStandardMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import { mulberry32 } from "../../../engine/rules/rng";

function canvas(size: number, paint: (g: CanvasRenderingContext2D, size: number) => void, colour = true): Texture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (g) paint(g, size);
  const t = new CanvasTexture(c);
  if (colour) t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/** Solar cells: dark blue squares, their silver bus bars, the gaps between. */
export function solarCells(): Texture {
  return canvas(256, (g, s) => {
    g.fillStyle = "#b8bcc2";
    g.fillRect(0, 0, s, s);
    const n = 4;
    const cell = s / n;
    const r = mulberry32(5);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const shade = 20 + Math.floor(r() * 10);
        g.fillStyle = `rgb(${shade}, ${shade + 14}, ${shade + 52})`;
        g.fillRect(i * cell + 3, j * cell + 3, cell - 6, cell - 6);
        g.fillStyle = "rgba(190, 200, 215, 0.5)";
        for (let k = 1; k < 4; k++) g.fillRect(i * cell + 3, j * cell + (k * cell) / 4, cell - 6, 1);
      }
    }
  });
}

/** Crinkled foil: a height noise for the roughness to catch the sun in patches. */
export function crinkle(seed = 3): Texture {
  return canvas(
    256,
    (g, s) => {
      const r = mulberry32(seed);
      g.fillStyle = "#808080";
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 900; i++) {
        const x = r() * s;
        const y = r() * s;
        const w = 4 + r() * 30;
        const h = 2 + r() * 10;
        const v = Math.floor(80 + r() * 140);
        g.fillStyle = `rgba(${v}, ${v}, ${v}, 0.35)`;
        g.save();
        g.translate(x, y);
        g.rotate(r() * Math.PI);
        g.fillRect(-w / 2, -h / 2, w, h);
        g.restore();
      }
    },
    false,
  );
}

/** Beta cloth's faint weave and quilting. */
export function quilt(): Texture {
  return canvas(128, (g, s) => {
    g.fillStyle = "#efece4";
    g.fillRect(0, 0, s, s);
    g.strokeStyle = "rgba(170, 165, 150, 0.35)";
    g.lineWidth = 1;
    for (let i = 0; i <= s; i += 32) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, s);
      g.moveTo(0, i);
      g.lineTo(s, i);
      g.stroke();
    }
    g.fillStyle = "rgba(160, 150, 140, 0.35)";
    for (let i = 16; i < s; i += 32) for (let j = 16; j < s; j += 32) g.fillRect(i - 1, j - 1, 2, 2);
  });
}

export interface PlaceholderMaterials {
  white: MeshStandardMaterial;
  beta: MeshStandardMaterial;
  gold: MeshStandardMaterial;
  silver: MeshStandardMaterial;
  kapton: MeshStandardMaterial;
  alu: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  cells: MeshStandardMaterial;
  cellBack: MeshStandardMaterial;
  radiator: MeshStandardMaterial;
  yellow: MeshStandardMaterial;
  glass: MeshStandardMaterial;
}

/** A set for one placeholder file (each file's own, as each glTF brings its own). */
export function materials(): PlaceholderMaterials {
  const foil = crinkle();
  const cells = solarCells();
  cells.repeat.set(1, 8);
  const weave = quilt();
  return {
    white: new MeshStandardMaterial({ color: "#e4e2dc", roughness: 0.55, metalness: 0, name: "white_paint" }),
    beta: new MeshStandardMaterial({ color: "#ffffff", map: weave, roughness: 0.85, metalness: 0, name: "beta_cloth" }),
    gold: new MeshStandardMaterial({ color: new Color("#d6a64a"), roughness: 0.3, roughnessMap: foil, metalness: 1, name: "mli_gold" }),
    silver: new MeshStandardMaterial({ color: "#c8ccd2", roughness: 0.28, roughnessMap: foil, metalness: 1, name: "mli_silver" }),
    kapton: new MeshStandardMaterial({ color: "#b3702a", roughness: 0.4, roughnessMap: foil, metalness: 0.6, name: "kapton" }),
    alu: new MeshStandardMaterial({ color: "#b9bcbf", roughness: 0.35, metalness: 1, name: "alu_bare" }),
    dark: new MeshStandardMaterial({ color: "#2a2d31", roughness: 0.6, metalness: 0.4, name: "alu_dark" }),
    cells: new MeshStandardMaterial({ color: "#ffffff", map: cells, roughness: 0.22, metalness: 0.35, name: "solar_cells" }),
    cellBack: new MeshStandardMaterial({ color: "#9a6a2c", roughness: 0.5, metalness: 0.5, name: "cell_back" }),
    radiator: new MeshStandardMaterial({ color: "#f1f0ec", roughness: 0.35, metalness: 0.1, name: "radiator" }),
    yellow: new MeshStandardMaterial({ color: "#d9a51e", roughness: 0.5, metalness: 0.2, name: "handrail_yellow" }),
    glass: new MeshStandardMaterial({ color: "#0c1016", roughness: 0.08, metalness: 0.2, name: "window" }),
  };
}
