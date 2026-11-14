// Observation report as a PDF (Share → Download). Loaded on demand; built entirely in the browser.
// Look: the team's document style (dark A4, Space Grotesk + Space Mono, hairlines, cyan lead accent),
// with the Argus logo. Images stay small; the first page carries the stacked image.
import { jsPDF } from "jspdf";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LightCurve } from "../components/LightCurve";
import { Spectrum } from "../components/Spectrum";
import type { Epoch, FrameMeta, PhotPoint } from "./api";
import { formatDec, formatRa, PIXEL_ARCSEC } from "./physics";
import { download, renderOnce, slug, toCanvas } from "./renderFrames";
import type { StretchKind } from "../workers/frameDecoder.worker";

export interface ReportInput {
  worker: Worker;
  name: string; // target name, or "" for a typed position
  notes: string;
  ra: number;
  dec: number;
  size: number; // arcmin
  band: string; // "all" or D1..D6
  stretch: StretchKind;
  soft: number;
  frames: FrameMeta[]; // current band, time order, all decoded
  epochs: Epoch[];
  photometry: PhotPoint[];
  collections: string[];
  url: string;
  onProgress?: (msg: string) => void;
}

// Team document palette (Paper over Void).
const VOID = "#000000";
const PAPER = "#FFFFFF";
const MUT = "#B3B3B3";
const DIM = "#8C8C8C";
const FAINT = "#666666";
const RULE = "#292929";
const CYAN = "#22B8D8";
const MAGENTA = "#E04CF0";
const AMBER = "#F2B33D";
const DET: Record<string, string> = { D1: "#8fa8ff", D2: "#5fd0e6", D3: "#4fdc9a", D4: "#d9d94a", D5: "#f0a23b", D6: "#ef6b6b" };

const PW = 210;
const PH = 297;
const MX = 14; // side margin, mm
const TOP = 30; // content starts below the header
const BOTTOM = 280; // content ends above the footer

/** The fonts lack Greek; spell ε out (ε Indi B). */
const txt = (s: string) => s.replace(/ε\s*/g, "Epsilon ");

