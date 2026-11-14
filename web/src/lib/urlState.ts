// Explorer state lives in the URL with WiseView-style names (PRD §9.1).

export type Band = "all" | "D1" | "D2" | "D3" | "D4" | "D5" | "D6";
export type Stretch = "asinh" | "linear" | "log" | "zscale";
export type Mode = "blink" | "diff" | "stack";
/** What the centre of the dashboard shows: the blink image or the charts. */
export type Panel = "image" | "plots";

export interface ViewState {
  ra: string | null;
  dec: string | null;
  size: number;
  band: Band;
  speed: number;
  stretch: Stretch;
  mode: Mode;
  epoch: number;
  gaia: boolean;
  flags: boolean;
  view: Panel;
}

export const BANDS: Band[] = ["all", "D1", "D2", "D3", "D4", "D5", "D6"];
export const STRETCHES: Stretch[] = ["asinh", "linear", "log", "zscale"];
export const MODES: Mode[] = ["blink", "diff", "stack"];
export const PANELS: Panel[] = ["image", "plots"];

export const DEFAULTS: ViewState = {
  ra: null,
  dec: null,
  size: 8,
  band: "all",
  speed: 500,
  stretch: "asinh",
  mode: "blink",
  epoch: 0,
  gaia: false,
  flags: false,
  view: "image",
};

function pick<T extends string>(v: string | null, allowed: T[], fallback: T): T {
  return v !== null && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

function num(v: string | null, lo: number, hi: number, fallback: number): number {
  const n = v === null ? NaN : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

export function readState(search: string): ViewState {
  const p = new URLSearchParams(search);
  return {
    ra: p.get("ra"),
    dec: p.get("dec"),
    size: num(p.get("size"), 1, 15, DEFAULTS.size),
    band: pick(p.get("band"), BANDS, DEFAULTS.band),
    speed: num(p.get("speed"), 50, 5000, DEFAULTS.speed),
    stretch: pick(p.get("stretch"), STRETCHES, DEFAULTS.stretch),
    mode: pick(p.get("mode"), MODES, DEFAULTS.mode),
    epoch: Math.round(num(p.get("epoch"), 0, 99, DEFAULTS.epoch)),
    gaia: p.get("gaia") === "1",
    flags: p.get("flags") === "1",
    view: pick(p.get("view"), PANELS, DEFAULTS.view),
  };
}

export function writeState(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.ra !== null) p.set("ra", s.ra);
  if (s.dec !== null) p.set("dec", s.dec);
  (Object.keys(DEFAULTS) as (keyof ViewState)[]).forEach((k) => {
    if (k === "ra" || k === "dec") return;
    const v = s[k];
    if (v === DEFAULTS[k]) return;
    p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  });
  const q = p.toString();
  return q ? `?${q}` : "";
}
