"""
Grip Prix's key art, rendered in Blender Cycles (headless) from the game's own models:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/kart/poster/build.py -- poster
    ... -- title --samples 400
    ... -- icon
    ... -- all

Each shot writes a PNG into art/kart/poster/build/ (git-ignored); `python3 art/kart/poster/finish.py` then grades it and
encodes the shipped files (public/assets/kart/poster.webp, title.webp, icon.png, icon-180.png). See art/kart/README.md.

Options: --samples N (Cycles samples, denoised), --scale S (render at S times the final size, 1 by default),
--preview (a quick low-res look), --set key=value (override a shot's parameter, numbers or text).
"""
import os
import sys
import time

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(globals().get("__file__", sys.argv[sys.argv.index("-P") + 1] if "-P" in sys.argv else "art/kart/poster/build.py"))))

import kit  # noqa: E402

SHOTS = {
    # name: (module, final size, default samples)
    "poster": ("shot_poster", (1600, 900), 256),
    "title": ("shot_title", (2560, 1440), 256),
    "icon": ("shot_icon", (1024, 1024), 256),
}


def parse(argv):
    a = argv[argv.index("--") + 1:] if "--" in argv else []
    shots, opts = [], {"samples": None, "scale": 1.0, "preview": False, "set": {}}
    i = 0
    while i < len(a):
        t = a[i]
        if t == "--samples":
            opts["samples"] = int(a[i + 1]); i += 2
        elif t == "--scale":
            opts["scale"] = float(a[i + 1]); i += 2
        elif t == "--preview":
            opts["preview"] = True; i += 1
        elif t == "--set":
            k, v = a[i + 1].split("=", 1)
            try:
                v = float(v) if "." in v or v.lstrip("-").isdigit() else v
            except ValueError:
                pass
            opts["set"][k] = v; i += 2
        elif t == "all":
            shots += list(SHOTS); i += 1
        else:
            shots.append(t); i += 1
    return shots, opts


def main():
    shots, opts = parse(sys.argv)
    os.makedirs(kit.BUILD, exist_ok=True)
    for name in shots:
        mod_name, size, samples = SHOTS[name]
        mod = __import__(mod_name)
        s = opts["scale"] * (0.5 if opts["preview"] else 1.0)
        res = (int(size[0] * s), int(size[1] * s))
        spp = opts["samples"] or (32 if opts["preview"] else samples)
        t0 = time.time()
        scene, *rest = mod.build(res, spp, preview=opts["preview"], **opts["set"])
        t1 = time.time()
        post = rest[-1].get("post") if rest and isinstance(rest[-1], dict) else None
        if post is not None and not opts["preview"]:
            import json
            json.dump(post, open(os.path.join(kit.BUILD, f"{name}.json"), "w"))
        out = os.path.join(kit.BUILD, f"{name}{'.preview' if opts['preview'] else ''}.png")
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        print(f"{name}: scene {t1 - t0:.1f}s, render {time.time() - t1:.1f}s at {res[0]}x{res[1]} x{spp} -> {out}")


main()
