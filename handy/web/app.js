"use strict";
const $ = (id) => document.getElementById(id);

// --- what the page says about each game ----------------------------------------

// Title Case names and one-line blurbs. The server's titles are the desktop's
// capitals, and its blurbs were written for a wider card.
const GAMES = {
  zombies: {
    name: "Dead of Night",
    blurb: "They come out of the fog. Aim for the head.",
    about:
      "They come up the road out of the fog, wave after wave. Head shots drop them. Body shots only slow them down.",
  },
  western: {
    name: "High Noon",
    blurb: "Bottles on the rail. Bandits in the doorways.",
    about:
      "Noon on main street. Knock the bottles off the rail and drop the bandits, but spare the townsfolk.",
  },
  orbit: {
    name: "Orbital Decay",
    blurb: "Shoot the debris before it hits the glass.",
    about:
      "Debris is tumbling toward the station. Shoot it down before it cracks the window.",
  },
  sniper: {
    name: "Overwatch Ridge",
    blurb: "A long valley and a rifle. Close one eye to scope.",
    about:
      "A long valley and a rifle. Close one eye to look through the scope, and watch the wind.",
  },
};
// The feature's art, drawn for the screen it is shown on: a Retina screen
// gets twice the pixels, which take the server twice as long to draw.
const featureArt = (key) =>
  devicePixelRatio > 1.25 ? `/art/${key}?w=1600&h=900` : `/art/${key}?w=1024&h=576`;
const SMALL_WORDS = new Set(["a", "an", "and", "as", "at", "for", "in", "of", "on", "the", "to"]);
function titleCase(text) {
  return String(text)
    .toLowerCase()
    .split(" ")
    .map((word, i) =>
      i && SMALL_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(" ");
}
function gameName(key) {
  return GAMES[key]?.name || titleCase(config.maps.find((m) => m.key === key)?.title || key);
}
const formatScore = (value) => Number(value || 0).toLocaleString("en-US");
function formatTime(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

// --- state ------------------------------------------------------------------------

let config,
  selectedMap = "zombies",
  selectedControl = "pistol",
  token,
  session = null,
  media = null;
let active = false,
  generation = 0,
  currentState = "",
  busy = false,
  fire = false,
  scoped = false;
let pointer = { x: 0.5, y: 0.5 },
  keys = new Set();
let pendingAction = null,
  setupKey = "",
  lastSaved = "",
  returning = false;
const captureCanvas = document.createElement("canvas");
captureCanvas.width = 640;
captureCanvas.height = 480;
const captureContext = captureCanvas.getContext("2d");

// Everything kept in the browser is a convenience: a window that cannot store
// anything plays just the same, only without remembering.
const storage = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* Without storage there is nothing saved to forget. */
    }
  },
};
const KEYS = {
  welcomed: "handy.welcomed.v1",
  muted: "handy.muted.v1",
  choice: "handy.choice.v1",
  camera: "handy.camera.v1",
  cameraOpened: "handy.camera-opened.v1",
  // The setup key keeps its old shape, so aims saved before still count.
  setup: (device) => `handy.setup.v1.pistol.${device}`,
  best: (map, duration) => `handy.best.v2.${map}.${duration}`,
};
function isCamera() {
  return selectedControl !== "mouse";
}
function toast(message) {
  const element = $("toast");
  element.hidden = true;
  element.textContent = message;
  void element.offsetWidth; // restart its animation
  element.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (element.hidden = true), 4000);
}
function announce(message) {
  // Spoken once by screen readers; the same words twice in a row are not.
  const element = $("announce");
  element.textContent = "";
  requestAnimationFrame(() => (element.textContent = message));
}
function setText(id, text) {
  // Most of what renderState writes repeats every frame. Rewriting it anyway
  // makes live regions announce it again, some 30 times a second.
  const element = typeof id === "string" ? $(id) : id;
  text = String(text);
  if (element.textContent !== text) element.textContent = text;
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

// --- sound ------------------------------------------------------------------------

// The desktop's own synthesised set, fetched from the server as WAV files,
// decoded once and played through WebAudio with a random take, re-pitched and
// re-levelled a hair as the desktop does, so no two shots are the same.
const sound = {
  context: null,
  master: null,
  buffers: new Map(), // name -> [AudioBuffer]
  loaded: new Set(), // "name/take" already fetched
  voices: [],
  muted: !!storage.get(KEYS.muted),
  loading: null,
  wake() {
    // Only a click or a key may start audio in a browser.
    if (!this.context) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume().catch(() => {});
  },
  load() {
    if (!this.context) return Promise.resolve();
    this.loading ||= this.fetchAll().finally(() => (this.loading = null));
    return this.loading;
  },
  async fetchAll() {
    // The set is built in the background after the server starts: keep
    // asking until it says it is complete, taking what is ready each time.
    for (let attempt = 0; attempt < 40; attempt++) {
      let manifest;
      try {
        const response = await fetch("/audio/manifest.json");
        if (!response.ok) return;
        manifest = await response.json();
      } catch {
        return;
      }
      const wanted = [];
      for (const [name, count] of Object.entries(manifest.cues || {}))
        for (let take = 0; take < count; take++)
          if (!this.loaded.has(`${name}/${take}`)) wanted.push([name, take]);
      await Promise.all(wanted.map(([name, take]) => this.fetchOne(name, take)));
      if (manifest.ready) return;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  },
  async fetchOne(name, take) {
    this.loaded.add(`${name}/${take}`);
    try {
      const response = await fetch(`/audio/${encodeURIComponent(name)}/${take}.wav`);
      if (!response.ok) throw new Error(response.status);
      const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
      if (!this.buffers.has(name)) this.buffers.set(name, []);
      this.buffers.get(name).push(buffer);
    } catch {
      this.loaded.delete(`${name}/${take}`); // asked for again next time round
    }
  },
  play(name, level = 1) {
    const takes = this.buffers.get(name);
    if (this.muted || !this.context || !takes?.length) return;
    const source = this.context.createBufferSource();
    source.buffer = takes[Math.floor(Math.random() * takes.length)];
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.03;
    const gain = this.context.createGain();
    gain.gain.value = level * 10 ** (((Math.random() * 2 - 1) * 0.8) / 20);
    source.connect(gain).connect(this.master);
    this.voice(source);
  },
  voice(source) {
    // As the desktop's mixer: the oldest sound gives way before a stuck
    // loop can pile a dozen more on top of it.
    this.voices.push(source);
    source.onended = () => (this.voices = this.voices.filter((v) => v !== source));
    while (this.voices.length > 12) this.voices.shift().stop();
    source.start();
  },
  click() {
    // A soft, short tick for the interface: a few milliseconds of a high,
    // quickly damped tone. Game sounds carry the weight.
    if (this.muted || !this.context) return;
    if (!this.tick) {
      const rate = this.context.sampleRate;
      const tick = this.context.createBuffer(1, Math.round(rate * 0.03), rate);
      const data = tick.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / rate;
        data[i] =
          0.22 *
          Math.exp(-t / 0.004) *
          (Math.sin(2 * Math.PI * 2600 * t) + 0.35 * Math.sin(2 * Math.PI * 5200 * t));
      }
      this.tick = tick;
    }
    const source = this.context.createBufferSource();
    source.buffer = this.tick;
    source.connect(this.master);
    this.voice(source);
  },
  setMuted(muted) {
    this.muted = muted;
    storage.set(KEYS.muted, muted);
    if (this.master)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.context.currentTime, 0.02);
    for (const id of ["mute", "sheet-mute"]) {
      $(id).setAttribute("aria-pressed", String(muted));
      $(id).setAttribute("aria-label", muted ? "Unmute" : "Mute");
    }
  },
};

