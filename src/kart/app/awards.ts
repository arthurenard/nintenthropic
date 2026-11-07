/**
 * The awards (rivals.ts) as the results and the podium show them: a silly, kind title, who has it, and a few words
 * on why. Shared, so the two screens read alike.
 */
import { element } from "../../ui/dom";
import { awardWho, type Award } from "../rivals";

/** One list item for each award. */
export function awardRows(awards: readonly Award[]): HTMLElement[] {
  return awards.map((award, i) => {
    const li = element("li", "award");
    li.dataset.award = award.id;
    li.style.setProperty("--i", String(i));
    li.append(element("span", "award-title", award.title), element("span", "award-who", awardWho(award)), element("span", "award-detail", award.detail));
    return li;
  });
}

/** Fills an awards panel: the list is its items, and the panel is hidden when there are none. */
export function showAwards(panel: HTMLElement, list: HTMLElement, awards: readonly Award[]): void {
  list.replaceChildren(...awardRows(awards));
  panel.hidden = awards.length === 0;
}
