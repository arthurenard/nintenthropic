/**
 * The driver select on the You screen: a big picture of who is chosen (name,
 * weight as three dots, a line about them), a grid of the nine portraits to
 * choose from, and, once the Konami code has been entered, a Golden Kart
 * switch. The ninth, Dabble the duck, is a dark shape that says "Find every
 * duck" until every duck has been found.
 *
 * It owns its markup (built into `root`); the pictures are the renderer's
 * own models drawn by render/portraits.ts, fetched after the screen is up.
 */
import { element } from "../../ui/dom";
import { CHARACTERS, characterById, type Weight } from "../characters";
import { Switch } from "./ui";

export interface DriverChoice {
  character: string;
  golden: boolean;
}

/** What this device has opened. */
export interface DriverAccess {
  /** Dabble, the duck. */
  duck: boolean;
  /** The golden kart. */
  golden: boolean;
}

const WEIGHT_WORDS: Record<Weight, string> = { light: "Light", middle: "Middle", heavy: "Heavy" };
const WEIGHT_DOTS: Record<Weight, number> = { light: 1, middle: 2, heavy: 3 };
/** The colour the pictures are painted in: the kart's, and here only a nice one. */
const PAINT = "#0A84FF";

/** Three dots, as many filled as the weight: for the picker and anything that wants to say a weight. */
export function weightDots(weight: Weight): HTMLSpanElement {
  const dots = element("span", "weight-dots");
  dots.setAttribute("role", "img");
  dots.setAttribute("aria-label", `${WEIGHT_WORDS[weight]} weight`);
  for (let i = 0; i < 3; i++) dots.append(element("i", i < WEIGHT_DOTS[weight] ? "on" : undefined));
  return dots;
}

interface Tile {
  id: string;
  button: HTMLButtonElement;
  image: HTMLImageElement;
  locked: boolean;
}

export class DriverPicker {
  private readonly hero = element("div", "driver-hero");
  private readonly heroImage = element("img", "driver-hero-img");
  private readonly heroName = element("h3", "driver-hero-name");
  private readonly heroWeight = element("p", "driver-hero-weight");
  private readonly heroBlurb = element("p", "driver-hero-blurb");
  private readonly grid = element("div", "driver-grid");
  private readonly tiles: Tile[] = [];
  private readonly goldenRow = element("div", "rows driver-golden");
  private readonly golden: Switch;
  private access: DriverAccess = { duck: false, golden: false };
  private choice: DriverChoice = { character: CHARACTERS[0]!.id, golden: false };
  private looking = "";
  private painted = false;

  constructor(
    private readonly root: HTMLElement,
    /** Who this is for, for the screen reader ("Your driver", "Second driver"). */
    label: string,
    private readonly onChange: (choice: DriverChoice) => void,
  ) {
    this.heroImage.alt = "";
    this.heroImage.width = this.heroImage.height = 160;
    const words = element("div", "driver-hero-words");
    words.append(this.heroName, this.heroWeight, this.heroBlurb);
    this.hero.append(this.heroImage, words);
    this.hero.setAttribute("aria-live", "polite");

    this.grid.setAttribute("role", "radiogroup");
    this.grid.setAttribute("aria-label", label);
    for (const character of CHARACTERS) {
      const button = element("button", "driver-tile");
      button.type = "button";
      button.setAttribute("role", "radio");
      button.dataset.id = character.id;
      const image = element("img", "driver-tile-img");
      image.alt = "";
      image.width = image.height = 128;
      const name = element("span", "driver-tile-name", character.name);
      const sub = element("span", "driver-tile-sub");
      sub.append(weightDots(character.weight));
      button.append(image, name, sub);
      button.addEventListener("click", () => this.look(character.id, true));
      button.addEventListener("focus", () => this.look(character.id, false));
      this.tiles.push({ id: character.id, button, image, locked: false });
      this.grid.append(button);
    }
    this.grid.addEventListener("keydown", (event) => this.key(event));

    const row = element("div", "row");
    const text = element("label", "row-label", "Golden Kart");
    const toggle = element("button", "switch");
    toggle.type = "button";
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", "false");
    toggle.id = `${label.replace(/\W+/g, "-").toLowerCase()}-golden`;
    text.htmlFor = toggle.id;
    row.append(text, toggle);
    this.goldenRow.append(row);
    this.golden = new Switch(toggle, (on) => {
      this.choice = { ...this.choice, golden: on };
      this.onChange(this.choice);
    });

    root.classList.add("driver-picker");
    root.replaceChildren(this.hero, this.grid, this.goldenRow);
  }

