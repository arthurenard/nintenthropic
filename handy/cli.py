"""Command line entry point: ``uv run python -m handy``."""

from __future__ import annotations

import argparse
import math
import sys
import urllib.error
from pathlib import Path

from . import __version__, cameras, maps, schemes
from .app import ModelError, Settings, run
from .cameras import CameraError

#: The largest picture any webcam could be asked for: 8K. Past this a typo,
#: not a camera, is talking.
LARGEST_CAPTURE = (7680, 4320)

#: The flags the browser arcade reads. Everything else belongs to the desktop
#: game - the browser page makes those choices itself.
BROWSER_FLAGS = ("--browser", "--port", "--no-open")


def _resolution(text: str) -> tuple[int, int]:
    """Parse a ``WIDTHxHEIGHT`` argument, e.g. ``1280x720``."""
    try:
        width, height = (int(part) for part in text.lower().split("x", 1))
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected WIDTHxHEIGHT, got {text!r}") from None
    if width <= 0 or height <= 0:
        raise argparse.ArgumentTypeError("width and height must be positive")
    if width > LARGEST_CAPTURE[0] or height > LARGEST_CAPTURE[1]:
        raise argparse.ArgumentTypeError(
            f"{width}x{height} is beyond any webcam; the largest accepted is "
            f"{LARGEST_CAPTURE[0]}x{LARGEST_CAPTURE[1]}")
    return width, height


def _path(text: str) -> Path:
    """A path as the shell would have meant it.

    ``--calibration-file=~/x.json`` reaches us with the tilde intact - the
    shell only expands it at the start of a word - and taken literally it
    made a directory called ``~`` wherever the game was started.
    """
    return Path(text).expanduser()


