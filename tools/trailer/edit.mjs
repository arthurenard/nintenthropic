/**
 * The trailer's edit: lays the clips, cards and titles on the 120 BPM grid
 * (edl.mjs), shifts the games' sounds to where their pictures land, mixes them
 * with the music (mix/mix.mjs), and encodes the film for X.
 *
 *   node tools/trailer/edit.mjs              # picture + sound + encode
 *   node tools/trailer/edit.mjs --picture    # just the picture (a silent mp4), for looking
 *   node tools/trailer/edit.mjs --events     # just write the game-sound events at trailer times
 *   node tools/trailer/edit.mjs --picture --until 22   # only the first 22 s, while later clips are missing
 *
 * The picture is built as three frame tracks of symlinks (base, titles, flash)
 * so that every output frame is exactly one source frame: no resampling, no
 * drift, every cut on the frame of its beat. ffmpeg stacks the tracks, adds a
 * short zoom punch on each drop, converts to BT.709 and encodes.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CUTS as ALL_CUTS, FLASHES, FPS, PUNCHES, TITLES, TOTAL as FULL } from "./edl.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "out");
const EDIT = resolve(OUT, "edit");
const FFMPEG = existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "ffmpeg";
const W = 1920;
const H = 1080;
const argv = process.argv.slice(2);
const args = new Set(argv);
const until = argv.includes("--until") ? Number(argv[argv.indexOf("--until") + 1]) : null;
const TOTAL = until ?? FULL;
const CUTS = ALL_CUTS.filter((cut) => cut.at < TOTAL).map((cut) => ({ ...cut, dur: Math.min(cut.dur, TOTAL - cut.at) }));
const FRAMES = Math.round(TOTAL * FPS);

function ffmpeg(argv) {
  const r = spawnSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...argv], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr}`);
  return r.stderr;
}

const pad = (n) => String(n).padStart(5, "0");

/** A clip's or a card's manifest entry, and where its frames are. */
function source(cut) {
  if (cut.card) {
    const cards = JSON.parse(readFileSync(resolve(OUT, "cards/cards.json"), "utf8"));
    const entry = cards.find((c) => c.id === cut.card);
    if (!entry) throw new Error(`no card ${cut.card}`);
    return { dir: resolve(OUT, "cards", cut.card), frames: entry.frames, moments: [], events: [] };
  }
  for (const manifest of ["clips/shooters.json", "clips/race.json"]) {
    const file = resolve(OUT, manifest);
    if (!existsSync(file)) continue;
    const entry = JSON.parse(readFileSync(file, "utf8")).find((c) => c.id === cut.clip);
    if (!entry) continue;
    const dir = resolve(OUT, "clips", cut.clip);
    const eventsFile = resolve(dir, "events.json");
    return { dir, frames: entry.frames, moments: entry.moments ?? [], events: existsSync(eventsFile) ? JSON.parse(readFileSync(eventsFile, "utf8")) : [] };
  }
  throw new Error(`no clip ${cut.clip}`);
}

/**
 * Where a cut enters its source, in seconds: given outright (`in`), or chosen so that one
 * of the clip's moments lands on a beat of the slot (`align: { moment, at }`, `at` in
 * seconds after the cut). Kept inside the source.
 */
function inPoint(cut, src) {
  let t = cut.in ?? 0;
  if (cut.align) {
    const moment = src.moments[cut.align.moment];
    if (!moment) throw new Error(`${cut.clip}: no moment ${cut.align.moment}`);
    t = moment.t - cut.align.at;
  }
  const max = src.frames / FPS - cut.dur;
  if (max < -1e-6) throw new Error(`${cut.clip ?? cut.card}: ${src.frames} frames are shorter than its ${cut.dur} s slot`);
  return Math.min(Math.max(0, t), Math.max(0, max));
}

function link(track, frame, target) {
  symlinkSync(target, resolve(EDIT, track, `${pad(frame + 1)}.png`));
}

