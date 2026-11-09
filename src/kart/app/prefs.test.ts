import { describe, expect, it } from "vitest";
import { DEFAULT_NAMES } from "./format";
import {
  CEILING_DAYS,
  DEFAULT_LEVELS,
  STARTERS,
  clearCeiling,
  crew,
  loadCeiling,
  loadFpsReadout,
  loadGraphics,
  loadLevels,
  loadYou,
  noteKeptUp,
  noteStrain,
  playerCount,
  saveCeiling,
  saveFpsReadout,
  saveGraphics,
  saveLevels,
  saveYou,
  setWheelChecked,
  wheelChecked,
  type You,
} from "./prefs";

/** A storage in memory, as the browser's but without the browser. */
function memory(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  };
}

describe("the player Grip Prix remembers", () => {
  it("is a friendly first-time driver with the wheel, and keeps the name it gave", () => {
    const storage = memory();
    const first = loadYou(0.5, storage);
    expect(DEFAULT_NAMES).toContain(first.name);
    expect(first.drive).toBe("wheel");
    expect(first.steering).toBe("normal");
    expect(first.players).toBe(1);
    // Everyone starts with the camera counting the players.
    expect(first.auto).toBe(true);
    // The friends' default names are never yours, nor each other's.
    expect(new Set([first.name, ...first.mates.map((mate) => mate.name)]).size).toBe(4);
    // Another visit sees the same name, whatever the dice say.
    expect(loadYou(0.99, storage).name).toBe(first.name);
  });

  it("remembers what was chosen", () => {
    const storage = memory();
    const chosen: You = {
      name: "Maya",
      drive: "keyboard",
      steering: "quick",
      character: "rivet",
      golden: true,
      players: 3,
      auto: false,
      mates: [
        { name: "Lou", character: "dabble", golden: false },
        { name: "Finn", character: "rivet", golden: true },
        { name: "Ada", character: "dabble", golden: false },
      ],
    };
    saveYou(chosen, storage);
    expect(loadYou(0, storage)).toEqual(chosen);
  });

  it("brings the first version's second player along, and counts the players on the camera", () => {
    const storage = memory({ "handy.kart.you.v1": JSON.stringify({ name: "Maya", second: true, secondName: "Lou", secondCharacter: "dabble", secondGolden: true }) });
    const you = loadYou(0, storage);
    expect(you.players).toBe(2);
    expect(you.mates[0]).toEqual({ name: "Lou", character: "dabble", golden: true });
    expect(crew(you).map((one) => one.name)).toEqual(["Maya", "Lou"]);
    expect(playerCount({ drive: "keyboard", players: 4 })).toBe(1);
    expect(crew({ ...you, players: 4 })).toHaveLength(4);
    // More than four, or fewer than one, is not a thing.
    expect(loadYou(0, memory({ "handy.kart.you.v1": JSON.stringify({ players: 9 }) })).players).toBe(4);
    expect(loadYou(0, memory({ "handy.kart.you.v1": JSON.stringify({ players: 0 }) })).players).toBe(1);
    // A count chosen before Auto came is no choice between the two: Auto. One chosen since is kept.
    expect(loadYou(0, memory({ "handy.kart.you.v1": JSON.stringify({ players: 3 }) })).auto).toBe(true);
    expect(loadYou(0, memory({ "handy.kart.you.v1": JSON.stringify({ players: 3, auto: false }) })).auto).toBe(false);
  });

  it("reads anything odd as the default", () => {
    const storage = memory({ "handy.kart.you.v1": JSON.stringify({ name: 7, drive: "jetpack", steering: "wild", second: "yes", players: "lots" }) });
    const you = loadYou(0, storage);
    expect(you.name).toBe(DEFAULT_NAMES[0]);
    expect(you.drive).toBe("wheel");
    expect(you.steering).toBe("normal");
    expect(you.players).toBe(1);
    expect(loadYou(0, memory({ "handy.kart.you.v1": "not json{" })).drive).toBe("wheel");
  });

  it("gives a first-time player a driver, a different one to the second driver, and ignores one that does not exist", () => {
    const first = loadYou(0.3, memory());
    expect(STARTERS).toContain(first.character);
    expect(first.mates.map((mate) => mate.character)).toSatisfy((ids: string[]) => ids.every((id) => STARTERS.includes(id)));
    expect(new Set([first.character, ...first.mates.map((mate) => mate.character)]).size).toBe(4);
    expect(first.golden).toBe(false);
    const odd = loadYou(0, memory({ "handy.kart.you.v1": JSON.stringify({ character: "nobody", mates: [{ character: 7 }], golden: "yes" }) }));
    expect(odd.character).toBe(STARTERS[0]);
    expect(odd.mates[0]!.character).toBe(STARTERS[3]);
    expect(odd.golden).toBe(false);
  });

  it("plays without a storage", () => {
    expect(loadYou(0, undefined).drive).toBe("wheel");
    expect(saveYou(loadYou(0, undefined), undefined)).toBe(false);
  });

  it("remembers the wheel check was done", () => {
    const storage = memory();
    expect(wheelChecked(storage)).toBe(false);
    setWheelChecked(storage);
    expect(wheelChecked(storage)).toBe(true);
  });
});

