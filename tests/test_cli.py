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


# --- numbers that parse but cannot be played --------------------------------

@pytest.mark.parametrize("argv", [
    ["--duration", "inf"], ["--duration", "nan"], ["--duration", "86400"],
    ["--recoil", "inf"], ["--recoil", "nan"], ["--recoil", "5000"],
    ["--min-cutoff", "0"], ["--min-cutoff", "-1"], ["--min-cutoff", "nan"],
    ["--min-cutoff", "inf"],
    ["--beta", "-1"], ["--beta", "nan"], ["--beta", "inf"],
    ["--targets", "0"], ["--targets", "-3"], ["--targets", "1000"],
    ["--spawn-interval", "0"], ["--spawn-interval", "-1"],
    ["--spawn-interval", "nan"], ["--spawn-interval", "inf"],
    ["--lifetime", "0"], ["--lifetime", "-1"], ["--lifetime", "nan"],
    ["--camera", "-1"], ["--camera", "0", "--camera", "-2"],
    ["--capture", "99999x99999"], ["--capture", "7681x720"],
    ["--volume", "nan"],
])
def test_a_number_that_cannot_be_played_is_refused_at_the_terminal(argv, capsys):
    """Each of these used to be accepted, then crash - or quietly misbehave -
    after the camera was open and the window fullscreen."""
    with pytest.raises(SystemExit) as exited:
        cli.parse_args(argv)
    assert exited.value.code == 2
    assert argv[-2] in capsys.readouterr().err, "the message names the flag"


def test_the_edges_of_every_range_are_still_playable():
    settings = cli.parse_args([
        "--duration", "3600", "--recoil", "200", "--min-cutoff", "0.01",
        "--beta", "0", "--targets", "1", "--spawn-interval", "0.1",
        "--lifetime", "60", "--camera", "0", "--capture", "7680x4320"])
    assert settings.duration == 3600 and settings.targets == 1
    assert (settings.capture_width, settings.capture_height) == (7680, 4320)
    assert cli.parse_args(["--targets", "20", "--beta", "100"]).targets == 20


# --- one parse, one program -------------------------------------------------

@pytest.fixture
def nothing_starts(monkeypatch):
    """Fail the test if any of the three programs is actually started."""
    import handy.browser

    monkeypatch.setattr(cli, "run", lambda settings: pytest.fail("the game ran"))
    monkeypatch.setattr(cli, "list_cameras",
                        lambda: pytest.fail("the cameras were probed"))
    monkeypatch.setattr(handy.browser, "main",
                        lambda argv=None: pytest.fail("the browser server ran"))


@pytest.mark.parametrize("argv", [["--brow"], ["--list-cam"], ["--dur", "30"]])
def test_an_abbreviated_flag_is_refused_rather_than_guessed(argv, nothing_starts):
    """argparse took --brow for --browser, but main looked for the literal word,
    so the abbreviation launched the fullscreen game instead of the browser."""
    with pytest.raises(SystemExit) as exited:
        cli.main(argv)
    assert exited.value.code == 2


def test_help_wins_over_listing_the_cameras(nothing_starts, capsys):
    """`--list-cameras --help` probed every camera (and woke the phone)."""
    with pytest.raises(SystemExit) as exited:
        cli.main(["--list-cameras", "--help"])
    assert exited.value.code == 0
    assert "usage: handy" in capsys.readouterr().out


@pytest.mark.parametrize("argv", [["--port", "8766"], ["--no-open"],
                                  ["--map", "zombies", "--port=9000"]])
def test_browser_flags_without_the_browser_are_an_error(argv, nothing_starts, capsys):
    with pytest.raises(SystemExit):
        cli.main(argv)
    assert "--browser" in capsys.readouterr().err


def test_the_browser_refuses_desktop_flags_in_its_own_words(nothing_starts, capsys):
    """It used to fail inside the browser's parser as "__main__.py: error:
    unrecognized arguments", which said neither what was wrong nor whose."""
    with pytest.raises(SystemExit):
        cli.main(["--browser", "--map", "zombies", "--mute"])
    err = capsys.readouterr().err
    assert err.startswith("usage: handy")
    assert "--map" in err and "--mute" in err and "__main__" not in err


def test_the_browser_refuses_a_port_that_does_not_exist(nothing_starts, capsys):
    with pytest.raises(SystemExit):
        cli.main(["--browser", "--port", "99999"])
    assert "--port" in capsys.readouterr().err


def test_the_browser_gets_exactly_its_own_flags(monkeypatch):
    import handy.browser

    seen: list[list[str]] = []
    monkeypatch.setattr(handy.browser, "main", lambda argv=None: seen.append(argv) or 0)
    monkeypatch.setattr(cli, "run", lambda settings: pytest.fail("the game ran"))

    assert cli.main(["--browser"]) == 0
    assert cli.main(["--no-open", "--browser", "--port=8766"]) == 0
    assert seen == [["--port", "8765"], ["--port", "8766", "--no-open"]]


def test_redoing_setup_and_skipping_it_cannot_both_be_asked_for(capsys):
    with pytest.raises(SystemExit):
        cli.parse_args(["--calibrate", "--no-calibration"])
    assert "not allowed with" in capsys.readouterr().err


# --- paths ------------------------------------------------------------------

def test_a_tilde_in_a_path_flag_means_home(monkeypatch, tmp_path):
    """`--calibration-file=~/x.json` escapes the shell's expansion, and was
    taken literally: a directory called "~" appeared wherever the game ran."""
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "hand.task").write_bytes(b"bundle")

    settings = cli.parse_args(["--calibration-file=~/x.json",
                               "--screenshot-dir=~/shots", "--model=~/hand.task"])
    assert settings.calibration_path == tmp_path / "x.json"
    assert settings.screenshot_dir == tmp_path / "shots"
    assert settings.model_path == tmp_path / "hand.task"


def test_a_model_that_is_not_there_is_refused_at_the_terminal(tmp_path, capsys):
    """It used to get as far as the session and come back as the network
    message, telling the player to check a wifi that was fine."""
    with pytest.raises(SystemExit):
        cli.parse_args(["--model", str(tmp_path / "nope.task")])
    assert "nope.task" in capsys.readouterr().err


# --- honest failures ----------------------------------------------------------

def test_a_file_problem_is_not_blamed_on_the_network(monkeypatch, capsys):
    monkeypatch.setattr(cli, "run", lambda settings: (_ for _ in ()).throw(
        PermissionError(13, "Permission denied", "/read-only/calibration.json")))
    assert cli.main([]) == 1

    err = capsys.readouterr().err
    assert "Permission denied" in err
    assert "network" not in err and "download" not in err


def test_a_stalled_download_is_still_the_network(monkeypatch, capsys):
    monkeypatch.setattr(cli, "run", lambda settings: (_ for _ in ()).throw(
        TimeoutError("timed out")))
    assert cli.main([]) == 1
    assert "network" in capsys.readouterr().err
