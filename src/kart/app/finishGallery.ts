/**
 * The finish-line photos on the results: a card for each player of the race (bots have none), in finishing order,
 * with their place, name and time on it. A player who drives with the wheel has the photo their camera took as their
 * kart crossed the line; one on keys or a pad, or whose photo has not come (another device's comes after the
 * results), has their driver's portrait in their colour, and a photo that comes later develops over it.
 *
 * The best placed player's card leads, the biggest, in a row of its own, and the others are laid out in rows of one
 * height under it (arrangePodium), so no picture is cut: beside the table on a wide screen, above it on a narrow one.
 * Nothing is kept: the pictures are the race's, in memory, unless the player shares them (finishShare.ts).
 */
import { $, element } from "../../ui/dom";
import { layoutPodium, type PhotoBox } from "./finishPhotos";
import { lookFor } from "./photoFx/looks";
import { FxPlayer, type FxHandle } from "./photoFx/player";
import type { SharedCard } from "./finishShare";
import { raceTime } from "./format";
import { colourDot } from "./ui";

/** One player's card. */
export interface ShotCard {
  kart: number;
  place: number;
  placeLabel: string;
  name: string;
  colour: string;
  time: number | null;
  /** How many raced (bots too), so the last place is known: it has its own rain cloud. */
  field?: number;
  /** Their driver (characters.ts), for the portrait that stands in for a photo. */
  character?: string;
  /** Their finish-line photo, a JPEG data URL, when there is one. */
  photo?: string | null;
}

/** A stand-in's shape, until a photo says otherwise: the photos' own when there are some. */
const STAND_IN_ASPECT = 4 / 3;
/** The space between cards, px. */
const GAP = 12;
/** Beside the table from this wide (results.css says the same), the photos at most this wide, the table at least, and the space between, px. */
const WIDE = "(min-width: 1100px)";
const SIDE_MAX = 540;
const TABLE_MIN = 600;
const BESIDE_GAP = 28;

interface Shown {
  card: ShotCard;
  figure: HTMLElement;
  picture: HTMLElement;
  /** The colour wash, stamp and animated effects over the card (photoFx). */
  fx: FxHandle;
  /** The photo's width over its height once it is decoded, or null for a stand-in. */
  aspect: number | null;
}

export class FinishGallery {
  private readonly root = $("finish-photos");
  private shown: Shown[] = [];
  private readonly watch: ResizeObserver | null = null;
  private portraits: typeof import("../render/portraits") | null = null;
  /** Counts each `show`, so a portrait or a photo decoded for the last results is not put on these. */
  private generation = 0;
  /** The shape a card with no photo is given: the photos' own (their middle one) when there are some. */
  private standInAspect = STAND_IN_ASPECT;
  private readonly player = new FxPlayer();
  /** The track raced: its look is on every card. */
  private trackId = "";

  /** `changed`: a photo was put on a card (the results offer Share once there is one). */
  constructor(private readonly changed: () => void = () => {}) {
    if (typeof ResizeObserver !== "undefined") {
      this.watch = new ResizeObserver(() => this.layout());
      // The space there is (the window), and the table's height beside the photos.
      this.watch.observe($("results-body"));
      this.watch.observe($("results-card"));
    }
  }

  /** The cards for these results (an empty list: none, and the gallery is gone). */
  show(cards: readonly ShotCard[], trackId = this.trackId): void {
    const mine = ++this.generation;
    this.trackId = trackId;
    for (const shown of this.shown) shown.fx.dispose();
    this.shown = [];
    this.root.replaceChildren();
    this.root.hidden = cards.length === 0;
    $("results-inner").classList.toggle("with-photos", cards.length > 0);
    this.changed();
    if (cards.length === 0) return;
    // Copies: a card the results change later is put on through `add`.
    this.shown = cards.map((card, index) => this.build({ ...card }, index));
    this.root.append(...this.shown.map((shown) => shown.figure));
    for (const shown of this.shown) {
      if (shown.card.photo) this.photo(shown, shown.card.photo, false);
      else this.standIn(shown, mine);
    }
    this.layout();
  }

  /** What the cards show now, for the picture to share: each card's shape and its photo, or its driver's portrait. */
  pictures(): SharedCard[] {
    return this.shown.map((shown) => {
      const photo = shown.picture.querySelector<HTMLImageElement>("img.shot-photo");
      const portrait = shown.picture.querySelector<HTMLImageElement>("img.shot-portrait");
      return { card: shown.card, aspect: shown.aspect ?? this.standInAspect, image: photo ?? portrait, photo: photo !== null };
    });
  }

  /** Whether any card has a photo. */
  get hasPhotos(): boolean {
    return this.shown.some((shown) => shown.card.photo && shown.aspect !== null);
  }

  /** A photo that came after the results (another device's): it develops over the stand-in. */
  add(kart: number, photo: string): void {
    const shown = this.shown.find((candidate) => candidate.card.kart === kart);
    if (!shown || shown.card.photo === photo) return;
    shown.card = { ...shown.card, photo };
    this.photo(shown, photo, true);
  }

