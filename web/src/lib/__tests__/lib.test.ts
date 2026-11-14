import { describe, expect, it } from "vitest";
import { parseCoords, propagate, worldToPixel, pixelToWorld, miraPhase, R_DRA_EPOCH_JD } from "../physics";
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
