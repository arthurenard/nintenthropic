/**
 * A hand-driven check of the room (dev.html): host or join by code over
 * PeerJS (or between tabs with `?net=local`), see the lobby as JSON, the round
 * trip, the race as a top-down map, and the events as they arrive. It runs
 * the real sim, so what it shows is what the game's screens would get.
 */
import {
  IDLE_INPUT,
  type DriveInput,
  type DriverControl,
  type LocalPlayerSetup,
  type RaceEvent,
  type RaceView,
  type Session,
} from "../contract";
import { createRace } from "../sim/race";
import { TrackGeometry } from "../track/geometry";
import { parseCode, joinCodeFrom } from "./codes";
import { hostSession, joinSession, soloSession } from "./index";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

$("note").textContent = `Network: ${
  new URLSearchParams(location.search).get("net") === "local" ? "BroadcastChannel (this browser)" : "PeerJS"
}.`;

// ─── Keys ──────────────────────────────────────────────────────────────────

const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "INPUT") return;
  keys.add(e.code);
  if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => keys.clear());

interface KeyMap {
  left: string[];
  right: string[];
  brake: string[];
  drift: string[];
  item: string[];
}

function keyboard(map: KeyMap): DriverControl {
  let presses = 0;
  let itemHeld = false;
  const down = (codes: string[]) => codes.some((c) => keys.has(c));
  return {
    kind: "keyboard",
    wheel: null,
    sample(): DriveInput {
      const item = down(map.item);
      if (item && !itemHeld) presses++;
      itemHeld = item;
      return {
        ...IDLE_INPUT,
        steer: (down(map.right) ? 1 : 0) - (down(map.left) ? 1 : 0),
        // Like the wheel, the throttle is on until the brake is down.
        throttle: down(map.brake) ? 0 : 1,
        brake: down(map.brake) ? 1 : 0,
        drift: down(map.drift),
        itemPresses: presses,
      };
    },
    dispose() {},
  };
}

const FIRST: KeyMap = { left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], brake: ["ArrowDown", "KeyS"], drift: ["Space"], item: ["KeyE"] };
const SECOND: KeyMap = { left: ["KeyJ"], right: ["KeyL"], brake: ["KeyK"], drift: ["KeyU"], item: ["KeyO"] };

function players(): LocalPlayerSetup[] {
  const name = $<HTMLInputElement>("name").value || "Dev";
  const screen = $<HTMLSelectElement>("screen").value as "here" | "host";
  const out: LocalPlayerSetup[] = [{ name, control: keyboard(FIRST), screen }];
  if ($<HTMLInputElement>("two").checked) out.push({ name: `${name} 2`, control: keyboard(SECOND), screen });
  return out;
}

// ─── The session ───────────────────────────────────────────────────────────

let session: Session | null = null;
let closed: string | null = null;
let lastView: RaceView | null = null;
const log: string[] = [];
let geometry: { id: string; g: TrackGeometry } | null = null;

function attach(next: Session): void {
  session?.leave();
  session = next;
  closed = null;
  lastView = null;
  log.length = 0;
  next.onClosed((reason) => {
    closed = reason;
  });
  next.setLocalPlayers(players());
}

function options() {
  return { createRace, players: ($<HTMLInputElement>("two").checked ? 2 : 1) as 1 | 2 };
}

$("host").onclick = () => attach(hostSession(options()));
$("solo").onclick = () => attach(soloSession(options()));
$("join").onclick = () => {
  const code = parseCode($<HTMLInputElement>("code").value);
  if (!code) return void ($("status").textContent = "That is not a room code (four letters).");
  attach(joinSession(code, options()));
};
$("ready").onclick = () => session?.setReady(true);
$("leave").onclick = () => {
  session?.leave();
};
$("start").onclick = () => {
  session?.configure({
    laps: Number($<HTMLInputElement>("laps").value),
    racers: Number($<HTMLInputElement>("racers").value),
    bots: $<HTMLInputElement>("bots").checked,
  });
  session?.start();
};
$("back").onclick = () => session?.backToLobby();
$<HTMLInputElement>("name").onchange = () => session?.setLocalPlayers(players());
$<HTMLInputElement>("screen").onchange = () => session?.setLocalPlayers(players());

