/**
 * The camera and director helpers the clips share. rigLib() runs IN THE PAGE (shoot.mjs sends its source), after
 * the dev page is ready, and leaves window.__rig behind. Directors (plan.mjs) use it:
 *
 *   const { pt, kart, cam, ... } = window.__rig;
 *
 * Coordinates: a kart at heading h faces (sin h, 0, cos h); its right-hand side is (-cos h, 0, sin h).
 * `at` is a lap fraction, `d` metres along the road from there, `off` metres right of the centre line, `up` above it.
 */
export function rigLib() {
  const grip = window.__grip;
  const demo = grip.demo;
  const g = demo.geometry;
  const L = g.length;
  const TAU = Math.PI * 2;
  const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (x) => {
    const c = clamp(x);
    return c * c * (3 - 2 * c);
  };
  const smoother = (x) => {
    const c = clamp(x);
    return c * c * c * (c * (c * 6 - 15) + 10);
  };
  const wrap = (s) => ((s % L) + L) % L;
  /** A point on or above the road. */
  const pt = (at, d = 0, off = 0, up = 0) => {
    const p = g.point(wrap(at * L + d), off);
    return { x: p.x, y: p.y + up, z: p.z };
  };
  /** The same from a distance along the lap in metres. */
  const ps = (s, off = 0, up = 0) => {
    const p = g.point(wrap(s), off);
    return { x: p.x, y: p.y + up, z: p.z };
  };
  const heading = (s) => g.heading(wrap(s));
  const fwd = (k) => ({ x: Math.sin(k.heading), z: Math.cos(k.heading) });
  const right = (k) => ({ x: -Math.cos(k.heading), z: Math.sin(k.heading) });
  const kartById = (view, id) => view.karts.find((k) => k.id === id);
  /** The kart's body: its road height plus its hop. */
  const body = (k, up = 0.6) => ({ x: k.x, y: k.y + (k.hop || 0) + up, z: k.z });
  /** Beside a kart: `back` metres behind it (negative: ahead), `side` right of it (negative: left), `up` above its body. */
  const around = (k, back, side, up) => {
    const f = fwd(k);
    const r = right(k);
    return { x: k.x - f.x * back + r.x * side, y: k.y + (k.hop || 0) + up, z: k.z - f.z * back + r.z * side };
  };
  const dist = (a, b) => Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z);
  const mix = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
  /** Drives the first view's camera. */
  const cam = (eye, look, fov = 60, roll = 0) => grip.renderer.setDebugCamera({ x: eye.x, y: eye.y, z: eye.z, lookX: look.x, lookY: look.y, lookZ: look.z, fov, roll });
  /** Which kart the renderer follows for its sun shadow and light (it is the first view's kart). */
  let following = -1;
  const follow = (id) => {
    if (id !== following) {
      following = id;
      grip.renderer.setViews([id]);
    }
  };
  /** Exponential smoothing that does not depend on the frame rate. */
  const damp = (cur, target, rate, dt = 1 / 60) => lerp(cur, target, 1 - Math.exp(-rate * dt));
  const dampV = (cur, target, rate, dt = 1 / 60) => ({ x: damp(cur.x, target.x, rate, dt), y: damp(cur.y, target.y, rate, dt), z: damp(cur.z, target.z, rate, dt) });
  /** Catmull-Rom through the points (numbers or {x,y,z}), t 0..1 along the whole. */
  const spline = (pts, t) => {
    const n = pts.length - 1;
    const u = clamp(t) * n;
    const i = Math.min(n - 1, Math.floor(u));
    const f = u - i;
    const p = (j) => pts[Math.max(0, Math.min(n, j))];
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (-a + 3 * b - 3 * c + d) * f * f * f);
    const [p0, p1, p2, p3] = [p(i - 1), p(i), p(i + 1), p(i + 2)];
    if (typeof p1 === "number") return cr(p0, p1, p2, p3);
    return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), z: cr(p0.z, p1.z, p2.z, p3.z) };
  };
  const angle = (a, b, t) => {
    let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
    return a + d * t;
  };
  /**
   * A chase camera of its own for kart `id` (the game's has a fixed distance and is blocked by a kart that overtakes close by).
   * o: back, up (metres), side (right of the kart; with `swing` it moves to the outside of a drift), look (metres ahead of the
   * kart), lookUp, fov, boostFov (added while boosting), lean (degrees of roll into a drift), rateY (how stiffly it follows the road's height, 1/s), turn (how stiffly it follows the heading, 1/s).
   * Call the returned function with (view, dt, apply = true) just before the draw; it sets the camera (unless apply is false) and returns {eye, look, fov, roll}.
   */
  const chase = (id, o = {}) => {
    const c = { back: 5.2, up: 1.9, side: 0, swing: 0, look: 3.5, lookUp: 0.8, fov: 62, boostFov: 8, rateY: 9, turn: 3.5, roll: 0, lean: 0, ...o };
    let st = null;
    return (view, dt = 1 / 60, apply = true) => {
      const k = kartById(view, id);
      if (!k) return null;
      if (!st) st = { h: k.heading, eye: null, look: null, side: c.side, fov: c.fov };
      st.h = angle(st.h, k.heading, 1 - Math.exp(-c.turn * dt));
      st.side = damp(st.side, c.side - c.swing * k.drift, 4, dt);
      st.lean = damp(st.lean ?? 0, c.lean * k.drift, 4, dt);
      const f = { x: Math.sin(st.h), z: Math.cos(st.h) };
      const r = { x: -Math.cos(st.h), z: Math.sin(st.h) };
      // Attached to the kart in a frame that turns softly (smoothing the position itself would lag by speed / rate metres).
      st.y = st.y === undefined ? k.y + (k.hop || 0) : damp(st.y, k.y + (k.hop || 0), c.rateY, dt);
      const base = { x: k.x, y: st.y, z: k.z };
      st.eye = { x: base.x - f.x * c.back + r.x * st.side, y: base.y + c.up, z: base.z - f.z * c.back + r.z * st.side };
      st.look = { x: base.x + f.x * c.look, y: base.y + c.lookUp, z: base.z + f.z * c.look };
      st.fov = damp(st.fov, c.fov + (k.boost > 0 ? c.boostFov : 0), 5, dt);
      if (apply) cam(st.eye, st.look, st.fov, c.roll + st.lean);
      return { eye: st.eye, look: st.look, fov: st.fov, roll: c.roll + st.lean };
    };
  };
  /**
   * A camera that rides along a kart and swings round it. o.az: [from, to] degrees round the kart (0 behind it, 90 on its right,
   * -90 on its left, 180 in front), o.r: [from, to] metres, o.h: [from, to] metres above the road, o.fov: [from, to], o.ahead and
   * o.lookUp: where it looks (metres ahead of the kart's middle, and above the road), o.n: frames the swing takes, o.ease.
   * Returns frame(view, i): i counts frames from the start of the move.
   */
  const orbit = (id, o = {}) => {
    const c = { az: [-120, -60], r: [7, 5], h: [1, 1.3], fov: [50, 50], ahead: 2, lookUp: 0.7, n: 240, turn: 4, ...o };
    let hd = null;
    return (view, i, dt = 1 / 60) => {
      const k = kartById(view, id);
      if (!k) return null;
      hd = hd === null ? k.heading : angle(hd, k.heading, 1 - Math.exp(-c.turn * dt));
      const u = smoother(i / c.n);
      const az = lerp(c.az[0], c.az[1], u) * Math.PI / 180;
      const r = lerp(c.r[0], c.r[1], u);
      const f = { x: Math.sin(hd), z: Math.cos(hd) };
      const rt = { x: -Math.cos(hd), z: Math.sin(hd) };
      const base = { x: k.x, y: k.y + (k.hop || 0), z: k.z };
      // az 0: behind (-f), 90: right (+rt)
      const eye = { x: base.x - f.x * r * Math.cos(az) + rt.x * r * Math.sin(az), y: base.y + lerp(c.h[0], c.h[1], u), z: base.z - f.z * r * Math.cos(az) + rt.z * r * Math.sin(az) };
      const look = { x: base.x + f.x * c.ahead, y: base.y + c.lookUp, z: base.z + f.z * c.ahead };
      const fov = lerp(c.fov[0], c.fov[1], u);
      cam(eye, look, fov, 0);
      return { eye, look, fov };
    };
  };
  /** The state of the sim's kart, for patches. */
  const KART_AT = { charge: 8, level: 9, drift: 7, boost: 11, spin: 12, hop: 6, air: 41, trick: 44 };
  const snap = () => demo.race.snapshot();
  const charge = (id) => snap().k[id][KART_AT.charge];
  window.__rig = { grip, demo, g, L, TAU, clamp, lerp, smooth, smoother, wrap, pt, ps, heading, fwd, right, kartById, body, around, dist, mix, cam, follow, damp, dampV, spline, angle, chase, orbit, KART_AT, charge, snap };
}
