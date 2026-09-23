"""Command line entry point: ``uv run python -m handy``."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from . import __version__, cameras, maps, schemes
from .app import Settings, run
from .cameras import CameraError


def _resolution(text: str) -> tuple[int, int]:
    """Parse a ``WIDTHxHEIGHT`` argument, e.g. ``1280x720``."""
    try:
        width, height = (int(part) for part in text.lower().split("x", 1))
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected WIDTHxHEIGHT, got {text!r}") from None
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("width and height must be positive")
    return width, height


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="handy",
        description="A finger-pistol arcade: four games and a Target Range warm-up.",
    )
    capture = parser.add_argument_group("capture")
    capture.add_argument("--camera", type=int, action="append", dest="cameras",
                         metavar="INDEX",
                         help="webcam index; repeat it to name several. Left out, "
                              "every camera found is used - two see depth that "
                              "one cannot")
    capture.add_argument("--list-cameras", action="store_true",
                         help="show which camera indices are available, and exit")
    capture.add_argument("--capture", type=_resolution, default=(1280, 720),
                         metavar="WxH", help="camera resolution (default: 1280x720)")
    capture.add_argument("--no-mirror", action="store_false", dest="mirror",
                         help="show the raw camera image instead of mirroring it")
    capture.add_argument("--model", type=Path, default=None, dest="model_path",
                         help="custom hand .task model; the sniper map also "
                              "loads its cached face model")

    aiming = parser.add_argument_group("aiming")
    aiming.add_argument("--min-cutoff", type=float, default=None, dest="min_cutoff",
                        help="crosshair steadiness when the aim is still, in Hz; "
                             "lower is steadier (default: per control scheme)")
    aiming.add_argument("--beta", type=float, default=None,
                        help="how fast the filter opens up as the aim moves; "
                             "higher is more responsive (default: per scheme)")
    aiming.add_argument("--fire-above", type=float, default=None, dest="fire_above",
                        help="fraction of the calibrated trigger travel that fires "
                             "(default: per control scheme)")
    aiming.add_argument("--arm-below", type=float, default=None, dest="arm_below",
                        help="fraction it must return under to re-arm "
                             "(default: per control scheme)")

    setup = parser.add_argument_group("calibration")
    setup.add_argument("--calibrate", action="store_true",
                       help="run setup again even if a calibration is saved")
    setup.add_argument("--no-calibration", action="store_true", dest="skip_calibration",
                       help="skip setup and play with the built-in defaults")
    setup.add_argument("--calibration-file", type=Path, default=None,
                       dest="calibration_path",
                       help="where the calibration is stored "
                            "(default: ~/.cache/handy/calibration.json)")

    round_group = parser.add_argument_group("round")
    round_group.add_argument("--control", default="pistol", choices=schemes.keys(),
                             help="hand aiming and thumb trigger; the sniper map "
                                  "automatically adds an eye-controlled scope")
    round_group.add_argument("--map", dest="map_key", default=None,
                             choices=maps.keys(),
                             help="skip the chooser and play this map")
    round_group.add_argument("--duration", type=float, default=60.0,
                             help="seconds per round; 0 plays endlessly "
                                  "(default: 60)")
    round_group.add_argument("--enemy", choices=("zombies", "robots"),
                             default="zombies", help="Dead of Night opponent")

    feel = parser.add_argument_group("sound and feel")
    feel.add_argument("--mute", action="store_true", help="play in silence")
    feel.add_argument("--volume", type=float, default=1.0,
                      help="0..1 output level (default: 1.0)")
    feel.add_argument("--recoil", type=float, default=26.0,
                      help="pixels the crosshair kicks per shot; 0 disables "
                           "(default: 26)")

    targets = parser.add_argument_group("targets")
    targets.add_argument("--targets", type=int, default=3,
                         help="targets standing at once (default: 3)")
    targets.add_argument("--spawn-interval", type=float, default=1.1,
                         dest="spawn_interval", help="seconds between spawns")
    targets.add_argument("--lifetime", type=float, default=5.0,
                         help="seconds a target stays up (default: 5)")
    targets.add_argument("--seed", type=int, default=None,
                         help="fix the target sequence, for practice or tests")

    parser.add_argument("--debug", action="store_true",
                        help="show the live thumb reading, for tuning the trigger")
    parser.add_argument("--screenshot-dir", type=Path, default=Path("screenshots"),
                        dest="screenshot_dir", help="where 's' saves frames")
    parser.add_argument("--version", action="version", version=f"handy {__version__}")
    parser.add_argument("--browser", action="store_true",
                        help="open the local browser arcade; choose games and controls there")
    parser.add_argument("--port", type=int, default=8765,
                        help="local browser port (with --browser)")
    parser.add_argument("--no-open", action="store_true",
                        help="start the browser server without opening a tab")
    return parser


def parse_args(argv: list[str] | None = None) -> Settings:
    parser = build_parser()
    args = parser.parse_args(argv)
    values = vars(args)
    values.pop("list_cameras", None)
    for name in ("browser", "port", "no_open"):
        values.pop(name, None)
    values["cameras"] = tuple(values["cameras"] or ())  # empty means: find them
    capture_width, capture_height = values.pop("capture")
    # Everything a bad flag can be caught by is caught here, in the terminal.
    # The alternative is discovering it from a stack trace with the camera open
    # and the window already fullscreen, which is where these used to land.
    if values["duration"] < 0:
        parser.error("--duration cannot be negative; 0 plays endlessly")
    values["duration"] = values["duration"] or None  # 0 means endless
    fire, arm = values["fire_above"], values["arm_below"]
    for name, value in (("--fire-above", fire), ("--arm-below", arm)):
        if value is not None and not 0.0 < value < 1.0:
            parser.error(f"{name} is a fraction of the trigger's travel, "
                         f"between 0 and 1; got {value}")
    # --control names the one hand scheme there is; the game picks the sniper's
    # scope for itself, so nothing past this check needs to be told.
    scheme = schemes.by_key(values.pop("control"))
    if fire is not None or arm is not None:
        # Whichever of the two was left out comes from the scheme, so the pair
        # is judged against the scheme's own value for it.
        if not ((arm if arm is not None else scheme.arm_below)
                < (fire if fire is not None else scheme.fire_above)):
            parser.error(
                "--arm-below must be under --fire-above, so that the trigger "
                "has a hysteresis band to re-cock in"
                + ("" if fire is not None and arm is not None else
                   f" (the one you left out comes from the control scheme: "
                   f"{scheme.key} {scheme.fire_above}/{scheme.arm_below})"))
    if not 0.0 <= values["volume"] <= 1.0:
        parser.error(f"--volume runs from 0 to 1; got {values['volume']}")
    if values["recoil"] < 0:
        parser.error("--recoil is a number of pixels; 0 disables it")
    # No window size to pass: the game fills the screen and measures it.
    return Settings(capture_width=capture_width, capture_height=capture_height,
                    **values)


def list_cameras() -> int:
    """Show what is connected, by name, and which of them are actually working."""
    print("Opening each camera in turn. A Continuity camera will wake its phone.\n")
    found = cameras.probe()
    if not found:
        print("No cameras answered. On macOS, grant camera access to your terminal "
              "in System Settings > Privacy & Security > Camera, then restart it.")
        return 1

    for device in found:
        print(f"  {device}")

    live = [device for device in found if device.live]
    print()
    if not live:
        print("None of them is showing a live picture. A virtual camera stays "
              "installed after its device is unplugged, and shows a frozen card.")
        return 1
    print(f"The game will use {live[0].label}: --camera {live[0].index}")
    if len(live) > 1:
        pair = " ".join(f"--camera {device.index}" for device in live[:2])
        print(f"To aim with two at once:  {pair}")
    return 0


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = sys.argv[1:]
    if "--browser" in argv:
        from .browser import main as browser_main

        return browser_main([arg for arg in argv if arg != "--browser"])
    if "--list-cameras" in argv:
        return list_cameras()
    try:
        run(parse_args(argv))
    except (CameraError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    except OSError as error:
        # The model download is the one thing here that needs the network, and
        # no network raises URLError - an OSError. Left uncaught it is a stack
        # trace, which is a poor way to be told the wifi is off.
        print(f"{error}\n\nThe game needs its MediaPipe model bundle the first "
              f"time it runs, and downloads it once. Check the network and try "
              f"again, or pass --model with a bundle you already have.",
              file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
