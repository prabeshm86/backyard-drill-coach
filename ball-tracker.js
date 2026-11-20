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

/* ---------- Shape tracking for white / gray balls ----------
   Color can't tell a white ball from white socks or walls, so look for a
   ball-sized round patch that is brighter (or darker) than everything
   around it. A sock or shoe is long, so it fails on at least two sides. */
export function grayIntegral(data, w, h) {
  const W1 = w + 1, I = new Float64Array(W1 * (h + 1)), I2 = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0, row2 = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      row += g; row2 += g * g;
      I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
      I2[(y + 1) * W1 + x + 1] = I2[y * W1 + x + 1] + row2;
    }
  }
  I.sq = I2;   // squares, for texture (std-dev) checks
  return I;
}
function boxMean(I, w, h, x0, y0, x1, y1) {
  x0 = Math.max(0, Math.min(w, Math.round(x0))); x1 = Math.max(0, Math.min(w, Math.round(x1)));
  y0 = Math.max(0, Math.min(h, Math.round(y0))); y1 = Math.max(0, Math.min(h, Math.round(y1)));
  const a = (x1 - x0) * (y1 - y0);
  if (a <= 0) return null;
  const W1 = w + 1;
  return (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0]) / a;
}
/* Contrast between the ball's middle and the four sides around it.
   Uses the 2nd-weakest side, so one side touching a foot is fine,
   but a long object (bright on two sides) scores low. */
export function discScore(I, w, h, cx, cy, r) {
  const k = 0.7 * r, a = 1.2 * r, b = 1.9 * r;
  const inner = boxMean(I, w, h, cx - k, cy - k, cx + k, cy + k);
  if (inner === null) return 0;
  const sides = [
    boxMean(I, w, h, cx - k, cy - b, cx + k, cy - a),   // straight above
    boxMean(I, w, h, cx - k, cy + a, cx + k, cy + b),   // straight below
    boxMean(I, w, h, cx - b, cy - k, cx - a, cy + k),   // left
    boxMean(I, w, h, cx + a, cy - k, cx + b, cy + k),   // right
  ].filter(v => v !== null).map(v => inner - v);
  if (sides.length < 3) return 0;
  const pos = sides.slice().sort((p, q) => p - q), neg = sides.map(v => -v).sort((p, q) => p - q);
  return pos[1] > 0 ? pos[1] : neg[1] > 0 ? -neg[1] : 0;   // + brighter than surroundings, - darker
}
/* Texture inside the ball: a soccer ball's panels make it speckled,
   a sock or shoe end is plain. Same under any spin. */
export function innerStd(I, w, h, cx, cy, r) {
  if (!I.sq) return 0;
  const k = 0.75 * r, m = boxMean(I, w, h, cx - k, cy - k, cx + k, cy + k), m2 = boxMean(I.sq, w, h, cx - k, cy - k, cx + k, cy + k);
  return m === null ? 0 : Math.sqrt(Math.max(0, m2 - m * m));
}
export function findDisc(I, w, h, win, r, ref) {
  let best = null;
  const x0 = Math.max(1, Math.floor(win.x0)), x1 = Math.min(w - 2, Math.ceil(win.x1));
  const y0 = Math.max(1, Math.floor(win.y0)), y1 = Math.min(h - 2, Math.ceil(win.y1));
  // Prefer spots near where the ball just was (it can't teleport between frames).
  const sx = win.seedX ?? (x0 + x1) / 2, sy = win.seedY ?? (y0 + y1) / 2, span = Math.max(4, (x1 - x0) / 2);
  for (const s of [0.8, 1, 1.25]) {
    const rr = Math.max(1.5, r * s);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const raw = discScore(I, w, h, x, y, rr) * ref.sign;
      if (raw <= 10) continue;
      // Most like the learned ball (same contrast), not just the brightest round thing (a white sock end is brighter).
      let sc = -Math.abs(raw - ref.contrast) / ref.contrast - 0.3 * Math.hypot(x - sx, y - sy) / span - 0.3 * Math.abs(Math.log(s));
      if (ref.std > 6) sc -= 1.2 * Math.abs(innerStd(I, w, h, x, y, rr) - ref.std) / ref.std;   // speckled like the ball?
      if (!best || sc > best.sc) best = { x, y, r: rr, sc, raw };
    }
  }
  if (!best || best.raw <= ref.contrast * 0.45) return null;
  // Snap to the ball's exact centre: the strongest contrast within 2 px.
  let peak = best;
  for (let y = best.y - 2; y <= best.y + 2; y++) for (let x = best.x - 2; x <= best.x + 2; x++) {
    const raw = discScore(I, w, h, x, y, best.r) * ref.sign;
    if (raw > peak.raw) peak = { ...best, x, y, raw };
  }
  return peak;
}
export function learnDisc(I, w, h, cx, cy, r) {
  const sc = discScore(I, w, h, cx, cy, r);
  return Math.abs(sc) > 10 ? { sign: Math.sign(sc), contrast: Math.abs(sc), std: innerStd(I, w, h, cx, cy, r) } : null;
}

