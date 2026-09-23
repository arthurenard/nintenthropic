import numpy as np
import pytest

from handy.audio import (LIMITER_KNEE, NAMED_BUILDERS, NAMED_CUES, SAMPLE_RATE,
                         TARGET_LOUDNESS_DB, Audio, Mixer, Sounds, cock_sound,
                         flesh_sound, groan_sound, hit_sound, hurt_sound,
                         loudness_db, miss_sound, round_over_sound, shot_sound,
                         soft_knee)


@pytest.fixture
def rng():
    return np.random.default_rng(0)


@pytest.fixture(scope="module")
def sound_set():
    with Audio(enabled=False) as audio:
        yield Sounds(audio, rings=5)


def dominant_hz(wave: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(wave.astype(np.float64)))
    return float(np.fft.rfftfreq(len(wave), 1 / SAMPLE_RATE)[np.argmax(spectrum)])


def centroid_hz(wave: np.ndarray) -> float:
    spectrum = np.abs(np.fft.rfft(wave.astype(np.float64))) ** 2
    freqs = np.fft.rfftfreq(len(wave), 1 / SAMPLE_RATE)
    return float(np.sum(freqs * spectrum) / np.sum(spectrum))


def test_every_sound_is_finite_audible_and_within_range(rng):
    waves = [shot_sound(rng), miss_sound(rng), cock_sound(rng), round_over_sound(),
             groan_sound(rng), flesh_sound(rng, True), flesh_sound(rng, False),
             hurt_sound(rng), *(hit_sound(ring, 5) for ring in range(5)),
             *(build(rng) for build in NAMED_BUILDERS.values())]
    for wave in waves:
        assert wave.dtype == np.float32 and len(wave) > 0
        assert np.all(np.isfinite(wave))
        assert 0.05 < float(np.max(np.abs(wave))) < 1.0


def test_the_bullseye_rings_higher_than_the_outer_rings():
    """You can hear how well you shot without reading the score."""
    pitches = [dominant_hz(hit_sound(ring, 5)) for ring in range(5)]
    assert pitches == sorted(pitches, reverse=True)
    assert pitches[0] > pitches[-1] * 1.5


def test_sounds_start_at_silence_so_they_do_not_click(rng):
    for wave in (shot_sound(rng), miss_sound(rng), hit_sound(0, 5),
                 *(build(rng) for build in NAMED_BUILDERS.values())):
        assert abs(float(wave[0])) < 0.05
        assert abs(float(wave[-1])) < 0.05


def test_the_miss_is_duller_than_the_shot(rng):
    assert centroid_hz(miss_sound(rng)) < centroid_hz(shot_sound(rng)) / 2


def test_pitch_and_velocity_make_different_takes(rng):
    straight = shot_sound(np.random.default_rng(1))
    sharp = shot_sound(np.random.default_rng(1), pitch=1.06)
    loud = shot_sound(np.random.default_rng(1), velocity=2.0)
    assert centroid_hz(sharp) > centroid_hz(straight)
    assert loudness_db(loud) > loudness_db(straight) + 1.0


# --- loudness and limiting -----------------------------------------------------

def test_loudness_gates_out_silence_and_ignores_a_quiet_tail():
    tone = 0.1 * np.sin(2 * np.pi * 440 * np.arange(SAMPLE_RATE) / SAMPLE_RATE)
    padded = np.concatenate([np.zeros(SAMPLE_RATE), tone, 0.003 * tone])
    assert loudness_db(padded) == pytest.approx(loudness_db(tone), abs=0.5)
    assert loudness_db(np.zeros(100)) == -np.inf


def test_every_sound_sits_near_the_loudness_target(sound_set):
    levels = {name: loudness_db(takes[0]) for name, takes in sound_set.catalogue().items()}
    for name, level in levels.items():
        assert abs(level - TARGET_LOUDNESS_DB) < 3.5, (name, level)
    assert max(levels.values()) - min(levels.values()) < 6.0


def test_nothing_ever_clips(sound_set):
    for name, takes in sound_set.catalogue().items():
        for take in takes:
            assert float(np.max(np.abs(take))) < 0.95, name


def test_the_soft_knee_is_linear_below_the_knee_and_never_reaches_one():
    x = np.linspace(-3, 3, 601)
    y = soft_knee(x)
    below = np.abs(x) <= LIMITER_KNEE
    assert y[below] == pytest.approx(x[below])
    assert np.all(np.abs(y) < 1.0)
    assert np.all(np.diff(y) > 0)  # monotonic: no folding, no distortion steps


