// One-off renders through the frame worker (report and GIF export). Same stretch and colours as the viewer.
import type { RenderMode, StretchKind, WorkerIn, WorkerOut } from "../workers/frameDecoder.worker";

export interface Rendered {
  key: string;
  w: number;
  h: number;
  rgba: Uint8ClampedArray;
}

let nextId = 1_000_000; // far above the viewer's render ids, which it ignores

export function renderOnce(worker: Worker, keys: string[], mode: RenderMode, stretch: StretchKind, soft: number,
                           refKey: string | null): Promise<Rendered[]> {
  const id = nextId++;
  return new Promise((resolve) => {
    const on = (e: MessageEvent<WorkerOut>) => {
      const m = e.data;
      if (m.type !== "rendered" || m.id !== id) return;
      worker.removeEventListener("message", on);
      resolve(m.images.map((im) => ({ key: im.key, w: m.w, h: m.h, rgba: new Uint8ClampedArray(im.rgba) })));
    };
    worker.addEventListener("message", on);
    worker.postMessage({ type: "render", id, keys, stretch, soft, mode, refKey } satisfies WorkerIn);
  });
}

/** Draw a render at `scale`× with hard pixel edges (SPHEREx pixels are 6.15″; smoothing would invent detail). */
export function toCanvas(r: Rendered, scale: number): HTMLCanvasElement {
  const small = document.createElement("canvas");
  small.width = r.w;
  small.height = r.h;
  small.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(r.rgba), r.w, r.h), 0, 0);
  const big = document.createElement("canvas");
  big.width = r.w * scale;
  big.height = r.h * scale;
  const g = big.getContext("2d")!;
  g.imageSmoothingEnabled = false;
  g.drawImage(small, 0, 0, big.width, big.height);
  return big;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function slug(s: string): string {
  return s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").toLowerCase() || "field";
}
