/** What the player has to point with, as the browser reports it. */

/** A touch screen and nothing finer (a phone, a tablet): where a mouse would be, the player plays by touch. */
export const touchOnly = (): boolean => matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

/** Where the camera picture stays, named for what is in the player's hands: a phone or a tablet is not a computer. */
export const thisDevice = (): string => (touchOnly() ? "this device" : "this computer");

/** The way to play without the camera, named for what the player has to point with. */
export const pointerChoice = (): string => (touchOnly() ? "Use Touch" : "Use Mouse or Trackpad");

/** Any touch screen at all (a hybrid laptop too): the Scope button is for a player with no Shift to hand. */
export const touchCapable = (): boolean => matchMedia("(any-pointer: coarse)").matches;