# --- the sound set ---------------------------------------------------------------

def test_every_map_cue_is_registered(sound_set):
    for cues in NAMED_CUES.values():
        for cue in cues:
            assert len(sound_set.variants(cue)) >= 2, cue
    assert set(NAMED_BUILDERS) == {cue for cues in NAMED_CUES.values() for cue in cues}


def test_takes_of_one_sound_differ(sound_set):
    takes = sound_set.variants("rifle_crack")
    for other in takes[1:]:
        assert len(other) != len(takes[0]) or not np.array_equal(other, takes[0])


def test_each_named_cue_has_its_own_character(sound_set):
    """The critic cannot listen, so: no two cues may share a spectral fingerprint."""
    prints = {name: (centroid_hz(takes[0]), len(takes[0]))
              for name, takes in sound_set.catalogue().items()
              if name in NAMED_BUILDERS}
    names = list(prints)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            ca, la = prints[a]
            cb, lb = prints[b]
            assert abs(np.log(ca / cb)) > 0.05 or abs(la - lb) > SAMPLE_RATE * 0.05, (a, b)


def test_the_bolt_cycle_has_two_clicks(sound_set):
    wave = sound_set.variants("bolt_cycle")[0].astype(np.float64)
    block = SAMPLE_RATE // 100
    energy = np.array([0.0] + [np.sum(wave[i:i + block] ** 2)
                                for i in range(0, len(wave) - block, block)])
    peaks = [i for i in range(1, len(energy) - 1)
             if energy[i] > energy[i - 1] and energy[i] >= energy[i + 1]
             and energy[i] > 0.2 * energy.max()]
    assert len(peaks) >= 2 and (peaks[1] - peaks[0]) >= 10  # >= 100 ms apart


def test_the_distant_impact_arrives_late(sound_set):
    wave = sound_set.variants("distant_impact")[0]
    first_tenth = wave[: int(0.15 * SAMPLE_RATE)]
    assert float(np.max(np.abs(first_tenth))) < 0.01


def test_scope_in_rises_and_scope_out_falls(sound_set):
    def centroid_of(wave, start, end):
        return centroid_hz(wave[int(start * SAMPLE_RATE):int(end * SAMPLE_RATE)])
    scope_in = sound_set.variants("scope_in")[0]
    scope_out = sound_set.variants("scope_out")[0]
    assert centroid_of(scope_in, 0.0, 0.1) < centroid_of(scope_in, 0.2, 0.3)
    assert centroid_of(scope_out, 0.0, 0.1) > centroid_of(scope_out, 0.2, 0.3)


