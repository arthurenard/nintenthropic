/**
 * The results card - the game's art as its header, its name, the outcome in a
 * word or two and the game's one line about it, the score counting up, three
 * or four stats, New Best in gold only when it is true (or, quietly, the best
 * to beat) - and the branded picture of it to share.
 *
 * Personal bests are kept for each game, difficulty and control: the hand
 * and a pointer, which is far easier to aim, never share a record.
 */
import type { Difficulty, GameEntry, GameStats } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { paintBackdrop } from "../ui/backdrop";
import { $, announce, element, setText, toast } from "../ui/dom";
import { formatScore, shareFileName } from "../ui/format";
import { posterInto } from "./arcade";
import { judge, readBest, writeBest, type Best, type ControlClass, type Verdict } from "./prefs";

/** How a round was played: what its record is kept under. */
export interface Round {
  difficulty: Difficulty;
  control: ControlClass;
}

export interface Result {
  game: GameEntry;
  stats: GameStats;
  round: Round | null;
  best: boolean;
  /** The best before this round, if there was one. */
  previous: Best | null;
}

/** The verdict on each finished round, found again by its stats when the card is shown. */
const verdicts = new WeakMap<GameStats, { round: Round; verdict: Verdict }>();

/** The difficulty's name where it is worth saying: Standard goes without. */
export const difficultyLabel = (difficulty: Difficulty): string | null => (difficulty === "relaxed" ? "Relaxed" : null);

/**
 * The outcome's tone: green for a round won, red for one lost - unless it
 * was lost on the way to a new best, which the card celebrates in gold and
 * does not tell off in red. It is said plainly then.
 */
export function outcomeTone(won: boolean, best: boolean): "won" | "lost" | "plain" {
  return won ? "won" : best ? "plain" : "lost";
}

/**
 * The secrets found, under the stats; with none found yet, a nudge toward
 * where they hide (every game keeps its jokes in the world around the fight),
 * and with every one found, a word for it.
 */
export function secretsLine(found: number, total: number): string {
  if (found <= 0) return `Secrets 0 of ${total}. The scenery can take a shot.`;
  return found >= total ? `Secrets ${found} of ${total}. Nothing left unshot.` : `Secrets ${found} of ${total}`;
}

/**
 * A round is over: it is weighed against the best for its game, difficulty
 * and control, and kept at once if it beats it - before the card arrives,
 * so closing the tab at the last moment loses nothing.
 */
export function recordRound(game: GameEntry, stats: GameStats, round: Round, now = Date.now()): Verdict {
  const verdict = judge(stats.score, readBest(game.id, round.difficulty, round.control));
  if (verdict.best) writeBest(game.id, round.difficulty, round.control, { score: stats.score, outcome: stats.outcome, at: now });
  verdicts.set(stats, { round, verdict });
  return verdict;
}

export function showResults(game: GameEntry, stats: GameStats, reducedMotion: boolean): Result {
  const judged = verdicts.get(stats) ?? null;
  const round = judged?.round ?? null;
  const best = judged?.verdict.best ?? false;
  const previous = judged?.verdict.previous ?? null;

  const art = $<HTMLImageElement>("results-art");
  posterInto(art.parentElement!, art, game);
  const level = round && difficultyLabel(round.difficulty);
  setText("results-game", level ? `${game.title} · ${level}` : game.title);
  const outcome = $("results-outcome");
  setText(outcome, stats.outcome);
  outcome.className = `title2 outcome-${outcomeTone(stats.won, best)}`;
  const note = $("results-note");
  note.hidden = !stats.note;
  setText(note, stats.note ?? "");
  $("results-stats").replaceChildren(
    ...stats.stats.slice(0, 4).map(({ label, value }) => {
      const cell = element("div");
      cell.append(element("dd", "", value), element("dt", "", label));
      return cell;
    }),
  );
  const secrets = $("results-secrets");
  secrets.hidden = stats.secretsTotal <= 0;
  setText(secrets, secretsLine(stats.secretsFound, stats.secretsTotal));
  const newBest = $("new-best");
  newBest.hidden = true;
  newBest.classList.remove("pop");
  // By how much a best beat the one before it; the best to beat otherwise.
  const margin = best && previous ? stats.score - previous.score : 0;
  const marginNode = $("new-best-margin");
  marginNode.hidden = margin <= 0;
  setText(marginNode, `+${formatScore(margin)} over your best`);
  const bestLine = $("results-best");
  bestLine.hidden = true;
  setText(bestLine, previous ? `Best ${formatScore(previous.score)}` : "");

  const sheet = $<HTMLDialogElement>("results");
  if (!sheet.open) sheet.showModal();
  $("again").focus();
  countUp($("results-score"), stats.score, reducedMotion, () => {
    if (best) {
      newBest.hidden = false;
      newBest.classList.add("pop");
    } else if (previous) {
      bestLine.hidden = false;
    }
  });
  const said = best ? (margin > 0 ? ` New best, ${formatScore(margin)} over your last.` : " New best.") : previous ? ` Your best is ${formatScore(previous.score)}.` : "";
  announce(`${stats.outcome}. ${stats.note ? `${stats.note} ` : ""}${formatScore(stats.score)} points.${said}`);
  return { game, stats, round, best, previous };
}

