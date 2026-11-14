// First-visit welcome and the guided tour of every part of the tool (driver.js, loaded on demand).
import { useEffect, useRef } from "react";
import { driver, type DriveStep, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { track } from "../lib/analytics";

export const WELCOMED_KEY = "argus.welcomed";

export function hasBeenWelcomed(): boolean {
  try { return localStorage.getItem(WELCOMED_KEY) === "1"; } catch { return false; }
}
function markWelcomed(): void {
  try { localStorage.setItem(WELCOMED_KEY, "1"); } catch { /* private mode: show again next time */ }
}

/** What the tour may change in the tool, so it can show diff mode and the Plots view on the right steps. */
export interface TourControls {
  setMode: (m: "blink" | "diff" | "stack") => void;
  setView: (v: "image" | "plots") => void;
  pause: () => void;
  onEnd: () => void;
}

const $ = (sel: string) => document.querySelector<HTMLElement>(`[data-tour="${sel}"]`);

/** Steps whose element isn't on screen (e.g. no preset notes on a typed position) are skipped. */
function buildSteps(c: TourControls, d: () => Driver): DriveStep[] {
  const wait = (fn: () => void, next: () => void) => { fn(); window.setTimeout(next, 350); };
  const steps: (DriveStep & { needs?: string })[] = [
    { needs: "search", element: "[data-tour='search']", popover: { title: "Find any patch of sky",
      description: "Type a position (decimal like <code>269.45 4.75</code>, or <code>17h57m48s +04d41m</code>) or a name like “Barnard”. Presets open instantly; any other spot is built live from the NASA archive in about 20 seconds." } },
    { needs: "view", element: "[data-tour='view']", popover: { title: "Image or plots",
      description: "Switch the centre between the blink image and the charts of the source in the middle (light curve and spectrum). Shortcut: <kbd>P</kbd>.", side: "right" } },
    { needs: "playback", element: "[data-tour='playback']", popover: { title: "Play the visits",
      description: "Each frame is one SPHEREx visit, roughly six months apart. Play or pause (<kbd>Space</kbd>), step one visit (<kbd>←</kbd> <kbd>→</kbd>), and set the speed with the slider (<kbd>+</kbd> <kbd>−</kbd>).", side: "right" } },
    { needs: "mode", element: "[data-tour='mode']", popover: { title: "Three ways to look",
      description: "<b>Blink</b> flips between visits: movers jump, variables pulse. <b>Diff</b> subtracts a reference visit: cyan is brighter now, magenta brighter before, so a moving star becomes a magenta→cyan pair. <b>Stack</b> adds every visit for the deepest image. We've switched to diff for you. Shortcut: <kbd>D</kbd>.", side: "right" },
      onHighlightStarted: () => c.setMode("diff") },
    { needs: "band", element: "[data-tour='band']", popover: { title: "Choose the colour",
      description: "SPHEREx has six detectors, from D1 (0.75 µm) to D6 (5 µm); “all” combines them. Cold objects only show at long wavelengths: the brown dwarf WISE 0855 is invisible below D5. Keys <kbd>0</kbd>–<kbd>6</kbd>.", side: "right" } },
    { needs: "brightness", element: "[data-tour='brightness']", popover: { title: "Brightness scale",
      description: "How brightness maps to grey. <b>asinh</b> shows faint and bright things together; the slider lowers the softness to dig out fainter detail. Every visit uses the same scale, so changes are real, not contrast tricks.", side: "right" } },
    { needs: "field", element: "[data-tour='field']", popover: { title: "Field of view",
      description: "How much sky to show, from 1′ to 15′ (default 8′). Changing it on a new position starts a live build; shrinking a field you already built reuses its data.", side: "right" } },
    { needs: "overlays", element: "[data-tour='overlays']", popover: { title: "Overlays",
      description: "<b>Gaia</b> (<kbd>G</kbd>) circles stars where ESA's Gaia catalogue predicts them on each date, with arrows for their motion. <b>Flags</b> (<kbd>F</kbd>) marks saturated (amber) and bad (hatched) pixels. <b>Planet X</b> (<kbd>X</kbd>) shows how far a distant planet would jump between visits; its slider sets the distance. <b>?</b> lists every shortcut.", side: "right" } },
    { needs: "timeline", element: "[data-tour='timeline']", popover: { title: "The visits",
      description: "One square per visit with its date; hover for the number of exposures. Click to jump to a visit. In diff mode, <b>shift-click</b> picks the reference visit everything is compared against (magenta outline).", side: "bottom" } },
    { needs: "image", element: "[data-tour='image']", popover: { title: "The image",
      description: "SPHEREx pixels on one grid, north up and east left (see the compass). Above it: the date, band, wavelength and how many exposures were stacked, plus badges for saturation and data release. The crosshair marks your position; the pulsing ring follows the target. Hover any pixel to read it in the Inspector; the scale bar shows 1 arcminute.", side: "left" } },
    { needs: "notes", element: "[data-tour='notes']", popover: { title: "What you're looking at",
      description: "For presets, a short note on the object and what to watch for.", side: "left" } },
    { needs: "inspector", element: "[data-tour='inspector']", popover: { title: "Inspector",
      description: "The pixel under your cursor: position in RA/Dec, brightness in MJy/sr and any flags, plus the date, wavelength range and exposure count of the frame on screen.", side: "left" } },
    { needs: "gaiacheck", element: "[data-tour='gaiacheck']", popover: { title: "Checked against Gaia",
      description: "Argus measures where the target really is on each visit and compares it with Gaia's prediction. A ✓ means every visit agrees to within half a pixel. Open <b>Per-visit offsets</b> for the numbers.", side: "left" } },
    { needs: "sky", element: "[data-tour='sky']", popover: { title: "Where in the sky",
      description: "A wider SPHEREx all-sky map around your field; the cyan box is the area in the main image.", side: "left" } },
    { needs: "presets", element: "[data-tour='presets']", popover: { title: "Start here",
      description: "Five targets from the challenge, precomputed so they open instantly: the fastest-moving star, a brown-dwarf pair, the coldest brown dwarf, and two variable stars.", side: "left",
      onNextClick: () => wait(() => c.setView("plots"), () => d().moveNext()) } },
    { element: "[data-tour='plots']", popover: { title: "Plots: brightness over time and colour",
      description: "<b>Light curve</b>: brightness of the source at the centre on every exposure, by date (log scale), coloured by detector; hollow points were saturated. For R Dra, “Mira phase” folds it on its 246-day cycle. <b>Spectrum</b>: brightness against wavelength (log scales) for one visit, since each exposure sees a different colour.", side: "left",
      onNextClick: () => wait(() => c.setView("image"), () => d().moveNext()),
      onPrevClick: () => wait(() => c.setView("image"), () => d().movePrevious()) } },
    { needs: "share", element: "[data-tour='share']", popover: { title: "Share what you found",
      description: "Copy a link to this exact view, embed the viewer on a website, or download a PDF report (stacked image, every visit, plots) or a GIF of the blink.", side: "bottom" } },
    { popover: { title: "You're ready",
      description: "Try Barnard's Star in diff mode with Planet X on, or type any position. You can replay this tour from the <b>Tour</b> button at the top." } },
  ];
  return steps.filter((s) => !s.needs || $(s.needs));
}

export function startTour(c: TourControls): void {
  c.pause();
  track("tour_start");
  let instance: Driver | null = null;
  const steps = buildSteps(c, () => instance!);
  let finished = false;
  const d = driver({
    steps,
    showProgress: true,
    progressText: "{{current}} / {{total}}",
    nextBtnText: "Next",
    prevBtnText: "Back",
    doneBtnText: "Done",
    allowClose: true,
    smoothScroll: true,
    stagePadding: 6,
    stageRadius: 0,
    overlayOpacity: 0.62,
    popoverClass: "argus-tour",
    onHighlighted: (_el, _step, { state }) => {
      track("tour_step", { step: (state.activeIndex ?? 0) + 1 });
      if ((state.activeIndex ?? 0) === steps.length - 1) finished = true;
    },
    onDestroyed: () => {
      track(finished ? "tour_complete" : "tour_skip");
      c.setView("image");
      c.onEnd();
    },
  });
  instance = d;
  d.drive();
}

/** "This is Argus" on the first visit: take the tour, or skip. */
export function WelcomeDialog({ onTour, onSkip }: { onTour: () => void; onSkip: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { markWelcomed(); onSkip(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);
  return (
    <div className="dialog-backdrop welcome-backdrop">
      <div className="dialog welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-h" tabIndex={-1} ref={ref}>
        <img src="/ARGUS_logo_white.svg" alt="" className="welcome-logo" />
        <h2 id="welcome-h">This is Argus</h2>
        <p>
          NASA's SPHEREx telescope photographs the whole sky every six months in infrared light. Argus lines up those
          visits for any patch of sky and plays them like a flipbook, so you can <b>see what moves and what
          changes</b>: nearby stars, brown dwarfs, variable stars.
        </p>
        <p className="note">Would you like a short walkthrough of every part of the tool? It takes about two minutes.</p>
        <div className="welcome-actions">
          <button className="btn btn-primary" onClick={() => { markWelcomed(); onTour(); }}>Yes, show me around</button>
          <button className="btn" onClick={() => { markWelcomed(); track("tour_skip", { at: "welcome" }); onSkip(); }}>Skip</button>
        </div>
      </div>
    </div>
  );
}
