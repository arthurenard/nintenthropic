"use strict";
const $ = (id) => document.getElementById(id);
const SHOOT = [
  {
    key: "pistol",
    title: "Finger pistol",
    icon: "⌁",
    detail: "Point to aim. Fold your thumb to fire.",
    hint: "Warm up in Target Range. Five accurate hits start your game automatically.",
  },
  {
    key: "mouse",
    title: "Use mouse or touch instead",
    icon: "↖",
    detail: "An alternative without a camera.",
    hint: "Point and click, or tap to shoot. No camera needed.",
  },
];
const MAP_COPY = {
  zombies: ["Survival / Waves", "Hold the road against zombies or robots."],
  western: [
    "Quick draw / Action",
    "Bottles, bandits, and a dusty main street.",
  ],
  orbit: ["Space / Defence", "Keep the station safe, one shot at a time."],
  sniper: ["Precision / Scoped", "A long valley. Make every shot count."],
};
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
  keys = new Set(),
  muted = false,
  audioContext = null;
let pendingAction = null,
  setupKey = "",
  lastSaved = "",
  returning = false;
const captureCanvas = document.createElement("canvas");
captureCanvas.width = 640;
captureCanvas.height = 480;
const captureContext = captureCanvas.getContext("2d");
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
    } catch {
      showError(
        "Browser storage is unavailable. Your setup works now but will not be saved.",
      );
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
function showError(message) {
  // Some failures carry no message of their own; never show an empty banner.
  $("error-message").textContent =
    message || "Something went wrong. Return to the arcade and try again.";
  $("error").hidden = false;
}
function title(text) {
  return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function isCamera() {
  return selectedControl !== "mouse";
}
function selectedMode() {
  const mode = SHOOT.find((c) => c.key === selectedControl);
  return mode.key === "pistol" && selectedMap === "sniper"
    ? {
        ...mode,
        detail: "Point and fire with your hand. Close one eye to scope.",
        hint: "Warm up in Target Range. Hold an eye closed to scope; hand movement slows to one-quarter speed while scoped.",
      }
    : mode;
}
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
  const data = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 4, length)),
  );
  data.image = new Blob([new Uint8Array(bytes, 4 + length)], {
    type: "image/jpeg",
  });
  return data;
}
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
    throw new Error("Could not connect to Handy.");
  }
  if (!response.ok)
    throw new Error(data.error || "Could not connect to Handy.");
  return data;
}
function renderControls() {
  const entries = SHOOT.map((mode) =>
    mode.key === "pistol" && selectedMap === "sniper"
      ? { ...mode, detail: "Hand to aim and fire. Close one eye to scope." }
      : mode,
  );
  if (!entries.some((c) => c.key === selectedControl))
    selectedControl = entries[0].key;
  $("controls").replaceChildren();
  for (const mode of entries) {
    const button = document.createElement("button");
    button.className =
      mode.key === "mouse"
        ? "control-card secondary-control"
        : "control-card main-control";
    button.setAttribute("aria-pressed", String(mode.key === selectedControl));
    button.innerHTML = `<span class="control-icon" aria-hidden="true">${mode.icon}</span><strong>${mode.title}</strong><small>${mode.detail}</small>`;
    button.onclick = () => {
      selectedControl = mode.key;
      renderControls();
    };
    $("controls").append(button);
  }
  $("setup-hint").textContent = selectedMode().hint;
  $("start").innerHTML = isCamera()
    ? "Warm up & play <span>↗</span>"
    : "Let's play <span>↗</span>";
  $("enemy-option").hidden = selectedMap !== "zombies";
}
function selectMap(key) {
  selectedMap = key;
  for (const card of $("maps").children)
    card.setAttribute("aria-pressed", String(card.dataset.map === key));
  $("selected-name").textContent = title(
    config.maps.find((m) => m.key === key).title,
  );
  renderControls();
}
function sound(cues) {
  if (muted || !audioContext || !cues.length) return;
  const relevant = cues.find((c) => ["hit", "shot", "hurt"].includes(c));
  if (!relevant) return;
  const now = audioContext.currentTime,
    osc = audioContext.createOscillator(),
    gain = audioContext.createGain();
  osc.type = relevant === "shot" ? "sawtooth" : "sine";
  osc.frequency.setValueAtTime(
    { hit: 760, shot: 150, hurt: 90 }[relevant],
    now,
  );
  osc.frequency.exponentialRampToValueAtTime(
    relevant === "shot" ? 45 : 300,
    now + 0.12,
  );
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start();
  osc.stop(now + 0.2);
}
function drawHandGraph(hands) {
  const canvas = $("hand-graph"),
    ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const points of hands) {
    ctx.strokeStyle = "#eef0df";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const [a, b] of config.handConnections) {
      if (!points[a] || !points[b]) continue;
      ctx.beginPath();
      ctx.moveTo(points[a][0] * canvas.width, points[a][1] * canvas.height);
      ctx.lineTo(points[b][0] * canvas.width, points[b][1] * canvas.height);
      ctx.stroke();
    }
    points.forEach(([x, y], i) => {
      ctx.fillStyle = [4, 8, 12, 16, 20].includes(i) ? "#d7ef89" : "#78c850";
      ctx.beginPath();
      ctx.arc(
        x * canvas.width,
        y * canvas.height,
        i % 4 === 0 ? 8 : 5,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    });
  }
}
function stageSize() {
  // In device pixels, so the server draws the game at the resolution it is
  // shown at rather than one the browser stretches. A stage with no size yet
  // measures 0 by 0: leave it out, and the server keeps the current size.
  const rect = $("stage").getBoundingClientRect();
  const size = [rect.width, rect.height].map((side) =>
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
function focusStart() {
  // Back in the lobby, focus returns to the Start button - unless the player
  // has already put it somewhere else in the lobby.
  if (!$("lobby").contains(document.activeElement)) $("start").focus();
}
async function start() {
  if (busy) return;
  busy = true;
  // back() moves the generation on. Each wait below checks it, so a start the
  // player abandoned - by returning to the arcade while it loaded - undoes
  // itself instead of reopening the game over the lobby.
  const run = ++generation;
  const stale = () => generation !== run;
  $("start").disabled = true;
  $("error").hidden = true;
  $("start").textContent = isCamera() ? "Opening camera…" : "Starting game…";
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    if (stale()) return;
    if (isCamera()) {
      if (!navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Camera access needs localhost or HTTPS. Open the local address printed in your terminal, or choose mouse controls.",
        );
      media = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
        audio: false,
      });
      if (stale()) return;
      $("camera").srcObject = media;
      await $("camera").play();
      if (stale()) return;
      watchCamera(run);
      media.getVideoTracks()[0].addEventListener("ended", () => {
        if (active) {
          showError(
            "Your camera stopped. Return to the arcade to reconnect or choose mouse controls.",
          );
          queueAction("pause");
        }
      });
    }
    const device =
      media?.getVideoTracks()[0].getSettings().deviceId || "default";
    setupKey = `handy.setup.v1.${selectedControl}.${device}`;
    $("start").textContent = isCamera()
      ? "Preparing local tracking…"
      : "Opening the arcade…";
    // The game view opens while the server loads, since the stage must be laid
    // out to be measured. Set it up for this game first, clearing whatever the
    // last one left on the stage.
    $("game").classList.toggle("immersive", selectedControl === "pistol");
    $("stage-overlay").hidden = true;
    $("game-image").hidden = true;
    $("game-title").textContent = title(
      config.maps.find((m) => m.key === selectedMap).title,
    );
    $("game-category").textContent =
      selectedMap === "zombies"
        ? `SURVIVAL / ${$("enemy").value === "robots" ? "HUMANOID ROBOTS" : "ZOMBIES"}`
        : MAP_COPY[selectedMap][0].toUpperCase();
    $("active-control").textContent = selectedMode().title;
    $("scope-note").hidden = !(
      selectedMap === "sniper" && selectedControl === "pistol"
    );
    $("camera-preview").hidden = !isCamera();
    $("calibration-tools").hidden = !SHOOT.some(
      (c) => c.key === selectedControl && c.key !== "mouse",
    );
    $("mouse-coach").hidden = isCamera();
    $("mouse-help").textContent =
      "Move your mouse to aim. Click to fire, or tap a target." +
      (selectedMap === "sniper"
        ? " Hold right-click or Shift to use the scope."
        : "");
    $("play-instructions").textContent = isCamera()
      ? selectedMode().detail
      : "Move to aim · Click / tap to fire" +
        (selectedMap === "sniper" ? " · Right-click / Shift to scope" : "");
    $("health-wrap").hidden = selectedMap !== "zombies";
    $("lobby").hidden = true;
    $("game").hidden = false;
    window.scrollTo({ top: 0 });
    // The Start button went with the lobby: move focus to what replaced it.
    $("game-title").focus();
    const created = await request("/api/start", {
      viewSize: stageSize(),
      map: selectedMap,
      control: selectedControl,
      enemy: $("enemy").value,
      duration: Number($("duration").value),
      calibration: storage.get(setupKey),
    });
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
    renderState(session);
    loop(run);
  } catch (error) {
    if (stale()) return; // back() has already restored the lobby
    $("game").hidden = true;
    $("lobby").hidden = false;
    stopCamera();
    const messages = {
      NotAllowedError:
        "Camera permission was denied. Allow it in your browser, or choose Mouse & touch to play now.",
      NotFoundError: "No camera found. Connect one, or choose Mouse & touch.",
      NotReadableError:
        "The camera is busy. Close other camera apps and try again, or use mouse controls.",
    };
    showError(messages[error.name] || error.message);
  } finally {
    // An abandoned start may have opened the camera after back() closed it.
    if (stale()) stopCamera();
    busy = false;
    $("start").disabled = false;
    renderControls();
    if (!$("lobby").hidden) focusStart();
  }
}
// Camera frames are mirrored and encoded on a worker thread where the browser
// allows it (capture.js). On the page's own thread toBlob waits for the page to
// fall idle, which a busy or background tab may not do for a whole second.
let encoder = null,
  encoded = null;
