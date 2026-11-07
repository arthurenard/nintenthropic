/**
 * The trailer's cards and titles as one page of pure state: `cards.mount(id)`
 * builds a scene, `cards.update(t)` sets everything at t seconds. Nothing runs
 * on its own (no CSS animation, no timers), so render.mjs can step it to any
 * frame and get the same pixels every time.
 *
 * Timing is the trailer's clock: 60 fps, 120 BPM (a beat is 0.5 s, a bar 2 s).
 * Classic script (not a module) so the page also loads from file://.
 */
(() => {
  const FPS = 60;
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lerp = (a, b, x) => a + (b - a) * x;

  /** A CSS-style cubic-bezier(x1, y1, x2, y2) easing, solved by bisection. */
  function bezier(x1, y1, x2, y2) {
    const at = (a, b, s) => 3 * a * (1 - s) * (1 - s) * s + 3 * b * (1 - s) * s * s + s * s * s;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 28; i++) {
        const mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < x) lo = mid;
        else hi = mid;
      }
      return at(y1, y2, (lo + hi) / 2);
    };
  }
  /** Things arriving: quick to start, a long soft landing. */
  const easeIn = bezier(0.22, 0.8, 0.24, 1);
  /** Things leaving, and anything that goes both ways: slow, quicker, slow. */
  const easeInOut = bezier(0.45, 0, 0.25, 1);

  /** 0 before `from`, 1 after `to`, shaped by `ease` between. */
  const ramp = (t, from, to, ease = easeIn) => ease(clamp01((t - from) / (to - from)));

  function el(tag, className, html = "") {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (html) node.innerHTML = html;
    return node;
  }
  /** Opacity and a rise in px: `v` 0 is hidden and `rise` below its place, 1 is shown in place. */
  function show(node, v, rise = 0) {
    node.style.opacity = String(v);
    node.style.transform = rise ? `translateY(${(1 - v) * rise}px)` : "";
  }

  // ------------------------------------------------------------------------------------------
  // Titles: an eyebrow over a big name, top right. In 0.0-0.4 s (a rise and a fade), out over
  // the last 0.35 s (a fade and a small lift). Over game footage, so they carry a soft shadow.
  // ------------------------------------------------------------------------------------------
  function titleScene(id, eyebrow, name) {
    const dur = 2;
    const frames = Math.round(dur * FPS);
    const last = (frames - 1) / FPS;
    return {
      id,
      dur,
      frames,
      alpha: true,
      what: `Title over the footage, top right: "${eyebrow}" over "${name}".`,
      beats: [
        { t: 0, what: "the eyebrow and the name start to rise and fade in" },
        { t: 0.4, what: "in place, fully shown" },
        { t: 1.65, what: "starts to fade and lift out" },
        { t: +last.toFixed(3), what: "gone (the last frame is empty)" },
      ],
      holds: [[0.42, 1.64]],
      mount(root) {
        const box = el("div", "title");
        const scrim = el("div", "scrim");
        const top = el("div", "eyebrow line", eyebrow);
        const big = el("div", "name line", name);
        box.append(scrim, top, big);
        root.append(box);
        return (t) => {
          const out = ramp(t, 1.65, last, easeInOut);
          const a = ramp(t, 0, 0.36) * (1 - out);
          const b = ramp(t, 0.04, 0.4) * (1 - out);
          const lift = -12 * out;
          scrim.style.opacity = String(Math.min(a, b));
          top.style.opacity = String(a);
          top.style.transform = `translateY(${(1 - ramp(t, 0, 0.36)) * 14 + lift}px)`;
          big.style.opacity = String(b);
          big.style.transform = `translateY(${(1 - ramp(t, 0.04, 0.4)) * 24 + lift}px)`;
        };
      },
    };
  }

  // ------------------------------------------------------------------------------------------
  // "Up to 4 players. One camera.": centred, one line, over the four-way split screen.
  // ------------------------------------------------------------------------------------------
  function fourScene() {
    const dur = 2;
    const frames = Math.round(dur * FPS);
    const last = (frames - 1) / FPS;
    return {
      id: "t-four",
      dur,
      frames,
      alpha: true,
      what: 'Centred line over the split screen: "Up to 4 players. One camera." in one line, with a soft scrim.',
      beats: [
        { t: 0, what: '"Up to 4 players." starts to rise and fade in' },
        { t: 0.15, what: '"One camera." follows a hair behind' },
        { t: 0.6, what: "both in place" },
        { t: 1.65, what: "starts to fade and lift out" },
        { t: +last.toFixed(3), what: "gone (the last frame is empty)" },
      ],
      holds: [[0.62, 1.64]],
      mount(root) {
        const box = el("div", "four");
        const scrim = el("div", "scrim");
        const words = el("div", "words");
        const one = el("span", "", "Up to 4 players.");
        const two = el("span", "", "One camera.");
        words.append(one, document.createTextNode(" "), two);
        box.append(scrim, words);
        root.append(box);
        return (t) => {
          const out = ramp(t, 1.65, last, easeInOut);
          const a = ramp(t, 0, 0.42);
          const b = ramp(t, 0.15, 0.57);
          scrim.style.opacity = String(a * (1 - out));
          one.style.opacity = String(a * (1 - out));
          one.style.transform = `translateY(${(1 - a) * 22 - 12 * out}px)`;
          two.style.opacity = String(b * (1 - out));
          two.style.transform = `translateY(${(1 - b) * 22 - 12 * out}px)`;
        };
      },
    };
  }

  // ------------------------------------------------------------------------------------------
  // End card, opaque black. The app icon (with a soft sunset glow under it) and the two family
  // icons sit in the slots (.slot, marked below); render.mjs hands the images in (see README.md).
  // Without images the slots stay empty, and `--guides` outlines them.
  // ------------------------------------------------------------------------------------------
  function endScene() {
    const dur = 6;
    const frames = Math.round(dur * FPS);
    const last = (frames - 1) / FPS;
    return {
      id: "end",
      dur,
      frames,
      alpha: false,
      what: 'End card on black: the app icon (280 px) over a soft sunset glow, "Nintenthropic", "Games you play with your hands.", a row of two families (the app icon "Finger Guns", the kart icon "Grip Prix"), "In your browser. No controller.", then fade to black.',
      beats: [
        { t: 0, what: "the app icon and its sunset glow fade and scale in (0.0-0.6)" },
        { t: 0.3, what: '"Nintenthropic" rises in (0.3-0.9)' },
        { t: 1.0, what: '"Games you play with your hands." rises in (1.0-1.6)' },
        { t: 2.1, what: "the whole stack glides up a little to make room for the row (2.1-2.9)" },
        { t: 2.2, what: 'the two families, "Finger Guns" and "Grip Prix", rise in with their icons (2.2-2.8)' },
        { t: 3.0, what: '"In your browser. No controller." rises in (3.0-3.5)' },
        { t: 3.55, what: "complete and still" },
        { t: 5.3, what: "everything fades to black" },
        { t: +last.toFixed(3), what: "pure black (last frame)" },
      ],
      holds: [[3.56, 5.28]],
      slots: true,
      mount(root, opts = {}) {
        const box = el("div", "end");
        if (opts.guides) box.classList.add("guides");
        const fade = el("div", "fade");
        const stack = el("div", "stack");

        // SLOT 1: the app icon, 280 px, centred over the wordmark, with a soft sunset glow under it.
        const wrap = el("div", "app-wrap");
        const glow = el("div", "glow");
        const app = el("div", "slot app");
        app.dataset.slot = "app";
        wrap.append(glow, app);
        // The wordmark and the line under it.
        const word = el("div", "wordmark line", "Nintenthropic");
        const tag = el("div", "tagline line", "Games you play with your hands.");
        // The two families. SLOTS 2 and 3: the Finger Guns and Grip Prix icons, 96 px.
        const family = el("div", "family");
        const games = [
          ["finger-guns", "Finger Guns"],
          ["grip-prix", "Grip Prix"],
        ].map(([key, label]) => {
          const game = el("div", "game");
          const slot = el("div", "slot family-icon");
          slot.dataset.slot = key;
          game.append(slot, el("div", "label line", label));
          family.append(game);
          return { game, slot };
        });
        const note = el("div", "footnote line", "In your browser. No controller.");
        stack.append(wrap, word, tag, family, note);
        fade.append(stack);
        box.append(fade);
        root.append(box);

        // Icons, when given ({ app, "finger-guns", "grip-prix" }: image URLs): set into the slots.
        for (const [key, url] of Object.entries(opts.icons ?? {})) {
          const slot = box.querySelector(`[data-slot="${key}"]`);
          if (slot && url) slot.append(Object.assign(new Image(), { src: url, alt: "" }), el("div", "edge"));
        }

        // The stack is centred with everything in it; before the row arrives, it sits lower by half
        // the row's height so the top block is centred, then glides up as the row comes in.
        const added = family.offsetHeight + parseFloat(getComputedStyle(family).marginTop) + note.offsetHeight + parseFloat(getComputedStyle(note).marginTop);
        const shift = added / 2;

        return (t) => {
          const glide = ramp(t, 2.1, 2.9, easeInOut);
          stack.style.transform = `translateY(${(1 - glide) * shift}px)`;
          const a = ramp(t, 0, 0.6);
          wrap.style.opacity = String(a);
          wrap.style.transform = `scale(${lerp(0.9, 1, a)})`;
          glow.style.opacity = String(a * 0.62);
          show(word, ramp(t, 0.3, 0.9), 34);
          show(tag, ramp(t, 1.0, 1.6), 24);
          const row = ramp(t, 2.2, 2.8);
          show(family, row, 22);
          games.forEach(({ slot }) => {
            slot.style.transform = `scale(${lerp(0.92, 1, row)})`;
          });
          show(note, ramp(t, 3.0, 3.5), 16);
          fade.style.opacity = String(1 - ramp(t, 5.3, last, easeInOut));
        };
      },
    };
  }

  // ------------------------------------------------------------------------------------------
  // The sight: the app's mark without its square (ring, four ticks, a dot), drawn large and in
  // parts so a card can move them. Measures are the mark's own (tools/icons/mark.mjs, passed in
  // by render.mjs); 1 unit = S px, so S = 5.9 makes the whole sight (ticks and all) about 420 px.
  // White, with the one touch of colour in the dot (and a soft glow inside the ring): the
  // sunset gradient of the icon, #ffa40f into #ff2d55.
  // ------------------------------------------------------------------------------------------
  const NS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const DEFAULT_SIGHT = { C: 50, RING_R: 23, RING_W: 6.5, TICK_LEN: 9.5, TICK_W: 6, DOT_R: 4.6 };

  function makeSight(root, measures, { S, cx, cy }) {
    const m = { ...DEFAULT_SIGHT, ...measures };
    const svg = svgEl("svg", { viewBox: "0 0 100 100", width: 100 * S, height: 100 * S });
    svg.style.cssText = `position:absolute;left:${cx - 50 * S}px;top:${cy - 50 * S}px;overflow:visible`;
    const defs = svgEl("defs");
    const sunset = svgEl("linearGradient", { id: "sunset", x1: 0, y1: 0, x2: 0, y2: 1 });
    sunset.append(svgEl("stop", { offset: 0, "stop-color": "#ffa40f" }), svgEl("stop", { offset: 1, "stop-color": "#ff2d55" }));
    const halo = svgEl("radialGradient", { id: "halo" });
    halo.append(
      svgEl("stop", { offset: 0, "stop-color": "#ff8a1f", "stop-opacity": 0.9 }),
      svgEl("stop", { offset: 0.45, "stop-color": "#ff5a3a", "stop-opacity": 0.38 }),
      svgEl("stop", { offset: 1, "stop-color": "#ff2d55", "stop-opacity": 0 }),
    );
    defs.append(sunset, halo);

    const scaler = svgEl("g"); // scales about the centre
    const glow = svgEl("circle", { cx: m.C, cy: m.C, r: 13, fill: "url(#halo)" });
    const turner = svgEl("g", { fill: "none", stroke: "#fff", "stroke-linecap": "round" }); // turns about the centre
    const ring = svgEl("circle", { cx: m.C, cy: m.C, r: m.RING_R });
    const lines = [0, 90, 180, 270].map((a) => svgEl("line", { x1: m.C, x2: m.C, transform: `rotate(${a} ${m.C} ${m.C})` }));
    // Spokes (right, down, left): from the middle out; none until a card asks for them.
    const spokeLines = [90, 180, 270].map((a) => svgEl("line", { x1: m.C, x2: m.C, transform: `rotate(${a} ${m.C} ${m.C})`, style: "display:none" }));
    turner.append(ring, ...lines, ...spokeLines);
    const dot = svgEl("circle", { cx: m.C, cy: m.C, fill: "url(#sunset)" });
    scaler.append(glow, turner, dot);
    svg.append(defs, scaler);
    root.append(svg);

    return {
      m,
      /**
       * scale, turn (degrees, + is clockwise), opacity; ringW; ticks: four [from, to] radii (up, right,
       * down, left; to <= from hides one) and their width; spokes: three [from, to] radii (right, down, left)
       * and their width; dotR; glow (0-1); y: where the centre sits, in px on the frame.
       */
      set({ scale = 1, turn = 0, opacity = 1, ringW = m.RING_W, ticks, tickW = m.TICK_W, spokes, spokeW = 7, dotR = m.DOT_R, glowAmount = 0, y = cy }) {
        const spans = ticks ?? [0, 1, 2, 3].map(() => [m.RING_R, m.RING_R + m.TICK_LEN]);
        svg.style.opacity = String(opacity);
        svg.style.top = `${y - 50 * S}px`;
        scaler.setAttribute("transform", `translate(${m.C} ${m.C}) scale(${scale}) translate(${-m.C} ${-m.C})`);
        turner.setAttribute("transform", `rotate(${turn} ${m.C} ${m.C})`);
        ring.setAttribute("stroke-width", String(ringW));
        lines.forEach((line, i) => {
          const [from, to] = spans[i];
          line.setAttribute("y1", String(m.C - to));
          line.setAttribute("y2", String(m.C - from));
          line.setAttribute("stroke-width", String(tickW));
          line.style.display = to - from < 0.02 ? "none" : "";
        });
        spokeLines.forEach((line, i) => {
          const [from, to] = spokes?.[i] ?? [0, 0];
          line.setAttribute("y1", String(m.C - to));
          line.setAttribute("y2", String(m.C - from));
          line.setAttribute("stroke-width", String(spokeW));
          line.style.display = to - from < 0.02 ? "none" : "";
        });
        dot.setAttribute("r", String(Math.max(dotR, 0)));
        dot.style.display = dotR <= 0.01 ? "none" : "";
        glow.setAttribute("opacity", String(glowAmount));
      },
    };
  }

  /** A linear 0 to 1 between two times, smoothed at both ends. */
  const smooth = (t, from, to) => {
    const x = clamp01((t - from) / (to - from));
    return x * x * (3 - 2 * x);
  };
  /** Snap: starts at once, lands softly, never overshoots. */
  const snap = bezier(0.14, 0.88, 0.24, 1);

  // ------------------------------------------------------------------------------------------
  // Hook, opaque black, 4 s: kinetic type on the beat, then the sight locks on, then white.
  // ------------------------------------------------------------------------------------------
  function hookScene() {
    const frames = 240;
    const f = 1 / FPS;
    const last = (frames - 1) / FPS;
    return {
      id: "hook",
      dur: 4,
      frames,
      alpha: false,
      what: 'Cold open on black: "No controller." (0.0), "No keyboard." (1.0), "No mouse." (2.0), "Just your hands." (3.0), each a fast snap in and a fast out before the next beat; at 3.5 the white sight (the app mark\'s reticle, ~420 px) lands from 1.6x and locks on, its dot in the sunset gradient; the frame ramps to pure white by the last frame (cut to gameplay on white at 4.0).',
      beats: [
        { t: 0, what: '"No controller." snaps in (7 frames, first visible on frame 0)' },
        { t: 0.9, what: "it snaps out" },
        { t: 1.0, what: '"No keyboard." snaps in' },
        { t: 1.9, what: "it snaps out" },
        { t: 2.0, what: '"No mouse." snaps in' },
        { t: 2.9, what: "it snaps out" },
        { t: 3.0, what: '"Just your hands." snaps in (pure white; it stays)' },
        { t: 3.5, what: "THE SHOT: the sight snaps in and lands from 1.6x (to 3.74), ring closing in, ticks sliding in; the words fade out (to 3.6)" },
        { t: 3.6, what: "the dot (sunset gradient) pops in and its glow flares" },
        { t: 3.75, what: "locked on, still" },
        { t: 3.85, what: "ramp to white starts" },
        { t: +last.toFixed(3), what: "pure white (last frame; the cut into gameplay is on white at 4.0)" },
      ],
      holds: [],
      mount(root, opts = {}) {
        const box = el("div", "hook");
        const words = [
          ["No controller.", 0, 0.8],
          ["No keyboard.", 1, 0.8],
          ["No mouse.", 2, 0.8],
          ["Just your hands.", 3, 1],
        ].map(([text, at, alpha]) => {
          const row = el("div", "word");
          const span = el("span", "", text);
          span.style.color = `rgba(255,255,255,${alpha})`;
          row.append(span);
          box.append(row);
          return { row, span, at };
        });
        const sight = makeSight(box, opts.sight, { S: 5.9, cx: 960, cy: 540 });
        const white = el("div", "white");
        box.append(white);
        root.append(box);
        const R = sight.m.RING_R;
        const LEN = sight.m.TICK_LEN;

        return (t) => {
          words.forEach(({ row, span, at }, i) => {
            const inP = ramp(t, at - f, at + 6 * f, snap);
            const outP = i < 3 ? ramp(t, at + 1 - 6 * f, at + 1 - 2 * f, easeInOut) : ramp(t, 3.5, 3.6, easeInOut);
            const v = inP * (1 - outP);
            span.style.opacity = String(v);
            span.style.transform = `scale(${lerp(1.04, 1, inP) * lerp(1, i < 3 ? 0.985 : 0.97, outP)})`;
            row.style.visibility = v < 0.002 ? "hidden" : "visible";
          });

          // The lock-on: lands from 1.6x by a fast ease-out (no overshoot), ticks slide in a touch.
          const land = ramp(t, 3.5, 3.74, bezier(0.2, 0.82, 0.25, 1));
          const slide = ramp(t, 3.5, 3.8, snap);
          const dot = ramp(t, 3.6, 3.72, snap);
          const flare = ramp(t, 3.62, 3.69, snap) * (1 - ramp(t, 3.69, 3.95, easeInOut));
          const off = lerp(9, 0, slide);
          sight.set({
            scale: lerp(1.6, 1, land),
            opacity: clamp01((t - 3.5) / 0.07),
            ticks: [0, 1, 2, 3].map(() => [R + off, R + LEN + off]),
            dotR: sight.m.DOT_R * dot,
            glowAmount: 0.34 * dot + 0.66 * flare,
          });

          white.style.opacity = String(smooth(t, 3.85, last));
        };
      },
    };
  }

  // ------------------------------------------------------------------------------------------
  // Turn, opaque black, 2 s: the sight becomes a steering wheel, "Now grab the wheel.", the
  // wheel turns left and back, white for GO. Left, right and down ticks slide in through the ring
  // and become the spokes, the top tick retracts into the rim, the dot grows to the hub.
  // ------------------------------------------------------------------------------------------
  function turnScene() {
    const frames = 120;
    const f = 1 / FPS;
    const last = (frames - 1) / FPS;
    const whiteFrom = 113 * f; // frames 114-119 (the last six) are 1/6 ... 6/6 white
    return {
      id: "turn",
      dur: 2,
      frames,
      alpha: false,
      what: 'On black: the white sight (~420 px) turns into a three-spoke steering wheel (0.0-0.6), "Now grab the wheel." under it (0.3-0.8), the wheel turns 25 degrees left and back (1.3-1.85); the last six frames ramp to pure white (the cut at 2.0 is the race\'s GO).',
      beats: [
        { t: 0, what: "the sight sits centre (hard cut in on its first frame); its four ticks start to pull back into the ring" },
        { t: 0.2, what: "spokes start to grow from the dot out to the rim (right, down, left); the dot swells into the hub; the sight drifts up 80 px as the caption comes in (0.15-0.85)" },
        { t: 0.3, what: '"Now grab the wheel." rises in (0.3-0.8)' },
        { t: 0.6, what: "wheel complete: rim, hub in the sunset gradient, spokes at 9, 3 and 6" },
        { t: 1.3, what: "the wheel starts to turn left" },
        { t: 1.575, what: "peak: 25 degrees left" },
        { t: 1.85, what: "back to straight" },
        { t: +whiteFrom.toFixed(3), what: "white ramp starts (frames 114-119, the last six); frame 119 is pure white (the cut at 2.0 is GO)" },
      ],
      holds: [],
      mount(root, opts = {}) {
        const box = el("div", "turn");
        const sight = makeSight(box, opts.sight, { S: 5.9, cx: 960, cy: 540 });
        const caption = el("div", "caption line", "Now grab the wheel.");
        const white = el("div", "white");
        box.append(caption, white);
        root.append(box);
        const m = sight.m;
        const hubR = 9.5;
        const rimW = 8.6;
        const spokeW = 7.4;
        const size = 1.28; // the wheel is drawn a little larger than the sight

        return (t) => {
          // The ticks pull back into the rim; a beat later the spokes grow from the dot out to the rim
          // and the dot swells into the hub.
          const pull = ramp(t, 0, 0.3, easeInOut);
          const grow = ramp(t, 0.2, 0.6, easeInOut);
          const hub = ramp(t, 0.2, 0.6, easeInOut);
          const rim = ramp(t, 0, 0.6, easeInOut);
          const to = lerp(m.RING_R + m.TICK_LEN, m.RING_R, pull);
          const reach = lerp(4, m.RING_R, grow);
          // A steering input: 25 degrees left (counter-clockwise) and back, smooth at both ends.
          const u = clamp01((t - 1.3) / 0.55);
          const turn = -25 * 0.5 * (1 - Math.cos(2 * Math.PI * u));
          sight.set({
            scale: lerp(1, size, rim),
            turn,
            ringW: lerp(m.RING_W, rimW, rim),
            ticks: [0, 1, 2, 3].map(() => [m.RING_R, to]),
            spokes: [0, 1, 2].map(() => [4, reach]),
            spokeW,
            dotR: lerp(m.DOT_R, hubR, hub),
            glowAmount: 0.34,
            y: lerp(540, 460, ramp(t, 0.15, 0.85, easeInOut)),
          });
          show(caption, ramp(t, 0.3, 0.8), 18);
          white.style.opacity = String(clamp01((t - whiteFrom) / (last - whiteFrom)));
        };
      },
    };
  }

  const scenes = [
    hookScene(),
    turnScene(),
    titleScene("t-high-noon", "Finger Guns", "High Noon"),
    titleScene("t-dead-of-night", "Finger Guns", "Dead of Night"),
    titleScene("t-orbital-decay", "Finger Guns", "Orbital Decay"),
    titleScene("t-overwatch-ridge", "Finger Guns", "Overwatch Ridge"),
    titleScene("t-grip-prix", "Up to 4 Players", "Grip Prix"),
    fourScene(),
    endScene(),
  ];

  let current = null;
  window.cards = {
    FPS,
    /** The scene list, without the functions. */
    list: () => scenes.map(({ mount, ...info }) => info),
    /** Builds one scene on an empty stage. `opts`: { guides, icons }. */
    mount(id, opts) {
      const scene = scenes.find((s) => s.id === id);
      if (!scene) throw new Error(`no card "${id}"`);
      const stage = document.getElementById("stage");
      stage.replaceChildren();
      stage.className = scene.alpha ? "" : "opaque";
      current = scene.mount(stage, opts);
      current(0);
    },
    /** Sets the state at `t` seconds. */
    update(t) {
      current(t);
    },
    /** For the slots of a scene, where they sit when everything is in place: [{ name, x, y, w, h }]. */
    slots() {
      return [...document.querySelectorAll("[data-slot]")].map((node) => {
        // At rest, at scale 1, with the stack unshifted; measure with the transforms undone.
        const saved = [];
        for (let n = node; n && n.id !== "stage"; n = n.parentElement) {
          saved.push([n, n.style.transform]);
          n.style.transform = "none";
        }
        const r = node.getBoundingClientRect();
        for (const [n, v] of saved) n.style.transform = v;
        return { name: node.dataset.slot, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
    },
  };
})();
