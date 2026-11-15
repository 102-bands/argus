"""The five challenge test targets (PRD §3.2, research §3).

Positions are catalogue positions moved to CENTRE_YEAR, the middle of SPHEREx coverage so far,
so the moving targets stay near the field centre in every epoch.
"""
from dataclasses import asdict, dataclass

from .physics import propagate

CENTRE_YEAR = 2026.0


@dataclass(frozen=True)
class Target:
    id: str
    name: str
    ra: float
    dec: float
    size: float
    band: str
    notes: str
    # Catalogue position and motion, for the Gaia check (PRD §7.7).
    cat_ra: float
    cat_dec: float
    cat_epoch: float
    pmra: float  # mas/yr, includes cos δ
    pmdec: float

    def public(self) -> dict:
        d = asdict(self)
        return {k: d[k] for k in ("id", "name", "ra", "dec", "size", "band", "notes", "pmra", "pmdec")}


def _t(id, name, ra, dec, epoch, pmra, pmdec, size, band, notes) -> Target:
    cra, cdec = propagate(ra, dec, pmra, pmdec, CENTRE_YEAR - epoch)
    return Target(id, name, round(cra, 6), round(cdec, 6), size, band, notes, ra, dec, epoch, pmra, pmdec)


TARGETS: dict[str, Target] = {
    t.id: t
    for t in (
        _t("barnard", "Barnard's Star", 269.448503, 4.739420, 2016.0, -801.55, 10362.39, 3, "all",
           "Fastest-moving star in the sky: about 1.8 px north between Aug 2025 and Sep 2026, matching Gaia. Bright, so saturated."),
        _t("eps-indi-b", "ε Indi B", 331.076453, -56.793812, 2016.0, 3981.98, -2466.83, 3, "all",
           "Pair of brown dwarfs about 1 px of motion. ε Indi A sits 6.7′ away; widen to 15′ to see it."),
        _t("wise-0855", "WISE 0855−0714", 133.794760, -7.245146, 2010.5, -8188.0, 680.0, 3, "D6",
           "Coldest known brown dwarf. Invisible below 3.5 µm; look in the D5/D6 stacks. Moves about 2 px west."),
        _t("rw-aur", "RW Aur", 76.956081, 30.401205, 2016.0, 2.64, -27.40, 3, "all",
           "Young variable star. No motion; watch its brightness change."),
        _t("r-dra", "R Dra", 248.167378, 66.755007, 2016.0, -20.64, 6.15, 3, "all",
           "Mira variable with a 246-day period. No motion; brightness follows the pulsation phase."),
    )
}