def test_wind_beds_have_soft_edges_so_they_loop(sound_set):
    for name in ("wind_dust", "wind_gust"):
        wave = sound_set.variants(name)[0]
        edge = int(0.05 * SAMPLE_RATE)
        middle = np.sqrt(np.mean(wave[len(wave) // 2 - edge:len(wave) // 2 + edge] ** 2))
        assert np.sqrt(np.mean(wave[:edge] ** 2)) < 0.3 * middle, name
        assert np.sqrt(np.mean(wave[-edge:] ** 2)) < 0.3 * middle, name


# --- the mixer --------------------------------------------------------------

def test_voices_are_summed():
    mixer = Mixer()
    mixer.add(np.full(8, 0.5, np.float32))
    mixer.add(np.full(8, 0.25, np.float32))
    assert mixer.render(4) == pytest.approx(np.full(4, 0.75))


def test_a_finished_voice_is_retired():
    mixer = Mixer()
    mixer.add(np.full(4, 0.5, np.float32))
    mixer.render(4)
    assert mixer.active == 0
    assert mixer.render(4) == pytest.approx(np.zeros(4))


def test_a_voice_shorter_than_the_block_is_padded_with_silence():
    mixer = Mixer()
    mixer.add(np.full(2, 0.5, np.float32))
    assert mixer.render(4) == pytest.approx([0.5, 0.5, 0.0, 0.0])


def test_the_output_is_limited_rather_than_clipped():
    mixer = Mixer()
    for _ in range(4):
        mixer.add(np.full(4, 0.9, np.float32))
    out = mixer.render(4)
    assert np.all(np.abs(out) < 1.0)
    assert np.all(out > LIMITER_KNEE)  # it is still loud: limited, not squashed flat


def test_the_limiter_keeps_the_waveform_shape():
    """A loud sine comes out rounded, not flat-topped: no hard edges, no wrap."""
    mixer = Mixer()
    for _ in range(3):
        mixer.add(np.sin(np.linspace(0, 2 * np.pi, 64)).astype(np.float32))
    out = mixer.render(64)
    assert np.all(np.abs(out) < 1.0)
    assert np.all(np.diff(out[:16]) >= 0)  # never folds back on the way to the crest
    assert np.all(np.diff(out[:10]) > 0)   # and still clearly rising well past the knee


def test_volume_scales_the_mix():
    quiet = Mixer(volume=0.25)
    quiet.add(np.full(4, 0.8, np.float32))
    assert quiet.render(4) == pytest.approx(np.full(4, 0.2))


def test_voices_are_capped_so_nothing_piles_up():
    mixer = Mixer()
    for _ in range(Mixer.MAX_VOICES * 3):
        mixer.add(np.ones(SAMPLE_RATE, np.float32))
    assert mixer.active <= Mixer.MAX_VOICES


# --- graceful silence -------------------------------------------------------

def test_muted_audio_never_raises_and_plays_nothing():
    audio = Audio(enabled=False)
    assert not audio.is_on and audio.reason == "muted"
    audio.play(np.ones(10, np.float32))  # must be a no-op, not an error
    assert audio.mixer.active == 0
    audio.close()


def test_the_sound_set_works_against_silent_audio():
    with Audio(enabled=False) as audio:
        sounds = Sounds(audio, rings=5, variants=2)
        sounds.shot()
        sounds.hit(0)
        sounds.hit(99)  # out of range must clamp, not explode
        sounds.miss()
        sounds.cock()
        sounds.round_over()
        sounds.groan()
        sounds.flesh(True)
        sounds.hurt()
        sounds.play_named("rifle_crack")
        sounds.play_named("no_such_cue")  # unknown names are silently nothing
        sounds.register("custom", np.zeros(10, np.float32))
        assert sounds.variants("custom")[0].dtype == np.float32
        sounds.play_named("custom")


def test_the_game_never_waits_for_the_full_sound_set():
    """The full set takes seconds of DSP; the game starts with an instant kit
    and the rest arrives on a worker thread. This is the startup contract."""
    import time

    Sounds._CACHE.clear()
    start = time.perf_counter()
    with Audio(enabled=False) as audio:
        sounds = Sounds(audio, rings=5, background=True)
        assert time.perf_counter() - start < 1.5, "the stub kit must be instant"
        # The first moments' sounds exist right away.
        sounds.shot()
        sounds.cock()
        sounds.hit(0)
        sounds.miss()
        sounds.play_named("bottle_break")  # not built yet: silently nothing

        deadline = time.time() + 60
        while not sounds.ready and time.time() < deadline:
            time.sleep(0.2)
        assert sounds.ready, "the full set never arrived"
        assert len(sounds._named) >= 20

    # A second session reuses the finished set instantly.
    start = time.perf_counter()
    with Audio(enabled=False) as audio:
        again = Sounds(audio, rings=5, background=True)
        assert again.ready and time.perf_counter() - start < 0.2


def test_the_game_actually_asks_for_the_background_build(monkeypatch, tmp_path,
                                                        model_path):
    """The whole asynchronous path was dead: app.py built the full set inline
    and the player waited two and a half seconds at launch for it.

    Asserted on what the session does, not on the text of the line that does
    it: grepping `_session` for the literal call broke on a reformat and passed
    on a regression that kept the string and changed the behaviour. What has to
    hold is that the session gets a *playable* kit immediately - the menus are
    interactive long before the full set of takes has finished synthesising.
    """
    import test_app

    from handy import app
    from handy.audio import Sounds

    built: list[bool] = []
    original = Sounds.__init__

    def spy(self, audio, rings, *args, **kwargs):
        built.append(bool(kwargs.get("background")))
        original(self, audio, rings, *args, **kwargs)
        if kwargs.get("background"):
            # The kit handed to the loop must already answer every call the
            # first frames make, whether or not the real takes have landed.
            assert self._shot and self._cock and self._hits and self._over

    monkeypatch.setattr(Sounds, "__init__", spy)
    test_app.headless(monkeypatch)
    app.run(app.Settings(map_key="range", mute=True, skip_calibration=True,
                         duration=60.0,
                         model_path=model_path,
                         calibration_path=tmp_path / "calibration.json"))

    assert built and built[0] is True, "the session waited for the full set"


def test_a_cue_registered_while_the_stub_is_live_survives_the_swap():
    """_build_in_background replaced _named wholesale, so a cue a map had
    registered while the stub was live went silent the moment the real set
    arrived - and it exists nowhere else."""
    import time

    Sounds._CACHE.clear()
    with Audio(enabled=False) as audio:
        sounds = Sounds(audio, rings=5, background=True)
        mine = np.linspace(0.0, 1.0, 32, dtype=np.float32)
        sounds.register("my_cue", mine)

        deadline = time.time() + 60
        while not sounds.ready and time.time() < deadline:
            time.sleep(0.2)
        assert sounds.ready

        assert "my_cue" in sounds.names()
        assert np.array_equal(sounds.variants("my_cue")[0], mine)
        assert len(sounds.variants("rifle_crack")) > 1, "and the full set is there too"
        # The set behind the process-wide cache must not have grown a stray cue.
        assert "my_cue" not in Sounds(audio, rings=5).names()


def test_the_named_cues_land_long_before_the_full_set():
    """A map launched straight from the command line raises its own cues in its
    first seconds. The background build used to synthesise the whole set -
    every variant of every sound, seconds of DSP - before a single named cue
    could play, so every map's own voice was silent for its opening. One plain
    take of each has to be live well before that."""
    import time

    Sounds._CACHE.clear()
    with Audio(enabled=False) as audio:
        sounds = Sounds(audio, rings=5, background=True)
        needed = {"rifle_crack", "suppressed_shot", "sniper_shot", "wind_gust"}

        deadline = time.time() + 60
        while not needed <= set(sounds.names()) and time.time() < deadline:
            time.sleep(0.02)
        assert needed <= set(sounds.names()), "the maps' own cues never landed"
        assert not sounds.ready, \
            "the cues arrived only with the full set - the opening is silent"

        while not sounds.ready and time.time() < deadline:
            time.sleep(0.2)
        assert sounds.ready
        # And the stand-ins are gone once the real takes land: every named cue
        # carries exactly the full set's variants, not one extra plain copy.
        assert all(len(sounds.variants(name)) == sounds._variants
                   for name in NAMED_BUILDERS), "a stand-in take outlived the swap"


# --- round 2: character and variation -------------------------------------------

def band_energy_over_time(wave: np.ndarray, low: float, high: float, block: float = 0.05):
    """RMS of a frequency band per ``block`` seconds: a crude spectrogram row."""
    size = int(block * SAMPLE_RATE)
    out = []
    for i in range(0, len(wave) - size, size):
        chunk = wave[i:i + size].astype(np.float64) * np.hanning(size)
        spectrum = np.abs(np.fft.rfft(chunk)) ** 2
        freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)
        out.append(float(np.sqrt(np.sum(spectrum[(freqs >= low) & (freqs < high)]))))
    return np.array(out)


def test_takes_differ_audibly_not_just_in_level(sound_set):
    """Pitch, decay, noise and layer balance all vary: no two takes share a
    spectral centroid or a decay profile within a hair."""
    for name in ("shot", "rifle_crack", "sniper_shot", "hull_thud", "glass_crack", "cock"):
        takes = sound_set.catalogue()[name]
        centroids = [centroid_hz(t) for t in takes]
        assert max(centroids) / min(centroids) > 1.02, (name, centroids)
        envelopes = [band_energy_over_time(t, 40, 20_000)[:6] for t in takes]
        shapes = [e / e.max() for e in envelopes]
        assert max(float(np.max(np.abs(a - b))) for a in shapes for b in shapes) > 0.05, name


def test_decay_and_balance_are_drawn_per_take(rng):
    a = shot_sound(np.random.default_rng(3), decay=0.85)
    b = shot_sound(np.random.default_rng(3), decay=1.15)
    assert not np.array_equal(a, b)


def test_the_hit_is_a_bar_not_a_sine():
    """Inharmonic partials at 2.76x and 5.4x, and a tail that keeps decaying
    exponentially (no knee: each half second loses about as many dB as the last)."""
    wave = hit_sound(0, 5, np.random.default_rng(0)).astype(np.float64)
    fundamental = dominant_hz(wave)
    spectrum = np.abs(np.fft.rfft(wave))
    freqs = np.fft.rfftfreq(len(wave), 1 / SAMPLE_RATE)

    def level_at(hz):
        band = (freqs > hz * 0.97) & (freqs < hz * 1.03)
        return float(spectrum[band].max())

    assert level_at(fundamental * 2.76) > level_at(fundamental * 2.0) * 3
    assert level_at(fundamental * 5.4) > level_at(fundamental * 4.0) * 3
    env = band_energy_over_time(wave, fundamental * 0.9, fundamental * 1.1, 0.1)
    db = 20 * np.log10(env[1:12] + 1e-9)
    slopes = np.diff(db)
    assert np.all(slopes < 0)
    assert np.std(slopes) < 0.35 * abs(np.mean(slopes)), slopes  # a straight line in dB


def test_the_cock_is_three_events_over_a_real_span(sound_set):
    wave = sound_set.catalogue()["cock"][0].astype(np.float64)
    env = band_energy_over_time(wave, 1_000, 16_000, 0.008)
    loud = env > 0.25 * env.max()
    events = int(np.sum(np.diff(loud.astype(int)) == 1) + loud[0])
    assert events >= 3, events
    last = np.max(np.nonzero(env > 0.05 * env.max())) * 0.008
    assert 0.12 <= last <= 0.25, last


def test_the_groan_has_formants_that_move(sound_set):
    """Two resonant peaks travel downwards through the moan: a mouth, not a wind."""
    wave = sound_set.catalogue()["groan"][0].astype(np.float64)
    size = int(0.1 * SAMPLE_RATE)
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)

    def peak_in(start, low, high):
        chunk = wave[int(start * SAMPLE_RATE):int(start * SAMPLE_RATE) + size] * np.hanning(size)
        spectrum = np.abs(np.fft.rfft(chunk))
        band = (freqs >= low) & (freqs < high)
        return float(freqs[band][np.argmax(spectrum[band])])

    early_f1, late_f1 = peak_in(0.08, 250, 1_000), peak_in(0.85, 250, 1_000)
    early_f2, late_f2 = peak_in(0.08, 1_000, 1_800), peak_in(0.85, 500, 1_800)
    assert early_f1 > late_f1 * 1.5, (early_f1, late_f1)
    assert early_f2 > late_f2 * 1.3, (early_f2, late_f2)
    wind = sound_set.catalogue()["wind_gust"][0]
    assert abs(np.log(centroid_hz(wave) / centroid_hz(wind))) > 0.1


def test_the_sniper_shot_has_discrete_echoes(sound_set):
    """The report comes back off the hills: the envelope rises again after the
    shot has dropped, more than once."""
    wave = sound_set.catalogue()["sniper_shot"][0]
    env = band_energy_over_time(wave, 60, 2_000, 0.04)
    db = 20 * np.log10(env / env.max() + 1e-9)
    rises = [i for i in range(2, len(db) - 1)
             if db[i] > db[i - 1] + 3 and db[i] > db[i - 2] + 3 and db[i] > -45]
    assert len(rises) >= 2, rises


def test_the_distant_impact_is_muffled(sound_set):
    wave = sound_set.catalogue()["distant_impact"][0].astype(np.float64)
    spectrum = np.abs(np.fft.rfft(wave)) ** 2
    freqs = np.fft.rfftfreq(len(wave), 1 / SAMPLE_RATE)
    above = np.sum(spectrum[freqs > 1_500]) / np.sum(spectrum)
    assert above < 0.01, above
    assert centroid_hz(wave) < 250


def test_the_bell_has_few_clean_widely_spaced_partials(sound_set):
    wave = sound_set.catalogue()["bell_toll"][0].astype(np.float64)
    size = len(wave)
    spectrum = np.abs(np.fft.rfft(wave * np.hanning(size)))
    freqs = np.fft.rfftfreq(size, 1 / SAMPLE_RATE)
    keep = (freqs > 100) & (freqs < 2_000)
    spectrum, freqs = spectrum[keep], freqs[keep]
    floor = spectrum.max() * 0.05
    peaks = [freqs[i] for i in range(1, len(spectrum) - 1)
             if spectrum[i] > floor and spectrum[i] >= spectrum[i - 1] and spectrum[i] > spectrum[i + 1]]
    clusters = []
    for hz in peaks:  # merge anything within 3 %
        if clusters and hz < clusters[-1] * 1.03:
            continue
        clusters.append(hz)
    assert 3 <= len(clusters) <= 8, clusters
    assert min(b / a for a, b in zip(clusters, clusters[1:])) > 1.2, clusters


def test_the_reverb_tail_darkens_as_it_decays():
    from handy.audio import _reverb_ir
    ir = _reverb_ir("sniper")
    early = ir[int(0.05 * SAMPLE_RATE):int(0.25 * SAMPLE_RATE)]
    late = ir[int(0.8 * SAMPLE_RATE):int(1.2 * SAMPLE_RATE)]
    assert centroid_hz(late) < centroid_hz(early) * 0.7


def test_play_time_variation_keeps_the_peak_safe():
    from handy.audio import vary
    wave = shot_sound(np.random.default_rng(0))
    seen = set()
    for _ in range(20):
        out = vary(wave, np.random.default_rng(None))
        assert float(np.max(np.abs(out))) < 0.95
        seen.add(len(out))
    assert len(seen) > 3  # re-pitched by resampling: lengths differ


# --- round 3: grit, tails, variation ---------------------------------------------

def test_the_hits_upper_partials_die_before_the_fundamental():
    """The high lines fade first: by 40 % of the way through, the 2.76x band has
    lost far more than the fundamental has."""
    wave = hit_sound(2, 5, np.random.default_rng(4)).astype(np.float64)
    f0 = dominant_hz(wave)
    low = band_energy_over_time(wave, f0 * 0.95, f0 * 1.05, 0.05)
    high = band_energy_over_time(wave, f0 * 2.6, f0 * 2.95, 0.05)
    at = len(low) * 2 // 5
    assert 20 * np.log10(high[at] / high[0]) < 20 * np.log10(low[at] / low[0]) - 6


def test_shots_fade_into_a_reverb_tail_rather_than_cutting_off(sound_set):
    """Past the body of the sound the level keeps falling gently: no block of
    silence follows a hard edge."""
    for name in ("shot", "rifle_crack", "bandit_down", "debris_hit"):
        wave = sound_set.catalogue()[name][0]
        env = band_energy_over_time(wave, 40, 20_000, 0.05)
        db = 20 * np.log10(env / env.max() + 1e-9)
        tail = db[len(db) // 2:-2]  # the last blocks are the final ease-out
        assert tail[0] < -15 and tail[-1] < tail[0] - 6, (name, tail)
        assert np.max(np.diff(tail)) < 10 and np.min(np.diff(tail)) > -18, (name, np.diff(tail))


def test_takes_differ_in_length_and_brightness(sound_set):
    for name in ("shot", "cock", "groan", "hull_thud"):
        takes = sound_set.catalogue()[name]
        centroids = [centroid_hz(t) for t in takes]
        assert max(centroids) / min(centroids) > 1.04, (name, centroids)
        lengths = [len(t) for t in takes]
        assert max(lengths) - min(lengths) > SAMPLE_RATE * 0.01 or name == "cock", name


def test_the_scope_noise_is_enveloped_with_the_tone(sound_set):
    for name in ("scope_in", "scope_out"):
        wave = sound_set.variants(name)[0]
        env = band_energy_over_time(wave, 1_500, 8_000, 0.03)
        body = env[: int(0.33 / 0.03)]
        assert body.max() / (body.min() + 1e-9) > 2.5, name  # not a flat slab
        assert abs(float(wave[0])) < 0.02 and abs(float(wave[-1])) < 0.02


def test_static_crackles_and_has_soft_edges(sound_set):
    wave = sound_set.variants("static")[0].astype(np.float64)
    env = band_energy_over_time(wave, 300, 8_000, 0.01)
    assert env[0] < 0.5 * env.max() and env[-1] < 0.5 * env.max()
    inner = env[5:-5]
    assert np.std(inner) / np.mean(inner) > 0.25  # bursts, not a flat rectangle


def test_alarm_beeps_swell_and_release(sound_set):
    wave = sound_set.variants("alarm")[0].astype(np.float64)
    env = band_energy_over_time(wave, 500, 4_000, 0.005)
    first = env[: int(0.25 / 0.005)]
    peak = int(np.argmax(first))
    assert peak >= 2  # it rises over more than one block
    assert first[0] < 0.6 * first[peak]


def test_the_reverb_tail_has_no_hard_end():
    from handy.audio import _reverb_ir
    for mood in ("orbit", "western", "sniper", "archery"):
        ir = _reverb_ir(mood).astype(np.float64)
        env = band_energy_over_time(ir, 40, 20_000, 0.05)
        db = 20 * np.log10(env / env.max() + 1e-9)
        assert db[-1] < -50, mood
        assert np.all(np.diff(db[len(db) // 4:-1]) > -15), mood


def test_gunshots_have_a_knee_not_one_straight_wedge(sound_set):
    """A room adds a separate low tail: past the crack, the top band has died
    far faster than the bottom band, so the spectrogram bends at a knee."""
    for name, at in (("shot", 11), ("rifle_crack", 11), ("sniper_shot", 6)):
        wave = sound_set.catalogue()[name][0]
        high = band_energy_over_time(wave, 3_000, 12_000, 0.05)
        low = band_energy_over_time(wave, 60, 500, 0.05)
        high_db = 20 * np.log10(high / high[0] + 1e-9)
        low_db = 20 * np.log10(low / low[0] + 1e-9)
        assert high_db[at] < low_db[at] - 6, (name, high_db[at], low_db[at])


def test_gunshots_carry_early_reflections(sound_set):
    """Within 40..130 ms of the crack the broadband level rises again at
    least once: a delayed copy coming back off a wall."""
    for name in ("shot", "rifle_crack", "sniper_shot"):
        wave = sound_set.catalogue()[name][0]
        env = band_energy_over_time(wave, 1_500, 12_000, 0.01)
        db = 20 * np.log10(env / env.max() + 1e-9)
        window = db[3:14]
        assert np.any(np.diff(window) > 1.5), (name, np.diff(window))


def test_groan_takes_differ_in_shape_not_just_level(sound_set):
    """Syllable count and vowel path are drawn per take: the envelopes of the
    takes are not scaled copies of each other."""
    takes = sound_set.catalogue()["groan"]
    lengths = sorted(len(t) for t in takes)
    assert lengths[-1] - lengths[0] > SAMPLE_RATE * 0.3
    shapes = []
    for take in takes:
        env = band_energy_over_time(take, 100, 3_000, 0.05)
        env = np.interp(np.linspace(0, len(env) - 1, 40), np.arange(len(env)), env)
        shapes.append(env / env.max())
    spread = max(float(np.max(np.abs(a - b))) for a in shapes for b in shapes)
    assert spread > 0.3, spread


def test_hull_thud_takes_have_different_modes(sound_set):
    """Each take is a different patch of hull: the ringing partials differ."""
    peaks = []
    for take in sound_set.catalogue()["hull_thud"]:
        x = take.astype(np.float64)[: SAMPLE_RATE]
        spectrum = np.abs(np.fft.rfft(x * np.hanning(len(x))))
        freqs = np.fft.rfftfreq(len(x), 1 / SAMPLE_RATE)
        band = (freqs > 120) & (freqs < 800)
        peaks.append(float(freqs[band][np.argmax(spectrum[band])]))
    assert max(peaks) / min(peaks) > 1.1, peaks


def test_mechanical_clicks_have_different_bodies(sound_set):
    """cock / bolt_cycle: the clicks are not one sample repeated - the
    brightest event and the heaviest event sit in different bands."""
    for name in ("cock", "bolt_cycle"):
        wave = sound_set.catalogue()[name][0].astype(np.float64)
        env = band_energy_over_time(wave, 300, 16_000, 0.005)
        loud = np.nonzero(env > 0.3 * env.max())[0]
        events = [loud[0]] + [b for a, b in zip(loud, loud[1:]) if b - a > 4]
        assert len(events) >= 2, (name, events)
        centroids = []
        for start in events[:3]:
            chunk = wave[start * 220:start * 220 + 660]
            centroids.append(centroid_hz(chunk))
        assert max(centroids) / min(centroids) > 1.3, (name, centroids)


def test_wind_beds_have_a_wandering_ridge(sound_set):
    """The resonant band moves: the peak frequency of the middle of the sound
    is not where it was at the start."""
    for name in ("wind_gust", "wind_dust", "static"):
        wave = sound_set.catalogue()[name][0].astype(np.float64)
        n = len(wave)
        seen = set()
        for start in np.linspace(0.15, 0.85, 8):
            chunk = wave[int(start * n):int(start * n) + 4096] * np.hanning(4096)
            spectrum = np.abs(np.fft.rfft(chunk))
            freqs = np.fft.rfftfreq(4096, 1 / SAMPLE_RATE)
            band = (freqs > 150) & (freqs < 4_000)
            seen.add(round(np.log2(freqs[band][np.argmax(spectrum[band])]), 1))
        assert len(seen) >= 3, (name, seen)


def test_round_over_is_a_motif_not_a_frozen_comb(sound_set):
    """Two notes: the dominant pitch of the second half is below the first's,
    and the upper harmonics fade faster than the fundamental."""
    wave = sound_set.catalogue()["round_over"][0].astype(np.float64)
    first = dominant_hz(wave[: int(0.35 * SAMPLE_RATE)])
    second = dominant_hz(wave[int(0.6 * SAMPLE_RATE): int(1.2 * SAMPLE_RATE)])
    assert second < first * 0.85, (first, second)
    high = band_energy_over_time(wave, 1_500, 6_000, 0.1)
    low = band_energy_over_time(wave, 150, 400, 0.1)
    assert high[9] / high[5] < low[9] / low[5]


# --- the cues the maps raise have to exist ----------------------------------

def cue_names_raised_in(module) -> set[str]:
    """Every literal name a module appends to a round's cue list.

    Read out of the source with ast rather than by playing every map into every
    corner case: a cue raised only when the pane fails at 0 integrity is exactly
    the one no test will ever reach, and exactly the one a typo hides in.
    """
    import ast
    import inspect

    names: set[str] = set()

    def literals(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.IfExp):  # cues.append("a" if x else "b")
            yield from literals(node.body)
            yield from literals(node.orelse)

    tree = ast.parse(inspect.getsource(module))
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "append"
                and isinstance(node.func.value, ast.Attribute)
                and node.func.value.attr == "cues"):
            for argument in node.args:
                names.update(literals(argument))
    return names


def test_every_cue_a_map_raises_is_a_sound_that_exists(sound_set):
    """`play_named` ignores a name it does not know, so a typo'd cue is not an
    error - it is a sound that never plays again, for as long as the map lives.

    Cross-checked here because nothing else does: the maps name their sounds
    with strings, and strings do not fail to compile.
    """
    from handy.app import CUES
    from handy.maps import orbit, sniper, western, zombies

    raised: set[str] = set()
    for module in (zombies, western, orbit, sniper):
        raised |= cue_names_raised_in(module)

    assert len(raised) >= 20, "the cue scan found almost nothing; has it drifted?"
    known = set(sound_set.names()) | set(CUES)
    assert raised <= known, f"raised but never synthesised: {sorted(raised - known)}"


def test_the_named_cues_the_app_special_cases_are_playable(sound_set):
    """`play` routes two cues through methods instead of the named catalogue.
    They are the ones a scan of NAMED_BUILDERS alone would miss."""
    from handy.app import CUES

    for name, play in CUES.items():
        play(sound_set)  # must not raise: the method still exists and matches
        assert name not in sound_set.names(), (
            f"{name} is both special-cased and named; one of the two is dead")


def test_every_map_voices_a_hit_with_the_call_it_was_wired_to(sound_set):
    """`Map.play_hit` is the map->sound wiring, and nothing else calls it.

    The range asks for the ring's ping, the road for a wet impact that cracks on
    a head shot, and the three that speak in cues ask for nothing at all. A
    signature change on either side of that hand-off used to pass CI in silence.
    """
    from handy import maps
    from handy.game import Impact

    played: list[tuple] = []

    class Spy:
        def hit(self, ring):
            played.append(("hit", ring))

        def flesh(self, headshot):
            played.append(("flesh", headshot))

    gold = Impact(x=0.0, y=0.0, score=10, at=0.0, ring=0)
    outer = Impact(x=0.0, y=0.0, score=2, at=0.0, ring=4)

    for chosen in (*maps.MAPS, maps.RANGE):
        for impact in (gold, outer):
            chosen.play_hit(Spy(), impact)  # must accept exactly this call

    assert ("hit", 0) in played and ("hit", 4) in played, "the range lost its ping"
    assert ("flesh", True) in played and ("flesh", False) in played, (
        "the road no longer tells a head shot from a body shot")
    # And the calls the real mixer is asked to make are calls it actually has.
    maps.RANGE.play_hit(sound_set, gold)
    maps.ZOMBIES.play_hit(sound_set, gold)
