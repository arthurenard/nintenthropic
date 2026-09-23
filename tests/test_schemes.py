"""Every scheme must be able to read its own subject, end to end."""

import pytest

from eyes import make_face
from handy import schemes
from handy.aiming import AimController
from handy.calibration import CalibrationSession, default_calibration
from handy.faces import FaceFrame
from handy.marksman import Marksman, MarksmanFrame
from handy.recognition import Frame
from hands import make_hand


def subject_and_frame(scheme):
    """A representative subject for this scheme, and the frame type carrying it."""
    hand = make_hand(thumb_degrees=20, index_tip=(0.5, 0.5))
    face = make_face(blink=(0.2, 0.2))
    if scheme.key == "pistol":
        return hand, Frame(hands=(hand,))
    if scheme.key == "gaze":
        return face, FaceFrame(faces=(face,))
    if scheme.key == "marksman":
        subject = Marksman(hand, face)
        return subject, MarksmanFrame(subjects=(subject,), hands=(hand,), faces=(face,))
    raise AssertionError(f"no fixture for scheme {scheme.key!r}")


@pytest.mark.parametrize("scheme", schemes.SCHEMES, ids=lambda s: s.key)
def test_every_reading_accepts_the_schemes_own_subject(scheme):
    """The marksman once borrowed the pistol's signals unchanged, and they were
    handed a Marksman instead of a Hand: a crash on the first setup step."""
    subject, frame = subject_and_frame(scheme)
    assert frame.subjects[0] is subject

    for signal in scheme.signals:
        assert isinstance(signal.measure(subject), float)
    x, y = scheme.pointer(subject, scheme.default_tuning)
    assert all(isinstance(v, float) for v in (x, y))
    assert scheme.scale(subject) > 0
    if scheme.describe_subject is not None:
        assert isinstance(scheme.describe_subject(subject), str)
    if scheme.scope is not None:
        assert 0.0 <= scheme.scope(subject) <= 1.0


@pytest.mark.parametrize("scheme", schemes.SCHEMES, ids=lambda s: s.key)
def test_every_scheme_walks_its_own_calibration_and_aims(scheme):
    subject, frame = subject_and_frame(scheme)
    session = CalibrationSession(scheme, cameras=1, grid=2, dwell=0.2, settle=0.05)
    clock = 0.0
    while not session.is_done:
        clock += 1 / 30
        session.update([frame], clock)
    rig = session.result()

    control = AimController(scheme)
    aim = control.update([(frame, rig[0])], 0.0)
    assert aim.tracking
    aim = control.update([(frame, default_calibration(scheme))], 0.1)
    assert aim.tracking


@pytest.mark.parametrize("scheme", schemes.SCHEMES, ids=lambda s: s.key)
def test_every_scheme_names_the_models_it_opens(scheme):
    from handy.models import BUNDLES

    assert scheme.models, "a scheme needs at least one model"
    for name in scheme.models:
        assert name in BUNDLES


def test_the_marksman_trigger_is_the_pistols_trigger_in_every_field():
    """It rebuilds the pistol's signals to unwrap the hand inside the marksman.
    Listing the fields by hand dropped max_span, which falls back to infinity -
    so setup let a deliberate 92-degree pose set the scale and every quick play
    stroke came up short, on the scheme advertised as the pistol plus an eye."""
    hand = make_hand(thumb_degrees=40)
    subject = Marksman(hand, make_face())

    assert [s.name for s in schemes.MARKSMAN.signals] == [
        s.name for s in schemes.PISTOL.signals]
    for borrowed, original in zip(schemes.MARKSMAN.signals, schemes.PISTOL.signals):
        assert borrowed.max_span == original.max_span
        assert borrowed.min_travel == original.min_travel
        assert (borrowed.rest, borrowed.fired) == (original.rest, original.fired)
        assert borrowed.measure(subject) == pytest.approx(original.measure(hand))


def test_the_marksman_scopes_with_the_eye_and_aims_with_the_hand():
    hand = make_hand(thumb_degrees=20, index_tip=(0.3, 0.7))
    open_eyes = Marksman(hand, make_face(blink=(0.2, 0.2)))
    winking = Marksman(hand, make_face(blink=(0.9, 0.15)))
    no_face = Marksman(hand, None)

    assert schemes.MARKSMAN.pointer(open_eyes, (0, 0)) == (0.3, 0.7)
    assert schemes.MARKSMAN.scope(open_eyes) < 0.3
    assert schemes.MARKSMAN.scope(winking) > 0.5
    assert schemes.MARKSMAN.scope(no_face) is None, "no face: never scoped, still aims"
    assert schemes.MARKSMAN.pointer(no_face, (0, 0)) == (0.3, 0.7)


def test_the_marksman_stream_pairs_a_hand_with_whatever_face_there_is():
    from handy.marksman import MarksmanStream

    class Still:
        def __init__(self, frame): self.frame = frame
        def submit(self, image): pass
        def latest(self): return self.frame
        def close(self): pass

    stream = MarksmanStream.__new__(MarksmanStream)
    hand, face = make_hand(), make_face()
    stream._hands, stream._faces = Still(Frame(hands=(hand,))), Still(FaceFrame(faces=(face,)))
    paired = stream.latest()
    assert paired.subjects[0].hand is hand and paired.subjects[0].face is face

    stream._faces = Still(FaceFrame())
    assert stream.latest().subjects[0].face is None, "a hand without a face still aims"

    stream._hands = Still(Frame())
    assert stream.latest().subjects == (), "no hand, no subject"


def test_a_face_model_that_will_not_open_does_not_strand_the_hand_recogniser():
    """__init__ never returned, so no `with` or ExitStack can close what did
    open: a bad face bundle leaked a live MediaPipe graph on every attempt."""
    from handy import marksman

    closed = []

    class Hands:
        def __init__(self, *args, **kwargs): pass
        def close(self): closed.append("hands")

    def broken_faces(model):
        raise OSError("truncated bundle")

    original = (marksman.GestureStream, marksman.FaceStream)
    marksman.GestureStream, marksman.FaceStream = Hands, broken_faces
    try:
        with pytest.raises(OSError):
            marksman.MarksmanStream("hand.task", "face.task")
    finally:
        marksman.GestureStream, marksman.FaceStream = original
    assert closed == ["hands"], "the recogniser that did open was closed"


def test_closing_the_marksman_closes_the_face_even_if_the_hand_throws():
    from handy.marksman import MarksmanStream

    closed = []

    class Angry:
        def close(self): raise RuntimeError("the graph is wedged")

    class Quiet:
        def close(self): closed.append("faces")

    stream = MarksmanStream.__new__(MarksmanStream)
    stream._hands, stream._faces = Angry(), Quiet()
    with pytest.raises(RuntimeError):
        stream.close()
    assert closed == ["faces"]
