/**
 * The eight secrets of Route 9 and what triggers each one. The world
 * (world/secretsWorld.ts) makes them happen on screen; this only decides
 * when one is found, so the rules can be tested without a road.
 */
export type SecretId = "eat" | "scarecrow" | "booth" | "drivein" | "moon" | "cat" | "radio" | "duck";

/** What the toast calls each one when it is found: mostly what happened (Wrong Number), not where. */
export const SECRET_NAMES: Record<SecretId, string> = {
  eat: "Eat",
  scarecrow: "The Scarecrow",
  booth: "Wrong Number",
  drivein: "The Late Show",
  moon: "Something Howled Back",
  cat: "Nine Lives",
  radio: "Easy Listening",
  duck: "The Duck",
};

export const SECRETS_TOTAL = 8;

/** The neon sign's letters, as the road names them (`secret.sign.<letter>`): GAS & EATS. */
export type SignLetter = "G" | "A1" | "S1" | "amp" | "E" | "A2" | "T" | "S2";
export const SIGN_LETTERS: readonly SignLetter[] = ["G", "A1", "S1", "amp", "E", "A2", "T", "S2"];
/** Shoot these out and the sign reads EAT. */
export const EAT_OUT: readonly SignLetter[] = ["G", "A1", "S1", "amp", "S2"];

/** How long the beam must rest on the scarecrow before it turns its head. */
export const SCARECROW_LIGHT = 2;
export const MOON_HOWL = 3;
export const MOON_ANSWER = 4;
/** Shots near the cat before it has been everywhere: it survives everything. */
export const CAT_STARTLES = 3;

/**
 * What a scare costs the cat, as the popup over it says ("8 lives left.");
 * nothing on the last, when the secret's own name says the rest.
 */
export function catLine(startles: number): string | null {
  return startles >= 1 && startles < CAT_STARTLES ? `${9 - startles} lives left.` : null;
}

/** The duck, shot: whatever happens on Route 9, it is fine. */
export const DUCK_LINE = "The duck is fine.";

/** What a shot at one of the secrets is, as the world's ray tests found it. */
export type SecretShot =
  | { secret: "sign"; letter: SignLetter }
  | { secret: "scarecrow" }
  | { secret: "booth" }
  | { secret: "drivein" }
  | { secret: "moon" }
  | { secret: "cat" }
  | { secret: "radio" }
  | { secret: "duck" };

export class SecretTracker {
  readonly found = new Set<SecretId>();
  /** The sign's letters shot dark. */
  readonly dark = new Set<SignLetter>();
  /** Seconds the beam has rested on the scarecrow, in one look. */
  scarecrowLit = 0;
  scarecrowTurned = false;
  scarecrowGone = false;
  boothOut = false;
  moonShots = 0;
  catStartles = 0;
  radioOn = false;
  duckShots = 0;

  get count(): number {
    return this.found.size;
  }

  /** Marks a secret found; true only the first time. */
  private find(id: SecretId): boolean {
    if (this.found.has(id)) return false;
    this.found.add(id);
    return true;
  }

  /**
   * A neon letter shot out. When exactly G, A, S, & and the last S are
   * dark, the sign reads EAT. A letter of EAT shot out goes dark too, and
   * sputters back on in the next breather.
   */
  sign(letter: SignLetter): { dark: boolean; eat: boolean; newlyFound: boolean } {
    const was = this.dark.has(letter);
    this.dark.add(letter);
    const eat = this.readsEat();
    return { dark: !was, eat, newlyFound: eat ? this.find("eat") : false };
  }

  readsEat(): boolean {
    return this.dark.size === EAT_OUT.length && EAT_OUT.every((l) => this.dark.has(l));
  }

  /** The breather: the letters of EAT that were shot out come back on. Returns them. */
  relight(): SignLetter[] {
    const back: SignLetter[] = [];
    for (const l of [...this.dark]) {
      if (!EAT_OUT.includes(l)) {
        this.dark.delete(l);
        back.push(l);
      }
    }
    return back;
  }

  /**
   * The beam on the scarecrow (or off it: `lit` false resets the look).
   * After two seconds in the light it turns its head to follow you.
   */
  scarecrowLight(lit: boolean, dt: number): { turned: boolean; newlyFound: boolean } {
    if (this.scarecrowGone || this.scarecrowTurned) return { turned: false, newlyFound: false };
    this.scarecrowLit = lit ? this.scarecrowLit + dt : 0;
    if (this.scarecrowLit < SCARECROW_LIGHT) return { turned: false, newlyFound: false };
    this.scarecrowTurned = true;
    return { turned: true, newlyFound: this.find("scarecrow") };
  }

  /** Shot, the scarecrow is not there any more. */
  scarecrowShot(): boolean {
    if (this.scarecrowGone) return false;
    this.scarecrowGone = true;
    return true;
  }

  /** The booth's light shot out: the phone rings, and the motel's rings back. */
  booth(): { rings: boolean; newlyFound: boolean } {
    if (this.boothOut) return { rings: false, newlyFound: false };
    this.boothOut = true;
    return { rings: true, newlyFound: this.find("booth") };
  }

  /** The projector's lamp on the hill, which can only be seen when the fog thins between waves. */
  driveIn(breather: boolean): { plays: boolean; newlyFound: boolean } {
    if (!breather) return { plays: false, newlyFound: false };
    return { plays: true, newlyFound: this.find("drivein") };
  }

  /** The moon: three shots, a howl far off; the fourth, one much closer. */
  moon(): { shots: number; howl: "far" | "near" | null; newlyFound: boolean } {
    this.moonShots++;
    const n = this.moonShots;
    if (n === MOON_HOWL) return { shots: n, howl: "far", newlyFound: false };
    if (n === MOON_ANSWER) return { shots: n, howl: "near", newlyFound: this.find("moon") };
    return { shots: n, howl: null, newlyFound: false };
  }

  /** A shot near the cat: a hiss, and it moves on; the third time, it has been everywhere. */
  cat(): { startles: number; newlyFound: boolean } {
    this.catStartles++;
    return { startles: this.catStartles, newlyFound: this.catStartles >= CAT_STARTLES ? this.find("cat") : false };
  }

  /** The radio behind the counter: a 1950s ballad, until the next wave. */
  radio(): { on: boolean; newlyFound: boolean } {
    const was = this.radioOn;
    this.radioOn = true;
    return { on: !was, newlyFound: this.find("radio") };
  }

  /** The next wave begins: the radio has played its song. */
  radioOff(): boolean {
    const was = this.radioOn;
    this.radioOn = false;
    return was;
  }

  duck(): { squeaks: number; newlyFound: boolean } {
    this.duckShots++;
    return { squeaks: this.duckShots, newlyFound: this.find("duck") };
  }
}