try {
  if (window.OffscreenCanvas) {
    encoder = new Worker("/capture.js");
    encoder.onmessage = ({ data }) => encoded?.(data);
    encoder.onerror = () => {
      encoder = null;
      encoded?.(null);
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
    const frame = await createImageBitmap(video, x, y, width, height);
    return new Promise((resolve) => {
      encoded = resolve;
      encoder.postMessage(frame, [frame]);
    });
  }
  // Mirror exactly once, matching the preview and the native control conventions.
  captureContext.save();
  captureContext.translate(640, 0);
  captureContext.scale(-1, 1);
  captureContext.drawImage(video, x, y, width, height, 0, 0, 640, 480);
  captureContext.restore();
  return new Promise((resolve) =>
    captureCanvas.toBlob(resolve, "image/jpeg", 0.7),
  );
}
const view = $("game-image").getContext("2d", { alpha: false });
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
          view.drawImage(bitmap, 0, 0);
          canvas.hidden = false;
        }
        bitmap.close();
      },
      () => {}, // a frame that will not decode is skipped, not fatal
    );
}
function setText(id, text) {
  // Most of what renderState writes repeats every frame. Rewriting it anyway
  // makes live regions announce it again, some 30 times a second.
  const element = $(id);
  text = String(text);
  if (element.textContent !== text) element.textContent = text;
}
function renderState(data) {
  currentState = data.state;
  setText("score", data.score);
  setText("time", Math.ceil(data.remaining));
  setText("accuracy", `${data.accuracy ?? 0}%`);
  setText("health", data.health ?? 100);
  setText("notice", data.notice);
  setText(
    "tracking-label",
    data.tracking
      ? data.scopeTracked === false
        ? "Hand tracked · show your face for the scope"
        : "Tracking you"
      : "Move into view · light your hand / face",
  );
  $("tracking-light").classList.toggle("live", !!data.tracking);
  $("calibration-coach").hidden = data.state !== "calibration";
  setText("pause", data.state === "paused" ? "Resume (P)" : "Pause (P)");
  $("pause").disabled = data.state === "over";
  $("recalibrate").disabled = data.state === "calibration";
  $("game").classList.toggle(
    "calibrating",
    data.state === "calibration" || (data.state === "paused" && !!data.step),
  );

  const warmingUp =
    data.state === "calibration" || (data.state === "paused" && !!data.step);
  setText(
    "game-title",
    warmingUp
      ? "Target Range"
      : title(config.maps.find((m) => m.key === selectedMap).title),
  );
  setText(
    "game-category",
    warmingUp
      ? `WARM-UP → ${title(config.maps.find((m) => m.key === selectedMap).title)}`
      : MAP_COPY[selectedMap][0].toUpperCase(),
  );
  if (data.step) {
    const step = data.step;
    setText(
      "step-count",
      step.testing
        ? `${step.hits} / 5 ACCURATE HITS`
        : `LEARNING YOUR AIM · ${step.learningShots} / 3 SHOTS`,
    );
    setText(
      "step-title",
      step.testing ? "Five centre hits to start." : "Welcome to Target Range.",
    );
    setText(
      "step-detail",
      data.notice || "Point naturally at the target and fold your thumb.",
    );
    setText(
      "trigger-status",
      !data.tracking
        ? "Show your hand to the camera"
        : step.armed
          ? "Thumb up · ready to shoot"
          : "Raise your thumb for the next shot",
    );
    $("undo-shot").disabled = step.shots === 0 && step.hits === 0;
    $("aim-hits").value = step.hits;
  }
  if (data.hands) drawHandGraph(data.hands);
  if (data.calibration) {
    const encoded = JSON.stringify(data.calibration);
    if (encoded !== lastSaved) {
      storage.set(setupKey, data.calibration);
      lastSaved = encoded;
    }
  }
  const overlay = ["paused", "over"].includes(data.state);
  $("stage-overlay").hidden = !overlay;
  if (overlay) {
    setText(
      "overlay-title",
      data.state === "paused" ? "Take a breather." : "Round complete.",
    );
    setText(
      "overlay-copy",
      data.state === "paused"
        ? "Your game is paused. Pick up where you left off."
        : data.result,
    );
    setText(
      "overlay-action",
      data.state === "paused" ? "Resume playing" : "Play again ↗",
    );
    if (data.state === "over") {
      const key = `handy.best.${selectedMap}.${selectedControl}.${$("enemy").value}.${$("duration").value}`;
      if (
        typeof data.score === "number" &&
        data.score > (storage.get(key) || 0)
      )
        storage.set(key, data.score);
    }
  }
  redrawCrosshair(); // shown only while a round is being played
}
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
  if (pendingAction || (camera && cameraFrames !== sentFrame))
    return Promise.resolve();
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
        showError(error.message);
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
      sound(data.cues);
    } catch (error) {
      if (generation !== run) return;
      active = false;
      stopCamera();
      showError(error.message + " Use “Arcade” to start again.");
      $("stage-overlay").hidden = false;
      $("overlay-title").textContent = "Connection interrupted";
      $("overlay-copy").textContent =
        "Keep the Handy terminal running, then return to the arcade.";
      $("overlay-action").textContent = "Back to arcade";
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
  // A start still loading stops its own session when it arrives; Start stays
  // disabled until then, so the two cannot overlap.
  if (busy) $("start").textContent = "Cancelling…";
  try {
    if (session) await request("/api/stop", { id: session.id });
  } catch {
    /* The lobby remains usable if the server stopped. */
  }
  session = null;
  $("game").hidden = true;
  $("lobby").hidden = false;
  returning = false;
  focusStart();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function frameBox() {
  // Where the frame shows within its element. object-fit can letterbox one
  // of another shape: a round keeps its size when the stage is resized.
  const canvas = $("game-image"),
    rect = canvas.getBoundingClientRect();
  if (getComputedStyle(canvas).objectFit !== "contain") return rect;
  const scale = Math.min(
    rect.width / canvas.width,
    rect.height / canvas.height,
  );
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
// the size the server would draw it. A hand's crosshair stays in the frame:
// only the server knows where its filtered aim lands.
const RECOIL = 180; // ms, scene.RECOIL
let firedAt = -Infinity,
  crosshairFrame = 0;
function redrawCrosshair() {
  crosshairFrame ||= requestAnimationFrame(drawCrosshair);
}
function drawCrosshair() {
  crosshairFrame = 0;
  const overlay = $("crosshair"),
    area = overlay.getBoundingClientRect(),
    ratio = devicePixelRatio;
  const [width, height] = [area.width, area.height].map((side) =>
    Math.round(side * ratio),
  );
  if (overlay.width !== width || overlay.height !== height)
    [overlay.width, overlay.height] = [width, height];
  const context = overlay.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  const aiming =
    active &&
    selectedControl === "mouse" &&
    currentState === "playing" &&
    !$("game-image").hidden &&
    !(selectedMap === "sniper" && (scoped || keys.has("Shift")));
  $("stage").classList.toggle("aiming", aiming);
  if (!aiming) return;
  const box = frameBox();
  // Centred on a pixel, as OpenCV centres its shapes.
  const x = Math.floor((box.left - area.left + pointer.x * box.width) * ratio),
    y = Math.floor((box.top - area.top + pointer.y * box.height) * ratio);
  context.setTransform(1, 0, 0, 1, 0.5, 0.5);
  // The server's 0.75 on a 960-wide frame, grown with the frame as shown.
  const scale =
    0.75 * Math.max((box.width * ratio) / 960, (box.height * ratio) / 900);
  const size = (value) => Math.max(1, Math.round(value * scale));
  // OpenCV's anti-aliased stroke of thickness t comes out about 2t - 0.5
  // pixels wide (1.35 for t = 1), and a filled dot half a pixel wider.
  const stroke = (thickness) =>
    thickness === 1 ? 1.35 : 2 * thickness - 0.55;
  const weight = stroke(size(2)),
    radius = Math.round(20 * scale),
    ring = (r, from, to) => {
      context.beginPath();
      context.arc(x, y, r, (from * Math.PI) / 180, (to * Math.PI) / 180);
      context.stroke();
    };
  context.strokeStyle = context.fillStyle = "rgb(130, 230, 120)"; // scene.ARMED
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
  if (!active || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))
    return;
  if (event.code === "Space" && event.target.tagName === "BUTTON") return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key))
    event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  redrawCrosshair(); // Shift scopes the rifle, which hides the crosshair
  if (key === "p" || key === "Escape")
    queueAction(currentState === "paused" ? "resume" : "pause");
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
  if (active && !["paused", "over"].includes(currentState))
    queueAction("pause");
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
$("start").onclick = start;
$("back").onclick = back;
$("undo-shot").onclick = () => queueAction("undo");
$("reset-aim").onclick = () => queueAction("reset");
$("recalibrate").onclick = () => queueAction("calibrate");

