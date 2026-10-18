"""Walking and running in place, with the foot rolling heel-to-toe on a
ground that slides back at the gait's speed - so the game moves the root at
exactly `speed` m/s and no foot ever skates.

Each leg: a stance phase (duty of the cycle) and a swing. In stance the foot
is a rigid body on the moving ground: it lands on the heel (toes up), rolls
flat, then pivots on the ball as the heel lifts, and pushes off. The ankle
(the IK target) is computed from whichever point the foot is pivoting on.
In swing the ankle travels forward on a smooth arc with the knee lifting it
clear, the foot pitching from push-off to the next heel strike.

Armature axes: x = his left, y = back, z = up; he faces -y. The ground under
a standing boot is z = 0; the ankle joint is 0.102 above it.
"""
import math
import numpy as np

ANKLE_Z = 0.102
HEEL = np.array([0.0, 0.048, -ANKLE_Z])     # heel's ground point, from the ankle (foot flat)
BALL = np.array([0.0, -0.122, -ANKLE_Z])    # ball of the foot's ground point, from the ankle


def rx(deg, p):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return np.array([p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c])


def smooth(u):
    u = min(max(u, 0.0), 1.0)
    return u * u * (3 - 2 * u)


class Gait:
    """speed m/s, period T s (two steps), duty = stance fraction, y0 = the
    flat foot's ankle y at heel strike (ahead of the hip, negative),
    strike/push = foot pitch (deg) at heel strike (toes up, negative) and at
    toe-off (toes down), lift = swing clearance (m), x = half the track
    width, toe_out = foot yaw (deg), roll = (heel phase, ball phase) as
    fractions of stance."""

    def __init__(self, speed, T, duty, y0, strike=-16.0, push=38.0, lift=0.10, x=0.10, toe_out=7.0,
                 roll=(0.14, 0.60), swing_peak=0.35, land_flat=False):
        self.speed, self.T, self.duty, self.y0 = speed, T, duty, y0
        self.strike, self.push, self.lift, self.x, self.toe_out = strike, push, lift, x, toe_out
        self.roll = roll
        self.swing_peak = swing_peak
        self.land_flat = land_flat
        self.travel = speed * duty * T

    def stance(self, u):
        """(ankle y, ankle z, pitch) at fraction u of stance."""
        y_flat = self.y0 + u * self.travel
        a, b = self.roll
        flat = np.array([0.0, y_flat, ANKLE_Z])
        if u < a and not self.land_flat:
            pitch = self.strike * (1 - smooth(u / a))
            heel = flat + HEEL
            p = heel + rx(pitch, -HEEL)
        elif u > b:
            pitch = self.push * ((u - b) / (1 - b)) ** 1.4
            ball = flat + BALL
            p = ball + rx(pitch, -BALL)
        else:
            pitch = 0.0
            p = flat
        return p[1], p[2], pitch

    def swing(self, u):
        y0, z0, p0 = self.stance(1.0)
        y1, z1, p1 = self.stance(0.0)
        s = smooth(u)
        # forward fast in the middle; the foot reaches out and settles
        y = y0 + (y1 - y0) * (0.5 - 0.5 * math.cos(math.pi * min(u * 1.05, 1.0)))
        k = self.swing_peak
        h = math.sin(math.pi * min(u / (2 * k), 0.5)) if u < k else math.cos(0.5 * math.pi * (u - k) / (1 - k))
        z = z0 + (z1 - z0) * s + self.lift * max(h, 0.0) * (1 - 0.35 * u)
        # pitch: from push-off through level to the heel-strike attitude
        if u < 0.45:
            pitch = p0 * (1 - smooth(u / 0.45)) + 8.0 * smooth(u / 0.45)
        else:
            pitch = 8.0 + (p1 - 8.0) * smooth((u - 0.45) / 0.55)
        return y, z, pitch

    def foot(self, phase):
        """(ankle y, z, pitch) at a leg's phase in [0, 1): 0 = heel strike."""
        phase %= 1.0
        if phase < self.duty:
            return self.stance(phase / self.duty)
        return self.swing((phase - self.duty) / (1 - self.duty))

    def keys(self, clip, n=24, x_off=(0.0, 0.0)):
        """Key both feet on `clip` (n samples a cycle, looping): left leg at
        phase 0 at t = 0, the right half a cycle later."""
        T = self.T
        for i in range(n + 1):
            t = T * i / n
            for side, ph0, sx in (("L", 0.0, 1.0), ("R", 0.5, -1.0)):
                y, z, pitch = self.foot(t / T + ph0)
                x = sx * self.x + (x_off[0] if side == "L" else x_off[1])
                clip.key(t, "linear", **{f"ik__foot__{side}": (x, y, z), f"rot__foot__{side}": (pitch, 0.0, sx * self.toe_out),
                                         f"pole__foot__{side}": (sx * 0.12, -1.0, 0.15)})
