// Ball tracking helpers: smoothing, color lock and search-region choice.
// Pure functions (no DOM) so they can be tested in Node.

/* One-Euro filter: smooths heavily when the ball is still (no jitter),
   lightly when it moves fast (no lag). t is in milliseconds. */
export class OneEuro {
  constructor(minCutoff = 1.2, beta = 0.015, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  reset() { this.x = null; this.dx = 0; this.t = null; }
  static alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(x, t) {
    if (this.x === null) { this.x = x; this.t = t; return x; }
    const dt = Math.max(1e-3, (t - this.t) / 1000); this.t = t;
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (x - this.x);
    return this.x;
  }
}

/* Color model: chromaticity (r/sum, g/sum) is fairly stable under lighting
   changes; brightness is checked loosely. White/gray balls are "neutral". */
export function learnColor(data, w, h, cx, cy, rad) {
  cx = Math.round(cx); cy = Math.round(cy); rad = Math.max(1, Math.round(rad));
  const px = [];
  for (let y = Math.max(0, cy - rad); y <= Math.min(h - 1, cy + rad); y++) {
    for (let x = Math.max(0, cx - rad); x <= Math.min(w - 1, cx + rad); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > rad * rad) continue;
      const i = (y * w + x) * 4, s = data[i] + data[i + 1] + data[i + 2] + 1;
      px.push([data[i] / s, data[i + 1] / s, s / 3]);
    }
  }
  if (!px.length) return null;
  // Dominant color, not the average: logos, panels and spots on the ball are ignored.
  let best = null;
  for (const p of px) {
    let n = 0;
    for (const q of px) if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < 0.03 ** 2 && Math.abs(q[2] - p[2]) < 40) n++;
    if (!best || n > best.n) best = { p, n };
  }
  let cr = 0, cg = 0, v = 0, n = 0;
  for (const q of px) if ((q[0] - best.p[0]) ** 2 + (q[1] - best.p[1]) ** 2 < 0.03 ** 2 && Math.abs(q[2] - best.p[2]) < 40) { cr += q[0]; cg += q[1]; v += q[2]; n++; }
  cr /= n; cg /= n; v /= n;
  return { cr, cg, v, neutral: Math.hypot(cr - 1 / 3, cg - 1 / 3) < 0.035 };
}

export function blendColor(a, b, k = 0.15) {
  if (!a) return b;
  if (!b) return a;
  const cr = a.cr + (b.cr - a.cr) * k, cg = a.cg + (b.cg - a.cg) * k, v = a.v + (b.v - a.v) * k;
  return { cr, cg, v, neutral: Math.hypot(cr - 1 / 3, cg - 1 / 3) < 0.035 };
}

export function matches(m, r, g, b, tol = 0.045) {
  const s = r + g + b + 1, cr = r / s, cg = g / s, v = s / 3;
  if (m.neutral) return Math.abs(v - m.v) < Math.max(25, m.v * 0.3) && Math.hypot(cr - 1 / 3, cg - 1 / 3) < 0.05;
  if (v < m.v * 0.4 || v > m.v * 1.9 + 20) return false;
  return (cr - m.cr) ** 2 + (cg - m.cg) ** 2 < tol * tol;
}

/* Find the ball-colored blob inside a window, then mean-shift onto its
   centre so other same-colored things nearby don't drag it off. */
export function findBlob(data, w, h, m, win, expectR = 0, keepBig = false) {
  const x0 = Math.max(0, Math.floor(win.x0)), y0 = Math.max(0, Math.floor(win.y0));
  const x1 = Math.min(w - 1, Math.ceil(win.x1)), y1 = Math.min(h - 1, Math.ceil(win.y1));
  let n = 0, sx = 0, sy = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = (y * w + x) * 4;
    if (matches(m, data[i], data[i + 1], data[i + 2])) { n++; sx += x; sy += y; }
  }
  if (n < 6) return null;
  let cx = win.seedX ?? sx / n, cy = win.seedY ?? sy / n;
  let R = Math.max(4, (expectR || Math.sqrt(n / Math.PI)) * 1.8);
  let best = null;
  for (let it = 0; it < 4; it++) {
    let k = 0, ax = 0, ay = 0;
    const r2 = R * R;
    for (let y = Math.max(y0, Math.floor(cy - R)); y <= Math.min(y1, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(x0, Math.floor(cx - R)); x <= Math.min(x1, Math.ceil(cx + R)); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 > r2) continue;
        const i = (y * w + x) * 4;
        if (matches(m, data[i], data[i + 1], data[i + 2])) { k++; ax += x; ay += y; }
      }
    }
    if (k < 6) return best;
    cx = ax / k; cy = ay / k;
    const r = Math.sqrt(k / Math.PI);
    best = { x: cx, y: cy, r, n: k };
    R = Math.max(4, r * 1.8);
  }
  if (!keepBig && expectR && best && best.r > expectR * 2.2) return null;   // grew into something that isn't the ball
  return best;
}

/* Whole-picture search when the ball was lost: look at every patch of
   ball color and keep the one whose size best matches a ball. */
export function findBestBlob(data, w, h, m, expectR) {
  const cell = Math.max(6, Math.round(expectR * 2));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell), counts = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (matches(m, data[i], data[i + 1], data[i + 2])) counts[Math.floor(y / cell) * gw + Math.floor(x / cell)]++;
  }
  const cand = [];
  for (let k = 0; k < counts.length; k++) if (counts[k] >= 4) cand.push(k);
  cand.sort((a, b) => counts[b] - counts[a]);
  let best = null, tries = 0;
  const seen = [];                                   // blobs already checked, so one big object isn't tried over and over
  for (const k of cand) {
    if (tries >= 10) break;
    const sx = (k % gw + 0.5) * cell, sy = (Math.floor(k / gw) + 0.5) * cell;
    if (seen.some(s => Math.hypot(sx - s.x, sy - s.y) < s.r + cell * 0.7)) continue;
    tries++;
    const b = findBlob(data, w, h, m, { x0: 0, y0: 0, x1: w - 1, y1: h - 1, seedX: sx, seedY: sy }, expectR, true);
    if (!b) { seen.push({ x: sx, y: sy, r: cell / 2 }); continue; }
    seen.push(b);
    const err = Math.abs(Math.log(b.r / expectR));
    if (err < Math.log(2) && (!best || err < best.err)) best = { ...b, err };
  }
  return best;
}

/* Choose a square crop of the camera picture for the detector, so the ball
   is many more pixels wide in the model's input. Raw (unmirrored) pixels. */
export function chooseRoi(W, H, ball, feet, fullEvery, frame) {
  if (frame % fullEvery === 0) return null;                // periodic full-frame look
  let cx, cy, s;
  if (ball) { cx = ball.x; cy = ball.y; s = Math.max(ball.r * 12, H * 0.3); }
  else if (feet) { s = Math.max(feet.legLen * 4, H * 0.5); cx = feet.x; cy = feet.y - s * 0.15; }
  else return null;
  s = Math.min(s, H, W);
  const sx = Math.min(Math.max(0, cx - s / 2), W - s);
  const sy = Math.min(Math.max(0, cy - s / 2), H - s);
  return { sx, sy, s };
}
