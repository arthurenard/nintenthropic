/**
 * The Grand Prix's standings, between its races: everyone's points, counted
 * up from where they were with the race's gain beside each, the rows sliding
 * to their new places and a mark for who rose or fell. Big and plain enough
 * to read from a sofa; nobody has to touch a phone, because the next race
 * starts by itself when the bar at the foot runs out (the room keeps that
 * time; the host's Next Race skips it).
 */
import type { GrandPrixState, LobbyState, Session } from "../contract";
import { $, announce, element, setText } from "../../ui/dom";
import { GP_STANDINGS_MS, cupById } from "../grandprix";
import { ordinal } from "./format";
import { hostName, localPlayers } from "./roster";
import { calm, colourDot, focusHeading } from "./ui";
import "./grandprix.css";

export interface StandingsHooks {
  /** The host's: on to the next race (or the podium). */
  next(): void;
  leave(): void;
}

export interface StandingsInput {
  lobby: LobbyState;
  session: Session;
  /** The track just raced. */
  trackName: string;
  /** The track about to be raced, or null after the last race. */
  nextTrackName: string | null;
}

type Row = GrandPrixState["points"][number];

/** When each beat of the animation happens after the screen comes up, ms. */
const SHOW_GAINS = 650;
const COUNT_UP = 1350;
const SHOW_MOVES = 2200;
/** How long the count-up and the rows' slide to their new places last, ms. */
const COUNT_FOR = 1100;
const SLIDE_FOR = 900;
/** How long the rows take to rise as the screen comes up: the last of eight rises 560 ms, 70 ms after the one before (grandprix.css). */
const ENTER_FOR = 1100;

const easeOut = (f: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, f)), 3);

export class StandingsScreen {
  private timers: number[] = [];
  private raf = 0;
  private list = $("gp-rows");

  constructor(private readonly hooks: StandingsHooks) {
    $("gp-next").addEventListener("click", () => hooks.next());
    $("gp-leave").addEventListener("click", () => hooks.leave());
  }

  /** Stops the animation (the screen is being left). */
  stop(): void {
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers = [];
    cancelAnimationFrame(this.raf);
  }

  render({ lobby, session, trackName, nextTrackName }: StandingsInput): void {
    this.stop();
    const gp = lobby.grandPrix;
    if (!gp) return;
    const cup = cupById(gp.cup);
    const last = gp.race >= cup.tracks.length - 1;
    const host = session.role !== "guest";
    setText("gp-eyebrow", `${cup.name} · After Race ${gp.race + 1} of ${cup.tracks.length}`);
    setText("gp-title", last ? "Final Standings" : "Standings");
    setText("gp-sub", trackName ? `Points after ${trackName}.` : "");
    setText("gp-next-eyebrow", last ? "Then" : "Next Up");
    setText("gp-next-name", last ? "The Podium" : (nextTrackName ?? "The Next Race"));
    setText("gp-next", last ? "See the Podium" : "Next Race");
    $("gp-next").hidden = !host;
    const wait = $("gp-wait");
    wait.hidden = host;
    if (!host) setText(wait, `${hostName(lobby)} can skip ahead. It starts by itself in a moment.`);
    setText("gp-leave-label", session.role === "host" ? "Close Race" : "Leave");

    // The bar at the foot runs out when the room moves on.
    const drain = $("gp-drain");
    drain.style.animation = "none";
    void drain.offsetWidth;
    drain.style.animation = `st-drain ${GP_STANDINGS_MS}ms linear forwards`;

    const mine = new Set(localPlayers(lobby, session.device).map((player) => player.slot));
    const rows = gp.points.map((row, i) => ({ row, now: i + 1, was: row.was ?? i + 1, before: row.points - (row.gain ?? 0) }));
    const items = rows.map(({ row }, index) => this.item(row, mine, index));
    const start = [...rows].sort((a, b) => a.was - b.was || a.now - b.now);
    const byRow = new Map(rows.map((r, i) => [r, items[i]!]));
    const still = calm();

    const show = (order: typeof rows, rank: (r: (typeof rows)[number]) => number, total: (r: (typeof rows)[number]) => number) => {
      this.list.replaceChildren(...order.map((r) => byRow.get(r)!));
      for (const r of rows) {
        const li = byRow.get(r)!;
        setText(li.querySelector(".st-rank")!, String(rank(r)));
        setText(li.querySelector(".st-total")!, String(total(r)));
        li.classList.toggle("leader", rank(r) === 1);
        // The top three wear a medal's colour.
        li.dataset.rank = String(rank(r));
      }
    };
    const finish = () => {
      show(rows, (r) => r.now, (r) => r.row.points);
      this.list.classList.add("gains", "moves");
      for (const r of rows) this.move(byRow.get(r)!, r.was - r.now, gp.race > 0);
      const first = rows[0]!;
      announce(`${first.row.name} leads with ${first.row.points} points.`);
    };
    focusHeading($("gp-title"));
    this.list.classList.remove("gains", "moves");
    // The rows rise one after the other the first moment they are there; once they have, the sliding of the count-up must not start them again.
    this.list.classList.add("entering");
    this.later(ENTER_FOR, () => this.list.classList.remove("entering"));
    if (still) return finish();

    // Where they stood, with the points they had.
    show(start, (r) => r.was, (r) => r.before);
    for (const r of rows) this.move(byRow.get(r)!, 0, false);
    this.later(SHOW_GAINS, () => this.list.classList.add("gains"));
    this.later(COUNT_UP, () => {
      this.slide(rows, byRow, show);
      const t0 = performance.now();
      const tick = (now: number) => {
        const f = easeOut((now - t0) / COUNT_FOR);
        for (const r of rows) setText(byRow.get(r)!.querySelector(".st-total")!, String(Math.round(r.before + (r.row.points - r.before) * f)));
        if (now - t0 < COUNT_FOR) this.raf = requestAnimationFrame(tick);
      };
      this.raf = requestAnimationFrame(tick);
    });
    this.later(SHOW_MOVES, () => {
      this.list.classList.add("moves");
      for (const r of rows) this.move(byRow.get(r)!, r.was - r.now, gp.race > 0);
    });
    this.later(SHOW_MOVES + 300, finish);
  }

