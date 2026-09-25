"""The package metadata agrees with the code, so an installed copy starts."""

import importlib
import re
from pathlib import Path

import handy

PYPROJECT = (Path(__file__).parent.parent / "pyproject.toml").read_text()


def test_the_version_is_the_same_in_the_metadata_and_the_code():
    # `handy --version` prints the code's; pip, uv and the wheel name use
    # pyproject's. A bump to one alone used to be the easy mistake.
    declared = re.search(r'^version = "([^"]+)"$', PYPROJECT, re.MULTILINE)
    assert declared and handy.__version__ == declared.group(1)


def test_the_console_script_names_a_function_that_exists():
    # The installed `handy` command is generated from this line; a renamed
    # module or function would only show up as a traceback once installed.
    target = re.search(r'^handy = "([\w.]+):(\w+)"$', PYPROJECT, re.MULTILINE)
    assert target, "pyproject.toml declares no `handy` console script"
    module, function = target.groups()
    assert callable(getattr(importlib.import_module(module), function))
