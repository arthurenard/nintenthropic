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
  touchKeys = new Set(),
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
};
function showError(message) {
  $("error-message").textContent = message;
  $("error").hidden = false;
}
function title(text) {
  return text.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
function isCamera() {
  return !["mouse", "keyboard"].includes(selectedControl);
}
function isDrive() {
  return false;
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
async function request(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Handy-Token": token },
    body: JSON.stringify(body),
  });
  const data = await response.json();
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
  $("control-count").textContent = isDrive()
    ? "Keyboard or camera wheel"
    : "Mouse or hand controls";
  $("setup-hint").textContent = selectedMode().hint;
  $("start").innerHTML = isCamera()
    ? "Warm up & play <span>↗</span>"
    : "Let's play <span>↗</span>";
  $("enemy-option").hidden = selectedMap !== "zombies";
  $("duration-option").hidden = isDrive();
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
  const relevant = cues.find((c) =>
    [
      "hit",
      "shot",
      "hurt",
      "race_go",
      "countdown_beep",
      "lap_chime",
      "race_finish",
    ].includes(c),
  );
  if (!relevant) return;
  const now = audioContext.currentTime,
    osc = audioContext.createOscillator(),
    gain = audioContext.createGain();
  osc.type = relevant === "shot" ? "sawtooth" : "sine";
  osc.frequency.setValueAtTime(
    {
      hit: 760,
      shot: 150,
      hurt: 90,
      race_go: 880,
      countdown_beep: 440,
      lap_chime: 1046,
      race_finish: 1318,
    }[relevant],
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
function stageAspect() {
  // A stage with no size yet measures 0 by 0. Leave its shape out rather than
  // send NaN, which JSON turns into null; the server keeps the current shape.
  const rect = $("stage").getBoundingClientRect();
  const aspect = rect.width / rect.height;
  return Number.isFinite(aspect) && aspect > 0 ? aspect : undefined;
}
function stopCamera() {
  if (media) media.getTracks().forEach((track) => track.stop());
  media = null;
  $("camera").srcObject = null;
  drawHandGraph([]);
}
async function start() {
  if (busy) return;
  busy = true;
  $("start").disabled = true;
  $("error").hidden = true;
  $("start").textContent = isCamera() ? "Opening camera…" : "Starting game…";
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
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
      $("camera").srcObject = media;
      await $("camera").play();
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
    $("lobby").hidden = true;
    $("game").hidden = false;
    $("game").classList.toggle("immersive", selectedControl === "pistol");
    session = await request("/api/start", {
      viewAspect: stageAspect(),
      map: selectedMap,
      control: selectedControl,
      enemy: $("enemy").value,
      duration: Number($("duration").value),
      calibration: storage.get(setupKey),
    });
    $("lobby").hidden = true;
    $("game").hidden = false;
    $("game").classList.toggle("immersive", selectedControl === "pistol");
    $("game-image").hidden = true;
    $("score-label").textContent = isDrive() ? "Position" : "Score";
    $("time-label").textContent = isDrive() ? "Race" : "Time";
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
    $("touch-drive").hidden = selectedControl !== "keyboard";
    $("mouse-help").textContent = isDrive()
      ? "Hold ↑ or W to accelerate, ← → or A D to steer, and ↓ or S to brake. Touch buttons work too."
      : "Move your mouse to aim. Click to fire, or tap a target." +
        (selectedMap === "sniper"
          ? " Hold right-click or Shift to use the scope."
          : "");
    $("play-instructions").textContent = isDrive()
      ? isCamera()
        ? "Hold two hands level · Tilt to steer · Open palms to brake"
        : "↑ / W accelerate · ← → / A D steer · ↓ / S brake"
      : isCamera()
        ? selectedMode().detail
        : "Move to aim · Click / tap to fire" +
          (selectedMap === "sniper" ? " · Right-click / Shift to scope" : "");
    $("health-wrap").hidden = selectedMap !== "zombies";
    $("accuracy-wrap").hidden = isDrive();
    active = true;
    currentState = "";
    keys.clear();
    touchKeys.clear();
    fire = false;
    scoped = false;
    lastSaved = "";
    renderState(session);
    window.scrollTo({ top: 0 });
    generation++;
    loop(generation);
  } catch (error) {
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
    busy = false;
    $("start").disabled = false;
    renderControls();
  }
}
function cameraFrame() {
  if (!media || $("camera").readyState < 2) return null;
  // Mirror exactly once, matching the preview and the native control conventions.
  captureContext.save();
  captureContext.translate(640, 0);
  captureContext.scale(-1, 1);
  captureContext.drawImage($("camera"), 0, 0, 640, 480);
  captureContext.restore();
  return captureCanvas.toDataURL("image/jpeg", 0.7).split(",")[1];
}
function renderState(data) {
  currentState = data.state;
  $("score").textContent = data.score;
  $("time").textContent =
    data.remaining === null ? "3 laps" : Math.ceil(data.remaining);
  $("accuracy").textContent = `${data.accuracy ?? 0}%`;
  $("health").textContent = data.health ?? 100;
  $("notice").textContent =
    data.notice ||
    (selectedControl === "wheel"
      ? "Hold both hands up like a steering wheel. Keep it level through the three-light countdown."
      : "");
  $("tracking-label").textContent = data.tracking
    ? data.scopeTracked === false
      ? "Hand tracked · show your face for the scope"
      : "Tracking you"
    : "Move into view · light your hand / face";
  $("tracking-light").classList.toggle("live", !!data.tracking);
  $("calibration-coach").hidden = data.state !== "calibration";
  $("practice-coach").hidden = data.state !== "practice";
  $("pause").textContent = data.state === "paused" ? "Resume (P)" : "Pause (P)";
  $("pause").disabled = data.state === "over";
  $("recalibrate").disabled = data.state === "calibration";
  $("game").classList.toggle(
    "calibrating",
    data.state === "calibration" || (data.state === "paused" && !!data.step),
  );

  const warmingUp =
    data.state === "calibration" || (data.state === "paused" && !!data.step);
  $("game-title").textContent = warmingUp
    ? "Target Range"
    : title(config.maps.find((m) => m.key === selectedMap).title);
  $("game-category").textContent = warmingUp
    ? `WARM-UP → ${title(config.maps.find((m) => m.key === selectedMap).title)}`
    : MAP_COPY[selectedMap][0].toUpperCase();
  if (data.step) {
    const step = data.step;
    $("step-count").textContent = step.testing
      ? `${step.hits} / 5 ACCURATE HITS`
      : `LEARNING YOUR AIM · ${step.learningShots} / 3 SHOTS`;
    $("step-title").textContent = step.testing
      ? "Five centre hits to start."
      : "Welcome to Target Range.";
    $("step-detail").textContent =
      data.notice || "Point naturally at the target and fold your thumb.";
    $("trigger-status").textContent = !data.tracking
      ? "Show your hand to the camera"
      : step.armed
        ? "Thumb up · ready to shoot"
        : "Raise your thumb for the next shot";
    $("undo-shot").disabled = step.shots === 0 && step.hits === 0;
    $("aim-hits").value = step.hits;
  }
  if (data.hands) drawHandGraph(data.hands);
  $("practice-score").textContent = `${data.practiceHits} / 3 targets`;
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
    $("overlay-title").textContent =
      data.state === "paused" ? "Take a breather." : "Round complete.";
    $("overlay-copy").textContent =
      data.state === "paused"
        ? "Your game is paused. Pick up where you left off."
        : data.result;
    $("overlay-action").textContent =
      data.state === "paused" ? "Resume playing" : "Play again ↗";
    if (data.state === "over") {
      const key = `handy.best.${selectedMap}.${selectedControl}.${$("enemy").value}.${$("duration").value}`;
      if (
        typeof data.score === "number" &&
        data.score > (storage.get(key) || 0)
      )
        storage.set(key, data.score);
    }
  }
}
function queueAction(action, extra = {}) {
  if (!active || pendingAction) return;
  pendingAction = { action, ...extra };
  keys.clear();
  touchKeys.clear();
  fire = false;
}
async function loop(run) {
  while (active && generation === run) {
    const started = performance.now();
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
      const shot = fire;
      fire = false;
      const down = (...codes) =>
        codes.some((c) => keys.has(c) || touchKeys.has(c));
      const data = await request("/api/frame", {
        viewAspect: stageAspect(),
        id: session.id,
        ...pointer,
        fire: shot,
        scope: scoped || keys.has("Shift"),
        steer:
          Number(down("ArrowRight", "d", "right")) -
          Number(down("ArrowLeft", "a", "left")),
        throttle: Number(down("ArrowUp", "w", "go")),
        brake: down("ArrowDown", "s", "brake"),
        camera: currentState === "paused" ? null : cameraFrame(),
      });
      if (generation !== run || !active) return;
      $("game-image").src = "data:image/jpeg;base64," + data.image;
      $("game-image").hidden = false;
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
    await new Promise((resolve) =>
      setTimeout(resolve, Math.max(0, 33 - (performance.now() - started))),
    );
  }
}
async function back() {
  if (returning) return;
  returning = true;
  active = false;
  generation++;
  pendingAction = null;
  keys.clear();
  touchKeys.clear();
  fire = false;
  stopCamera();
  try {
    if (session) await request("/api/stop", { id: session.id });
  } catch {
    /* The lobby remains usable if the server stopped. */
  }
  session = null;
  $("game").hidden = true;
  $("lobby").hidden = false;
  returning = false;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function point(event) {
  const rect = $("game-image").getBoundingClientRect();
  pointer = {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
  };
}
$("game-image").addEventListener("pointermove", point);
$("game-image").addEventListener("pointerdown", (event) => {
  point(event);
  if (event.button === 2) scoped = true;
  else if (selectedControl === "mouse") fire = true;
  event.preventDefault();
});
$("stage").addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("pointerup", () => {
  scoped = false;
});
window.addEventListener("pointercancel", () => {
  scoped = false;
});
for (const button of document.querySelectorAll("[data-drive]")) {
  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    touchKeys.add(button.dataset.drive);
  });
  button.addEventListener("pointerup", () =>
    touchKeys.delete(button.dataset.drive),
  );
  button.addEventListener("lostpointercapture", () =>
    touchKeys.delete(button.dataset.drive),
  );
}
window.addEventListener("keydown", (event) => {
  if (!active || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName))
    return;
  if (event.code === "Space" && event.target.tagName === "BUTTON") return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(key))
    event.preventDefault();
  keys.add(key);
  if (event.repeat) return;
  if (key === "p" || key === "Escape")
    queueAction(currentState === "paused" ? "resume" : "pause");
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key),
);
function blur() {
  keys.clear();
  touchKeys.clear();
  scoped = false;
  fire = false;
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
$("play-now").onclick = () => queueAction("play");
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
