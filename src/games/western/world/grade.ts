import type { GradeOptions } from "../../../engine/world/post";

/**
 * Dust Creek's colour grade, in the engine's post chain
 * (engine/world/post.ts): warm highlights and teal-leaning shadows at golden
 * hour; at noon (`noon` 1) white, hard light with a touch more contrast.
 */
export const GOLDEN_HOUR: GradeOptions = {
  glsl: /* glsl */ `
vec3 grade(vec3 c, float l) {
  // Golden-hour grade: warm highlights, teal-leaning shadows, gently.
  vec3 warm = vec3(1.04, 1.0, 0.93);
  vec3 cool = vec3(0.94, 1.0, 1.05);
  vec3 tint = mix(cool, warm, smoothstep(0.05, 0.6, l));
  c *= mix(tint, vec3(1.0), noon);
  // At noon the light is white and hard: a touch more contrast, less colour.
  c = mix(c, (c - 0.5 * l) * 1.08 + 0.5 * l, noon * 0.5);
  return c;
}
`,
  uniforms: { noon: 0 },
};
