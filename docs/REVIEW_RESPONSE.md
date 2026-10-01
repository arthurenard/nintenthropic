# Response to the product review of 28 September 2026

The review was written against a stale copy of the **Python** Handy (its
links point to `handy/browser.py`, `handy/web/app.js`, `handy/maps/…`). That
code no longer exists: Handy is now a web-native site (TypeScript, Three.js,
MediaPipe in a worker, Web Audio), kept in git under the tag `python-final`
for the old version. Every item was re-checked against the web version and
answered below.

- **Fixed**: valid on the web, and changed in this pass.
- **Already true**: the web version already does what the item asks.
- **Does not apply**: the item is about a part of the Python version the web
  version does not have (the local server, the CLI, the frame transport, the
  desktop shell).
- **Later**: valid, deliberately left for later, with the reason.

## A. Correctness, recovery, and first-play blockers

| ID | Verdict | On the web |
| --- | --- | --- |
| 01 | Does not apply | Overwatch Ridge is not on the web yet. The web HUD is one DOM glass panel fed by `readouts()`, with no raster desktop chrome, so an empty backing panel cannot happen; the port will get screenshot tests like High Noon's. |
| 02 | Already true | High Noon has no round clock: you last until you fall. The host caps one frame's step at 0.1 s on purpose (a hitch skips a beat instead of lurching); at the measured steady 60 fps nothing is lost. The timed games will count active time from the clock, not from frames, when they are ported. |
| 03 | Already true | Each click or tap is queued with its own position (`src/input/pointer.ts`); a hand shot takes the aim from just before the thumb folded. |
| 04 | Fixed | A hand lost for 1.5 s in play freezes the round; when it is seen again, a 3-2-1 countdown and play resumes. Resuming from the pause menu with the hand goes through the same countdown. A hand swung out of the picture to reload does not trip it. |
| 05 | Already true, extended | The results say "Fell on Wave 4"; they now also say what felled you and what would help ("A rifleman on the saloon roof. Riflemen aim longer from up high, so there’s time to look up."). |
| 06 | Does not apply | No scope on the web yet (Overwatch Ridge). Touch play exists: tap to fire, two-finger tap to reload. |
| 07 | Fixed | A camera that disconnects or stops sending pictures mid-round freezes the round and offers Try Again (keeps the round), Use Mouse or Trackpad (keeps the round), or Choose a Game. |
| 08 | Fixed | There is no server to call. Downloads now give up after 20 s without a byte and say so, with a specific message when you are offline; Cancel and Choose a Game never wait on anything. |
| 09 | Already true | The 3D view reprojects on resize with no stretching, and the crosshair is drawn from the same aim the shot uses; an end-to-end test resizes mid-round and fires at a known spot. |
| 10 | Already true | A miss never erases earlier hits: the score is an honest prediction over the last six shots, and outliers are dropped from the fit. Start Over, Play Anyway after twelve shots, and the saved aim retried first are all there. |
| 11 | Already true, extended | The first download shows real progress ("Getting ready… 45%"), says it happens once, and can be cancelled; it now also times out and explains being offline. |
| 12 | Does not apply | No shared server session: each tab runs its own game, and a hidden tab pauses. |

## B. Onboarding and control comfort

