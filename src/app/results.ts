/**
 * The results card - the game's art as its header, its name, the outcome in a
 * word or two, the score counting up, three or four stats, New Best in gold
 * only when it is true - and the branded picture of it to share.
 */
import type { GameEntry, GameStats } from "../engine/types";
import { siteUrl } from "../engine/fetch";
import { $, announce, element, setText, toast } from "../ui/dom";
import { formatScore, shareFileName } from "../ui/format";
import { readBest, writeBest } from "./prefs";

export interface Result {
  game: GameEntry;
  stats: GameStats;
  best: boolean;
}

export function showResults(game: GameEntry, stats: GameStats, reducedMotion: boolean): Result {
  const previous = readBest(game.id);
  const best = stats.score > 0 && (previous === null || stats.score > previous);
  if (best) writeBest(game.id, stats.score);

  const art = $<HTMLImageElement>("results-art");
  art.hidden = false;
  art.onerror = () => (art.hidden = true);
  art.src = siteUrl(game.poster);
  setText("results-game", game.title);
  const outcome = $("results-outcome");
  setText(outcome, stats.outcome);
  outcome.className = `title2${stats.won ? " outcome-won" : " outcome-lost"}`;
  $("results-stats").replaceChildren(
    ...stats.stats.slice(0, 4).map(({ label, value }) => {
      const cell = element("div");
      cell.append(element("dd", "", value), element("dt", "", label));
      return cell;
    }),
  );
  const secrets = $("results-secrets");
  secrets.hidden = stats.secretsTotal <= 0;
  setText(secrets, `Secrets ${stats.secretsFound} of ${stats.secretsTotal}`);
  const newBest = $("new-best");
  newBest.hidden = true;
  newBest.classList.remove("pop");

  const sheet = $<HTMLDialogElement>("results");
  if (!sheet.open) sheet.showModal();
  $("again").focus();
  countUp($("results-score"), stats.score, reducedMotion, () => {
    if (!best) return;
    newBest.hidden = false;
    newBest.classList.add("pop");
  });
  announce(`${stats.outcome}. ${formatScore(stats.score)} points.${best ? " New best." : ""}`);
  return { game, stats, best };
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
 * The results as a picture worth passing round, 1200x630 (the size link
 * previews use): the game's art on the right fading into black under the
 * words, the wordmark, the outcome, the score and the stats.
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
    // Golden hour, as on the landing, until the town's picture exists.
    const sky = context.createLinearGradient(0, 0, 0, 630);
    sky.addColorStop(0, "#213349");
    sky.addColorStop(0.46, "#50506a");
    sky.addColorStop(0.78, "#b9795a");
    sky.addColorStop(1, "#6c4630");
    context.fillStyle = sky;
    context.fillRect(360, 0, 840, 630);
    const sun = context.createRadialGradient(880, 690, 0, 880, 690, 520);
    sun.addColorStop(0, "rgba(255, 196, 120, 0.95)");
    sun.addColorStop(0.55, "rgba(233, 150, 84, 0.45)");
    sun.addColorStop(1, "rgba(233, 150, 84, 0)");
    context.fillStyle = sun;
    context.fillRect(360, 0, 840, 630);
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
  const text = (words: string, x: number, y: number, size: number, weight: number, colour: string, tracking = 0) => {
    context.font = `${weight} ${size}px ${font}`;
    context.fillStyle = colour;
    context.letterSpacing = `${tracking}px`;
    context.fillText(words, x, y);
    context.letterSpacing = "0px";
    return context.measureText(words).width;
  };
  const hand = await loadImage(
    "data:image/svg+xml," +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${document.getElementById("i-hand")?.innerHTML ?? ""}</svg>`,
      ),
  );
  if (hand) context.drawImage(hand, 64, 58, 40, 40);
  text("Handy", 112, 90, 32, 700, "#fff", -0.3);
  const { stats } = result;
  text(result.game.title.toUpperCase(), 64, 250, 20, 600, "rgba(235,235,245,0.62)", 1.2);
  text(stats.outcome, 64, 296, 40, 600, stats.won ? "#30d158" : "#ff453a", -0.4);
  text(formatScore(stats.score), 60, 400, 112, 700, "#fff", -2.2);
  if (result.best) text("★ New Best", 66, 446, 26, 600, "#ffd60a");
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
      await navigator.share({ files: [file], title: `Handy · ${result.game.title}` });
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
