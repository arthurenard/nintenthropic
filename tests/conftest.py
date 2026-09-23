import os
import tempfile
import threading
from pathlib import Path

import pytest

from handy.models import cache_dir, ensure_model

# No test may read or write the player's own calibration and scores. Their
# default location is worked out from the home directory when handy.app is
# imported, so the home directory is swapped for a scratch one here, before
# any test module gets the chance to import the game. The model cache is
# pinned to the real one first: the bundles are worth downloading once, not
# once per run.
os.environ.setdefault("HANDY_MODEL_DIR", str(cache_dir()))
_SCRATCH_HOME = tempfile.TemporaryDirectory(prefix="handy-tests-home-")
os.environ["HOME"] = _SCRATCH_HOME.name

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
