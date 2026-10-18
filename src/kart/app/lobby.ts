/**
 * The lobby: a two-column room. On the left, who is here: a host's code and
 * QR code, then a big card for each racer (their driver, kart colour, name, how they
 * drive and a tick when ready) and a soft dashed seat for each friend still
 * to come. On the right, the race: Single Race or Grand Prix as a large
 * segmented control, the track as a carousel of postcards (or the cup as
 * cards that show their four tracks), laps, bots and mirror as compact
 * controls, and a big Start.
 *
 * A guest sees the same room, read-only, with a line saying they are waiting
 * for the host, and chooses whether their race plays on their own screen or
 * the host's big one. Practice is the host's lobby without the code.
 *
 * `render` is called on every change of the room and updates what shows from
 * it: the screen keeps no copy of the room (the racers' cards are kept by
 * slot, so a new one arrives with a flourish and the rest stay still).
 */
import { MAX_PLAYERS, type LobbyPlayer, type LobbySettings, type LobbyState, type Session } from "../contract";
import { $, element, icon, setText, toast } from "../../ui/dom";
import { cupById } from "../grandprix";
import { CUPS, TRACKS, trackById } from "../track/tracks";
import { isUnlocked, loadUnlocks } from "../unlocks";
import { duckTracks } from "./eggs";
import { canStart, hostName, localPlayers, screenLabel, waitingLine } from "./roster";
import { joinUrl, spellCode } from "./format";
import type { Services } from "./services";
import { postcard, cupOfTrack } from "./trackArt";
import { Segmented, Switch, calm, colourDot, focusHeading } from "./ui";

export type ScreenChoice = "here" | "host";

export interface LobbyHooks {
  start(): void;
  leave(): void;
  configure(settings: Partial<LobbySettings>): void;
  screen(choice: ScreenChoice): void;
}

const CONTROL_NAMES = { wheel: "Wheel", keyboard: "Keyboard", gamepad: "Gamepad" } as const;
const CONTROL_ICONS = { wheel: "wheel", keyboard: "keyboard", gamepad: "gamepad" } as const;

/**
 * The tracks this device has earned beyond the usual ones (the secret track,
 * after both cups are won, or the Konami code): the host's device decides what a room can race.
 */
export function earnedTracks(): { id: string; name: string }[] {
  const all = { duckTracks: duckTracks(), cups: CUPS.map((cup) => cup.id) };
  if (!isUnlocked("secret-track", loadUnlocks(), all)) return [];
  return TRACKS.filter((track) => track.secret).map((track) => ({ id: track.id, name: track.name }));
}

/** One racer's card, kept between renders so only what changed moves. */
interface Card {
  root: HTMLElement;
  face: HTMLElement;
  name: HTMLElement;
  meta: HTMLElement;
  state: HTMLElement;
  /** What the face was drawn from, so it is drawn again only when it changes. */
  drawn: string;
}

export class LobbyScreen {
  private readonly laps: Segmented<string>;
  private readonly bots: Switch;
  private readonly mode: Segmented<"race" | "grand-prix">;
  private readonly cup: Segmented<string>;
  private readonly mirror: Switch;
  private readonly screen: Segmented<ScreenChoice>;
  private readonly display: Segmented<"own" | "host">;
  private readonly track: Segmented<string>;
  private readonly start = $<HTMLButtonElement>("lobby-start");
  private readonly postcards = $("pick-track");
  /** The tracks the carousel lists now, as a key: it is rebuilt when a cup won opens another, or the host's room names one this device does not have. */
  private listed = "";
  private shownTrack = "";
  private qrFor = "";
  private url = "";
  private role: Session["role"] | null = null;
  /** The drivers' pictures (render/portraits.ts), fetched the first time the lobby shows: until they are here a player has a colour dot. */
  private portraits: typeof import("../render/portraits") | null = null;
  private asked = false;
  private last: [LobbyState, Session, ScreenChoice] | null = null;
  private readonly cards = new Map<number, Card>();
  private readonly empties: HTMLElement[] = [];

