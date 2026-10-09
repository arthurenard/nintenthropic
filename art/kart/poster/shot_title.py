"""
title.webp: the title screen's full-bleed background, a wider cinematic cut of the same meadow circuit. The left ~40% is calm
(sky, soft distant meadow) for the wordmark and the menu; the action fills the right ~60%: Pepper charges past the lens, Mango
drifts through the bend behind her with Bun and Moss on her tail. Nothing important in the top 8% or the bottom 6%.
The phone's portrait crop (object-position about 70% 50%) keeps the hero in the middle.
"""
import shot_poster
from kit import PLAYER_COLOURS

TITLE = dict(
    s_hero=522.0, u_hero=0.4,
    cam_dist=7.2, cam_phi=24.0, cam_h=1.0, lens=24.0, aim_up=0.1, aim_side=1.5, cam_roll=-2.5, shift=(0.0, 0.02),
    cast=[
        ("pepper", PLAYER_COLOURS[1], "pepper", -3.4, 3.5, 0.14, dict(steer=-0.35, lean=-0.12, slide=0.06, head_yaw=-0.25)),
        ("bun", PLAYER_COLOURS[3], "bun", -7.5, -3.6, 0.10, dict(steer=-0.4, lean=-0.1, slide=0.05, head_yaw=-0.1)),
        ("moss", PLAYER_COLOURS[2], "moss", -14.0, 1.4, 0.08, dict(steer=-0.3, lean=-0.08)),
    ],
    sky=[(-30, 24, 800, 220), (-22, 12, 1100, 250), (24, 33, 750, 200), (40, 19, 700, 150), (-45, 44, 650, 150), (-12, 38, 700, 150)],
    balloon=(10, 16, 420),
    boxes=[(-24.0, (-3.4, 0.2, 3.6))],
    windmill_rel_az=29.0, windmill_dist=190.0,
    calm_x=-0.05, trees=90, bushes=22, flowers=70,
    disc_rel_az=3.0, disc_el=16.0,
    speed=30.0,
)


def build(res=(2560, 1440), samples=256, preview=False, **over):
    return shot_poster.build(res, samples, preview, **dict(TITLE, **over))