async function b64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** One of our SVG charts as a PNG, with the dashboard's CSS variables resolved for a dark page. */
async function chartPng(el: React.ReactElement, w: number, h: number): Promise<string | null> {
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(el), "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) return null;
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  const style = doc.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = `svg{--d1:${DET.D1};--d2:${DET.D2};--d3:${DET.D3};--d4:${DET.D4};--d5:${DET.D5};--d6:${DET.D6};
    --fg-3:${DIM};--cyan:${CYAN};--amber:${AMBER}}
    text{font-family:"Space Mono",ui-monospace,monospace;font-size:12px;fill:${DIM}}
    text.axis-title{font-family:"Space Grotesk",system-ui,sans-serif;font-size:14px;fill:${MUT}}
    .axis{stroke:${FAINT}} .grid{stroke:${RULE}}`;
  svg.insertBefore(style, svg.firstChild);
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = w * 2;
    c.height = h * 2;
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function buildReport(p: ReportInput): Promise<void> {
  const say = p.onProgress ?? (() => undefined);
  say("Loading fonts");
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const [gR, gM, mono, logo] = await Promise.all([
    b64("/report/SpaceGrotesk-Regular.ttf"), b64("/report/SpaceGrotesk-Medium.ttf"), b64("/report/SpaceMono-Regular.ttf"),
    loadImage("/report/argus-logo-white.png"),
  ]);
  doc.addFileToVFS("SG-R.ttf", gR);
  doc.addFont("SG-R.ttf", "Grotesk", "normal");
  doc.addFileToVFS("SG-M.ttf", gM);
  doc.addFont("SG-M.ttf", "Grotesk", "bold");
  doc.addFileToVFS("SM-R.ttf", mono);
  doc.addFont("SM-R.ttf", "Mono", "normal");

  say("Rendering images");
  const keys = p.frames.map((f) => f.key);
  const first = p.frames[0];
  const [stack] = await renderOnce(p.worker, keys, "stack", p.stretch, p.soft, null);
  const blink = new Map((await renderOnce(p.worker, keys, "blink", p.stretch, p.soft, null)).map((r) => [r.key, r]));
  const diff = new Map((await renderOnce(p.worker, keys, "diff", p.stretch, p.soft, first.key)).map((r) => [r.key, r]));
  const png = (c: HTMLCanvasElement) => c.toDataURL("image/png");

  const generated = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  const title = txt(p.name || `RA ${p.ra.toFixed(4)}°, Dec ${p.dec >= 0 ? "+" : ""}${p.dec.toFixed(4)}°`);
  const bandText = p.band === "all" ? "all detectors (D1–D6)" : `detector ${p.band}`;
  const lam = (f: FrameMeta) => `${f.lambda_range[0].toFixed(2)}–${f.lambda_range[1].toFixed(2)} µm`;
  const exposures = p.frames.reduce((a, f) => a + f.n_exp, 0);
  const anySat = p.frames.some((f) => f.flags.saturated);
  const npx = Math.round((p.size * 60) / PIXEL_ARCSEC);

  // ---- page furniture --------------------------------------------------------------------------
  const blank = () => {
    doc.setFillColor(VOID);
    doc.rect(0, 0, PW, PH, "F");
    const lh = 5.5;
    doc.addImage(logo, "PNG", MX, 11, (lh * logo.naturalWidth) / logo.naturalHeight, lh);
    doc.setFont("Mono", "normal");
    doc.setFontSize(7);
    doc.setTextColor(DIM);
    doc.text(`Observation report · ${generated}`, PW - MX, 15, { align: "right" });
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.2);
    doc.line(MX, 21, PW - MX, 21);
  };
  const section = (n: string, name: string, y: number) => {
    doc.setFont("Mono", "normal");
    doc.setFontSize(8);
    doc.setTextColor(CYAN);
    doc.text(n, MX, y);
    doc.setFont("Grotesk", "bold");
    doc.setFontSize(13);
    doc.setTextColor(PAPER);
    doc.text(name, MX + 9, y);
  };
  const para = (s: string, x: number, y: number, w: number, size = 9, color = MUT): number => {
    doc.setFont("Grotesk", "normal");
    doc.setFontSize(size);
    doc.setTextColor(color);
    const lines = doc.splitTextToSize(txt(s), w) as string[];
    doc.text(lines, x, y, { lineHeightFactor: 1.4 });
    return y + lines.length * size * 0.3528 * 1.4;
  };

  // ---- 1. Overview: the stacked image -----------------------------------------------------------
  blank();
  section("01", "Overview", TOP + 4);
  doc.setFont("Grotesk", "bold");
  doc.setFontSize(24);
  doc.setTextColor(PAPER);
  doc.text(title, MX, TOP + 18);
  let y = para(p.notes || "A patch of sky chosen in Argus.", MX, TOP + 26, 120, 9.5);

  const imgY = Math.max(y + 4, TOP + 38);
  const imgW = 118;
  doc.addImage(png(toCanvas(stack, Math.max(1, Math.ceil(900 / stack.w)))), "PNG", MX, imgY, imgW, imgW, undefined, "FAST");
  doc.setDrawColor(RULE);
  doc.rect(MX, imgY, imgW, imgW, "S");
  doc.setFont("Mono", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(DIM);
  doc.text(`All ${p.frames.length} visits stacked · ${bandText} · ${p.stretch} stretch · north up, east left · ${p.size}′ field`,
           MX, imgY + imgW + 4);

  // Facts column.
  const fx = MX + imgW + 8;
  const fw = PW - MX - fx;
  const facts: [string, string][] = [
    ["Position (J2000)", `${formatRa(p.ra)}\n${formatDec(p.dec)}`],
    ["Degrees", `${p.ra.toFixed(5)}°, ${p.dec >= 0 ? "+" : ""}${p.dec.toFixed(5)}°`],
    ["Field", `${p.size}′ × ${p.size}′ (${npx} px of ${PIXEL_ARCSEC}″)`],
    ["Visits", `${p.frames.length}: ${first.epoch_label} to ${p.frames[p.frames.length - 1].epoch_label}`],
    ["Exposures", String(exposures)],
    ["Band", `${bandText}\n${lam(first)}`],
    ["Data", p.collections.map((c) => c.replace("spherex_", "SPHEREx ").toUpperCase().replace("SPHEREX", "SPHEREx")).join(" + ") + "\nNASA/IPAC IRSA"],
    ["Saturation", anySat ? "Yes: the centre is too bright in some exposures; its brightness is a lower limit." : "None at the centre"],
  ];
  let fy = imgY + 2;
  for (const [k, v] of facts) {
    doc.setFont("Mono", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(DIM);
    doc.text(k, fx, fy);
    doc.setFont("Grotesk", "normal");
    doc.setFontSize(9);
    doc.setTextColor(k === "Saturation" && anySat ? AMBER : PAPER);
    const lines = doc.splitTextToSize(txt(v), fw) as string[];
    doc.text(lines, fx, fy + 4.2, { lineHeightFactor: 1.3 });
    fy += 4.2 + lines.length * 4.2 + 3.5;
    doc.setDrawColor(RULE);
    doc.line(fx, fy - 2.2, PW - MX, fy - 2.2);
  }

  y = imgY + imgW + 12;
  y = para("How to read it: every SPHEREx visit (about every six months) is aligned on the same sky grid. "
         + "Things that move between visits shift position; things that change brightness brighten or fade. "
         + "Section 02 shows each visit and what changed since the first; section 03 measures the source at the centre.",
           MX, y, PW - 2 * MX, 9);
  doc.setFont("Mono", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(CYAN);
  doc.textWithLink("Open this exact view in Argus", MX, y + 4, { url: p.url });
  doc.setTextColor(DIM);
  doc.text(doc.splitTextToSize(p.url, PW - 2 * MX) as string[], MX, y + 8.5);

  // ---- 2. Visits as a vertical timeline --------------------------------------------------------
  say("Laying out the visits");
  const ROW = 37; // six visits per page (SPHEREx sees most fields six times a year or less)
  const thumb = 30;
  const railX = MX + 4;
  const rowsTop = TOP + 14;
  const perPage = Math.floor((BOTTOM - rowsTop) / ROW);
  p.frames.forEach((f, i) => {
    if (i % perPage === 0) {
      doc.addPage();
      blank();
      section("02", i === 0 ? "Visits" : "Visits (continued)", TOP + 4);
      if (i === 0) {
        doc.setFont("Grotesk", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(MUT);
        doc.text(`Left: the visit. Right: change since ${first.epoch_label} (cyan brighter now, magenta brighter before).`, MX + 9, TOP + 9);
      }
    }
    const y0 = rowsTop + (i % perPage) * ROW;
    const last = i === p.frames.length - 1 || (i + 1) % perPage === 0;
    doc.setDrawColor(RULE);
    doc.setLineWidth(0.4);
    if (!last) doc.line(railX, y0 + 4, railX, y0 + ROW + 4);
    doc.setFillColor(i === 0 ? MAGENTA : CYAN);
    doc.circle(railX, y0 + 4, 1.4, "F");
    doc.setLineWidth(0.2);

    const tx = MX + 12;
    doc.setFont("Grotesk", "bold");
    doc.setFontSize(12);
    doc.setTextColor(PAPER);
    doc.text(f.epoch_label, tx, y0 + 5.5);
    const ep = p.epochs.find((e) => e.id === f.epoch);
    const span = ep ? `${new Date((ep.t_start - 40587) * 86400e3).toISOString().slice(0, 10)} to ${new Date((ep.t_end - 40587) * 86400e3).toISOString().slice(0, 10)}` : "";
    const lines = [
      span,
      `${f.n_exp} exposure${f.n_exp === 1 ? "" : "s"} · ${lam(f)}`,
      `mean MJD ${f.t_mid.toFixed(2)}`,
      f.flags.saturated ? `saturated in ${f.flags.n_saturated} exposure${f.flags.n_saturated === 1 ? "" : "s"}` : "",
    ].filter(Boolean);
    doc.setFont("Mono", "normal");
    doc.setFontSize(7);
    doc.setTextColor(DIM);
    doc.text(lines, tx, y0 + 11, { lineHeightFactor: 1.5 });

    const ix = PW - MX - 2 * thumb - 4;
    const b = blink.get(f.key);
    const d = diff.get(f.key);
    if (b) doc.addImage(png(toCanvas(b, Math.max(1, Math.ceil(300 / b.w)))), "PNG", ix, y0, thumb, thumb, undefined, "FAST");
    if (d) doc.addImage(png(toCanvas(d, Math.max(1, Math.ceil(300 / d.w)))), "PNG", ix + thumb + 4, y0, thumb, thumb, undefined, "FAST");
    doc.setDrawColor(RULE);
    doc.rect(ix, y0, thumb, thumb, "S");
    doc.rect(ix + thumb + 4, y0, thumb, thumb, "S");
    doc.setFontSize(6);
    doc.text("visit", ix, y0 + thumb + 3);
    doc.text(i === 0 ? "reference" : `change since ${first.epoch_label}`, ix + thumb + 4, y0 + thumb + 3);
  });

  // ---- 3. Brightness: light curve and spectrum ---------------------------------------------------
  say("Drawing the plots");
  doc.addPage();
  blank();
  section("03", "Brightness of the centre source", TOP + 4);
  const CW = 700;
  const CH = 300;
  const chartMM = PW - 2 * MX;
  const chartH = (chartMM * CH) / CW;
  const lcPng = await chartPng(createElement(LightCurve, { points: p.photometry, band: p.band, mira: false, width: CW, height: CH }), CW, CH);
  y = TOP + 12;
  doc.setFont("Grotesk", "bold");
  doc.setFontSize(10);
  doc.setTextColor(PAPER);
  doc.text("Light curve", MX, y);
  y = para("Brightness on every exposure over time (log scale). Colours are detectors; hollow circles were saturated "
         + "(lower limits). A steady star gives a flat band; a variable rises and falls.", MX, y + 5, chartMM, 8.5);
  if (lcPng) {
    doc.addImage(lcPng, "PNG", MX, y, chartMM, chartH, undefined, "FAST");
    y += chartH + 2;
    doc.setFont("Mono", "normal");
    doc.setFontSize(6.5);
    let kx = MX + 18;
    for (const [d, c] of Object.entries(DET)) {
      doc.setFillColor(c);
      doc.rect(kx, y - 1.6, 1.8, 1.8, "F");
      doc.setTextColor(MUT);
      doc.text(d, kx + 2.8, y);
      kx += 12;
    }
    y += 6;
  } else {
    y = para("No brightness measurements for this band.", MX, y + 2, chartMM, 8.5, DIM) + 4;
  }

  const withData = p.epochs.filter((e) => p.photometry.some((pt) => pt.epoch === e.id && pt.flux_ujy > 0));
  const best = [...withData].sort((a, b2) => p.photometry.filter((pt) => pt.epoch === b2.id).length
                                           - p.photometry.filter((pt) => pt.epoch === a.id).length)[0];
  doc.setFont("Grotesk", "bold");
  doc.setFontSize(10);
  doc.setTextColor(PAPER);
  doc.text(`Spectrum${best ? ` (${best.label})` : ""}`, MX, y + 4);
  y = para("Brightness against wavelength from one visit (log scales). SPHEREx's filters vary across the detector, so one visit "
         + "samples 0.75–5 µm. Grey: single exposures. Cyan: weighted mean in narrow bins.", MX, y + 9, chartMM, 8.5);
  const spPng = best ? await chartPng(createElement(Spectrum, { points: p.photometry, epochs: p.epochs, initialEpoch: best.id, width: CW, height: CH }), CW, CH) : null;
  if (spPng) doc.addImage(spPng, "PNG", MX, y, chartMM, chartH, undefined, "FAST");
  else para("No spectrum: no measurements for this field yet.", MX, y + 2, chartMM, 8.5, DIM);

  // ---- 4. Data and method ------------------------------------------------------------------------
  doc.addPage();
  blank();
  section("04", "Data and method", TOP + 4);
  y = TOP + 14;
  const block = (head: string, body: string) => {
    doc.setFont("Grotesk", "bold");
    doc.setFontSize(10);
    doc.setTextColor(PAPER);
    doc.text(head, MX, y);
    y = para(body, MX, y + 5, PW - 2 * MX, 9) + 5;
  };
  block("Images", "For each exposure Argus reads the calibrated SPHEREx image from the NASA/IPAC archive, subtracts the "
    + "zodiacal-light model, masks pixels flagged as bad, and reprojects it onto one common grid "
    + `(${PIXEL_ARCSEC}″ pixels, north up). Exposures within 20 days are one visit and are averaged with inverse-variance `
    + "weights. Change images subtract the reference visit after removing each frame's sky level.");
  block("Brightness", "Aperture photometry of the source at the centre on every exposure, re-centred within 3 pixels, "
    + "in microjansky. Saturated exposures are marked and give lower limits. Each exposure has its own wavelength, which "
    + "is how one visit yields a spectrum.");
  block("Limits", "SPHEREx pixels are 6.15″, so only fast movers (nearby stars, brown dwarfs, Solar System objects) "
    + "shift visibly over a year. Bright stars saturate. These are quick-look products for exploration, not "
    + "publication-grade measurements.");
  block("Credits", "SPHEREx data from the NASA/IPAC Infrared Science Archive (IRSA): DR1 doi:10.26131/IRSA678, "
    + "QR3 doi:10.26131/IRSA662. Gaia DR3 (ESA/Gaia/DPAC). Made with Argus by Team 102 Bands for the 2026 NASA "
    + "International Space Apps Challenge. Argus is not affiliated with or endorsed by NASA.");

  // Footer with page numbers on every page.
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setDrawColor(RULE);
    doc.line(MX, 286, PW - MX, 286);
    doc.setFont("Mono", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(FAINT);
    doc.text("Argus · argus102.space · Team 102 Bands · lead Umair Zia", MX, 290.5);
    doc.text(`${i} / ${n}`, PW - MX, 290.5, { align: "right" });
  }

  say("Saving");
  download(doc.output("blob"), `argus-report-${slug(p.name || `${p.ra.toFixed(3)}_${p.dec.toFixed(3)}`)}.pdf`);
}