  private later(ms: number, run: () => void): void {
    this.timers.push(window.setTimeout(run, ms));
  }

  /** One row of the table. */
  private item(row: Row, mine: ReadonlySet<number>, index: number): HTMLLIElement {
    // The people at the table stand out from the bots: a stripe in their colour, and the ones on this screen lit.
    const li = element("li", `st-row${row.player !== null ? " human" : ""}${row.player !== null && mine.has(row.player) ? " mine" : ""}`);
    li.style.setProperty("--colour", row.colour);
    li.style.setProperty("--i", String(index));
    const name = element("span", "st-name");
    name.append(colourDot(row.colour), element("span", "st-driver", row.name));
    if (row.player !== null && mine.has(row.player)) name.append(element("span", "player-tag", "You"));
    const gain = element("span", "st-gain", row.gain ? `+${row.gain}` : "");
    li.append(element("span", "st-rank"), element("span", "st-move"), name, gain, element("span", "st-total"));
    li.setAttribute("aria-label", `${row.name}, ${row.points} points${row.place ? `, ${ordinal(row.place)} in the race` : ""}`);
    return li;
  }

  /** The mark by a row: up or down by how many places it moved since the race before. */
  private move(li: HTMLElement, places: number, show: boolean): void {
    const mark = li.querySelector<HTMLElement>(".st-move")!;
    const shown = show && places !== 0;
    mark.className = `st-move${shown ? (places > 0 ? " up" : " down") : ""}`;
    setText(mark, shown ? String(Math.abs(places)) : "");
    mark.title = shown ? `${places > 0 ? "Up" : "Down"} ${Math.abs(places)}` : "";
  }

  /** Puts the rows in their new order, each gliding from where it was (FLIP). */
  private slide(
    rows: { row: Row; now: number; was: number; before: number }[],
    byRow: Map<(typeof rows)[number], HTMLLIElement>,
    show: (order: typeof rows, rank: (r: (typeof rows)[number]) => number, total: (r: (typeof rows)[number]) => number) => void,
  ): void {
    const tops = new Map(rows.map((r) => [r, byRow.get(r)!.getBoundingClientRect().top]));
    show(rows, (r) => r.now, (r) => r.before);
    for (const r of rows) {
      const li = byRow.get(r)!;
      const delta = (tops.get(r) ?? 0) - li.getBoundingClientRect().top;
      li.style.transition = "none";
      li.style.transform = delta ? `translateY(${delta}px)` : "";
    }
    void this.list.offsetWidth;
    for (const r of rows) {
      const li = byRow.get(r)!;
      li.style.transition = `transform ${SLIDE_FOR}ms var(--spring)`;
      li.style.transform = "";
    }
  }
}