/** White frames at 21 opacities, for the flash track. */
function whites() {
  const dir = resolve(EDIT, "white");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i <= 20; i++) {
    const file = resolve(dir, `${i}.png`);
    if (!existsSync(file)) ffmpeg(["-f", "lavfi", "-i", `color=c=white@${(i / 20).toFixed(2)}:s=${W}x${H},format=rgba`, "-frames:v", "1", file]);
  }
  return dir;
}

function picture() {
  for (const track of ["base", "titles", "flash"]) {
    rmSync(resolve(EDIT, track), { recursive: true, force: true });
    mkdirSync(resolve(EDIT, track), { recursive: true });
  }
  const white = whites();
  const blank = resolve(white, "0.png");
  const placed = [];
  // The base: every frame is exactly one frame of a clip or a card.
  for (const cut of CUTS) {
    const src = source(cut);
    const enter = inPoint(cut, src);
    placed.push({ ...cut, enter, src });
    const from = Math.round(cut.at * FPS);
    const n = Math.round(cut.dur * FPS);
    const first = Math.round(enter * FPS);
    for (let k = 0; k < n; k++) {
      const f = Math.min(first + k, src.frames - 1);
      link("base", from + k, resolve(src.dir, `${pad(f + 1)}.png`));
    }
  }
  for (let f = 0; f < FRAMES; f++) if (!existsSync(resolve(EDIT, "base", `${pad(f + 1)}.png`))) throw new Error(`frame ${f} has no picture`);
  // The titles, with alpha; transparent between them.
  const titleAt = new Map();
  for (const title of TITLES) {
    const src = source({ card: title.card });
    const from = Math.round(title.at * FPS);
    for (let k = 0; k < src.frames && from + k < FRAMES; k++) titleAt.set(from + k, resolve(src.dir, `${pad(k + 1)}.png`));
  }
  // The flashes: white, falling off quickly (a squared ease).
  const flashAt = new Map();
  for (const flash of FLASHES) {
    const from = Math.round(flash.at * FPS);
    for (let k = 0; k < flash.frames; k++) {
      const level = Math.round((flash.peak ?? 1) * Math.pow(1 - k / flash.frames, 2) * 20);
      flashAt.set(from + k, Math.max(flashAt.get(from + k) ?? 0, level));
    }
  }
  for (let f = 0; f < FRAMES; f++) {
    link("titles", f, titleAt.get(f) ?? blank);
    link("flash", f, resolve(white, `${flashAt.get(f) ?? 0}.png`));
  }
  writeFileSync(resolve(EDIT, "placed.json"), JSON.stringify(placed.map(({ src, ...p }) => p), null, 1));
  return placed;
}

/** The games' sounds, moved to where their pictures land; loops already running at an in-point start with the cut, and every loop stops at its cut's end. */
function events(placed) {
  const out = [];
  let id = 0;
  for (const cut of placed) {
    if (!cut.clip || cut.mute) continue;
    const begin = cut.enter;
    const end = cut.enter + cut.dur;
    const open = new Map();
    for (const e of cut.src.events) {
      if (e.t >= end) break;
      if (e.type === "loop") open.set(e.id, { ...e, newId: ++id });
      if (e.type === "stop") {
        const loop = open.get(e.id);
        open.delete(e.id);
        if (loop && loop.t >= begin && e.t >= begin) out.push({ t: cut.at + (e.t - begin), type: "stop", id: loop.newId });
        continue;
      }
      if (e.t < begin) continue;
      const t = cut.at + (e.t - begin);
      if (e.type === "loop") out.push({ ...e, t, id: open.get(e.id).newId });
      else out.push({ ...e, t });
    }
    for (const loop of open.values()) {
      if (loop.t < begin) out.push({ ...loop, t: cut.at, id: loop.newId });
      out.push({ t: cut.at + cut.dur, type: "stop", id: loop.newId });
    }
  }
  out.sort((a, b) => a.t - b.t);
  for (const e of out) delete e.newId;
  // Grip Prix brings its race's own sound as one rendered WAV per clip: a slice of it goes under each cut.
  const stems = placed
    .filter((cut) => cut.clip && !cut.mute && existsSync(resolve(cut.src.dir, "race.wav")))
    .map((cut) => ({ file: resolve(cut.src.dir, "race.wav"), at: cut.at, in: cut.enter, dur: cut.dur, gain: cut.gain ?? 0, fade: 0.01 }));
  mkdirSync(resolve(OUT, "mix"), { recursive: true });
  writeFileSync(resolve(OUT, "mix/events.json"), JSON.stringify(out, null, 1));
  writeFileSync(resolve(OUT, "mix/stems.json"), JSON.stringify(stems, null, 1));
  console.log(`[events] ${out.length} game sounds and ${stems.length} race slices at trailer times -> out/mix/`);
  return out;
}

