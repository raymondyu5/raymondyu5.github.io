/**
 * The banner animations: a murmuration of dots that lands to draw a scene, holds it
 * (with parts of it moving), takes off again, and lands as the next scene.
 *
 *   <div class="viz" data-viz="journey" data-scenes="rainier,grove" data-image="assets/viz/rainier.jpg">
 *
 * Scenes (data-scenes, comma-separated, played in order and looped):
 *   rainier  – Mount Rainier, its skyline traced from data-image, with firs, roost
 *              trees, and a sun or moon that follows the light/dark theme
 *   grove    – an old tree on a hill with an endless parade of animals walking under it
 *   city     – a future skyline with flying cars, a rocket launch, and a giant mech
 *   workshop – a conveyor, two welding arms, and an arm handing boxes to a person
 *
 * Hover scatters the dots. Off-screen banners pause; reduced-motion shows one still frame.
 *
 * Also here: the life page's background (data-walk), someone seen from behind walking
 * a forking trail, framed in the open middle of the photo wall.
 * Add ?warm=N to the page URL to fast-forward N steps (handy for screenshots).
 */
(function () {
  'use strict';

  /* ---------------- shared helpers ---------------- */

  // The theme's ink and paper colours. If the stylesheet hasn't applied yet (it can lag the
  // script on a cold load in Safari), fall back to the theme's values instead of painting black.
  function readColors() {
    const s = getComputedStyle(document.documentElement), root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    const fallback = { '--ink': dark ? 'f0eee8' : '111111', '--paper': dark ? '141412' : 'f5f4ef' };
    const rgb = v => {
      let h = s.getPropertyValue(v).trim().replace('#', '');
      if (!/^[0-9a-f]{6}$/i.test(h)) h = fallback[v];
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    };
    const ink = rgb('--ink'), paper = rgb('--paper');
    return {
      ink, paper,
      inkA: a => `rgba(${ink},${a})`,
      paperA: a => `rgba(${paper},${a})`,
    };
  }

  function hashInt(x, y, z) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

  // 3D Perlin gradient noise, roughly in [-1, 1]
  // 3D Perlin gradient noise, roughly in [-1, 1]
  const GRAD = [[1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],[1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],[0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1]];
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  function grad(ix, iy, iz, x, y, z) {
    const g = GRAD[hashInt(ix, iy, iz) % 12];
    return g[0] * x + g[1] * y + g[2] * z;
  }
  function perlin(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const u = fade(x), v = fade(y), w = fade(z);
    return lerp(
      lerp(lerp(grad(X, Y, Z, x, y, z),         grad(X + 1, Y, Z, x - 1, y, z), u),
           lerp(grad(X, Y + 1, Z, x, y - 1, z), grad(X + 1, Y + 1, Z, x - 1, y - 1, z), u), v),
      lerp(lerp(grad(X, Y, Z + 1, x, y, z - 1),         grad(X + 1, Y, Z + 1, x - 1, y, z - 1), u),
           lerp(grad(X, Y + 1, Z + 1, x, y - 1, z - 1), grad(X + 1, Y + 1, Z + 1, x - 1, y - 1, z - 1), u), v),
      w);
  }

  function blur(a, cols, rows, passes) {
    let src = a, dst = new Float32Array(a.length);
    for (let p = 0; p < passes; p++) {
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < cols && yy < rows) { sum += src[yy * cols + xx]; n++; }
        }
        dst[y * cols + x] = sum / n;
      }
      [src, dst] = [dst, src];
    }
    return src;
  }

  // Recursive branching tree drawn in black onto a 2D context.
  function drawTree(x, px, py, len, wd, depth, ang = -Math.PI / 2) {
    if (!depth || len < 1.2) return;
    const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
    x.lineWidth = Math.max(0.8, wd);
    x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    const k = Math.random() < 0.3 ? 3 : 2;
    for (let i = 0; i < k; i++) {
      const spread = (i - (k - 1) / 2) * 0.62 + (Math.random() - 0.5) * 0.35;
      drawTree(x, ex, ey, len * (0.66 + Math.random() * 0.12), wd * 0.7, depth - 1, ang + spread);
    }
  }

  function scratch(cols, rows) {
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, cols, rows);
    x.lineCap = 'round';
    return x;
  }

  function darkness(x, cols, rows) {
    const d = x.getImageData(0, 0, cols, rows).data, out = new Float32Array(cols * rows);
    for (let i = 0; i < out.length; i++) out[i] = 1 - d[i * 4] / 255;
    return out;
  }

  // A grand old tree on a low hill: one broad crown, a sapling, grass along the
  // ridge, and a crescent moon. Regrown differently every cycle.
  function groveDensity(cols, rows) {
    const x = scratch(cols, rows), seed = Math.random() * 100;
    const hill = c => rows * 0.9 - rows * 0.16 * Math.exp(-(((c - cols * 0.58) / (cols * 0.3)) ** 2)) - rows * 0.03 * perlin(c * 0.03, 1, seed);
    x.strokeStyle = '#000'; x.lineWidth = 1.3; x.beginPath();
    for (let c = 0; c <= cols; c++) c ? x.lineTo(c, hill(c)) : x.moveTo(c, hill(c));
    x.stroke();
    x.strokeStyle = '#666'; x.lineWidth = 0.8;
    for (let g = 0; g < cols * 0.5; g++) {
      const gx = Math.random() * cols, gy = hill(gx), gh = 1.5 + Math.random() * 3;
      x.beginPath(); x.moveTo(gx, gy); x.lineTo(gx + (Math.random() - 0.5) * 2.5, gy - gh); x.stroke();
    }
    x.strokeStyle = '#000';
    const big = cols * (0.52 + Math.random() * 0.12);
    drawTree(x, big, hill(big) + 1, rows * 0.22, rows * 0.06, 10, -Math.PI / 2 + (Math.random() - 0.5) * 0.08);
    x.strokeStyle = '#555';
    const small = cols * (0.18 + Math.random() * 0.12);
    drawTree(x, small, hill(small) + 1, rows * 0.1, rows * 0.025, 7, -Math.PI / 2 + (Math.random() - 0.5) * 0.15);
    const out = darkness(x, cols, rows);
    out.hill = hill;                                     // so a tiger can walk along it
    return out;
  }

  // Mount Rainier as a line drawing, for birds to land on: the real skyline traced
  // from a photo, a few contour lines following its glaciers and rock, hill ridges
  // with firs, and a small moon. Strokes are dark, everything else empty.
  function rainierLines(cols, rows, img) {
    // fit the photo so the summit sits near the top and the base meets the hills;
    // in assets/viz/rainier.jpg the summit is ~8% down and the hazy base ~64% down
    const x = scratch(cols, rows);
    const ih = img.naturalHeight, iw = img.naturalWidth;
    const scale = (rows * 0.6) / (ih * 0.56), dw = iw * scale, dx = (cols - dw) / 2, dy = rows * 0.06 - ih * 0.08 * scale;
    x.drawImage(img, dx, dy, dw, ih * scale);
    const d = x.getImageData(0, 0, cols, rows).data;

    // skyline: walk down each column following the (slowly changing) sky gradient;
    // the first sharp change is the mountain's edge. Shadowed snow looks like sky in
    // colour, so colour alone can't separate them, but it is always below this line.
    const sky = new Float32Array(cols).fill(rows);
    const at = (c, r) => { const k = (r * cols + c) * 4; return [d[k], d[k + 1], d[k + 2]]; };
    for (let c = Math.max(0, Math.ceil(dx)); c < Math.min(cols, Math.floor(dx + dw)); c++) {
      let run = at(c, Math.max(0, Math.ceil(dy)));
      for (let r = Math.max(1, Math.ceil(dy) + 1); r < rows; r++) {
        const px = at(c, r);
        if (Math.hypot(px[0] - run[0], px[1] - run[1], px[2] - run[2]) > 20) { sky[c] = r; break; }
        run = run.map((v, k) => v * 0.7 + px[k] * 0.3);
      }
    }
    const line = sky.map((_, c) => {                  // median filter removes one-column spikes
      const w = []; for (let k = -3; k <= 3; k++) w.push(sky[Math.min(cols - 1, Math.max(0, c + k))]);
      return w.sort((p, q) => p - q)[3];
    });
    // a mountain only goes down away from its summit: this irons out buildings in the
    // photo and carries the hazy lower flanks (which the scan misses) down to the hills
    let top = 0;
    for (let c = 1; c < cols; c++) if (line[c] < line[top]) top = c;
    for (let c = top - 1; c >= 0; c--) line[c] = Math.min(Math.max(line[c], line[c + 1] - 0.3), line[c + 1] + 0.42);
    for (let c = top + 1; c < cols; c++) line[c] = Math.min(Math.max(line[c], line[c - 1] - 0.3), line[c - 1] + 0.42);
    for (let c = 0; c < cols; c++) line[c] += 1.2 * perlin(c * 0.12, 0.5, 3) * Math.min(1, Math.abs(c - top) / (cols * 0.15));

    // contour lines of the photo's brightness inside the mountain trace its glaciers
    let L = new Float32Array(cols * rows);
    for (let i = 0; i < L.length; i++) L[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
    L = blur(L, cols, rows, 2);
    x.fillStyle = '#fff'; x.fillRect(0, 0, cols, rows);
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.strokeStyle = '#777'; x.lineWidth = 0.7; x.beginPath();
    for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
      if (r < line[c] + 2 || r < line[c + 1] + 2 || c < dx + 2 || c > dx + dw - 3) continue;
      const a = L[r * cols + c], b = L[r * cols + c + 1], cc = L[(r + 1) * cols + c + 1], dd = L[(r + 1) * cols + c];
      for (const lv of [0.52, 0.62, 0.72]) {
        const pts = [];
        if ((a < lv) !== (b < lv)) pts.push(c + (lv - a) / (b - a), r);
        if ((b < lv) !== (cc < lv)) pts.push(c + 1, r + (lv - b) / (cc - b));
        if ((dd < lv) !== (cc < lv)) pts.push(c + (lv - dd) / (cc - dd), r + 1);
        if ((a < lv) !== (dd < lv)) pts.push(c, r + (lv - a) / (dd - a));
        if (pts.length >= 4) { x.moveTo(pts[0], pts[1]); x.lineTo(pts[2], pts[3]); }
      }
    }
    x.stroke();

    // the skyline itself, dark and crisp
    x.strokeStyle = '#000'; x.lineWidth = 2; x.beginPath();
    for (let c = 0; c < cols; c++) c ? x.lineTo(c, line[c]) : x.moveTo(c, line[c]);
    x.stroke();


    // two rows of hills, each hiding what's behind it, with firs along the crest
    const seed = Math.random() * 100;
    const fir = (cx, by, h) => {
      const wd = h * 0.3;
      x.beginPath(); x.moveTo(cx, by - h);
      for (let k = 1; k <= 4; k++) { const t = k / 4; x.lineTo(cx + wd * t, by - h + h * t - 1); x.lineTo(cx + wd * t * 0.5, by - h + h * t); }
      for (let k = 4; k >= 1; k--) { const t = k / 4; x.lineTo(cx - wd * t * 0.5, by - h + h * t); x.lineTo(cx - wd * t, by - h + h * t - 1); }
      x.closePath(); x.fill();
    };
    const hills = (fn, ink, step, minH, maxH, keep) => {
      x.fillStyle = '#fff'; x.beginPath(); x.moveTo(0, rows);
      for (let c = 0; c <= cols; c++) x.lineTo(c, fn(c));
      x.lineTo(cols, rows); x.closePath(); x.fill();
      x.strokeStyle = ink; x.lineWidth = 1.1; x.beginPath();
      for (let c = 0; c <= cols; c++) c ? x.lineTo(c, fn(c)) : x.moveTo(c, fn(c));
      x.stroke();
      x.fillStyle = ink;
      for (let c = 0; c < cols; c += step + Math.random() * step * 2) {
        if (perlin(c * 0.03, keep, seed) > -0.1) fir(c, fn(c) + 1, rows * (minH + Math.random() * (maxH - minH)));
      }
    };
    hills(c => rows * 0.72 - rows * 0.07 * (perlin(c * 0.02, 2, seed) + 0.6 * perlin(c * 0.06, 3, seed) + 0.5), '#555', 3, 0.04, 0.08, 4);
    const near = c => rows * 0.95 - rows * 0.07 * (perlin(c * 0.025, 6, seed) + 0.5 * perlin(c * 0.07, 7, seed) + 0.5);
    hills(near, '#000', 2.5, 0.08, 0.17, 8);
    // two broad-crowned roosting trees in the foreground, one on each side
    x.strokeStyle = '#666';
    const t1 = cols * (0.08 + Math.random() * 0.08), t2 = cols * (0.8 + Math.random() * 0.1);
    drawTree(x, t1, near(t1) + 2, rows * 0.17, rows * 0.04, 8, -Math.PI / 2 + (Math.random() - 0.5) * 0.12);
    drawTree(x, t2, near(t2) + 2, rows * 0.12, rows * 0.03, 7, -Math.PI / 2 + (Math.random() - 0.5) * 0.12);
    return darkness(x, cols, rows);
  }

  function gauss() {
    return Math.sqrt(-2 * Math.log(Math.random() || 1e-9)) * Math.cos(2 * Math.PI * Math.random());
  }

  /* ---------------- the flock that carries dots between scenes ---------------- */

  class Flock {
    constructor({ w, h, colors, count }) {
      this.w = w; this.h = h; this.c = colors; this.t = Math.random() * 100;
      this.n = count || Math.min(900, Math.round(w * h / 180));
      const spread = Math.sqrt(this.n / 900);
      this.px = new Float32Array(this.n); this.py = new Float32Array(this.n);
      this.vx = new Float32Array(this.n); this.vy = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 50 * spread;
        this.px[i] = w / 2 + Math.cos(a) * r * 2; this.py[i] = h / 2 + Math.sin(a) * r * 0.8;
        this.vx[i] = 80 + Math.random() * 10; this.vy[i] = (Math.random() - 0.5) * 20;
      }
      this.R = 22;
      this.bc = Math.ceil(w / this.R); this.br = Math.ceil(h / this.R);
      this.head = new Int32Array(this.bc * this.br); this.next = new Int32Array(this.n);
    }
    step(dt, p) {
      const { n, px, py, vx, vy, R, bc, br, head, next, w, h } = this;
      this.t += dt;
      const t = this.t;
      // a slowly wandering point the whole flock is loosely drawn toward
      const tx = w / 2 + w * 0.32 * Math.sin(t * 0.21) * Math.cos(t * 0.13);
      const ty = h * (this.yc ?? 0.5) + h * 0.15 * Math.sin(t * 0.37 + 1);
      head.fill(-1);
      for (let i = 0; i < n; i++) {
        const b = Math.min(br - 1, Math.max(0, py[i] / R | 0)) * bc + Math.min(bc - 1, Math.max(0, px[i] / R | 0));
        next[i] = head[b]; head[b] = i;
      }
      for (let i = 0; i < n; i++) {
        const x = px[i], y = py[i];
        const cx0 = Math.min(bc - 1, Math.max(0, x / R | 0)), cy0 = Math.min(br - 1, Math.max(0, y / R | 0));
        let cnt = 0, sx = 0, sy = 0, avx = 0, avy = 0, sepx = 0, sepy = 0;
        for (let by = Math.max(0, cy0 - 1); by <= Math.min(br - 1, cy0 + 1); by++) {
          for (let bx = Math.max(0, cx0 - 1); bx <= Math.min(bc - 1, cx0 + 1); bx++) {
            for (let j = head[by * bc + bx]; j !== -1; j = next[j]) {
              if (j === i) continue;
              const dx = px[j] - x, dy = py[j] - y, d2 = dx * dx + dy * dy;
              if (d2 > R * R) continue;
              cnt++; sx += px[j]; sy += py[j]; avx += vx[j]; avy += vy[j];
              if (d2 < 36) { const d = Math.sqrt(d2) || 0.01; sepx -= dx / d * (6 - d); sepy -= dy / d * (6 - d); }
            }
          }
        }
        let axc = 0, ayc = 0;
        if (cnt) {
          axc += (avx / cnt - vx[i]) * 2.5 + (sx / cnt - x) * 2.5;
          ayc += (avy / cnt - vy[i]) * 2.5 + (sy / cnt - y) * 2.5;
        }
        axc += sepx * 60 + (tx - x) * 0.5;
        ayc += sepy * 60 + (ty - y) * 1.2;
        const m = 30;
        if (x < m) axc += (m - x) * 20; else if (x > w - m) axc -= (x - w + m) * 20;
        if (y < m) ayc += (m - y) * 20; else if (y > h - m) ayc -= (y - h + m) * 20;
        if (p.active) {
          const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 75 * 75) { const d = Math.sqrt(d2) || 1, k = (1 - d / 75) * 1400; axc += dx / d * k; ayc += dy / d * k; }
        }
        let nvx = vx[i] + axc * dt, nvy = vy[i] + ayc * dt;
        const sp = Math.hypot(nvx, nvy) || 1, cl = Math.min(95, Math.max(45, sp)) / sp;
        vx[i] = nvx * cl; vy[i] = nvy * cl;
      }
      for (let i = 0; i < n; i++) { px[i] += vx[i] * dt; py[i] += vy[i] * dt; }
    }
  }

  /* ---------------- shapes as dots ---------------- */

  // Points sampled from an emoji silhouette: filled body (darker parts denser) plus
  // a crisp outline, so each creature is recognizable as dots.
  // Points sampled from anything painted onto a W×H canvas: filled parts (darker =
  // denser) plus a crisp outline, so the shape reads as dots. Centred on (0, 0).
  function shapePoints(n, W, H, paint, { flip = false, order = 'angle' } = {}) {
    W = Math.ceil(W); H = Math.ceil(H);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d', { willReadFrequently: true });
    if (flip) { x.translate(W, 0); x.scale(-1, 1); }
    x.lineCap = 'round'; x.lineJoin = 'round';
    paint(x, W, H);
    const d = x.getImageData(0, 0, W, H).data, wt = new Float32Array(W * H);
    let total = 0;
    for (let y = 1; y < H - 1; y++) for (let i = 1; i < W - 1; i++) {
      const k = y * W + i, a = d[k * 4 + 3] / 255;
      if (a < 0.5) continue;
      const lum = (0.299 * d[k * 4] + 0.587 * d[k * 4 + 1] + 0.114 * d[k * 4 + 2]) / 255;
      const edge = d[(k - 1) * 4 + 3] < 128 || d[(k + 1) * 4 + 3] < 128 || d[(k - W) * 4 + 3] < 128 || d[(k + W) * 4 + 3] < 128;
      wt[k] = edge ? 3 : 0.08 + 0.9 * (1 - lum) ** 2.5;
      total += wt[k];
    }
    if (total < 1) return null;                          // nothing drawn (e.g. no emoji font)
    const cdf = new Float64Array(wt.length);
    let acc = 0;
    for (let k = 0; k < wt.length; k++) cdf[k] = acc += wt[k];
    const pts = new Float32Array(n * 2);
    for (let j = 0; j < n; j++) {
      const u = Math.random() * acc;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      pts[j * 2] = (lo % W) + Math.random() - W / 2;
      pts[j * 2 + 1] = ((lo / W) | 0) + Math.random() - H / 2;
    }
    // order points (by angle around the centre, or left to right) so shapes flow into each other
    const key = order === 'x' ? k => pts[k * 2] : k => Math.atan2(pts[k * 2 + 1], pts[k * 2]);
    const idx = [...Array(n).keys()].sort((a, b) => key(a) - key(b));
    const out = new Float32Array(n * 2);
    idx.forEach((k, j) => { out[j * 2] = pts[k * 2]; out[j * 2 + 1] = pts[k * 2 + 1]; });
    return out;
  }

  function emojiPoints(emoji, n, cx, cy, size, opts) {
    const S = size * 1.3;
    const pts = shapePoints(n, S, S, x => {
      x.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(emoji, S / 2, S / 2);
    }, opts);
    if (pts) for (let j = 0; j < n; j++) { pts[j * 2] += cx; pts[j * 2 + 1] += cy; }
    return pts;
  }

  const ink = (x, lw) => { x.strokeStyle = x.fillStyle = '#000'; x.lineWidth = lw; };
  const box = (x, l, t, w, h, r) => { x.beginPath(); x.roundRect(l, t, w, h, r); x.stroke(); };
  const seg = (x, a, b, c, d) => { x.beginPath(); x.moveTo(a, b); x.lineTo(c, d); x.stroke(); };
  const dot = (x, a, b, r) => { x.beginPath(); x.arc(a, b, r, 0, Math.PI * 2); x.fill(); };

  const MACHINES = {
    robot(x, W, H) {                                    // a friendly humanoid
      const s = H / 1.3, c = W / 2, m = H / 2; ink(x, s * 0.06);
      box(x, c - 0.13 * s, m - 0.44 * s, 0.26 * s, 0.19 * s, 0.05 * s);
      x.fillRect(c - 0.08 * s, m - 0.37 * s, 0.16 * s, 0.04 * s);
      seg(x, c, m - 0.44 * s, c, m - 0.51 * s); dot(x, c, m - 0.52 * s, 0.03 * s);
      box(x, c - 0.15 * s, m - 0.21 * s, 0.3 * s, 0.31 * s, 0.04 * s);
      dot(x, c, m - 0.08 * s, 0.035 * s);
      seg(x, c - 0.15 * s, m - 0.17 * s, c - 0.24 * s, m + 0.06 * s);
      seg(x, c + 0.15 * s, m - 0.17 * s, c + 0.24 * s, m + 0.06 * s);
      seg(x, c - 0.07 * s, m + 0.1 * s, c - 0.08 * s, m + 0.45 * s);
      seg(x, c + 0.07 * s, m + 0.1 * s, c + 0.08 * s, m + 0.45 * s);
    },
    pod(x, W, H) {                                      // a flying car with a bubble canopy, nose right
      ink(x, H * 0.07);
      box(x, W * 0.05, H * 0.45, W * 0.9, H * 0.32, H * 0.16);
      x.beginPath(); x.ellipse(W * 0.48, H * 0.45, W * 0.22, H * 0.28, 0, Math.PI, 0); x.stroke();
      dot(x, W * 0.88, H * 0.6, H * 0.06);
      seg(x, W * 0.2, H * 0.82, W * 0.32, H * 0.95); seg(x, W * 0.62, H * 0.82, W * 0.74, H * 0.95);
    },
    rocket(x, W, H) {                                   // pointing up
      ink(x, W * 0.07);
      x.beginPath(); x.moveTo(W * 0.35, H * 0.86); x.lineTo(W * 0.35, H * 0.24);
      x.quadraticCurveTo(W * 0.5, H * 0.0, W * 0.65, H * 0.24); x.lineTo(W * 0.65, H * 0.86); x.closePath(); x.stroke();
      x.beginPath(); x.moveTo(W * 0.35, H * 0.62); x.lineTo(W * 0.12, H * 0.9); x.lineTo(W * 0.35, H * 0.84); x.fill();
      x.beginPath(); x.moveTo(W * 0.65, H * 0.62); x.lineTo(W * 0.88, H * 0.9); x.lineTo(W * 0.65, H * 0.84); x.fill();
      x.beginPath(); x.arc(W * 0.5, H * 0.36, W * 0.08, 0, Math.PI * 2); x.stroke();
      seg(x, W * 0.35, H * 0.52, W * 0.65, H * 0.52);
      x.fillRect(W * 0.4, H * 0.86, W * 0.2, H * 0.06);
    },
    sun(x, W) {                                         // a disc with eight rays
      ink(x, W * 0.06);
      x.beginPath(); x.arc(W / 2, W / 2, W * 0.24, 0, Math.PI * 2); x.stroke();
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; seg(x, W / 2 + Math.cos(a) * W * 0.34, W / 2 + Math.sin(a) * W * 0.34, W / 2 + Math.cos(a) * W * 0.46, W / 2 + Math.sin(a) * W * 0.46); }
    },
    moon(x, W) {                                        // a crescent: a disc with an offset disc cut out
      ink(x, 1);
      x.beginPath(); x.arc(W / 2, W / 2, W * 0.3, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'destination-out';
      x.beginPath(); x.arc(W / 2 + W * 0.14, W / 2 - W * 0.06, W * 0.27, 0, Math.PI * 2); x.fill();
      x.globalCompositeOperation = 'source-over';
    },
  };

  /* ---------------- scenes ---------------- */

  // n points (CSS px) drawn from a density grid, sorted left to right
  function densityPoints(dens, gc, gr, w, h, n) {
    const cdf = new Float64Array(dens.length);
    let total = 0;
    for (let i = 0; i < dens.length; i++) cdf[i] = total += Math.min(1, dens[i]);
    const xs = new Float32Array(n), ys = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const u = Math.random() * total;
      let lo = 0, hi = cdf.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
      xs[j] = (lo % gc + Math.random()) / gc * w; ys[j] = ((lo / gc | 0) + Math.random()) / gr * h;
    }
    const idx = [...Array(n).keys()].sort((a, b) => xs[a] - xs[b]);
    const out = new Float32Array(n * 2);
    idx.forEach((k, j) => { out[j * 2] = xs[k]; out[j * 2 + 1] = ys[k]; });
    return out;
  }

  // A line of walkers, entering on the left and leaving on the right forever.
  // kinds: [{ emoji } | { paint, aspect, rigid }, size ratio]; ground(x) gives the
  // ground's y in CSS px. Returns { count, at(j, t) }.
  function parade(kinds, { n, base, speed, w, lead0, ground }) {
    const area = kinds.reduce((a, [, r]) => a + r * r, 0), walkers = [];
    let back = 0;
    for (const [kind, r] of kinds) {
      const size = base * r, count = Math.max(45, Math.round(n * r * r / area));
      const wide = kind.paint ? size * (kind.aspect || 1) : size;
      const pts = kind.paint
        ? shapePoints(count, wide * 1.3, size * 1.3, kind.paint, { order: 'x' })
        : emojiPoints(kind.emoji, count, 0, 0, size, { flip: true, order: 'x' });
      if (!pts) continue;
      if (walkers.length) back += (walkers[walkers.length - 1].wide + wide) * 0.5 + (r < 0.45 ? 1 : 8);
      walkers.push({ pts, size, wide, count, back, rigid: !!kind.rigid, foot: kind.paint ? 0.45 : 0.32, phase: Math.random() * 6 });
    }
    const total = walkers.reduce((a, b) => a + b.count, 0);
    const who = new Uint8Array(total), local = new Uint16Array(total);
    let i = 0;
    walkers.forEach((a, k) => { for (let j = 0; j < a.count; j++, i++) { who[i] = k; local[i] = j; } });
    // the line wraps around: whoever walks off the right comes back in on the left. The
    // loop must be longer than the screen plus a walker on each side, so stretch gaps if needed.
    const big = Math.max(0, ...walkers.map(a => a.wide)), last = walkers[walkers.length - 1];
    let loop = last ? last.back + (last.wide + walkers[0].wide) * 0.5 + 8 : 1;
    if (loop < w + 2 * big) { const extra = (w + 2 * big - loop) / walkers.length; walkers.forEach((a, k) => { a.back += extra * k; }); loop = w + 2 * big; }
    return {
      count: total,
      at(j, t) {
        const a = walkers[who[j]], l = local[j], s = a.size, tt = t + a.phase;
        const run = lead0 + t * speed - a.back + big;
        const cx = ((run % loop) + loop) % loop - big, cy = ground(Math.min(w, Math.max(0, cx))) - s * a.foot;
        const tx = a.pts[l * 2], ty = a.pts[l * 2 + 1];
        if (a.rigid) return [cx + tx, cy + ty + Math.sin(tt * 9) * 0.4];
        const legs = ty > s * 0.12 ? Math.sin(tt * 6 + (tx > 0 ? 0 : Math.PI)) * s * 0.05 * Math.min(1, (ty - s * 0.12) / (s * 0.25)) : 0;
        return [cx + tx + legs, cy + ty - Math.abs(Math.sin(tt * 3)) * s * 0.02];
      },
    };
  }

  // Combine several movers ({ count, at(j, t) }) into one.
  function movers(list) {
    list = list.filter(m => m && m.count);
    const count = list.reduce((a, m) => a + m.count, 0);
    return { count, at(j, t) { for (const m of list) { if (j < m.count) return m.at(j, t); j -= m.count; } return [0, 0]; } };
  }

  // A shape that glides along a path: path(t) → [x, y].
  function glider(pts, count, path) {
    return pts && { count, at(j, t) { const [cx, cy] = path(t); return [cx + pts[j * 2], cy + pts[j * 2 + 1]]; } };
  }

  const smooth = q => q * q * (3 - 2 * q);

  class Journey {
    constructor({ w, h, colors, image, scenes }) {
      this.w = w; this.h = h; this.c = colors;
      this.n = Math.min(5200, Math.round(w * h / 29));
      this.gc = Math.max(8, w / 2 | 0); this.gr = Math.max(8, h / 2 | 0);
      this.image = image;
      this.names = (scenes || 'rainier,grove').split(',').map(t => t.trim());
      const A = () => new Float32Array(this.n);
      this.x = A(); this.y = A(); this.px = A(); this.py = A();
      this.ox = A(); this.oy = A(); this.vx = A(); this.vy = A();
      this.jit = A().map(() => Math.random() * Math.PI * 2);
      // between scenes the dots fly as a murmuration: a normal-size flock, with every
      // dot in loose formation around one of its birds
      this.flock = new Flock({ w, h, colors });
      this.flock.yc = 0.4;
      this.lead = new Uint16Array(this.n); this.fx = A(); this.fy = A();
      for (let i = 0; i < this.n; i++) { this.lead[i] = i % this.flock.n; this.fx[i] = gauss() * 8; this.fy[i] = gauss() * 5; }
      for (let i = 0; i < this.n; i++) [this.x[i], this.y[i]] = this.flockAt(i);
      this.from = new Float32Array(this.n * 2);
      this.nightness = this.isNight() ? 1 : 0;
      // open mid-flight, then land on the first scene
      this.idx = -1; this.next();
      this.phase = 'fly'; this.t = 1.5; this.st = 0;
    }
    flockAt(i) { const j = this.lead[i]; return [this.flock.px[j] + this.fx[i], this.flock.py[j] + this.fy[i]]; }

    // build the next scene that can be built; a scene is { target, movers, hold }
    next() {
      for (let tries = 0; tries < this.names.length; tries++) {
        this.idx = (this.idx + 1) % this.names.length;
        const scene = this.build(this.names[this.idx]);
        if (scene) { this.scene = scene; return; }
      }
      this.scene = { target: densityPoints(groveDensity(this.gc, this.gr), this.gc, this.gr, this.w, this.h, this.n), movers: { count: 0 }, hold: 6 };
    }
    // the sun by day, the moon by night: one set of dots that morphs when the theme changes
    sky(cx, cy, size) {
      const cnt = Math.round(this.n * 0.025), S = size * 2.2;
      const sun = shapePoints(cnt, S, S, MACHINES.sun), moon = shapePoints(cnt, S, S, MACHINES.moon);
      if (!sun || !moon) return null;
      return { count: cnt, at: j => {
        const b = this.nightness;
        return [cx + sun[j * 2] + (moon[j * 2] - sun[j * 2]) * b, cy + sun[j * 2 + 1] + (moon[j * 2 + 1] - sun[j * 2 + 1]) * b];
      } };
    }
    isNight() { const [r, g, b] = this.c.paper; return 0.299 * r + 0.587 * g + 0.114 * b < 128; }
    // static part of a scene: n - movers points drawn from a density grid
    still(dens, m) { return densityPoints(dens, this.gc, this.gr, this.w, this.h, this.n - m.count); }
    // a scratch canvas in CSS px (drawn at half resolution)
    sketch() { const x = scratch(this.gc, this.gr); x.setTransform(this.gc / this.w, 0, 0, this.gr / this.h, 0, 0); x.lineCap = x.lineJoin = 'round'; return x; }

    build(name) {
      const { w, h, gc, gr, n } = this;
      if (name === 'rainier') {
        if (!this.image) return null;
        let dens; try { dens = rainierLines(gc, gr, this.image); } catch (e) { return null; }   // tainted canvas
        const m = movers([this.sky(w * 0.9, h * 0.18, h * 0.12)]);
        return { target: this.still(dens, m), movers: m, hold: 3.5 };
      }
      if (name === 'grove') {
        const g = groveDensity(gc, gr), hill = cx => g.hill(cx / w * gc) / gr * h;
        const m = parade([[{ emoji: '🐘' }, 1.2], [{ emoji: '🐘' }, 0.6], [{ emoji: '🦙' }, 0.95], [{ emoji: '🐅' }, 0.9],
          [{ emoji: '🦌' }, 0.9], [{ emoji: '🦘' }, 0.85], [{ emoji: '🐖' }, 0.7], [{ emoji: '🐑' }, 0.72], [{ emoji: '🦫' }, 0.6],
          [{ emoji: '🐢' }, 0.55], [{ emoji: '🦔' }, 0.5], [{ emoji: '🐈' }, 0.6], [{ emoji: '🐕' }, 0.65], [{ emoji: '🐇' }, 0.5],
          [{ emoji: '🦤' }, 0.6], [{ emoji: '🦩' }, 0.85], [{ emoji: '🦆' }, 0.55], [{ emoji: '🦆' }, 0.38], [{ emoji: '🦆' }, 0.38]],
          { n: n * 0.45, base: Math.min(h * 0.28, w / 11), speed: 50, w, lead0: w * 0.72, ground: hill });
        const all = movers([m, this.sky(w * 0.88, h * 0.2, h * 0.13)]);
        return { target: this.still(g, all), movers: all, hold: 7 };
      }
      if (name === 'city') return this.city();
      if (name === 'workshop') return this.workshop();
      return null;
    }

    // A future city: a skyline of bold, distinct towers (filled lightly so they read as
    // solid buildings), flying cars above the rooftops, a rocket launching from its tower,
    // and a giant mech striding down the street.
    city() {
      const { w, h, n } = this, G = h * 0.93;
      const x = this.sketch(), gray = v => { const c = Math.round(255 * (1 - v)); return `rgb(${c},${c},${c})`; };
      const body = path => { x.fillStyle = gray(0.22); x.strokeStyle = '#000'; x.lineWidth = 2.6; x.beginPath(); path(); x.fill(); x.stroke(); };
      const TYPES = {
        spire(l, bw, top) { body(() => { x.rect(l, top, bw, G - top); }); body(() => { x.moveTo(l + bw * 0.3, top); x.lineTo(l + bw / 2, top - h * 0.16); x.lineTo(l + bw * 0.7, top); }); },
        dome(l, bw, top) { body(() => { x.moveTo(l, G); x.lineTo(l, top + bw / 2); x.arc(l + bw / 2, top + bw / 2, bw / 2, Math.PI, 0); x.lineTo(l + bw, G); x.closePath(); }); },
        steps(l, bw, top) { body(() => { x.moveTo(l, G); x.lineTo(l, top + 30); x.lineTo(l + bw * 0.15, top + 30); x.lineTo(l + bw * 0.15, top + 15); x.lineTo(l + bw * 0.3, top + 15);
          x.lineTo(l + bw * 0.3, top); x.lineTo(l + bw * 0.7, top); x.lineTo(l + bw * 0.7, top + 15); x.lineTo(l + bw * 0.85, top + 15); x.lineTo(l + bw * 0.85, top + 30); x.lineTo(l + bw, top + 30); x.lineTo(l + bw, G); x.closePath(); }); },
        slant(l, bw, top) { body(() => { x.moveTo(l, G); x.lineTo(l, top + 28); x.lineTo(l + bw, top); x.lineTo(l + bw, G); x.closePath(); }); },
        twin(l, bw, top) {
          const tw = bw * 0.38;
          body(() => { x.rect(l, top, tw, G - top); }); body(() => { x.rect(l + bw - tw, top + 12, tw, G - top - 12); });
          x.lineWidth = 5; x.strokeStyle = '#000'; seg(x, l + tw, top + 40, l + bw - tw, top + 40);
        },
        ring(l, bw, top) {
          const cx = l + bw / 2, r = bw * 0.42;
          body(() => { x.rect(cx - 6, top + r, 12, G - top - r); });
          x.strokeStyle = '#000'; x.lineWidth = 4; x.beginPath(); x.arc(cx, top + r * 0.4, r, 0, Math.PI * 2); x.stroke();
          x.lineWidth = 2; x.beginPath(); x.ellipse(cx, top + r * 0.4, r, r * 0.28, 0, 0, Math.PI * 2); x.stroke();
        },
        saucer(l, bw, top) {
          const cx = l + bw / 2;
          body(() => { x.rect(cx - bw * 0.16, top + 10, bw * 0.32, G - top - 10); });
          body(() => { x.ellipse(cx, top + 10, bw / 2, 9, 0, 0, Math.PI * 2); });
          x.lineWidth = 2; seg(x, cx, top + 1, cx, top - 18);
        },
      };
      // shuffle the kinds and lay them out left to right, leaving the right edge for the rocket
      const kinds = Object.keys(TYPES).sort(() => Math.random() - 0.5);
      let l = w * 0.01, k = 0;
      while (l < w * 0.8) {
        const kind = kinds[k++ % kinds.length], bw = kind === 'twin' ? 80 : 46 + Math.random() * 30;
        const top = h * (kind === 'spire' || kind === 'ring' ? 0.3 + Math.random() * 0.08 : 0.32 + Math.random() * 0.24);
        TYPES[kind](l, bw, top);
        l += bw + 10 + Math.random() * 18;
      }
      // launch tower on the right
      const lx = w * 0.9, tw = h * 0.08;
      x.strokeStyle = '#000'; x.lineWidth = 2;
      seg(x, lx + tw, G, lx + tw, h * 0.26); seg(x, lx + tw + 12, G, lx + tw + 12, h * 0.26);
      for (let y = G; y > h * 0.28; y -= 13) { seg(x, lx + tw, y, lx + tw + 12, y - 13); seg(x, lx + tw + 12, y, lx + tw, y - 13); }
      x.lineWidth = 2.6; seg(x, 0, G, w, G);

      // flying cars: two lanes above the rooftops and one weaving between the towers
      const podW = h * 0.18, podH = h * 0.085, lanes = [0.07, 0.17, 0.42];
      const pods = [...Array(7)].map((_, k) => {
        const lane = lanes[k % 3], dir = k % 2 ? -1 : 1, v = 55 + (k * 37) % 50, off = k * w * 0.31;
        const cnt = Math.round(n * 0.013);
        return glider(shapePoints(cnt, podW, podH, MACHINES.pod, { flip: dir < 0 }), cnt, t => {
          const u = ((t * v + off) % (w + 3 * podW)) - 1.5 * podW;
          return [dir > 0 ? u : w - u, h * lane + Math.sin(t * 2 + k) * 2];
        });
      });
      // the rocket: sits on the pad, then lifts off a few seconds after the scene lands
      const rW = h * 0.13, rH = h * 0.44, rN = Math.round(n * 0.05), rx0 = lx + tw / 2 - 4;
      const lift = t => { const q = Math.max(0, (t - 7) / 6); return q * q * h * 1.6; };
      const rocket = glider(shapePoints(rN, rW, rH, MACHINES.rocket), rN, t => [rx0, G - rH * 0.45 - lift(t)]);
      const fireN = Math.round(n * 0.025);
      const fire = { count: fireN, at(j, t) {
        const q = Math.max(0, Math.min(1, (t - 6) / 1.5)), ny = G - rH * 0.05 - lift(t);
        if (q <= 0) return [rx0 + (Math.random() - 0.5) * 4, G - 2 - Math.random() * 3];       // idle vapour
        return [rx0 + gauss() * (2 + 4 * q), ny + Math.random() * (8 + 40 * q)];
      } };
      // a giant mech walking through town
      const mech = parade([[{ paint: MACHINES.robot }, 1]], { n: n * 0.06, base: h * 0.42, speed: 24, w, lead0: w * 0.2, ground: () => G });
      const m = movers([mech, rocket, fire, ...pods]);
      return { target: this.still(darkness(x, this.gc, this.gr), m), movers: m, hold: 9 };
    }

    // An assembly line: boxes ride a long conveyor under a gantry; two ceiling-mounted
    // arms weld each box as it passes (sparks!), and a third hands finished boxes to a person.
    workshop() {
      const { w, h, n } = this, G = h * 0.93, R = h * 0.07;
      const beltY = G - h * 0.24, beltL = 0, beltR = w * 0.78, C = h * 0.1, F = h * 0.08, v = 22;
      const x = this.sketch();
      x.strokeStyle = '#000'; x.lineWidth = 2.4; seg(x, 0, G, w, G);
      x.lineWidth = 2.6; seg(x, w * 0.04, R, w * 0.97, R);                        // gantry rail
      x.lineWidth = 1.4; seg(x, w * 0.04, R, w * 0.04, G); seg(x, w * 0.97, R, w * 0.97, G);
      x.lineWidth = 1.8; seg(x, beltL, beltY, beltR, beltY); seg(x, beltL, beltY + h * 0.05, beltR, beltY + h * 0.05);
      for (const bx of [beltL, beltR]) { x.beginPath(); x.arc(bx, beltY + h * 0.025, h * 0.025, 0, Math.PI * 2); x.stroke(); }
      x.lineWidth = 1.4; for (let bx = beltL + 20; bx < beltR; bx += 90) seg(x, bx, beltY + h * 0.05, bx, G);
      const shoulders = [w * 0.24, w * 0.5, w * 0.84];
      for (const sx of shoulders) { x.fillStyle = '#000'; x.fillRect(sx - 9, R - 4, 18, 9); }
      x.strokeStyle = '#999'; x.lineWidth = 1.2;                                  // a control screen on the wall
      x.strokeRect(w * 0.88, h * 0.3, h * 0.16, h * 0.11); seg(x, w * 0.88 + 4, h * 0.38, w * 0.88 + h * 0.06, h * 0.33);

      // boxes enter from off the left edge and ride to the pick-up spot at the belt's end, where
      // the hand-off arm takes each one at the moment it arrives (one every P seconds)
      const pickX = beltR - 6, start = -C, nBoxes = 6, gap0 = (pickX - start) / nBoxes, P = gap0 / v;
      const boxX = (k, t) => start + ((t * v + k * gap0) % (pickX - start));
      const square = (u, cx, cy) => {
        const side = (u * 4) | 0, f = u * 4 - side, e = [[f, 0], [1, f], [1 - f, 1], [0, 1 - f]][side];
        return [cx - C / 2 + e[0] * C, cy - C / 2 + e[1] * C];
      };

      // arms: two links hanging from the rail, solved for their wrist (tip) each frame
      const L1 = h * 0.4, L2 = h * 0.38;
      const arms = shoulders.map((sx, k) => ({ S: [sx, R + 4], tip: [sx, beltY - C - 40], E: [sx, R + L1], W: [sx, beltY - C - 40],
        weld: k < 2, sparking: false, grip: C * 0.8, cube: null }));
      const solve = a => {
        const dx = a.tip[0] - a.S[0], dy = a.tip[1] - a.S[1], d = Math.min(L1 + L2 - 1, Math.hypot(dx, dy));
        const th = Math.atan2(dy, dx), al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
        const e1 = [a.S[0] + L1 * Math.cos(th - al), a.S[1] + L1 * Math.sin(th - al)], e2 = [a.S[0] + L1 * Math.cos(th + al), a.S[1] + L1 * Math.sin(th + al)];
        // elbow out to the left for the first arm, to the right for the others: they read as a team
        a.E = (a.S[0] < w * 0.3 ? e1[0] < e2[0] : e1[0] > e2[0]) ? e1 : e2;
        a.W = [a.S[0] + d * Math.cos(th), a.S[1] + d * Math.sin(th)];
      };
      // the hand-off arm's script: pick at the belt's end, hand to the person, back up
      const A = [pickX, beltY - C / 2], B = [w * 0.93, G - h * 0.3];
      const keys = [[0, [shoulders[2], h * 0.45]], [0.18, [A[0], A[1] - h * 0.18]], [0.3, [A[0], A[1] - F * 0.7]], [0.38, [A[0], A[1] - F * 0.7]],
        [0.55, [A[0] + 10, A[1] - h * 0.25]], [0.75, [B[0] - 12, B[1] - F * 0.7]], [0.86, [B[0] - 12, B[1] - F * 0.7]], [1, [shoulders[2], h * 0.45]]];
      const update = (dt, t) => {
        const tau = Math.max(0, t - 5);
        for (const a of arms) {
          let target;
          if (a.weld) {
            // follow the nearest box passing underneath, and weld it
            let best = null;
            for (let k = 0; k < nBoxes; k++) { const bx = boxX(k, t); if (Math.abs(bx - a.S[0]) < 34 && (!best || Math.abs(bx - a.S[0]) < Math.abs(best - a.S[0]))) best = bx; }
            a.sparking = best !== null && tau > 0;
            target = a.sparking ? [best + Math.sin(t * 9) * 3, beltY - C - 3] : [a.S[0], beltY - C - 38];
            a.tip[0] += (target[0] - a.tip[0]) * Math.min(1, dt * 7); a.tip[1] += (target[1] - a.tip[1]) * Math.min(1, dt * 7);
          } else {
            const u = ((t / P + 0.38) % 1);                // u = 0.38 exactly when a box reaches the end
            let k = 0; while (k < keys.length - 2 && u > keys[k + 1][0]) k++;
            const [u0, p0] = keys[k], [u1, p1] = keys[k + 1], q = smooth(Math.min(1, (u - u0) / (u1 - u0 || 1)));
            a.tip = [p0[0] + (p1[0] - p0[0]) * q, p0[1] + (p1[1] - p0[1]) * q];
            const holding = u > 0.38 && u < 0.86;
            a.grip = holding ? C / 2 : C * 0.8;
            // after the hand-off the box is carried off to the right, out of the picture
            a.cube = u < 0.38 ? [w + C * 2, B[1]] : holding ? [a.W[0], a.W[1] + F * 0.7]
              : [B[0] - 12 + (w + C * 2 - B[0] + 12) * smooth(Math.min(1, (u - 0.88) / 0.12)) * (u > 0.88), B[1]];
          }
          solve(a);
        }
      };
      update(0, 0);

      const armDots = Math.round(n * 0.055);
      const us = Float32Array.from({ length: armDots }, () => Math.random()), vs = Float32Array.from({ length: armDots }, () => Math.random() * 2 - 1);
      const along = (a, b, u, vv, thick) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [a[0] + dx * u - dy / L * vv * thick, a[1] + dy * u + dx / L * vv * thick]; };
      const armMover = a => ({ count: armDots, at(j) {
        const u = us[j], vv = vs[j], f = j / armDots;
        if (f < 0.4) return along(a.S, a.E, u, vv, 2.4);
        if (f < 0.72) return along(a.E, a.W, u, vv, 2);
        if (f < 0.8) return [a.S[0] + Math.cos(u * 7) * 5, a.S[1] + Math.sin(u * 7) * 5];
        if (f < 0.86) return [a.E[0] + Math.cos(u * 7) * 4, a.E[1] + Math.sin(u * 7) * 4];
        if (a.weld) return [a.W[0] + vv * (1 - u) * 3, a.W[1] + u * 9];              // the torch: a short cone
        if (f < 0.9) return [a.W[0] + (u * 2 - 1) * a.grip, a.W[1]];
        return [a.W[0] + (vv < 0 ? -a.grip : a.grip), a.W[1] + u * F];               // two fingers
      } });
      const sparkN = Math.round(n * 0.012);
      const sparks = a => ({ count: sparkN, at() {
        if (!a.sparking) return [a.W[0], a.W[1] + 8];
        const ang = -Math.PI * Math.random(), r = Math.random() ** 0.5 * 14;
        return [a.W[0] + Math.cos(ang) * r, a.W[1] + 10 + Math.sin(ang) * r * 0.7 + Math.random() * 6];
      } });
      const boxN = Math.round(n * 0.012) * nBoxes;
      const boxes = { count: boxN, at(j, t) { const k = j % nBoxes, u = ((j / nBoxes) | 0) / (boxN / nBoxes); return square(u, boxX(k, t), beltY - C / 2); } };
      const cubeN = Math.round(n * 0.014), handoff = arms[2];
      const cube = { count: cubeN, at(j) { return square(j / cubeN, handoff.cube[0], handoff.cube[1]); } };
      const personN = Math.round(n * 0.07);
      const person = glider(emojiPoints('🧍', personN, 0, 0, h * 0.5), personN, t => [w * 0.95, G - h * 0.5 * 0.36 + Math.sin(t * 1.2) * 0.5]);
      const m = movers([...arms.map(armMover), ...arms.slice(0, 2).map(sparks), boxes, cube, person]);
      return { target: this.still(darkness(x, this.gc, this.gr), m), movers: m, hold: 9, update };
    }

    settle() { this.phase = 'hold'; this.t = 0; this.st = 6; }
    // the scene's moving parts take the last dots; everything else holds still (breathing)
    targetAt(i) {
      const m = this.scene.movers, still = this.n - m.count;
      if (i < still) return [this.scene.target[i * 2] + Math.sin(this.st * 1.3 + this.jit[i]) * 0.3, this.scene.target[i * 2 + 1] + Math.cos(this.st * 1.1 + this.jit[i]) * 0.3];
      return m.at(i - still, this.st);
    }
    step(dt, p) {
      const TAKEOFF = 3, FLY = 2.5, LAND = 5, HOLD = this.scene.hold;
      this.t += dt; this.age = (this.age || 0) + dt;
      if (this.phase === 'land' || this.phase === 'hold') this.st += dt;
      this.flock.step(dt, p);
      if (this.scene.update) this.scene.update(dt, this.st);   // e.g. robot arms solving their poses
      this.nightness += ((this.isNight() ? 1 : 0) - this.nightness) * Math.min(1, dt * 2.5);
      const { n } = this;
      if (this.phase === 'hold' && this.t > HOLD) {
        this.from = Float32Array.from({ length: n * 2 }, (_, j) => j % 2 ? this.y[j >> 1] : this.x[j >> 1]);
        this.phase = 'takeoff'; this.t = 0;
      } else if (this.phase === 'takeoff' && this.t > TAKEOFF) { this.phase = 'fly'; this.t = 0; this.next(); this.st = 0; }
      else if (this.phase === 'fly' && this.t > FLY) { this.phase = 'land'; this.t = 0; }
      else if (this.phase === 'land' && this.t > LAND) { this.phase = 'hold'; this.t = 0; }
      // takeoff eases in (a slow lift); landing eases out (a long, gentle settle)
      const easeIn = q => q * q * (3 - 2 * q) * q, easeOut = q => 1 - (1 - q) ** 4;
      for (let i = 0; i < n; i++) {
        let nx, ny;
        // left side takes off first and lands first; each dot gets most of the phase to travel
        const lag = (i / n) * 0.5 + this.jit[i] / (Math.PI * 2) * 0.1;
        if (this.phase === 'fly') [nx, ny] = this.flockAt(i);
        else if (this.phase === 'takeoff') {
          const q = easeIn(Math.min(1, Math.max(0, (this.t / TAKEOFF - lag) / 0.4)));
          const [bx, by] = this.flockAt(i), ax = this.from[i * 2], ay = this.from[i * 2 + 1];
          nx = ax + (bx - ax) * q; ny = ay + (by - ay) * q;
        } else {
          [nx, ny] = this.targetAt(i);
          if (this.phase === 'land') {
            const q = easeOut(Math.min(1, Math.max(0, (this.t / LAND - lag) / 0.4)));
            const [ax, ay] = this.flockAt(i);
            nx = ax + (nx - ax) * q; ny = ay + (ny - ay) * q;
          }
        }
        if (p.active) {
          const ex = this.x[i] - p.x, ey = this.y[i] - p.y, d2 = ex * ex + ey * ey;
          if (d2 < 3600) { const d = Math.sqrt(d2) || 1, k = (1 - d / 60) * 2600 * dt; this.vx[i] += ex / d * k; this.vy[i] += ey / d * k; }
        }
        this.vx[i] += (-this.ox[i] * 9 - this.vx[i] * 4) * dt; this.vy[i] += (-this.oy[i] * 9 - this.vy[i] * 4) * dt;
        this.ox[i] += this.vx[i] * dt; this.oy[i] += this.vy[i] * dt;
        this.px[i] = this.x[i]; this.py[i] = this.y[i];
        this.x[i] = nx + this.ox[i]; this.y[i] = ny + this.oy[i];
      }
    }
    draw(ctx) {
      const { w, h, c, n, x, y, px, py } = this;
      ctx.globalAlpha = 1;
      ctx.fillStyle = c.paperA(1); ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = Math.min(1, (this.age || 0) / 1.5);   // the dots fade in on first load
      ctx.fillStyle = c.inkA(0.85);
      if (this.phase === 'hold') {                             // holding: everything is a crisp dot
        for (let i = 0; i < n; i++) ctx.fillRect(x[i] - 0.65, y[i] - 0.65, 1.3, 1.3);
        ctx.globalAlpha = 1;
        return;
      }
      // in flight: still dots are specks, moving ones become short strokes along their heading
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const dx = x[i] - px[i], dy = y[i] - py[i], sp = Math.hypot(dx, dy);
        if (sp < 0.4) { ctx.fillRect(x[i] - 0.65, y[i] - 0.65, 1.3, 1.3); continue; }
        const L = Math.min(3, 0.8 + sp * 0.6) / sp;
        ctx.moveTo(x[i] - dx * L, y[i] - dy * L); ctx.lineTo(x[i] + dx * L * 0.3, y[i] + dy * L * 0.3);
      }
      ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.strokeStyle = c.inkA(0.75);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  /* ---------------- harness ---------------- */

  function mount(root) {
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const H = parseInt(root.dataset.height, 10) || 200;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, active: false };
    let r = null, w = 0, visible = true, last = performance.now();

    let image = null;

    function build() {
      w = root.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      r = new Journey({ w, h: H, colors: readColors(), image, scenes: root.dataset.scenes });
      // reduced motion shows one settled frame; ?warm=N fast-forwards N steps (handy for screenshots)
      if (reduceMotion) r.settle();
      const warm = reduceMotion ? 0 : +new URLSearchParams(location.search).get('warm') || 0;
      for (let i = 0; i < warm; i++) r.step(1 / 60, pointer);
      r.draw(ctx);
    }

    function frame(t) {
      requestAnimationFrame(frame);
      const dt = Math.min((t - last) / 1000, 1 / 20);
      last = t;
      if (!visible || !r || reduceMotion) return;
      r.step(dt, pointer);
      r.draw(ctx);
    }

    canvas.addEventListener('pointermove', e => {
      const b = canvas.getBoundingClientRect();
      pointer.x = e.clientX - b.left; pointer.y = e.clientY - b.top; pointer.active = true;
    });
    canvas.addEventListener('pointerleave', () => { pointer.active = false; });
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    // theme changes (system or the page's toggle): recolour in place, no restart
    const recolor = () => { if (r) { Object.assign(r.c, readColors()); r.draw(ctx); } };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
    document.addEventListener('themechange', recolor);
    window.addEventListener('load', recolor);
    let timer;
    window.addEventListener('resize', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (root.clientWidth !== w) build(); }, 150);
    });

    if (root.dataset.image) {
      const img = new Image();
      img.onload = () => { image = img; build(); };
      img.onerror = build;
      img.src = root.dataset.image;
    } else build();
    requestAnimationFrame(frame);
  }

  /* ---------------- the life page: a walk, seen from behind ---------------- */

  // Behind the photo wall (and through its open middle, .gallery-window): someone walking
  // away from you down a dotted trail. Every so often it forks; they pick a way and the view
  // turns to follow while the other paths trail off to the horizon. Photos "develop" into
  // colour one by one when the page opens.
  //   <div class="gallery" data-walk> <figure class="snap">…</figure> … <div class="gallery-window"></div> … </div>

  // A person seen from behind, as dots pinned to body parts (head, neck, torso, arms, hands,
  // legs, shoes), so the walk stays coherent: legs lift and tuck, arms swing from the
  // shoulder, the body bobs and sways. Units are body heights; feet at y = 0, up is negative.
  function makeWalker() {
    const dots = [], edge = () => Math.random() < 0.35, disc = () => { const a = Math.random() * Math.PI * 2, r = edge() ? 1 : Math.sqrt(Math.random()); return [Math.cos(a) * r, Math.sin(a) * r]; };
    const add = (part, n, gen) => { for (let i = 0; i < n; i++) dots.push([part, ...gen()]); };
    add('head', 130, () => { const [u, v] = disc(); return [u * 0.055, -0.93 + v * 0.068]; });               // hair, from behind
    add('head', 14, () => { const s = Math.random() < 0.5 ? -1 : 1, [u, v] = disc(); return [s * 0.058 + u * 0.009, -0.918 + v * 0.017]; });   // ears
    add('neck', 18, () => [(Math.random() * 2 - 1) * 0.025, -0.865 + Math.random() * 0.045]);
    // an athletic V-taper: broad, rounded shoulders narrowing to a slim waist
    // shoulders (rounded) → waist → a slight flare at the hips; torso spans y -0.82 to -0.5
    const hw = y => {
      if (y < -0.75) return 0.04 + 0.075 * Math.sqrt(Math.max(0, 1 - ((y + 0.75) / 0.07) ** 2));
      const t = (y + 0.75) / 0.25;                       // 0 at the shoulders, 1 at the hips
      return 0.115 - 0.035 * Math.sin(Math.min(1, t / 0.7) * Math.PI / 2) + (t > 0.7 ? (t - 0.7) / 0.3 * 0.012 : 0);
    };
    // mostly outline with a light fill, so the back reads lean rather than solid
    add('torso', 160, () => { const y = -0.82 + Math.random() * 0.32, w = hw(y); return [Math.random() < 0.6 ? (Math.random() < 0.5 ? -w : w) : (Math.random() * 2 - 1) * w * 0.9, y]; });
    add('torso', 14, () => [(Math.random() - 0.5) * 0.005, -0.78 + Math.random() * 0.26]);   // a faint spine line
    const limb = () => [Math.random(), edge() ? (Math.random() < 0.5 ? -1 : 1) : Math.random() * 2 - 1];   // t along, s across
    for (const side of ['L', 'R']) {
      add('arm' + side, 110, limb); add('hand' + side, 18, disc);
      add('leg' + side, 190, limb); add('shoe' + side, 30, disc);
    }
    return dots;
  }

  // Draw the walker with feet at (bx, by), Hp pixels tall, at stride phase φ (amp 0 = standing).
  // run (0..1) blends the walk into a run: bent, pumping arms, heels kicking up behind, a bounce
  // where both feet leave the ground, and a slight forward lean.
  function drawPerson(ctx, dots, bx, by, Hp, phi, amp, run = 0) {
    const mix = (a, b) => a + (b - a) * run;
    const sw = Math.sin(phi), r = Math.max(1.2, Hp / 200);
    const bob = Math.abs(sw) * mix(0.022, 0.04) * amp, sway = sw * mix(0.012, 0.008) * amp, tilt = sw * 0.045 * amp;
    const air = run * amp * 0.035 * Math.max(0, Math.cos(phi * 2)), lean = run * 0.022;
    const legs = {}, arms = {};
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      // the stepping leg lifts and tucks in; running, the heel kicks up high behind
      const lift = Math.max(0, s * sw) ** mix(1, 0.8) * mix(0.095, 0.24) * amp;
      legs[side] = { hx: s * 0.047 + sway, hy: -0.5 - bob - air, ax: s * (0.05 - lift * 0.22), ay: -0.035 - lift - air };
      // arms, seen from behind. Walking: a straight arm swinging toward/away from you (it
      // foreshortens and tucks in a touch going forward). Running: bent at the elbow, the
      // hand pumping up near the chest.
      const fwd = -s * sw * amp, sx = s * 0.108 + sway * 0.6, sy = -0.78 - bob - air + lean * 0.7 - s * tilt * 0.12;
      const walkHand = [sx + s * (0.016 - Math.max(0, fwd) * 0.008), sy + 0.29 * (1 - Math.max(0, fwd) * 0.11)];
      const runElbow = [sx + s * 0.035, sy + 0.15], runHand = [sx - s * 0.035, sy + 0.17 - fwd * 0.06];
      const hand = [mix(walkHand[0], runHand[0]), mix(walkHand[1], runHand[1])];
      const elbow = [mix((sx + walkHand[0]) / 2, runElbow[0]), mix((sy + walkHand[1]) / 2, runElbow[1])];
      arms[side] = { sx, sy, ex: elbow[0], ey: elbow[1], hx: hand[0], hy: hand[1] };
    }
    const limb = (ax, ay, ex, ey, t, s, width) => {
      const dx = ex - ax, dy = ey - ay, L = Math.hypot(dx, dy) || 1, w = width(t);
      return [ax + dx * t - dy / L * s * w, ay + dy * t + dx / L * s * w];
    };
    const bump = (t, at, size) => Math.exp(-(((t - at) / size) ** 2));
    const upperArm = t => 0.02 + 0.004 * bump(t, 0.15, 0.25) + 0.004 * bump(t, 0.55, 0.22);   // deltoid, then bicep
    const forearm = t => 0.019 - 0.006 * t + 0.002 * bump(t, 0.2, 0.2);
    const legW = t => 0.046 - 0.024 * t + 0.005 * bump(t, 0.66, 0.12);                          // full thigh tapering to a calf                          // thigh tapering to a calf
    for (const [part, a, b] of dots) {
      let x, y;
      const side = part[part.length - 1];
      switch (part.replace(/[LR]$/, '')) {
        case 'head': x = a + sway * 0.6; y = b - bob * 1.1 - air + lean; break;
        case 'neck': case 'torso': { const up = -0.5 - b; x = a + sway + up * tilt * 0.25; y = b - bob - air + a * tilt + lean * up / 0.32; break; }   // shoulders tilt against the hips
        case 'arm': { const m = arms[side]; [x, y] = a < 0.5 ? limb(m.sx, m.sy, m.ex, m.ey, a * 2, b, upperArm) : limb(m.ex, m.ey, m.hx, m.hy, a * 2 - 1, b, forearm); break; }
        case 'hand': { const m = arms[side]; x = m.hx + a * 0.017; y = m.hy + 0.017 + b * 0.025; break; }
        case 'leg': { const l = legs[side]; [x, y] = limb(l.hx, l.hy, l.ax, l.ay, a, b, legW); break; }
        default: { const l = legs[side]; x = l.ax + a * 0.034; y = l.ay + 0.013 + b * 0.018; }       // shoe
      }
      ctx.fillRect(bx + x * Hp - r / 2, by + y * Hp - r / 2, r, r);
    }
  }

  function mountWalk(root) {
    const canvas = document.createElement('canvas');
    canvas.className = 'walk-stage';
    document.body.prepend(canvas);
    const win = root.querySelector('.gallery-window');
    const ctx = canvas.getContext('2d');
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, dpr = 1, colors = readColors(), visible = false, last = performance.now();
    const night = () => { const [r, g, b] = colors.paper; return 0.299 * r + 0.587 * g + 0.114 * b < 128; };

    // --- the land: gentle rolling hills, with forest in some places and meadow in others
    const ground = (x, z) => 2.4 * perlin(x * 0.011, z * 0.011, 0.37) + 0.6 * perlin(x * 0.04, z * 0.04, 2.9);
    const forest = (x, z) => perlin(x * 0.012, z * 0.012, 8.8) < 0.05;

    // --- trails as polylines [x, z, height] (x right, z forward, metres). The walk passes
    // through themed stretches in turn; every stretch ends at a signposted fork.
    const STEP = 0.5, THEMES = ['torii', 'forest', 'bridge', 'meadow', 'lanterns', 'forest'];
    let paths = [], route = [], signs = [], zones = [], rivers = [], themeAt = 0;
    // a trail from (x, z) that eases from heading `from` to `to` over the first ~10 m, then drifts
    function grow(x, z, from, to, len, curve) {
      const pts = [];
      let heading = from;
      for (let d = 0; d <= len; d += STEP) {
        pts.push([x, z, ground(x, z)]);
        if (d < 10) { const e = d / 10; heading = from + (to - from) * e * e * (3 - 2 * e); } else heading += curve * STEP;
        x += Math.sin(heading) * STEP; z += Math.cos(heading) * STEP;
      }
      return { pts, heading };
    }
    function extend() {
      const end = route[route.length - 1], prev = route[route.length - 2];
      const heading = Math.atan2(end[0] - prev[0], end[1] - prev[1]);
      const ways = 2 + (Math.random() < 0.5 ? 1 : 0), pick = Math.floor(Math.random() * ways), turns = [];
      for (let k = 0; k < ways; k++) {
        const turn = (k - (ways - 1) / 2) * 0.6 + (Math.random() - 0.5) * 0.15, mine = k === pick;
        turns.push(heading + turn);
        const g = grow(end[0], end[1], heading, heading + turn, mine ? 46 + Math.random() * 12 : 34, (Math.random() - 0.5) * 0.02);
        if (mine) {
          const from = route.length, kind = THEMES[themeAt++ % THEMES.length];
          route.push(...g.pts.slice(1));
          zones.push({ from: from + 22, to: route.length - 1, kind });
          if (kind === 'bridge') {                           // a river crossing the trail mid-stretch
            const c = Math.floor((from + 22 + route.length) / 2), [x1, z1] = route[c + 1], [x0, z0] = route[c - 1], L = Math.hypot(x1 - x0, z1 - z0) || 1;
            const dx = (x1 - x0) / L, dz = (z1 - z0) / L;
            rivers.push({ c, x: route[c][0], z: route[c][1], dx, dz, nx: dz, nz: -dx, y: route[c][2] - 0.9 });
          }
        } else {
          paths.push(g.pts);
          const tip = g.pts[g.pts.length - 1];                // the road not taken forks once more
          for (const t of [-0.5, 0.5]) paths.push(grow(tip[0], tip[1], g.heading, g.heading + t, 34, (Math.random() - 0.5) * 0.02).pts);
        }
      }
      const sx = end[0] + Math.cos(heading) * 1.4, sz = end[1] - Math.sin(heading) * 1.4;
      signs.push({ x: sx, z: sz, y: ground(sx, sz), turns });
    }
    route = grow(0, 0, 0, 0, 30, 0.004).pts;
    zones.push({ from: 0, to: route.length - 1, kind: 'meadow' });
    extend(); extend();
    // ?walk=N starts N metres down the trail (handy for screenshots)
    let walked = 4 + (+new URLSearchParams(location.search).get('walk') || 0);
    while (walked > route.length * STEP - 70) extend();
    const zoneAt = i => { for (const zn of zones) if (i >= zn.from && i <= zn.to) return zn.kind; return 'meadow'; };
    const along = d => {
      const i = Math.min(route.length - 2, Math.max(0, Math.floor(d / STEP))), f = d / STEP - i, a = route[i], b = route[i + 1];
      return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[0] - a[0], b[1] - a[1]), a[2] + (b[2] - a[2]) * f];
    };
    // where along the route i is relative to the nearest river (in samples), or Infinity
    const riverOff = i => { let best = Infinity; for (const rv of rivers) if (Math.abs(i - rv.c) < Math.abs(best)) best = i - rv.c; return best; };
    const inRiver = (x, z) => rivers.some(rv => { const ax = x - rv.x, az = z - rv.z; return Math.abs(ax * rv.dx + az * rv.dz) < 5 && Math.abs(ax * rv.nx + az * rv.nz) < 70; });

    // --- shapes
    const person = makeWalker();
    const sunPts = shapePoints(90, 60, 60, MACHINES.sun) || new Float32Array(0);
    const moonPts = shapePoints(90, 60, 60, MACHINES.moon) || new Float32Array(0);
    const stars = [...Array(160)].map(() => [Math.random() * Math.PI * 2, Math.random() ** 1.5, Math.random() * 6]);
    let birds = null;

    function resize() {
      W = innerWidth; H = innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      birds = new Flock({ w: W, h: H * 0.28, colors, count: 70 });
      birds.yc = 0.45;
    }

    // scrolling (wheel, trackpad, or a swipe) hurries the walker along; they ease back to a walk
    let hurry = 0;
    const push = d => { if (d > 0) hurry = Math.min(6, hurry + d * 0.01); };
    window.addEventListener('wheel', e => push(e.deltaY), { passive: true });
    let touchY = null;
    window.addEventListener('touchstart', e => { touchY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', e => { if (touchY !== null) { push((touchY - e.touches[0].clientY) * 2); touchY = e.touches[0].clientY; } }, { passive: true });

    let phase = 0, camHeading = 0, camAlt = null, clock = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      if (!visible || !W) return;
      clock += dt;
      hurry *= Math.exp(-dt * 1.2);
      const stepD = reduceMotion ? 0 : (1.9 + hurry) * dt;
      walked += stepD; phase += stepD * 3.2 / (1 + hurry * 0.25);   // longer strides as they speed up
      const speed = 1.9 + hurry, running = Math.min(1, Math.max(0, (speed - 3) / 2.5)), run = running * running * (3 - 2 * running);
      while (walked > route.length * STEP - 70) extend();
      const [px, pz, , py] = along(walked);
      paths = paths.filter(pt => pt.some(q => (q[0] - px) ** 2 + (q[1] - pz) ** 2 < 150 ** 2));
      signs = signs.filter(sg => (sg.x - px) ** 2 + (sg.z - pz) ** 2 < 150 ** 2);

      // camera: straight behind the walker at a fixed distance, easing toward the trail's direction
      const camDist = 9, chd = along(walked + 3)[2];
      let dh = chd - camHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      camHeading += dh * Math.min(1, dt * 0.9);
      const cs = Math.cos(camHeading), sn = Math.sin(camHeading);
      const cxw = px - sn * camDist, czw = pz - cs * camDist;
      // frame everything on the gallery's open middle (or the bottom of the screen without one)
      const wr = win && win.offsetParent ? win.getBoundingClientRect() : null;
      const shake = reduceMotion ? 0 : Math.sin(phase * 2) * (1.6 + 2.4 * run);      // a handheld bob, two per stride
      const horizon = (wr ? wr.top + wr.height * 0.3 : H * 0.45) + shake, feet = (wr ? wr.bottom - 6 : H * 0.95) + shake * 0.4;
      const tall = wr ? wr.height * 0.62 : H * 0.3, cxs = wr ? wr.left + wr.width / 2 : W / 2, sky = wr ? wr.height : H * 0.4;
      const f = H * 0.7, camY = (feet - horizon) * camDist / f;
      camAlt = camAlt === null ? py + camY : camAlt + (py + camY - camAlt) * Math.min(1, dt * 3);
      const project = (x, z, y) => {
        const dx = x - cxw, dz = z - czw, rx = dx * cs - dz * sn, fz = dx * sn + dz * cs;
        if (fz < 0.6) return null;
        return [cxs + f * rx / fz, horizon + f * (camAlt - y) / fz, fz];
      };
      const bearingX = a => { const d = Math.atan2(Math.sin(a - camHeading), Math.cos(a - camHeading)); return Math.abs(d) < 1.3 ? cxs + f * Math.tan(d) : null; };
      const fade = z => Math.max(0, Math.min(1, 1.15 - z / 70));
      const dot = (x, y, r, a) => { ctx.fillStyle = colors.inkA(a); ctx.fillRect(x - r / 2, y - r / 2, r, r); };
      // a dotted 3D line, for gates, railings, posts and lanterns
      const line3 = (x0, z0, y0, x1, z1, y1, a, rr = 2.4) => {
        const p0 = project(x0, z0, y0), p1 = project(x1, z1, y1);
        if (!p0 || !p1) return;
        const al = fade((p0[2] + p1[2]) / 2) * a;
        if (al <= 0.02) return;
        const n = Math.min(90, Math.max(2, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 2.2)), r = Math.max(0.6, rr / Math.sqrt((p0[2] + p1[2]) / 2));
        ctx.fillStyle = colors.inkA(al);
        for (let t = 0; t <= n; t++) ctx.fillRect(p0[0] + (p1[0] - p0[0]) * t / n - r / 2, p0[1] + (p1[1] - p0[1]) * t / n - r / 2, r, r);
      };

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      // on phones the window is a banner in the page's flow: draw only inside it
      const banner = wr && innerWidth <= 700;
      if (banner) { ctx.save(); ctx.beginPath(); ctx.rect(wr.left, wr.top, wr.width, wr.height); ctx.clip(); }

      // sky: stars at night, the sun or moon, a small flock of birds
      if (night()) for (const [a, e, tw] of stars) {
        const x = bearingX(a);
        if (x !== null) dot(x, horizon - 30 - e * sky * 0.9, 1.1, 0.25 + 0.25 * Math.sin(clock * 1.5 + tw));
      }
      const bx = bearingX(-0.55);
      if (bx !== null) {
        const pts = night() ? moonPts : sunPts, sy = horizon - sky * 0.55, sc = sky / 300;
        for (let j = 0; j < pts.length; j += 2) dot(bx + pts[j] * sc, sy + pts[j + 1] * sc, 1.3, 0.75);
      }
      if (birds && !reduceMotion) {
        birds.step(dt, { active: false });
        const top = horizon - sky * 0.75;
        ctx.strokeStyle = colors.inkA(0.6); ctx.lineWidth = 1.1; ctx.beginPath();
        for (let i = 0; i < birds.n; i++) {
          const sp = Math.hypot(birds.vx[i], birds.vy[i]) || 1, x = birds.px[i], y = top + birds.py[i] * 0.6, flap = Math.abs(Math.sin(clock * 9 + i)) * 1.5;
          ctx.moveTo(x - birds.vx[i] / sp * 2.5, y - birds.vy[i] / sp * 2.5 - flap); ctx.lineTo(x, y); ctx.lineTo(x + birds.vx[i] / sp * 2.5, y + birds.vy[i] / sp * 2.5 - flap);
        }
        ctx.stroke();
      }

      // Mount Rainier on the horizon: a broad, snow-capped dome that stays roughly ahead
      const RB = camHeading * 0.85 + 0.1, RW = 0.3, RH = sky * 0.22;
      for (let x = 0; x < W; x += 1.5) {
        const a = camHeading + Math.atan((x - cxs) / f), d = Math.atan2(Math.sin(a - RB), Math.cos(a - RB)) / RW;
        if (Math.abs(d) >= 1) continue;
        let e = (1 - Math.abs(d)) ** 1.7; e = Math.min(e, 0.82 + 0.04 * Math.cos(d * 9)) / 0.86;
        const top = horizon - 6 - RH * e;
        dot(x, top, 1.2, 0.7);
        if (e > 0.5) for (let k = 0; k < 3; k++) if (hashInt(x | 0, k, 5) % 3 === 0) dot(x, top + ((hashInt(x | 0, k, 6) % 100) / 100) * RH * (e - 0.5) * 0.9, 1, 0.35);
      }
      for (const [amp, seed, a] of [[26, 1.7, 0.25], [14, 4.1, 0.4]]) for (let x = 0; x < W; x += 2) {
        const ang = camHeading + Math.atan((x - cxs) / f);
        dot(x, horizon - 2 - amp * (0.5 + 0.5 * perlin(ang * 2.2, 0.5, seed)) - amp * 0.35 * perlin(ang * 7, 1.5, seed + 1), 1.2, a);
      }

      // ground cover: grass tufts, little flowers in the meadows; none on the water
      const R = 50, c0x = Math.floor((cxw - R) / 2), c1x = Math.floor((cxw + R) / 2), c0z = Math.floor((czw - R) / 2), c1z = Math.floor((czw + R) / 2);
      for (let gx = c0x; gx <= c1x; gx++) for (let gz = c0z; gz <= c1z; gz++) {
        const wx = gx * 2 + 1, wz = gz * 2 + 1;
        if (inRiver(wx, wz)) continue;
        const gy = ground(wx, wz), meadow = !forest(wx, wz);
        for (let k = 0; k < 3; k++) {
          const hsh = hashInt(gx, gz, k), x = (gx + (hsh % 1000) / 1000) * 2, z = (gz + ((hsh >>> 10) % 1000) / 1000) * 2, p = project(x, z, gy);
          if (!p || p[1] > H || p[0] < -4 || p[0] > W + 4) continue;
          const a = Math.max(0, Math.min(1, 1.2 - p[2] / 30)) * 0.5, r = Math.max(0.6, 2.6 / Math.sqrt(p[2]));
          if (a <= 0.02) continue;
          ctx.fillStyle = colors.inkA(a);
          if (meadow && (hsh >>> 20) % 3 === 0) { ctx.fillRect(p[0] - r, p[1], r * 2, r * 0.7); ctx.fillRect(p[0] - r * 0.35, p[1] - r * 0.7, r * 0.7, r * 2); }
          else if ((hsh >>> 20) % 3 === 1) { ctx.fillRect(p[0], p[1] - r * 2, 0.9, r * 2); ctx.fillRect(p[0] + r, p[1] - r * 1.5, 0.9, r * 1.5); }
          else ctx.fillRect(p[0], p[1], r * 0.8, r * 0.8);
        }
      }

      // rivers: drifting ripples between two dotted banks
      for (const rv of rivers) {
        for (let k = 0; k < 600; k++) {
          const hsh = hashInt(k, 11, rv.c), across = ((hsh % 1000) / 1000 - 0.5) * 8;
          const flow = ((((hsh >>> 10) % 1000) / 1000 * 140 + clock * 1.8) % 140) - 70;
          const x = rv.x + rv.nx * flow + rv.dx * across, z = rv.z + rv.nz * flow + rv.dz * across, p = project(x, z, rv.y);
          if (!p || p[1] > H) continue;
          const a = fade(p[2]) * 0.45, r = Math.max(0.6, 3 / Math.sqrt(p[2]));
          if (a > 0.02) { ctx.fillStyle = colors.inkA(a); ctx.fillRect(p[0] - r * 1.5, p[1], r * 3, r * 0.6); }
        }
        for (const s of [-4.2, 4.2]) for (let fl = -70; fl < 70; fl += 2) {
          const x = rv.x + rv.nx * fl + rv.dx * s, z = rv.z + rv.nz * fl + rv.dz * s, p = project(x, z, ground(x, z) - 0.3);
          if (p) dot(p[0], p[1], Math.max(0.6, 2.6 / Math.sqrt(p[2])), fade(p[2]) * 0.6);
        }
      }

      // trails: a dotted band that rides the hills (the bridge has planks instead)
      const trail = (pts, from, to, strength) => {
        for (let i = Math.max(1, from); i < Math.min(pts.length, to); i++) {
          if (pts === route && Math.abs(riverOff(i)) <= 11) continue;
          const [x1, z1, y1] = pts[i], [x0, z0] = pts[i - 1], L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
          for (let sub = 0; sub < 2; sub++) {
            const x = x0 + (x1 - x0) * sub / 2, z = z0 + (z1 - z0) * sub / 2;
            for (const [off, w] of [[-0.6, 1], [-0.22, 0.45], [0.22, 0.45], [0.6, 1]]) {
              const j = ((hashInt(i, sub, off * 10 | 0) % 100) / 100 - 0.5) * 0.12, p = project(x + nx * (off + j), z + nz * (off + j), y1);
              if (!p || p[1] > H + 4 || p[1] < horizon - 8) continue;
              const a = fade(p[2]) * strength * w;
              if (a > 0.01) dot(p[0], p[1], Math.max(0.6, 3.4 / Math.sqrt(p[2])), a);
            }
          }
        }
      };
      const here = Math.floor(walked / STEP);
      for (const pt of paths) trail(pt, 0, pt.length, 0.7);

      // everything standing along the walker's way, collected and drawn far to near
      const stand = [];
      const frame3 = i => { const [x1, z1, y1] = route[i], [x0, z0] = route[i - 1], L = Math.hypot(x1 - x0, z1 - z0) || 1; return { x: x1, z: z1, y: y1, dx: (x1 - x0) / L, dz: (z1 - z0) / L, nx: (z1 - z0) / L, nz: -(x1 - x0) / L }; };
      for (let i = Math.max(1, here - 30); i < Math.min(route.length - 1, here + 300); i++) {
        const kind = zoneAt(i);
        if (i % 4 === 0) for (const k of [0, 1, 2]) {                 // firs: thick in forest stretches, scarce elsewhere
          const hsh = hashInt(i, k, 3);
          if (!(kind === 'forest' ? hsh % 4 !== 0 : kind === 'torii' || Math.abs(riverOff(i)) < 16 ? false : hsh % 9 === 0)) continue;
          const F = frame3(i), side = hsh & 1 ? 1 : -1, off = side * (k === 2 ? 11 + (hsh >>> 4) % 1500 / 100 : 4.5 + (hsh >>> 4) % 700 / 100);
          const fx = F.x + F.nx * off, fz = F.z + F.nz * off, p = project(fx, fz, ground(fx, fz));
          if (p) stand.push([p[2], 'fir', p, 4 + (hsh >>> 12) % 400 / 100]);
        }
        if (kind === 'torii' && i % 6 === 0) stand.push([project(...[route[i][0], route[i][1], route[i][2]])?.[2] ?? -1, 'torii', i]);
        if (kind === 'lanterns' && i % 12 === 0) for (const side of [-1, 1]) stand.push([project(route[i][0], route[i][1], route[i][2])?.[2] ?? -1, 'lantern', i, side]);
        if (Math.abs(riverOff(i)) <= 11) stand.push([project(route[i][0], route[i][1], route[i][2])?.[2] ?? -1, 'deck', i]);
      }
      for (const sg of signs) { const p = project(sg.x, sg.z, sg.y); if (p) stand.push([p[2], 'sign', p, sg]); }
      stand.sort((a, b) => b[0] - a[0]);
      for (const [depth, kind, v, w] of stand) {
        if (depth < 0) continue;
        if (kind === 'fir') {
          // a fir as a dotted outline: three tiers of boughs and a trunk, crisp at any distance
          const p = v, a = fade(p[2]) * 0.85, hgt = f * w / p[2], r = Math.max(0.8, 2.6 / Math.sqrt(p[2]));
          if (a <= 0.03 || p[2] < 11 || p[1] - hgt > H || p[0] < -hgt || p[0] > W + hgt || hgt < 6) continue;   // skip trees right beside the camera
          const pts = [[0, -1], [0.17, -0.7], [0.08, -0.7], [0.27, -0.42], [0.13, -0.42], [0.36, -0.14], [0.05, -0.14], [0.05, 0],
                       [-0.05, 0], [-0.05, -0.14], [-0.36, -0.14], [-0.13, -0.42], [-0.27, -0.42], [-0.08, -0.7], [-0.17, -0.7], [0, -1]];
          // fill with the page colour first, so nearer trees hide the ones behind them
          ctx.fillStyle = colors.paperA(1); ctx.beginPath();
          pts.forEach(([u, q], k) => k ? ctx.lineTo(p[0] + u * hgt, p[1] + q * hgt) : ctx.moveTo(p[0] + u * hgt, p[1] + q * hgt));
          ctx.fill();
          ctx.fillStyle = colors.inkA(a);
          for (let k = 1; k < pts.length; k++) {
            const x0 = p[0] + pts[k - 1][0] * hgt, y0 = p[1] + pts[k - 1][1] * hgt, x1 = p[0] + pts[k][0] * hgt, y1 = p[1] + pts[k][1] * hgt;
            const n = Math.max(1, Math.hypot(x1 - x0, y1 - y0) / 2.4);
            for (let t = 0; t < n; t++) ctx.fillRect(x0 + (x1 - x0) * t / n - r / 2, y0 + (y1 - y0) * t / n - r / 2, r, r);
          }
        } else if (kind === 'torii') {
          // a vermilion-style gate: two thick posts, a straight tie beam, and a top beam with upturned ends
          const F = frame3(v), P = (o, h) => [F.x + F.nx * o, F.z + F.nz * o, F.y + h];
          for (const s of [-1, 1]) for (const t of [-0.13, -0.045, 0.045, 0.13]) line3(...P(s * 1.45 + t, 0), ...P(s * 1.42 + t, 3.1), 0.85);
          for (const h of [2.52, 2.62, 2.72]) line3(...P(-1.8, h), ...P(1.8, h), 0.8);
          for (const h of [3.12, 3.22, 3.32]) { line3(...P(-2.2, h + 0.14), ...P(0, h), 0.9); line3(...P(0, h), ...P(2.2, h + 0.14), 0.9); }
          line3(...P(0, 2.7), ...P(0, 3.15), 0.7);
        } else if (kind === 'lantern') {
          // a stone lantern beside the path; at night it glows and fireflies drift around it
          const F = frame3(v), o = w * 1.8, P = (dx, dz, h) => [F.x + F.nx * (o + dx) + F.dx * dz, F.z + F.nz * (o + dx) + F.dz * dz, F.y + h];
          line3(...P(0, 0, 0), ...P(0, 0, 0.55), 0.8, 3.4);
          for (const [a0, a1] of [[-0.18, 0.18]]) for (const h of [0.55, 0.9]) line3(...P(a0, 0, h), ...P(a1, 0, h), 0.8);
          for (const s of [-0.18, 0.18]) line3(...P(s, 0, 0.55), ...P(s, 0, 0.9), 0.8);
          line3(...P(-0.32, 0, 0.92), ...P(0, 0, 1.12), 0.85); line3(...P(0, 0, 1.12), ...P(0.32, 0, 0.92), 0.85);
          if (night()) {
            const c = project(...P(0, 0, 0.72));
            if (c) for (let k = 0; k < 18; k++) { const a = hashInt(v, w, k) % 628 / 100, rr = (hashInt(v, k, w) % 100) / 100 * 7 / Math.sqrt(c[2]) * 3; dot(c[0] + Math.cos(a) * rr, c[1] + Math.sin(a) * rr, 1.4, fade(c[2]) * (0.5 + 0.3 * Math.sin(clock * 3 + k))); }
            for (let k = 0; k < 3; k++) {
              const fx = Math.sin(clock * 0.7 + k * 2.1 + v) * 1.4, fz = Math.cos(clock * 0.5 + k * 1.3 + v) * 1.4, fh = 0.9 + Math.sin(clock * 1.1 + k + v) * 0.5;
              const q = project(...P(fx - w * 0.6, fz, fh));
              if (q) dot(q[0], q[1], 1.6, fade(q[2]) * (0.4 + 0.4 * Math.sin(clock * 4 + k * 2 + v)));
            }
          }
        } else if (kind === 'deck') {
          // the bridge: planks across, an arch over the water, railings with posts
          const F = frame3(v), off = riverOff(v), lift = 0.25 + 0.55 * Math.cos(off / 11 * Math.PI / 2), y = F.y + lift;
          line3(F.x - F.nx * 0.95, F.z - F.nz * 0.95, y, F.x + F.nx * 0.95, F.z + F.nz * 0.95, y, 0.85);
          if (v % 3 === 0 && v < route.length - 4) for (const s of [-1, 1]) {
            const G = frame3(v + 3), lift2 = 0.25 + 0.55 * Math.cos(riverOff(v + 3) / 11 * Math.PI / 2);
            line3(F.x + F.nx * s * 1.05, F.z + F.nz * s * 1.05, y, F.x + F.nx * s * 1.05, F.z + F.nz * s * 1.05, y + 1, 0.8);
            if (Math.abs(riverOff(v + 3)) <= 11) line3(F.x + F.nx * s * 1.05, F.z + F.nz * s * 1.05, y + 1, G.x + G.nx * s * 1.05, G.z + G.nz * s * 1.05, G.y + lift2 + 1, 0.8);
          }
        } else {
          // signpost: a post with one board pointing down each way
          const p = v, a = fade(p[2]) * 0.8, post = f * 1.7 / p[2], r = Math.max(0.8, 2.6 / Math.sqrt(p[2]));
          for (let t = 0; t <= 1; t += 1 / Math.max(6, post / 2)) dot(p[0], p[1] - t * post, r, a);
          w.turns.forEach((tu, k) => {
            const yb = p[1] - post * (0.92 - k * 0.16), dx = Math.sin(tu - camHeading) * f * 0.7 / p[2];
            for (let t = 0; t <= 1; t += 0.08) dot(p[0] + dx * t, yb - Math.abs(dx) * 0.08 * t, r, a);
          });
        }
      }
      trail(route, here - 40, here + 280, 0.85);

      // the walker (on the bridge, a little higher)
      const p = project(px, pz, py + (Math.abs(riverOff(Math.floor(walked / STEP))) <= 11 ? 0.25 + 0.55 * Math.cos(riverOff(Math.floor(walked / STEP)) / 11 * Math.PI / 2) : 0));
      if (p) { ctx.fillStyle = colors.inkA(0.9); drawPerson(ctx, person, p[0], p[1], tall, phase, reduceMotion ? 0 : 1, run); }
      if (banner) ctx.restore();
    }

    root.classList.add('ready');
    // if a photo fails to load (a flaky connection), try it once more instead of leaving a grey box
    root.querySelectorAll('.snap img').forEach(img => {
      const retry = () => { if (img.dataset.retried) return; img.dataset.retried = '1'; img.src = img.getAttribute('src').split('?')[0] + '?r=' + Date.now(); };
      img.addEventListener('error', retry);
      if (img.complete && !img.naturalWidth) retry();
    });
    // the quote in the window shows for a while, then fades away
    const quote = root.querySelector('.window-quote');
    if (quote) setTimeout(() => quote.classList.add('gone'), reduceMotion ? 0 : 7000);
    // photos develop into colour one after another
    root.querySelectorAll('.snap').forEach((el, k) => setTimeout(() => el.classList.add('seen'), reduceMotion ? 0 : 500 + k * 280));
    visible = true; resize();
    document.addEventListener('visibilitychange', () => { visible = !document.hidden; });
    window.addEventListener('resize', resize);
    const recolor = () => { colors = readColors(); };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
    document.addEventListener('themechange', recolor);
    window.addEventListener('load', recolor);
    requestAnimationFrame(frame);
  }

  document.querySelectorAll('[data-viz]').forEach(mount);
  document.querySelectorAll('[data-walk]').forEach(mountWalk);
})();
