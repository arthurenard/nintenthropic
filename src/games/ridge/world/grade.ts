import type { GradeOptions } from "../../../engine/world/post";

/**
 * The Valle Serra's colour grade, in the engine's post chain
 * (engine/world/post.ts): a filmic curve for a scene lit from dark blue
 * shade to sunlit snow, the shade kept cool and the sunlit gold warm, and a
 * gentle lift so the valley floor's shadow still shows its detail. `scoped`
 * (0..1) adds a touch of the glass: a little more contrast.
 */
export const DAWN: GradeOptions = {
  glsl: /* glsl */ `
vec3 grade(vec3 c, float l) {
  // The art's white balance for the shade (the sky's light reads teal without it).
  c *= vec3(wbR, wbG, wbB);
  // A soft filmic toe and shoulder (the shoulder already rolled the highlights).
  c = c / (1.0 + 0.18 * c);
  c = pow(max(c, 0.0), vec3(0.96));
  // Cool in the shade, warm in the sun.
  vec3 cool = vec3(0.93, 0.99, 1.08);
  vec3 warm = vec3(1.06, 1.0, 0.9);
  c *= mix(cool, warm, smoothstep(0.08, 0.55, l));
  // A lift in the deepest shadow, so the valley floor keeps its detail.
  c += vec3(0.010, 0.012, 0.018) * (1.0 - smoothstep(0.0, 0.2, l));
  // Through the glass: a little more contrast.
  c = mix(c, (c - 0.18) * 1.06 + 0.18, scoped * 0.6);
  return max(c, 0.0);
}
`,
  uniforms: { scoped: 0, wbR: 1, wbG: 1, wbB: 1 },
};