| ID | Verdict | On the web |
| --- | --- | --- |
| 13 | Does not apply | Handy is a website: no install, no terminal. It is now also installable as an app (web manifest and icons). Putting it online waits on making the repository public. |
| 14 | Already true | The welcome screen loops the gesture: point, fold your thumb, fire. |
| 15 | Fixed | The aim setup's status now gives live, specific help from what the camera sees: come a little closer, move back a little, keep your hand in the picture — as well as the light, distance and framing tip after twelve shots. |
| 16 | Fixed | Settings lists your cameras when there is more than one; the choice is remembered, and aims are saved per camera. A hand that suddenly appears elsewhere in the picture is ignored for a moment and cannot fire until its thumb has been raised, so someone walking past cannot jump the crosshair or fire a shot. (Tracking two hands and choosing between them was measured: it nearly doubles the tracker's cost, so it was not adopted.) |
| 17 | Already true | The aim setup learns each player's own way of pointing (a fitted map from fingertip to screen), so "point at the target" is accurate. |
| 18 | Already true, extended | The map fits whatever range the player's hand moves through, with either hand; Aim Steadiness (Responsive, Balanced, Steady) is new in Settings, and starts on Steady; Aim Assist, a switch that makes targets a little easier to hit, is on by default. |
| 19 | Already true | Start Over, Play Anyway, the saved aim tried first, and one tip matched to what the camera saw. |
| 20 | Already true, extended | The aim setup ends on "Aim 97% — You’re ready.", then the view closes in and Wave 1's title card plays before the gang moves. Coming back from a lost hand, or from the pause menu with the hand, now counts down 3-2-1. |
| 21 | Fixed | High Noon teaches each lesson once, at the moment it matters: the first townsperson, the first glint, the first dynamite, reloading until you have done it yourself. |
| 22 | Does not apply | No eye scope on the web yet; noted for Overwatch Ridge's design (a scope key and button as well as the eye). |
| 23 | Fixed | Aim Steadiness in Settings. Sensitivity is learned by the aim setup rather than set by hand. |

## C. Presentation and game feel

| ID | Verdict | On the web |
| --- | --- | --- |
| 24 | Already true | Every sound is synthesised in the browser and mixed polyphonically; nothing is filtered to a subset. |
| 25 | Fixed | With the hand, raising the thumb after a shot now clicks the hammer back; the crosshair already turns green when the gun is cocked. |
| 26 | Does not apply | One version, one feel. |
| 27 | Fixed | The preview is small in play and steps aside from where you aim; Settings can now hide it in play (it still appears when the hand is lost). |
| 28 | Fixed | Crosshair: Standard or Large, and High Contrast. |
| 29 | Fixed | Relaxed difficulty, with records kept apart. No aim magnetism: the shot should always be yours. |
| 30 | Already true, extended | Pause has Resume, Restart, Adjust Aim, Settings and Choose a Game. With the hand, folding your thumb on the results card now plays again. |

## D. Replay, progression, and personalization

| ID | Verdict | On the web |
| --- | --- | --- |
| 31 | Fixed | Your best shows on the home screen; the results say New Best and by how much, or what your best is. |
| 32 | Already true, extended | The results card has the outcome, the score, four stats, secrets found and Share; it now has the note on what felled you. |
| 33 | Fixed | Records are kept per game, difficulty, and hand or pointer. |
| 34 | Fixed | Volume, difficulty, crosshair, steadiness, camera, preview, motion and flashing are all remembered; Reset Handy clears everything. |
| 35 | Fixed | Relaxed and Standard, each explained in a line. |
| 36 | Later | Seeded daily challenges are a retention experiment for after more games exist. |
| 37 | Later | Medals and milestones, likewise; High Noon's eight secrets are its current mastery layer. |
| 38 | Later | Pass-and-play, likewise. |

## E. Improvements specific to each game

| ID | Verdict | On the web |
| --- | --- | --- |
| 39 | Later | Dead of Night is being rebuilt for the web; its design will make the survival arc legible from the start. |
| 40 | Fixed | The townsfolk lesson at the first townsperson; shooting one says who it was ("That was the barber.") and shows "−200 Townsperson" in place, readable without sound. The noon duel and Quick Draw bonus already exist. |
| 41 | Later | Orbital Decay, when rebuilt. |
| 42 | Later | Overwatch Ridge, when rebuilt. |
| 43 | Later | Every game already begins in its own practice range (the aim setup's targets); a free practice mode comes after the other games. |

## F. Accessibility, layout, and clarity

| ID | Verdict | On the web |
| --- | --- | --- |
| 44 | Fixed | A tall window showed the town streaking below the frame its art was baked for; the game now plays in a band no taller than 1.1 : 1, and a phone held upright is told to turn sideways. A short stage (a phone on its side) shrinks the score panel, buttons and hint so the street stays clear, and the aim setup's card moves beside the preview. Settings becomes a full-height sheet on a phone, and the home screen's art no longer overflows. |
| 45 | Already true | The type scale's smallest text is the 12 px eyebrow and 13 px footnote, all DOM text. |
| 46 | Later | Menus and Settings are keyboard-complete. Aiming without a hand or pointer waits for gamepad support. |
| 47 | Already true | Sheets are native modal dialogs that trap and return focus; new states are announced politely. |
| 48 | Fixed | Reduce Motion (following the system until changed) and Reduce Flashing, which keeps every shot and blast from changing the picture's brightness sharply. |
| 49 | Already true, extended | Sound starts lazily and falls back to silence on any failure; a volume slider is new. |
| 50 | Already true | The copy was rewritten with the web version (docs/DESIGN.md's voice). |

## G. Engineering, performance, and release quality

| ID | Verdict | On the web |
| --- | --- | --- |
| 51 | Already true, extended | Playwright runs the real page in Chrome with a fake camera and a scripted hand, with screenshots at several sizes; the new flows have tests. |
| 52 | Already true | Measured: a steady 60 fps at 1440 × 900 on a MacBook, GPU p50 5.3 ms, camera-to-crosshair p50 25 ms. |
| 53 | Does not apply | Nothing is transported: the camera, the tracker and the game all run in the page. |
| 54 | Fixed | The render loop stops once the results have settled; a paused game costs nothing. |
| 55 | Already true | The models ship with the site, pinned in the repository; nothing downloads `latest`. |
| 56 | Does not apply | No server sessions. |
| 57 | Does not apply | No CLI. |
| 58 | Already true, extended | Saved aims are versioned, validated and kept per camera; Forget Saved Aim and Reset Handy are new. |
| 59 | Fixed | The Python version is gone; High Noon's placeholder art is no longer in the production bundle, and a failed download says so instead of standing in a toy town. |
| 60 | Already true, extended | CI runs the type check, unit tests, build and end-to-end tests; Settings → Copy System Info gives a bug report everything but the camera picture. A licence and publishing wait on the owner. |