/* ---------- The full tracker ----------
   1. AI detector on a zoomed-in crop (feet area, then the ball itself).
   2. Between AI checks: color lock for colored balls, shape lock for
      white/gray balls.
   3. One-Euro smoothing.
   Positions are raw (unmirrored) camera pixels. */
export class BallTracker {
  constructor(detector, { AS = 4, makeCanvas } = {}) {
    const mk = makeCanvas || ((w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h }));
    this.det = detector; this.AS = AS;
    this.ana = mk(1, 1); this.actx = this.ana.getContext("2d", { willReadFrequently: true });
    this.roi = mk(448, 448); this.rctx = this.roi.getContext("2d");
    this.filt = { x: new OneEuro(0.8, 0.015), y: new OneEuro(0.8, 0.015), r: new OneEuro(0.6, 0.002) };
    this.frame = 0; this.color = null; this.disc = null; this.ball = null;
    this.src = ""; this.score = 0; this.lastR = 18; this.pendingTap = null; this.tapResult = null;
    this.aiFrame = -1e9;   // last frame the AI confirmed the ball
  }
  isRecent(b) { return !!b && (this.frame - b.f <= 4 || performance.now() - b.t < 500); }
  tap(x, y, r) { this.pendingTap = { x, y, r }; }
  get neutral() { return !!this.color && this.color.neutral; }

  detectAI(source, ts, W, H, feet) {
    // Only aim the AI at the locked spot while the AI keeps confirming it. Otherwise the lock may be
    // on the wrong thing (e.g. a white sock), so look at the full picture and the feet area instead.
    const trusted = this.frame - this.aiFrame <= 8;
    const recent = trusted && this.isRecent(this.ball) ? this.ball : null;
    // Ball known: zoom on it, full look every 6th frame. Unknown: alternate feet-area zoom and full picture.
    const roi = chooseRoi(W, H, recent, feet, recent ? 6 : 2, this.frame);
    let res, map;
    if (roi) {
      this.rctx.drawImage(source, roi.sx, roi.sy, roi.s, roi.s, 0, 0, 448, 448);
      res = this.det.detectForVideo(this.roi, ts);
      const k = roi.s / 448;
      map = bb => ({ x: roi.sx + (bb.originX + bb.width / 2) * k, y: roi.sy + (bb.originY + bb.height / 2) * k, r: (bb.width + bb.height) / 4 * k });
    } else {
      res = this.det.detectForVideo(source, ts);
      map = bb => ({ x: bb.originX + bb.width / 2, y: bb.originY + bb.height / 2, r: (bb.width + bb.height) / 4 });
    }
    let best = null;
    for (const d of res.detections || []) {
      const s = d.categories[0]?.score ?? 0, m = map(d.boundingBox);
      const near = recent ? Math.max(0, 1 - Math.hypot(m.x - recent.x, m.y - recent.y) / (recent.r * 8)) * 0.15 : 0;
      if (!best || s + near > best.s + best.near) best = { ...m, s, near };
    }
    return best;
  }

  lockTrack(img, I, H, now) {
    const AS = this.AS, aw = this.ana.width, ah = this.ana.height;
    const recent = this.isRecent(this.ball) ? this.ball : null;
    if (this.color && !this.color.neutral) {
      let b;
      if (recent) {
        const R = Math.max(recent.r * 3, H * 0.06) / AS;
        b = findBlob(img, aw, ah, this.color, { x0: recent.x / AS - R, y0: recent.y / AS - R, x1: recent.x / AS + R, y1: recent.y / AS + R, seedX: recent.x / AS, seedY: recent.y / AS }, recent.r / AS);
      } else b = findBestBlob(img, aw, ah, this.color, this.lastR / AS);
      return b ? { x: b.x * AS, y: b.y * AS, r: b.r * AS, src: "color" } : null;
    }
    if (this.disc && recent) {   // white/gray ball: shape lock, only near where it is heading
      const dt = Math.min(0.2, Math.max(0, (now - recent.t) / 1000));
      const px = recent.x + this.filt.x.dx * dt, py = recent.y + this.filt.y.dx * dt;   // predicted from its speed
      const R = Math.max(recent.r * 2.5, H * 0.05) / AS;
      const b = findDisc(I, aw, ah, { x0: px / AS - R, y0: py / AS - R, x1: px / AS + R, y1: py / AS + R, seedX: px / AS, seedY: py / AS }, recent.r / AS, this.disc);
      return b ? { x: b.x * AS, y: b.y * AS, r: b.r * AS, src: "shape" } : null;
    }
    return null;
  }

  learnAt(img, I, x, y, r, blend) {
    const AS = this.AS, aw = this.ana.width, ah = this.ana.height;
    const c = learnColor(img, aw, ah, x / AS, y / AS, r * 0.6 / AS);
    if (c) this.color = blend ? blendColor(this.color, c, 0.15) : c;
    const d = learnDisc(I, aw, ah, x / AS, y / AS, r / AS);
    if (d) this.disc = blend && this.disc && this.disc.sign === d.sign
      ? { sign: d.sign, contrast: this.disc.contrast * 0.85 + d.contrast * 0.15, std: this.disc.std * 0.85 + d.std * 0.15 } : d;
    return c;
  }

  step(source, ts, now, W, H, feet) {
    const AS = this.AS;
    if (this.ana.width !== Math.round(W / AS)) { this.ana.width = Math.round(W / AS); this.ana.height = Math.round(H / AS); }
    this.actx.drawImage(source, 0, 0, this.ana.width, this.ana.height);
    this.frame++;
    const img = this.actx.getImageData(0, 0, this.ana.width, this.ana.height).data;
    const I = grayIntegral(img, this.ana.width, this.ana.height);

    if (this.pendingTap) {
      const t = this.pendingTap; this.pendingTap = null;
      const c = this.learnAt(img, I, t.x, t.y, t.r, false);
      if (!c || c.v < 8) this.tapResult = "miss";
      else {
        this.ball = { x: t.x, y: t.y, r: t.r, t: performance.now(), f: this.frame };
        this.aiFrame = this.frame;   // a tap counts as a confirmation
        this.filt.x.reset(); this.filt.y.reset(); this.filt.r.reset();
        this.tapResult = c.neutral ? (this.disc ? "white" : "white-weak") : "color";
      }
    }

    let fromLock = this.lockTrack(img, I, H, now);
    // Safety: a shape lock (white ball) that the AI hasn't confirmed for ~1.5 s may be stuck on a
    // white sock or shoe. Better to show "no ball" and keep searching than to count wrong touches.
    if (fromLock && fromLock.src === "shape" && this.frame - this.aiFrame > 45) fromLock = null;
    // AI every frame until locked; then every 3rd frame (colored ball) or 2nd (white ball, shape lock is weaker).
    const every = this.neutral ? 2 : 3;
    const fromAI = this.det && (!fromLock || this.frame % every === 0) ? this.detectAI(source, ts, W, H, feet) : null;

    let meas = null;
    if (fromAI && fromAI.s >= 0.3) {
      meas = fromAI; this.src = "AI"; this.score = fromAI.s; this.aiFrame = this.frame;
      if (fromAI.s >= 0.45 && fromAI.r > 6) this.learnAt(img, I, fromAI.x, fromAI.y, fromAI.r, !!this.color);
    } else if (fromLock) {
      meas = fromLock; this.src = fromLock.src;
    } else if (fromAI) {
      meas = fromAI; this.src = "AI"; this.score = fromAI.s;
    }

    if (meas) {
      const jump = this.ball && Math.hypot(meas.x - this.ball.x, meas.y - this.ball.y) > Math.max(this.ball.r, meas.r) * 4;
      if (!this.isRecent(this.ball) || jump) { this.filt.x.reset(); this.filt.y.reset(); this.filt.r.reset(); }
      this.ball = { x: this.filt.x.filter(meas.x, now), y: this.filt.y.filter(meas.y, now), r: this.filt.r.filter(meas.r, now), t: now, f: this.frame };
      this.lastR = this.ball.r;
    } else if (this.ball && !this.isRecent(this.ball)) this.ball = null;
    return this.ball;
  }
}
