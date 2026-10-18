import { describe, expect, it } from "vitest";
import { makeMatch } from "./testkit";
import { CAT_STARTLES, catLine, EAT_OUT, SECRET_NAMES, SECRETS_TOTAL, SecretTracker } from "./secrets";
import { WAVE_INTRO } from "./tuning";

describe("the secrets", () => {
  it("are eight, each with a name", () => {
    expect(SECRETS_TOTAL).toBe(8);
    expect(Object.keys(SECRET_NAMES).length).toBe(8);
  });

  it("reads EAT when G, A, S, & and the last S are shot out", () => {
    const s = new SecretTracker();
    for (const l of ["G", "A1", "S1", "amp"] as const) expect(s.sign(l).eat).toBe(false);
    const last = s.sign("S2");
    expect(last).toEqual({ dark: true, eat: true, newlyFound: true });
    expect(EAT_OUT.length).toBe(5);
    // Shooting a dark letter again changes nothing.
    expect(s.sign("G")).toEqual({ dark: false, eat: true, newlyFound: false });
  });

  it("puts EAT's own letters back on in the breather", () => {
    const s = new SecretTracker();
    s.sign("G");
    s.sign("E");
    s.sign("T");
    expect(s.readsEat()).toBe(false);
    expect(s.relight().sort()).toEqual(["E", "T"]);
    expect([...s.dark]).toEqual(["G"]);
    for (const l of ["A1", "S1", "amp", "S2"] as const) s.sign(l);
    expect(s.found.has("eat")).toBe(true);
  });

  it("turns the scarecrow's head after two seconds in the beam, the look unbroken", () => {
    const s = new SecretTracker();
    for (let i = 0; i < 90; i++) s.scarecrowLight(true, 1 / 60);
    s.scarecrowLight(false, 1 / 60);
    expect(s.scarecrowTurned).toBe(false);
    let turned = false;
    for (let i = 0; i < 125 && !turned; i++) turned = s.scarecrowLight(true, 1 / 60).turned;
    expect(turned).toBe(true);
    expect(s.found.has("scarecrow")).toBe(true);
    // Shot, it is not there any more: once.
    expect(s.scarecrowShot()).toBe(true);
    expect(s.scarecrowShot()).toBe(false);
  });

  it("a scarecrow shot before it turned is gone, and can no longer be found", () => {
    const s = new SecretTracker();
    s.scarecrowShot();
    for (let i = 0; i < 300; i++) s.scarecrowLight(true, 1 / 60);
    expect(s.found.has("scarecrow")).toBe(false);
  });

  it("rings the booth's phone once, and plays the drive-in only in a breather", () => {
    const s = new SecretTracker();
    expect(s.booth()).toEqual({ rings: true, newlyFound: true });
    expect(s.booth().rings).toBe(false);
    expect(s.driveIn(false).plays).toBe(false);
    expect(s.driveIn(true)).toEqual({ plays: true, newlyFound: true });
  });

  it("howls far off at the third shot at the moon, and closer at the fourth", () => {
    const s = new SecretTracker();
    expect(s.moon().howl).toBeNull();
    expect(s.moon().howl).toBeNull();
    expect(s.moon()).toEqual({ shots: 3, howl: "far", newlyFound: false });
    expect(s.moon()).toEqual({ shots: 4, howl: "near", newlyFound: true });
    expect(s.moon().howl).toBeNull();
  });

  it("finds the cat after three shots near it, the radio and the duck at once", () => {
    const s = new SecretTracker();
    expect(s.cat().newlyFound).toBe(false);
    expect(s.cat().newlyFound).toBe(false);
    expect(s.cat().newlyFound).toBe(true);
    expect(s.radio()).toEqual({ on: true, newlyFound: true });
    expect(s.radio().on).toBe(false);
    expect(s.radioOff()).toBe(true);
    expect(s.duck()).toEqual({ squeaks: 1, newlyFound: true });
    expect(s.count).toBe(3);
  });

  it("counts the cat's lives down as it is scared, and leaves the last scare to its name", () => {
    expect(catLine(1)).toBe("8 lives left.");
    expect(catLine(2)).toBe("7 lives left.");
    expect(catLine(CAT_STARTLES)).toBeNull();
    expect(catLine(CAT_STARTLES + 4)).toBeNull();
    expect(catLine(0)).toBeNull();
    expect(SECRET_NAMES.cat).toBe("Nine Lives");
  });

  it("through the match: announced once, never scored, never counted in accuracy", () => {
    const { m, rec } = makeMatch(1);
    for (let t = 0; t < WAVE_INTRO + 0.1; t += 1 / 60) m.update(1 / 60, false);
    m.trigger();
    m.resolveShot({ kind: "secret", shot: { secret: "duck" } });
    for (let t = 0; t < 0.5; t += 1 / 60) m.update(1 / 60, false);
    m.trigger();
    m.resolveShot({ kind: "secret", shot: { secret: "duck" } });
    expect(rec.all("secretFound").map((e) => e.args)).toEqual([["duck", "The Duck", 1, 8]]);
    expect(rec.count("duckSqueak")).toBe(2);
    expect(m.scorer.shots).toBe(0);
    expect(m.scorer.score).toBe(0);
    expect(m.results().secretsFound).toBe(1);
  });

  it("through the match: the radio stops when the next wave starts", () => {
    const { m, rec } = makeMatch(2);
    m.trigger();
    m.resolveShot({ kind: "secret", shot: { secret: "radio" } });
    expect(rec.last("radio")?.args).toEqual([true]);
    for (let t = 0; t < WAVE_INTRO + 0.1; t += 1 / 60) m.update(1 / 60, false);
    expect(rec.last("radio")?.args).toEqual([false]);
  });

  it("through the match: the scarecrow turns in the beam", () => {
    const { m, rec } = makeMatch(3);
    for (let t = 0; t < WAVE_INTRO + 0.1; t += 1 / 60) m.update(1 / 60, false);
    for (let i = 0; i < 130; i++) m.scarecrowLight(true, 1 / 60);
    expect(rec.count("scarecrowTurn")).toBe(1);
    expect(rec.last("secretFound")?.args[0]).toBe("scarecrow");
  });
});