// --- the frame exchange -------------------------------------------------------------

// A frame travels as a four-byte length, that much JSON, then a JPEG or
// nothing: both ways, so no picture is ever base64 text on either side.
const FRAME_TYPE = "application/x-handy-frame";
function packFrame(fields, camera) {
  const head = new TextEncoder().encode(JSON.stringify(fields));
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, head.length);
  return new Blob(camera ? [length, head, camera] : [length, head]);
}
function unpackFrame(bytes) {
  const length = new DataView(bytes).getUint32(0);
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 4, length)));
  data.image = new Blob([new Uint8Array(bytes, 4 + length)], {
    type: "image/jpeg",
  });
  return data;
}
class Offline extends Error {}
async function request(path, body) {
  // A Blob is a packed frame, answered with one; anything else is JSON.
  const frame = body instanceof Blob;
  let response, data;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "Content-Type": frame ? FRAME_TYPE : "application/json",
        "X-Handy-Token": token,
      },
      body: frame ? body : JSON.stringify(body),
    });
    data =
      frame && response.ok
        ? unpackFrame(await response.arrayBuffer())
        : await response.json();
  } catch {
    // No answer, or not Handy's: the browser's own wording ("Failed to fetch",
    // "Unexpected token") would mean nothing to the player.
    throw new Offline("Handy isn’t answering.");
  }
  if (!response.ok) {
    const error = new Error(data.error || "Something went wrong.");
    error.status = response.status;
    throw error;
  }
  return data;
}
function stageSize() {
  // In device pixels, so the server draws the game at the resolution it is
  // shown at rather than one the browser stretches. A stage with no size yet
  // measures 0 by 0: leave it out, and the server keeps the current size.
  const stage = $("stage");
  const size = [stage.clientWidth, stage.clientHeight].map((side) =>
    Math.round(side * devicePixelRatio),
  );
  return size[0] > 0 && size[1] > 0 ? size : undefined;
}
function stopCamera() {
  if (media) media.getTracks().forEach((track) => track.stop());
  media = null;
  $("camera").srcObject = null;
  drawHandGraph([]);
}
// Camera frames are mirrored and encoded on a worker thread where the browser
// allows it (capture.js). On the page's own thread toBlob waits for the page to
// fall idle, which a busy or background tab may not do for a whole second.
// The worker answers in order, and a game left for the arcade can still have
// a frame in it when the next game's first goes in: each waits its turn.
let encoder = null;
const encoding = [];
try {
  if (window.OffscreenCanvas) {
    encoder = new Worker("/capture.js");
    encoder.onmessage = ({ data }) => encoding.shift()?.(data);
    encoder.onerror = () => {
      encoder = null;
      encoding.splice(0).forEach((resolve) => resolve(null));
    };
  }
} catch {
  encoder = null;
}
async function cameraFrame() {
  const video = $("camera");
  if (!media || video.readyState < 2 || !video.videoWidth) return null;
  // Send the centred 4:3 view the preview shows (object-fit: cover), cropped
  // rather than squashed: squeezing a 16:9 camera into 4:3 bends the hand's
  // angles and the eye-openness ratios the scope reads, and misplaces the
  // skeleton drawn over the preview.
  const scale = Math.min(video.videoWidth / 640, video.videoHeight / 480);
  const [width, height] = [Math.round(640 * scale), Math.round(480 * scale)];
  const [x, y] = [
    Math.round((video.videoWidth - width) / 2),
    Math.round((video.videoHeight - height) / 2),
  ];
  if (encoder) {
    // A camera that has just stopped has no frame to give: send none.
    const frame = await createImageBitmap(video, x, y, width, height).catch(() => null);
    if (!frame) return null;
    return new Promise((resolve) => {
      encoding.push(resolve);
      encoder.postMessage(frame, [frame]);
    });
  }
  // Mirror exactly once, matching the preview and the native control conventions.
  captureContext.save();
  captureContext.translate(640, 0);
  captureContext.scale(-1, 1);
  captureContext.drawImage(video, x, y, width, height, 0, 0, 640, 480);
  captureContext.restore();
  return new Promise((resolve) => captureCanvas.toBlob(resolve, "image/jpeg", 0.7));
}
const frameContext = $("game-image").getContext("2d", { alpha: false });
let shown = Promise.resolve();
function show(image, run) {
  // Decoded off the page's thread, then drawn in the order frames arrived. A
  // data: URL per frame had the page parse base64 and swap an image's source,
  // which could flash while the new one loaded.
  const decoded = createImageBitmap(image);
  shown = shown
    .then(() => decoded)
    .then(
      (bitmap) => {
        const canvas = $("game-image");
        if (generation === run) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height)
            [canvas.width, canvas.height] = [bitmap.width, bitmap.height];
          frameContext.drawImage(bitmap, 0, 0);
          canvas.classList.add("shown");
          // The first frame of a map at a new size can take the server a
          // second or two to draw: until it is here, the game is not ready.
          if ($("game").dataset.ready !== "true") {
            $("game").dataset.ready = "true";
            loadingWatch?.stop();
            closeSheet("loading");
          }
        }
        bitmap.close();
      },
      () => {}, // a frame that will not decode is skipped, not fatal
    );
}

// --- the camera picture-in-picture ------------------------------------------------------

// The hand as the player sees it in the preview: white bones, soft round
// joints. Drawn here from the landmarks the server sends with each frame.
function drawHandGraph(hands) {
  const canvas = $("hand-graph");
  const ratio = devicePixelRatio;
  const [width, height] = [canvas.clientWidth, canvas.clientHeight].map((side) =>
    Math.round(side * ratio),
  );
  if (canvas.width !== width || canvas.height !== height)
    [canvas.width, canvas.height] = [width, height];
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);
  if (!width || !config) return;
  const unit = Math.max(1, width / 240) * ratio * 0.9;
  for (const points of hands) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.82)";
    ctx.lineWidth = 2 * unit;
    ctx.lineCap = "round";
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 4 * unit;
    ctx.beginPath();
    for (const [a, b] of config.handConnections) {
      if (!points[a] || !points[b]) continue;
      ctx.moveTo(points[a][0] * width, points[a][1] * height);
      ctx.lineTo(points[b][0] * width, points[b][1] * height);
    }
    ctx.stroke();
    ctx.fillStyle = "#fff";
    points.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x * width, y * height, ([4, 8, 12, 16, 20].includes(i) ? 3.4 : 2.6) * unit, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }
}

// --- the arcade -------------------------------------------------------------------------

