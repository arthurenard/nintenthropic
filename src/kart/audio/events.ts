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
import type { RaceEvent } from "../contract";
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

/** A hash of a hazard's name to a small pitch change, so each kind is a little different. */
function hazardRate(kind: string): number {
  let h = 0;
  for (let i = 0; i < kind.length; i++) h = (h * 31 + kind.charCodeAt(i)) >>> 0;
  return 0.93 + ((h % 1000) / 1000) * 0.14;
}

const keep = (...orders: (Order | null)[]): Order[] => orders.filter((o): o is Order => o !== null);

/** The sounds for one event. */
export function ordersFor(event: RaceEvent, scene: Scene): Order[] {
  switch (event.type) {
    case "countdown":
      return [{ cue: event.n === 0 ? "kart_beep_high" : "kart_beep_low", volume: 1, pan: 0, distance: 0, rate: 1, delay: 0, priority: 3 }];

    case "pickup":
    case "box": {
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_box_smash", who, !!localOf(scene, event.kart), { radius: RADIUS.medium, volume: 1 })) : [];
    }

    case "use": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      switch (event.item) {
        case "nitro":
        case "nitro3":
          return keep(order("kart_nitro", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        case "puck":
          return keep(order("kart_puck_fire", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        case "seeker":
          return keep(order("kart_puck_fire", who, own, { radius: RADIUS.big, rate: 1.28, priority: own ? 3 : 1 }));
        case "slick":
          return keep(order("kart_slick_splat", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }));
        case "puck3":
          return keep(order("kart_puck_fire", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
        // A decoy is dropped as quietly as a slick, a little higher: the sound of an item box that is not one comes when it is driven into.
        case "decoy":
          return keep(order("kart_slick_splat", who, own, { radius: RADIUS.small, rate: 1.3, volume: 0.7, priority: own ? 2 : 0 }));
        case "comet":
          return keep(order("kart_comet", who, own, { radius: RADIUS.medium, priority: own ? 3 : 1 }));
        case "skyrocket":
          return keep(order("kart_skyrocket", who, own, { radius: RADIUS.big, priority: own ? 3 : 1 }));
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
      return keep(pop, o);
    }

    case "boost": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      switch (event.source) {
        case "drift":
          return keep(order("kart_mini_turbo", who, own, { radius: RADIUS.medium, rate: event.level >= 3 ? 1.22 : event.level >= 2 ? 1.12 : 1, volume: event.level >= 2 ? 1 : 0.8 }));
        // Flung out of another kart's slipstream: the nitro's rush of air, a little higher and lighter.
        case "draft":
          return keep(order("kart_boost_whoosh", who, own, { radius: RADIUS.medium, rate: 1.1, volume: 0.8 }));
        case "nitro":
          return keep(order("kart_boost_whoosh", who, own, { radius: RADIUS.medium }));
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
      return keep(order("kart_bump", who, !!own, { radius: RADIUS.medium, volume: 0.35 + 0.65 * s, rate: 1.12 - 0.25 * s }));
    }

    case "wall": {
      const who = hearKart(scene, event.kart);
      if (!who) return [];
      const own = !!localOf(scene, event.kart);
      const s = Math.min(1, Math.max(0, event.strength));
      return keep(
        s >= 0.3 ? order("kart_wall_thud", who, own, { radius: RADIUS.small, volume: 0.3 + 0.7 * s, rate: 1.15 - 0.3 * s }) : null,
        s < 0.7 ? order("kart_wall_scrape", who, own, { radius: RADIUS.small, volume: 0.5 + 0.4 * (1 - s), priority: own ? 1 : 0 }) : null,
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
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_jump", who, !!localOf(scene, event.kart), { radius: RADIUS.small })) : [];
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
      return keep(
        order("kart_land", who, own, { radius: RADIUS.small }),
        hard >= THUD_FROM ? order("kart_thud", who, own, { radius: RADIUS.small, volume: 0.4 + 0.6 * hard, rate: 1.06 - 0.12 * hard }) : null,
        event.boost ? order("kart_boost_whoosh", who, own, { radius: RADIUS.small, volume: 0.55, delay: 0.04 }) : null,
      );
    }

    case "fall": {
      const who = hearKart(scene, event.kart);
      return who ? keep(order("kart_fall", who, !!localOf(scene, event.kart), { radius: RADIUS.big, priority: localOf(scene, event.kart) ? 3 : 1 })) : [];
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
      // Each kart's horn sits a little differently in pitch, so two honks together are two horns. Dabble has no horn: Dabble quacks.
      const who = hearKart(scene, event.kart);
      const own = !!localOf(scene, event.kart);
      const quacks = scene.racers?.find((racer) => racer.id === event.kart)?.character === "dabble";
      return who ? keep(order(quacks ? "kart_duck" : "kart_horn", who, own, { radius: RADIUS.big, rate: 0.88 + ((event.kart * 5) % 8) * 0.04, priority: own ? 3 : 2 })) : [];
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
