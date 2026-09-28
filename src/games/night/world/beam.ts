/**
 * The flashlight's beam in the fog: the signature of the game. A lit volume
 * with drifting noise in it, from the lamp under the barrel to whatever it
 * falls on, drawn as one effect in the engine's post chain (PostOptions.
 * effects) because it needs the scene's depth: each pixel's view ray is
 * clipped to the beam's cone analytically, stopped where the scene is, and
 * the light the fog scatters back toward the eye is summed along what is
 * left in a handful of dithered steps. Outside the cone it costs one test.
 *
 * The same effect blurs the picture as the player falls ("the dead close in
 * out of focus"), which is why it samples its neighbours (a convolution).
 */
import { BlendFunction, Effect, EffectAttribute } from "postprocessing";
import { Color, Matrix4, Uniform, Vector3, Vector4, type PerspectiveCamera } from "three";

export interface BeamVolume {
  uCamPos: Uniform<Vector3>;
  uCamWorld: Uniform<Matrix4>;
  uProjInv: Uniform<Matrix4>;
  uNearFar: Uniform<Vector4>;
  uBeamPos: Uniform<Vector3>;
  uBeamDir: Uniform<Vector3>;
  /** cos of the cone, cos of its hot centre, the falloff's exponent, its reach. */
  uBeamShape: Uniform<Vector4>;
  /** The volume's colour × how strongly the fog scatters it. */
  uBeamGlow: Uniform<Color>;
  uFogDensity: Uniform<number>;
  uFogGround: Uniform<number>;
  uFogFalloff: Uniform<number>;
  uFogTime: Uniform<number>;
  /** 0 sharp … 1 the world gone soft (the fall). */
  uBlur: Uniform<number>;
}

export function beamVolume(): BeamVolume {
  return {
    uCamPos: new Uniform(new Vector3()),
    uCamWorld: new Uniform(new Matrix4()),
    uProjInv: new Uniform(new Matrix4()),
    uNearFar: new Uniform(new Vector4(0.1, 400, 0, 0)),
    uBeamPos: new Uniform(new Vector3()),
    uBeamDir: new Uniform(new Vector3(0, 0, -1)),
    uBeamShape: new Uniform(new Vector4(Math.cos(0.3), Math.cos(0.13), 1.3, 70)),
    uBeamGlow: new Uniform(new Color(0, 0, 0)),
    uFogDensity: new Uniform(0.016),
    uFogGround: new Uniform(1.6),
    uFogFalloff: new Uniform(0.35),
    uFogTime: new Uniform(0),
    uBlur: new Uniform(0),
  };
}

/** Keep the volume's camera uniforms with the camera the scene is drawn through. */
export function syncBeamCamera(v: BeamVolume, camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  v.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
  v.uCamWorld.value.copy(camera.matrixWorld);
  v.uProjInv.value.copy(camera.projectionMatrixInverse);
  v.uNearFar.value.set(camera.near, camera.far, 0, 0);
}

const STEPS = 10;

