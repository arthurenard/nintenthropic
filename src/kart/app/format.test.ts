import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  DEFAULT_NAMES,
  NAME_LENGTH,
  cleanName,
  defaultName,
  isCode,
  itemWords,
  joinParam,
  joinUrl,
  lanAddress,
  lapLabel,
  lapsLabel,
  normaliseCode,
  ordinal,
  raceTime,
  spellCode,
} from "./format";

describe("a room's code", () => {
  it("is typed in capitals, letters only, four at most", () => {
    expect(normaliseCode("abcd")).toBe("ABCD");
    expect(normaliseCode("ab1c-d")).toBe("ABCD");
    expect(normaliseCode(" k m ")).toBe("KM");
    expect(normaliseCode("abcdefg")).toBe("ABCD");
    expect(normaliseCode("")).toBe("");
    expect(normaliseCode("abcdefg")).toHaveLength(CODE_LENGTH);
  });

  it("is whole at exactly four letters", () => {
    expect(isCode("ABCD")).toBe(true);
    expect(isCode("ABC")).toBe(false);
    expect(isCode("ABCDE")).toBe(false);
    expect(isCode("abcd")).toBe(false);
    expect(isCode("AB1D")).toBe(false);
  });

  it("is spelled out for a screen reader", () => {
    expect(spellCode("KRTZ")).toBe("K, R, T, Z");
  });

  it("is read from a link, cleaned the way the field cleans it", () => {
    expect(joinParam("?join=abcd")).toBe("ABCD");
    expect(joinParam("?net=local&join=QRST")).toBe("QRST");
    expect(joinParam("?join=ab")).toBeNull();
    expect(joinParam("?join=12345")).toBeNull();
    expect(joinParam("")).toBeNull();
  });
});

describe("the address a guest opens", () => {
  it("is the page with ?join=CODE, without its own query or hash", () => {
    expect(joinUrl("https://arcade.example/race.html?x=1#top", "ABCD")).toBe("https://arcade.example/race.html?join=ABCD");
  });

  it("keeps net=local so the guest talks the host's way", () => {
    expect(joinUrl("http://127.0.0.1:4174/race.html?net=local", "WXYZ", "local")).toBe("http://127.0.0.1:4174/race.html?join=WXYZ&net=local");
  });

  it("works under a sub-path", () => {
    expect(joinUrl("https://x.github.io/arcade/race.html", "ABCD")).toBe("https://x.github.io/arcade/race.html?join=ABCD");
  });
});

describe("times", () => {
  it("read minutes, seconds and a tenth", () => {
    expect(raceTime(48.3)).toBe("0:48.3");
    expect(raceTime(0)).toBe("0:00.0");
    expect(raceTime(61.25)).toBe("1:01.2");
    expect(raceTime(600)).toBe("10:00.0");
  });

  it("cut the tenth rather than round it, so a minute never reads 0:60.0", () => {
    expect(raceTime(59.97)).toBe("0:59.9");
    expect(raceTime(119.99)).toBe("1:59.9");
  });

  it("are a dash for a kart that did not finish", () => {
    expect(raceTime(null)).toBe("–");
    expect(raceTime(undefined)).toBe("–");
    expect(raceTime(Number.NaN)).toBe("–");
  });
});

describe("places", () => {
  it("have their suffix", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"]);
  });

  it("get the teens right", () => {
    expect([11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual(["11th", "12th", "13th", "21st", "22nd", "23rd", "101st", "111th"]);
  });

  it("are laps, never past the last", () => {
    expect(lapLabel(2, 3)).toBe("Lap 2/3");
    expect(lapLabel(4, 3)).toBe("Lap 3/3");
    expect(lapLabel(0, 3)).toBe("Lap 1/3");
    expect(lapsLabel(1)).toBe("1 lap");
    expect(lapsLabel(3)).toBe("3 laps");
  });
});

describe("names", () => {
  it("are trimmed, with one space between words", () => {
    expect(cleanName("  Maya   Lou ", "Pip")).toBe("Maya Lou");
  });

  it("lose control characters", () => {
    expect(cleanName("Ma\u0000ya\n", "Pip")).toBe("Maya");
  });

  it("are cut to fit, by whole characters", () => {
    const long = "A very long driver name indeed";
    expect(cleanName(long, "Pip")).toHaveLength(NAME_LENGTH);
    const emoji = "🏎️".repeat(20);
    expect([...cleanName(emoji, "Pip")].length).toBeLessThanOrEqual(NAME_LENGTH);
  });

  it("fall back to the default when nothing is left", () => {
    expect(cleanName("   ", "Pip")).toBe("Pip");
    expect(cleanName("\u0007", "Pip")).toBe("Pip");
  });

  it("have a friendly default that skips the names already taken", () => {
    expect(DEFAULT_NAMES).toContain(defaultName(0.5));
    expect(defaultName(0)).toBe(DEFAULT_NAMES[0]);
    expect(defaultName(0, [DEFAULT_NAMES[0].toUpperCase()])).toBe(DEFAULT_NAMES[1]);
    expect(defaultName(0.999999)).toBe(DEFAULT_NAMES[DEFAULT_NAMES.length - 1]);
    expect(defaultName(2)).toBe(DEFAULT_NAMES[DEFAULT_NAMES.length - 1]);
    // Even with every name taken there is one to give.
    expect(DEFAULT_NAMES).toContain(defaultName(0.3, DEFAULT_NAMES));
  });
});

describe("the address a friend scans", () => {
  const lan = "https://192.168.1.20:5173";

  it("swaps this computer's address for its place on the network", () => {
    expect(lanAddress("https://localhost:5173/race.html", lan)).toBe("https://192.168.1.20:5173/race.html");
    expect(lanAddress("https://127.0.0.1:5173/race.html?x=1#y", lan)).toBe("https://192.168.1.20:5173/race.html?x=1#y");
    expect(lanAddress("http://[::1]:5173/race.html", lan)).toBe("https://192.168.1.20:5173/race.html");
  });

  it("leaves a real address alone, and does nothing without a network address", () => {
    expect(lanAddress("https://grip.example/race.html", lan)).toBe("https://grip.example/race.html");
    expect(lanAddress("https://192.168.1.20:5173/race.html", lan)).toBe("https://192.168.1.20:5173/race.html");
    expect(lanAddress("https://localhost:5173/race.html", undefined)).toBe("https://localhost:5173/race.html");
    expect(lanAddress("https://localhost:5173/race.html", "not a url")).toBe("https://localhost:5173/race.html");
  });

  it("keeps the join link's query when it is built from the swapped address", () => {
    const page = lanAddress("https://localhost:5173/race.html", lan);
    expect(joinUrl(page, "ABCD")).toBe("https://192.168.1.20:5173/race.html?join=ABCD");
  });
});

describe("items on a screen with no icons", () => {
  it("names what is held, and says so while the box is still turning", () => {
    expect(itemWords(null, 0, false)).toBe("No item");
    expect(itemWords("nitro", 1, false)).toBe("Nitro");
    expect(itemWords("nitro3", 3, false)).toBe("Triple Nitro ×3");
    expect(itemWords("slick", 1, false)).toBe("Slick");
    expect(itemWords("puck", 1, true)).toBe("Picking an item…");
  });
});
