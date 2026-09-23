"""Writing the small files the game keeps between sessions."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path


def write_atomically(path: Path, text: str) -> None:
    """Replace ``path`` with ``text`` whole, or leave it exactly as it was.

    A plain write truncates the file first and fills it in after, so a crash, a
    full disk or a second copy of the game reading at the wrong moment finds
    half a file - which reads as no file at all, and the next save then writes
    that emptiness over everything that was in it. Writing beside the file and
    renaming over it cannot be caught half done: whoever reads it sees the old
    one or the new one.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    handle, staged = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.",
                                      suffix=".tmp")
    try:
        with os.fdopen(handle, "w", encoding="utf-8") as file:
            file.write(text)
            file.flush()
            os.fsync(file.fileno())
        os.replace(staged, path)
    except BaseException:
        Path(staged).unlink(missing_ok=True)
        raise
