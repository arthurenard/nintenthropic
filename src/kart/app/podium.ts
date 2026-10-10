/**
 * The podium: a Grand Prix's end. The ceremony fills the window (the
 * renderer's, on a canvas of its own: the top three drivers on three steps
 * with their trophies, confetti, the camera swinging round), with the cup's
 * name and who won over it, the final standings in a glass panel beside it,
 * and Play Again (the same cup) or Back to Lobby at the foot.
 *
 * A player on this device who won the cup has it written down
 * (`wonCup`); the second cup won opens the secret track, and the screen says so.
 */
import type { GrandPrixState, LobbyState, Session } from "../contract";
import type { PodiumRenderer } from "../render/podium";
import { $, announce, element, setText } from "../../ui/dom";
import { cupById } from "../grandprix";
import { wonCup } from "../unlocks";
import { earnedTracks } from "./lobby";
import { hostName, localPlayers } from "./roster";
import type { Services } from "./services";
import { colourDot, focusHeading } from "./ui";
import "./grandprix.css";

export interface PodiumHooks {
  /** The host's: the same cup again from its first race. */
  again(): void;
  lobby(): void;
  leave(): void;
}

export interface PodiumInput {
  lobby: LobbyState;
  session: Session;
}

export class PodiumScreen {
  private picture: PodiumRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private watch: ResizeObserver | null = null;
  private raf = 0;
  /** The race that ended the cup we have already recorded a win for, and what that unlocked: re-showing the screen does not count it twice. */
  private recorded = "";
  private unlocked = false;

  constructor(
    private readonly services: Services,
    hooks: PodiumHooks,
  ) {
    $("podium-again").addEventListener("click", () => hooks.again());
    $("podium-lobby").addEventListener("click", () => hooks.lobby());
    $("podium-leave").addEventListener("click", () => hooks.leave());
  }

  /** Takes the ceremony down (the screen is being left). */
  stop(): void {
    cancelAnimationFrame(this.raf);
    this.watch?.disconnect();
    this.watch = null;
    this.picture?.dispose();
    this.picture = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  render({ lobby, session }: PodiumInput): void {
    this.stop();
    const gp = lobby.grandPrix;
    if (!gp) return;
    const cup = cupById(gp.cup);
    const host = session.role !== "guest";
    const mine = new Set(localPlayers(lobby, session.device).map((player) => player.slot));
    const winner = gp.points[0];
    const iWon = !!winner && winner.player !== null && mine.has(winner.player);

    // A cup won on this device is written down; the second one opens the secret track.
    const key = `${lobby.race ?? 0}:${gp.cup}`;
    if (iWon && this.recorded !== key) {
      this.recorded = key;
      const before = earnedTracks().length > 0;
      wonCup(gp.cup);
      this.unlocked = !before && earnedTracks().length > 0;
    } else if (this.recorded !== key) {
      this.unlocked = false;
    }
    $("podium-unlock").hidden = !(iWon && this.unlocked && this.recorded === key);

    setText("podium-eyebrow", "Grand Prix");
    setText("podium-title", cup.name);
    if (winner) {
      const points = `${winner.points} ${winner.points === 1 ? "point" : "points"}`;
      setText("podium-sub", iWon ? `You won the ${cup.name}, with ${points}.` : `${winner.name} wins the ${cup.name}, with ${points}.`);
    }

    $("podium-rows").replaceChildren(
      ...gp.points.map((row, i) => {
        const li = element("li", `podium-row${row.player !== null && mine.has(row.player) ? " mine" : ""}${i === 0 ? " first" : ""}`);
        const name = element("span", "podium-name");
        name.append(colourDot(row.colour), element("span", "st-driver", row.name));
        if (row.player !== null && mine.has(row.player)) name.append(element("span", "player-tag", "You"));
        li.dataset.rank = String(i + 1);
        li.style.setProperty("--i", String(i));
        li.append(element("span", "podium-rank", String(i + 1)), name, element("span", "podium-points", String(row.points)));
        return li;
      }),
    );

    $("podium-again").hidden = !host;
    const back = $("podium-lobby");
    back.classList.toggle("primary", !host);
    back.classList.toggle("secondary", host);
    const wait = $("podium-wait");
    wait.hidden = host;
    if (!host) setText(wait, `${hostName(lobby)} can play the ${cup.name} again.`);
    setText("podium-leave-label", session.role === "host" ? "Close Race" : "Leave");
    focusHeading($("podium-title"));
    announce(winner ? `${winner.name} wins the ${cup.name}.` : "The podium.");

    // A phone that is only a wheel (its race is on the host's big screen) shows the standings, not the ceremony: that is the big screen's.
    this.ceremony(gp.points.slice(0, 3), session.views().length > 0);
  }

  /** The 3D podium behind it all, if the browser can draw it and this screen shows the race. */
  private ceremony(winners: GrandPrixState["points"], draws: boolean): void {
    const make = this.services.podium;
    if (!make || !draws) return;
    const stage = $("podium-stage");
    const canvas = element("canvas", "podium-canvas");
    stage.replaceChildren(canvas);
    let picture: PodiumRenderer;
    try {
      picture = make.call(this.services, canvas);
    } catch {
      // No picture: the standings and the night behind them are still the podium.
      canvas.remove();
      return;
    }
    this.canvas = canvas;
    this.picture = picture;
    picture.show(winners.map((row) => ({ name: row.name, colour: row.colour, character: row.character })));
    const fit = () => {
      const box = stage.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) picture.resize(box.width, box.height, window.devicePixelRatio || 1);
    };
    fit();
    this.watch = new ResizeObserver(fit);
    this.watch.observe(stage);
    let last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      picture.frame((now - last) / 1000);
      last = now;
    };
    this.raf = requestAnimationFrame(loop);
  }
}
