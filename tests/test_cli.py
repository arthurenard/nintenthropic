"""The entry point: parsing flags, listing cameras, and failing readably.

`cli.main` and `_resolution` had no coverage at all, so `--list-cameras`, the
`--capture WxH` parser and every path that turns an exception into an exit code
were unverified - which matters, because these are the lines a player meets
before anything else works.
"""

import argparse

import pytest

from handy import cameras, cli
from handy.cameras import CameraError, Device


# --- --capture WxH ----------------------------------------------------------

def test_a_capture_size_is_parsed_into_two_numbers():
    assert cli._resolution("1280x720") == (1280, 720)
    assert cli._resolution("640X480") == (640, 480), "the X may be either case"


@pytest.mark.parametrize("text", ["1280", "1280x", "x720", "wide", "1280x720x3",
                                  "12.5x7", ""])
def test_a_capture_size_that_is_not_two_numbers_is_refused(text):
    with pytest.raises(argparse.ArgumentTypeError):
        cli._resolution(text)


@pytest.mark.parametrize("text", ["0x720", "1280x0", "-1280x720"])
def test_a_capture_size_must_be_positive(text):
    with pytest.raises(argparse.ArgumentTypeError):
        cli._resolution(text)


def test_the_capture_size_reaches_the_settings():
    settings = cli.parse_args(["--capture", "800x600"])
    assert (settings.capture_width, settings.capture_height) == (800, 600)
    default = cli.parse_args([])
    assert (default.capture_width, default.capture_height) == (1280, 720)


# --- flags that used to be checked far too late -----------------------------

def test_a_negative_round_length_is_refused_at_the_terminal():
    """`values["duration"] or None` only special-cased 0, so --duration -5 was
    accepted and the round ended before it began."""
    with pytest.raises(SystemExit):
        cli.parse_args(["--duration", "-5"])


def test_zero_seconds_still_means_endless():
    assert cli.parse_args(["--duration", "0"]).duration is None
    assert cli.parse_args(["--duration", "45"]).duration == 45.0


def test_a_trigger_with_no_hysteresis_is_refused_before_the_camera_opens():
    """--fire-above 0.1 --arm-below 0.5 was a clean ValueError - raised after
    the camera was open and the window was already fullscreen."""
    with pytest.raises(SystemExit):
        cli.parse_args(["--fire-above", "0.1", "--arm-below", "0.5"])


def test_a_lone_threshold_is_judged_against_the_schemes_it_could_meet():
    """One flag given, the other coming from the scheme: a value no scheme can
    pair with is still wrong, and still knowable here."""
    with pytest.raises(SystemExit):
        cli.parse_args(["--fire-above", "0.1"])  # under every scheme's arm_below
    with pytest.raises(SystemExit):
        cli.parse_args(["--arm-below", "0.9"])
    with pytest.raises(SystemExit):
        cli.parse_args(["--control", "pistol", "--fire-above", "0.2"])


@pytest.mark.parametrize("argv", [
    ["--fire-above", "0"], ["--fire-above", "1.5"], ["--arm-below", "-0.2"],
    ["--volume", "3"], ["--volume", "-1"], ["--recoil", "-4"],
    ["--calibration-grid", "1"],
])
def test_out_of_range_flags_are_refused(argv):
    with pytest.raises(SystemExit):
        cli.parse_args(argv)


def test_the_ordinary_flags_still_get_through():
    settings = cli.parse_args([
        "--control", "pistol", "--map", "sniper", "--duration", "30",
        "--fire-above", "0.6", "--arm-below", "0.2", "--volume", "0.4",
        "--recoil", "0", "--seed", "7", "--mute",
        "--no-mirror", "--debug",
    ])
    assert settings.control == "pistol" and settings.map_key == "sniper"
    assert settings.duration == 30.0 and settings.fire_above == 0.6
    assert settings.arm_below == 0.2 and settings.volume == 0.4
    assert settings.recoil == 0.0
    assert settings.seed == 7 and settings.mute and settings.debug
    assert settings.mirror is False


# --- --list-cameras ---------------------------------------------------------

def test_listing_cameras_names_the_one_the_game_will_use(monkeypatch, capsys):
    monkeypatch.setattr(cameras, "probe", lambda: [
        Device(index=0, name="Built-in", live=False),
        Device(index=2, name="USB webcam", live=True),
    ])
    assert cli.list_cameras() == 0

    printed = capsys.readouterr().out
    assert "USB webcam" in printed and "--camera 2" in printed


def test_listing_two_live_cameras_offers_the_pair(monkeypatch, capsys):
    monkeypatch.setattr(cameras, "probe", lambda: [
        Device(index=0, name="Built-in", live=True),
        Device(index=1, name="USB webcam", live=True),
    ])
    assert cli.list_cameras() == 0
    assert "--camera 0 --camera 1" in capsys.readouterr().out


