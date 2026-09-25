/** Up, up, down, down, left, right, left, right, B, A: the oldest secret there is. */
export const KONAMI = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];

/** Whether the last keys typed end with the code. */
export function endsWithKonami(keys: readonly string[]): boolean {
  if (keys.length < KONAMI.length) return false;
  const tail = keys.slice(-KONAMI.length);
  return tail.every((key, i) => key === KONAMI[i]);
}

/** Watches the keyboard for the code while `active()` holds; calls `unlocked` when typed. */
export function watchKonami(active: () => boolean, unlocked: () => void): () => void {
  let keys: string[] = [];
  const listen = (event: KeyboardEvent) => {
    if (!active()) {
      keys = [];
      return;
    }
    keys = [...keys.slice(-(KONAMI.length - 1)), event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (endsWithKonami(keys)) {
      keys = [];
      unlocked();
    }
  };
  window.addEventListener("keydown", listen);
  return () => window.removeEventListener("keydown", listen);
}
