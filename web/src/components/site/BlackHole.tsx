// Hero animation: runs only while on screen and the tab is visible; reduced motion gets one still frame.
import { useEffect, useRef } from "react";
import { createBlackHole, STILL_T } from "./blackholeEngine";

export function BlackHole() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let draw: ((t: number) => void) | null = null;
    let raf = 0, visible = true, clock = 0, last = 0;

    const size = () => {
      const w = Math.min(1920, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
      const h = Math.round(w * 9 / 16);
      if (w > 0 && (!draw || canvas.width !== w || canvas.height !== h)) {
        canvas.width = w; canvas.height = h;
        draw = createBlackHole(canvas);
        if (still) draw(STILL_T);
      }
    };
    const frame = (now: number) => {
      raf = 0;
      if (!visible || document.hidden || !draw) return;
      clock += Math.min(0.1, last ? (now - last) / 1000 : 0); // a long pause resumes where it stopped
      last = now;
      draw(clock);
      raf = requestAnimationFrame(frame);
    };
    const play = () => { if (!still && !raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };

    size();
    const ro = new ResizeObserver(() => { size(); play(); });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; play(); });
    io.observe(canvas);
    document.addEventListener("visibilitychange", play);
    play();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener("visibilitychange", play);
    };
  }, []);

  return (
    <canvas ref={ref} className="blackhole" role="img"
            aria-label="The Argus mark dissolving into particles that spiral into a black hole, then re-forming." />
  );
}