$("pause").onclick = () =>
  queueAction(currentState === "paused" ? "resume" : "pause");
$("overlay-action").onclick = () =>
  active ? queueAction(currentState === "paused" ? "resume" : "play") : back();
$("sound").onclick = () => {
  muted = !muted;
  $("sound").textContent = muted ? "Sound off" : "Sound on";
  $("sound").setAttribute("aria-pressed", String(muted));
};
$("fullscreen").onclick = () => {
  const promise = document.fullscreenElement
    ? document.exitFullscreen()
    : $("game").requestFullscreen?.();
  promise?.catch(() =>
    showError(
      "Full screen is unavailable. You can continue playing in this tab.",
    ),
  );
};
$("dismiss-error").onclick = () => {
  $("error").hidden = true;
};
$("privacy").onclick = (event) => {
  event.preventDefault();
  $("privacy-dialog").showModal();
};
$("close-privacy").onclick = () => $("privacy-dialog").close();
async function init() {
  try {
    const response = await fetch("/api/config");
    if (!response.ok) throw new Error("Could not connect to the local game.");
    config = await response.json();
    token = config.token;
    config.maps.forEach((map, index) => {
      const card = document.createElement("button");
      card.className = "map-card";
      card.dataset.map = map.key;
      card.setAttribute("aria-pressed", "false");
      const [tag, description] = MAP_COPY[map.key];
      card.innerHTML = `<div class="map-art"><img src="/art/${map.key}" alt="" loading="lazy"><span class="map-number">0${index + 1}</span><span class="selected-mark" aria-hidden="true">✓</span></div><div class="map-info"><span class="map-tag">${tag}</span><h3>${title(map.title)}</h3><p>${description}</p></div>`;
      card.onclick = () => selectMap(map.key);
      $("maps").append(card);
    });
    selectMap("zombies");
  } catch (error) {
    showError(error.message + " Start the local server and reload this page.");
    $("start").disabled = true;
  }
}
init();