  constructor(
    private readonly services: Services,
    private readonly hooks: LobbyHooks,
    /** The address of this page, for the join link (the page's own, minus its query and hash). */
    private readonly page: () => string,
    /** `?net=local`, which a guest must use too. */
    private readonly net: "local" | undefined,
  ) {
    this.laps = new Segmented<string>($("pick-laps"), (laps) => hooks.configure({ laps: Number(laps) }));
    this.bots = new Switch($<HTMLButtonElement>("switch-bots"), (bots) => hooks.configure({ bots }));
    this.screen = new Segmented<ScreenChoice>($("pick-screen"), (choice) => hooks.screen(choice));
    this.display = new Segmented<"own" | "host">($("pick-display"), (display) => hooks.configure({ display }));
    this.mode = new Segmented<"race" | "grand-prix">($("pick-mode"), (mode) => hooks.configure({ mode }));
    this.mirror = new Switch($<HTMLButtonElement>("switch-mirror"), (mirror) => hooks.configure({ mirror }));
    // The cups, each with its four tracks to see and read.
    const cups = $("pick-cup");
    cups.replaceChildren(
      ...CUPS.map((cup) => {
        const card = element("button", "cup");
        card.type = "button";
        card.setAttribute("role", "radio");
        card.dataset.value = cup.id;
        const head = element("span", "cup-head");
        head.append(icon("trophy"), element("span", "cup-name", cup.name), element("span", "cup-count", `${cup.tracks.length} races`));
        const list = element("ol", "cup-tracks");
        list.append(
          ...cup.tracks.map((id) => {
            const item = element("li");
            item.append(postcard(id, "cup-thumb"), element("span", "cup-track", trackById(id).name));
            return item;
          }),
        );
        card.append(head, list);
        return card;
      }),
    );
    this.cup = new Segmented<string>(cups, (cup) => hooks.configure({ cup }));
    this.start.addEventListener("click", () => hooks.start());
    $("lobby-leave").addEventListener("click", () => hooks.leave());
    $("lobby-copy").addEventListener("click", () => void this.copy());
    this.track = new Segmented<string>(this.postcards, (track) => hooks.configure({ track }));
  }

