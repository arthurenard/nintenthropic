"""The best score for each round length, kept between sessions."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

from .storage import write_atomically

ENDLESS = "endless"


def key_for(map_key: str, duration: float | None) -> str:
    """Different maps and lengths are not comparable, so each keeps its own best."""
    length = ENDLESS if duration is None else f"{int(round(duration))}s"
    return f"{map_key}:{length}"


def _read(path: Path) -> dict[str, int]:
    """Every score in the file that reads as one.

    Entries are taken one by one: a single null used to empty the whole table,
    and the next record then wrote that emptiness over every best. OSError if
    the file cannot be read at all, ValueError if it is not a score table.
    """
    data = json.loads(path.read_text())
    table = data.get("best") if isinstance(data, dict) else None
    if not isinstance(table, dict):
        raise ValueError("there is no score table in it")
    best = {}
    for key, value in table.items():
        try:
            best[str(key)] = int(value)
        except (TypeError, ValueError, OverflowError):
            continue
    return best


@dataclass
class HighScores:
    """A tiny score table backed by one JSON file."""

    path: Path
    best: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "HighScores":
        """Read the table. A missing or damaged file simply starts an empty one."""
        try:
            best = _read(path)
        except (OSError, ValueError):
            best = {}
        return cls(path=path, best=best)

    def best_for(self, map_key: str, duration: float | None) -> int:
        return self.best.get(key_for(map_key, duration), 0)

    def record(self, map_key: str, duration: float | None, score: int) -> bool:
        """Store ``score`` if it beats the record. True when it did."""
        key = key_for(map_key, duration)
        try:
            # Another copy of the game may have set a better one since launch.
            self._merge()
        except (OSError, ValueError):
            pass  # saving sorts out a damaged file; nothing to learn from it here
        if score <= self.best.get(key, 0):
            return False
        self.best[key] = score
        self.save()
        return True

    def _merge(self) -> None:
        """Keep the better of each best: ours, or the one on disk now."""
        for key, score in _read(self.path).items():
            self.best[key] = max(score, self.best.get(key, score))

    def save(self) -> bool:
        """Write the table out. False, with a line printed, if the disk said no.

        ``load`` already treats an unreadable file as an empty table, and the
        write deserves the same forgiveness: a scores file that cannot be
        written - a read-only cache directory, a path whose parent is a file -
        is a reason to lose the record, never a reason to lose the round. The
        moment it would have thrown is the moment a new best was just set.

        What is on disk is read back and merged first, so two copies of the
        game running at once keep each other's records instead of the last to
        save wiping the other's. A file that is there but unreadable is set
        aside beside it, not written over: it may hold every best there is.
        """
        try:
            try:
                self._merge()
            except FileNotFoundError:
                pass
            except ValueError:
                backup = self.path.with_name(self.path.name + ".bak")
                os.replace(self.path, backup)
                print(f"The high scores in {self.path} could not be read; "
                      f"the file is kept as {backup}.")
            write_atomically(self.path, json.dumps({"best": self.best}, indent=2)
                             + "\n")
        except OSError as error:
            print(f"Could not save the high score to {self.path}: {error}")
            return False
        return True
