"""Fetching and caching the MediaPipe bundles.

A cached bundle is trusted on sight - the fast path only checks it is still a
zip archive - so whatever gets written under the real name has to be whole,
and has to be the very bundle the game was built against.
"""

import hashlib
import io
import urllib.request
import zipfile

import pytest

from handy import models


def bundle(size: int = models.MIN_BUNDLE_BYTES + 64) -> bytes:
    """A zip archive big enough to pass for a MediaPipe bundle."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("hand_landmarker.tflite", bytes(range(256)) * (size // 256))
    return buffer.getvalue()


def pin(monkeypatch, body: bytes, name: str = "gesture_recognizer") -> None:
    """Make ``body`` the bundle this build expects."""
    monkeypatch.setitem(models.CHECKSUMS, name, hashlib.sha256(body).hexdigest())


class Response(io.BytesIO):
    """Just enough of an HTTP response for urlopen's callers."""

    def __init__(self, body: bytes, length: int | None = None) -> None:
        super().__init__(body)
        self.headers = {} if length is None else {"Content-Length": str(length)}

    def __enter__(self): return self

    def __exit__(self, *exc): self.close()


class Truncated(io.RawIOBase):
    """A stream that dies part way through, as a reset connection does."""

    def __init__(self, before: int) -> None:
        self.before = before
        self.headers = {"Content-Length": "9999999"}

    def readinto(self, buffer):
        if self.before <= 0:
            raise ConnectionResetError("the connection went away")
        size = min(len(buffer), self.before)
        buffer[:size] = b"\0" * size
        self.before -= size
        return size

    def readable(self): return True

    def __enter__(self): return self

    def __exit__(self, *exc): pass


def serve(monkeypatch, response) -> list:
    """Answer urlopen with ``response``; returns the timeouts it was asked for."""
    timeouts = []

    def urlopen(url, timeout=None):
        timeouts.append(timeout)
        return response

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    return timeouts


def test_a_cached_bundle_is_returned_without_a_download(tmp_path, monkeypatch):
    path = tmp_path / "gesture_recognizer.task"
    path.write_bytes(bundle())
    serve(monkeypatch, None)  # entering None would raise if it were opened
    assert models.ensure_model("gesture_recognizer", path) == path


def test_a_damaged_cached_bundle_is_fetched_again(tmp_path, monkeypatch, capsys):
    """Any file under the real name was trusted for ever: a truncated bundle
    left by an older version failed inside MediaPipe on every launch."""
    path = tmp_path / "gesture_recognizer.task"
    path.write_bytes(bundle()[:-100])  # cut short: no central directory
    body = bundle()
    pin(monkeypatch, body)
    serve(monkeypatch, Response(body, len(body)))

    assert models.ensure_model("gesture_recognizer", path) == path
    assert path.read_bytes() == body
    assert "damaged" in capsys.readouterr().out


def test_a_whole_download_is_promoted_to_the_real_name(tmp_path, monkeypatch):
    body = bundle()
    pin(monkeypatch, body)
    serve(monkeypatch, Response(body, len(body)))
    path = tmp_path / "gesture_recognizer.task"

    assert models.ensure_model("gesture_recognizer", path) == path
    assert path.read_bytes() == body
    assert list(tmp_path.iterdir()) == [path], "and nothing else was left behind"


def test_an_interrupted_download_leaves_nothing_behind(tmp_path, monkeypatch):
    """`delete=False` kept the staging file, and nothing removed it: every
    failed attempt left another partial bundle in the model cache under a
    random name - the exact opposite of what the comment above it promised."""
    serve(monkeypatch, Truncated(before=4096))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(ConnectionResetError):
        models.ensure_model("gesture_recognizer", path)

    assert not path.exists()
    assert list(tmp_path.iterdir()) == []

    with pytest.raises(ConnectionResetError):
        serve(monkeypatch, Truncated(before=4096))
        models.ensure_model("gesture_recognizer", path)
    assert list(tmp_path.iterdir()) == [], "and retries do not pile up either"


def test_an_error_page_is_never_promoted_to_the_real_name(tmp_path, monkeypatch):
    """A CDN error page is a perfectly successful HTTP response. Renamed to
    gesture_recognizer.task it is then returned by the fast path for ever, and
    MediaPipe fails with an opaque model-loading error on every later run."""
    body = b"<html><body>404 Not Found</body></html>"
    serve(monkeypatch, Response(body, len(body)))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(OSError, match="not a model bundle"):
        models.ensure_model("gesture_recognizer", path)
    assert not path.exists()
    assert list(tmp_path.iterdir()) == []


def test_a_body_shorter_than_promised_is_refused(tmp_path, monkeypatch):
    body = bundle()
    pin(monkeypatch, body)
    serve(monkeypatch, Response(body, len(body) + 1024))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(OSError, match="not a model bundle"):
        models.ensure_model("gesture_recognizer", path)
    assert list(tmp_path.iterdir()) == []


def test_an_unknown_bundle_is_named_in_the_error():
    with pytest.raises(KeyError, match="pose_landmarker"):
        models.ensure_model("pose_landmarker")


def test_a_download_that_is_not_an_archive_is_refused(tmp_path, monkeypatch):
    body = b"M" * (models.MIN_BUNDLE_BYTES + 8)
    serve(monkeypatch, Response(body, len(body)))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(OSError, match="not a model bundle"):
        models.ensure_model("gesture_recognizer", path)
    assert list(tmp_path.iterdir()) == []


def test_a_bundle_other_than_the_pinned_one_is_refused(tmp_path, monkeypatch):
    """The URLs used to point at `latest`, so whatever was published next was
    what a new player got - untested against this version of the game."""
    body = bundle()
    serve(monkeypatch, Response(body, len(body)))
    monkeypatch.setitem(models.CHECKSUMS, "gesture_recognizer", "0" * 64)
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(OSError, match="sha256"):
        models.ensure_model("gesture_recognizer", path)
    assert list(tmp_path.iterdir()) == []


class Stalled(Response):
    """Headers arrive, then nothing: what a socket timeout looks like mid-body."""

    def read(self, *args):
        raise TimeoutError("timed out")

    readinto = read


def test_a_stalled_download_gives_up_rather_than_hanging_the_launch(tmp_path,
                                                                   monkeypatch):
    """urlopen was called with no timeout, and there is no default one: a
    transfer that stalled blocked the launch for ever, before any window had
    opened to say why."""
    timeouts = serve(monkeypatch, Stalled(b"", 9_000_000))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(TimeoutError):
        models.ensure_model("gesture_recognizer", path)
    assert timeouts and 0 < timeouts[0] <= 60, "a bounded wait was asked for"
    assert list(tmp_path.iterdir()) == [], "and the partial file went with it"


def test_every_bundle_is_pinned_to_a_version_and_a_checksum():
    for name, url in models.BUNDLES.items():
        assert "/latest/" not in url, name
        assert len(models.CHECKSUMS[name]) == 64, name


def test_the_cached_gesture_model_is_the_pinned_one(model_path):
    """The pin is only worth something if it names what the game is tested on."""
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    assert digest == models.CHECKSUMS["gesture_recognizer"]