/** The final score counts up; with reduced motion it simply appears. */
function countUp(node: HTMLElement, target: number, reducedMotion: boolean, done: () => void): void {
  if (reducedMotion || target <= 0) {
    setText(node, formatScore(target));
    done();
    return;
  }
  const began = performance.now();
  const length = Math.min(1100, 500 + target / 20);
  const step = (now: number) => {
    const t = Math.min(1, (now - began) / length);
    const eased = 1 - (1 - t) ** 3;
    setText(node, formatScore(Math.round(target * eased)));
    if (t < 1 && $<HTMLDialogElement>("results").open) requestAnimationFrame(step);
    else {
      setText(node, formatScore(target));
      done();
    }
  };
  requestAnimationFrame(step);
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  const image = new Image();
  image.src = url;
  return image.decode().then(
    () => image,
    () => null,
  );
}

/**
 * Breaks `words` into lines no wider than `width` as `measure` measures them,
 * at most `max` lines; a last line that would run on ends in an ellipsis.
 */
export function wrapLines(words: string, width: number, measure: (text: string) => number, max = 2): string[] {
  const lines: string[] = [];
  let line = "";
  const all = words.split(/\s+/).filter(Boolean);
  for (let i = 0; i < all.length; i++) {
    const next = line ? `${line} ${all[i]}` : all[i]!;
    if (measure(next) <= width || !line) {
      line = next;
      continue;
    }
    if (lines.length === max - 1) {
      // The last line: fill it and end it, however much is left.
      let rest = `${line} ${all.slice(i).join(" ")}`;
      while (rest.length > 1 && measure(`${rest}…`) > width) rest = rest.slice(0, -1).trimEnd();
      lines.push(`${rest.replace(/[\s,.;:–-]+$/, "")}…`);
      return lines;
    }
    lines.push(line);
    line = all[i]!;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The results as a picture worth passing round, 1200x630 (the size link
 * previews use): the game's art on the right fading into black under the
 * words, the wordmark, the game (and Relaxed, when it was), the outcome and
 * its line, the score and the stats.
 */
export async function drawShareCard(result: Result): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 630;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#000";
  context.fillRect(0, 0, 1200, 630);
  const art = await loadImage(siteUrl(result.game.poster));
  if (art) {
    const scale = 630 / art.naturalHeight;
    const width = Math.min(art.naturalWidth, 840 / scale);
    context.drawImage(art, (art.naturalWidth - width) / 2, 0, width, art.naturalHeight, 360, 0, 840, 630);
  } else {
    // The game's light, as on the arcade, until its picture exists.
    paintBackdrop(context, result.game.backdrop, 360, 0, 840, 630);
  }
  const fade = context.createLinearGradient(360, 0, 820, 0);
  fade.addColorStop(0, "rgba(0,0,0,1)");
  fade.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = fade;
  context.fillRect(360, 0, 460, 630);
  const bottom = context.createLinearGradient(0, 380, 0, 630);
  bottom.addColorStop(0, "rgba(0,0,0,0)");
  bottom.addColorStop(1, "rgba(0,0,0,0.85)");
  context.fillStyle = bottom;
  context.fillRect(0, 380, 1200, 250);

  const font = getComputedStyle(document.body).fontFamily;
  const setFont = (size: number, weight: number) => (context.font = `${weight} ${size}px ${font}`);
  const text = (words: string, x: number, y: number, size: number, weight: number, colour: string, tracking = 0) => {
    setFont(size, weight);
    context.fillStyle = colour;
    context.letterSpacing = `${tracking}px`;
    context.fillText(words, x, y);
    context.letterSpacing = "0px";
    return context.measureText(words).width;
  };
  // The mark (public/icons/icon-192.png, from tools/icons/).
  const mark = await loadImage(siteUrl("icons/icon-192.png"));
  if (mark) context.drawImage(mark, 62, 56, 44, 44);
  text("Super Claude Bros.", 112, 90, 32, 700, "#fff", -0.3);
  const { stats } = result;
  // From the score up: the note's lines, the outcome, the game's name.
  setFont(24, 400);
  const note = stats.note ? wrapLines(stats.note, 500, (line) => context.measureText(line).width) : [];
  const scoreY = note.length ? 420 : 400;
  const noteY = scoreY - 114 - (note.length - 1) * 32;
  const outcomeY = note.length ? noteY - 44 : scoreY - 104;
  const level = result.round && difficultyLabel(result.round.difficulty);
  text((level ? `${result.game.title} · ${level}` : result.game.title).toUpperCase(), 64, outcomeY - 46, 20, 600, "rgba(235,235,245,0.62)", 1.2);
  text(stats.outcome, 64, outcomeY, 40, 600, { won: "#30d158", lost: "#ff453a", plain: "#fff" }[outcomeTone(stats.won, result.best)], -0.4);
  note.forEach((line, i) => text(line, 64, noteY + i * 32, 24, 400, "rgba(235,235,245,0.62)"));
  text(formatScore(stats.score), 60, scoreY, 112, 700, "#fff", -2.2);
  if (result.best) text("★ New Best", 66, scoreY + 46, 26, 600, "#ffd60a");
  let x = 64;
  for (const { label, value } of stats.stats.slice(0, 4)) {
    const width = Math.max(text(value, x, 540, 32, 600, "#fff"), text(label, x, 574, 20, 400, "rgba(235,235,245,0.62)"));
    x += Math.max(width, 96) + 40;
  }
  return canvas;
}

/** Passed to the system's share sheet where the browser shares files; otherwise saved as a download. */
export async function shareResult(result: Result): Promise<void> {
  const canvas = await drawShareCard(result);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const name = shareFileName(result.game.title);
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `Super Claude Bros. · ${result.game.title}` });
      return;
    } catch (error) {
      if ((error as Error).name === "AbortError") return; // the player closed the share sheet
    }
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  toast("Saved to your Downloads.", { icon: "check" });
}
