/** Small helpers for the page's own markup. */

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`#${id} is missing from index.html`);
  return element as T;
}

/**
 * Sets text only when it changed. Much of what the HUD writes repeats every
 * frame, and rewriting it anyway makes live regions announce it again.
 */
export function setText(target: string | Element, text: string): void {
  const element = typeof target === "string" ? $(target) : target;
  if (element.textContent !== text) element.textContent = text;
}

/** One of the page's line icons, from the sprite in index.html. */
export function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Restarts a CSS animation on an element by toggling its class. */
export function replay(node: Element, className: string): void {
  node.classList.remove(className);
  void (node as HTMLElement).offsetWidth;
  node.classList.add(className);
}

/** Spoken once by screen readers; the same words twice in a row are too. */
export function announce(message: string): void {
  const region = $("announce");
  region.textContent = "";
  requestAnimationFrame(() => (region.textContent = message));
}

let toastTimer = 0;

/** A short line at the foot of the page that fades on its own. */
export function toast(message: string, options: { icon?: string; tone?: "gold" } = {}): void {
  const node = $("toast");
  node.hidden = true;
  node.className = `toast glass${options.tone ? ` ${options.tone}` : ""}`;
  node.replaceChildren(...(options.icon ? [icon(options.icon)] : []), message);
  void node.offsetWidth; // restart its animation
  node.hidden = false;
  float(node, true);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    node.hidden = true;
    float(node, false);
  }, 4000);
}

/**
 * A popover floats over any sheet that is open (the top layer), so a toast
 * said from inside Settings is seen above it. Shown again, it goes on top.
 */
function float(node: HTMLElement, shown: boolean): void {
  if (typeof node.showPopover !== "function") return;
  try {
    if (node.matches(":popover-open")) node.hidePopover();
    if (shown) node.showPopover();
  } catch {
    // Not a popover here: it shows in the page as before.
  }
}
