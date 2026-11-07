/**
 * What each thing that happens in a race sounds like. A pure function from a
 * RaceEvent (and where the local karts are) to the sounds to play, so the
 * whole table is tested in Node without an audio device.
 *
 * The player's own events are heard in full, in their own place in the stereo
 * field. Other karts' events are heard if close enough, quieter and darker
 * with distance, from the side they lie on. A few belong to the player alone
 * (lap chimes, fanfares). A bot's final lap is its own business.
 */
import type { Emote, RaceEvent } from "../contract";
import { TUNING } from "../sim/tuning";
import { WEIGHT_RATE, engineFamily } from "./engines";
import { type Scene, type Listener, falloff, hearKart, listenerAt, localOf } from "./scene";

/** One sound to play. */
export interface Order {
  cue: string;
  /** A multiplier on the cue's own level. */
  volume: number;
  pan: number;
  /** Metres from the listener: darkens and quietens the sound. 0 for the player's own. */
  distance: number;
  /** Playback rate: 1 natural. */
  rate: number;
  /** Seconds from now. */
  delay: number;
  /** 3 must be heard (the countdown, the player's own fanfares) .. 0 garnish; the first to go when the mix is crowded. */
  priority: number;
  /** Pull the music down to ``depth`` of its level for ``hold`` seconds. */
  duck?: { depth: number; hold: number };
}

/** The countdown's beeps are one note played at the A major triad's three steps: 3, 2, 1. */
const COUNT_RATE: Record<number, number> = { 3: 1, 2: 1.2599, 1: 1.4983 };

/** How long the item roulette turns after a pick-up, seconds: the item's own chime is timed to land with it (and with the latch the race audio plays as it stops). */
export const ROULETTE = TUNING.items.roulette;

/**
 * Each driver's horn (a clap honks it): a party blower for Bun, a bulb horn for Pepper, a ribbit for Moss, the classic two-tone for Kit, a steam whistle for
 * Juniper, a bicycle bell for Mango, a tuba for Bramble, a robot's honk for Rivet, and Dabble quacks. Anyone else gets the classic.
 */
export const HORNS: Readonly<Record<string, string>> = {
  bun: "kart_horn_party",
  pepper: "kart_horn_squeeze",
  moss: "kart_horn_ribbit",
  kit: "kart_horn",
  juniper: "kart_horn_steam",
  mango: "kart_horn_bell",
  bramble: "kart_horn_tuba",
  rivet: "kart_horn_robot",
  dabble: "kart_duck",
};

/** A bump at least this hard (the sim's strength, 0..1) is a clonk, not a tap. */
export const CLONK_FROM = 0.55;

/** A landing at least this hard (the sim's `land` strength, 0..1) thuds under its sound. */
export const THUD_FROM = 0.25;

/** How far a kind of sound carries from another kart, metres. */
const RADIUS = { big: 45, medium: 32, small: 20 } as const;

function order(cue: string, who: Listener, own: boolean, o: Partial<Order> & { radius?: number } = {}): Order | null {
  // `volume` is taken out with `radius`: left in `rest`, it would undo the distance's fall-off below.
  const { radius, volume, ...rest } = o;
  const reach = own ? 1 : falloff(who.distance, radius ?? RADIUS.medium);
  if (reach <= 0.02) return null;
  return {
    cue,
    volume: (volume ?? 1) * (own ? 1 : 0.8 * reach),
    pan: who.pan,
    distance: own ? 0 : who.distance,
    rate: 1,
    delay: 0,
    priority: own ? 2 : 1,
    ...rest,
  };
}

/** The pitch a kart's weight gives its landings and bumps: a light driver's come out higher and snappier, a heavy one's deeper. */
function weightRate(scene: Scene, kart: number): number {
  const character = scene.racers?.find((r) => r.id === kart)?.character;
  return WEIGHT_RATE[engineFamily(character, kart)];
}

/** A hash of a hazard's name to a small pitch change, so each kind is a little different. */
function hazardRate(kind: string): number {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return 0.93 + ((h % 1000) / 1000) * 0.14;
}

/** The kart a skyrocket launched by ``owner`` flies to: the leader of the others still racing (the sim's own rule, items.ts `rocketTarget`). */
function rocketTargetOf(scene: Scene, owner: number): number | undefined {
  let best: { id: number; place: number } | undefined;
  for (const k of scene.karts.values()) {
    if (k.id !== owner && k.finished === null && (best === undefined || k.place < best.place)) best = { id: k.id, place: k.place };
  }
  return best?.id;
}

const keep = (...orders: (Order | null)[]): Order[] => orders.filter((o): o is Order => o !== null);

