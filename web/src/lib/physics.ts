// Display-side physics (PRD §7). Mirrors api/argus/physics.py; the server is the source of truth.

export const PIXEL_ARCSEC = 6.15;
export const MJD_UNIX_EPOCH = 40587;
export const R_DRA_PERIOD_D = 246.12;
export const R_DRA_EPOCH_JD = 2457370;

const SEXA = /^\s*([+-]?)(\d{1,3})(?:[h:d°\s]+)(\d{1,2})(?:[m:'′\s]+)(\d{1,2}(?:\.\d*)?)\s*[s"″]?\s*$/i;

function sexa(text: string): [number, number] | null {
  const m = SEXA.exec(text);
  if (!m) return null;
  const b = Number(m[3]);
  const c = Number(m[4]);
  if (b >= 60 || c >= 60) return null;
  return [m[1] === "-" ? -1 : 1, Number(m[2]) + b / 60 + c / 3600];
}

export function parseRa(text: string): number | null {
  const s = text.trim();
  let ra = /^[+-]?\d+(\.\d*)?$/.test(s) ? Number(s) : NaN;
  if (Number.isNaN(ra)) {
    const v = sexa(s);
    if (!v || v[0] < 0) return null;
    ra = 15 * v[1];
  }
  return ra >= 0 && ra < 360 ? ra : null;
}

export function parseDec(text: string): number | null {
  const s = text.trim();
  let dec = /^[+-]?\d+(\.\d*)?$/.test(s) ? Number(s) : NaN;
  if (Number.isNaN(dec)) {
    const v = sexa(s);
    if (!v) return null;
    dec = v[0] * v[1];
  }
  return dec >= -90 && dec <= 90 ? dec : null;
}

export function parseCoords(text: string): { ra: number; dec: number } | null {
  const parts = text.trim().replace(/,/g, " ").split(/\s+/);
  let ra: number | null = null;
  let dec: number | null = null;
  if (parts.length === 2) {
    ra = parseRa(parts[0]);
    dec = parseDec(parts[1]);
  } else if (parts.length === 6) {
    ra = parseRa(parts.slice(0, 3).join(" "));
    dec = parseDec(parts.slice(3).join(" "));
  }
  return ra === null || dec === null ? null : { ra, dec };
}

export function formatRa(ra: number): string {
  const h = ra / 15;
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  const ss = ((h - hh) * 60 - mm) * 60;
  return `${String(hh).padStart(2, "0")}h${String(mm).padStart(2, "0")}m${ss.toFixed(2).padStart(5, "0")}s`;
}

export function formatDec(dec: number): string {
  const sign = dec < 0 ? "−" : "+";
  const a = Math.abs(dec);
  const dd = Math.floor(a);
  const mm = Math.floor((a - dd) * 60);
  const ss = ((a - dd) * 60 - mm) * 60;
  return `${sign}${String(dd).padStart(2, "0")}°${String(mm).padStart(2, "0")}′${ss.toFixed(1).padStart(4, "0")}″`;
}

export function mjdToDate(mjd: number): Date {
  return new Date((mjd - MJD_UNIX_EPOCH) * 86400000);
}

export function mjdToYear(mjd: number): number {
  const d = mjdToDate(mjd);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (d.getTime() - start) / (Date.UTC(y + 1, 0, 1) - start);
}

/** Linear proper motion; pmra includes cos δ, mas/yr (PRD §7.7). */
export function propagate(ra: number, dec: number, pmra: number, pmdec: number, dtYears: number): [number, number] {
  const newDec = dec + (pmdec * dtYears) / 3.6e6;
  const cosd = Math.cos((((dec + newDec) / 2) * Math.PI) / 180);
  const newRa = (ra + (pmra * dtYears) / 3.6e6 / Math.max(cosd, 1e-9) + 360) % 360;
  return [newRa, newDec];
}

export function miraPhase(mjd: number): number {
  const jd = mjd + 2400000.5;
  const p = ((jd - R_DRA_EPOCH_JD) / R_DRA_PERIOD_D) % 1;
  return p < 0 ? p + 1 : p;
}

export interface GridWcs {
  crval: [number, number];
  crpix: [number, number];
  cdelt: [number, number];
  n: number;
}

const D2R = Math.PI / 180;

/** Gnomonic (TAN) sky → 0-based pixel on the common grid, FITS convention (row 0 = south). */
export function worldToPixel(w: GridWcs, ra: number, dec: number): [number, number] {
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const a = ra * D2R;
  const d = dec * D2R;
  const cosc = Math.sin(d0) * Math.sin(d) + Math.cos(d0) * Math.cos(d) * Math.cos(a - a0);
  const xi = (Math.cos(d) * Math.sin(a - a0)) / cosc / D2R;
  const eta = (Math.cos(d0) * Math.sin(d) - Math.sin(d0) * Math.cos(d) * Math.cos(a - a0)) / cosc / D2R;
  return [w.crpix[0] - 1 + xi / w.cdelt[0], w.crpix[1] - 1 + eta / w.cdelt[1]];
}

export function pixelToWorld(w: GridWcs, x: number, y: number): [number, number] {
  const xi = (x - (w.crpix[0] - 1)) * w.cdelt[0] * D2R;
  const eta = (y - (w.crpix[1] - 1)) * w.cdelt[1] * D2R;
  const a0 = w.crval[0] * D2R;
  const d0 = w.crval[1] * D2R;
  const rho = Math.hypot(xi, eta);
  const c = Math.atan(rho);
  if (rho === 0) return [w.crval[0], w.crval[1]];
  const dec = Math.asin(Math.cos(c) * Math.sin(d0) + (eta * Math.sin(c) * Math.cos(d0)) / rho);
  const ra = a0 + Math.atan2(xi * Math.sin(c), rho * Math.cos(d0) * Math.cos(c) - eta * Math.sin(d0) * Math.sin(c));
  return [((ra / D2R) % 360 + 360) % 360, dec / D2R];
}
