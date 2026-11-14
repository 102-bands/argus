// Animated GIF of the blink (Share → Download). Loaded on demand; runs entirely in the browser.
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import type { FrameMeta } from "./api";
import { download, renderOnce, slug, toCanvas } from "./renderFrames";
import type { RenderMode, StretchKind } from "../workers/frameDecoder.worker";

export interface GifInput {
  worker: Worker;
  frames: FrameMeta[]; // one band, in time order, all decoded
  mode: RenderMode; // blink or diff (stack has nothing to animate)
  refKey: string | null;
  stretch: StretchKind;
  soft: number;
  speedMs: number;
  name: string;
  bandLabel: string;
}

const SIZE = 480; // image edge in px
const STRIP = 34; // caption strip under the image

export async function buildGif(p: GifInput): Promise<void> {
  const mode: RenderMode = p.mode === "stack" ? "blink" : p.mode;
  const imgs = await renderOnce(p.worker, p.frames.map((f) => f.key), mode, p.stretch, p.soft, p.refKey);
  const byKey = new Map(imgs.map((r) => [r.key, r]));
  const gif = GIFEncoder();
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE + STRIP;
  const g = c.getContext("2d")!;
  const ref = p.frames.find((f) => f.key === p.refKey) ?? p.frames[0];
  for (const f of p.frames) {
    const r = byKey.get(f.key);
    if (!r) continue;
    g.fillStyle = "#000";
    g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    g.drawImage(toCanvas(r, Math.max(1, Math.ceil(SIZE / r.w))), 0, 0, SIZE, SIZE);
    g.font = '500 13px "JetBrains Mono", monospace';
    g.textBaseline = "middle";
    g.fillStyle = "#fff";
    const label = `${f.epoch_label} · ${p.bandLabel}${mode === "diff" ? ` · minus ${ref.epoch_label}` : ""}`;
    g.fillText(label, 10, SIZE + STRIP / 2);
    g.fillStyle = "#8c8c8c";
    g.textAlign = "right";
    g.fillText("Argus · NASA SPHEREx", SIZE - 10, SIZE + STRIP / 2);
    g.textAlign = "left";
    const { data } = g.getImageData(0, 0, c.width, c.height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), c.width, c.height, { palette, delay: p.speedMs });
  }
  gif.finish();
  download(new Blob([gif.bytes()], { type: "image/gif" }), `argus-${slug(p.name)}-${mode}.gif`);
}