  private build(card: ShotCard, index: number): Shown {
    const figure = element("figure", "shot");
    figure.dataset.place = String(card.place);
    figure.dataset.kart = String(card.kart);
    figure.style.setProperty("--i", String(index));
    figure.style.setProperty("--colour", card.colour);
    const picture = element("div", "shot-picture");
    const caption = element("figcaption", "shot-caption");
    const name = element("span", "shot-name");
    name.append(colourDot(card.colour), element("span", "shot-who", card.name));
    caption.append(element("span", "medal", card.placeLabel), name, element("span", "shot-time num", raceTime(card.time)));
    figure.append(picture, caption);
    const fx = this.player.mount(figure, { look: lookFor(this.trackId), place: card.place, field: card.field ?? 0, placeLabel: card.placeLabel });
    return { card, figure, picture, fx, aspect: null };
  }

  /** Puts the photo in the card once it is decoded (so the layout knows its shape); `late` develops it over what was there. */
  private photo(shown: Shown, photo: string, late: boolean): void {
    const mine = this.generation;
    const image = new Image();
    image.className = late ? "shot-photo late" : "shot-photo";
    image.alt = `${shown.card.name} at the finish line`;
    image.decoding = "async";
    image.src = photo;
    const put = () => {
      if (mine !== this.generation || shown.card.photo !== photo) return;
      shown.aspect = image.naturalWidth > 0 && image.naturalHeight > 0 ? image.naturalWidth / image.naturalHeight : STAND_IN_ASPECT;
      shown.figure.classList.add("has-photo");
      shown.figure.classList.toggle("late", late);
      if (late) shown.picture.append(image);
      else shown.picture.replaceChildren(image);
      // The stand-in it develops over goes once it has.
      if (late) image.addEventListener("animationend", () => shown.picture.querySelector(".shot-stand-in")?.remove(), { once: true });
      this.layout();
      this.changed();
    };
    // A picture that will not decode is left out: the stand-in stays.
    image.decode().then(put, () => {});
  }

  /** The driver's portrait in their colour, for a player with no photo (yet): drawn once the drivers' pictures are here. */
  private standIn(shown: Shown, mine: number): void {
    const box = element("div", "shot-stand-in");
    shown.picture.replaceChildren(box);
    const draw = (portraits: typeof import("../render/portraits")) => {
      if (mine !== this.generation || shown.card.photo) return;
      const url = portraits.portrait(shown.card.character, { colour: shown.card.colour, size: 256 });
      if (!url) return;
      const face = element("img", "shot-portrait");
      face.src = url;
      face.alt = "";
      box.replaceChildren(face);
    };
    if (this.portraits) return draw(this.portraits);
    import("../render/portraits")
      .then(async (module) => {
        this.portraits = module;
        await module.driversReady().catch(() => {});
        draw(module);
      })
      .catch(() => {
        // No drawing here: the colour stands in alone.
      });
  }

  /**
   * Sizes and places every card: rows of one height across the room there is, no taller than there is room for. Beside
   * the table the gallery is as wide as its widest row, so the photos and the table sit together in the middle.
   */
  private layout(): void {
    if (this.shown.length === 0 || this.root.hidden) return;
    const beside = window.matchMedia(WIDE).matches;
    const body = $("results-body").clientWidth;
    const width = beside ? Math.min(SIDE_MAX, body - TABLE_MIN - BESIDE_GAP) : body;
    if (width <= 0) return;
    const known = this.shown.map((shown) => shown.aspect).filter((aspect): aspect is number => aspect !== null);
    this.standInAspect = known.length ? known.slice().sort((a, b) => a - b)[Math.floor(known.length / 2)]! : STAND_IN_ASPECT;
    const aspects = this.shown.map((shown) => shown.aspect ?? this.standInAspect);
    const laid = layoutPodium(aspects, width, this.room(beside), GAP);
    this.root.style.width = beside ? `${Math.ceil(laid.width)}px` : "";
    this.place(laid.boxes, beside ? 0 : (width - laid.width) / 2);
    this.root.style.height = `${laid.height}px`;
  }

  /** How tall the cards may be: beside the table, its height (or a little more); above it, a third of the window. */
  private room(beside: boolean): number {
    const tall = window.innerHeight;
    if (beside) {
      const table = $("results-card").getBoundingClientRect().height;
      return Math.max(260, Math.min(tall * 0.66, Math.max(table, tall * 0.4)));
    }
    return Math.max(150, Math.min(340, tall * 0.34));
  }

  private place(boxes: readonly PhotoBox[], offset: number): void {
    boxes.forEach((box, i) => {
      const shown = this.shown[i]!;
      Object.assign(shown.figure.style, { left: `${box.x + offset}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
      // A small card says less: its words come down a size, and a narrow one keeps who over how long (the table has the time).
      shown.fx.resize(box.w, box.h);
      shown.figure.classList.toggle("small", box.h < 150 || box.w < 190);
      shown.figure.classList.toggle("tiny", box.w < 150);
      // The leader's says more, larger.
      shown.figure.classList.toggle("lead", i === 0 && boxes.length > 1 && box.h >= 180);
    });
  }

}
