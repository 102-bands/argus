"""Physics checks against known numbers (PRD §14.1)."""
import math

import numpy as np
import pytest
from astropy.io import fits

from argus import physics as p
from argus.pipeline import encode_frame, make_grid
from argus.targets import TARGETS


def test_sexagesimal_wise_0855():
    ra, dec = p.parse_coords("08h55m10.831s -07d14m42.53s")
    assert ra == pytest.approx(133.79513, abs=1e-5)
    assert dec == pytest.approx(-7.24515, abs=1e-5)
    ra2, dec2 = p.parse_coords("08:55:10.831 -07:14:42.53")
    assert (ra2, dec2) == pytest.approx((ra, dec))
    assert p.parse_coords("133.7951, -7.2452") == pytest.approx((133.7951, -7.2452))


@pytest.mark.parametrize("text", ["360 0", "10 91", "10 -91", "-1 0", "08h61m00s 00d00m00s", "hello world"])
def test_coords_rejected(text):
    with pytest.raises(p.CoordError):
        p.parse_coords(text)


def test_negative_zero_dec_sexagesimal():
    assert p.parse_dec("-00d30m00s") == pytest.approx(-0.5)


def test_barnard_proper_motion_shift():
    t = TARGETS["barnard"]
    _, _, total = p.proper_motion_offset(t.pmra, t.pmdec, 1.5)
    assert total == pytest.approx(15.6, abs=0.1)
    assert total / p.PIXEL_ARCSEC == pytest.approx(2.53, abs=0.01)


def test_propagate_moves_north():
    t = TARGETS["barnard"]
    ra, dec = p.propagate(t.cat_ra, t.cat_dec, t.pmra, t.pmdec, 10.0)
    assert (dec - t.cat_dec) * 3600 == pytest.approx(103.6, abs=0.1)
    assert ra < t.cat_ra


def test_flux_conversion_one_pixel():
    assert p.flux_ujy(np.array([1.0])) == pytest.approx(889, rel=2e-3)


def test_ab_mag_zero_point():
    assert p.ab_mag(3631e6) == pytest.approx(0.0, abs=1e-3)


def test_epoch_grouping():
    t0 = 60800.0
    times = [t0, t0 + 3, t0 + 6, t0 + 31, t0 + 211, t0 + 214]
    ids = p.group_epochs(times)
    assert ids == [0, 0, 0, 1, 2, 2]
    # Unsorted input keeps alignment.
    assert p.group_epochs([t0 + 211, t0, t0 + 3]) == [1, 0, 0]


def test_stack_sigma_root_n():
    rng = np.random.default_rng(1)
    n = 16
    imgs = rng.normal(0, 1, (n, 50, 50))
    w = np.ones_like(imgs)  # σ = 1
    mean, sigma = p.weighted_stack(imgs, w)
    assert np.allclose(sigma, 1 / math.sqrt(n))
    assert mean.std() == pytest.approx(1 / math.sqrt(n), rel=0.1)


def test_stack_masked_pixels_are_nan():
    imgs = np.ones((3, 2, 2))
    w = np.ones_like(imgs)
    w[:, 0, 0] = 0
    mean, _ = p.weighted_stack(imgs, w)
    assert np.isnan(mean[0, 0]) and mean[1, 1] == 1


def test_flag_names_from_header():
    h = fits.Header()
    h["MSKN0001"] = "OVERFLOW"
    h["MSKN0021"] = "SOURCE"
    h["OTHER"] = 1
    assert p.decode_flag_names(h) == {1: "OVERFLOW", 21: "SOURCE"}


def test_display_mask_keeps_sources_and_saturation():
    source, overflow, hot, outlier = 1 << 21, 1 << 1, 1 << 10, 1 << 19
    flags = np.array([0, overflow | source, hot | source, outlier, outlier | source])
    assert p.display_bad(flags).tolist() == [False, False, True, True, False]
    assert 21 not in p.DEFAULT_MASK_BITS


def test_mira_phase():
    mjd = p.R_DRA_EPOCH_JD - p.JD_MINUS_MJD
    assert p.mira_phase(mjd) == pytest.approx(0.0)
    assert p.mira_phase(mjd + p.R_DRA_PERIOD_D / 2) == pytest.approx(0.5)


def test_fov_pixels():
    assert p.fov_pixels(3) == 29
    assert p.fov_pixels(15) == 146


def test_grid_centre():
    w, n = make_grid(10.0, 20.0, 3)
    x, y = w.world_to_pixel_values(10.0, 20.0)
    assert (x, y) == pytest.approx(((n - 1) / 2, (n - 1) / 2))


def test_encode_frame_roundtrip():
    import json
    import struct

    px = np.arange(9, dtype=np.float32).reshape(3, 3)
    px[0, 0] = np.nan
    raw = encode_frame(px, np.zeros((3, 3), np.uint8), {"epoch": 0})
    hlen = struct.unpack("<I", raw[:4])[0]
    head = json.loads(raw[4:4 + hlen])
    assert head["w"] == 3 and (4 + hlen) % 2 == 0
    body = np.frombuffer(raw[4 + hlen:4 + hlen + 18], dtype="<f2").reshape(3, 3)
    assert np.isnan(body[0, 0]) and body[2, 2] == 8