function renderPosters() {
  const list = $("maps");
  list.replaceChildren();
  for (const map of config.maps) {
    const game = GAMES[map.key] || { name: titleCase(map.title), blurb: map.description };
    const poster = document.createElement("button");
    poster.className = "poster";
    poster.dataset.map = map.key;
    poster.setAttribute("role", "radio");
    poster.setAttribute("aria-checked", "false");
    const art = document.createElement("span");
    art.className = "poster-art";
    const image = document.createElement("img");
    image.alt = "";
    image.decoding = "async";
    image.fetchPriority = "low"; // after the feature's art, which is larger and first
    image.addEventListener("load", () => image.classList.add("loaded"));
    // Drawn for the poster's size on this screen, not the 360-wide default.
    image.src = `/art/${map.key}?w=720&h=405`;
    const check = document.createElement("span");
    check.className = "poster-check";
    check.append(icon("check"));
    art.append(image, check);
    const text = document.createElement("span");
    text.className = "poster-text";
    const name = document.createElement("span");
    name.className = "poster-name title2";
    name.textContent = game.name;
    const blurb = document.createElement("span");
    blurb.className = "poster-blurb subhead";
    blurb.textContent = game.blurb;
    text.append(name, blurb);
    poster.append(art, text);
    poster.addEventListener("click", () => selectMap(map.key));
    list.append(poster);
  }
}
function selectMap(key, focus = false) {
  if (!config.maps.some((m) => m.key === key)) key = config.maps[0].key;
  selectedMap = key;
  for (const poster of $("maps").children) {
    const on = poster.dataset.map === key;
    poster.setAttribute("aria-checked", String(on));
    // One stop in the tab order for the whole group, as radio buttons have.
    poster.tabIndex = on ? 0 : -1;
    if (on && focus) poster.focus();
  }
  renderStart();
  remember();
}
function savedAim() {
  // The aim saved for the camera used last. The real camera is only known
  // once it is open; if it turns out to be another, it warms up afresh.
  const camera = storage.get(KEYS.camera);
  return camera ? storage.get(KEYS.setup(camera)) : null;
}
function renderFeature() {
  const game = GAMES[selectedMap] || {};
  const text = $("feature-title").parentElement;
  if ($("feature-title").textContent !== gameName(selectedMap)) {
    text.classList.remove("changing");
    void text.offsetWidth;
    text.classList.add("changing");
  }
  setText("feature-title", gameName(selectedMap));
  setText("feature-about", game.about || "");
  // Cross-fade to the new art once it has loaded, never through black.
  const current = $("feature-art");
  const source = featureArt(selectedMap);
  if (current.dataset.shows === selectedMap) return;
  current.dataset.shows = selectedMap;
  const next = new Image();
  next.alt = "";
  next.fetchPriority = "high";
  next.src = source;
  next.decode().then(
    () => {
      if (current.dataset.shows !== selectedMap) return; // chosen past already
      if (!current.getAttribute("src")) {
        current.src = source;
        return;
      }
      next.className = "leaving";
      current.after(next);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => next.classList.remove("leaving")),
      );
      setTimeout(() => {
        current.src = source;
        next.remove();
      }, 480);
    },
    () => {},
  );
}
function renderStart() {
  renderFeature();
  const label = $("control-label");
  label.replaceChildren(
    icon(isCamera() ? "hand" : "mouse"),
    isCamera() ? "Finger Pistol" : "Mouse or Trackpad",
  );
  setText("switch-control", isCamera() ? "Use Mouse or Trackpad" : "Use Finger Pistol");
  $("enemy-option").hidden = selectedMap !== "zombies";
  $("adjust").hidden = !(isCamera() && savedAim());
  $("play").disabled = busy;
}
function remember() {
  storage.set(KEYS.choice, {
    map: selectedMap,
    control: selectedControl,
    duration: $("duration").value,
    enemy: $("enemy").value,
  });
}
function restoreChoice() {
  const choice = storage.get(KEYS.choice) || {};
  if (choice.control === "mouse" || choice.control === "pistol")
    selectedControl = choice.control;
  for (const id of ["duration", "enemy"])
    if ([...$(id).options].some((o) => o.value === choice[id])) $(id).value = choice[id];
  return choice.map;
}
function showView(name) {
  for (const view of ["welcome", "home", "game"]) $(view).hidden = view !== name;
  document.body.dataset.view = name;
}
function focusPlay() {
  // Back in the arcade, focus returns to Play - unless the player has already
  // put it somewhere else there.
  if (!$("home").contains(document.activeElement)) $("play").focus();
}

// --- sheets -------------------------------------------------------------------------------