/** The zoom punch: a short push-in that relaxes, on each drop. */
function punchExpr() {
  const terms = PUNCHES.map((p) => `${p.amount}*gte(t,${p.at})*exp(-(t-${p.at})/${p.decay})`);
  return terms.length ? `1+${terms.join("+")}` : "1";
}

function encode({ audio }) {
  const z = punchExpr();
  const yuv = "scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv420p,setsar=1";
  const graph = [
    `[0:v]format=rgba[b]`,
    `[b][1:v]overlay=0:0:format=auto[bt]`,
    `[bt]scale=w='ceil(${W}*(${z})/2)*2':h='ceil(${H}*(${z})/2)*2':eval=frame:flags=bicubic,crop=${W}:${H}[z]`,
    `[z][2:v]overlay=0:0:format=auto[f]`,
    `[f]${yuv}[v]`,
  ].join(";");
  const file = resolve(OUT, audio ? "super-claude-bros-trailer.mp4" : "picture.mp4");
  const input = (track) => ["-framerate", String(FPS), "-i", resolve(EDIT, track, "%05d.png")];
  ffmpeg([
    ...input("base"),
    ...input("titles"),
    ...input("flash"),
    ...(audio ? ["-i", audio] : []),
    "-filter_complex", graph,
    "-map", "[v]",
    ...(audio ? ["-map", "3:a", "-c:a", "copy"] : []),
    "-frames:v", String(FRAMES),
    "-c:v", "libx264", "-preset", "slow", "-crf", "17", "-maxrate", "25M", "-bufsize", "50M",
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv",
    "-r", String(FPS), "-g", String(FPS),
    "-movflags", "+faststart",
    file,
  ]);
  // Two frames a second, to look at the cut at a glance.
  ffmpeg(["-i", file, "-vf", `fps=2,scale=240:135,tile=10x${Math.ceil((TOTAL * 2) / 10)}`, "-frames:v", "1", "-q:v", "3", resolve(OUT, "contact.jpg")]);
  console.log(`[video] ${file}`);
}

const placed = picture();
const list = events(placed);
if (args.has("--events")) process.exit(0);
if (args.has("--picture")) {
  encode({ audio: null });
  process.exit(0);
}
// The sound: the mixer renders the games' cues with their own engine and lays them under the music.
const mixer = resolve(HERE, "mix/mix.mjs");
if (!existsSync(mixer)) throw new Error("the mixer (mix/mix.mjs) is not there yet");
const r = spawnSync(
  "node",
  [mixer, "--music", resolve(OUT, "music/music.wav"), "--events", resolve(OUT, "mix/events.json"), "--stems", resolve(OUT, "mix/stems.json"), "--out", resolve(OUT, "mix/master.m4a")],
  { stdio: "inherit" },
);
if (r.status !== 0) throw new Error("the mix failed");
console.log(`[mix] ${list.length} game sounds under the music`);
encode({ audio: resolve(OUT, "mix/master.m4a") });
