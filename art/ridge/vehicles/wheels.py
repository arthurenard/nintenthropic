"""Wheels: one prototype wheel per vehicle (tyre + steel rim), built about its
own axle (local X, the rim's outer face toward +X), baked once, then copied
into every wheel node (mirrored for the right side, doubled for the duals).

Sharing one prototype means every wheel of a vehicle shares one patch of the
atlas: the tread, sidewall and rim get four times the texels they would get
if each wheel had its own. The procedural paint is radially symmetric
(mud in the tread, dust on the sidewall) so it stays right while the wheel
spins.
"""

from .geo import Builder

# Military cross-country tyres: 7.50-20 on the truck, 6.00-16 on the jeep.
TRUCK_WHEEL = dict(R=0.485, rim=0.256, half=0.103, segs=24, rim_segs=16, hub=0.105, dish=0.035)
JEEP_WHEEL = dict(R=0.362, rim=0.205, half=0.083, segs=24, rim_segs=16, hub=0.085, dish=0.03)


def tyre_profile(R, rim, half):
    """(x, r) from the inner bead over the tread to the outer bead (clockwise in
    x-right / r-up, so the revolve faces outward). Eight segments: the tread
    is flat across (the normal map carries the lugs), the sidewalls bulge a
    little past the tread as a cross-country tyre at pressure does."""
    hs = R - rim                      # sidewall height
    return [
        (-half * 0.78, rim + 0.002),
        (-half * 0.99, rim + hs * 0.48),
        (-half * 0.84, R - hs * 0.085),
        (-half * 0.62, R - 0.003),
        (half * 0.62, R - 0.003),
        (half * 0.84, R - hs * 0.085),
        (half * 0.985, rim + hs * 0.74),
        (half, rim + hs * 0.36),
        (half * 0.80, rim + 0.002),
    ]


def rim_profile(spec):
    """(x, r) of the rim's outer face, from the flange that holds the bead to
    the hub cap: flange lip, well, dished disc, raised bolt circle, hub."""
    rim, half, hub, dish = spec["rim"], spec["half"], spec["hub"], spec["dish"]
    x0 = half * 0.80
    return [
        (x0 + 0.002, rim + 0.012),       # flange lip (just proud of the bead)
        (x0 - 0.024, rim - 0.022),       # into the well
        (dish, rim * 0.66),              # dished disc
        (dish + 0.012, hub * 1.22),      # raised bolt circle
        (dish + 0.030, hub * 0.62),      # hub
        (dish + 0.062, hub * 0.50),
        (dish + 0.074, hub * 0.26),      # hub cap
        (dish + 0.076, 0.0),
    ]


def wheel_proto(name, prefix, spec):
    """The prototype wheel as a Builder in wheel-local coordinates (no A2B)."""
    b = Builder(name, prefix, pre=None)
    b.revolve(tyre_profile(spec["R"], spec["rim"], spec["half"]), spec["segs"], "tyre", rand=0.5)
    b.revolve(rim_profile(spec), spec["rim_segs"], "rim", rand=0.5)
    # the back of the rim: a plain dished disc so the wheel is not hollow when
    # seen from inside. Its own material name lets the inner wheel of a dual
    # pair keep only this and its tyre (its face is hidden by the outer wheel)
    rim, half = spec["rim"], spec["half"]
    b.revolve([(-half * 0.78, rim + 0.002), (-half * 0.6, rim - 0.02), (spec["dish"] - 0.03, 0.0)][::-1],
              12, "rim_back", rand=0.5)
    return b
