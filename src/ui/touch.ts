/** What the player has to point with, as the browser reports it. */

/** A touch screen and nothing finer (a phone, a tablet): where a mouse would be, the player plays by touch. */
export const touchOnly = (): boolean => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

/** Any touch screen at all (a hybrid laptop too): the Scope button is for a player with no Shift to hand. */
export const touchCapable = (): boolean => matchMedia("(any-pointer: coarse)").matches;