def _existing_file(text: str) -> Path:
    path = _path(text)
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"no such file: {path}")
    return path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="handy",
        description="A finger-pistol arcade: four games and a Target Range warm-up.",
        # An abbreviation used to reach the game as a flag it did not know:
        # --brow was taken for --browser by the parser but not by the check
        # that decides which program to start, and opened the fullscreen game.
        allow_abbrev=False,
    )
    capture = parser.add_argument_group("capture")
    capture.add_argument("--camera", type=int, action="append", dest="cameras",
                         metavar="INDEX",
                         help="webcam index; repeat it to aim with two or more "
                              "at once. Left out, the first camera showing a "
                              "live picture is used (see --list-cameras)")
    capture.add_argument("--list-cameras", action="store_true",
                         help="show which camera indices are available, and exit")
    capture.add_argument("--capture", type=_resolution, default=(1280, 720),
                         metavar="WxH", help="camera resolution (default: 1280x720)")
    capture.add_argument("--no-mirror", action="store_false", dest="mirror",
                         help="show the raw camera image instead of mirroring it")
    capture.add_argument("--model", type=_existing_file, default=None,
                         dest="model_path",
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
                        help="how far the thumb has to fold to fire, 0 up to 1 "
                             "folded (default: per control scheme)")
    aiming.add_argument("--arm-below", type=float, default=None, dest="arm_below",
                        help="fraction it must return under to re-arm "
                             "(default: per control scheme)")

    setup = parser.add_argument_group("calibration")
    redo_or_skip = setup.add_mutually_exclusive_group()
    redo_or_skip.add_argument("--calibrate", action="store_true",
                              help="run setup again even if a calibration is saved")
    redo_or_skip.add_argument("--no-calibration", action="store_true",
                              dest="skip_calibration",
                              help="skip setup and play with the built-in defaults")
    setup.add_argument("--calibration-file", type=_path, default=None,
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
                             help="seconds per round, up to 3600; 0 plays endlessly "
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

    # What each of these reaches, map by map, since it is not the same:
    # Dead of Night, Orbital Decay and Overwatch Ridge open with --targets and
    # --spawn-interval and then add and hurry on their own; High Noon sets its
    # own pace entirely. Only the Target Range reads --lifetime, and it is not
    # a map the chooser or --map offers.
    targets = parser.add_argument_group("targets")
    targets.add_argument("--targets", type=int, default=3,
                         help="how many targets a round opens with; Dead of "
                              "Night, Orbital Decay and Overwatch Ridge add "
                              "more as it goes, High Noon ignores it (default: 3)")
    targets.add_argument("--spawn-interval", type=float, default=1.1,
                         dest="spawn_interval",
                         help="seconds between spawns as a round opens; the same "
                              "three maps shorten it as it goes, High Noon "
                              "ignores it (default: 1.1)")
    targets.add_argument("--lifetime", type=float, default=5.0,
                         help="seconds a Target Range face stays up; none of the "
                              "four maps reads it (default: 5)")
    targets.add_argument("--seed", type=int, default=None,
                         help="fix the target sequence, for practice or tests")

    parser.add_argument("--debug", action="store_true",
                        help="show the live thumb reading, for tuning the trigger")
    parser.add_argument("--screenshot-dir", type=_path, default=Path("screenshots"),
                        dest="screenshot_dir", help="where 's' saves frames")
    parser.add_argument("--version", action="version", version=f"handy {__version__}")
    parser.add_argument("--browser", action="store_true",
                        help="open the local browser arcade; choose games and "
                             "controls there. Takes --port and --no-open only")
    parser.add_argument("--port", type=int, default=8765,
                        help="local browser port (with --browser)")
    parser.add_argument("--no-open", action="store_true",
                        help="start the browser server without opening a tab "
                             "(with --browser)")
    return parser


def _typed(argv: list[str]) -> set[str]:
    """The long flags on the command line, as typed: ``{"--map", "--mute"}``.

    Exact names, because the parser accepts no abbreviations.
    """
    return {token.split("=", 1)[0] for token in argv if token.startswith("--")}


def _parse(argv: list[str] | None) -> tuple[argparse.ArgumentParser,
                                            argparse.Namespace]:
    """Parse and check the whole command line, once, for whichever program."""
    parser = build_parser()
    argv = sys.argv[1:] if argv is None else list(argv)
    args = parser.parse_args(argv)
    typed = _typed(argv)
    if args.browser:
        # The browser arcade makes its choices on the page. Handing it the
        # desktop's flags used to fail inside its own parser, under the name
        # "__main__.py" and with a bare "unrecognized arguments".
        desktop = sorted(typed - set(BROWSER_FLAGS))
        if desktop:
            parser.error(f"--browser opens the browser arcade, where games and "
                         f"controls are chosen on the page; it takes only --port "
                         f"and --no-open, not {', '.join(desktop)}")
        if not 1 <= args.port <= 65535:
            parser.error(f"--port is a TCP port, 1 to 65535; got {args.port}")
        return parser, args
    stray = [flag for flag in BROWSER_FLAGS[1:] if flag in typed]
    if stray:
        parser.error(f"{' and '.join(stray)} only apply to the browser arcade; "
                     f"add --browser")
    _check_desktop(parser, args)
    return parser, args


def _within(parser: argparse.ArgumentParser, flag: str, value: float | None,
            low: float, high: float, meaning: str, *, above: bool = False) -> None:
    """Refuse a number that is not finite or not in range, naming the flag.

    ``above`` makes the low end exclusive. NaN fails every comparison and inf
    passes every lower bound, so neither is left to the range check alone:
    each used to get through here and crash, or quietly misbehave, with the
    camera already on and the window already fullscreen.
    """
    if value is None:
        return
    in_range = (value > low if above else value >= low) and value <= high
    if not (math.isfinite(value) and in_range):
        parser.error(f"{flag} {meaning}; got {value}")


def _check_desktop(parser: argparse.ArgumentParser, args: argparse.Namespace) -> None:
    """Refuse the desktop game's impossible values before anything opens.

    Everything a bad flag can be caught by is caught here, in the terminal.
    The alternative is discovering it from a stack trace with the camera open
    and the window already fullscreen, which is where these used to land.
    """
    if args.duration < 0:
        parser.error("--duration cannot be negative; 0 plays endlessly")
    _within(parser, "--duration", args.duration, 0, 3600,
            "is the round length in seconds, up to an hour; 0 plays endlessly")
    for index in args.cameras or ():
        if index < 0:
            parser.error(f"--camera is a camera index, 0 or more (see "
                         f"--list-cameras); got {index}")
    _within(parser, "--min-cutoff", args.min_cutoff, 0, 100,
            "is the filter's resting cutoff in Hz, above 0 and at most 100",
            above=True)
    _within(parser, "--beta", args.beta, 0, 100,
            "is how fast the filter opens up with speed, from 0 to 100")
    _within(parser, "--recoil", args.recoil, 0, 200,
            "is a number of pixels, up to 200; 0 disables it")
    _within(parser, "--targets", args.targets, 1, 20,
            "is how many targets a round opens with, 1 to 20")
    _within(parser, "--spawn-interval", args.spawn_interval, 0, 60,
            "is seconds between spawns, above 0 and at most 60", above=True)
    _within(parser, "--lifetime", args.lifetime, 0, 60,
            "is seconds a target stays up, above 0 and at most 60", above=True)
    fire, arm = args.fire_above, args.arm_below
    for name, value in (("--fire-above", fire), ("--arm-below", arm)):
        if value is not None and not 0.0 < value < 1.0:
            parser.error(f"{name} is a fraction of the thumb's fold, "
                         f"between 0 and 1; got {value}")
    # --control names the one hand scheme there is; the game picks the sniper's
    # scope for itself, so nothing past this check needs to be told.
    scheme = schemes.by_key(args.control)
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
    if not 0.0 <= args.volume <= 1.0:
        parser.error(f"--volume runs from 0 to 1; got {args.volume}")


def _settings(args: argparse.Namespace) -> Settings:
    values = dict(vars(args))
    # --control has been checked; it names the one hand scheme there is.
    for name in ("list_cameras", "browser", "port", "no_open", "control"):
        values.pop(name, None)
    values["cameras"] = tuple(values["cameras"] or ())  # empty means: find them
    capture_width, capture_height = values.pop("capture")
    values["duration"] = values["duration"] or None  # 0 means endless
    # No window size to pass: the game fills the screen and measures it.
    return Settings(capture_width=capture_width, capture_height=capture_height,
                    **values)


def parse_args(argv: list[str] | None = None) -> Settings:
    """The desktop game's settings from a command line, checked."""
    _parser, args = _parse(argv)
    return _settings(args)


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
    # Parsed once, and dispatched on what the parser understood - not on the
    # raw words, which is how "--list-cameras --help" used to probe every
    # camera instead of printing the help.
    _parser, args = _parse(argv)
    if args.browser:
        from .browser import main as browser_main

        return browser_main(["--port", str(args.port),
                             *(["--no-open"] if args.no_open else [])])
    if args.list_cameras:
        return list_cameras()
    try:
        run(_settings(args))
    except (CameraError, ModelError, ValueError) as error:
        print(error, file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        # The model download is the one thing here that needs the network, and
        # no network raises URLError. Left uncaught it is a stack trace, which
        # is a poor way to be told the wifi is off.
        print(f"{error}\n\nThe game needs its MediaPipe model bundles the first "
              f"time it runs, and downloads them once. Check the network and try "
              f"again, or pass --model with a hand bundle you already have.",
              file=sys.stderr)
        return 1
    except OSError as error:
        # Any other OSError is a file or a device, not the network: a
        # read-only folder, a full disk, a calibration file that cannot be
        # written. Blaming the wifi for those sent people to the wrong place.
        print(error, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
