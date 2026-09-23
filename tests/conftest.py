import threading
from pathlib import Path

import pytest

from handy.models import ensure_model

#: Worker threads the game starts and never waits for. A test that starts one
#: must not leave it running into the next test, where it competes for the CPU
#: and turns a three-second test into a thirteen-second one.
_BACKGROUND_THREADS = ("warm-maps", "synthesise-sounds")


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "real_warm_up: let app.run pre-build the maps on its worker "
                   "thread instead of skipping it")


def _bundle(name: str) -> Path:
    try:
        return ensure_model(name)
    except OSError as error:  # URLError, a timeout, a refused connection
        pytest.skip(f"the {name.replace('_', ' ')} model is not cached and could "
                    f"not be downloaded: {error}")


@pytest.fixture(scope="session")
def model_path() -> Path:
    """The gesture recognizer bundle, downloaded once and cached across runs.

    Offline with nothing cached, the tests that need a real recogniser are
    skipped rather than errored: nothing is wrong with the code they test.
    """
    return _bundle("gesture_recognizer")


@pytest.fixture(scope="session")
def face_model_path() -> Path:
    """The face landmarker bundle, on the same terms as ``model_path``."""
    return _bundle("face_landmarker")


@pytest.fixture(autouse=True)
def not_the_players_own_files(monkeypatch, tmp_path):
    """No test may read or write the player's calibration and scores.

    A test that forgets to name a calibration file lands on the default one,
    which is the player's own under ~/.cache/handy. Each test gets its own
    instead. (Swapping HOME would do it too, but matplotlib, loaded by
    MediaPipe, then rebuilds its font cache on every run: eleven seconds.)
    """
    from handy import app

    monkeypatch.setattr(app, "DEFAULT_CALIBRATION_PATH",
                        tmp_path / "home" / ".cache" / "handy" / "calibration.json")


@pytest.fixture(autouse=True)
def no_leftover_background_work(request, monkeypatch):
    """Keep each test's background work inside that test.

    Every ``app.run`` pre-builds all the maps on a worker thread - seconds of
    CPU at each new window size - and nothing waits for it. The tests are not
    about the warm-up, so it is skipped unless a test asks for it, and any
    worker a test did start is finished before the next test begins.
    """
    if request.node.get_closest_marker("real_warm_up") is None:
        from handy import app

        monkeypatch.setattr(app, "start_warm_up", lambda layout, settings: None)
    before = set(threading.enumerate())
    yield
    for thread in threading.enumerate():
        if thread not in before and thread.name in _BACKGROUND_THREADS:
            thread.join(timeout=60)
