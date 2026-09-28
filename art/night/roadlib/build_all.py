"""Put Route 9 together: every builder in order, then the contract nodes."""

import time


def build(lib, cols, ctx):
    from . import ground, station, roadside, motel, farm, far, trees, corn, contract, signpaint
    signpaint.out_dir(ctx.build)
    steps = [
        ("ground", lambda: ground.build(lib, cols["ground"], dense=not ctx.quick)),
        ("station", lambda: station.build(lib, cols["station"], cols["lighting"])),
        ("roadside", lambda: roadside.build(lib, cols["roadside"], cols["lighting"])),
        ("motel", lambda: motel.build(lib, cols["motel"], cols["lighting"])),
        ("farm", lambda: farm.build(lib, cols["farm"])),
        ("far", lambda: far.build(lib, cols["far"], cols["lighting"])),
        ("trees", lambda: trees.build(lib, cols["trees"], quick=ctx.quick)),
        ("corn", lambda: corn.build(lib, cols["corn"], quick=ctx.quick)),
        ("contract", lambda: contract.build(lib, cols["contract"])),
    ]
    for name, fn in steps:
        if ctx.only and name not in ctx.only and name not in ("ground", "contract"):
            continue
        t = time.time()
        fn()
        print(f"  built {name} in {time.time() - t:.1f}s", flush=True)
