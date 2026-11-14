"""ESA Gaia DR3 cone search over TAP (PRD §5.2). Anonymous: 60 s, 50k rows."""
import csv
import io

import httpx

from .security import check_outbound

TAP_SYNC = "https://gea.esac.esa.int/tap-server/tap/sync"
MAX_ROWS = 2000


async def cone_sync(ra: float, dec: float, radius_arcmin: float, client: httpx.AsyncClient | None = None) -> list[dict]:
    """Gaia sources at epoch 2016.0 inside the cone, brightest first. The client moves them to each epoch."""
    adql = (
        f"SELECT TOP {MAX_ROWS} source_id, ra, dec, pmra, pmdec, parallax, phot_g_mean_mag "
        "FROM gaiadr3.gaia_source WHERE 1=CONTAINS(POINT('ICRS', ra, dec), "
        f"CIRCLE('ICRS', {ra:.7f}, {dec:.7f}, {radius_arcmin / 60.0:.7f})) "
        "ORDER BY phot_g_mean_mag ASC"
    )
    data = {"REQUEST": "doQuery", "LANG": "ADQL", "FORMAT": "csv", "QUERY": adql}
    own = client is None
    client = client or httpx.AsyncClient(follow_redirects=False)
    try:
        r = await client.post(check_outbound(TAP_SYNC), data=data, timeout=httpx.Timeout(60, connect=30))
        r.raise_for_status()
    finally:
        if own:
            await client.aclose()

    def num(v):
        return float(v) if v not in ("", None) else None

    return [{"source_id": row["source_id"], "ra": float(row["ra"]), "dec": float(row["dec"]),
             "pmra": num(row["pmra"]), "pmdec": num(row["pmdec"]), "parallax": num(row["parallax"]),
             "g": num(row["phot_g_mean_mag"])}
            for row in csv.DictReader(io.StringIO(r.text))]
