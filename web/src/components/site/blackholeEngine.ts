// The ARGUS mark dissolving into a black hole and re-forming: a Canvas-2D particle loop.
// Ported from the "ARGUS Black Hole" design file; the choreography and constants are unchanged,
// only the design tool's timeline runtime is replaced by a plain clock.

const BW = 1920, BH = 1080, CX = 960, CY = 540, S = 3.0;
const MARK_PTS: [number, number][] = [[50, 20], [-40, 20], [-40, 180], [-0.57, 180], [200.57, 20], [240, 20], [240, 180], [150, 180]]
  .map(([x, y]) => [x - 100, y - 100]);
const CORNER_R = 22;
const RING = 39, HALF_W = 7, RS = 33, TILT = 0.2, ROT = Math.atan2(-160, 201.14), PD = 1.4;
const DISK = ["#ffffff", "#fff0d2", "#ffbe73", "#f0782a", "#8a3a14"];

// Scenes (seconds): Mark, Unbind, Collapse, Orbit, Release, Resolve. CUES are their start times.
const SCENES = [1.6, 0.8, 2.4, 3.2, 2.4, 1.2];
export const LOOP_S = SCENES.reduce((a, b) => a + b, 0);
const START = SCENES.map((_, i) => SCENES.slice(0, i).reduce((a, b) => a + b, 0));
const C = { Unbind: START[1], Collapse: START[2], Orbit: START[3], Release: START[4], Resolve: START[5] };
/** A moment mid-orbit, used as the still frame for reduced motion. */
export const STILL_T = C.Orbit + 1.6;

const TW = { lensing: true, density: 3000, spin: 1.15, trail: 0.04 };

const easeOutCubic = (t: number) => (--t) * t * t + 1;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1);
const easeInOutSine = (t: number) => -(Math.cos(Math.PI * t) - 1) / 2;
const MOTION = { pull: easeInOutCubic, swell: easeInOutSine, fade: easeOutCubic };

