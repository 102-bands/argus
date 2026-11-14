"""Data-path spike (PRD §5.4): S3 partial reads vs IRSA cutouts, timed on Barnard's Star."""
import csv
import io
import json
import sys
import time

import httpx
from astropy.io import fits
from astropy.wcs import WCS

RA, DEC = 269.452, 4.693  # Barnard's Star, ~2025
SIA = "https://irsa.ipac.caltech.edu/SIA"


def sia_rows():
    t = time.time()
    params = [("POS", f"CIRCLE {RA} {DEC} 0.001"), ("COLLECTION", "spherex_dr1"),
              ("COLLECTION", "spherex_qr3"), ("RESPONSEFORMAT", "CSV")]
    r = httpx.get(SIA, params=params, timeout=120)
    r.raise_for_status()
    rows = list(csv.DictReader(io.StringIO(r.text)))
    print(f"SIA: {len(rows)} rows in {time.time() - t:.1f}s")
    return rows


def s3_test(row):
    # The CSV cloud_access JSON is not quoted, so derive the key from access_url instead.
    url = row["access_url"].replace("https://irsa.ipac.caltech.edu/ibe/data/spherex/", "s3://nasa-irsa-spherex/")
    print("s3 url:", url)
    t = time.time()
    with fits.open(url, use_fsspec=True, fsspec_kwargs={"anon": True}, lazy_load_hdus=True) as hdul:
        print(f"open: {time.time() - t:.1f}s; HDUs:", [h.name for h in hdul])
        w = WCS(hdul["IMAGE"].header)
        x, y = w.world_to_pixel_values(RA, DEC)
        x, y = int(x), int(y)
        print("pixel:", x, y)
        h = 15
        for name in ("IMAGE", "FLAGS", "VARIANCE", "ZODI"):
            t1 = time.time()
            sec = hdul[name].section[max(y - h, 0):y + h, max(x - h, 0):x + h]
            print(f"  {name}: {sec.shape} {sec.dtype} in {time.time() - t1:.1f}s")
        t1 = time.time()
        hw = hdul["WCS-WAVE"].header
        print(f"  WCS-WAVE header in {time.time() - t1:.1f}s")
        flags_hdr = hdul["FLAGS"].header
        print("  MSKN keys:", [k for k in flags_hdr if k.startswith("MSKN")][:6])
    print(f"S3 total: {time.time() - t:.1f}s")


def cutout_test(row):
    url = row["access_url"] + f"?center={RA},{DEC}d&size=3arcmin"
    t = time.time()
    r = httpx.get(url, timeout=120, follow_redirects=False)
    print(f"cutout: HTTP {r.status_code}, {len(r.content) / 1e6:.2f} MB in {time.time() - t:.1f}s")


if __name__ == "__main__":
    rows = sia_rows()
    print("columns:", list(rows[0].keys()))
    for k in ("t_min", "energy_bandpassname", "obs_release_date", "access_url"):
        print(f"  {k} = {rows[0][k]}")
    s3_test(rows[0])
    if "--cutout" in sys.argv:
        cutout_test(rows[0])