describe("the Music and Effects sliders", () => {
  it("start where the tune sits a little under the engines, and are remembered", () => {
    const storage = memory();
    expect(loadLevels(storage)).toEqual(DEFAULT_LEVELS);
    saveLevels({ music: 0.25, effects: 0.6 }, storage);
    expect(loadLevels(storage)).toEqual({ music: 0.25, effects: 0.6 });
  });

  it("read anything odd as the default, each slider on its own", () => {
    const storage = memory({ "handy.kart.sound.v1": JSON.stringify({ music: "loud", effects: 7 }) });
    expect(loadLevels(storage)).toEqual({ music: DEFAULT_LEVELS.music, effects: 1 });
    expect(loadLevels(memory({ "handy.kart.sound.v1": "{" }))).toEqual(DEFAULT_LEVELS);
    expect(loadLevels(undefined)).toEqual(DEFAULT_LEVELS);
  });
});

describe("the Graphics setting", () => {
  it("is Auto until chosen, then remembered", () => {
    const storage = memory();
    expect(loadGraphics(storage)).toBe("auto");
    expect(saveGraphics("medium", storage)).toBe(true);
    expect(loadGraphics(storage)).toBe("medium");
    saveGraphics("auto", storage);
    expect(loadGraphics(storage)).toBe("auto");
  });

  it("reads anything odd as Auto, and plays without a storage", () => {
    expect(loadGraphics(memory({ "handy.kart.graphics.v1": JSON.stringify("ultra") }))).toBe("auto");
    expect(loadGraphics(memory({ "handy.kart.graphics.v1": "{" }))).toBe("auto");
    expect(loadGraphics(undefined)).toBe("auto");
    expect(saveGraphics("high", undefined)).toBe(false);
  });

  it("keeps the safety net's ceiling until the player chooses again", () => {
    const storage = memory();
    expect(loadCeiling(storage)).toBeNull();
    saveCeiling("low", storage);
    expect(loadCeiling(storage)).toBe("low");
    saveGraphics("auto", storage);
    expect(loadCeiling(storage)).toBeNull();
    saveCeiling("medium", storage);
    clearCeiling(storage);
    expect(loadCeiling(storage)).toBeNull();
    expect(loadCeiling(memory({ "handy.kart.ceiling.v1": JSON.stringify({ tier: "ultra", at: Date.now() }) }))).toBeNull();
    expect(loadCeiling(memory({ "handy.kart.ceiling.v1": JSON.stringify("low") }))).toBeNull();
  });

  it("lets the safety net's ceiling lapse after a couple of weeks", () => {
    const storage = memory();
    const day = 86_400_000;
    saveCeiling("medium", storage, 1_000_000);
    expect(loadCeiling(storage, 1_000_000 + 13 * day)).toBe("medium");
    expect(loadCeiling(storage, 1_000_000 + CEILING_DAYS * day)).toBeNull();
    expect(saveCeiling("low", undefined)).toBe(false);
  });

  const CAPPED = 1000 / 30;

  it("gives the tier back to a browser holding the page to 30 fps, after one race shows a lower one is no quicker", () => {
    const storage = memory();
    // Chrome's Energy Saver: a race at High strains, so the next one tries Medium...
    expect(noteStrain("high", CAPPED, storage)).toBe("medium");
    expect(loadCeiling(storage)).toBe("medium");
    // ...which runs at the same 30 fps: it was not the tier. High again,
    expect(noteStrain("medium", CAPPED + 0.4, storage)).toBe("high");
    expect(loadCeiling(storage)).toBe("high");
    // and a race straining at that pace from now on changes nothing.
    for (let race = 0; race < 5; race++) expect(noteStrain("high", CAPPED - 0.3, storage)).toBe("high");
    expect(loadCeiling(storage)).toBe("high");
  });

  it("keeps a lower tier that made the races quicker, and goes lower while each step helps", () => {
    const storage = memory();
    // A GPU that manages 20 fps at High.
    expect(noteStrain("high", 50, storage)).toBe("medium");
    // Medium holds 60 fps through a race: it stays, and is no longer on trial.
    noteKeptUp("medium", storage);
    expect(loadCeiling(storage)).toBe("medium");
    // So a later heavy race at Medium tries Low, judged from Medium's frames now, not High's.
    expect(noteStrain("medium", 50, storage)).toBe("low");
    expect(noteStrain("low", 50, storage)).toBe("medium");
    expect(loadCeiling(storage)).toBe("medium");

    const other = memory();
    // Medium was quicker than High (30 fps against 20) but still strained: Low is tried...
    expect(noteStrain("high", 50, other)).toBe("medium");
    expect(noteStrain("medium", CAPPED, other)).toBe("low");
    // ...and was no quicker than Medium: back to Medium, where it settles.
    expect(noteStrain("low", CAPPED, other)).toBe("medium");
    expect(noteStrain("medium", CAPPED, other)).toBe("medium");
    expect(loadCeiling(other)).toBe("medium");
  });

  it("forgets the trials and the paces with the ceiling: after a couple of weeks, or when the player chooses", () => {
    const day = 86_400_000;
    const storage = memory();
    noteStrain("high", CAPPED, storage, 1_000_000);
    noteStrain("medium", CAPPED, storage, 1_000_000);
    expect(noteStrain("high", CAPPED, storage, 1_000_000 + 13 * day)).toBe("high");
    // Two weeks on, the pace is forgotten: a race straining at it tries Medium again.
    expect(noteStrain("high", CAPPED, storage, 1_000_000 + 13 * day + CEILING_DAYS * day)).toBe("medium");
    saveGraphics("auto", storage);
    expect(loadCeiling(storage)).toBeNull();
    expect(noteStrain("high", CAPPED, storage)).toBe("medium");
    // A lowest tier that strains has nowhere to go; nothing to keep without a storage.
    expect(noteStrain("low", 50, memory())).toBeNull();
    expect(noteStrain("high", 50, undefined)).toBe("medium");
    noteKeptUp("high", undefined);
  });

  it("reads a ceiling kept before trials existed, and anything odd as nothing", () => {
    const old = memory({ "handy.kart.ceiling.v1": JSON.stringify({ tier: "medium", at: Date.now() }) });
    expect(loadCeiling(old)).toBe("medium");
    // Not on trial: a strain under it tries the tier below.
    expect(noteStrain("medium", CAPPED, old)).toBe("low");
    for (const odd of [{ held: -1, at: Date.now() }, { trial: { tier: "high", interval: 30 }, at: Date.now() }, { tier: "medium", at: "today" }, null, 7]) {
      expect(loadCeiling(memory({ "handy.kart.ceiling.v1": JSON.stringify(odd) })), JSON.stringify(odd)).toBeNull();
    }
    // A trial with no sensible pace is a plain ceiling.
    const bent = memory({ "handy.kart.ceiling.v1": JSON.stringify({ tier: "medium", at: Date.now(), trial: { tier: "high", interval: "fast" } }) });
    expect(noteStrain("medium", CAPPED, bent)).toBe("low");
  });

  it("keeps the frame-rate readout off until it is turned on", () => {
    const storage = memory();
    expect(loadFpsReadout(storage)).toBe(false);
    saveFpsReadout(true, storage);
    expect(loadFpsReadout(storage)).toBe(true);
    expect(loadFpsReadout(undefined)).toBe(false);
  });
});
