/**
 * The lobby. A host sees the code large with a QR code of the join address,
 * who is here, and the race's track, laps and bots, and starts when everyone
 * is ready. A guest sees the code, who is here, "Waiting for <host> to
 * start", and chooses whether their race plays on their own screen or the
 * host's big one. Practice is the host's lobby without the code.
 *
 * `render` is called on every change of the room and rebuilds what shows
 * from it: the screen keeps no copy of the room.
 */
import type { LobbyPlayer, LobbySettings, LobbyState, Session } from "../contract";
import { $, element, icon, setText, toast } from "../../ui/dom";
import { canStart, hostName, localPlayers, screenLabel, waitingLine } from "./roster";
import { joinUrl, spellCode } from "./format";
import type { Services } from "./services";
import { Segmented, Switch, colourDot, focusHeading } from "./ui";

export type ScreenChoice = "here" | "host";

export interface LobbyHooks {
  start(): void;
  leave(): void;
  configure(settings: Partial<LobbySettings>): void;
  screen(choice: ScreenChoice): void;
}

const CONTROL_NAMES = { wheel: "Wheel", keyboard: "Keyboard", gamepad: "Gamepad" } as const;

export class LobbyScreen {
  private readonly laps: Segmented<string>;
  private readonly bots: Switch;
  private readonly screen: Segmented<ScreenChoice>;
  private readonly display: Segmented<"own" | "host">;
  private readonly select = $<HTMLSelectElement>("track-select");
  private readonly start = $<HTMLButtonElement>("lobby-start");
  private qrFor = "";
  private url = "";
  private role: Session["role"] | null = null;
  /** The drivers' pictures (render/portraits.ts), fetched the first time the lobby shows: until they are here a player has a colour dot. */
  private portraits: typeof import("../render/portraits") | null = null;
  private asked = false;
  private last: [LobbyState, Session, ScreenChoice] | null = null;

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
    this.select.addEventListener("change", () => hooks.configure({ track: this.select.value }));
    this.select.replaceChildren(
      ...services.tracks.map((track) => {
        const option = element("option", undefined, track.name);
        option.value = track.id;
        return option;
      }),
    );
    this.start.addEventListener("click", () => hooks.start());
    $("lobby-leave").addEventListener("click", () => hooks.leave());
    $("lobby-copy").addEventListener("click", () => void this.copy());
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
      setText(waiting, `Waiting for ${hostName(lobby)} to start.`);
    } else if (role === "solo") {
      setText("lobby-eyebrow", "Practice");
      setText("lobby-title", "Ready to Race");
      waiting.hidden = true;
    } else {
      setText("lobby-eyebrow", "Lobby");
      setText("lobby-title", "Your Race");
      waiting.hidden = true;
    }

    this.players(lobby, device);
    setText(
      "foot-players",
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
    $("group-race").hidden = !host;
    if (host) this.settings(lobby.settings);

    // Only the host starts.
    this.start.hidden = !host;
    const hint = $("lobby-start-hint");
    hint.hidden = !host;
    if (host) {
      const ready = canStart(lobby) && lobby.phase === "lobby";
      if (this.start.disabled === ready) this.start.disabled = !ready;
      setText(hint, ready ? "" : waitingLine(lobby));
    }
    setText("lobby-leave-label", host && role === "host" ? "Close Race" : "Leave");
    if (first) focusHeading($("lobby-title"));
  }

  private players(lobby: LobbyState, device: string): void {
    const mine = new Set(localPlayers(lobby, device).map((player) => player.slot));
    const rows = lobby.players.map((player) => {
      const row = element("div", "row player-row");
      const words = element("div", "player-words");
      const name = element("span", "player-name", player.name);
      if (mine.has(player.slot)) name.append(element("span", "player-tag", "You"));
      else if (player.device === lobby.host) name.append(element("span", "player-tag", "Host"));
      words.append(name, element("span", "player-meta subhead secondary", `${CONTROL_NAMES[player.control]} · ${screenLabel(player, device)}`));
      const state = element("span", player.ready ? "player-state ready" : "player-state subhead tertiary");
      if (player.ready) {
        state.append(icon("check"), element("span", "visually-hidden", "Ready"));
      } else {
        state.textContent = "Getting ready…";
      }
      row.append(this.face(player), words, state);
      return row;
    });
    $("lobby-players").replaceChildren(...rows);
  }

  /** Who this player is driving, in their colour; a plain colour dot until (or unless) the picture can be drawn. */
  private face(player: LobbyPlayer): HTMLElement {
    const url = this.portraits?.portrait(player.character, { colour: player.colour, size: 128 });
    if (!url) return colourDot(player.colour);
    const face = element("img", "player-face");
    face.src = url;
    face.alt = "";
    face.width = face.height = 44;
    face.style.setProperty("--colour", player.colour);
    return face;
  }

  private settings(settings: LobbySettings): void {
    const tracks = this.services.tracks;
    const several = tracks.length > 1;
    $("track-menu").hidden = !several;
    $("track-value").hidden = several;
    if (several) this.select.value = settings.track;
    else setText("track-value", tracks.find((track) => track.id === settings.track)?.name ?? tracks[0]?.name ?? "");
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
