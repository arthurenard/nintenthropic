/**
 * The real parts behind the screens: the room from net/ over the sim, the
 * renderer, the wheel on the camera and the tracker, the keyboard and the
 * gamepad. main.ts picks this; in tests, testHooks.ts stands in for the
 * camera and the tracker.
 *
 * Nothing here decides how anything looks or what anything says: it only
 * joins the parts, and turns their failures into the reasons the screens
 * have words for.
 */
import { WebGLUnavailable } from "../../engine/common";
import type { HandSource } from "../../tracking/types";
import { TRACKS } from "../track/tracks";
import type { DriverControl, RaceRenderer, Session } from "../contract";
import {
  encodePhoto,
  gamepadControl,
  grabPhoto,
  keyboardControl,
  wheelControl,
  WheelPreview,
  type PhotoHand,
  type Seat,
  type WheelControl as ReadWheel,
} from "../input";
import { hostSession, joinSession, localTransport, peerTransport, soloSession, type NetOptions } from "../net";
import { createSimRace } from "../sim/race";
import { CameraStack } from "./camera";
import { lazyPodium, lazyRenderer } from "./lazyRenderer";
import { loadCeiling, loadGraphics, loadYou, noteKeptUp, noteStrain, playerCount } from "./prefs";
import { KartSounds } from "./sound";
import {
  SessionFailure,
  type Disposable,
  type Services,
  type SessionOptions,
  type WheelControl,
  type WheelLevel,
  type WheelOptions,
} from "./services";
import type { CameraService } from "./services";

/** Hands and a camera that are not the real ones: a script, in tests (testHooks.ts). */
export interface StandIn {
  source: HandSource;
  camera: CameraService;
  /** A real camera's picture behind the scripted hands (`?camera=real`: Chrome's fake one in the tests), for the wheel's picture and the photos. */
  video?: () => HTMLVideoElement | null;
}

export interface RealServicesOptions {
  /** Instead of the camera and the tracker (tests only; main.ts hands it over in test builds). */
  standIn?: StandIn | null;
  /** `?fail=webgl`: the picture cannot start, to see the sheet for it (tests only). */
  fail?: string | null;
}

/** A wheel as the screens know it, with the reader behind it for the picture. */
interface Wheel extends WheelControl {
  readonly inner: ReadWheel;
  readonly seat: Seat | null;
}

const isWheel = (control: DriverControl): control is Wheel => control.kind === "wheel" && "inner" in control;

/** How long a room gets to open or be found before the screens give up on it, ms. */
const ROOM_TIMEOUT = 20_000;

