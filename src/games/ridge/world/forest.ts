/**
 * The forest: thousands of firs and larches on the far side, instanced. The
 * art places them (`forest.<species>`, as instanced meshes); here they are
 * re-filed into square chunks of the valley, so a scope looking at one
 * slope draws only the trees on it, and given one shader that lights them
 * as the terrain is lit - the low sun where the light map lets it reach, the
 * sky everywhere, darker down among the boughs - sways them a little in
 * the wind, and gives each tree its own shade of green.
 */
import { Box3, Color, InstancedMesh, Matrix4, ShaderMaterial, Sphere, Vector2, Vector3, type BufferGeometry, type Group } from "three";
import { ATMOSPHERE_GLSL, type AtmosphereUniforms } from "./atmosphere";

const VERT = /* glsl */ `
uniform vec2 uSway;
uniform float uTime;
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vTrunk;
varying float vSeed;
void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vec4 w = modelMatrix * local;
  vSeed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  // The crown sways with the wind, the trunk does not.
  float k = color.r * color.r;
  float gust = sin(uTime * (0.7 + vSeed * 0.5) + vSeed * 20.0) * 0.5 + 0.5;
  w.xz += uSway * k * (0.6 + gust * 0.8);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vHeight = color.r;
  vTrunk = color.g;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uFoliage;
uniform vec3 uFoliage2;
uniform vec3 uBark;
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vHeight;
varying float vTrunk;
varying float vSeed;
${ATMOSPHERE_GLSL}
void main() {
  vec3 n = normalize(vNormalW);
  // Each tree its own green; darker deep in the lower boughs.
  vec3 leaf = mix(uFoliage, uFoliage2, vSeed);
  leaf *= mix(0.55, 1.0, smoothstep(0.1, 0.9, vHeight));
  // Needles: a fine speckle so a crown is not a smooth cone through the scope.
  float speck = atmoNoise(vWorld.xz * 3.1 + vWorld.y * 2.3) * 0.35 + 0.8;
  vec3 albedo = mix(leaf * speck, uBark, vTrunk);
  vec2 light = atmoLight(vWorld);
  float sun = smoothstep(light.r - 0.012, light.r + 0.012, uSunElev);
  // Light through a crown is soft: wrapped round the cone.
  float lambert = clamp(dot(n, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  vec3 col = albedo * (uSunColor * lambert * sun * 0.9 + atmoAmbient(n, light.g * mix(0.7, 1.0, vHeight)));
  col = atmoAir(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function forestMaterial(atmosphere: AtmosphereUniforms, species: string): ShaderMaterial {
  const larch = species.includes("larch");
  return new ShaderMaterial({
    name: `forest.${species}`,
    uniforms: {
      ...atmosphere,
      uSway: { value: new Vector2() },
      uFoliage: { value: new Color(larch ? "#4d6b33" : "#1c3524") },
      uFoliage2: { value: new Color(larch ? "#6b8440" : "#2c4a2e") },
      uBark: { value: new Color("#3a2d22") },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
  });
}

/** How wide a chunk of forest is, metres. */
const CHUNK = 300;

/**
 * Re-file each species' instances into chunks, each its own InstancedMesh
 * with a tight bounding sphere, under `parent`. The source meshes are
 * removed. Returns the chunks and their materials (for the sway).
 */
export function chunkForest(sources: InstancedMesh[], parent: Group, atmosphere: AtmosphereUniforms): { meshes: InstancedMesh[]; materials: ShaderMaterial[]; count: number } {
  const meshes: InstancedMesh[] = [];
  const materials: ShaderMaterial[] = [];
  const m = new Matrix4();
  const p = new Vector3();
  let count = 0;
  for (const src of sources) {
    const species = (src.userData["name"] as string | undefined) ?? src.name;
    const material = forestMaterial(atmosphere, species);
    materials.push(material);
    src.updateMatrixWorld(true);
    const byChunk = new Map<string, Matrix4[]>();
    for (let i = 0; i < src.count; i++) {
      src.getMatrixAt(i, m);
      m.premultiply(src.matrixWorld);
      p.setFromMatrixPosition(m);
      const key = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
      const list = byChunk.get(key) ?? [];
      list.push(m.clone());
      byChunk.set(key, list);
    }
    const geometry: BufferGeometry = src.geometry;
    geometry.computeBoundingBox();
    const treeBox = geometry.boundingBox ?? new Box3(new Vector3(-4, 0, -4), new Vector3(4, 20, 4));
    for (const list of byChunk.values()) {
      const chunk = new InstancedMesh(geometry, material, list.length);
      const box = new Box3();
      const tb = new Box3();
      list.forEach((mm, i) => {
        chunk.setMatrixAt(i, mm);
        tb.copy(treeBox).applyMatrix4(mm);
        box.union(tb);
      });
      chunk.instanceMatrix.needsUpdate = true;
      chunk.boundingSphere = box.getBoundingSphere(new Sphere());
      chunk.boundingBox = box;
      chunk.name = `forest.chunk`;
      chunk.userData["surface"] = "wood";
      chunk.userData["forest"] = true;
      parent.add(chunk);
      meshes.push(chunk);
      count += list.length;
    }
    src.removeFromParent();
  }
  return { meshes, materials, count };
}
