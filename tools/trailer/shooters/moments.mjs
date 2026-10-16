/**
 * The moments of a take, for the editor: when (playback seconds into the clip) a
 * hit, an explosion, a burst happens, worked out from what the game itself
 * recorded while the take was filmed (the audio cues it asked for, and the hit
 * markers and floating scores it put on the HUD), so they are exact, and are the
 * same every time the take is captured.
 */

const near = (a, b, d = 0.04) => Math.abs(a - b) <= d;

/** The hit markers, each with the floating score shown with it ("+250 Headshot"). */
function hits(hud) {
  const out = [];
  for (const h of hud.filter((e) => e.type === "hitMarker")) {
    const pop = hud.find((e) => e.type === "popup" && near(e.t, h.t));
    out.push({ t: h.t, kind: h.what, text: pop?.what ?? "" });
  }
  return out;
}

/** @returns {{t:number, what:string}[]} sorted, within the clip (0..seconds). */
export function momentsOf(clip, events, hud, seconds) {
  const out = [];
  const add = (t, what) => out.push({ t: +t.toFixed(2), what });
  const cues = (name) => events.filter((e) => e.type === "play" && e.cue === name);
  const H = hits(hud);
  switch (clip.id.slice(0, 2)) {
    case "hn": {
      for (const h of H) {
        if (/Dynamite/.test(h.text)) {
          // The bang and the shot are the same instant.
          const shot = cues("revolver_shot").some((e) => near(e.t, h.t));
          add(h.t, shot ? "shot hits the lit dynamite stick in the air: fireball" : "dynamite goes off");
        } else add(h.t, `${/Headshot/.test(h.text) ? "headshot, " : ""}bandit shot and down${/Quick Draw/.test(h.text) ? " (Quick Draw)" : ""}`);
      }
      break;
    }
    case "dn": {
      const burst = cues("night_bloat_burst").map((e) => e.t);
      for (const h of H) {
        if (burst.some((t) => near(t, h.t))) add(h.t, "the bloater bursts in a cloud of green gas");
        else if (/Chain/.test(h.text)) continue;
        else if (h.kind === "headshot" || /Headshot/.test(h.text)) add(h.t, "headshot, one of the dead drops");
        else if (h.kind === "kill") add(h.t, "one of the dead drops");
        else add(h.t, "hit on the bloater: it swells");
      }
      // A moment after the burst, those standing in the gas go down with it.
      for (const e of hud.filter((x) => x.type === "popup" && /Chain/.test(x.what))) add(e.t, `the dead beside the bloater go down in the gas (${e.what})`);
      break;
    }
    case "od": {
      for (const h of H) {
        const label = /Foil/.test(h.text) ? "laser strips a foil-wrapped piece" : /Split/.test(h.text) ? "laser splits a fragment into pieces" : h.kind === "kill" ? "laser vaporises a fragment" : "laser hit";
        add(h.t, label);
      }
      for (const e of cues("orbit_crack")) add(e.t, "a fragment strikes the glass: crack, the view jolts");
      for (const e of cues("orbit_boom")) add(e.t, "a fragment slams the cupola's frame");
      break;
    }
    case "or": {
      for (const e of cues("ridge_scope_in")) add(e.t, "the scope rises");
      for (const e of cues("ridge_rifle_shot")) add(e.t, "the shot: muzzle kick, the round leaves");
      for (const h of H) add(h.t, `the round arrives: ${/Headshot/.test(h.text) ? "headshot" : h.kind}${h.text ? ` (${h.text})` : ""}, the man goes down`);
      break;
    }
  }
  for (const m of clip.moments ?? []) add(m.t, m.what);
  // One line per instant is enough: merge those within a few frames, keeping both texts.
  out.sort((a, b) => a.t - b.t);
  const merged = [];
  for (const m of out) {
    const last = merged[merged.length - 1];
    if (last && near(last.t, m.t, 0.034) && last.what !== m.what) last.what += "; " + m.what;
    else if (!last || last.what !== m.what || !near(last.t, m.t, 0.034)) merged.push({ ...m });
  }
  return merged.filter((m) => m.t >= 0 && m.t <= seconds);
}
