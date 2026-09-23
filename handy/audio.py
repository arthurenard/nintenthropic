"""Synthesised sound effects.

Everything is generated with numpy at startup - there are no asset files, and
no dependency beyond ``sounddevice``, which MediaPipe already pulls in. Sounds
are mixed in the audio callback so a shot, a hit and a re-cock can overlap
without cutting each other off.

How a sound is made here, in three layers, the way a produced game asset is:

* a **transient** - a few milliseconds of broadband click so the ear hears an
  edge, not a fade-in;
* a **body** - band-limited noise (white noise shaped in the FFT domain) and/or
  a stack of inharmonic, independently decaying partials, under an ADSR
  envelope;
* a **tail** - a convolution with a synthesised impulse response: a comb of
  early reflections, a diffuse tail whose high end dies faster than its low end
  (as it does in any real space), and, for the wide-open moods, discrete
  slap-back echoes. One response per map mood, shared by every sound.

Every sound is then loudness-normalised (a gated RMS in the spirit of LUFS) to
one target, and passed through the same soft-knee limiter the :class:`Mixer`
uses, so nothing ever clips and nothing is wildly louder than its neighbours.

Nothing repeats exactly. Each builder draws its own noise, detunes its pitch,
scales its decay times and re-balances its layers per take (:class:`_Take`),
:class:`Sounds` keeps several such takes of every sound, and at play time the
chosen take is additionally re-pitched and re-levelled by a hair.
"""

from __future__ import annotations

import threading
from functools import lru_cache
from typing import Callable

import numpy as np

SAMPLE_RATE = 44_100

#: Gated-RMS loudness every finished sound is normalised to, in dBFS.
TARGET_LOUDNESS_DB = -20.0
#: Peak ceiling of a finished sound. The Mixer's limiter sits above this.
PEAK_CEILING = 0.85
#: Where the Mixer's limiter starts bending the signal over.
LIMITER_KNEE = 0.8
#: The limiter's asymptote: the loudest sample that can ever leave the Mixer.
LIMITER_CEILING = 0.98
#: How many slightly different takes of each sound the sound set keeps.
VARIANTS = 4

#: Every named cue a map may raise, grouped by the map family that uses it.
NAMED_CUES: dict[str, tuple[str, ...]] = {
    "western": ("rifle_crack", "bottle_break", "ricochet", "wood_splinter",
                "bandit_down", "bell_toll", "wind_dust"),
    "orbit": ("suppressed_shot", "debris_hit", "hull_thud", "glass_crack",
              "alarm", "static"),
    "sniper": ("sniper_shot", "bolt_cycle", "scope_in", "scope_out",
               "distant_impact", "headshot_ping", "wind_gust"),
}


# --- building blocks -----------------------------------------------------------

def _samples(seconds: float) -> int:
    return max(1, int(round(seconds * SAMPLE_RATE)))


def _time(length: int) -> np.ndarray:
    return np.arange(length) / SAMPLE_RATE


def _db(decibels: float) -> float:
    return float(10.0 ** (decibels / 20.0))


class _Take:
    """The per-take variation every builder draws from.

    ``p`` is the pitch multiplier, ``d(seconds)`` scales a decay time by the
    take's own factor (+-15 %), ``g()`` draws a per-layer balance of +-3 dB, and
    ``j(seconds)`` jitters a timing by +-10 %. Two takes of one sound therefore
    differ in pitch, noise, decay, layer balance and timing all at once.
    """

    def __init__(self, rng: np.random.Generator, pitch: float = 1.0,
                 velocity: float = 0.0, decay: float | None = None) -> None:
        self.rng = rng
        self.p = float(pitch)
        self.velocity = float(velocity)
        self.decay = float(rng.uniform(0.85, 1.15)) if decay is None else float(decay)
        #: Overall duration factor (+-15 %), drawn apart from the decay factor.
        self.length = float(rng.uniform(0.85, 1.15))
        #: Filter cutoff factor (+-25 %): one take is darker, the next brighter.
        self.cutoff = float(rng.uniform(0.8, 1.25))

    def d(self, seconds: float) -> float:
        return seconds * self.decay

    def L(self, seconds: float) -> float:  # noqa: N802 - reads as "length of"
        return seconds * self.length

    def c(self, hz: float) -> float:
        return hz * self.cutoff

    def g(self, base: float = 1.0, spread: float = 3.0) -> float:
        return base * _db(float(self.rng.uniform(-spread, spread)))

    def j(self, seconds: float, spread: float = 0.1) -> float:
        return seconds * float(self.rng.uniform(1.0 - spread, 1.0 + spread))


def _envelope(length: int, attack: float = 0.002, decay: float = 0.08,
              curve: float = 1.0) -> np.ndarray:
    """A percussive attack-decay shape, in samples: a short rise, then a pure
    exponential. The last 15 % eases out so a layer cut mid-decay leaves no edge."""
    time = _time(length)
    rise = np.clip(time / max(attack, 1e-6), 0.0, 1.0)
    fall = np.exp(-time * curve / decay)
    ease = 0.5 - 0.5 * np.cos(np.pi * np.clip((1.0 - time / max(time[-1], 1e-9)) / 0.15, 0.0, 1.0))
    return rise * fall * ease


def _adsr(length: int, attack: float, decay: float, sustain: float,
          release: float) -> np.ndarray:
    """A full attack / decay / sustain / release envelope over ``length``."""
    time = _time(length)
    total = length / SAMPLE_RATE
    attack = max(attack, 1e-4)
    env = np.where(time < attack, (time / attack) ** 0.7, 1.0)
    after = np.clip(time - attack, 0.0, None)
    env = env * (sustain + (1.0 - sustain) * np.exp(-after / max(decay / 3.0, 1e-4)))
    if release > 0:
        left = np.clip((total - time) / release, 0.0, 1.0)
        env = env * (0.5 - 0.5 * np.cos(np.pi * left))
    return env


def _shape(wave: np.ndarray, gain: Callable[[np.ndarray], np.ndarray]) -> np.ndarray:
    """Multiply the spectrum of ``wave`` by ``gain(frequency_hz)``.

    The wave is zero-padded to twice its length first, so the filter's
    (zero-phase) ringing around a sharp onset cannot wrap round to the end.
    The transform length is rounded up to a power of two: an FFT of an
    arbitrary length can hit a large prime factor and run fifty times slower,
    and it was these calls that made the sound set take thirteen seconds to
    build at every launch."""
    n = 1 << (2 * len(wave) - 1).bit_length()
    spectrum = np.fft.rfft(wave, n)
    freqs = np.fft.rfftfreq(n, 1.0 / SAMPLE_RATE)
    return np.fft.irfft(spectrum * gain(freqs), n=n)[:len(wave)]


