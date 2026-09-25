import json


from handy.highscores import HighScores, key_for


RANGE = "range"


def table(tmp_path) -> HighScores:
    return HighScores.load(tmp_path / "scores.json")


def test_each_map_and_length_keeps_its_own_record():
    assert key_for("range", 60) == "range:60s"
    assert key_for("zombies", 30.0) == "zombies:30s"
    assert key_for("range", None) == "range:endless"


def test_an_absent_file_starts_an_empty_table(tmp_path):
    scores = table(tmp_path)
    assert scores.best == {} and scores.best_for(RANGE, 60) == 0


def test_a_first_score_is_always_a_record(tmp_path):
    scores = table(tmp_path)
    assert scores.record(RANGE, 60, 40) is True
    assert scores.best_for(RANGE, 60) == 40


def test_nothing_is_never_a_record(tmp_path):
    """An empty table must not make a round with no score a "NEW BEST"."""
    scores = table(tmp_path)
    assert scores.record(RANGE, 60, 0) is False
    assert scores.best == {} and not (tmp_path / "scores.json").exists()


def test_only_a_better_score_replaces_the_record(tmp_path):
    scores = table(tmp_path)
    scores.record(RANGE, 60, 120)
    assert scores.record(RANGE, 60, 90) is False
    assert scores.record(RANGE, 60, 120) is False, "matching the best is not beating it"
    assert scores.record(RANGE, 60, 121) is True
    assert scores.best_for(RANGE, 60) == 121


def test_a_record_does_not_leak_between_maps(tmp_path):
    scores = table(tmp_path)
    scores.record("range", 60, 500)
    assert scores.best_for("zombies", 60) == 0
    assert scores.record("zombies", 60, 20) is True
    assert scores.best_for("range", 60) == 500


def test_a_record_does_not_leak_between_round_lengths(tmp_path):
    scores = table(tmp_path)
    scores.record(RANGE, 60, 200)
    assert scores.best_for(RANGE, 30) == 0
    assert scores.record(RANGE, 30, 10) is True
    assert scores.best_for(RANGE, 60) == 200


def test_records_survive_a_restart(tmp_path):
    table(tmp_path).record(RANGE, 60, 88)
    assert table(tmp_path).best_for(RANGE, 60) == 88


def test_a_damaged_file_does_not_stop_the_game(tmp_path):
    path = tmp_path / "scores.json"
    path.write_text("{ this is not json")
    scores = HighScores.load(path)
    assert scores.best == {}

    # And it heals: the next record rewrites the file.
    assert scores.record(RANGE, 60, 5) is True
    assert HighScores.load(path).best_for(RANGE, 60) == 5


def test_a_file_with_the_wrong_shape_is_ignored(tmp_path):
    path = tmp_path / "scores.json"
    path.write_text(json.dumps({"best": "not a table"}))
    assert HighScores.load(path).best == {}


def test_a_score_that_cannot_be_written_does_not_end_the_round(tmp_path, capsys):
    """`load` already forgives an unreadable file; `save` used to throw.

    A --calibration-file whose parent is a file, or a read-only cache, made
    `record` raise FileExistsError out of the app the instant a new best was
    set - which is the worst possible moment to lose the round.
    """
    blocked = tmp_path / "a-file"
    blocked.write_text("not a directory")

    scores = HighScores.load(blocked / "scores.json")
    assert scores.record("range", 60.0, 340) is True, "the record still stands"
    assert scores.best_for("range", 60.0) == 340, "and is remembered in memory"

    printed = capsys.readouterr().out
    assert "Could not save the high score" in printed


def test_saving_says_whether_it_worked(tmp_path):
    scores = HighScores.load(tmp_path / "deep" / "scores.json")
    scores.best["range:60s"] = 12
    assert scores.save() is True
    assert HighScores.load(tmp_path / "deep" / "scores.json").best == {"range:60s": 12}

    blocked = tmp_path / "file"
    blocked.write_text("x")
    assert HighScores(path=blocked / "scores.json", best={"a": 1}).save() is False


def test_one_bad_entry_costs_only_itself(tmp_path):
    """A single null used to empty the whole table - and the next record then
    wrote that emptiness over every other best."""
    path = tmp_path / "scores.json"
    path.write_text(json.dumps({"best": {"range:60s": 264, "zombies:60s": None,
                                         "orbit:60s": "lots"}}))
    scores = HighScores.load(path)
    assert scores.best == {"range:60s": 264}

    scores.record("sniper", 60, 10)
    assert HighScores.load(path).best == {"range:60s": 264, "sniper:60s": 10}


def test_an_unreadable_table_is_set_aside_rather_than_overwritten(tmp_path, capsys):
    """A file cut off mid-write read as an empty table, and the next record
    silently replaced every best in it with the one just set."""
    path = tmp_path / "scores.json"
    damaged = '{"best": {"range:60s": 264, "zomb'
    path.write_text(damaged)

    assert HighScores.load(path).record(RANGE, 60, 5) is True
    backup = tmp_path / "scores.json.bak"
    assert backup.read_text() == damaged, "kept, for a person to rescue"
    assert HighScores.load(path).best_for(RANGE, 60) == 5
    assert str(backup) in capsys.readouterr().out


def test_two_copies_of_the_game_keep_each_others_records(tmp_path):
    """Each copy wrote out only the table it loaded at launch, so whichever
    saved last wiped every record the other had set since."""
    first, second = table(tmp_path), table(tmp_path)
    assert first.record(RANGE, 60, 100) is True
    assert second.record("zombies", 60, 50) is True
    assert second.record(RANGE, 60, 80) is False, "the other copy's 100 stands"

    saved = table(tmp_path)
    assert saved.best_for(RANGE, 60) == 100
    assert saved.best_for("zombies", 60) == 50


def test_a_save_replaces_the_table_whole_or_not_at_all(tmp_path, monkeypatch):
    """Written in place, a crash or a full disk mid-write left half a file."""
    import os

    path = tmp_path / "scores.json"
    table(tmp_path).record(RANGE, 60, 40)
    before = path.read_text()

    def disk_full(source, destination):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(os, "replace", disk_full)
    scores = table(tmp_path)
    assert scores.record(RANGE, 60, 90) is True, "the record still stands"
    assert path.read_text() == before, "and the file on disk is untouched"
    assert list(tmp_path.iterdir()) == [path], "with nothing left beside it"