const FRAGMENT = /* glsl */ `
uniform vec3 uCamPos;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform vec4 uNearFar;
uniform vec3 uBeamPos;
uniform vec3 uBeamDir;
uniform vec4 uBeamShape;
uniform vec3 uBeamGlow;
uniform float uFogDensity;
uniform float uFogGround;
uniform float uFogFalloff;
uniform float uFogTime;
uniform float uBlur;

float beamHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float beamNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(beamHash(i), beamHash(i + vec3(1, 0, 0)), f.x), mix(beamHash(i + vec3(0, 1, 0)), beamHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(beamHash(i + vec3(0, 0, 1)), beamHash(i + vec3(1, 0, 1)), f.x), mix(beamHash(i + vec3(0, 1, 1)), beamHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

/** Inside the forward cone of the beam? */
bool inBeam(vec3 p) {
  vec3 l = p - uBeamPos;
  float along = dot(l, uBeamDir);
  return along > 0.0 && along * along > uBeamShape.x * uBeamShape.x * dot(l, l);
}

/** The stretch of the ray o + d t, t in (0, tMax), inside the cone: the first run of it. */
vec2 coneSpan(vec3 o, vec3 d, float tMax) {
  float c2 = uBeamShape.x * uBeamShape.x;
  vec3 co = o - uBeamPos;
  float dv = dot(d, uBeamDir);
  float cv = dot(co, uBeamDir);
  float a = dv * dv - c2;
  float b = 2.0 * (dv * cv - dot(d, co) * c2);
  float c = cv * cv - dot(co, co) * c2;
  // The ray's crossings with the double cone split it into at most three
  // runs; each run is wholly in or out of the forward cone.
  float r0 = tMax;
  float r1 = tMax;
  if (abs(a) < 1e-6) {
    if (abs(b) > 1e-6) r0 = clamp(-c / b, 0.0, tMax);
  } else {
    float disc = b * b - 4.0 * a * c;
    if (disc >= 0.0) {
      float s = sqrt(disc);
      float x0 = (-b - s) / (2.0 * a);
      float x1 = (-b + s) / (2.0 * a);
      r0 = clamp(min(x0, x1), 0.0, tMax);
      r1 = clamp(max(x0, x1), 0.0, tMax);
    }
  }
  float t0 = 1e9;
  float t1 = -1e9;
  if (r0 > 0.0 && inBeam(o + d * (0.5 * r0))) { t0 = 0.0; t1 = r0; }
  if (r1 > r0 && inBeam(o + d * (0.5 * (r0 + r1)))) { t0 = min(t0, r0); t1 = r1; }
  if (tMax > r1 && inBeam(o + d * (0.5 * (r1 + tMax)))) { t0 = min(t0, r1); t1 = tMax; }
  return vec2(t0, t1);
}

/** The fog's density at p, relative to the eye's height: thicker low, in drifting wisps. */
float beamFog(vec3 p) {
  float k = uFogFalloff;
  float ground = (1.0 + uFogGround * exp(-k * max(p.y, 0.0))) / (1.0 + uFogGround * exp(-k * 1.7));
  vec3 q = p * vec3(0.16, 0.3, 0.16) + vec3(uFogTime * 0.16, uFogTime * 0.02, uFogTime * 0.09);
  float n = beamNoise(q) * 0.62 + beamNoise(q * 2.4 + 7.1) * 0.38;
  // Wisps: mostly thin air, with banks of fog drifting through the light.
  float wisp = smoothstep(0.32, 0.85, n);
  return ground * (0.12 + 2.2 * wisp * wisp);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 color = inputColor.rgb;
  if (uBlur > 0.001) {
    // Out of focus: a disc of eight taps round the pixel.
    vec2 r = texelSize * (2.0 + 22.0 * uBlur);
    vec3 sum = color;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398 + 0.39;
      sum += texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * r).rgb;
    }
    color = mix(color, sum / 9.0, clamp(uBlur * 1.6, 0.0, 1.0));
  }
  if (uBeamGlow.r + uBeamGlow.g + uBeamGlow.b > 0.0) {
    vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
    vec3 dirV = normalize(v.xyz / v.w);
    vec3 d = normalize((uCamWorld * vec4(dirV, 0.0)).xyz);
    float near = uNearFar.x;
    float far = uNearFar.y;
    float viewZ = (near * far) / ((far - near) * depth - far);
    float tScene = depth >= 0.99999 ? far : viewZ / dirV.z;
    float tMax = min(tScene, uBeamShape.w);
    vec2 span = coneSpan(uCamPos, d, tMax);
    if (span.y > span.x) {
      float len = span.y - span.x;
      float step = len / ${STEPS}.0;
      // Interleaved gradient noise: each pixel starts its steps a little
      // differently, so ten steps read as a smooth glow, not ten slices.
      float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      float sum = 0.0;
      for (int i = 0; i < ${STEPS}; i++) {
        float t = span.x + (float(i) + jitter) * step;
        vec3 p = uCamPos + d * t;
        vec3 l = p - uBeamPos;
        float dist = length(l);
        float spot = smoothstep(uBeamShape.x, uBeamShape.y, dot(l, uBeamDir) / max(dist, 1e-4));
        float fall = 1.0 / pow(max(dist, 1.2), uBeamShape.z);
        float ft = uFogDensity * t;
        // Right round the lamp, under the canopy, the air is clear: the beam
        // shows as a shaft out in the fog, not a glare on the lens.
        float clear = smoothstep(2.5, 12.0, dist);
        sum += spot * fall * clear * beamFog(p) * exp(-2.0 * ft * ft);
      }
      color += uBeamGlow * (sum * step * uFogDensity);
    }
  }
  outputColor = vec4(color, inputColor.a);
}
`;

/**
 * One instance of the effect; the post chain asks for one per chain (the
 * full one and the low tier's), and both share the same uniforms.
 */
export class BeamEffect extends Effect {
  constructor(v: BeamVolume) {
    super("NightBeam", FRAGMENT, {
      attributes: EffectAttribute.DEPTH | EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, Uniform>(Object.entries(v) as [string, Uniform][]),
    });
  }
}