const c01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const hexRgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rampColor(stops: string[], t: number) {
  const n = stops.length - 1, f = c01(t) * n, i = Math.min(n - 1, Math.floor(f)), k = f - i;
  const a = hexRgb(stops[i]), b = hexRgb(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

// Fillet every corner of the bracket path (quadratic through the corner ≈ circular arc).
function filletPath(pts: [number, number][], rad: number): [number, number][] {
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i], [ax, ay] = pts[i - 1], [bx, by] = pts[i + 1];
    const la = Math.hypot(ax - px, ay - py), lb = Math.hypot(bx - px, by - py);
    const u1 = [(ax - px) / la, (ay - py) / la], u2 = [(bx - px) / lb, (by - py) / lb];
    const phi = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    const d = Math.min(rad / Math.tan(phi / 2), la * 0.45, lb * 0.45);
    const t1 = [px + u1[0] * d, py + u1[1] * d], t2 = [px + u2[0] * d, py + u2[1] * d];
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, m = 1 - t;
      out.push([m * m * t1[0] + 2 * m * t * px + t * t * t2[0], m * m * t1[1] + 2 * m * t * py + t * t * t2[1]]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

interface Seg { ax: number; ay: number; bx: number; by: number; len: number; nx: number; ny: number }
const RP = filletPath(MARK_PTS, CORNER_R);
const SEGS: Seg[] = [];
for (let i = 0; i < RP.length - 1; i++) {
  const [ax, ay] = RP[i], [bx, by] = RP[i + 1], len = Math.hypot(bx - ax, by - ay);
  SEGS.push({ ax, ay, bx, by, len, nx: -(by - ay) / len, ny: (bx - ax) / len });
}
const LINE_LEN = SEGS.reduce((s, x) => s + x.len, 0);

interface Particles {
  n: number;
  rd: Float32Array; w: Float32Array; ring: Uint8Array; dC: Float32Array; dR: Float32Array;
  al: Float32Array; ph: Float32Array; dt: Float32Array; u: Float32Array; off: Float32Array;
  dust: { r: number; a: number; k: number; s: number }[];
}

// Particles sampled across the mark's 14-unit stroke: polyline + null-set circle.
function buildParticles(n: number): Particles {
  const R = rng(7);
  const circLen = 2 * Math.PI * RING, total = LINE_LEN + circLen;
  const f32 = () => new Float32Array(n);
  const P: Particles = { n, rd: f32(), w: f32(), ring: new Uint8Array(n), dC: f32(), dR: f32(), al: f32(), ph: f32(),
    dt: f32(), u: f32(), off: f32(), dust: [] };
  const rH = f32();
  let rMax = 0;
  for (let i = 0; i < n; i++) {
    let L = R() * total, x, y;
    const off = (R() * 2 - 1) * HALF_W;
    P.off[i] = off;
    if (L < LINE_LEN) {
      P.u[i] = L / LINE_LEN;
      let s = 0;
      while (L > SEGS[s].len && s < SEGS.length - 1) { L -= SEGS[s].len; s++; }
      const g = SEGS[s], u = L / g.len;
      x = g.ax + (g.bx - g.ax) * u + g.nx * off; y = g.ay + (g.by - g.ay) * u + g.ny * off;
    } else {
      const a = R() * Math.PI * 2; P.ring[i] = 1; P.u[i] = a;
      x = Math.cos(a) * (RING + off); y = Math.sin(a) * (RING + off);
    }
    rH[i] = Math.hypot(x, y);
    rMax = Math.max(rMax, rH[i]);
    R(); // the original drew a size here; keep the stream identical
    P.al[i] = 0.5 + R() * 0.5; P.ph[i] = R() * 100;
  }
  for (let i = 0; i < n; i++) {
    const q = rH[i] / rMax;
    P.rd[i] = P.ring[i] ? RS + 1.5 + (R() - 0.5) * 2 : 50 + 240 * (0.4 * Math.pow(q, 1.25) + 0.6 * Math.pow(R(), 1.4)) + (R() - 0.5) * 12;
    P.w[i] = 1500 / Math.pow(Math.max(40, P.rd[i]), 1.5);
    P.dC[i] = Math.min(1.0, 0.8 * Math.pow(q, 0.8) + 0.2 * R());
    P.dR[i] = 1.0 - P.dC[i];
    P.dt[i] = c01((P.rd[i] - 52) / 238);
  }
  // ambient dust (the original also drew an unused alpha per grain)
  for (let i = 0; i < 260; i++) { P.dust.push({ r: 320 + R() * 760, a: R() * 6.283, k: R() < 0.5 ? 1 : 2, s: 0.6 + R() * 1.4 }); R(); }
  return P;
}

const GQ = 6, TQ = 6, AQ = 5, NB = 2 * GQ * TQ * AQ, QCAP = 40000, FLOW = 22, WHOME = 2.8, WDISK = 2.1;
const NSMP = 3, SEGMAX = 30;

function colorTable(): string[] {
  const out = new Array<string>(NB / 2);
  for (let gi = 0; gi < GQ; gi++) for (let ti = 0; ti < TQ; ti++) {
    const g = gi / (GQ - 1), dc = rampColor(DISK, ti / (TQ - 1));
    const r = (255 + (dc[0] - 255) * g) | 0, gg = (255 + (dc[1] - 255) * g) | 0, b = (255 + (dc[2] - 255) * g) | 0;
    for (let ai = 0; ai < AQ; ai++) out[(gi * TQ + ti) * AQ + ai] = `rgba(${r},${gg},${b},${((ai + 0.75) / AQ).toFixed(3)})`;
  }
  return out;
}

/** Everything one canvas needs to draw frames: particles, scratch buffers and the bloom canvas. */
function renderer(n: number) {
  const P = buildParticles(n);
  const TBL = colorTable();
  const QP = new Float32Array(QCAP * NSMP * 2), QN = new Uint8Array(QCAP);
  const QK = new Uint16Array(QCAP), ORD = new Uint32Array(QCAP), BC = new Uint32Array(NB), BO = new Uint32Array(NB);
  const NS = new Uint8Array(n), TQA = new Float32Array(n), FRONT = new Uint8Array(n);
  const SMP = new Float32Array(n * NSMP * 7);
  const BLOOM = document.createElement("canvas");
  BLOOM.width = BW / 8; BLOOM.height = BH / 8;
  const bc = BLOOM.getContext("2d")!;
  const total = LOOP_S;

  return function drawFrame(ctx: CanvasRenderingContext2D, T: number, scale: number) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    const prog = (a: number, b: number, e: (p: number) => number) => e(c01((T - a) / (b - a)));
    const spinK = TW.spin;
    const B = prog(C.Collapse + 0.4, C.Orbit + 0.2, MOTION.swell) * (1 - prog(C.Release, C.Resolve - 0.2, MOTION.swell));
    const bump = (a: number, b: number) => (T > a && T < b ? Math.sin(Math.PI * (T - a) / (b - a)) : 0);
    const J = bump(C.Unbind, C.Collapse + 0.6) + 0.6 * bump(C.Resolve - 0.5, total - 0.25);
    const sA = 1 + 0.035 * bump(C.Unbind, C.Collapse + 0.35);
    const cam = 1 + B * (0.05 + 0.06 * prog(C.Orbit, C.Release, MOTION.swell));
    const K = S * cam, ph = 2 * Math.PI * T / total;

    ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#0B0B0F"; ctx.fillRect(0, 0, BW, BH);
    // dust
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = 0.35; ctx.fillStyle = "#ffffff"; ctx.beginPath();
    for (const d of P.dust) {
      const r = d.r * (1 - 0.12 * B), a = d.a + ph * d.k * 0.5 * (d.k === 2 ? 1 : 2);
      ctx.rect(CX + Math.cos(a) * r, CY + Math.sin(a) * r * (0.55 + 0.45 * (1 - B)), d.s, d.s);
    }
    ctx.fill();

    const dtr = TW.trail, lens = TW.lensing;
    const kcL = Math.max(1, Math.round(FLOW * total / LINE_LEN)), kcR = Math.max(1, Math.round(kcL * LINE_LEN / (2 * Math.PI * RING)));
    const st = { x: 0, y: 0, g: 0, sa: 0, ca: 0, r: 0, k: -1 };
    const pos = (i: number, t: number) => {
      let hx, hy;
      if (P.ring[i]) { const a = P.u[i] + 2 * Math.PI * kcR * t / total, rr = RING + P.off[i]; hx = Math.cos(a) * rr; hy = Math.sin(a) * rr; st.k = -1; }
      else {
        let u = P.u[i] + kcL * t / total; u -= Math.floor(u);
        let L = u * LINE_LEN, k = 0;
        while (k < SEGS.length - 1 && L > SEGS[k].len) { L -= SEGS[k].len; k++; }
        const sg = SEGS[k], f = L / sg.len; st.k = k;
        hx = sg.ax + (sg.bx - sg.ax) * f + sg.nx * P.off[i]; hy = sg.ay + (sg.by - sg.ay) * f + sg.ny * P.off[i];
      }
      hx *= sA; hy *= sA;
      const rH = Math.hypot(hx, hy), aH = Math.atan2(hy, hx);
      const w = P.w[i] * spinK;
      const gc = MOTION.pull(c01((t - C.Collapse - P.dC[i]) / PD));
      const gr = MOTION.pull(c01((t - C.Release - P.dR[i]) / PD));
      const g = gc * (1 - gr);
      const spin = t > C.Collapse ? w * (t - C.Collapse) : 0;
      const land = 2 * Math.PI * Math.ceil(w * (C.Release + P.dR[i] + PD - C.Collapse) / (2 * Math.PI));
      const a = aH + gc * (spin + (land - spin) * gr);
      const r = rH + (P.rd[i] - rH) * g;
      const tf = P.ring[i] ? 1 : 1 + (TILT - 1) * g;
      const ca = Math.cos(a), sa = Math.sin(a), jm = J * 3.2 * (1 - g);
      const th = P.ring[i] ? 0 : (((P.ph[i] * 13.7) % 1) - 0.5) * (6 + 0.09 * P.rd[i]) * g;
      st.x = r * ca + jm * Math.sin(hy * 0.045 + t * 2.4);
      st.y = r * sa * tf + th + jm * Math.cos(hx * 0.045 + t * 2.1);
      st.g = g; st.sa = sa; st.ca = ca; st.r = r;
    };
    let qn = 0;
    const pt = (q: number, j: number, x: number, y: number, g: number) => {
      const cr = Math.cos(ROT * g), sr = Math.sin(ROT * g), o = q * NSMP * 2 + j * 2;
      QP[o] = CX + (x * cr - y * sr) * K; QP[o + 1] = CY + (x * sr + y * cr) * K;
    };
    const LXY = [0, 0];
    const lensXY = (r: number, ca: number, sa: number, which: number) => {
      if (which === 0) { const lr = RS * 1.1 + (r - 50) * 0.2; LXY[0] = lr * ca * 1.02; LXY[1] = lr * sa * 1.05; }
      else { const lr = RS * 1.05 + (r - 50) * 0.16; LXY[0] = lr * ca; LXY[1] = lr * sa; }
      return LXY;
    };
    // sample each stream at 3 times: now, -dt/2, -dt
    for (let i = 0; i < P.n; i++) {
      const rc = c01((T - C.Collapse - P.dC[i]) / PD), rr = c01((T - C.Release - P.dR[i]) / PD);
      const tq = Math.pow(Math.max(Math.sin(Math.PI * rc), Math.sin(Math.PI * rr)), 0.35);
      TQA[i] = tq;
      const gT = MOTION.pull(rc) * (1 - MOTION.pull(rr));
      const dti = dtr * gT * gT * (1 - 0.85 * tq); // particles on the mark, lines in the disk
      const ns = dti < 0.003 ? 1 : NSMP;
      for (let j = 0; j < ns; j++) {
        pos(i, T - dti * j / (NSMP - 1));
        const o = (i * NSMP + j) * 7;
        SMP[o] = st.x; SMP[o + 1] = st.y; SMP[o + 2] = st.g; SMP[o + 3] = st.sa; SMP[o + 4] = st.ca; SMP[o + 5] = st.r; SMP[o + 6] = st.k;
      }
      NS[i] = ns;
      const o = i * NSMP * 7, g = SMP[o + 2], sa = SMP[o + 3];
      FRONT[i] = !P.ring[i] && g > 0.5 && sa < 0 ? 0 : 1;
    }
    const queue = (i: number, alpha: number, lensWhich: number | null) => {
      if (alpha < 0.03) return;
      const o = i * NSMP * 7, g = SMP[o + 2];
      let cnt = 0, len = 0;
      const lim = lensWhich != null ? Math.min(2, NS[i]) : NS[i];
      for (let j = 0; j < lim; j++) {
        const b = o + j * 7;
        if (j > 0 && SMP[b + 6] !== SMP[o + 6] && SMP[b + 2] < 0.5) break; // don't bridge mark corners
        let x = SMP[b], y = SMP[b + 1];
        if (lensWhich != null) {
          const sa = SMP[b + 3];
          if ((lensWhich === 0) !== (sa < 0)) break;
          const L = lensXY(SMP[b + 5], SMP[b + 4], sa, lensWhich); x = L[0]; y = L[1];
        }
        pt(qn, j, x, y, SMP[b + 2]);
        if (j > 0) { // cut the stream where a segment would chord across the disk
          const q = qn * NSMP * 2 + j * 2, dx = QP[q] - QP[q - 2], dy = QP[q + 1] - QP[q - 1], d = Math.sqrt(dx * dx + dy * dy);
          if (d > SEGMAX) break;
          len += d;
        }
        cnt = j + 1;
      }
      if (cnt === 0) return;
      // conserve light: long transit streams get dimmer so overlaps don't blow out
      const tr = Math.sin(Math.PI * g), lf = Math.min(1, 26 / (8 + len));
      alpha *= (1 - (1 - lf) * tr) * (1 - 0.6 * tr) * (1 - 0.55 * TQA[i]);
      if (alpha < 0.03) return;
      QN[qn] = cnt;
      const gi = Math.round(g * (GQ - 1)), ti = P.ring[i] ? 0 : Math.round(P.dt[i] * (TQ - 1));
      const ai = Math.min(AQ - 1, (alpha * AQ) | 0);
      QK[qn] = (((lensWhich != null ? 1 : 0) * GQ + gi) * TQ + ti) * AQ + ai; qn++;
    };
    const flush = () => {
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "butt"; ctx.lineJoin = "bevel";
      BC.fill(0);
      for (let j = 0; j < qn; j++) BC[QK[j]]++;
      let acc = 0;
      for (let b = 0; b < NB; b++) { BO[b] = acc; acc += BC[b]; }
      for (let j = 0; j < qn; j++) ORD[BO[QK[j]]++] = j;
      let j = 0;
      for (let b = 0; b < NB; b++) {
        const c = BC[b];
        if (!c) continue;
        const isLens = b >= NB / 2, gi = Math.floor((b % (NB / 2)) / (TQ * AQ)), g = gi / (GQ - 1);
        const lw = (WHOME + (WDISK - WHOME) * g) * cam * (isLens ? 0.8 : 1), h = lw / 2;
        ctx.lineWidth = Math.min(lw, 0.99 / scale); ctx.strokeStyle = ctx.fillStyle = TBL[b % (NB / 2)]; // ≤1 device px = fast hairline path
        // dots (single samples) as one filled path, streaks as one stroked path
        const j0 = j;
        let dots = 0, lines = 0;
        ctx.beginPath();
        for (const e = j + c; j < e; j++) {
          const id = ORD[j];
          if (QN[id] > 1) { lines++; continue; }
          const q = id * NSMP * 2; ctx.rect(QP[q] - h, QP[q + 1] - h, lw, lw); dots++;
        }
        if (dots) ctx.fill();
        if (lines) {
          ctx.beginPath();
          for (let jj = j0; jj < j; jj++) {
            const id = ORD[jj], m = QN[id];
            if (m < 2) continue;
            const q = id * NSMP * 2;
            ctx.moveTo(QP[q], QP[q + 1]);
            for (let k = 1; k < m; k++) ctx.lineTo(QP[q + k * 2], QP[q + k * 2 + 1]);
          }
          ctx.stroke();
        }
      }
      qn = 0;
    };
    const alphaOf = (i: number) => {
      const o = i * NSMP * 7, g = SMP[o + 2], ca = SMP[o + 4];
      return P.al[i] * (0.85 + 0.15 * g) * (1 - (1 - Math.min(1, 4000 / P.n)) * g) * (1 - 0.75 * g * B * ca) * (P.ring[i] ? 1 - 0.55 * g : 1);
    };
    for (let i = 0; i < P.n; i++) if (!FRONT[i]) queue(i, alphaOf(i), null);
    if (lens && B > 0.02) {
      for (let i = 0; i < P.n; i++) {
        if (P.ring[i] || SMP[i * NSMP * 7 + 2] < 0.25) continue;
        const la = alphaOf(i) * B * SMP[i * NSMP * 7 + 2];
        queue(i, la * 1.2, 0); queue(i, la * 0.95, 2);
      }
    }
    flush();
    if (B > 0.005) {
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = B;
      ctx.fillStyle = "#030305"; ctx.beginPath(); ctx.arc(CX, CY, RS * K, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "lighter";
      ctx.globalAlpha = 0.14 * B; ctx.strokeStyle = DISK[1]; ctx.lineWidth = 16 * cam;
      ctx.beginPath(); ctx.arc(CX, CY, (RS + 3) * K, 0, 6.283); ctx.stroke();
      ctx.globalAlpha = 0.85 * B; ctx.strokeStyle = DISK[0]; ctx.lineWidth = 2.5 * cam;
      ctx.beginPath(); ctx.arc(CX, CY, (RS + 1.5) * K, 0, 6.283); ctx.stroke();
    }
    for (let i = 0; i < P.n; i++) if (FRONT[i]) queue(i, alphaOf(i), null);
    flush();
    // dusty equatorial band across the near side of the disk
    if (B > 0.01) {
      ctx.save(); ctx.translate(CX, CY); ctx.rotate(ROT * B);
      const hb = 12 * K, L = 210 * K, yb = 6 * K;
      ctx.translate(0, yb); ctx.scale(1, hb / L);
      const gb = ctx.createRadialGradient(0, 0, 0, 0, 0, L);
      gb.addColorStop(0, `rgba(12,6,4,${0.9 * B})`); gb.addColorStop(0.55, `rgba(16,8,5,${0.75 * B})`);
      gb.addColorStop(0.85, `rgba(16,8,5,${0.3 * B})`); gb.addColorStop(1, "rgba(16,8,5,0)");
      ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1; ctx.fillStyle = gb;
      ctx.beginPath(); ctx.arc(0, 0, L, 0, 6.283); ctx.fill(); ctx.restore();
    }
    // cheap bloom: downsample + additive upsample (in device pixels, so reset the transform first)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    bc.globalCompositeOperation = "copy"; bc.drawImage(ctx.canvas, 0, 0, BW / 8, BH / 8);
    ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.25 + 0.45 * B; ctx.imageSmoothingEnabled = true;
    ctx.drawImage(BLOOM, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
  };
}

/** Draws the loop on a canvas; the caller sizes the canvas (16:9) and drives the clock. */
export function createBlackHole(canvas: HTMLCanvasElement, density = TW.density) {
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const draw = renderer(density);
  return (T: number) => draw(ctx, ((T % LOOP_S) + LOOP_S) % LOOP_S, canvas.width / BW);
}
