"""Fetching and caching the MediaPipe bundles.

A cached bundle is trusted forever after - the fast path is `path.exists()` -
so whatever gets written under the real name has to be whole.
"""

import io
import urllib.request

import pytest

from handy import models


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


def serve(monkeypatch, response) -> None:
    monkeypatch.setattr(urllib.request, "urlopen", lambda url: response)


def test_a_cached_bundle_is_returned_without_a_download(tmp_path, monkeypatch):
    path = tmp_path / "gesture_recognizer.task"
    path.write_bytes(b"x")
    serve(monkeypatch, None)  # urlopen(None) would raise if it were called
    assert models.ensure_model("gesture_recognizer", path) == path


def test_a_whole_download_is_promoted_to_the_real_name(tmp_path, monkeypatch):
    body = b"M" * (models.MIN_BUNDLE_BYTES + 8)
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
    body = b"M" * (models.MIN_BUNDLE_BYTES + 8)
    serve(monkeypatch, Response(body, len(body) + 1024))
    path = tmp_path / "gesture_recognizer.task"

    with pytest.raises(OSError, match="not a model bundle"):
        models.ensure_model("gesture_recognizer", path)
    assert list(tmp_path.iterdir()) == []


def test_an_unknown_bundle_is_named_in_the_error():
    with pytest.raises(KeyError, match="pose_landmarker"):
        models.ensure_model("pose_landmarker")