def test_no_cameras_at_all_is_a_failure_with_advice(monkeypatch, capsys):
    monkeypatch.setattr(cameras, "probe", lambda: [])
    assert cli.list_cameras() == 1
    assert "Privacy" in capsys.readouterr().out


def test_a_camera_that_is_frozen_is_not_offered(monkeypatch, capsys):
    """A virtual camera stays installed after its device is unplugged."""
    monkeypatch.setattr(cameras, "probe",
                        lambda: [Device(index=0, name="OBS Virtual", live=False)])
    assert cli.list_cameras() == 1
    assert "frozen card" in capsys.readouterr().out


def test_main_lists_cameras_and_never_opens_the_game(monkeypatch):
    listed: list[int] = []
    monkeypatch.setattr(cli, "list_cameras", lambda: listed.append(1) or 0)
    monkeypatch.setattr(cli, "run", lambda settings: pytest.fail("the game ran"))

    assert cli.main(["--list-cameras"]) == 0
    assert listed == [1]


# --- what main does with each way of failing --------------------------------

def test_a_camera_that_will_not_open_exits_one_with_a_message(monkeypatch, capsys):
    def boom(settings):
        raise CameraError("Could not open camera 3.")

    monkeypatch.setattr(cli, "run", boom)
    assert cli.main([]) == 1
    assert "Could not open camera 3." in capsys.readouterr().err


def test_a_bad_value_exits_one_with_a_message(monkeypatch, capsys):
    monkeypatch.setattr(cli, "run", lambda settings: (_ for _ in ()).throw(
        ValueError("--model names one bundle")))
    assert cli.main([]) == 1
    assert "--model names one bundle" in capsys.readouterr().err


def test_no_network_on_the_first_run_is_a_sentence_not_a_traceback(monkeypatch,
                                                                   capsys):
    """URLError is an OSError, which `main` did not catch, so the most likely
    first-run failure in the whole project arrived as a stack trace."""
    import urllib.error

    def boom(settings):
        raise urllib.error.URLError("[Errno 8] nodename nor servname provided")

    monkeypatch.setattr(cli, "run", boom)
    assert cli.main([]) == 1

    printed = capsys.readouterr().err
    assert "nodename" in printed
    assert "--model" in printed, "it should say how to play without the download"


def test_ctrl_c_is_not_an_error(monkeypatch):
    def stop(settings):
        raise KeyboardInterrupt

    monkeypatch.setattr(cli, "run", stop)
    assert cli.main([]) == 0


def test_a_clean_run_exits_zero(monkeypatch):
    seen: list = []
    monkeypatch.setattr(cli, "run", lambda settings: seen.append(settings))
    assert cli.main(["--map", "zombies", "--mute"]) == 0
    assert seen and seen[0].map_key == "zombies"


# --- the README is the manual, and it drifts silently -----------------------

def readme_flags() -> set[str]:
    """Every long flag the README's options table documents."""
    import re
    from pathlib import Path

    text = (Path(__file__).parent.parent / "README.md").read_text()
    table = text.split("## Options", 1)[1]
    return set(re.findall(r"`(--[a-z-]+)`", table))


def parser_flags() -> set[str]:
    return {option
            for action in cli.build_parser()._actions
            for option in action.option_strings
            if option.startswith("--")}


def test_the_readme_documents_no_flag_the_parser_does_not_have():
    """`--window 1600x900` sat in the README's own example for as long as there
    had been no windowed mode; copying that line out of the manual is an
    argparse error, which is a poor first five minutes."""
    documented = readme_flags()
    assert documented, "the options table went missing"
    missing = documented - parser_flags() - {"--version"}
    assert not missing, f"documented but not accepted: {sorted(missing)}"


def test_every_flag_the_parser_accepts_is_in_the_readme():
    undocumented = parser_flags() - readme_flags() - {"--help", "--version"}
    assert not undocumented, f"accepted but undocumented: {sorted(undocumented)}"


def test_the_readme_lists_every_map_and_control_scheme():
    from pathlib import Path

    from handy import maps, schemes

    text = (Path(__file__).parent.parent / "README.md").read_text()
    table = text.split("## Options", 1)[1]
    for key in maps.keys():
        assert f"`{key}`" in table, f"--map {key} is not in the options table"
    for key in schemes.keys():
        assert f"`{key}`" in table, f"--control {key} is not in the options table"


def test_the_readme_example_command_actually_parses():
    """The one line a reader is most likely to paste."""
    import re
    from pathlib import Path

    text = (Path(__file__).parent.parent / "README.md").read_text()
    for command in re.findall(r"uv run python -m handy([^\n`]*)", text):
        argv = command.split("#")[0].split()  # the trailing comment is prose
        if any(part.startswith("~") or part.startswith("/") for part in argv):
            continue  # a path only that reader has
        cli.build_parser().parse_args(argv)  # must not exit


@pytest.mark.parametrize("control", ["gaze", "marksman"])
def test_removed_control_choices_are_rejected(control):
    with pytest.raises(SystemExit):
        cli.parse_args(["--control", control])