const autojoin = joinCodeFrom(location.search);
if (autojoin) {
  $<HTMLInputElement>("code").value = autojoin;
  $("join").click();
}

// ─── The picture ───────────────────────────────────────────────────────────

const canvas = $<HTMLCanvasElement>("map");
const ctx = canvas.getContext("2d")!;

function draw(view: RaceView | null): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!view) return;
  if (!geometry || geometry.id !== view.track.id) geometry = { id: view.track.id, g: TrackGeometry.build(view.track, 4) };
  const samples = geometry.g.samples;
  let [x0, x1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const s of samples) [x0, x1, z0, z1] = [Math.min(x0, s.x), Math.max(x1, s.x), Math.min(z0, s.z), Math.max(z1, s.z)];
  const pad = 30;
  const scale = Math.min((canvas.width - 2 * pad) / (x1 - x0), (canvas.height - 2 * pad) / (z1 - z0));
  const px = (x: number) => pad + (x - x0) * scale;
  const pz = (z: number) => canvas.height - pad - (z - z0) * scale;
  ctx.strokeStyle = "#48484a";
  ctx.lineWidth = Math.max(4, view.track.width * scale);
  ctx.lineJoin = "round";
  ctx.beginPath();
  samples.forEach((s, i) => (i === 0 ? ctx.moveTo(px(s.x), pz(s.z)) : ctx.lineTo(px(s.x), pz(s.z))));
  ctx.closePath();
  ctx.stroke();
  const mine = new Set(session?.views() ?? []);
  for (const kart of view.karts) {
    const racer = view.racers.find((r) => r.id === kart.id);
    ctx.fillStyle = racer?.colour ?? "#fff";
    ctx.beginPath();
    ctx.arc(px(kart.x), pz(kart.z), mine.has(kart.id) ? 7 : racer?.player === null ? 4 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (mine.has(kart.id)) {
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    // The way it faces.
    ctx.strokeStyle = racer?.colour ?? "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px(kart.x), pz(kart.z));
    ctx.lineTo(px(kart.x + Math.sin(kart.heading) * 6), pz(kart.z + Math.cos(kart.heading) * 6));
    ctx.stroke();
  }
}

function describe(event: RaceEvent): string {
  return `#${event.id} t${event.tick} ${event.type}`;
}

function tick(now: number): void {
  requestAnimationFrame(tick);
  if (!session) return;
  const view = session.frame(now);
  if (view) {
    lastView = view;
    for (const event of view.events) log.push(describe(event));
    if (log.length > 40) log.splice(0, log.length - 40);
  }
  const lobby = session.lobby();
  if (lobby.phase !== "racing") lastView = null;
  const link = session.link;
  $("status").textContent =
    `${session.role} ${session.device} | code ${lobby.code ?? "-"} | ${lobby.phase} | ` +
    `${link.connected ? "connected" : "not connected"} | rtt ${link.rtt === null ? "-" : `${link.rtt.toFixed(0)} ms`} | ` +
    `${link.players} players${closed ? ` | CLOSED: ${closed}` : ""}`;
  $("lobby").textContent = JSON.stringify(lobby, null, 1);
  $("events").textContent = log.slice(-12).join("\n");
  $("view").textContent = lastView
    ? `tick ${lastView.tick} ${lastView.phase} time ${lastView.time.toFixed(2)} cd ${lastView.countdown.toFixed(2)}\n` +
      `my karts: ${JSON.stringify(session.views())}\n` +
      lastView.karts
        .map(
          (k) =>
            `${String(k.id).padStart(2)} ${(lastView!.racers[k.id]?.name ?? "").padEnd(10)} place ${k.place} lap ${k.lap} ` +
            `x ${k.x.toFixed(1)} z ${k.z.toFixed(1)} v ${k.speed.toFixed(1)}`,
        )
        .join("\n")
    : "no race";
  draw(lastView);
}
requestAnimationFrame(tick);
