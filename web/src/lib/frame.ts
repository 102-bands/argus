// Frame binary format (api/argus/pipeline.py encode_frame):
// [u32 LE header length][JSON header][float16 pixels, row 0 = south][uint8 flag layer]
import type { GridWcs } from "./physics";

export interface FrameHeader {
  key: string;
  w: number;
  h: number;
  lo: number;
  hi: number;
  epoch: number;
  epoch_label: string;
  detector: string;
  product: string;
  t_mid: number;
  lambda_um: number;
  n_exp: number;
  wcs: GridWcs;
}

export interface DecodedFrame {
  header: FrameHeader;
  pixels: Float32Array;
  layer: Uint8Array;
}

export const LAYER_ALL_MASKED = 1;
export const LAYER_SATURATED = 2;

const F16_EXP = new Float32Array(32);
for (let e = 0; e < 32; e++) F16_EXP[e] = Math.pow(2, e - 15);

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * F16_EXP[e] * (1 + f / 1024);
}

export function decodeFrame(buf: ArrayBuffer): DecodedFrame {
  const dv = new DataView(buf);
  const hlen = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen))) as FrameHeader;
  const n = header.w * header.h;
  const off = 4 + hlen;
  const pixels = new Float32Array(n);
  for (let i = 0; i < n; i++) pixels[i] = halfToFloat(dv.getUint16(off + 2 * i, true));
  const layer = new Uint8Array(buf.slice(off + 2 * n, off + 3 * n));
  return { header, pixels, layer };
}
