"""The best score for each round length, kept between sessions."""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

ENDLESS = "endless"


def key_for(map_key: str, duration: float | None) -> str:
    """Different maps and lengths are not comparable, so each keeps its own best."""
    length = ENDLESS if duration is None else f"{int(round(duration))}s"
    return f"{map_key}:{length}"


@dataclass
class HighScores:
    """A tiny score table backed by one JSON file."""

    path: Path
    best: dict[str, int] = field(default_factory=dict)

    @classmethod
    def load(cls, path: Path) -> "HighScores":
        """Read the table. A missing or damaged file simply starts an empty one."""
        try:
            data = json.loads(path.read_text())
            best = {str(k): int(v) for k, v in data.get("best", {}).items()}
        except (OSError, ValueError, AttributeError, TypeError):
            best = {}
        return cls(path=path, best=best)

    def best_for(self, map_key: str, duration: float | None) -> int:
        return self.best.get(key_for(map_key, duration), 0)

    def record(self, map_key: str, duration: float | None, score: int) -> bool:
        """Store ``score`` if it beats the record. True when it did."""
        key = key_for(map_key, duration)
        if score <= self.best.get(key, 0):
            return False
        self.best[key] = score
        self.save()
        return True

    def save(self) -> bool:
        """Write the table out. False, with a line printed, if the disk said no.

        ``load`` already treats an unreadable file as an empty table, and the
        write deserves the same forgiveness: a scores file that cannot be
        written - a read-only cache directory, a path whose parent is a file -
        is a reason to lose the record, never a reason to lose the round. The
        moment it would have thrown is the moment a new best was just set.
        """
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps({"best": self.best}, indent=2) + "\n")
        except OSError as error:
            print(f"Could not save the high score to {self.path}: {error}")
            return False
        return True