export function createRealServices(options: RealServicesOptions = {}): Services {
  const script = options.standIn ?? null;
  const stack = new CameraStack();
  const camera: CameraService = script ? script.camera : stack;
  const source: HandSource = script ? script.source : stack.source;
  const aspect = () => (script ? 16 / 9 : stack.aspect());
  /** The video the wheels' pictures and photos are drawn from: the camera's, or none for scripted hands (unless the script has one). */
  const video = (): HTMLVideoElement | null => (script ? (script.video?.() ?? null) : stack.video);

  const netOptions = (session: SessionOptions, extra: Partial<NetOptions> = {}): NetOptions => ({
    createRace: createSimRace,
    transport: session.net === "local" ? () => localTransport() : () => peerTransport(),
    ...extra,
  });

  /** A player who brings friends to the same camera takes a seat for each from the start. */
  const seats = (): 1 | 2 | 3 | 4 => playerCount(loadYou());

  /** Resolves once the room is open (or joined), rejects with the reason if it could not be. */
  const opened = (session: Session, ready: () => boolean): Promise<Session> =>
    new Promise((resolve, reject) => {
      const stops: (() => void)[] = [];
      let timer = 0;
      const finish = (done: () => void) => {
        window.clearTimeout(timer);
        for (const stop of stops) stop();
        done();
      };
      stops.push(session.onClosed((reason) => finish(() => reject(new SessionFailure(reason)))));
      stops.push(session.onLobby(() => ready() && finish(() => resolve(session))));
      timer = window.setTimeout(
        () =>
          finish(() => {
            session.leave();
            reject(new SessionFailure("network"));
          }),
        ROOM_TIMEOUT,
      );
      if (ready()) finish(() => resolve(session));
    });

  return {
    host: (session) => {
      const room = hostSession(netOptions(session, { players: seats() }));
      // The room has its code when the transport has registered it.
      return opened(room, () => room.lobby().code !== null);
    },
    join: (code, session) => {
      const guest = joinSession(code, netOptions(session, { players: seats() }));
      // The host has said hello (and told us who is here) when its lobby is not the empty one we started with.
      return opened(guest, () => guest.lobby().host !== "");
    },
    solo: async (session) => soloSession(netOptions(session)),
    renderer(canvas, hudRoot): RaceRenderer {
      if (options.fail === "webgl") throw new WebGLUnavailable();
      // Graphics (the pause sheet): a tier of the player's choosing, or Auto, which the safety net holds back on a device that could not keep up.
      const choice = loadGraphics();
      const auto = choice === "auto";
      // The drawing code (three.js and the world, about a megabyte) is fetched when the race is first loaded, not with the page:
      // a start screen, a lobby, and a phone that is only a wheel never need it.
      return lazyRenderer(async () => {
        const { createRaceRenderer } = await import("../render");
        return createRaceRenderer(canvas, hudRoot, {
          quality: choice,
          ceiling: auto ? loadCeiling() : null,
          onStrain: auto ? (tier, interval) => noteStrain(tier, interval) : undefined,
          onKeptUp: auto ? (tier) => noteKeptUp(tier) : undefined,
        });
      });
    },
    podium(canvas) {
      if (options.fail === "webgl") throw new WebGLUnavailable();
      return lazyPodium(canvas, async () => (await import("../render")).createPodium(canvas));
    },
    controls: {
      wheel(wheelOptions: WheelOptions): Wheel {
        const seat = wheelOptions.seat && wheelOptions.seat.of > 1 ? wheelOptions.seat : null;
        const inner = wheelControl(source, { steering: wheelOptions.steering, seat, aspect });
        // The check holds the wheel level for a second; the reader does that by itself and sets the level when done.
        const level: WheelLevel = {
          progress: () => inner.levelProgress,
          set: () => void (inner.levelled || inner.setLevel()),
          reset: () => {
            inner.cancelAutoLevel();
            inner.resetLevel();
            inner.startAutoLevel();
          },
        };
        return {
          kind: "wheel",
          inner,
          seat: inner.reader.seat,
          level,
          get wheel() {
            return inner.wheel;
          },
          sample: (now) => inner.sample(now),
          dispose: () => inner.dispose(),
        };
      },
      keyboard: () => keyboardControl(),
      gamepad: () => gamepadControl(),
    },
    camera,
    preview(container: HTMLElement, control: DriverControl, size: "corner" | "large"): Disposable {
      const wheel = isWheel(control) ? control : null;
      const picture = new WheelPreview({ size: "full", seat: wheel?.seat ?? null, aspect: aspect() });
      picture.attach(video());
      // The page sizes the picture (a box of its own shape that it fills); the preview's own styling is for pages that do not.
      picture.canvas.removeAttribute("style");
      container.append(picture.canvas);
      const stop = picture.follow(() => {
        if (!control.wheel) return null;
        const progress = wheel?.inner.levelProgress ?? 0;
        // The ring that fills while the wheel is held level belongs to the check (the large picture), only while it fills.
        return { status: control.wheel, extras: size === "large" && progress > 0 && progress < 1 ? { levelProgress: progress } : {} };
      });
      return {
        dispose() {
          stop();
          picture.dispose();
        },
      };
    },
    previewColumns(container: HTMLElement, seats, size): Disposable {
      const picture = new WheelPreview({ size: "full", aspect: aspect() });
      picture.attach(video());
      picture.canvas.removeAttribute("style");
      container.append(picture.canvas);
      const stop = picture.followColumns(() =>
        seats.map((seat) => {
          const wheel = isWheel(seat.control) ? seat.control : null;
          const progress = wheel?.inner.levelProgress ?? 0;
          return {
            name: seat.name,
            colour: seat.colour,
            status: seat.control.wheel ?? null,
            extras: size === "large" && progress > 0 && progress < 1 ? { levelProgress: progress } : {},
          };
        }),
        size === "large",
      );
      return {
        dispose() {
          stop();
          picture.dispose();
        },
      };
    },
    photo(control) {
      const from = video();
      if (!isWheel(control) || !from) return null;
      // Where the wheel sees the hands now: a picture or column of an awkward shape is cut round them.
      const status = control.wheel;
      const hands: PhotoHand[] = [status.left, status.right].filter((hand) => hand !== null);
      const still = grabPhoto(from, control.seat, hands);
      return still ? { encode: () => encodePhoto(still) } : null;
    },
    // Every track but the secret one, which has to be earned.
    tracks: TRACKS.filter((track) => !track.secret).map((track) => ({ id: track.id, name: track.name })),
    sound: new KartSounds(),
  };
}
