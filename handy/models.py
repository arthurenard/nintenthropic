"""Resolution and caching of the MediaPipe model bundle."""

from __future__ import annotations

import os
import shutil
import tempfile
import urllib.request
from pathlib import Path

BASE_URL = "https://storage.googleapis.com/mediapipe-models"

#: The MediaPipe bundles the game can use, one per control scheme.
BUNDLES = {
    "gesture_recognizer": f"{BASE_URL}/gesture_recognizer/gesture_recognizer/"
                          "float16/latest/gesture_recognizer.task",
    "face_landmarker": f"{BASE_URL}/face_landmarker/face_landmarker/"
                       "float16/latest/face_landmarker.task",
}
DEFAULT_BUNDLE = "gesture_recognizer"

#: Anything smaller than this is an error page or a truncated transfer,
#: not a MediaPipe bundle - the smallest the game uses is several megabytes.
MIN_BUNDLE_BYTES = 1 << 20


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


def ensure_model(name: str = DEFAULT_BUNDLE,
                 destination: Path | None = None) -> Path:
    """Return the local path to a model bundle, downloading it once."""
    if name not in BUNDLES:
        raise KeyError(f"unknown model {name!r}; try one of {', '.join(BUNDLES)}")
    path = destination or cache_dir() / f"{name}.task"
    if path.exists():
        return path

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {name.replace('_', ' ')} model to {path} ...")
    # Download to a temporary file and promote it only once it is whole, so an
    # interrupted run leaves neither a partial bundle under the real name nor a
    # stray one beside it. A cached file is trusted forever after, so a
    # truncated download or a CDN error page must never get that far.
    staged = None
    try:
        with urllib.request.urlopen(BUNDLES[name]) as response:
            expected = _content_length(response)
            with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
                staged = Path(tmp.name)
                shutil.copyfileobj(response, tmp)
        size = staged.stat().st_size
        if size < MIN_BUNDLE_BYTES or (expected is not None and size != expected):
            raise OSError(
                f"the download of the {name.replace('_', ' ')} model came to "
                f"{size} bytes, which is not a model bundle. Check the network "
                f"and run again.")
        staged.replace(path)
    except BaseException:
        if staged is not None:
            staged.unlink(missing_ok=True)
        raise
    return path

