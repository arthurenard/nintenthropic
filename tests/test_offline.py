"""Guards the promise that recognition never touches the network."""

import socket
import time
from pathlib import Path

import cv2
import pytest

from handy.recognition import GestureStream, recognize_image

SAMPLE = Path(__file__).parent / "data" / "thumbs_down.jpg"


class NetworkAccessAttempted(RuntimeError):
    pass


@pytest.fixture
def no_network(monkeypatch):
    """Make any outbound connection raise, so a stray call cannot pass silently."""

    def deny(*args, **kwargs):
        raise NetworkAccessAttempted("the pipeline tried to reach the network")

    monkeypatch.setattr(socket.socket, "connect", deny)
    monkeypatch.setattr(socket.socket, "connect_ex", deny)
    monkeypatch.setattr(socket, "create_connection", deny)
    monkeypatch.setattr(socket, "getaddrinfo", deny)


def test_inference_runs_without_network(model_path: Path, no_network):
    image = cv2.imread(str(SAMPLE))

    assert recognize_image(image, model_path).hands, "still-image inference needs no network"

    with GestureStream(model_path) as stream:
        stream.submit(image)
        deadline = time.monotonic() + 5
        while not stream.latest().hands and time.monotonic() < deadline:
            time.sleep(0.05)
        assert stream.latest().hands, "live-stream inference needs no network"
