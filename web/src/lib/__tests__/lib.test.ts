import { describe, expect, it } from "vitest";
import { parseCoords, propagate, worldToPixel, pixelToWorld, miraPhase, R_DRA_EPOCH_JD, earthHelio, planetXShift } from "../physics";
import { centroid } from "../validate";
import { readState, writeState, DEFAULTS } from "../urlState";
import { halfToFloat } from "../frame";

describe("physics", () => {
  it("parses WISE 0855 sexagesimal like the server", () => {
    const c = parseCoords("08h55m10.831s -07d14m42.53s")!;
    expect(c.ra).toBeCloseTo(133.79513, 5);
    expect(c.dec).toBeCloseTo(-7.24515, 5);
    expect(parseCoords("08:55:10.831 -07:14:42.53")!.ra).toBeCloseTo(c.ra, 8);
  });
  it("rejects out-of-range input", () => {
    for (const s of ["360 0", "10 91", "-1 0", "abc def", "1 2 3"]) expect(parseCoords(s)).toBeNull();
  });
  it("moves Barnard's Star north", () => {
    const [, dec] = propagate(269.448503, 4.73942, -801.55, 10362.39, 10);
    expect((dec - 4.73942) * 3600).toBeCloseTo(103.6, 1);
  });
  it("TAN round trip and centre", () => {
    const w = { crval: [10, 20] as [number, number], crpix: [15, 15] as [number, number], cdelt: [-6.15 / 3600, 6.15 / 3600] as [number, number], n: 29 };
    const [x, y] = worldToPixel(w, 10, 20);
    expect(x).toBeCloseTo(14);
    expect(y).toBeCloseTo(14);
    const [ra, dec] = pixelToWorld(w, 3, 25);
    const [x2, y2] = worldToPixel(w, ra, dec);
    expect(x2).toBeCloseTo(3, 6);
    expect(y2).toBeCloseTo(25, 6);
    // East is left: larger RA → smaller x.
    expect(worldToPixel(w, 10.01, 20)[0]).toBeLessThan(14);
  });
  it("Mira phase is zero at the ephemeris epoch", () => {
    expect(miraPhase(R_DRA_EPOCH_JD - 2400000.5)).toBeCloseTo(0);
  });
});

describe("urlState", () => {
  it("round-trips WiseView-style params and clamps", () => {
    const s = readState("?ra=133.7951&dec=-7.2452&size=3&band=D6&speed=40&mode=diff&gaia=1&bogus=1");
    expect(s.band).toBe("D6");
    expect(s.speed).toBe(50);
    expect(s.gaia).toBe(true);
    expect(readState(writeState(s))).toEqual(s);
  });
  it("drops defaults and ignores bad enums", () => {
    expect(writeState(DEFAULTS)).toBe("");
    expect(readState("?band=D9&stretch=evil").band).toBe("all");
  });
});

describe("float16", () => {
  it("decodes known values", () => {
    expect(halfToFloat(0x3c00)).toBe(1);
    expect(halfToFloat(0xc000)).toBe(-2);
    expect(Number.isNaN(halfToFloat(0x7e00))).toBe(true);
    expect(halfToFloat(0x0001)).toBeCloseTo(5.96e-8, 9);
  });
});

describe("planet X parallax", () => {
  it("puts Earth about 0.983 AU from the Sun in early January, at ecliptic longitude ~100°", () => {
    const [x, y, z] = earthHelio(51544.5); // 2000-01-01.5
    expect(Math.hypot(x, y, z)).toBeCloseTo(0.983, 2);
    // Sun at λ≈280°, so Earth at λ≈100° (equatorial x<0, y>0).
    expect(x).toBeLessThan(0);
    expect(y).toBeGreaterThan(0);
  });

  it("jumps ~2 AU / d at the north ecliptic pole over half a year", () => {
    const [de, dn] = planetXShift(270, 66.5607, 61000, 61182.6, 500);
    const expected = (2 / 500) * 206265; // ≈ 825″
    expect(Math.hypot(de, dn)).toBeGreaterThan(expected * 0.97);
    expect(Math.hypot(de, dn)).toBeLessThan(expected * 1.03);
  });

  it("scales as 1/distance", () => {
    const a = Math.hypot(...planetXShift(100, 20, 61000, 61180, 300));
    const b = Math.hypot(...planetXShift(100, 20, 61000, 61180, 900));
    expect(a / b).toBeCloseTo(3, 1);
  });
});

describe("centroid", () => {
  it("recovers a sub-pixel position from a Gaussian star", () => {
    const n = 31;
    const px = new Float32Array(n * n);
    const cx = 15.3;
    const cy = 14.6;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) px[y * n + x] = 10 + 500 * Math.exp(-((x - cx) ** 2 + (y - cy) ** 2) / (2 * 1.2 ** 2));
    const c = centroid(px, n, 15, 15, 4, 10, 1)!;
    expect(Math.abs(c.x - cx)).toBeLessThan(0.05);
    expect(Math.abs(c.y - cy)).toBeLessThan(0.05);
    expect(c.snr).toBeGreaterThan(100);
  });
});