  /** Shows the picker with `choice` (a locked or unknown driver falls back to the first); returns the choice as it stands. */
  open(choice: DriverChoice, access: DriverAccess): DriverChoice {
    this.access = access;
    for (const tile of this.tiles) {
      const character = characterById(tile.id)!;
      tile.locked = character.unlock === "duck-driver" && !access.duck;
      tile.button.classList.toggle("locked", tile.locked);
      tile.button.setAttribute("aria-disabled", String(tile.locked));
      tile.button.querySelector(".driver-tile-name")!.textContent = tile.locked ? "???" : character.name;
      tile.button.setAttribute("aria-label", tile.locked ? "Locked. Find every duck." : `${character.name}, ${WEIGHT_WORDS[character.weight]} weight`);
      const sub = tile.button.querySelector(".driver-tile-sub")!;
      sub.replaceChildren(tile.locked ? element("span", "driver-tile-lock", "Find every duck") : weightDots(character.weight));
    }
    const wanted = this.tiles.find((t) => t.id === choice.character && !t.locked) ?? this.tiles[0]!;
    this.choice = { character: wanted.id, golden: access.golden && choice.golden };
    this.goldenRow.hidden = !access.golden;
    this.golden.on = this.choice.golden;
    this.select(wanted.id);
    this.look(wanted.id, false);
    void this.paint();
    return this.choice;
  }

  /** The choice as it stands. */
  get value(): DriverChoice {
    return this.choice;
  }

  private select(id: string): void {
    for (const tile of this.tiles) {
      const on = tile.id === id;
      tile.button.setAttribute("aria-checked", String(on));
      tile.button.tabIndex = on ? 0 : -1;
    }
  }

  /** Shows `id` in the big picture; `pick` also chooses them (a locked one is only shown). */
  private look(id: string, pick: boolean): void {
    const tile = this.tiles.find((t) => t.id === id);
    const character = characterById(id);
    if (!tile || !character) return;
    this.looking = id;
    if (tile.locked) {
      this.heroName.textContent = "???";
      this.heroWeight.replaceChildren();
      this.heroBlurb.textContent = "Find every duck.";
    } else {
      this.heroName.textContent = character.name;
      this.heroWeight.replaceChildren(weightDots(character.weight), document.createTextNode(` ${WEIGHT_WORDS[character.weight]}`));
      this.heroBlurb.textContent = character.blurb;
    }
    this.hero.classList.toggle("locked", tile.locked);
    void this.paintHero(id);
    if (pick && !tile.locked && id !== this.choice.character) {
      this.choice = { ...this.choice, character: id };
      this.select(id);
      this.onChange(this.choice);
    }
  }

  /** Arrows move through the nine (and choose), Home and End to the ends. */
  private key(event: KeyboardEvent): void {
    const open = this.tiles.filter((t) => !t.locked);
    const at = open.findIndex((t) => t.id === this.choice.character);
    const to = ({ ArrowRight: at + 1, ArrowDown: at + 3, ArrowLeft: at - 1, ArrowUp: at - 3, Home: 0, End: open.length - 1 } as Record<string, number>)[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = open[Math.min(open.length - 1, Math.max(0, to))]!;
    next.button.focus();
    this.look(next.id, true);
  }

  /** Draws the pictures: after the screen is up, the renderer's models (this loads three if it has not been). */
  private async paint(): Promise<void> {
    try {
      const { portrait } = await import("../render/portraits");
      for (const tile of this.tiles) {
        const url = portrait(tile.id, { colour: PAINT, silhouette: tile.locked, size: 256 });
        if (url) tile.image.src = url;
        tile.image.hidden = !url;
      }
      this.painted = true;
      void this.paintHero(this.looking);
    } catch {
      // No drawing here: the names are enough.
    }
  }

  private async paintHero(id: string): Promise<void> {
    if (!this.painted) return;
    const tile = this.tiles.find((t) => t.id === id);
    if (!tile) return;
    const { portrait } = await import("../render/portraits");
    if (this.looking !== id) return;
    const url = portrait(id, { colour: PAINT, silhouette: tile.locked, size: 320, framing: "wave" });
    if (url) this.heroImage.src = url;
    this.heroImage.hidden = !url;
  }
}
