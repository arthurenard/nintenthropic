"""Resolution and caching of the MediaPipe model bundle."""

from __future__ import annotations

import hashlib
import os
import shutil
import tempfile
import urllib.request
import zipfile
from pathlib import Path

BASE_URL = "https://storage.googleapis.com/mediapipe-models"

#: The MediaPipe bundles the game can use, one per control scheme. Pinned to a
#: version rather than `latest`: whatever Google publishes next would otherwise
#: be what a new player got, untested against this version of the game.
BUNDLES = {
    "gesture_recognizer": f"{BASE_URL}/gesture_recognizer/gesture_recognizer/"
                          "float16/1/gesture_recognizer.task",
    "face_landmarker": f"{BASE_URL}/face_landmarker/face_landmarker/"
                       "float16/1/face_landmarker.task",
}

#: What each pinned bundle hashes to. Checked on every download, so a CDN that
#: serves something else - or a URL whose contents changed - is caught before
#: the file is trusted.
CHECKSUMS = {
    "gesture_recognizer":
        "97952348cf6a6a4915c2ea1496b4b37ebabc50cbbf80571435643c455f2b0482",
    "face_landmarker":
        "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff",
}
DEFAULT_BUNDLE = "gesture_recognizer"

#: Anything smaller than this is an error page or a truncated transfer,
#: not a MediaPipe bundle - the smallest the game uses is several megabytes.
MIN_BUNDLE_BYTES = 1 << 20

#: How long the download may wait on the network, in seconds, before giving up.
#: There is no default: a transfer that stalled used to block the launch for
#: ever, before any window had opened to say why.
DOWNLOAD_TIMEOUT = 30.0


def cache_dir() -> Path:
    """Directory holding downloaded model bundles (override with HANDY_MODEL_DIR)."""
    override = os.environ.get("HANDY_MODEL_DIR")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".cache" / "handy" / "models"


def _content_length(response) -> int | None:
    """How many bytes the server promised, when it promised anything."""
    try:
        return int(response.headers.get("Content-Length"))
    except (AttributeError, TypeError, ValueError):
        return None


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for block in iter(lambda: file.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def ensure_model(name: str = DEFAULT_BUNDLE,
                 destination: Path | None = None) -> Path:
    """Return the local path to a model bundle, downloading it once."""
    if name not in BUNDLES:
        raise KeyError(f"unknown model {name!r}; try one of {', '.join(BUNDLES)}")
    label = name.replace("_", " ")
    path = destination or cache_dir() / f"{name}.task"
    if path.exists():
        # A bundle is a zip archive; a file that is not one - cut short, or an
        # error page an older version saved - would fail inside MediaPipe on
        # every launch. Checking the archive's directory costs next to nothing.
        if zipfile.is_zipfile(path):
            return path
        print(f"The cached {label} model at {path} is damaged; downloading it again.")

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {label} model to {path} ...")
    # Download beside the real name and promote it only once it is whole and
    # checked, so an interrupted run leaves neither a partial bundle under the
    # real name nor a stray one beside it - whatever goes wrong, and however.
    handle, staged_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.",
                                           suffix=".part")
    staged = Path(staged_name)
    try:
        with os.fdopen(handle, "wb") as file, urllib.request.urlopen(
                BUNDLES[name], timeout=DOWNLOAD_TIMEOUT) as response:
            expected = _content_length(response)
            shutil.copyfileobj(response, file)
        size = staged.stat().st_size
        if (size < MIN_BUNDLE_BYTES or (expected is not None and size != expected)
                or not zipfile.is_zipfile(staged)):
            raise OSError(
                f"the download of the {label} model came to {size} bytes, which "
                f"is not a model bundle. Check the network and run again.")
        digest = _sha256(staged)
        if digest != CHECKSUMS[name]:
            raise OSError(
                f"the {label} model downloaded, but it is not the one this "
                f"version of the game was built for (sha256 {digest}, expected "
                f"{CHECKSUMS[name]}). Run again; if it persists, the published "
                f"bundle has changed.")
        staged.replace(path)
    finally:
        staged.unlink(missing_ok=True)
    return path