function openSheet(id) {
  const sheet = $(id);
  if (!sheet.open) sheet.showModal();
  return sheet;
}
function closeSheet(id) {
  const sheet = $(id);
  if (sheet.open) sheet.close();
}
function closeSheets() {
  for (const sheet of document.querySelectorAll("dialog[open]")) sheet.close();
}
// What each trouble looks like, and what the player can do about it.
const TROUBLE = {
  denied: {
    icon: "camera",
    title: "Camera Is Off",
    body: "Your browser is blocking the camera for this page. Allow it from the address bar, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  busy: {
    icon: "camera",
    title: "Camera Is Busy",
    body: "Your camera is being used by another app. Close it, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  missing: {
    icon: "camera",
    title: "No Camera Found",
    body: "Connect a camera, then Try Again. Or play with your mouse.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  insecure: {
    icon: "camera",
    title: "Camera Unavailable",
    body: "Open Handy at the address shown in your terminal to use your camera.",
    primary: "Use Mouse or Trackpad",
  },
  stopped: {
    icon: "camera",
    title: "Camera Stopped",
    body: "Your camera disconnected. Reconnect it, then Try Again.",
    primary: "Try Again",
    secondary: "Choose a Game",
  },
  download: {
    icon: "wifi",
    title: "Couldn’t Get Ready",
    body: "The one-time download didn’t finish. Check your internet connection, then Try Again.",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  failed: {
    icon: "exclamation",
    title: "Something Went Wrong",
    primary: "Try Again",
    secondary: "Use Mouse or Trackpad",
  },
  ended: {
    icon: "grid",
    title: "Game Ended",
    primary: "Choose a Game",
  },
  offline: {
    icon: "exclamation",
    title: "Handy Stopped",
    body: "Start Handy again in your terminal, then Reload.",
    primary: "Reload",
  },
};
const ACTIONS = {
  "Try Again": () => start({ again: true }),
  "Use Mouse or Trackpad": () => {
    selectedControl = "mouse";
    renderStart();
    remember();
    start({ again: true });
  },
  "Choose a Game": () => back(),
  Reload: () => location.reload(),
};
function trouble(kind, body) {
  const sheet = TROUBLE[kind];
  loadingWatch?.stop();
  closeSheets();
  hideHint(true);
  $("alert-icon").replaceChildren(icon(sheet.icon));
  $("alert-icon").classList.toggle("danger", kind !== "ended");
  setText("alert-title", sheet.title);
  setText("alert-body", body || sheet.body);
  for (const [id, label] of [
    ["alert-primary", sheet.primary],
    ["alert-secondary", sheet.secondary],
  ]) {
    $(id).hidden = !label;
    if (label) {
      setText(id, label);
      $(id).onclick = () => {
        closeSheet("alert");
        ACTIONS[label]();
      };
    }
  }
  openSheet("alert");
}
function cameraTrouble(error) {
  return (
    {
      NotAllowedError: "denied",
      SecurityError: "denied",
      NotReadableError: "busy",
      TrackStartError: "busy",
      AbortError: "busy",
      NotFoundError: "missing",
      DevicesNotFoundError: "missing",
      OverconstrainedError: "missing",
    }[error?.name] || null
  );
}
async function cameraPermission() {
  try {
    return (await navigator.permissions.query({ name: "camera" })).state;
  } catch {
    return "prompt";
  }
}
// Before the browser asks, say why: once the player continues, the browser's
// own question follows. Resolves true to go on, false for the mouse.
function prime() {
  return new Promise((resolve) => {
    const sheet = openSheet("prime");
    const done = (value) => {
      sheet.onclose = null;
      closeSheet("prime");
      resolve(value);
    };
    $("prime-continue").onclick = () => done(true);
    $("prime-mouse").onclick = () => done(false);
    sheet.onclose = () => resolve(null); // Esc: back to the arcade
    $("prime-continue").focus();
  });
}

// --- starting a game ------------------------------------------------------------------------

// Whether the camera may be asked for now: true to go on - perhaps with the
// mouse instead, if the player chose it - false if not (the reason is shown).
async function cameraReady() {
  if (!isCamera()) return true;
  if (!navigator.mediaDevices?.getUserMedia) {
    trouble("insecure");
    return false;
  }
  const permission = await cameraPermission();
  if (permission === "denied") {
    trouble("denied");
    return false;
  }
  // Said once per browser: where the permission cannot be read (Safari), a
  // camera that has opened here before is taken as allowed.
  if (permission === "granted" || storage.get(KEYS.cameraOpened)) return true;
  const choice = await prime();
  if (choice === null) {
    focusPlay();
    return false;
  }
  if (!choice) {
    selectedControl = "mouse";
    remember();
  }
  return true;
}
let adjustNext = false;
async function start({ adjust = false, again = false } = {}) {
  if (busy) return;
  busy = true;
  renderStart();
  if (!again) adjustNext = adjust;
  sound.wake();
  let ready = false;
  try {
    ready = await cameraReady();
  } finally {
    if (!ready) {
      busy = false;
      renderStart();
    }
  }
  if (!ready) return;
  renderStart();
  // back() moves the generation on. Each wait below checks it, so a start the
  // player abandoned - by choosing a game while it loaded - undoes itself
  // instead of reopening the game over the arcade.
  const run = ++generation;
  const stale = () => generation !== run;
  let downloading = false;
  try {
    if (isCamera()) {
      const last = storage.get(KEYS.camera);
      media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
          ...(last ? { deviceId: { ideal: last } } : {}),
        },
        audio: false,
      });
      if (stale()) return;
      storage.set(KEYS.cameraOpened, true);
      $("camera").srcObject = media;
      await $("camera").play();
      if (stale()) return;
      watchCamera(run);
      media.getVideoTracks()[0].addEventListener("ended", () => {
        if (active && generation === run) {
          queueAction("pause");
          trouble("stopped");
        }
      });
    }
    const device = media?.getVideoTracks()[0].getSettings().deviceId || "default";
    setupKey = KEYS.setup(device);
    if (isCamera()) storage.set(KEYS.camera, device);
    const saved = isCamera() ? storage.get(setupKey) : null;
    sound.load();
    // The game view opens while the server loads, since the stage must be laid
    // out to be measured. Set it up for this game first, clearing whatever the
    // last one left on the stage.
    openGame(saved && !adjustNext ? "play" : isCamera() ? "setup" : "play");
    loadingWatch = watchLoading(run, (fraction) => {
      downloading ||= fraction !== null;
    });
    let created;
    try {
      created = await request("/api/start", {
        viewSize: stageSize(),
        map: selectedMap,
        control: selectedControl,
        enemy: $("enemy").value,
        duration: Number($("duration").value),
        calibration: saved,
        // A returning player's checked aim goes straight into the game;
        // Adjust Aim asks for the warm-up instead.
        useSavedAim: !!saved && !adjustNext,
      });
    } finally {
      loadingWatch.stopAsking();
    }
    if (stale()) {
      // back() had no session to stop yet, so this one would stay open.
      request("/api/stop", { id: created.id }).catch(() => {});
      return;
    }
    session = created;
    // The server could not use the stored setup - an older format, or damaged -
    // and started a fresh one. Forget it, or every start would send it again.
    if (session.forgetSavedSetup) storage.remove(setupKey);
    active = true;
    currentState = "";
    keys.clear();
    fire = false;
    scoped = false;
    lastSaved = "";
    lastArmed = null;
    renderState(session);
    loop(run);
  } catch (error) {
    if (stale()) return; // back() has already restored the arcade
    loadingWatch?.stop();
    stopCamera();
    showView("home");
    const kind = cameraTrouble(error);
    if (kind) trouble(kind);
    else if (error instanceof Offline) trouble("offline");
    else if (downloading) trouble("download");
    else trouble("failed", error.message);
  } finally {
    // An abandoned start may have opened the camera after back() closed it.
    if (stale()) stopCamera();
    busy = false;
    renderStart();
  }
}
function openGame(mode) {
  const game = $("game");
  game.dataset.mode = mode;
  game.dataset.state = "loading";
  game.dataset.ready = "false";
  $("game-image").classList.remove("shown");
  $("pip").hidden = !isCamera();
  $("game-image").setAttribute("aria-label", gameName(selectedMap));
  setText("score", "0");
  $("readouts").replaceChildren();
  readoutRows = [];
  $("clock-box").hidden = true;
  hideHint(true);
  showView("game");
  window.scrollTo({ top: 0 });
  // Focus moves with the player into the game, without ringing its Pause
  // button: Tab reaches the controls from here.
  $("game").focus();
}
// While a start is pending, ask the server how far it has got; after a
// moment's grace, say so. A first run downloads its models here. The sheet
// stays until the game's first frame is on the stage.
let loadingWatch = null;
function watchLoading(run, heard) {
  let stopped = false,
    asking = true;
  const shownAt = setTimeout(() => {
    if (stopped || generation !== run) return;
    if ($("loading-bar").hidden) setText("loading-title", "Getting ready…");
    openSheet("loading");
  }, 350);
  setText("loading-title", "Getting ready…");
  $("loading-bar").hidden = $("loading-note").hidden = true;
  const poll = async () => {
    while (asking && !stopped && generation === run && isCamera()) {
      try {
        const response = await fetch("/api/progress");
        const { loading, fraction } = await response.json();
        if (loading && fraction !== null && fraction !== undefined) {
          heard(fraction);
          const percent = Math.round(fraction * 100);
          setText("loading-title", `Getting ready… ${percent}%`);
          $("loading-bar").hidden = $("loading-note").hidden = false;
          $("loading-bar").setAttribute("aria-valuenow", String(percent));
          $("loading-bar").firstElementChild.style.transform = `scaleX(${fraction})`;
        }
      } catch {
        /* the start itself will say what went wrong */
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  poll();
  return {
    stopAsking() {
      asking = false;
    },
    stop() {
      stopped = true;
      clearTimeout(shownAt);
    },
  };
}

// --- the game's chrome ---------------------------------------------------------------------

let readoutRows = [],
  lastArmed = null,
  lastMoment = 0,
  lastTarget = null,
  lastScore = 0,
  resultsFor = null,
  roundId = 0,
  lostSince = null,
  hintUntil = 0,
  hintKind = "",
  freshRound = false;
function renderReadouts(list = []) {
  const box = $("readouts");
  if (readoutRows.length !== list.length || readoutRows.some((r, i) => r.label !== list[i].label)) {
    box.replaceChildren();
    readoutRows = list.map((readout) => {
      const label = document.createElement("dt");
      label.textContent = readout.label;
      const value = document.createElement("dd");
      box.append(label, value);
      let meter = null;
      if (readout.max) {
        meter = document.createElement("div");
        meter.className = "meter";
        meter.setAttribute("aria-hidden", "true");
        meter.append(document.createElement("span"));
        box.append(meter);
      }
      return { label: readout.label, value, meter };
    });
  }
  list.forEach((readout, i) => {
    const row = readoutRows[i];
    const danger = readout.tone === "danger";
    setText(
      row.value,
      typeof readout.value === "number" ? formatScore(readout.value) : readout.value,
    );
    row.value.classList.toggle("danger", danger);
    if (row.meter) {
      row.meter.classList.toggle("danger", danger);
      const share = Math.max(0, Math.min(1, readout.value / readout.max));
      const transform = `scaleX(${share})`;
      if (row.meter.firstElementChild.style.transform !== transform)
        row.meter.firstElementChild.style.transform = transform;
    }
  });
}
function renderSetup(step, data) {
  const testing = step.testing;
  setText("setup-phase", testing ? "Centre Hits" : "Learn Your Aim");
  const total = testing ? step.total : step.learnTotal;
  const done = testing ? step.hits : Math.min(step.learningShots, total);
  const dots = $("setup-dots");
  if (dots.children.length !== total || dots.dataset.phase !== String(testing)) {
    dots.replaceChildren(...Array.from({ length: total }, () => document.createElement("i")));
    dots.dataset.phase = String(testing);
  }
  [...dots.children].forEach((dot, i) => {
    const on = i < done;
    if (on && !dot.classList.contains("on")) {
      dot.classList.add("on", "pop");
      dot.addEventListener("animationend", () => dot.classList.remove("pop"), { once: true });
    } else if (!on) dot.classList.remove("on");
  });
  setText("setup-count", testing ? `${done} of ${total} centre hits` : `${done} of ${total} shots`);
  const words = $("setup-title").parentElement;
  if ($("setup-title").textContent !== step.title) {
    words.classList.remove("fresh");
    void words.offsetWidth;
    words.classList.add("fresh");
  }
  setText("setup-title", step.title);
  setText("setup-detail", step.detail);
  const trigger = $("trigger");
  const state = !data.tracking ? "lost" : step.armed ? "ready" : "raise";
  if (trigger.dataset.state !== state) {
    trigger.dataset.state = state;
    setText(
      trigger.lastElementChild,
      { lost: "Show your hand", ready: "Ready to fire", raise: "Raise your thumb" }[state],
    );
  }
  $("undo").disabled = step.shots === 0 && step.hits === 0;
  // Each good hit is celebrated once, where the target hung.
  if (step.moment.id !== lastMoment) {
    lastMoment = step.moment.id;
    if (step.moment.kind === "hit" && lastTarget) celebrate(lastTarget);
    if (step.moment.kind) announce(`${step.title} ${step.detail}`);
  }
  lastTarget = step.target;
}
function celebrate([x, y]) {
  const box = frameBox();
  const stage = $("stage").getBoundingClientRect();
  const size = 0.075 * 2 * Math.min(box.width, box.height);
  const left = box.left - stage.left + x * box.width;
  const top = box.top - stage.top + y * box.height;
  const ring = document.createElement("div");
  ring.className = "burst";
  const check = document.createElement("div");
  check.className = "burst-check";
  check.append(icon("check"));
  for (const [element, scale] of [
    [ring, 1.25],
    [check, 0.42],
  ]) {
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = element.style.height = `${size * scale}px`;
    element.addEventListener("animationend", () => element.remove());
    $("bursts").append(element);
  }
}
function showHint(text, seconds = 4, kind = "") {
  const hint = $("hint");
  setText(hint, text);
  hintKind = kind;
  hintUntil = seconds === Infinity ? Infinity : performance.now() + seconds * 1000;
  if (hint.hidden || hint.classList.contains("gone")) {
    hint.classList.add("gone");
    hint.hidden = false;
    requestAnimationFrame(() => hint.classList.remove("gone"));
  }
}
function hideHint(now = false) {
  const hint = $("hint");
  hintKind = "";
  hintUntil = 0;
  if (now) {
    hint.hidden = true;
    return;
  }
  hint.classList.add("gone");
}
const touch = matchMedia("(pointer: coarse)");
function roundStarted() {
  roundId++;
  resultsFor = null;
  lastScore = 0;
  const sniper = selectedMap === "sniper";
  const fire = touch.matches ? "Tap to fire." : "Click to fire.";
  showHint(
    isCamera()
      ? sniper
        ? "Close one eye to look through the scope."
        : "Point at a target. Fold your thumb to fire."
      : sniper && !touch.matches
        ? `${fire} Hold Shift or right-click to scope.`
        : fire,
    4.5,
    "start",
  );
}
function renderHints(data) {
  const now = performance.now();
  // A lost hand in play is said at once, and stays said until it is back.
  const playing = data.state === "playing" && isCamera();
  if (playing && data.tracking === false) {
    lostSince ??= now;
    if (now - lostSince > 600 && hintKind !== "lost") showHint("Show your hand to the camera.", Infinity, "lost");
  } else {
    lostSince = null;
    if (hintKind === "lost") hideHint();
  }
  if (hintKind && hintUntil !== Infinity && now > hintUntil) hideHint();
  if (data.state !== "playing" && hintKind && hintKind !== "lost") hideHint();
  $("pip").classList.toggle("lost", isCamera() && data.tracking === false && data.state !== "paused");
}
function renderState(data) {
  const previous = currentState;
  currentState = data.state;
  const game = $("game");
  const warming = data.state === "calibration" || (data.state === "paused" && !!data.step);
  game.dataset.mode = warming ? "setup" : "play";
  game.dataset.state = data.state;
  // The HUD.
  const score = formatScore(data.score);
  if ($("score").textContent !== score) {
    setText("score", score);
    if (data.score > lastScore && !reducedMotion.matches) {
      $("score").classList.remove("pop");
      void $("score").offsetWidth;
      $("score").classList.add("pop");
    }
    lastScore = data.score;
  }
  renderReadouts(data.readouts);
  const clock = $("clock-box");
  clock.hidden = data.remaining === null || data.remaining === undefined;
  if (!clock.hidden) {
    setText("clock", formatTime(data.remaining));
    clock.classList.toggle("late", data.remaining <= 10 && data.state === "playing");
  }
  if (data.step) renderSetup(data.step, data);
  if (data.hands) drawHandGraph(data.hands);
  // The pistol re-cocks audibly, as it does on the desktop.
  if (isCamera() && data.armed === true && lastArmed === false) sound.play("cock", 0.8);
  if (data.armed !== undefined) lastArmed = data.armed;
  for (const cue of data.cues || []) sound.play(cue);
  if (data.calibration) {
    const encoded = JSON.stringify(data.calibration);
    if (encoded !== lastSaved) {
      if (!storage.set(setupKey, data.calibration))
        toast("This window can’t save your aim. It works until you close it.");
      lastSaved = encoded;
    }
  }
  // Moments between states. The fifth hit ends the warm-up in the same frame,
  // so it is celebrated here, with the aim set, over the game it starts.
  if (previous === "calibration" && data.state === "playing") {
    lastTarget = null;
    $("aim-set").hidden = true;
    void $("aim-set").offsetWidth;
    $("aim-set").hidden = false;
    setTimeout(() => ($("aim-set").hidden = true), 1800);
    announce("Aim set. Here we go.");
  }
  if (data.state === "playing" && (freshRound || !["playing", "paused"].includes(previous))) {
    freshRound = false;
    roundStarted();
  }
  if (data.state === "calibration" && previous !== "calibration" && previous !== "paused") {
    lastMoment = data.step?.moment.id ?? 0;
  }
  // Sheets.
  if (data.state === "paused") openPause(!!data.step);
  else closeSheet("pause-sheet");
  if (data.state === "over" && resultsFor !== roundId) {
    resultsFor = roundId;
    openResults(data);
  } else if (data.state !== "over") closeSheet("results");
  renderHints(data);
  redrawCrosshair(); // shown only while a round is being played
}
function openPause(warming) {
  const sheet = $("pause-sheet");
  if (sheet.open) return;
  $("restart").hidden = warming;
  $("menu-start-over").hidden = !warming;
  $("adjust-aim").hidden = warming || !isCamera();
  setText("pause-title", "Paused");
  openSheet("pause-sheet");
  $("resume").focus();
  announce("Paused");
}

// --- results --------------------------------------------------------------------------------

let lastResults = null;
function openResults(data) {
  const summary = data.summary || { outcome: "Time’s Up", stats: [] };
  const key = KEYS.best(selectedMap, $("duration").value);
  const best = storage.get(key);
  const isBest = data.score > 0 && (typeof best !== "number" || data.score > best);
  if (isBest) storage.set(key, data.score);
  lastResults = { map: selectedMap, score: data.score, summary, isBest };
  $("results-art").src = `/art/${selectedMap}?w=720&h=405`;
  setText("results-map", gameName(selectedMap));
  const outcome = $("results-outcome");
  setText(outcome, summary.outcome);
  outcome.className = "title2" + (summary.won ? " outcome-won" : summary.lost ? " outcome-lost" : "");
  const stats = $("results-stats");
  stats.replaceChildren(
    ...summary.stats.map(({ label, value }) => {
      const cell = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      cell.append(detail, term);
      return cell;
    }),
  );
  $("new-best").hidden = true;
  $("new-best").classList.remove("pop");
  openSheet("results");
  $("again").focus();
  countUp($("results-score"), data.score, () => {
    if (isBest) {
      $("new-best").hidden = false;
      $("new-best").classList.add("pop");
    }
  });
  announce(
    `${summary.outcome}. ${formatScore(data.score)} points.${isBest ? " New best." : ""}`,
  );
}
function countUp(element, target, done) {
  // The final score counts up, not with reduced motion: it simply appears.
  if (reducedMotion.matches || target <= 0) {
    setText(element, formatScore(target));
    done();
    return;
  }
  const began = performance.now();
  const length = Math.min(1100, 500 + target / 20);
  const step = (now) => {
    const t = Math.min(1, (now - began) / length);
    const eased = 1 - (1 - t) ** 3;
    setText(element, formatScore(Math.round(target * eased)));
    if (t < 1 && $("results").open) requestAnimationFrame(step);
    else {
      setText(element, formatScore(target));
      done();
    }
  };
  requestAnimationFrame(step);
}
// The results as a picture worth passing round: the map's art, its name,
// the outcome, the score and the stats, branded Handy.
async function drawShareCard(results) {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, 1200, 630);
  const art = new Image();
  art.src = `/art/${results.map}?w=1280&h=720`;
  try {
    await art.decode();
    // The art covers the right of the card and fades into black under the
    // words on the left: 1280 by 720 scaled to 630 tall, its middle kept.
    const scale = 630 / art.naturalHeight;
    const width = 840 / scale;
    ctx.drawImage(art, (art.naturalWidth - width) / 2, 0, width, art.naturalHeight, 360, 0, 840, 630);
  } catch {
    /* a card without its picture is still a card */
  }
  const fade = ctx.createLinearGradient(360, 0, 820, 0);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(360, 0, 460, 630);
  const bottom = ctx.createLinearGradient(0, 380, 0, 630);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 380, 1200, 250);
  const font = getComputedStyle(document.body).fontFamily;
  const text = (words, x, y, size, weight, colour, tracking = 0) => {
    ctx.font = `${weight} ${size}px ${font}`;
    ctx.fillStyle = colour;
    if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking}px`;
    ctx.fillText(words, x, y);
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    return ctx.measureText(words).width;
  };
  // The wordmark, with the hand.
  const hand = new Image();
  hand.src =
    "data:image/svg+xml," +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${document.getElementById("i-hand").innerHTML}</svg>`,
    );
  try {
    await hand.decode();
    ctx.drawImage(hand, 64, 58, 40, 40);
  } catch {
    /* the name alone will do */
  }
  text("Handy", 112, 90, 32, 700, "#fff", -0.3);
  const summary = results.summary;
  text(gameName(results.map).toUpperCase(), 64, 250, 20, 600, "rgba(235,235,245,0.62)", 1.2);
  const colour = summary.won ? "#30d158" : summary.lost ? "#ff453a" : "#fff";
  text(summary.outcome, 64, 296, 40, 600, colour, -0.4);
  text(formatScore(results.score), 60, 400, 112, 700, "#fff", -2.2);
  if (results.isBest) text("★ New Best", 66, 446, 26, 600, "#ffd60a");
  let x = 64;
  for (const { label, value } of summary.stats.slice(0, 4)) {
    const width = Math.max(
      text(value, x, 540, 32, 600, "#fff"),
      text(label, x, 574, 20, 400, "rgba(235,235,245,0.62)"),
    );
    x += Math.max(width, 96) + 40;
  }
  return canvas;
}
// Passed to the system's share sheet where the browser has one for files;
// otherwise saved, as a download.
async function shareCard() {
  const results = lastResults;
  if (!results) return;
  const canvas = await drawShareCard(results);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const name = `handy-${gameName(results.map).toLowerCase().replaceAll(" ", "-")}.png`;
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Handy · ${gameName(results.map)}` });
      return;
    } catch (error) {
      if (error.name === "AbortError") return; // the player closed the share sheet
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  toast("Saved to your Downloads.");
}

// --- the frame loop ----------------------------------------------------------------------------

function queueAction(action, extra = {}) {
  if (!active || pendingAction) return;
  pendingAction = { action, ...extra };
  keys.clear();
  fire = false;
  wake?.();
}
// Frames go out one at a time, each as soon as the answer to the last is in
// and there is something new to send: with a camera, the next frame it
// presents; otherwise the next display frame, about 30 a second.
const FRAME_INTERVAL = 1000 / 30;
let cameraFrames = 0, // frames the camera has presented since it opened
  cameraSeen = -Infinity, // when it last presented one
  wake = null, // sends the next frame now, if the loop is waiting
  onCamera = null;
function watchCamera(run) {
  const video = $("camera");
  if (!video.requestVideoFrameCallback) return;
  const presented = () => {
    if (generation !== run || !media) return;
    cameraFrames++;
    cameraSeen = performance.now();
    onCamera?.();
    video.requestVideoFrameCallback(presented);
  };
  video.requestVideoFrameCallback(presented);
}
function nextTurn(sentAt, sentFrame) {
  const paused = currentState === "paused";
  // A camera the browser has not shown a frame from lately - one without
  // requestVideoFrameCallback, or not on screen - is read with the display.
  const camera = !paused && performance.now() - cameraSeen < 250;
  if (pendingAction || (camera && cameraFrames !== sentFrame)) return Promise.resolve();
  return new Promise((resolve) => {
    let frame = 0;
    const done = () => {
      wake = onCamera = null;
      clearTimeout(timer);
      cancelAnimationFrame(frame);
      resolve();
    };
    const due = () => {
      if (performance.now() - sentAt >= FRAME_INTERVAL - 4) done();
      else frame = requestAnimationFrame(due);
    };
    // A paused game only has to keep its session open. The timer also stands
    // in for a background tab, which runs no display frames, and for a camera
    // that stalls.
    const timer = setTimeout(done, paused ? 200 : 250);
    wake = done;
    if (camera) onCamera = done;
    else if (!paused) frame = requestAnimationFrame(due);
  });
}
async function loop(run) {
  let sentAt = -Infinity,
    sentFrame = -1;
  while (active && generation === run) {
    await nextTurn(sentAt, sentFrame);
    if (!active || generation !== run) return;
    sentAt = performance.now();
    sentFrame = cameraFrames;
    if (pendingAction) {
      const action = pendingAction;
      pendingAction = null;
      try {
        const data = await request("/api/action", {
          id: session.id,
          ...action,
        });
        if (generation !== run) return;
        renderState(data);
      } catch (error) {
        if (generation !== run) return;
        // A refused button press leaves the game running: say why and carry
        // on. If the game itself is gone, the frame below reports that.
        if (!(error instanceof Offline)) toast(error.message);
      }
    }
    try {
      const camera = currentState === "paused" ? null : await cameraFrame();
      const shot = fire;
      fire = false;
      const data = await request(
        "/api/frame",
        packFrame(
          {
            viewSize: stageSize(),
            id: session.id,
            ...(shot || pointer),
            fire: !!shot,
            scope: scoped || keys.has("Shift"),
          },
          camera,
        ),
      );
      if (generation !== run || !active) return;
      show(data.image, run);
      renderState(data);
    } catch (error) {
      if (generation !== run) return;
      active = false;
      stopCamera();
      if (error instanceof Offline) trouble("offline");
      else trouble("ended", error.message);
      return;
    }
  }
}
async function back() {
  if (returning) return;
  returning = true;
  active = false;
  generation++;
  pendingAction = null;
  keys.clear();
  fire = false;
  stopCamera();
  loadingWatch?.stop();
  closeSheets();
  try {
    if (session) await request("/api/stop", { id: session.id });
  } catch {
    /* The arcade remains usable if the server stopped. */
  }
  session = null;
  currentState = "";
  showView("home");
  renderStart();
  returning = false;
  focusPlay();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// --- the mouse's crosshair ------------------------------------------------------------------------

function frameBox() {
  // Where the frame shows within its element. object-fit can letterbox one
  // of another shape: a round keeps its size when the stage is resized.
  const canvas = $("game-image"),
    rect = canvas.getBoundingClientRect();
  if (getComputedStyle(canvas).objectFit !== "contain") return rect;
  const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
  const [width, height] = [canvas.width * scale, canvas.height * scale];
  return {
    left: rect.left + (rect.width - width) / 2,
    top: rect.top + (rect.height - height) / 2,
    width,
    height,
  };
}
function point(event) {
  const box = frameBox();
  pointer = {
    x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
    y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
  };
  redrawCrosshair();
}
// With a mouse the crosshair is drawn here, over the frame, where the pointer
// is now: drawn into the frame by the server it trailed the pointer by a round
// trip and more. It copies scene.draw_crosshair - a ring broken at the compass
// points, ticks through the gaps, a dot, a ring kicking out on each shot - at
// the size the server would draw it, in the tint that means the gun is ready.
// A hand's crosshair stays in the frame: only the server knows where its
// filtered aim lands.
const RECOIL = 180; // ms, scene.RECOIL
let firedAt = -Infinity,
  crosshairFrame = 0;
function redrawCrosshair() {
  crosshairFrame ||= requestAnimationFrame(drawCrosshair);
}
function drawCrosshair() {
  crosshairFrame = 0;
  const overlay = $("crosshair");
  const aiming =
    active &&
    selectedControl === "mouse" &&
    currentState === "playing" &&
    $("game-image").classList.contains("shown") &&
    !(selectedMap === "sniper" && (scoped || keys.has("Shift")));
  $("stage").classList.toggle("aiming", aiming);
  if (!aiming) {
    // Cleared, and its memory given back until there is a crosshair again.
    if (overlay.width) overlay.width = overlay.height = 0;
    return;
  }
  const area = overlay.getBoundingClientRect(),
    ratio = devicePixelRatio;
  const [width, height] = [area.width, area.height].map((side) => Math.round(side * ratio));
  if (overlay.width !== width || overlay.height !== height)
    [overlay.width, overlay.height] = [width, height];
  const context = overlay.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const box = frameBox();
  // Centred on a pixel, as OpenCV centres its shapes.
  const x = Math.floor((box.left - area.left + pointer.x * box.width) * ratio),
    y = Math.floor((box.top - area.top + pointer.y * box.height) * ratio);
  context.setTransform(1, 0, 0, 1, 0.5, 0.5);
  // The server's 0.75 on a 960-wide frame, grown with the frame as shown.
  const scale = 0.75 * Math.max((box.width * ratio) / 960, (box.height * ratio) / 900);
  const size = (value) => Math.max(1, Math.round(value * scale));
  // OpenCV's anti-aliased stroke of thickness t comes out about 2t - 0.5
  // pixels wide (1.35 for t = 1), and a filled dot half a pixel wider.
  const stroke = (thickness) => (thickness === 1 ? 1.35 : 2 * thickness - 0.55);
  const weight = stroke(size(2)),
    radius = Math.round(20 * scale),
    ring = (r, from, to) => {
      context.beginPath();
      context.arc(x, y, r, (from * Math.PI) / 180, (to * Math.PI) / 180);
      context.stroke();
    };
  context.strokeStyle = context.fillStyle = "#30d158"; // the tint: the gun is ready
  context.lineCap = "round";
  context.lineWidth = weight;
  for (const start of [10, 100, 190, 280]) ring(radius, start, start + 70);
  context.beginPath();
  context.arc(x, y, size(2) + 0.5, 0, 2 * Math.PI);
  context.fill();
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const at = (reach) => [x + dx * reach * scale, y + dy * reach * scale];
    for (const [from, lineWidth] of [
      [9, stroke(size(1))],
      [25, weight],
    ]) {
      context.lineWidth = lineWidth;
      context.beginPath();
      context.moveTo(...at(from));
      context.lineTo(...at(30));
      context.stroke();
    }
  }
  const kick = (performance.now() - firedAt) / RECOIL;
  if (kick < 1) {
    context.globalAlpha = 1 - kick;
    context.lineWidth = weight;
    ring(Math.round((20 + 34 * kick) * scale), 0, 360);
    context.globalAlpha = 1;
    redrawCrosshair();
  }
}
new ResizeObserver(redrawCrosshair).observe($("stage"));

// --- input -----------------------------------------------------------------------------------------

$("game-image").addEventListener("pointermove", point);
$("game-image").addEventListener("pointerdown", (event) => {
  point(event);
  if (event.button === 2) scoped = true;
  else if (selectedControl === "mouse") {
    // The shot lands where the click was, even if the pointer moves on
    // before the frame carrying it goes out - which is at once.
    fire = { ...pointer };
    if (currentState === "playing" && performance.now() - firedAt >= 120)
      firedAt = performance.now();
    wake?.();
  }
  event.preventDefault();
});
$("stage").addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("pointerup", () => {
  scoped = false;
  redrawCrosshair();
});
window.addEventListener("pointercancel", () => {
  scoped = false;
  redrawCrosshair();
});
window.addEventListener("keydown", (event) => {
  if (!active || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName)) return;
  // Space presses a focused button, as it always does.
  if (event.code === "Space" && event.target.tagName === "BUTTON") return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key)) event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  redrawCrosshair(); // Shift scopes the rifle, which hides the crosshair
  if (currentState === "over") return;
  if (key === "p" || key === " " || (key === "Escape" && currentState !== "paused"))
    queueAction(currentState === "paused" ? "resume" : "pause");
  else if (key === "m") sound.setMuted(!sound.muted);
  else if (currentState === "calibration" && (key === "b" || key === "Backspace"))
    queueAction("undo");
  else if (currentState === "calibration" && key === "r") queueAction("reset");
  else if (currentState === "playing" && key.length === 1 && !event.metaKey && !event.ctrlKey)
    // A key that does nothing: say which ones do, then get out of the way.
    showHint("Press P to pause, or M to mute.", 3, "keys");
});
window.addEventListener("keyup", (event) => {
  keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key);
  redrawCrosshair();
});
function blur() {
  keys.clear();
  scoped = false;
  fire = false;
  redrawCrosshair();
  if (active && !["paused", "over"].includes(currentState)) queueAction("pause");
}
window.addEventListener("blur", blur);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) blur();
});
window.addEventListener("pagehide", () => {
  stopCamera();
  if (session)
    fetch("/api/stop", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", "X-Handy-Token": token },
      body: JSON.stringify({ id: session.id }),
    }).catch(() => {});
});
// The posters are one radio group: arrows move the choice, as they do in any.
$("maps").addEventListener("keydown", (event) => {
  const order = config.maps.map((m) => m.key);
  const at = order.indexOf(selectedMap);
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step) {
    event.preventDefault();
    selectMap(order[(at + step + order.length) % order.length], true);
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    selectMap(order[event.key === "Home" ? 0 : order.length - 1], true);
  } else if (event.key === "Enter") {
    event.preventDefault();
    start();
  }
});
// Every button clicks softly; the game's own sounds carry the weight.
document.addEventListener(
  "click",
  (event) => {
    if (event.target.closest("button, select")) {
      sound.wake();
      sound.click();
    }
  },
  true,
);
$("get-started").onclick = () => {
  storage.set(KEYS.welcomed, true);
  showView("home");
  focusPlay();
};
$("play").onclick = () => start();
$("adjust").onclick = () => start({ adjust: true });
$("switch-control").onclick = () => {
  selectedControl = isCamera() ? "mouse" : "pistol";
  renderStart();
  remember();
};
$("duration").onchange = $("enemy").onchange = remember;
$("pause").onclick = () => queueAction("pause");
$("resume").onclick = () => queueAction("resume");
$("restart").onclick = () => {
  freshRound = true; // a new round, though it follows a pause
  queueAction("restart");
};
$("menu-start-over").onclick = () => queueAction("reset");
$("adjust-aim").onclick = () => queueAction("calibrate");
$("choose-game").onclick = $("choose").onclick = () => back();
$("again").onclick = () => queueAction("play");
$("share").onclick = async () => {
  $("share").disabled = true;
  try {
    await shareCard();
  } finally {
    $("share").disabled = false;
  }
};
$("undo").onclick = () => queueAction("undo");
$("start-over").onclick = () => queueAction("reset");
$("loading-cancel").onclick = () => back();
for (const id of ["mute", "sheet-mute"]) $(id).onclick = () => sound.setMuted(!sound.muted);
$("fullscreen").onclick = () => {
  const promise = document.fullscreenElement
    ? document.exitFullscreen()
    : $("game").requestFullscreen?.();
  promise?.catch(() => toast("Full screen isn’t available here."));
};
$("about").onclick = () => openSheet("privacy");
$("privacy-done").onclick = () => closeSheet("privacy");
// Esc on a sheet over the game: the pause sheet resumes, the others stay
// until the player chooses; loading goes back to the arcade.
$("pause-sheet").addEventListener("cancel", (event) => {
  event.preventDefault();
  queueAction("resume");
});
$("results").addEventListener("cancel", (event) => event.preventDefault());
$("loading").addEventListener("cancel", (event) => {
  event.preventDefault();
  back();
});

// --- opening the page --------------------------------------------------------------------------------

async function init() {
  sound.setMuted(sound.muted);
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error();
    config = await response.json();
    token = config.token;
  } catch {
    showView("home");
    trouble("offline");
    return;
  }
  renderPosters();
  selectMap(restoreChoice() || "zombies");
  showView(storage.get(KEYS.welcomed) ? "home" : "welcome");
  if (!$("welcome").hidden) $("get-started").focus();
  // The other games' large art, drawn and cached ahead of the first click.
  setTimeout(() => {
    for (const map of config.maps) new Image().src = featureArt(map.key);
  }, 1200);
}
init();