def _lowpass_gain(freqs: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    return 1.0 / np.sqrt(1.0 + (freqs / cutoff) ** (2 * order))


def _highpass_gain(freqs: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    ratio = (np.maximum(freqs, 1e-3) / cutoff) ** order
    return ratio / np.sqrt(1.0 + ratio * ratio)


def _tilt_gain(freqs: np.ndarray, db_per_octave: float) -> np.ndarray:
    octaves = np.log2(np.maximum(freqs, 20.0) / 1000.0)
    return 10.0 ** (db_per_octave * octaves / 20.0)


def _formant_gain(freqs: np.ndarray, formants, floor: float = 0.004) -> np.ndarray:
    """Resonant peaks: (centre Hz, bandwidth Hz, amplitude) each, a two-pole
    resonance's magnitude, over a faint floor."""
    gain = np.full_like(freqs, floor)
    for centre, width, amplitude in formants:
        gain = gain + amplitude / (1.0 + ((freqs - centre) / width) ** 2) ** 1.5
    return gain


def _lowpass(wave: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    return _shape(wave, lambda f: _lowpass_gain(f, cutoff, order))


def _highpass(wave: np.ndarray, cutoff: float, order: int = 2) -> np.ndarray:
    return _shape(wave, lambda f: _highpass_gain(f, cutoff, order))


def _bandpass(wave: np.ndarray, low: float, high: float, order: int = 2,
              tilt: float = 0.0) -> np.ndarray:
    return _shape(wave, lambda f: _highpass_gain(f, low, order)
                  * _lowpass_gain(f, high, order) * _tilt_gain(f, tilt))


def _peak(wave: np.ndarray) -> np.ndarray:
    loudest = float(np.max(np.abs(wave))) or 1.0
    return wave / loudest


def _noise(seconds: float, rng: np.random.Generator, low: float = 20.0,
           high: float = 20_000.0, order: int = 2, tilt: float = 0.0) -> np.ndarray:
    """Band-limited noise, unit peak, shaped in the FFT domain."""
    white = rng.standard_normal(_samples(seconds))
    return _peak(_bandpass(white, low, high, order, tilt))


def _sine(frequency: float, seconds: float, phase: float = 0.0) -> np.ndarray:
    return np.sin(2 * np.pi * frequency * _time(_samples(seconds)) + phase)


def _chirp(start: float, end: float, seconds: float, curve: float = 1.0) -> np.ndarray:
    """A sine whose frequency glides from ``start`` to ``end``."""
    length = _samples(seconds)
    progress = (np.arange(length) / max(length - 1, 1)) ** curve
    frequency = start * (end / start) ** progress
    return np.sin(2 * np.pi * np.cumsum(frequency) / SAMPLE_RATE)


def _saw(f0: np.ndarray, phase: float = 0.0, brightness: float = 1.0,
         top: float = 12_000.0) -> np.ndarray:
    """A band-limited sawtooth following the instantaneous frequency ``f0``
    (Hz per sample): harmonics 1/k^brightness, none above ``top``, unit-ish peak."""
    angle = 2 * np.pi * np.cumsum(f0) / SAMPLE_RATE + phase
    count = int(min(40, max(2, top / float(np.max(f0)))))
    wave = sum(np.sin(k * angle) / k ** brightness for k in range(1, count + 1))
    return _peak(wave)


def _modes(frequencies, amplitudes, decays, rng: np.random.Generator | None = None,
           detune: float = 0.0, pitch: float = 1.0, seconds: float | None = None,
           fade: float = 0.0) -> np.ndarray:
    """A sum of independently decaying partials - the skeleton of anything
    that rings. Every partial is a pure exponential with no knee: the wave is
    long enough (six of the slowest decay) for the last one to have died,
    unless ``seconds`` caps it, in which case ``fade`` seconds of cosine close
    it out."""
    if seconds is None:
        # Six decays: -52 dB. The residue is eased out over the last quarter,
        # far below anything audible, so the cut leaves no step.
        seconds = 6.0 * max(decays)
        fade = 0.25 * seconds
    time = _time(_samples(seconds))
    wave = np.zeros_like(time)
    for frequency, amplitude, decay in zip(frequencies, amplitudes, decays):
        if rng is not None and detune:
            frequency = frequency * (1.0 + rng.uniform(-detune, detune))
        phase = rng.uniform(0, 2 * np.pi) if rng is not None else 0.0
        wave += amplitude * np.sin(2 * np.pi * frequency * pitch * time + phase) \
            * np.exp(-time / decay)
    if fade > 0:
        left = np.clip((time[-1] - time) / fade, 0.0, 1.0)
        wave *= 0.5 - 0.5 * np.cos(np.pi * left)
    return wave


def _metal(rng: np.random.Generator, base: float, decay: float, amplitude: float = 1.0,
           ratios=(1.0, 1.47, 2.09, 2.56, 3.3), seconds: float | None = None) -> np.ndarray:
    """A small struck piece of metal: a short inharmonic stack with a noise edge."""
    amps = [amplitude * 0.7 ** k for k in range(len(ratios))]
    decays = [decay * 0.75 ** k for k in range(len(ratios))]
    ring = _modes([base * r for r in ratios], amps, decays, rng, 0.01, seconds=seconds)
    edge = _noise(0.004, rng, base * 0.8, min(base * 5.0, 18_000), order=1)
    ring[:len(edge)] += 0.8 * amplitude * edge * _envelope(len(edge), 0.0002, 0.0012)
    return ring


def _click(rng: np.random.Generator, width: float = 0.003, low: float = 800.0,
           high: float = 12_000.0) -> np.ndarray:
    """The transient edge: a few milliseconds of bright noise."""
    burst = _noise(width, rng, low, high, order=1)
    return burst * _envelope(len(burst), attack=0.0002, decay=width / 3)


def _place(canvas: np.ndarray, wave: np.ndarray, at: float, gain: float = 1.0) -> None:
    """Add ``wave`` into ``canvas`` starting ``at`` seconds in, clipped to fit."""
    start = int(at * SAMPLE_RATE)
    if start >= len(canvas) or start < 0:
        return
    chunk = wave[:len(canvas) - start]
    canvas[start:start + len(chunk)] += gain * chunk


def _canvas(seconds: float) -> np.ndarray:
    return np.zeros(_samples(seconds))


# --- reverb ----------------------------------------------------------------------

#: Reverb moods. Each: the tail's length and decay (s), the lowpass its high
#: end starts from (Hz), the pre-delay (s), the early-reflection window (s),
#: and a list of discrete echoes as (time s, gain, lowpass Hz) - the slap-backs
#: off a street front or a far valley wall that a diffuse tail cannot give.
_MOODS: dict[str, dict] = {
    "dry": dict(length=0.14, decay=0.035, cutoff=6_000.0, predelay=0.003, early=0.02,
                echoes=()),
    "archery": dict(length=0.45, decay=0.12, cutoff=5_000.0, predelay=0.008, early=0.04,
                    echoes=()),
    "zombies": dict(length=1.0, decay=0.24, cutoff=2_500.0, predelay=0.015, early=0.07,
                    echoes=()),
    "western": dict(length=0.9, decay=0.16, cutoff=6_500.0, predelay=0.012, early=0.05,
                    echoes=((0.135, 0.45, 2_800.0), (0.29, 0.22, 1_800.0), (0.46, 0.1, 1_200.0))),
    "orbit": dict(length=1.5, decay=0.26, cutoff=3_200.0, predelay=0.004, early=0.03,
                  echoes=()),
    "sniper": dict(length=2.0, decay=0.28, cutoff=2_000.0, predelay=0.03, early=0.09,
                   echoes=((0.33, 0.3, 1_100.0), (0.71, 0.14, 750.0))),
    "far": dict(length=1.8, decay=0.4, cutoff=450.0, predelay=0.02, early=0.08,
                echoes=((0.3, 0.5, 400.0), (0.62, 0.28, 320.0), (1.0, 0.12, 260.0))),
}

#: Frequency bands of the diffuse tail and how much faster each one dies than
#: the lowest: a room's high end goes first.
_TAIL_BANDS = ((20.0, 250.0, 1.0), (250.0, 1_000.0, 0.8), (1_000.0, 3_500.0, 0.55),
               (3_500.0, 20_000.0, 0.32))


@lru_cache(maxsize=None)
def _reverb_ir(mood: str) -> np.ndarray:
    """A synthesised impulse response for one mood. Cached: one per mood,
    shared by every sound that goes through it."""
    spec = _MOODS[mood]
    rng = np.random.default_rng(sum(map(ord, mood)) * 7919)
    predelay, decay = spec["predelay"], spec["decay"]
    # Long enough for the slowest band to have fallen 70 dB on its own, so the
    # tail fades into the floor rather than being cut off at the end.
    length = max(spec["length"], 8.0 * decay + predelay)
    n = _samples(length)
    time = _time(n)
    # The diffuse tail: noise in four bands, the higher the band the faster it dies.
    white = rng.standard_normal(n)
    tail = np.zeros(n)
    for low, high, factor in _TAIL_BANDS:
        tail += _bandpass(white, low, high, 2) * np.exp(-time / (decay * factor))
    tail = _shape(tail, lambda f: _lowpass_gain(f, spec["cutoff"], 1))
    # Diffusion builds up over the first few milliseconds rather than starting full.
    build = np.clip((time - predelay) / 0.012, 0.0, 1.0)
    tail *= build ** 2
    # Early reflections: a handful of discrete, individually coloured taps.
    early = np.zeros(n)
    count = 9
    for k in range(count):
        at = predelay + spec["early"] * (k + rng.uniform(0.2, 0.9)) / count
        gain = 0.75 * (1.0 - 0.8 * k / count) * rng.uniform(0.5, 1.0) * rng.choice([-1.0, 1.0])
        tap = _click(rng, 0.0015, 100.0, rng.uniform(0.4, 1.0) * spec["cutoff"])
        _place(early, tap, at, gain)
    # Discrete echoes: a short, dull burst each, the sound coming back off a wall.
    echoes = np.zeros(n)
    for at, gain, cutoff in spec["echoes"]:
        burst = _noise(0.03, rng, 60.0, cutoff, order=2)
        _place(echoes, burst * _envelope(len(burst), 0.002, 0.008), at, gain)
    # A slow random modulation of the tail's level: the diffuse field is not a
    # smooth exponential but a shimmer of overlapping reflections.
    shimmer = 1.0 + 0.18 * _peak(_lowpass(rng.standard_normal(n), 14.0))
    ir = 0.5 * tail * shimmer + 1.0 * early + 1.3 * echoes
    ir[0] = 0.0
    # A gentle ease over the last tenth, long after the tail has gone below -60 dB.
    ir *= 0.5 - 0.5 * np.cos(np.pi * np.clip((1.0 - time / length) * 10.0, 0.0, 1.0))
    return ir / np.sqrt(np.sum(ir * ir))


@lru_cache(maxsize=32)
def _reverb_spectrum(mood: str, nfft: int) -> np.ndarray:
    """The mood's impulse response in the frequency domain, once per size.

    Every sound in a mood shares the same room; transforming the room again for
    each of them was a fair slice of the launch delay."""
    return np.fft.rfft(_reverb_ir(mood), nfft)


def _reverb(wave: np.ndarray, mood: str, mix: float) -> np.ndarray:
    """Convolve with the mood's impulse response and blend it under the dry sound."""
    ir = _reverb_ir(mood)
    n = len(wave) + len(ir) - 1
    nfft = 1 << (n - 1).bit_length()
    wet = np.fft.irfft(np.fft.rfft(wave, nfft) * _reverb_spectrum(mood, nfft), nfft)[:n]
    dry = np.zeros(n)
    dry[:len(wave)] = wave
    return dry + mix * wet


# --- loudness ------------------------------------------------------------------

def loudness_db(wave: np.ndarray, block: float = 0.1, hop: float = 0.025) -> float:
    """A gated RMS in dBFS, in the spirit of integrated LUFS.

    The signal is cut into overlapping 100 ms blocks, blocks quieter than
    -60 dBFS are ignored (silence and the pre-delay of a distant impact), then
    blocks more than 10 dB below the average are ignored too, so a long quiet
    tail does not drag a sharp sound's loudness down.
    """
    wave = np.asarray(wave, dtype=np.float64)
    size, step = _samples(block), _samples(hop)
    if len(wave) < size:
        wave = np.pad(wave, (0, size - len(wave)))
    count = (len(wave) - size) // step + 1
    windows = np.lib.stride_tricks.as_strided(
        wave, shape=(count, size), strides=(wave.strides[0] * step, wave.strides[0]))
    power = np.mean(windows * windows, axis=1)
    power = power[power > 1e-6]  # absolute gate: -60 dBFS
    if len(power) == 0:
        return -np.inf
    power = power[power > np.mean(power) * 0.1]  # relative gate: -10 dB
    return float(10.0 * np.log10(np.mean(power)))


def soft_knee(x: np.ndarray, knee: float = LIMITER_KNEE,
              ceiling: float = LIMITER_CEILING) -> np.ndarray:
    """A memoryless soft-knee limiter: linear below ``knee``, then a smooth
    tanh bend that never quite reaches ``ceiling``. Continuous in value and slope."""
    magnitude = np.abs(x)
    bent = knee + (ceiling - knee) * np.tanh((magnitude - knee) / (ceiling - knee))
    return np.sign(x) * np.where(magnitude <= knee, magnitude, bent)


def _finish(wave: np.ndarray, mood: str | None = None, mix: float = 0.2,
            velocity: float = 0.0, target: float = TARGET_LOUDNESS_DB) -> np.ndarray:
    """Reverb, de-click, normalise to the loudness target and limit: the
    mastering chain every sound goes through before it is handed out."""
    wave = np.array(wave, dtype=np.float64)
    release = min(_samples(0.04), len(wave) // 4)
    wave[-release:] *= 0.5 - 0.5 * np.cos(np.pi * np.linspace(1.0, 0.0, release))
    if mood is not None:
        wave = _reverb(wave, mood, mix)
    wave = _highpass(wave, 25.0, order=1)  # no DC, no sub-rumble
    # Trim the inaudible end of the tail: after the last sample above -78 dB
    # of the peak, keep 120 ms and ease out, so the sound does not carry a
    # second of near-silence around with it.
    floor = float(np.max(np.abs(wave))) * _db(-78.0)
    above = np.nonzero(np.abs(wave) > floor)[0]
    if len(above):
        wave = wave[:min(len(wave), int(above[-1]) + _samples(0.12))]
    fade_in, fade_out = _samples(0.001), min(_samples(0.12), len(wave) // 4)
    wave[:fade_in] *= np.linspace(0.0, 1.0, fade_in)
    wave[-fade_out:] *= np.linspace(1.0, 0.0, fade_out)
    wanted = target + velocity
    for _ in range(2):  # the limiter shaves a little; re-measure once
        current = loudness_db(wave)
        if np.isfinite(current):
            wave = wave * 10.0 ** ((wanted - current) / 20.0)
        wave = PEAK_CEILING * soft_knee(wave / PEAK_CEILING)
    return wave.astype(np.float32)


# --- the sounds ----------------------------------------------------------------
# Every builder takes (rng, pitch, velocity, decay): pitch as a multiplier,
# velocity in dB, decay as a multiplier on every decay time (None: drawn).

def _gun_mechanics(out: np.ndarray, v: _Take, at: float, base: float, gain: float) -> None:
    """The action cycling after a shot: a slide or lever clack, a little later."""
    _place(out, _click(v.rng, 0.003, base * 0.5, 9_000), at, 0.8 * gain)
    _place(out, _metal(v.rng, base * v.p, v.d(0.012), 0.7), at, gain)
    _place(out, _metal(v.rng, base * 0.62 * v.p, v.d(0.016), 0.6), at + 0.018, 0.8 * gain)


def _room(out: np.ndarray, v: _Take, window: float = 0.03, count: int | None = None,
          span: tuple[float, float] = (0.04, 0.12), cutoff: float = 3_000.0,
          gain: float = 0.45, tail_cut: float = 700.0, tail_decay: float = 0.2,
          tail_gain: float = 0.5) -> np.ndarray:
    """What a real room does to a shot, apart from the diffuse wash.

    Two to four *early reflections*: the first ``window`` seconds of the sound
    come back 40..120 ms later, each copy low-passed and flipped or not. Then
    a *separate low tail*: the blast's low end, pushed through a slow, dull
    noise bed that rises over 20 ms and dies far slower than the crack, so the
    spectrogram bends at a knee instead of running down one straight wedge."""
    rng = v.rng
    head = out[: _samples(window)] * _envelope(_samples(window), 0.0005, window / 2.5)
    count = int(rng.integers(2, 5)) if count is None else count
    ats = np.sort(rng.uniform(span[0], span[1], count))
    for k, at in enumerate(ats):
        copy = _lowpass(head, cutoff * rng.uniform(0.5, 1.0) * v.cutoff, order=1)
        _place(out, _peak(copy), v.j(at, 0.08),
               gain * (0.85 ** k) * rng.uniform(0.6, 1.0) * rng.choice([-1.0, 1.0]))
    tail = _noise(v.L(6.0 * tail_decay), rng, 45.0, v.c(tail_cut), order=2, tilt=-3.0)
    tail *= _adsr(len(tail), 0.02, 0.08, 0.85, 0.1) * _envelope(len(tail), 0.02, v.d(tail_decay))
    _place(out, tail, 0.035, v.g(tail_gain))
    return out


def shot_sound(rng: np.random.Generator, pitch: float = 1.0, velocity: float = 0.0,
               decay: float | None = None) -> np.ndarray:
    """A pistol: a click, a crack, a thump of body, a sub, and the slide."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(1.3))
    _place(out, _click(rng, 0.004, 800, v.c(12_000)), 0.0, v.g(1.2))
    crack = _noise(0.18, rng, 350 * v.p, v.c(6_500 * v.p), tilt=-2.0)
    _place(out, crack * _envelope(len(crack), 0.001, v.d(0.030)), 0.0, v.g(1.0))
    thump = _chirp(240 * v.p, 70 * v.p, 0.14, curve=0.6)
    _place(out, thump * _envelope(len(thump), 0.002, v.d(0.045)), 0.001, v.g(0.9))
    sub = _chirp(70 * v.p, 42 * v.p, 0.2, curve=0.7)
    _place(out, sub * _envelope(len(sub), 0.004, v.d(0.07)), 0.003, v.g(0.5))
    tail = _noise(0.45, rng, 120, v.c(1_800), tilt=-3.0)
    _place(out, tail * _envelope(len(tail), 0.01, v.d(0.09)), 0.01, v.g(0.35))
    _room(out, v, 0.03, span=(0.04, 0.11), cutoff=3_500, tail_cut=600, tail_decay=0.16)
    _gun_mechanics(out, v, v.j(0.075, 0.2), 2_900, v.g(0.35))
    return _finish(out, "archery", 0.22, velocity)


def hit_sound(ring: int, rings: int, rng: np.random.Generator | None = None,
              pitch: float = 1.0, velocity: float = 0.0,
              decay: float | None = None) -> np.ndarray:
    """A struck bar that rises with the ring: the gold sings, the white barely rings.

    Inharmonic partials (1 : 2.76 : 5.4 : 8.9 : 13.3, the modes of a free bar).
    The fundamental is one clean exponential; every upper partial is a detuned
    *pair* that beats as it dies, and the decays shorten sharply with
    frequency so the high lines go first and the fundamental outlives them.
    Under the attack, a band-limited noise strike and the arrow's tock."""
    rng = rng if rng is not None else np.random.default_rng(ring)
    v = _Take(rng, pitch, velocity, decay)
    step = (rings - 1 - ring) / max(rings - 1, 1)  # 0 outermost, 1 bullseye
    frequency = (520 + 700 * step) * v.p
    base = v.d(0.11 + 0.16 * step)
    freqs, amps, decays = [frequency], [1.0], [base]
    for ratio, amp, share in ((2.76, 0.5, 0.42), (5.4, 0.25, 0.22), (8.9, 0.12, 0.11),
                              (13.3, 0.06, 0.06)):
        spread = rng.uniform(0.002, 0.006)  # a beat of 2..8 Hz between the pair
        for sign in (-1.0, 1.0):
            freqs.append(frequency * ratio * (1.0 + sign * spread))
            amps.append(amp * v.g(0.5, 2.0))
            decays.append(base * share * rng.uniform(0.8, 1.2))
    ring_wave = _modes(freqs, amps, decays, rng, seconds=v.L(5.5 * base), fade=1.2 * base)
    out = _canvas(len(ring_wave) / SAMPLE_RATE + 0.05)
    _place(out, ring_wave, 0.0, 1.0)
    strike = _noise(0.02, rng, frequency * 0.7, v.c(frequency * 8.0), order=1)  # the hit itself
    _place(out, strike * _envelope(len(strike), 0.0003, v.d(0.005)), 0.0, v.g(1.1))
    _place(out, _click(rng, 0.002, 2_000, 12_000), 0.0, v.g(0.5))
    thud = _noise(0.08, rng, 80, v.c(400))  # the arrow's "tock" into the boss
    _place(out, thud * _envelope(len(thud), 0.001, v.d(0.02)), 0.0, v.g(0.55))
    return _finish(out, "archery", 0.3, velocity)


def miss_sound(rng: np.random.Generator, pitch: float = 1.0, velocity: float = 0.0,
               decay: float | None = None) -> np.ndarray:
    """A dull thud into the backstop, with a little dust falling after it."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.4)
    thud = _noise(0.22, rng, 40, 160 * v.p, order=3)
    _place(out, thud * _envelope(len(thud), 0.002, v.d(0.05)), 0.0, v.g(1.0))
    body = _chirp(110 * v.p, 55 * v.p, 0.2)
    _place(out, body * _envelope(len(body), 0.003, v.d(0.06)), 0.0, v.g(0.7))
    dust = _noise(0.3, rng, 600, 3_000)
    _place(out, dust * _envelope(len(dust), 0.02, v.d(0.07)), v.j(0.03), v.g(0.05))
    return _finish(out, "archery", 0.15, velocity)


def cock_sound(rng: np.random.Generator, pitch: float = 1.0, velocity: float = 0.0,
               decay: float | None = None) -> np.ndarray:
    """The hammer going back: three mechanical events over ~150 ms, each a
    *different* piece of the gun - the slide scraping with a 1.8 kHz body,
    the latch catching with a thin 3.2 kHz one, the hammer seating home with
    a heavy 900 Hz knock - and a thin metallic ring of the spring between the
    latch and the seat, so it reads as a mechanism, not one click three times."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(0.22))
    # 1. the slide: a rising scrape of noise with a hollow 1.8 kHz body.
    slide = _noise(v.L(0.045), rng, 1_200 * v.p, v.c(6_000 * v.p), order=1)
    slide = _shape(slide, lambda f: _formant_gain(f, [(1_800 * v.p, 350, 1.0)], 0.15))
    slide *= _adsr(len(slide), 0.02, 0.02, 0.9, 0.012)
    _place(out, _peak(slide), 0.0, v.g(0.9))
    _place(out, _chirp(900 * v.p, 1_600 * v.p, 0.04) * _adsr(_samples(0.04), 0.015, 0.02, 0.8, 0.01),
           0.0, v.g(0.12))
    # 2. the latch: a small sharp part catches - a thin, bright 3.2 kHz body.
    latch_at = v.j(0.052, 0.25)
    latch = _noise(0.012, rng, 2_000 * v.p, v.c(14_000), order=1)
    latch = _shape(latch, lambda f: _formant_gain(f, [(3_200 * v.p, 500, 1.0), (7_000 * v.p, 1_500, 0.3)], 0.1))
    _place(out, _peak(latch) * _envelope(len(latch), 0.0002, 0.003), latch_at, v.g(1.0))
    _place(out, _metal(rng, 3_300 * v.p * v.cutoff ** 0.5, v.d(0.007), 0.7), latch_at, 1.0)
    # 2b. the spring's thin ring between the latch and the seat.
    ring = _modes([5_400 * v.p, 5_400 * v.p * 1.003, 8_100 * v.p], [0.5, 0.5, 0.2],
                  [v.d(0.025), v.d(0.02), 0.012], rng, seconds=0.09, fade=0.03)
    _place(out, ring, latch_at + 0.004, v.g(0.35))
    # 3. the hammer seats: heavier, lower - a 900 Hz knock and a thunk of the frame.
    click_at = latch_at + v.j(0.058, 0.25)
    home = _noise(0.02, rng, 300 * v.p, v.c(6_000), order=1)
    home = _shape(home, lambda f: _formant_gain(f, [(900 * v.p, 220, 1.0), (2_400 * v.p, 600, 0.35)], 0.08))
    _place(out, _peak(home) * _envelope(len(home), 0.0003, 0.005), click_at, v.g(1.3))
    _place(out, _click(rng, 0.003, 1_200 * v.p, v.c(10_000)), click_at, v.g(0.7))
    _place(out, _metal(rng, 2_150 * v.p, v.d(0.013), 0.6), click_at, 0.8)
    thunk = _noise(0.03, rng, 120, 700, order=3)
    _place(out, thunk * _envelope(len(thunk), 0.0005, v.d(0.006)), click_at, v.g(0.8))
    # One take is brighter, the next duller: a spectral tilt of up to +-3 dB/octave.
    tilt = float(rng.uniform(-3.0, 3.0))
    out = _shape(out, lambda f: _tilt_gain(f, tilt))
    return _finish(out, "dry", 0.18, velocity - 1.5)


#: Vowel formants (centre Hz, bandwidth Hz, amplitude): the groan slides
#: through them - open "aah", rounding to "oh", closing to "ooh".
_VOWELS = (
    ((800.0, 110.0, 1.0), (1_350.0, 140.0, 0.6), (2_600.0, 200.0, 0.2)),   # aah
    ((620.0, 100.0, 1.0), (1_700.0, 160.0, 0.5), (2_500.0, 200.0, 0.15)),  # "eh"
    ((480.0, 90.0, 1.0), (900.0, 110.0, 0.55), (2_450.0, 200.0, 0.12)),    # oh
    ((560.0, 90.0, 1.0), (1_100.0, 120.0, 0.45), (2_400.0, 200.0, 0.1)),   # "uh"
    ((300.0, 70.0, 1.0), (620.0, 90.0, 0.5), (2_300.0, 200.0, 0.07)),      # ooh
)


def _glide_formants(wave: np.ndarray, vowels, progress: np.ndarray,
                    frame: int = 2048, hop: int = 512) -> np.ndarray:
    """Run ``wave`` through a formant filter whose peaks slide along the
    ``vowels`` trajectory as ``progress`` (0..1 per sample) advances."""
    window = np.hanning(frame)
    freqs = np.fft.rfftfreq(frame, 1.0 / SAMPLE_RATE)
    padded = np.pad(wave, (frame // 2, frame))
    out = np.zeros_like(padded)
    norm = np.zeros_like(padded)
    stops = np.linspace(0.0, 1.0, len(vowels))
    table = np.array(vowels, dtype=np.float64)  # (vowel, formant, [centre, width, amp])
    for start in range(0, len(wave) + frame // 2, hop):
        centre_sample = min(max(start + frame // 2 - frame // 2, 0), len(progress) - 1)
        u = float(progress[centre_sample])
        formants = [tuple(np.interp(u, stops, table[:, k, j]) for j in range(3))
                    for k in range(table.shape[1])]
        chunk = padded[start:start + frame] * window
        spectrum = np.fft.rfft(chunk) * _formant_gain(freqs, formants)
        out[start:start + frame] += np.fft.irfft(spectrum, n=frame) * window
        norm[start:start + frame] += window * window
    out = out / np.maximum(norm, 1e-3)
    return out[frame // 2:frame // 2 + len(wave)]


def groan_sound(rng: np.random.Generator, pitch: float = 74.0, velocity: float = 0.0,
                decay: float | None = None) -> np.ndarray:
    """A low moan from out in the fog. ``pitch`` is in Hz.

    A rough glottal pulse train (jittered pitch, a moan contour and a warble)
    is run through vowel formants that travel as the mouth closes. No two
    groans share a shape: each take draws how many syllables it has (one long
    moan, or two or three joined by a catch of breath), which middle vowel the
    mouth passes through, how fast it closes, where its pitch turns, and when
    its breath-noise bursts land."""
    v = _Take(rng, 1.0, velocity, decay)
    segments = int(rng.integers(1, 4))
    lengths = [v.L(rng.uniform(0.4, 0.7))] + [v.L(rng.uniform(0.35, 0.9)) for _ in range(segments - 1)]
    seconds = float(sum(lengths)) + 0.05 * (segments - 1)
    length = _samples(seconds)
    time = _time(length)
    u = time / seconds
    # Pitch: a contour that turns at a drawn point, sinking away at the end.
    turn = rng.uniform(0.15, 0.55)
    contour = 1.0 + v.j(0.09, 0.5) * np.sin(np.pi * np.clip(u / turn, 0, 1) * 0.5) \
        - v.j(0.14, 0.5) * np.clip((u - turn) / (1 - turn), 0, 1) ** rng.uniform(1.2, 2.5)
    warble = 1.0 + v.j(0.05, 0.5) * np.sin(2 * np.pi * v.j(4.3, 0.4) * time + rng.uniform(0, 6)) \
        + 0.03 * np.sin(2 * np.pi * rng.uniform(1.0, 2.2) * time + rng.uniform(0, 6))
    jitter = 1.0 + 0.025 * _peak(_lowpass(rng.standard_normal(length), 35.0))
    f0 = pitch * contour * warble * jitter
    phase = 2 * np.pi * np.cumsum(f0) / SAMPLE_RATE
    harmonics = int(5_000 / pitch)
    voice = sum(np.sin(k * phase + rng.uniform(0, 6)) / k ** rng.uniform(1.1, 1.5)
                for k in range(1, harmonics))
    voice = _lowpass(voice, v.c(3_200.0), order=1)
    shimmer = 1.0 + 0.2 * _peak(_lowpass(rng.standard_normal(length), 25.0))
    voice = voice * shimmer
    breath = _noise(seconds, rng, 150, 2_500, tilt=-2.0) * 0.06
    raw = voice + breath
    # Unvoiced air - a catch of breath at each join, and a rasp in the throat
    # at a few drawn moments - goes through the same mouth as the voice.
    air = np.zeros(length)
    air_env = np.zeros(length)
    joins = list(np.cumsum([seg + 0.05 for seg in lengths[:-1]]))
    for at in joins + [float(rng.uniform(0.1, max(0.2, seconds - 0.2)))
                       for _ in range(int(rng.integers(1, 4)))]:
        width = rng.uniform(0.05, 0.12)
        burst = _noise(width, rng, 300, 3_000, tilt=-1.0) * _envelope(_samples(width), 0.012, 0.03)
        _place(air, burst, at - 0.03, v.g(0.35) * float(np.max(np.abs(raw))))
        _place(air_env, np.ones(_samples(width)) * _envelope(_samples(width), 0.012, 0.03),
               at - 0.03, 1.0)
    raw = raw + air
    # The vowel path: open -> a drawn middle vowel -> closed, the mouth closing
    # at its own pace (the progress curve's exponent), scaled to this throat.
    middle = _VOWELS[int(rng.integers(1, len(_VOWELS) - 1))] if len(_VOWELS) > 2 else _VOWELS[1]
    path = (_VOWELS[0], middle, _VOWELS[-1])
    vowels = [[(centre * v.cutoff, width * rng.uniform(0.8, 1.3), amp) for centre, width, amp in vowel]
              for vowel in path]
    # The mouth closes over the first moan; any later moans stay in the back
    # of the mouth and drift between the closed vowels.
    closing = np.clip(time / lengths[0], 0.0, 1.0) ** rng.uniform(0.6, 1.2)
    drift = 0.82 + 0.18 * np.sin(2 * np.pi * rng.uniform(0.5, 1.2) * time + rng.uniform(0, 6))
    progress = np.where(time < lengths[0], closing, drift)
    out = _glide_formants(raw, vowels, progress)
    # Syllables: each segment swells and sinks on its own, with a catch between.
    shape = np.zeros(length)
    at = 0.0
    for k, seg in enumerate(lengths):
        n = _samples(seg)
        env = _adsr(n, v.d(rng.uniform(0.08, 0.22)), 0.4, rng.uniform(0.55, 0.8),
                    v.d(rng.uniform(0.15, 0.35)))
        start = int(at * SAMPLE_RATE)
        env = env[: length - start]
        shape[start:start + len(env)] += env * (1.0 if k == 0 else rng.uniform(0.6, 0.95))
        at += seg + 0.05
    shape = np.maximum(shape, 0.5 * np.clip(air_env, 0.0, 1.0))  # the breaths are not muted
    return _finish(out * shape, "zombies", 0.3, velocity - 1.0)


def flesh_sound(rng: np.random.Generator, headshot: bool, pitch: float = 1.0,
                velocity: float = 0.0, decay: float | None = None) -> np.ndarray:
    """A wet impact. The head adds a sharp crack on top of it."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.35)
    wet = _noise(0.24, rng, 60, 500 * v.p, order=3)
    _place(out, wet * _envelope(len(wet), 0.002, v.d(0.045)), 0.0, v.g(1.0))
    body = _chirp(160 * v.p, 60 * v.p, 0.16, curve=0.5)
    _place(out, body * _envelope(len(body), 0.002, v.d(0.04)), 0.0, v.g(0.8))
    squelch = _noise(0.2, rng, 900, 4_000)  # the wet part: a rapidly flickering band
    squelch *= _lowpass(np.abs(rng.standard_normal(len(squelch))), 120.0)
    _place(out, squelch * _envelope(len(squelch), 0.003, v.d(0.045)), 0.004, v.g(0.3))
    for _ in range(int(rng.integers(2, 5))):  # a few wet droplets after
        drop = _noise(0.02, rng, 1_500, 5_000)
        _place(out, drop * _envelope(len(drop), 0.001, 0.004), rng.uniform(0.04, 0.18),
               v.g(0.15))
    if headshot:
        _place(out, _click(rng, 0.006, 600, 9_000), 0.0, v.g(1.6))
        crack = _noise(0.05, rng, 1_500, 8_000)
        _place(out, crack * _envelope(len(crack), 0.0005, v.d(0.008)), 0.0, v.g(1.2))
        _place(out, _metal(rng, 1_900 * v.p, v.d(0.01), 0.5), 0.0, 0.6)  # bone
    return _finish(out, "zombies", 0.2, velocity + (1.0 if headshot else 0.0))


def hurt_sound(rng: np.random.Generator, pitch: float = 1.0, velocity: float = 0.0,
               decay: float | None = None) -> np.ndarray:
    """Something got a hand on you: a body blow and a sting of adrenaline."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(1.0)
    blow = _noise(0.3, rng, 40, 300, order=3)
    _place(out, blow * _envelope(len(blow), 0.003, v.d(0.07)), 0.0, v.g(1.0))
    # Two close tones beat against each other - the ringing-ears sting.
    sting = _modes([196 * v.p, 207 * v.p, 392 * v.p], [0.5, 0.5, 0.2],
                   [v.d(0.2), v.d(0.2), v.d(0.12)], rng, seconds=0.95, fade=0.2)
    _place(out, sting, 0.01, v.g(0.7))
    pulse = _noise(0.12, rng, 40, 200, order=3)  # a second, softer heartbeat thump
    _place(out, pulse * _envelope(len(pulse), 0.003, v.d(0.04)), v.j(0.32), v.g(0.5))
    return _finish(out, "zombies", 0.2, velocity + 1.0)


def _tone(f0: np.ndarray, rng: np.random.Generator, harmonics: int = 7,
          brightness_decay: float = 0.35, detune_cents: float = 0.0) -> np.ndarray:
    """A mallet-ish tone on a pitch track ``f0`` (Hz per sample): a handful of
    harmonics whose upper ones die faster than the fundamental, so the
    spectrum darkens as the note rings rather than standing as a frozen comb.
    ``detune_cents`` pulls every harmonic above the second a few cents off
    true, the way a struck bar's partials sit, so the stack does not read as
    an exact-harmonic organ patch."""
    time = _time(len(f0))
    angle = 2 * np.pi * np.cumsum(f0) / SAMPLE_RATE
    wave = np.zeros_like(f0)
    for k in range(1, harmonics + 1):
        level = 1.0 / k ** 1.2 * (1.0 if k < 3 else rng.uniform(0.5, 1.0))
        stretch = 1.0 if k < 3 or not detune_cents else \
            2.0 ** (float(rng.uniform(-detune_cents, detune_cents)) / 1200.0)
        wave += level * np.sin(k * angle * stretch + rng.uniform(0, 6)) \
            * np.exp(-time * (k - 1) / brightness_decay)
    return _peak(wave)


def round_over_sound(rng: np.random.Generator | None = None, pitch: float = 1.0,
                     velocity: float = 0.0, decay: float | None = None) -> np.ndarray:
    """Two notes falling a fourth to close the round, pitched down into the
    low register: each slides into its pitch, a slow vibrato arrives after the
    attack, the harmonics die from the top down, and the pair hangs in a long
    reverb tail. A motif, not a pad."""
    rng = rng if rng is not None else np.random.default_rng(7)
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(2.2)
    vib_rate = v.j(4.6, 0.2)
    for at, frequency, seconds, drop in ((0.0, 330.0, 0.7, 1.05), (0.42, 247.0, 1.5, 1.06)):
        seconds = v.d(seconds)
        length = _samples(seconds)
        time = _time(length)
        glide = drop ** np.exp(-time / 0.08)  # slides down into the note
        vibrato = 1.0 + 0.018 * np.sin(2 * np.pi * vib_rate * time + rng.uniform(0, 6)) \
            * np.clip((time - 0.12) / 0.3, 0, 1)  # vibrato arrives after the attack
        f0 = frequency * v.p * glide * vibrato
        note = _tone(f0, rng, 7, v.d(0.3 if at == 0.0 else 0.45))
        # A detuned second voice a few cents off: a slow chorus beat.
        note += 0.35 * _tone(f0 * (1.0 + rng.uniform(0.002, 0.004)), rng, 5, v.d(0.25))
        note *= _adsr(length, 0.012, 0.3, 0.5, 0.45 * seconds)
        _place(out, note, at, 1.0)
        strike = _noise(0.02, rng, frequency, frequency * 4, order=3)  # the mallet
        _place(out, strike * _envelope(len(strike), 0.0005, 0.004), at, 0.12)
    return _finish(out, "zombies", 0.5, velocity - 1.0)


# --- western -------------------------------------------------------------------

def rifle_crack_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A lever rifle: brighter and longer than the pistol, slapping back off the
    street fronts, and the lever worked after."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(1.6))
    _place(out, _click(rng, 0.003, 1_500, 14_000), 0.0, v.g(1.5))
    crack = _noise(0.14, rng, 600 * v.p, v.c(9_000 * v.p), tilt=1.0)
    _place(out, crack * _envelope(len(crack), 0.0005, v.d(0.018)), 0.0, v.g(1.0))
    boom = _chirp(180 * v.p, 55 * v.p, 0.22, curve=0.5)
    _place(out, boom * _envelope(len(boom), 0.002, v.d(0.06)), 0.002, v.g(0.9))
    sub = _chirp(60 * v.p, 40 * v.p, 0.25, curve=0.7)
    _place(out, sub * _envelope(len(sub), 0.004, v.d(0.08)), 0.004, v.g(0.45))
    tail = _noise(0.55, rng, 150, v.c(2_500), tilt=-3.0)
    _place(out, tail * _envelope(len(tail), 0.005, v.d(0.12)), 0.01, v.g(0.35))
    _room(out, v, 0.035, span=(0.05, 0.12), cutoff=4_000, gain=0.5, tail_cut=700,
          tail_decay=0.3, tail_gain=0.7)
    _gun_mechanics(out, v, v.j(0.2, 0.2), 2_300, v.g(0.4))  # the lever
    return _finish(out, "western", 0.3, velocity + 1.0)


def bottle_break_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """Glass: a crack, a burst of bright noise, then shards tinkling down."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.8)
    _place(out, _click(rng, 0.004, 2_000, 16_000), 0.0, v.g(1.5))
    burst = _noise(0.12, rng, 2_500 * v.p, 14_000, tilt=2.0)
    _place(out, burst * _envelope(len(burst), 0.0005, v.d(0.025)), 0.0, v.g(1.0))
    body = _modes([1_900 * v.p, 3_200 * v.p, 5_100 * v.p], [0.5, 0.3, 0.15],
                  [v.d(0.02), 0.012, 0.008], rng)
    _place(out, body, 0.0, v.g(0.8))
    for _ in range(int(rng.integers(10, 16))):  # the shards
        frequency = rng.uniform(3_500, 9_500) * v.p
        shard = _modes([frequency, frequency * 1.5, frequency * 2.3], [1.0, 0.3, 0.1],
                       [v.d(rng.uniform(0.008, 0.03)), 0.008, 0.004], rng)
        _place(out, shard, rng.uniform(0.02, 0.45) ** 1.3 * 0.9 + 0.02, rng.uniform(0.15, 0.4))
    return _finish(out, "western", 0.25, velocity)


def ricochet_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """The classic whine: a click, then a falling, wavering pitch - *pyeeow*."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.6)
    _place(out, _click(rng, 0.003, 1_500, 12_000), 0.0, v.g(1.2))
    spark = _noise(0.05, rng, 2_000, 10_000)
    _place(out, spark * _envelope(len(spark), 0.0005, 0.01), 0.0, v.g(0.8))
    seconds = v.d(0.45)
    length = _samples(seconds)
    time = _time(length)
    frequency = 2_600 * v.p * (0.32 ** (time / seconds)) \
        * (1 + 0.02 * np.sin(2 * np.pi * v.j(28.0) * time))
    whine = np.sin(2 * np.pi * np.cumsum(frequency) / SAMPLE_RATE)
    whine += 0.3 * np.sin(4 * np.pi * np.cumsum(frequency) / SAMPLE_RATE)
    _place(out, whine * _adsr(length, 0.012, 0.2, 0.5, 0.2), 0.012, v.g(0.7))
    return _finish(out, "western", 0.3, velocity - 1.0)


def wood_splinter_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A bullet into a plank: a woody knock and a crackle of splinters."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.45)
    _place(out, _click(rng, 0.004, 500, 8_000), 0.0, v.g(1.2))
    knock = _modes([310 * v.p, 640 * v.p, 1_150 * v.p], [1.0, 0.5, 0.3],
                   [v.d(0.035), v.d(0.02), 0.012], rng)
    _place(out, knock, 0.0, v.g(1.0))
    thud = _noise(0.12, rng, 80, 500, order=3)
    _place(out, thud * _envelope(len(thud), 0.001, v.d(0.03)), 0.0, v.g(0.9))
    for _ in range(int(rng.integers(6, 11))):  # the crackle
        _place(out, _click(rng, rng.uniform(0.002, 0.005), 800, 7_000),
               rng.uniform(0.01, 0.2), rng.uniform(0.2, 0.6))
    return _finish(out, "western", 0.2, velocity)


def bandit_down_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A body hits the dirt: a heavy thump, a second one, and dust settling."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(0.9))
    for at, gain, cutoff in ((0.0, 1.0, 180.0), (v.j(0.17, 0.3), 0.6, 140.0)):
        thud = _noise(0.25, rng, 35, v.c(cutoff * v.p), order=3)
        _place(out, thud * _envelope(len(thud), 0.003, v.d(0.06)), at, v.g(gain))
        body = _chirp(120 * v.p, 45 * v.p, 0.2, curve=0.5)
        _place(out, body * _envelope(len(body), 0.004, v.d(0.05)), at, v.g(0.7 * gain))
    leather = _noise(0.15, rng, 400, 3_000)  # gear and cloth
    _place(out, leather * _envelope(len(leather), 0.005, 0.03), 0.02, v.g(0.25))
    dust = _noise(0.6, rng, 500, 2_500, tilt=-2.0)
    _place(out, dust * _adsr(len(dust), 0.05, 0.3, 0.3, 0.3), 0.1, v.g(0.12))
    return _finish(out, "western", 0.45, velocity)


def bell_toll_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """The church bell at the end of the street: hum, prime, tierce-ish,
    nominal and two uppers. Every partial is a *pair* a hair apart (a beat of
    1..3 Hz, as a real bell's doublets beat), each with its own decay (the
    high ones go first, the hum outlives everything), and the clapper is an
    8 ms noise strike with a dull body, not a pure-tone onset."""
    v = _Take(rng, pitch, velocity, decay)
    hum = 330.0 * v.p
    ratios = (0.5, 1.0, 1.5, 2.0, 2.7, 3.6)
    amps = (0.55, 1.0, 0.5, 0.55, 0.25, 0.12)
    base_decays = (0.7, 0.5, 0.34, 0.24, 0.15, 0.09)
    freqs, levels, decays = [], [], []
    for ratio, amp, d in zip(ratios, amps, base_decays):
        f = hum * ratio
        beat = rng.uniform(1.0, 3.0)  # Hz between the doublet's two lines
        for sign in (-0.5, 0.5):
            freqs.append(f + sign * beat)
            levels.append(0.5 * amp * v.g(1.0, 1.5))
            decays.append(v.d(d * rng.uniform(0.85, 1.15)))
    bell = _modes(freqs, levels, decays, rng)
    out = _canvas(len(bell) / SAMPLE_RATE)
    _place(out, bell, 0.0, 1.0)
    strike = _noise(0.008, rng, 300, v.c(3_500), order=1)  # the clapper's edge
    _place(out, strike * _envelope(len(strike), 0.0003, 0.002), 0.0, v.g(1.3))
    body = _noise(0.05, rng, 200, 1_600)  # the clapper's dull body
    _place(out, body * _envelope(len(body), 0.0008, v.d(0.01)), 0.0, v.g(0.8))
    return _finish(out, "western", 0.35, velocity - 1.0)


def _wander(wave: np.ndarray, rng: np.random.Generator, low: float = 200.0,
            high: float = 2_000.0, stops: int = 8, width: float = 0.35,
            floor: float = 0.08) -> np.ndarray:
    """A resonant bandpass whose centre takes a random walk between ``low``
    and ``high`` (in log frequency) over the sound, re-tuned frame by frame.
    The spectrogram shows a wandering bright ridge, not a uniform smear."""
    walk = np.cumsum(rng.standard_normal(stops))
    walk = (walk - walk.min()) / max(walk.max() - walk.min(), 1e-9)
    centres = low * (high / low) ** walk
    path = [((c, c * width, 1.0), (c * 2.5, c * 1.2, 0.3)) for c in centres]
    progress = np.linspace(0.0, 1.0, len(wave))
    return _peak(_glide_formants(wave, path, progress, frame=1024, hop=256)) \
        + floor * _peak(wave)


def wind_dust_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A bed of dry wind, 2.5 s, with soft edges so re-triggering it loops.
    A resonant whistle wanders up and down the band as the gusts come and go."""
    v = _Take(rng, pitch, velocity, decay)
    seconds = 2.5
    bed = _noise(seconds, rng, 120 * v.p, 1_500 * v.p, tilt=-2.0)
    whistle = _wander(rng.standard_normal(len(bed)), rng, 250 * v.p, 1_800 * v.p,
                      stops=int(rng.integers(6, 10)), width=0.18, floor=0.05)
    gust = 0.55 + 0.45 * _peak(_lowpass(rng.standard_normal(len(bed)), v.j(0.9)))
    grit = _noise(seconds, rng, 2_000, 6_000)  # sand against the boards
    grit *= np.clip(_lowpass(rng.standard_normal(len(bed)), 3.0) * 4, 0, None)
    fade = 0.5 - 0.5 * np.cos(np.pi * np.clip(_time(len(bed)) / 0.6, 0.0, 1.0))
    loop = np.minimum(fade, fade[::-1])  # the same soft edge in and out
    wind = bed * v.g(0.3) + whistle * gust ** 1.5 * v.g(1.0)
    return _finish((wind * gust + v.g(0.08) * grit) * loop, None, 0.0, velocity - 1.5)


# --- orbit ---------------------------------------------------------------------

def suppressed_shot_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A silenced pistol: a soft *pfft* with a hollow can resonance, then the
    slide clacking back and the case ringing off the deck."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(0.7))
    _place(out, _click(rng, 0.002, 300, 3_000), 0.0, v.g(0.6))
    puff = _noise(0.11, rng, 120 * v.p, v.c(1_800 * v.p), order=3)
    _place(out, puff * _envelope(len(puff), 0.003, v.d(0.022)), 0.0, v.g(1.0))
    can = _modes([410 * v.p, 690 * v.p], [0.5, 0.25], [v.d(0.02), 0.012], rng)
    _place(out, can, 0.001, v.g(0.5))
    thump = _chirp(150 * v.p, 60 * v.p, 0.1)
    _place(out, thump * _envelope(len(thump), 0.002, v.d(0.03)), 0.0, v.g(0.6))
    _room(out, v, 0.025, span=(0.03, 0.09), cutoff=2_000, gain=0.35, tail_cut=350,
          tail_decay=0.07, tail_gain=0.35)
    _gun_mechanics(out, v, v.j(0.065), 2_700, v.g(0.3))
    case = _metal(rng, 5_200 * v.p, v.d(0.03), 0.25, ratios=(1.0, 1.9, 2.7))
    _place(out, case, v.j(0.24), v.g(0.08))
    return _finish(out, "orbit", 0.06, velocity - 1.0)


def debris_hit_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A bullet into a drifting chunk: a knock and a scatter of fragments."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(0.6))
    _place(out, _click(rng, 0.003, 800, v.c(9_000)), 0.0, v.g(1.0))
    knock = _modes([420 * v.p, 900 * v.p, 1_700 * v.p], [1.0, 0.5, 0.25],
                   [v.d(0.03), v.d(0.02), 0.01], rng)
    _place(out, knock, 0.0, v.g(1.0))
    for _ in range(int(rng.integers(5, 9))):
        frequency = rng.uniform(1_200, 4_500) * v.p
        frag = _modes([frequency, frequency * 1.7], [1.0, 0.4],
                      [v.d(rng.uniform(0.006, 0.02)), 0.005], rng)
        _place(out, frag, rng.uniform(0.02, 0.25), rng.uniform(0.2, 0.5))
    return _finish(out, "orbit", 0.45, velocity - 1.0)


def hull_thud_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """Something hits the station: a thud you feel through the metal, then the
    plating rings and creaks. Each take is a different patch of hull: its own
    set of plate modes, its own number of creaks at their own moments, and a
    grind of the plating that lands where it lands - not the same thud at a
    different level."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(v.L(1.8))
    # The thud: a low knock, arriving as one or two blows (a tumbling chunk).
    blows = int(rng.integers(1, 3))
    for k in range(blows):
        at = 0.0 if k == 0 else rng.uniform(0.05, 0.14)
        thud = _noise(0.25, rng, 30, v.c(rng.uniform(160, 280) * v.p), order=3)
        _place(out, thud * _envelope(len(thud), 0.003, v.d(rng.uniform(0.04, 0.08))), at,
               v.g(1.0 if k == 0 else 0.5))
        _place(out, _click(rng, 0.004, 200, v.c(2_500)), at, v.g(0.8 if k == 0 else 0.4))
    # The plate modes: five drawn from a spread, the lowest always present.
    base = rng.uniform(70, 95) * v.p
    ratios = np.sort(np.concatenate(([1.0], rng.uniform(1.4, 6.0, 4))))
    decays = [v.d(0.55 * 0.72 ** k * rng.uniform(0.7, 1.3)) for k in range(5)]
    amps = [1.0 * 0.72 ** k * rng.uniform(0.6, 1.2) for k in range(5)]
    ring = _modes(list(base * ratios), amps, decays, rng, detune=0.01,
                  seconds=v.L(1.6), fade=0.3)
    _place(out, ring, 0.004, v.g(0.7))
    # The plating grinding on its frame: one or two bursts, where they fall.
    for _ in range(int(rng.integers(1, 3))):
        grind = _noise(rng.uniform(0.06, 0.16), rng, 300, v.c(3_000))
        _place(out, grind * _envelope(len(grind), 0.002, v.d(0.03)), rng.uniform(0.0, 0.12), v.g(0.3))
    # Creaks of stressed steel: none, one, two or three, each its own pitch and length.
    for _ in range(int(rng.integers(0, 4))):
        seconds = rng.uniform(0.15, 0.4)
        n = _samples(seconds)
        bend = 1.0 + rng.uniform(-0.08, 0.08) * np.linspace(0, 1, n)
        creak = np.sin(2 * np.pi * np.cumsum(rng.uniform(500, 1_100) * v.p * bend) / SAMPLE_RATE)
        creak *= _adsr(n, rng.uniform(0.02, 0.08), 0.1, 0.4, 0.4 * seconds)
        creak *= 0.6 + 0.4 * _peak(_lowpass(rng.standard_normal(n), 18.0))  # it groans
        _place(out, creak, rng.uniform(0.2, 1.0), v.g(0.1))
    return _finish(out, "orbit", 0.4, velocity + 1.0)


def glass_crack_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A viewport spidering: a sharp snap and a crackle racing outwards."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.55)
    _place(out, _click(rng, 0.004, 2_500, 16_000), 0.0, v.g(1.5))
    snap = _noise(0.06, rng, 3_000 * v.p, 14_000)
    _place(out, snap * _envelope(len(snap), 0.0003, v.d(0.008)), 0.0, v.g(1.0))
    count = int(rng.integers(14, 24))
    for i in range(count):  # the crack propagating
        at = 0.01 + (i / 20.0) ** rng.uniform(1.3, 1.9) * v.d(0.3) + rng.uniform(0, 0.01)
        _place(out, _click(rng, rng.uniform(0.001, 0.003), 3_000, 15_000), at,
               rng.uniform(0.25, 0.7))
    pane = _modes([4_200 * v.p, 4_200 * v.p * 1.004, 6_100 * v.p, 6_100 * v.p * 0.995],
                  [0.2, 0.2, 0.1, 0.1], [v.d(0.09), v.d(0.06), v.d(0.05), v.d(0.03)], rng,
                  seconds=0.5, fade=0.1)
    _place(out, pane, 0.002, v.g(1.0))
    return _finish(out, "orbit", 0.2, velocity - 1.0)


def alarm_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """The station klaxon: two tones alternating through a tinny speaker.

    Each beep is a filtered sawtooth with a slow vibrato and its own swell and
    release, not a gated block; the speaker adds a resonant honk at 1.2 kHz
    and a touch of rattle on the loud bits."""
    v = _Take(rng, pitch, velocity, decay)
    beep, gap = v.L(0.26), 0.06
    out = _canvas(4 * (beep + gap) + 0.1)
    for i in range(4):
        frequency = (880 if i % 2 == 0 else 660) * v.p
        length = _samples(beep)
        time = _time(length)
        vib = 1.0 + 0.018 * np.sin(2 * np.pi * v.j(6.5) * time + rng.uniform(0, 6))
        drift = 1.0 + 0.01 * np.sin(np.pi * time / beep)  # the tone sags slightly
        tone = _saw(frequency * vib * drift, rng.uniform(0, 6), brightness=1.2)
        tone *= _adsr(length, 0.02, 0.12, 0.75, 0.06)
        _place(out, tone, i * (beep + gap), v.g(1.0, 1.0))
    rattle = out * _peak(_lowpass(np.abs(rng.standard_normal(len(out))), 60.0)) * 0.06
    speaker = _shape(out + rattle, lambda f: _highpass_gain(f, 450, 2)
                     * _lowpass_gain(f, v.c(3_800), 2) * (1.0 + 1.2 / (1.0 + ((f - 1_200) / 180) ** 2)))
    return _finish(speaker, "orbit", 0.3, velocity - 1.5)


def static_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """Radio static: a hiss whose resonant band takes a random walk as if the
    tuner were drifting, breaking up into crackle bursts, with a few pops,
    fading in and out."""
    v = _Take(rng, pitch, velocity, decay)
    seconds = v.L(0.75)
    length = _samples(seconds)
    hiss = _wander(rng.standard_normal(length), rng, 400 * v.p, 3_500 * v.p,
                   stops=int(rng.integers(5, 9)), width=0.3, floor=0.12)
    # Breakup: a slow wobble, plus bursts of crackle where the signal drops out.
    wobble = np.clip(_lowpass(rng.standard_normal(length), v.j(9.0)) * 2.5 + 0.7, 0.05, 1.0)
    crackle = np.clip(_lowpass(rng.standard_normal(length), 140.0) * 6.0 - 1.0, 0.0, None)
    crackle = _peak(crackle) * np.clip(_lowpass(rng.standard_normal(length), 5.0) * 3.0, 0.0, 1.0)
    out = hiss * (wobble + 1.5 * crackle)
    out *= _adsr(length, v.j(0.06), 0.15, 0.85, v.j(0.12))  # soft edges in and out
    for _ in range(int(rng.integers(4, 9))):
        _place(out, _click(rng, rng.uniform(0.001, 0.003), 500, 6_000),
               rng.uniform(0.04, seconds - 0.05), rng.uniform(0.5, 1.2))
    return _finish(out, "dry", 0.1, velocity - 1.5)


# --- sniper --------------------------------------------------------------------

def sniper_shot_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """A big rifle in a wide valley: a huge crack, a chest-deep boom, then the
    report coming back off the hills as distinct, darkening echoes."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(1.0)
    _place(out, _click(rng, 0.004, 1_000, 16_000), 0.0, v.g(1.8))
    crack = _noise(0.14, rng, 400 * v.p, v.c(12_000), tilt=0.5)
    _place(out, crack * _envelope(len(crack), 0.0005, v.d(0.022)), 0.0, v.g(1.0))
    boom = _chirp(140 * v.p, 38 * v.p, 0.35, curve=0.5)
    _place(out, boom * _envelope(len(boom), 0.003, v.d(0.1)), 0.003, v.g(1.1))
    sub = _chirp(48 * v.p, 30 * v.p, 0.4, curve=0.6)
    _place(out, sub * _envelope(len(sub), 0.006, v.d(0.14)), 0.005, v.g(0.5))
    rumble = _noise(0.6, rng, 40, 400, order=3)
    _place(out, rumble * _envelope(len(rumble), 0.01, v.d(0.11)), 0.01, v.g(0.5))
    tail = _noise(0.6, rng, 200, 3_000, tilt=-3.0)
    _place(out, tail * _envelope(len(tail), 0.005, v.d(0.09)), 0.01, v.g(0.35))
    _room(out, v, 0.04, span=(0.05, 0.12), cutoff=4_500, gain=0.5, tail_cut=500,
          tail_decay=0.14, tail_gain=0.4)
    # The report comes back off the hills: three to four distinct, ever darker
    # echoes, each a dulled, smeared copy of the first 150 ms with a near-silent
    # gap before it, the gaps growing as the walls get further away.
    report = out[: _samples(0.15)] * _envelope(_samples(0.15), 0.001, 0.05)
    canvas = _canvas(2.6)
    _place(canvas, out, 0.0, 1.0)
    at, gain, cutoff = v.j(0.34, 0.15), 0.5, 1_400.0
    for k in range(int(rng.integers(3, 5))):
        echo = _lowpass(report, cutoff * v.cutoff, order=3)
        # Smear each echo a little more than the last: a wall is not a mirror.
        echo = _reverb(echo, "dry", 0.6 + 0.5 * k)[: _samples(0.3)]
        _place(canvas, _peak(echo) * _envelope(_samples(0.3), 0.004, 0.07 + 0.03 * k),
               at, v.g(gain))
        at += v.j(0.36 + 0.12 * k, 0.2)
        gain *= rng.uniform(0.5, 0.7)
        cutoff *= 0.65
    return _finish(canvas, "sniper", 0.12, velocity + 1.5)


def bolt_cycle_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """Working the bolt: the handle unlocking with a thin 3.2 kHz click, the
    bolt sliding back on a sustained metallic ring (the rails), the case
    flicking out with a tiny ping, and the bolt slamming home with a heavy
    900 Hz clack and a 1.8 kHz lock-up. Four different pieces of steel."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(0.65)
    # 1. unlock: thin and bright
    unlock = _noise(0.012, rng, 1_500 * v.p, v.c(14_000), order=1)
    unlock = _shape(unlock, lambda f: _formant_gain(f, [(3_200 * v.p, 500, 1.0), (6_500 * v.p, 1_400, 0.3)], 0.1))
    _place(out, _peak(unlock) * _envelope(len(unlock), 0.0002, 0.003), 0.0, v.g(1.2))
    _place(out, _metal(rng, 3_100 * v.p, v.d(0.01), 0.6), 0.0, 0.8)
    twist = _noise(0.04, rng, 150, 900, order=3)  # the hand on the handle
    _place(out, twist * _envelope(len(twist), 0.001, v.d(0.012)), 0.0, v.g(0.5))
    # 2. the slide back: a scrape with a sustained metallic ring of the rails
    slide_at, slide_len = v.j(0.05), v.L(0.18)
    slide = _noise(slide_len, rng, 800, 5_000)
    slide = _shape(slide, lambda f: _formant_gain(f, [(2_600 * v.p, 600, 1.0), (1_200 * v.p, 400, 0.4)], 0.2))
    _place(out, _peak(slide) * _adsr(len(slide), 0.03, 0.1, 0.6, 0.05), slide_at, v.g(0.22))
    rails = _modes([2_600 * v.p, 2_600 * v.p * 1.002, 4_300 * v.p], [0.5, 0.5, 0.25],
                   [v.d(0.06), v.d(0.05), 0.03], rng, seconds=slide_len, fade=0.05)
    _place(out, rails * _adsr(len(rails), 0.02, 0.1, 0.5, 0.06), slide_at, v.g(0.25))
    # 3. the case flicks out: a tiny ping, somewhere during the slide
    case = _metal(rng, rng.uniform(5_000, 7_000) * v.p, v.d(0.03), 0.25, ratios=(1.0, 1.9, 2.7))
    _place(out, case, slide_at + rng.uniform(0.03, 0.1), v.g(0.15))
    # 4. home: heavy and low, then the lock-up
    home_at = slide_at + slide_len + v.j(0.04, 0.3)
    home = _noise(0.025, rng, 250 * v.p, v.c(5_000), order=1)
    home = _shape(home, lambda f: _formant_gain(f, [(900 * v.p, 220, 1.0), (1_800 * v.p, 450, 0.4)], 0.08))
    _place(out, _peak(home) * _envelope(len(home), 0.0003, 0.006), home_at, v.g(1.4))
    _place(out, _click(rng, 0.004, 800 * v.p, 8_000), home_at, v.g(0.9))
    _place(out, _metal(rng, 1_800 * v.p, v.d(0.02), 0.6, ratios=(1.0, 1.77, 2.73, 3.9)),
           home_at + 0.012, 0.8)
    thunk = _noise(0.06, rng, 100, 700, order=3)
    _place(out, thunk * _envelope(len(thunk), 0.001, v.d(0.015)), home_at, v.g(0.9))
    return _finish(out, "dry", 0.15, velocity - 1.0)


def _scope_sound(rng, rising: bool, pitch: float, velocity: float, decay) -> np.ndarray:
    """The scope *whum*: a swept tone with a filtered-noise swell that follows
    it (the noise is band-passed around the tone and shares its envelope), a
    second, softer octave above, and the mechanical click of the scope
    engaging - before the rise for scope-in, after the fall for scope-out."""
    v = _Take(rng, pitch, velocity, decay)
    seconds = v.L(0.38)
    length = _samples(seconds)
    time = _time(length)
    start, end = (170.0, 640.0) if rising else (760.0, 150.0)
    glide = (time / seconds) ** 0.8
    f0 = start * v.p * (end / start) ** glide
    vib = 1.0 + 0.006 * np.sin(2 * np.pi * 7.0 * time)
    sweep = np.sin(2 * np.pi * np.cumsum(f0 * vib) / SAMPLE_RATE)
    sweep += 0.35 * np.sin(4 * np.pi * np.cumsum(f0 * vib) / SAMPLE_RATE + 1.0)
    # The noise layer: band-passed around the tone, re-tuned frame by frame.
    stops = [((f * 2.2, f * 0.8, 1.0), (f * 5.0, f * 1.5, 0.35))
             for f in (start * v.p, end * v.p)]
    swell = _peak(_glide_formants(rng.standard_normal(length), stops, glide, frame=1024, hop=256))
    # The envelope rises with the tone (scope-in: a swell; scope-out: a fast
    # start that sinks away), and the noise swells with it but dies sooner.
    env = _adsr(length, v.j(0.09 if rising else 0.02), 0.12, 0.7, v.j(0.14 if rising else 0.22))
    noise_env = env * np.clip(1.0 - time / seconds, 0.15, 1.0) ** (0.6 if rising else 1.4)
    out = sweep * env * v.g(0.8) + swell * noise_env * v.g(0.45)
    # The click of the scope ring: a small bit of metal and a thunk of the stock.
    click_at = 0.0 if rising else 0.004  # scope-out: the ring unlocks, then it falls
    _place(out, _click(rng, 0.003, 1_500, 9_000), click_at, v.g(0.55))
    _place(out, _metal(rng, 3_600 * v.p, v.d(0.008), 0.5), click_at, 0.6)
    thunk = _noise(0.03, rng, 120, 600, order=3)
    _place(out, thunk * _envelope(len(thunk), 0.001, 0.006), click_at, v.g(0.5))
    return _finish(out, "dry", 0.15, velocity - 1.5)


def scope_in_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    return _scope_sound(rng, True, pitch, velocity, decay)


def scope_out_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    return _scope_sound(rng, False, pitch, velocity, decay)


def distant_impact_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """Far away: a beat of nothing, then a muffled thud rolling back up the
    valley - everything above a few hundred hertz lost to the distance."""
    v = _Take(rng, pitch, velocity, decay)
    out = _canvas(1.1)
    delay = v.j(0.25)
    thud = _noise(0.3, rng, 40, 260 * v.p, order=3)
    _place(out, thud * _envelope(len(thud), 0.006, v.d(0.07)), delay, v.g(1.0))
    body = _chirp(110 * v.p, 45 * v.p, 0.3, curve=0.5)
    _place(out, body * _envelope(len(body), 0.008, v.d(0.08)), delay, v.g(0.7))
    roll = _noise(0.7, rng, 80, 900, tilt=-4.0)
    _place(out, roll * _envelope(len(roll), 0.02, v.d(0.18)), delay + 0.02, v.g(0.3))
    out = _lowpass(out, 380.0, order=3)
    return _finish(out, "far", 0.6, velocity - 1.0)


def headshot_ping_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """The steel-plate *ping* that means a clean hit: an inharmonic set of
    plate modes, the upper ones as detuned beating pairs that die first, a
    band-limited strike burst, and a slight droop in pitch as it rings."""
    v = _Take(rng, pitch, velocity, decay)
    seconds = v.L(0.7)
    length = _samples(seconds)
    time = _time(length)
    bend = 1.0 - 0.035 * np.clip(time / 0.3, 0, 1)  # a slight droop
    base = 2_150.0 * v.p
    ping = np.zeros(length)
    for ratio, amp, d in ((1.0, 1.0, 0.17), (1.58, 0.3, 0.08), (2.33, 0.4, 0.07),
                          (3.17, 0.18, 0.045), (3.9, 0.15, 0.035), (5.2, 0.07, 0.02)):
        pairs = ((0.0,),) if ratio == 1.0 else ((-1.0, 1.0),)
        for sign in pairs[0]:
            spread = rng.uniform(0.002, 0.005) * sign
            ping += amp * v.g(0.5, 2.0) * np.exp(-time / v.d(d * rng.uniform(0.8, 1.2))) \
                * np.sin(2 * np.pi * np.cumsum(base * ratio * (1.0 + spread) * bend) / SAMPLE_RATE
                         + rng.uniform(0, 6))
    ping *= 0.5 - 0.5 * np.cos(np.pi * np.clip((seconds - time) / 0.15, 0.0, 1.0))
    out = np.zeros(length)
    _place(out, ping, 0.0, 1.0)
    strike = _noise(0.015, rng, 1_200, v.c(14_000), order=1)  # the bullet on the plate
    _place(out, strike * _envelope(len(strike), 0.0002, v.d(0.004)), 0.0, v.g(1.4))
    _place(out, _click(rng, 0.003, 2_000, 14_000), 0.0, v.g(1.0))
    body = _noise(0.05, rng, 300, v.c(2_000))  # the plate's dull body
    _place(out, body * _envelope(len(body), 0.0005, v.d(0.012)), 0.0, v.g(0.5))
    return _finish(out, "sniper", 0.35, velocity - 1.0)


def wind_gust_sound(rng, pitch=1.0, velocity=0.0, decay=None) -> np.ndarray:
    """One gust crossing the valley, 2.2 s: it swells, brightens, and falls
    away, and a resonant whistle wanders through it - the note a real wind
    finds in a gap and loses again."""
    v = _Take(rng, pitch, velocity, decay)
    seconds = 2.2
    length = _samples(seconds)
    time = _time(length)
    raw = rng.standard_normal(length)
    # The gust's centre frequency rises with its strength: the whistle of real wind.
    strength = np.sin(np.pi * np.clip(time / seconds, 0, 1)) ** 1.5
    strength = strength * (0.8 + 0.2 * _peak(_lowpass(rng.standard_normal(length), v.j(2.0))))
    low = _bandpass(raw, 120 * v.p, 600 * v.p, tilt=-2)
    whistle = _wander(rng.standard_normal(length), rng, 300 * v.p, 2_200 * v.p,
                      stops=int(rng.integers(6, 11)), width=0.2, floor=0.05)
    out = _peak(low) * strength * v.g(0.45) + whistle * strength ** 1.6 * v.g(1.0)
    return _finish(out, None, 0.0, velocity - 1.5)


#: Name -> builder for every cue the maps raise by string.
NAMED_BUILDERS: dict[str, Callable[..., np.ndarray]] = {
    "rifle_crack": rifle_crack_sound, "bottle_break": bottle_break_sound,
    "ricochet": ricochet_sound, "wood_splinter": wood_splinter_sound,
    "bandit_down": bandit_down_sound, "bell_toll": bell_toll_sound,
    "wind_dust": wind_dust_sound,
    "suppressed_shot": suppressed_shot_sound, "debris_hit": debris_hit_sound,
    "hull_thud": hull_thud_sound, "glass_crack": glass_crack_sound,
    "alarm": alarm_sound, "static": static_sound,
    "sniper_shot": sniper_shot_sound, "bolt_cycle": bolt_cycle_sound,
    "scope_in": scope_in_sound, "scope_out": scope_out_sound,
    "distant_impact": distant_impact_sound, "headshot_ping": headshot_ping_sound,
    "wind_gust": wind_gust_sound,
}


# --- playback ------------------------------------------------------------------

class Mixer:
    """Sums the waveforms currently playing through a soft-knee limiter.
    Knows nothing about audio devices."""

    MAX_VOICES = 12

    def __init__(self, volume: float = 1.0) -> None:
        self.volume = max(0.0, volume)
        self._voices: list[tuple[np.ndarray, int]] = []
        self._lock = threading.Lock()

    @property
    def active(self) -> int:
        with self._lock:
            return len(self._voices)

    def add(self, wave: np.ndarray) -> None:
        with self._lock:
            # Drop the oldest voices rather than let a stuck loop pile up.
            del self._voices[:max(0, len(self._voices) - self.MAX_VOICES + 1)]
            self._voices.append((wave, 0))

    def render(self, frames: int) -> np.ndarray:
        """The next ``frames`` samples, with finished voices retired."""
        mixed = np.zeros(frames, dtype=np.float32)
        with self._lock:
            still_playing = []
            for wave, position in self._voices:
                chunk = wave[position:position + frames]
                mixed[:len(chunk)] += chunk
                if position + frames < len(wave):
                    still_playing.append((wave, position + frames))
            self._voices = still_playing
        # Linear up to the knee, then bent smoothly towards (never past) 1.0.
        return soft_knee(mixed * self.volume).astype(np.float32)


class Audio:
    """Wires a :class:`Mixer` to the sound card.

    Constructing it never raises. If no output device can be opened - a headless
    machine, audio in use elsewhere - it turns itself off and the game plays on
    in silence.
    """

    def __init__(self, volume: float = 1.0, enabled: bool = True) -> None:
        self.volume = max(0.0, volume)
        self.mixer = Mixer(self.volume)
        self._stream = None
        self.reason: str | None = None

        if not enabled or self.volume == 0.0:
            self.reason = "muted"
            return
        try:
            import sounddevice

            self._stream = sounddevice.OutputStream(
                samplerate=SAMPLE_RATE, channels=1, dtype="float32",
                blocksize=256, callback=self._fill)
            self._stream.start()
        except Exception as error:  # pragma: no cover - depends on the machine
            self._stream = None
            self.reason = f"no audio output ({error})"

    @property
    def is_on(self) -> bool:
        return self._stream is not None

    def _fill(self, outdata, frames: int, _time, _status) -> None:
        """Runs on the audio thread: hand the card the next block."""
        outdata[:, 0] = self.mixer.render(frames)

    def play(self, wave: np.ndarray | None) -> None:
        """Start a sound. Silently does nothing when there is no output."""
        if self._stream is None or wave is None:
            return
        self.mixer.add(wave)

    def close(self) -> None:
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None

    def __enter__(self) -> "Audio":
        return self

    def __exit__(self, *_exc) -> None:
        self.close()


def vary(wave: np.ndarray, rng: np.random.Generator, pitch_spread: float = 0.03,
         gain_spread_db: float = 0.8) -> np.ndarray:
    """A play-time variation of a finished take: re-pitched by up to
    ``pitch_spread`` (resampled, so the decay stretches with it) and
    re-levelled by up to ``gain_spread_db``. Cheap - one interpolation."""
    factor = float(rng.uniform(1.0 - pitch_spread, 1.0 + pitch_spread))
    gain = _db(float(rng.uniform(-gain_spread_db, gain_spread_db)))
    length = max(2, int(len(wave) / factor))
    source = np.arange(len(wave))
    target = np.linspace(0.0, len(wave) - 1, length)
    out = np.interp(target, source, wave.astype(np.float64)) * gain
    return (PEAK_CEILING * soft_knee(out / PEAK_CEILING)).astype(np.float32)


class Sounds:
    """The game's sound set, synthesised once and played on demand.

    Every sound is kept in :data:`VARIANTS` takes - a little sharper or flatter,
    a little louder or softer, with their own noise, decay and layer balance -
    one is drawn at random each time it plays, and it is re-pitched and
    re-levelled a hair on the way out. No two plays are the same.
    """

    PITCH_SPREAD = 2.0   # semitones, either way (about +-12 %)
    VELOCITY_SPREAD = 1.0  # dB, either way

    #: Finished wave sets, per (rings, seed, variants), shared by the process.
    #: The full set takes seconds of DSP to synthesise; nobody pays twice.
    _CACHE: dict = {}
    _CACHE_LOCK = threading.Lock()
    _WAVE_ATTRS = ("_shot", "_miss", "_cock", "_over", "_hits", "_groans",
                   "_flesh", "_hurt", "_named")

    def __init__(self, audio: Audio, rings: int, seed: int = 0,
                 variants: int = VARIANTS, background: bool = False) -> None:
        self.audio = audio
        self.rng = np.random.default_rng(seed)
        self._variants = max(1, variants)
        self.ready = True

        key = (rings, seed, self._variants)
        with Sounds._CACHE_LOCK:
            built = Sounds._CACHE.get(key)
        if built is not None:
            for name in self._WAVE_ATTRS:
                setattr(self, name, built[name])
            return

        if not background:
            self._build(rings)
            self._store(key)
            return

        # The full set takes seconds the player must not wait for. A small kit
        # of single takes covers the first moments; the rest is synthesised on
        # a worker thread and swapped in whole when it is done.
        self.ready = False
        self._stub(rings)
        threading.Thread(target=self._build_in_background, args=(rings, key),
                         daemon=True, name="synthesise-sounds").start()

    def _build(self, rings: int) -> None:
        rng = self.rng
        self._named: dict[str, list[np.ndarray]] = {}
        self._shot = self._takes(lambda p, v: shot_sound(rng, p, v))
        self._miss = self._takes(lambda p, v: miss_sound(rng, p, v))
        self._cock = self._takes(lambda p, v: cock_sound(rng, p, v))
        self._over = [round_over_sound(rng)]
        self._hits = [self._takes(lambda p, v, r=ring: hit_sound(r, rings, rng, p, v))
                      for ring in range(rings)]
        # A few pitches of groan, so the road does not sound like one creature.
        self._groans = [groan_sound(rng, pitch * 2.0 ** (rng.uniform(-2.0, 2.0) / 12.0), v)
                        for pitch in (62.0, 74.0, 88.0) for v in (0.0, -1.0)]
        self._flesh = {head: self._takes(lambda p, v, h=head: flesh_sound(rng, h, p, v))
                       for head in (True, False)}
        self._hurt = self._takes(lambda p, v: hurt_sound(rng, p, v))
        for name, builder in NAMED_BUILDERS.items():
            self._named[name] = self._takes(lambda p, v, b=builder: b(rng, p, v))

    def _stub(self, rings: int) -> None:
        """One plain take of each sound the first seconds can need."""
        rng = self.rng
        self._named = {}
        self._shot = [shot_sound(rng)]
        self._miss = [miss_sound(rng)]
        self._cock = [cock_sound(rng)]
        self._over = [round_over_sound(rng)]
        ping = hit_sound(0, rings, rng)
        self._hits = [[ping] for _ in range(rings)]
        self._groans = [groan_sound(rng, 74.0)]
        self._flesh = {True: [flesh_sound(rng, True)], False: [flesh_sound(rng, False)]}
        self._hurt = [hurt_sound(rng)]

    def _build_in_background(self, rings: int, key) -> None:
        # One plain take of every named cue FIRST, live the moment it exists.
        # The full set is seconds of DSP, and a map launched straight from the
        # command line raises its own cues from its first frames - a silent
        # opening volley is a bug, not a loading state. One take each is about
        # half a second on this thread and none at all on the player's.
        #
        # Its own generator: `self.rng` belongs to the main thread, which is
        # drawing takes out of it on every `_pick`, and a numpy Generator is
        # not safe to share.
        rng = np.random.default_rng((key[1] + 1) * 7919)
        planted = []
        for name, builder in NAMED_BUILDERS.items():
            take = builder(rng)
            self._named.setdefault(name, []).append(take)
            planted.append(take)
        try:
            full = Sounds(self.audio, rings, seed=key[1], variants=key[2])
        except Exception:
            return  # keep the stub rather than kill the thread noisily
        # Anything a map registered while the stub was live is kept: those cues
        # exist nowhere else, and swapping the set in wholesale would silence
        # them for the rest of the round. Merged into a fresh dict, because the
        # one the full set carries is now shared with the process-wide cache.
        # The stand-in takes planted above are dropped, not merged: the full
        # set carries richer ones under the same names.
        mine = {id(take) for take in planted}
        registered = {name: [t for t in takes if id(t) not in mine]
                      for name, takes in self._named.items()}
        registered = {name: takes for name, takes in registered.items() if takes}
        for name in self._WAVE_ATTRS:
            setattr(self, name, getattr(full, name))
        if registered:
            self._named = {name: list(takes) for name, takes in full._named.items()}
            for name, takes in registered.items():
                self._named.setdefault(name, []).extend(takes)
        self.ready = True

    def _store(self, key) -> None:
        with Sounds._CACHE_LOCK:
            Sounds._CACHE[key] = {name: getattr(self, name)
                                  for name in self._WAVE_ATTRS}

    def _takes(self, build: Callable[[float, float], np.ndarray]) -> list[np.ndarray]:
        """Several takes of one sound: the first is the straight one."""
        takes = [build(1.0, 0.0)]
        for _ in range(self._variants - 1):
            pitch = 2.0 ** (self.rng.uniform(-self.PITCH_SPREAD, self.PITCH_SPREAD) / 12.0)
            velocity = float(self.rng.uniform(-self.VELOCITY_SPREAD, self.VELOCITY_SPREAD))
            takes.append(build(pitch, velocity))
        return takes

    def _pick(self, takes: list[np.ndarray]) -> np.ndarray:
        return vary(takes[int(self.rng.integers(len(takes)))], self.rng)

    def shot(self) -> None:
        self.audio.play(self._pick(self._shot))

    def hit(self, ring: int) -> None:
        self.audio.play(self._pick(self._hits[min(max(ring, 0), len(self._hits) - 1)]))

    def miss(self) -> None:
        self.audio.play(self._pick(self._miss))

    def cock(self) -> None:
        self.audio.play(self._pick(self._cock))

    def round_over(self) -> None:
        self.audio.play(self._over[0])

    def register(self, name: str, wave: np.ndarray) -> None:
        """Add a named sound a map can ask for by string, with no coupling.
        Registering a name again adds another take of it."""
        self._named.setdefault(name, []).append(np.asarray(wave, dtype=np.float32))

    def play_named(self, name: str) -> None:
        """Play a registered sound; an unknown name is silently nothing."""
        takes = self._named.get(name)
        if takes:
            self.audio.play(self._pick(takes))

    def groan(self) -> None:
        self.audio.play(self._pick(self._groans))

    def flesh(self, headshot: bool) -> None:
        self.audio.play(self._pick(self._flesh[bool(headshot)]))

    def hurt(self) -> None:
        self.audio.play(self._pick(self._hurt))

    # --- introspection, for tests and the render script ----------------------

    def names(self) -> list[str]:
        return sorted(self._named)

    def variants(self, name: str) -> list[np.ndarray]:
        """Every take of a named cue (empty for an unknown name)."""
        return list(self._named.get(name, ()))

    def catalogue(self) -> dict[str, list[np.ndarray]]:
        """Every sound the set holds, by a readable name, all takes."""
        out: dict[str, list[np.ndarray]] = {
            "shot": self._shot, "miss": self._miss, "cock": self._cock,
            "round_over": self._over, "hurt": self._hurt,
            "flesh": self._flesh[False], "flesh_headshot": self._flesh[True],
            "groan": self._groans,
        }
        for ring, takes in enumerate(self._hits):
            out[f"hit_ring{ring}"] = takes
        out.update(self._named)
        return out
