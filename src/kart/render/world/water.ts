/**
 * The harbour's water: one huge plane with a small shader. Gently moving
 * ripples tilt the surface, which reflects the night sky more at a glancing
 * angle and glints where the moon's reflection falls; the lamps' light lies on
 * it as warm streaks. Fog takes it into the horizon.
 */
import { Mesh, PlaneGeometry } from "three";
import { oceanMaterial } from "./ocean";
import type { BakeUniforms } from "./shading";
import { WATER_LEVEL } from "./terrain";
import type { ThemeStyle } from "./themes";

export interface Water {
  mesh: Mesh;
  update(time: number): void;
  dispose(): void;
}

export function createWater(style: ThemeStyle, centre: { x: number; z: number }, bake: BakeUniforms, anisotropy = 4): Water {
  void style;
  const geometry = new PlaneGeometry(6000, 6000, 1, 1);
  geometry.rotateX(-Math.PI / 2);
  // The ripples tile every 7 m over the whole plane.
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 6000) / 7, (uv.getY(i) * 6000) / 7);
  const ocean = oceanMaterial({ deep: "#04162e", shallow: "#0f3d5c", alpha: 1, shore: 3, level: WATER_LEVEL, foam: 0.5, roughness: 0.05, ripple: 7, anisotropy }, bake);
  const mesh = new Mesh(geometry, ocean.material);
  mesh.position.set(centre.x, WATER_LEVEL, centre.z);
  mesh.frustumCulled = false;
  mesh.userData.noShadow = true;
  return {
    mesh,
    update(time) {
      ocean.update(time);
    },
    dispose() {
      geometry.dispose();
      ocean.dispose();
    },
  };
}
