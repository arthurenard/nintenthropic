from pathlib import Path

import pytest

from handy.models import ensure_model


@pytest.fixture(scope="session")
def model_path() -> Path:
    """The gesture recognizer bundle, downloaded once and cached across runs."""
    return ensure_model()
