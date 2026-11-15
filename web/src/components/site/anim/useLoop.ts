// Shared clock for the home-page animations: seconds of play time, advancing only while the figure is on
// screen and the tab is visible. With reduced motion it stays at `still`, a frame chosen to read on its own.
import { useEffect, useState, type RefObject } from "react";

export function useLoop(ref: RefObject<Element | null>, still = 0): number {
  const [time, setTime] = useState(still);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0, visible = true, last = 0;
    const tick = (now: number) => {
      raf = 0;
      if (!visible || document.hidden) return;
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      setTime((t) => t + dt);
      raf = requestAnimationFrame(tick);
    };
    const play = () => { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(tick); } };
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; play(); });
    if (ref.current) io.observe(ref.current);
    document.addEventListener("visibilitychange", play);
    play();
    return () => { cancelAnimationFrame(raf); io.disconnect(); document.removeEventListener("visibilitychange", play); };
  }, [ref]);
  return time;
}

/** Seeded random numbers, so every visitor sees the same star field. */
export function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export type Star = readonly [x: number, y: number, r: number];

/** A scatter of background stars inside a box. */
export function starField(seed: number, n: number, x0: number, y0: number, w: number, h: number): Star[] {
  const r = seeded(seed);
  return Array.from({ length: n }, () => [x0 + r() * w, y0 + r() * h, 0.7 + r() * r() * 2.6] as const);
}

export const smooth = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