  /** Shows the room as it is now. */
  render(lobby: LobbyState, session: Session, choice: ScreenChoice): void {
    this.last = [lobby, session, choice];
    if (!this.asked) {
      this.asked = true;
      import("../render/portraits")
        .then((module) => {
          this.portraits = module;
          if (this.last) this.render(...this.last);
        })
        .catch(() => undefined);
    }
    const { role, device } = session;
    const host = role !== "guest";
    const first = this.role !== role;
    this.role = role;
    const inner = $("lobby-inner");
    inner.dataset.role = role;
    inner.dataset.code = lobby.code ? "yes" : "no";

    // The code, and (for the host) the way to scan it.
    $("join-card").hidden = !lobby.code;
    if (lobby.code) {
      setText("lobby-code", lobby.code);
      $("lobby-code").setAttribute("aria-label", `Race code ${spellCode(lobby.code)}`);
      this.url = joinUrl(this.page(), lobby.code, this.net);
      $("lobby-qr").hidden = !host;
      $("lobby-copy").hidden = !host;
      $("lobby-url").hidden = !host;
      $("lobby-hint").hidden = !host;
      setText("lobby-url", this.url.replace(/^https?:\/\//, ""));
      if (host) void this.drawQr(this.url);
    }

    // The heading says whose race this is.
    const waiting = $("lobby-waiting");
    if (role === "guest") {
      setText("lobby-eyebrow", "Lobby");
      setText("lobby-title", `${hostName(lobby)}’s Race`);
      waiting.hidden = false;
      const grand = lobby.settings.mode === "grand-prix";
      const what = grand ? ` the ${cupById(lobby.settings.cup).name}` : "";
      setText(waiting, `Waiting for ${hostName(lobby)} to start${what}.${lobby.settings.mirror ? " Every track is mirrored." : ""}`);
    } else if (role === "solo") {
      setText("lobby-eyebrow", "Practice");
      setText("lobby-title", "Ready to Race");
      waiting.hidden = true;
    } else {
      setText("lobby-eyebrow", "Lobby");
      setText("lobby-title", "Your Race");
      waiting.hidden = true;
    }

    this.players(lobby, device, role);
    setText(
      "foot-racers",
      role === "solo" ? "Practice is just you and the bots." : host ? "Up to four people can race. Friends join with the code." : "",
    );

    // A guest chooses where their race plays; the host chooses the race.
    $("group-screen").hidden = role !== "guest";
    this.screen.value = choice;
    setText(
      "foot-screen",
      lobby.settings.display === "host"
        ? `${hostName(lobby)} chose to show the race on their screen, in split screen. Choose This Screen to watch it here instead.`
        : "Your race plays on this device. Choose Big Screen to share the host’s screen with everyone else who does, and use this one only as your wheel.",
    );
    // The race is the host's to set; a guest sees it as it is.
    this.settings(lobby, host);

    // Only the host starts.
    this.start.hidden = !host;
    const hint = $("lobby-start-hint");
    hint.hidden = !host;
    if (host) {
      const ready = canStart(lobby) && lobby.phase === "lobby";
      if (this.start.disabled === ready) this.start.disabled = !ready;
      setText(hint, ready ? "" : waitingLine(lobby));
    }
    setText("lobby-leave-label", role === "host" ? "Close Race" : "Leave");
    if (first) focusHeading($("lobby-title"));
  }

  // --- the racers ---------------------------------------------------------------------------------------------

  private players(lobby: LobbyState, device: string, role: Session["role"]): void {
    const list = $("lobby-players");
    const mine = new Set(localPlayers(lobby, device).map((player) => player.slot));
    const slots = new Set(lobby.players.map((player) => player.slot));
    for (const [slot, card] of this.cards) {
      if (slots.has(slot)) continue;
      card.root.remove();
      this.cards.delete(slot);
    }
    const ordered = [...lobby.players].sort((a, b) => a.slot - b.slot);
    ordered.forEach((player, index) => {
      let card = this.cards.get(player.slot);
      if (!card) {
        card = this.card();
        card.root.style.setProperty("--i", String(index));
        this.cards.set(player.slot, card);
      }
      this.fill(card, player, lobby, device, mine.has(player.slot));
      // Kept in slot order, each where it belongs (an existing card is not moved if it is already there).
      const at = list.children[index];
      if (at !== card.root) list.insertBefore(card.root, at ?? null);
    });
    // Seats still to fill: soft, dashed, with the code to join by. Practice has no one else to wait for.
    const open = lobby.code && role !== "solo" ? Math.max(0, MAX_PLAYERS - lobby.players.length) : 0;
    while (this.empties.length > open) this.empties.pop()!.remove();
    while (this.empties.length < open) {
      const seat = element("div", "racer empty");
      const face = element("span", "racer-face open");
      face.append(icon("person-plus"));
      const words = element("span", "racer-words");
      words.append(element("span", "racer-name", "Open Seat"), element("span", "racer-meta"));
      seat.append(face, words);
      this.empties.push(seat);
    }
    for (const seat of this.empties) {
      setText(seat.querySelector(".racer-meta")!, lobby.code ? `Join with code ${lobby.code}` : "");
      // After the racers, in order.
      list.append(seat);
    }
    setText("racer-count", lobby.code ? `${lobby.players.length} of ${MAX_PLAYERS}` : "");
  }

  private card(): Card {
    const root = element("div", "racer");
    const face = element("span", "racer-face");
    const words = element("span", "racer-words");
    const name = element("span", "racer-name");
    const meta = element("span", "racer-meta");
    words.append(name, meta);
    const state = element("span", "racer-state");
    root.append(face, words, state);
    return { root, face, name, meta, state, drawn: "" };
  }

  private fill(card: Card, player: LobbyPlayer, lobby: LobbyState, device: string, you: boolean): void {
    card.root.style.setProperty("--colour", player.colour);
    card.root.classList.toggle("ready", player.ready);
    card.root.classList.toggle("you", you);
    // The name, and who this is for the person looking.
    const tag = you ? "You" : player.device === lobby.host ? "Host" : "";
    const label = `${player.name}${tag}`;
    if (card.name.dataset.label !== label) {
      card.name.dataset.label = label;
      card.name.replaceChildren(element("span", "racer-title", player.name));
      if (tag) card.name.append(element("span", "player-tag", tag));
    }
    const how = `${CONTROL_NAMES[player.control]} · ${screenLabel(player, device)}`;
    if (card.meta.dataset.how !== how) {
      card.meta.dataset.how = how;
      card.meta.replaceChildren(icon(CONTROL_ICONS[player.control]), document.createTextNode(how));
    }
    const state = player.ready ? "ready" : "waiting";
    if (card.state.dataset.state !== state) {
      card.state.dataset.state = state;
      if (player.ready) card.state.replaceChildren(icon("check"), element("span", "visually-hidden", "Ready"));
      else card.state.replaceChildren(element("span", "racer-wait", "Getting ready…"));
    }
    // Their driver, in their colour; a plain colour dot until (or unless) the picture can be drawn.
    const drawn = `${player.character ?? ""}|${player.colour}|${this.portraits ? 1 : 0}`;
    if (card.drawn !== drawn) {
      card.drawn = drawn;
      const url = this.portraits?.portrait(player.character, { colour: player.colour, size: 192 });
      if (url) {
        const face = element("img", "racer-portrait");
        face.src = url;
        face.alt = "";
        face.width = face.height = 64;
        card.face.replaceChildren(face);
      } else {
        card.face.replaceChildren(colourDot(player.colour));
      }
    }
  }

  // --- the race --------------------------------------------------------------------------------------------------

  private settings(lobby: LobbyState, host: boolean): void {
    const settings = lobby.settings;
    const earned = earnedTracks();
    const tracks = [...this.services.tracks, ...earned.filter((track) => !this.services.tracks.some((have) => have.id === track.id))];
    // The host's room may name a track this device does not have (the secret one): show it all the same.
    if (!tracks.some((track) => track.id === settings.track)) {
      const def = trackById(settings.track);
      tracks.push({ id: def.id, name: def.name });
    }
    const key = tracks.map((track) => track.id).join();
    if (key !== this.listed) {
      this.listed = key;
      this.buildTracks(tracks, new Set(earned.map((track) => track.id)));
    }
    const grandPrix = settings.mode === "grand-prix";
    $("row-track").hidden = grandPrix;
    $("row-cup").hidden = !grandPrix;
    this.track.value = settings.track;
    this.mode.value = grandPrix ? "grand-prix" : "race";
    this.cup.value = cupById(settings.cup).id;
    this.mirror.on = settings.mirror === true;
    setText("label-laps", grandPrix ? "Laps per Race" : "Laps");
    setText(
      "foot-mode",
      grandPrix
        ? `Four races in a row. Every place scores, from 15 points for first to 1 for eighth, and the most points wins the ${cupById(settings.cup).name}.`
        : "One race, on the track you choose.",
    );
    setText("foot-mirror", settings.mirror ? "Every track is flipped, left for right: a right turn becomes a left." : "Race every track flipped, left for right.");
    setText(this.start, grandPrix ? "Start Grand Prix" : "Start Race");
    this.laps.value = String(settings.laps);
    this.bots.on = settings.bots;
    // Where the race shows is for a room: practice has only the one screen.
    $("row-display").hidden = this.role !== "host";
    $("foot-display").hidden = this.role !== "host";
    this.display.value = settings.display ?? "own";
    setText(
      "foot-display",
      settings.display === "host"
        ? "The race plays on this screen in split screen (press F for full screen). Everyone else’s device becomes their wheel, with their place, lap and item."
        : "Each player watches the race on their own device. Anyone can choose the big screen for themselves.",
    );
    setText("foot-bots", settings.bots ? `Bots fill the grid, so there are ${settings.racers} karts in all.` : "Only the players race.");

    // A guest sees it all and changes none of it.
    const setup = $("group-race");
    setup.dataset.readonly = host ? "no" : "yes";
    for (const control of setup.querySelectorAll<HTMLButtonElement>("button")) {
      if (control.disabled !== !host) control.disabled = !host;
    }
    for (const group of setup.querySelectorAll<HTMLElement>('[role="radiogroup"]')) group.toggleAttribute("aria-disabled", !host);
    $("foot-guest").hidden = host;
    setText("foot-guest", host ? "" : `${hostName(lobby)} sets the race.`);
    // The chosen postcard is brought to the middle of the carousel when it changes (and the first time it shows).
    if (!grandPrix && this.shownTrack !== settings.track) {
      this.shownTrack = settings.track;
      requestAnimationFrame(() => this.reveal(settings.track));
    }
  }

  /** The carousel of postcards: one for each track, each with its name and cup. */
  private buildTracks(tracks: readonly { id: string; name: string }[], earned: ReadonlySet<string>): void {
    const cards = tracks.map((track) => {
      const card = element("button", "postcard");
      card.type = "button";
      card.setAttribute("role", "radio");
      card.dataset.value = track.id;
      const where = cupOfTrack(track.id);
      const secret = earned.has(track.id) || trackById(track.id).secret === true;
      const words = element("span", "postcard-words");
      words.append(element("span", "postcard-name", track.name));
      const sub = secret ? "Secret Track" : where ? `${where.cup} · ${where.race}` : "";
      if (sub) words.append(element("span", "postcard-sub", sub));
      card.append(postcard(track.id), words);
      return card;
    });
    this.postcards.replaceChildren(...cards);
    this.track.refresh();
    this.shownTrack = "";
  }

  /** Scrolls the carousel to centre this track's card (smoothly, unless motion is reduced). */
  private reveal(id: string): void {
    const card = [...this.postcards.children].find((child) => (child as HTMLElement).dataset.value === id) as HTMLElement | undefined;
    if (!card || this.postcards.clientWidth === 0) return;
    const left = card.offsetLeft - (this.postcards.clientWidth - card.offsetWidth) / 2;
    this.postcards.scrollTo({ left: Math.max(0, left), behavior: calm() ? "auto" : "smooth" });
  }

  /** The QR code of the join address, drawn crisp at a whole number of pixels a module. */
  private async drawQr(url: string): Promise<void> {
    if (url === this.qrFor) return;
    this.qrFor = url;
    try {
      const { generate, correction } = await import("lean-qr/nano");
      const code = generate(url, { minCorrectionLevel: correction.M });
      if (this.qrFor !== url) return;
      const canvas = $<HTMLCanvasElement>("qr-canvas");
      const quiet = 2;
      const scale = 8;
      const side = (code.size + quiet * 2) * scale;
      canvas.width = canvas.height = side;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, side, side);
      ctx.fillStyle = "#000";
      for (let y = 0; y < code.size; y++) {
        for (let x = 0; x < code.size; x++) {
          if (code.get(x, y)) ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    } catch {
      // No picture of the code: the code and the link are still there.
      $("lobby-qr").hidden = true;
    }
  }

  private async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.url);
      toast("Link copied.", { icon: "check" });
    } catch {
      toast("Couldn’t copy the link. Select it and copy it by hand.");
    }
  }
}