/** The sounds for one event. */
export function ordersFor(event: RaceEvent, scene: Scene): Order[] {
  switch (event.type) {
    case "countdown":
      // Three notes up the A major triad (A4, C#5, E5) and Go on the A an octave above the first, with the crowd behind it.
      if (event.n === 0) {
        return [
          { cue: "kart_beep_high", volume: 1, pan: 0, distance: 0, rate: 1, delay: 0, priority: 3 },
          { cue: "kart_cheer", volume: 0.4, pan: 0, distance: 0, rate: 1.04, delay: 0.12, priority: 1 },
        ];
      }
      return [{ cue: "kart_beep_low", volume: 1, pan: 0, distance: 0, rate: COUNT_RATE[event.n] ?? 1, delay: 0, priority: 3 }];

    case "box": {
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_box_smash", who, !!localOf(scene, event.kart), { radius: RADIUS.medium, volume: 1 })) : [];
    }

    case "pickup": {
      // The box bursts for everyone near. (The item's own chime is not here: the reel plays it when it stops, race-audio.ts, so it always matches the item held.)
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      return keep(order("kart_box_smash", who, !!localOf(scene, event.kart), { radius: RADIUS.medium, volume: 1 }));
    }

    case "use": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      switch (event.item) {
        case "nitro":
          return keep(order("kart_nitro", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        // Three charges: the same ignition behind a ratchet of three clicks, higher.
        case "nitro3":
          return keep(order("kart_nitro_triple", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        case "puck":
          return keep(order("kart_puck_fire", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        // The triple's pucks are a little brighter, so three in a row are not one.
        case "puck3":
          return keep(order("kart_puck_fire", who, own, { radius: RADIUS.big, rate: 1.06, priority: own ? 3 : 1 }));
        case "seeker":
          return keep(order("kart_seeker_launch", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        case "slick":
          return keep(order("kart_slick_splat", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }));
        // A decoy is set down quietly (the sound of an item box that is not one comes when it is driven into).
        case "decoy":
          return keep(order("kart_decoy_drop", who, own, { radius: RADIUS.small, priority: own ? 2 : 0 }));
        case "comet":
          return keep(order("kart_comet", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }));
        case "skyrocket": {
          // The kart it is sent after hears a siren: it leads the others still racing, and it is on this screen.
          const target = rocketTargetOf(scene, event.kart);
          const mine = target === undefined ? undefined : localOf(scene, target);
          return keep(
            order("kart_skyrocket", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }),
            mine ? { cue: "kart_skyrocket_warn", volume: 1, pan: mine.pan, distance: 0, rate: 1, delay: 0.3, priority: 3 } : null,
          );
        }
        // A storm and a blast sound where they strike (below).
        default:
          return [];
      }
    }

    case "strike": {
      if (event.item === "skyrocket") {
        // Heard from where it bursts: loud on the kart it fell on.
        const who = listenerAt(scene, event.x, event.z);
        if (!who) return [];
        const near = who.distance < 14;
        return keep(order("kart_skyrocket_burst", who, false, { radius: RADIUS.big, priority: near ? 3 : 1, ...(near ? { duck: { depth: 0.5, hold: 0.9 } } : {}) }));
      }
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      if (event.item === "blast") return keep(order("kart_blast", who, own, { radius: RADIUS.big, priority: own ? 3 : 1, ...(own ? { duck: { depth: 0.6, hold: 0.5 } } : {}) }));
      // One bolt on each kart it zaps, a few hundredths of a second apart by kart number, so a storm crackles across the pack instead of landing as one bang.
      return keep(order("kart_storm", who, own, { radius: RADIUS.big, priority: own ? 3 : 1, delay: 0.035 * (event.kart % 4), ...(own ? { duck: { depth: 0.5, hold: 1.0 } } : {}) }));
    }

    case "hit": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      const soft = event.cause === "slick" || event.cause === "decoy" || event.cause === "storm";
      const cue = soft ? "kart_spinout" : "kart_hit";
      const o = order(cue, who, own, { radius: RADIUS.big, volume: event.cause === "storm" ? 0.6 : 1, priority: own ? 3 : 1, ...(own ? { duck: { depth: 0.5, hold: 0.7 } } : {}) });
      // An item box that was not one: its smash, wrong, before the spin.
      const pop = event.cause === "decoy" ? order("kart_decoy_pop", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }) : null;
      // Wheels on oil: the skid, wet, under the whirl.
      const skid = event.cause === "slick" ? order("kart_slick_skid", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }) : null;
      // A seeker that found its kart: three beeps up and a glint, the "got you".
      const lock = event.cause === "seeker" ? order("kart_seeker_lock", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }) : null;
      return keep(pop, o, skid, lock);
    }

    case "boost": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      switch (event.source) {
        // Let go of a drift: the mini-turbo, a step higher for each spark level; the hottest gets its whoomph and run of glass under it, and the music dips for it.
        case "drift":
          return keep(
            order("kart_mini_turbo", who, own, { radius: RADIUS.medium, rate: event.level >= 3 ? 1.22 : event.level >= 2 ? 1.12 : 1, volume: event.level >= 2 ? 1 : 0.8 }),
            // The flame behind it, longer the hotter the charge.
            event.level >= 2 ? order(event.level >= 3 ? "kart_flame_long" : "kart_flame_short", who, own, { radius: RADIUS.small, volume: event.level >= 3 ? 0.9 : 0.8, delay: 0.03 }) : null,
            event.level >= 3 ? order("kart_super_turbo", who, own, { radius: RADIUS.medium, ...(own ? { duck: { depth: 0.72, hold: 0.45 } } : {}) }) : null,
          );
        // Flung out of another kart's slipstream: a stretched band let go.
        case "draft":
          return keep(order("kart_slingshot", who, own, { radius: RADIUS.medium }));
        case "nitro":
          return keep(order("kart_boost_whoosh", who, own, { radius: RADIUS.medium, ...(own ? { duck: { depth: 0.78, hold: 0.8 } } : {}) }));
        case "pad":
          return keep(order("kart_boost_pad", who, own, { radius: RADIUS.small }));
        case "start":
          return keep(order("kart_start_boost", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1, ...(own ? { duck: { depth: 0.65, hold: 0.6 } } : {}) }));
      }
      return [];
    }

    case "drift-level": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      // Blue, orange, and the hottest: the orange spark's crackle a major third higher.
      return keep(order(event.level >= 2 ? "kart_spark_orange" : "kart_spark_blue", who, !!localOf(scene, event.kart), { radius: RADIUS.small, volume: 1, rate: event.level >= 3 ? 1.26 : 1 }));
    }

    case "bump": {
      const a = scene.karts.get(event.a);
      const b = scene.karts.get(event.b);
      const own = localOf(scene, event.a) ?? localOf(scene, event.b);
      let who: Listener | null;
      if (own) who = hearKart(scene, own.kart);
      else if (a && b) who = listenerAt(scene, (a.x + b.x) / 2, (a.z + b.z) / 2);
      else who = null;
      if (!who) return [];
      const s = Math.min(1, Math.max(0, event.strength));
      const mine = own?.kart ?? event.a;
      const w = weightRate(scene, mine);
      // A tap for the light touches, a clonk with real weight for the hard ones, louder and lower the harder (and lower for a heavy kart).
      return keep(
        s >= CLONK_FROM
          ? order("kart_bump_hard", who, !!own, { radius: RADIUS.medium, volume: 0.5 + 0.5 * s, rate: (1.1 - 0.2 * s) * w })
          : order("kart_bump", who, !!own, { radius: RADIUS.medium, volume: 0.4 + 0.9 * s, rate: (1.1 - 0.2 * s) * w }),
        // The chassis groans at a hard knock (the player's own kart only).
        own && s >= 0.35 ? order("kart_creak", who, true, { volume: 0.3 + 0.6 * s, rate: w, delay: 0.04, priority: 1 }) : null,
      );
    }

    case "wall": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      const s = Math.min(1, Math.max(0, event.strength));
      return keep(
        s >= 0.3 ? order("kart_wall_thud", who, own, { radius: RADIUS.small, volume: 0.3 + 0.7 * s, rate: 1.15 - 0.3 * s }) : null,
        // The player's own scrape is a loop that lasts as long as the contact does (RaceAudio); another kart's is heard as a scrape.
        s < 0.7 && !own ? order("kart_wall_scrape", who, own, { radius: RADIUS.small, volume: 0.5 + 0.4 * (1 - s), priority: 0 }) : null,
      );
    }

    case "lap": {
      // Only the player's own laps chime. The last lap has its own jingle; a lap past the last is the finish.
      if (!localOf(scene, event.kart) || event.lap >= scene.laps) return [];
      const who = hearKart(scene, event.kart)!;
      return [{ cue: "kart_lap", volume: 1, pan: who.pan, distance: 0, rate: 1, delay: 0, priority: 3 }];
    }

    case "final-lap": {
      if (!localOf(scene, event.kart)) return [];
      const who = hearKart(scene, event.kart)!;
      return [{ cue: "kart_final_lap", volume: 1, pan: who.pan * 0.5, distance: 0, rate: 1, delay: 0, priority: 3, duck: { depth: 0.45, hold: 1.8 } }];
    }

    case "finish": {
      if (!localOf(scene, event.kart)) return [];
      const who = hearKart(scene, event.kart)!;
      const win = event.place === 1;
      return [
        { cue: win ? "kart_finish_win" : "kart_finish_ok", volume: 1, pan: who.pan * 0.4, distance: 0, rate: 1, delay: 0, priority: 3, duck: { depth: 0.3, hold: win ? 3.2 : 2.2 } },
        { cue: "kart_cheer", volume: win ? 0.9 : 0.55, pan: 0, distance: 0, rate: 1, delay: 0.3, priority: 2 },
      ];
    }

    case "jump": {
      // Off a ramp's lip a spring's boing; off the top of a hill taken fast, lighter and higher.
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_jump", who, !!localOf(scene, event.kart), { radius: RADIUS.small, ...(event.crest ? { rate: 1.15, volume: 0.7 } : {}) })) : [];
    }

    case "trick": {
      // A kick at the lip (the wheel shaken) throws the kart higher: its spiral a little higher, with a gust under it.
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      return keep(
        order("kart_trick", who, own, { radius: RADIUS.small, rate: event.kick ? 1.1 : 1 }),
        event.kick ? order("kart_boost_whoosh", who, own, { radius: RADIUS.small, volume: 0.45, rate: 1.2 }) : null,
      );
    }

    case "land": {
      // Down again; a hard landing (the sim's strength, 1 at about 10 m/s) thuds under it, deeper and louder the harder.
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      const hard = event.strength ?? 0;
      const w = weightRate(scene, event.kart);
      return keep(
        order("kart_land", who, own, { radius: RADIUS.small, rate: w }),
        hard >= THUD_FROM ? order("kart_thud", who, own, { radius: RADIUS.small, volume: 0.4 + 0.6 * hard, rate: (1.06 - 0.12 * hard) * w }) : null,
        own && hard >= 0.3 ? order("kart_creak", who, true, { volume: 0.35 + 0.55 * hard, rate: w, delay: 0.06, priority: 1 }) : null,
        event.boost ? order("kart_boost_whoosh", who, own, { radius: RADIUS.small, volume: 0.55, delay: 0.04 }) : null,
        // A trick landed is cheered (the player's own only: the others' tricks are theirs to cheer).
        event.boost && own ? order("kart_land_cheer", who, true, { delay: 0.06, priority: 2 }) : null,
      );
    }

    case "fall": {
      const who = hearKart(scene, event.kart);
      const own = !!localOf(scene, event.kart);
      return who ? keep(order("kart_fall", who, own, { radius: RADIUS.big, priority: own ? 3 : 1, ...(own ? { duck: { depth: 0.6, hold: 1.0 } } : {}) })) : [];
    }

    case "rescued": {
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_drone_drop", who, !!localOf(scene, event.kart), { radius: RADIUS.medium })) : [];
    }

    case "hazard": {
      const who = hearKart(scene, event.kart);
      const own = !!localOf(scene, event.kart);
      return who ? keep(order("kart_hazard", who, own, { radius: RADIUS.big, rate: hazardRate(event.kind), priority: own ? 3 : 1 })) : [];
    }

    case "horn": {
      // Each driver has a horn of their own (HORNS), and each kart's sits a little differently in pitch, so two honks together are two horns.
      const who = hearKart(scene, event.kart);
      const own = !!localOf(scene, event.kart);
      const cue = HORNS[scene.racers?.find((racer) => racer.id === event.kart)?.character ?? ""] ?? "kart_horn";
      return who ? keep(order(cue, who, own, { radius: RADIUS.big, rate: 0.95 + ((event.kart * 5) % 8) * 0.0143, priority: own ? 3 : 2 })) : [];
    }

    case "duck": {
      // Found: the duck squeaks for the kart that reached it, a beat later and pitched up, so it is not taken for Dabble's quack.
      const who = hearKart(scene, event.kart);
      const own = !!localOf(scene, event.kart);
      return who ? keep(order("kart_duck", who, own, { radius: RADIUS.big, rate: 1.3, delay: 0.12, priority: 3 })) : [];
    }

    case "flood": {
      // Floored too early in the countdown: at Go the engine coughs instead of driving.
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_flood", who, !!localOf(scene, event.kart), { radius: RADIUS.medium, priority: 3 })) : [];
    }

    default:
      return [];
  }
}

/**
 * What a driver's emote sounds like, when it begins: both hands up is a cheer (a party blower, confetti, a "yay"), one hand waving is a friendly
 * "hello". Only the player's own karts' (a kart's emote is read from its camera; the rest are the pictures' business). Null for none.
 */
/** The chime of the item the reel has landed on, for the player who holds it. */
export function chimeOrder(item: string, pan: number): Order {
  return { cue: `kart_get_${item}`, volume: 1, pan, distance: 0, rate: 1, delay: 0, priority: 3 };
}

/** A cheer or a wave, as it begins. */
export function emoteOrder(emote: Emote | null | undefined, pan: number): Order | null {
  if (emote !== "cheer" && emote !== "wave") return null;
  return { cue: emote === "cheer" ? "kart_emote_cheer" : "kart_emote_wave", volume: 1, pan, distance: 0, rate: 1, delay: 0, priority: 1 };
}
