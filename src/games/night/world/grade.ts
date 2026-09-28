import type { GradeOptions } from "../../../engine/world/post";

/**
 * The night's colour grade, in the engine's post chain
 * (engine/world/post.ts): cold blue shadows under the moon, the warm lights
 * (the sodium lamp, the neon, the flashlight) left warm, a little lift in
 * the blacks so the fog's shapes read on a laptop in a lit room, and a fine
 * moving grain - a night picture's grain, and what keeps the fog's long
 * dark gradients from banding. `fade` darkens to black at the very end.
 */
export const NIGHT: GradeOptions = {
  glsl: /* glsl */ `
float nightGrain(vec2 p, float t) {
  return fract(sin(dot(p + fract(t * 0.61) * 71.3, vec2(12.9898, 78.233))) * 43758.5453);
}
vec3 grade(vec3 c, float l) {
  // Moonlight is blue: the shadows cool a touch more, the lights keep their
  // warmth. (The road's bake is graded already: only a touch.)
  vec3 cool = vec3(0.94, 0.98, 1.05);
  vec3 keep = vec3(1.0, 0.99, 0.97);
  c *= mix(cool, keep, smoothstep(0.08, 0.55, l));
  // A lifted, blue-black floor: the night is dark, never a black hole.
  c = c * 0.985 + vec3(0.0016, 0.0022, 0.0036);
  // A fine grain (in linear light, so a hair's breadth in the dark), which
  // keeps the fog's long gradients from banding.
  float g = nightGrain(gl_FragCoord.xy, time) - 0.5;
  c += g * grain * (0.0022 + 0.035 * c);
  return max(c, 0.0) * (1.0 - fade);
}
`,
  uniforms: { grain: 1, fade: 0 },
};
