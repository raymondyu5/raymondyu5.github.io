/**
 * Hero visualizations — natural phenomena drawn in ink on paper.
 *
 * Any element with data-viz="<name>" gets a canvas running that renderer:
 *   topo   – drifting topographic contours, broken like an old survey map
 *   slime  – physarum slime mold building transport networks
 *   flock  – a starling murmuration
 *   coral  – gray–scott reaction–diffusion (coral, mitosis)
 *   rain   – raindrops on still water
 *   reveal – contours that slowly resolve into a picture (data-image)
 *   stipple – particles denoised into a picture, like a diffusion model sampling
 *             (data-image, or data-shape="spiral")
 *   journey – a murmuration that lands to draw one scene after another (data-scenes):
 *            rainier (needs data-image="assets/viz/rainier.jpg"), grove (an old tree with a
 *            parade of animals), city (robots and people in a future city), workshop (a robot
 *            arm handing boxes to a person)
 *   evolve – a swarm that becomes fish → frog → lizard → monkey → human → robot, marching
 *            left to right, then swims back as fish and starts over
 *   murmur – a starling murmuration that lands to draw a picture, then takes off again
 *            (data-shape="tree" | "landscape" | "rainier" with data-image="assets/viz/rainier.jpg")
 *
 * A renderer is a class with step(dt, pointer) and draw(ctx), plus a static
 * caption. The harness handles sizing, theme colors, hover, and pausing
 * when the canvas is off screen.
 */
(function () {
  'use strict';

  /* ---------------- shared helpers ---------------- */

  function readColors() {
    const s = getComputedStyle(document.documentElement);
    const rgb = v => {
      const h = s.getPropertyValue(v).trim().replace('#', '');
      return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    };
    const ink = rgb('--ink'), paper = rgb('--paper');
    return {
      ink, paper,
      inkA: a => `rgba(${ink},${a})`,
      paperA: a => `rgba(${paper},${a})`,
    };
  }

  // 256-step lookup table from paper (0) to ink (255)
  function ramp(c) {
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = c.paper[k] + (c.ink[k] - c.paper[k]) * (i / 255);
    }
    return lut;
  }

  // A low-res pixel buffer that gets scaled (smoothly) onto the main canvas.
  class Field {
    constructor(cols, rows) {
      this.cols = cols; this.rows = rows;
      this.off = document.createElement('canvas');
      this.off.width = cols; this.off.height = rows;
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(cols, rows);
    }
    // write intensity t∈[0,1] for pixel i
    set(i, t, lut) {
      const k = (t <= 0 ? 0 : t >= 1 ? 255 : (t * 255) | 0) * 3, d = this.img.data, j = i * 4;
      d[j] = lut[k]; d[j + 1] = lut[k + 1]; d[j + 2] = lut[k + 2]; d[j + 3] = 255;
    }
    present(ctx, w, h, smooth = true) {
      this.octx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = smooth;
      ctx.drawImage(this.off, 0, 0, w, h);
    }
  }

  function hashInt(x, y, z) {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h ^ (h >>> 16)) >>> 0;
  }

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

  // Darkness (0 = white, 1 = black) of an image, cover-cropped to cols×rows.
  // `focus` picks which vertical slice of the image to keep (0 top … 1 bottom).
  // `invert` samples brightness instead (for light strokes on a dark picture).
  function coverDraw(x, img, cols, rows, focus) {
    const ar = cols / rows, iw = img.naturalWidth, ih = img.naturalHeight;
    let sw = iw, sh = iw / ar;
    if (sh > ih) { sh = ih; sw = ih * ar; }
    x.drawImage(img, (iw - sw) / 2, (ih - sh) * focus, sw, sh, 0, 0, cols, rows);
  }

  function sampleImage(img, cols, rows, focus = 0.5, invert = false) {
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const x = cv.getContext('2d', { willReadFrequently: true });
    coverDraw(x, img, cols, rows, focus);
    const d = x.getImageData(0, 0, cols, rows).data, out = new Float32Array(cols * rows);
    let lo = 1, hi = 0;
    for (let i = 0; i < out.length; i++) {
      const lum = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
      const v = invert ? lum : 1 - lum;
      out[i] = v; if (v < lo) lo = v; if (v > hi) hi = v;
    }
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / (hi - lo || 1);   // stretch contrast
    return out;
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

  // Procedural target densities for when there is no image.
  function shapeDensity(shape, cols, rows) {
    const out = new Float32Array(cols * rows), m = Math.min(cols, rows);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const u = (x - cols / 2) / (m / 2), v = (y - rows / 2) / (m / 2);
      const r = Math.hypot(u, v), th = Math.atan2(v, u) + Math.PI;
      let d = Infinity;
      for (let k = 0; k < 4; k++) d = Math.min(d, Math.abs(r - 0.045 * (th + 2 * Math.PI * k)));
      out[y * cols + x] = r < 0.95 ? Math.exp(-((d / 0.035) ** 2)) : 0;
    }
    return out;
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

  // One or two freshly grown trees.
  function treeDensity(cols, rows) {
    const x = scratch(cols, rows);
    x.strokeStyle = '#000';
    drawTree(x, cols * (0.58 + Math.random() * 0.17), rows, rows * 0.27, rows * 0.06, 10, -Math.PI / 2 + (Math.random() - 0.5) * 0.12);
    drawTree(x, cols * (0.12 + Math.random() * 0.18), rows, rows * 0.17, rows * 0.04, 8, -Math.PI / 2 + (Math.random() - 0.5) * 0.2);
    return darkness(x, cols, rows);
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

  // A layered landscape, like an engraving: faint far ridges, a pale moon,
  // darker hills, a grove of trees along the hill line, grassy foreground.
  // Gray level = how many particles land there.
  function landscapeDensity(cols, rows) {
    const x = scratch(cols, rows), seed = Math.random() * 100;
    const gray = v => { const c = Math.round(255 * (1 - v)); return `rgb(${c},${c},${c})`; };
    const ridge = (base, amp, freq, z) => i =>
      rows * base - rows * amp * (perlin(i * freq, z, seed) + 0.5 * perlin(i * freq * 2.3, z + 3, seed));
    const fillRidge = (f, v) => {
      x.fillStyle = gray(v); x.beginPath(); x.moveTo(0, rows);
      for (let i = 0; i <= cols; i++) x.lineTo(i, f(i));
      x.lineTo(cols, rows); x.closePath(); x.fill();
    };
    const lineRidge = (f, v, wd) => {
      x.strokeStyle = gray(v); x.lineWidth = wd; x.beginPath();
      for (let i = 0; i <= cols; i++) i ? x.lineTo(i, f(i)) : x.moveTo(i, f(i));
      x.stroke();
    };

    // moon: pale disc with a crisper rim
    const mx = cols * (0.62 + Math.random() * 0.3), my = rows * (0.22 + Math.random() * 0.12), mr = rows * 0.2;
    x.fillStyle = gray(0.1); x.beginPath(); x.arc(mx, my, mr, 0, Math.PI * 2); x.fill();
    x.strokeStyle = gray(0.55); x.lineWidth = 1.2; x.stroke();

    const far = ridge(0.55, 0.3, 0.012, 1), mid = ridge(0.75, 0.2, 0.02, 5), near = ridge(0.93, 0.07, 0.03, 9);
    fillRidge(far, 0.07);  lineRidge(far, 0.45, 1);
    fillRidge(mid, 0.16);  lineRidge(mid, 0.7, 1.2);

    // a grove standing on the middle hills, biggest tree first
    x.strokeStyle = '#000';
    const big = cols * (0.12 + Math.random() * 0.25);
    drawTree(x, big, mid(big) + 2, rows * 0.2, rows * 0.05, 10, -Math.PI / 2 + (Math.random() - 0.5) * 0.1);
    for (let t = 0; t < 7; t++) {
      const tx = Math.random() * cols;
      if (Math.abs(tx - big) < cols * 0.08) continue;
      const sz = 0.05 + Math.random() * 0.08;
      drawTree(x, tx, mid(tx) + 1, rows * sz, rows * sz * 0.25, 7, -Math.PI / 2 + (Math.random() - 0.5) * 0.2);
    }

    // foreground ground with grass tufts
    fillRidge(near, 0.32); lineRidge(near, 0.9, 1.4);
    x.strokeStyle = gray(0.8); x.lineWidth = 0.8;
    for (let g = 0; g < cols * 0.6; g++) {
      const gx = Math.random() * cols, gy = near(gx), gh = 2 + Math.random() * 4;
      x.beginPath(); x.moveTo(gx, gy + 1); x.lineTo(gx + (Math.random() - 0.5) * 3, gy - gh); x.stroke();
    }
    return darkness(x, cols, rows);
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

  /* ---------------- topo: broken contour lines ---------------- */

  class Topo {
    static caption = 'topographic drift · hover to raise the land';
    constructor({ w, h, colors }, spacing = 5) {
      this.w = w; this.h = h; this.c = colors;
      this.s = spacing;                             // px between samples
      this.cols = Math.ceil(w / this.s) + 1;
      this.rows = Math.ceil(h / this.s) + 1;
      this.f = new Float32Array(this.cols * this.rows);
      this.bump = new Float32Array(this.cols * this.rows);
      this.t = Math.random() * 50;
      this.step_ = 0.075;                            // elevation between contours
      this.gap = 0.22;                               // higher = fewer breaks in the lines
    }
    step(dt, p) {
      this.t += dt * 0.035;
      const { cols, rows, s, bump } = this;
      for (let i = 0; i < bump.length; i++) bump[i] *= 0.992;
      if (p.active) {
        const R = 45, gx = p.x / s, gy = p.y / s, r = R / s;
        for (let j = Math.max(0, gy - r | 0); j <= Math.min(rows - 1, gy + r + 1 | 0); j++) {
          for (let i = Math.max(0, gx - r | 0); i <= Math.min(cols - 1, gx + r + 1 | 0); i++) {
            const d2 = ((i - gx) ** 2 + (j - gy) ** 2) * s * s;
            bump[j * cols + i] = Math.min(1.2, bump[j * cols + i] + 0.03 * Math.exp(-d2 / (R * R * 0.35)));
          }
        }
      }
      const z = this.t, sc = 0.0055;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = i * s * sc, y = j * s * sc;
          this.f[j * cols + i] =
            perlin(x, y, z) + 0.5 * perlin(x * 2.1, y * 2.1, z * 1.3 + 7) + 0.22 * perlin(x * 4.3, y * 4.3, z * 1.7 + 19)
            + bump[j * cols + i];
        }
      }
    }
    draw(ctx, fade = 1) {
      const { w, h, cols, rows, s, f, c } = this, step = this.step_;
      ctx.fillStyle = c.paperA(1);
      ctx.fillRect(0, 0, w, h);
      const thin = [], thick = [];
      const ex = [0, 0, 0, 0], ey = [0, 0, 0, 0];
      for (let j = 0; j < rows - 1; j++) {
        for (let i = 0; i < cols - 1; i++) {
          const a = f[j * cols + i], b = f[j * cols + i + 1];
          const cc = f[(j + 1) * cols + i + 1], d = f[(j + 1) * cols + i];
          const lo = Math.min(a, b, cc, d), hi = Math.max(a, b, cc, d);
          const x0 = i * s, y0 = j * s;
          for (let k = Math.ceil(lo / step); k * step <= hi; k++) {
            const L = k * step;
            // gaps: a slow noise field decides where each contour is "broken"
            if (perlin(i * 0.11, j * 0.11, k * 3.7 + this.t * 2) > this.gap) continue;
            let n = 0;
            if ((a < L) !== (b < L))  { const t = (L - a) / (b - a);  ex[n] = x0 + t * s; ey[n++] = y0; }
            if ((b < L) !== (cc < L)) { const t = (L - b) / (cc - b); ex[n] = x0 + s;     ey[n++] = y0 + t * s; }
            if ((d < L) !== (cc < L)) { const t = (L - d) / (cc - d); ex[n] = x0 + t * s; ey[n++] = y0 + s; }
            if ((a < L) !== (d < L))  { const t = (L - a) / (d - a);  ex[n] = x0;         ey[n++] = y0 + t * s; }
            const out = ((k % 5) + 5) % 5 === 0 ? thick : thin;
            for (let m = 0; m + 1 < n; m += 2) out.push(ex[m], ey[m], ex[m + 1], ey[m + 1]);
          }
        }
      }
      const stroke = (segs, width, alpha) => {
        ctx.beginPath();
        for (let m = 0; m < segs.length; m += 4) { ctx.moveTo(segs[m], segs[m + 1]); ctx.lineTo(segs[m + 2], segs[m + 3]); }
        ctx.lineWidth = width; ctx.strokeStyle = c.inkA(alpha); ctx.lineCap = 'round';
        ctx.stroke();
      };
      stroke(thin, 0.8, 0.55 * fade);
      stroke(thick, 1.4, 0.9 * fade);
    }
  }

  /* ---------------- slime: physarum transport networks ---------------- */

  class Slime {
    static caption = 'physarum polycephalum · hover to leave food';
    constructor({ w, h, colors }) {
      this.w = w; this.h = h;
      this.cols = Math.floor(w); this.rows = Math.floor(h);
      const N = this.cols * this.rows;
      this.trail = new Float32Array(N); this.tmp = new Float32Array(N);
      this.n = Math.min(30000, Math.floor(N * 0.18));
      this.ax = new Float32Array(this.n); this.ay = new Float32Array(this.n); this.ah = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) {
        this.ax[i] = Math.random() * this.cols; this.ay[i] = Math.random() * this.rows;
        this.ah[i] = Math.random() * Math.PI * 2;
      }
      this.field = new Field(this.cols, this.rows);
      this.lut = ramp(colors);
    }
    sense(x, y, a) {
      const { cols, rows } = this, SO = 9;
      let sx = (x + Math.cos(a) * SO) | 0, sy = (y + Math.sin(a) * SO) | 0;
      sx = (sx % cols + cols) % cols; sy = (sy % rows + rows) % rows;
      return this.trail[sy * cols + sx];
    }
    step(dt, p) {
      const { cols, rows, trail, ax, ay, ah } = this;
      const SA = Math.PI / 4, RA = Math.PI / 4, SPEED = 1, DEPOSIT = 5;
      for (let i = 0; i < this.n; i++) {
        let a = ah[i];
        const F = this.sense(ax[i], ay[i], a), L = this.sense(ax[i], ay[i], a + SA), R = this.sense(ax[i], ay[i], a - SA);
        if (F > L && F > R) { /* keep heading */ }
        else if (F < L && F < R) a += Math.random() < 0.5 ? RA : -RA;
        else if (L > R) a += RA;
        else if (R > L) a -= RA;
        let x = ax[i] + Math.cos(a) * SPEED, y = ay[i] + Math.sin(a) * SPEED;
        if (x < 0) x += cols; else if (x >= cols) x -= cols;
        if (y < 0) y += rows; else if (y >= rows) y -= rows;
        ax[i] = x; ay[i] = y; ah[i] = a;
        trail[(y | 0) * cols + (x | 0)] += DEPOSIT;
      }
      if (p.active) {
        const gx = p.x | 0, gy = p.y | 0;
        for (let j = -8; j <= 8; j++) for (let i = -8; i <= 8; i++) {
          const x = gx + i, y = gy + j;
          if (i * i + j * j <= 64 && x >= 0 && x < cols && y >= 0 && y < rows) trail[y * cols + x] += 4;
        }
      }
      // diffuse (3x3 mean) + decay
      const tmp = this.tmp;
      for (let y = 0; y < rows; y++) {
        const ym = (y ? y - 1 : rows - 1) * cols, y0 = y * cols, yp = (y < rows - 1 ? y + 1 : 0) * cols;
        for (let x = 0; x < cols; x++) {
          const xm = x ? x - 1 : cols - 1, xp = x < cols - 1 ? x + 1 : 0;
          const mean = (trail[ym + xm] + trail[ym + x] + trail[ym + xp] + trail[y0 + xm] + trail[y0 + x]
                      + trail[y0 + xp] + trail[yp + xm] + trail[yp + x] + trail[yp + xp]) / 9;
          tmp[y0 + x] = 0.9 * (0.5 * trail[y0 + x] + 0.5 * mean);
        }
      }
      this.trail = tmp; this.tmp = trail;
    }
    draw(ctx) {
      const t = this.trail, f = this.field;
      for (let i = 0; i < t.length; i++) f.set(i, 1 - Math.exp(-t[i] * 0.035), this.lut);
      f.present(ctx, this.w, this.h);
    }
  }

  /* ---------------- flock: starling murmuration ---------------- */

  class Flock {
    static caption = 'starling murmuration · your cursor is a falcon';
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
      this.fresh = true;
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
    draw(ctx) {
      const { c, w, h } = this;
      ctx.fillStyle = c.paperA(this.fresh ? 1 : 0.3);   // translucent wipe leaves faint motion trails
      this.fresh = false;
      ctx.fillRect(0, 0, w, h);
      this.drawBirds(ctx);
    }
    drawBirds(ctx) {
      const { n, px, py, vx, vy, c } = this;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const sp = Math.hypot(vx[i], vy[i]) || 1;
        ctx.moveTo(px[i] - vx[i] / sp * 1.2, py[i] - vy[i] / sp * 1.2);
        ctx.lineTo(px[i] + vx[i] / sp * 1.2, py[i] + vy[i] / sp * 1.2);
      }
      ctx.lineWidth = 1.8; ctx.lineCap = 'round'; ctx.strokeStyle = c.inkA(0.85);
      ctx.stroke();
    }
  }

  /* ---------------- coral: gray–scott reaction–diffusion ---------------- */

  class Coral {
    static caption = 'gray–scott reaction–diffusion · hover to seed';
    constructor({ w, h, colors }) {
      this.w = w; this.h = h;
      this.cols = Math.floor(w / 2); this.rows = Math.floor(h / 2);
      const N = this.cols * this.rows;
      this.U = new Float32Array(N).fill(1); this.V = new Float32Array(N);
      this.U2 = new Float32Array(N); this.V2 = new Float32Array(N);
      // feed/kill drift across the width: dividing cells on the left, coral on the right
      this.F = new Float32Array(this.cols); this.K = new Float32Array(this.cols);
      for (let x = 0; x < this.cols; x++) {
        const t = x / (this.cols - 1);
        this.F[x] = lerp(0.0367, 0.0545, t); this.K[x] = lerp(0.0649, 0.062, t);
      }
      for (let s = 0; s < 24; s++) this.seed(Math.random() * this.cols, Math.random() * this.rows, 3);
      this.field = new Field(this.cols, this.rows);
      this.lut = ramp(colors);
    }
    seed(cx, cy, r) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const x = (cx | 0) + i, y = (cy | 0) + j;
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || i * i + j * j > r * r) continue;
        const k = y * this.cols + x;
        this.U[k] = 0.5; this.V[k] = 0.25 + Math.random() * 0.1;
      }
    }
    step(dt, p) {
      if (p.active) this.seed(p.x / 2, p.y / 2, 2);
      const { cols, rows, F, K } = this;
      for (let it = 0; it < 10; it++) {
        const U = this.U, V = this.V, U2 = this.U2, V2 = this.V2;
        for (let y = 0; y < rows; y++) {
          const ym = (y ? y - 1 : rows - 1) * cols, y0 = y * cols, yp = (y < rows - 1 ? y + 1 : 0) * cols;
          for (let x = 0; x < cols; x++) {
            const xm = x ? x - 1 : cols - 1, xp = x < cols - 1 ? x + 1 : 0, i = y0 + x;
            const u = U[i], v = V[i];
            const lu = 0.2 * (U[ym + x] + U[yp + x] + U[y0 + xm] + U[y0 + xp])
                     + 0.05 * (U[ym + xm] + U[ym + xp] + U[yp + xm] + U[yp + xp]) - u;
            const lv = 0.2 * (V[ym + x] + V[yp + x] + V[y0 + xm] + V[y0 + xp])
                     + 0.05 * (V[ym + xm] + V[ym + xp] + V[yp + xm] + V[yp + xp]) - v;
            const uvv = u * v * v;
            U2[i] = u + lu - uvv + F[x] * (1 - u);
            V2[i] = v + 0.5 * lv + uvv - (F[x] + K[x]) * v;
          }
        }
        this.U = U2; this.U2 = U; this.V = V2; this.V2 = V;
      }
    }
    draw(ctx) {
      const V = this.V, f = this.field;
      for (let i = 0; i < V.length; i++) f.set(i, (V[i] - 0.12) * 7, this.lut);
      f.present(ctx, this.w, this.h);
    }
  }

  /* ---------------- rain: ripples on still water ---------------- */

  class Rain {
    static caption = 'rain on still water · hover to trail a finger';
    constructor({ w, h, colors }) {
      this.w = w; this.h = h;
      this.cols = Math.floor(w / 2); this.rows = Math.floor(h / 2);
      const N = this.cols * this.rows;
      this.a = new Float32Array(N); this.b = new Float32Array(N);
      this.field = new Field(this.cols, this.rows);
      this.lut = ramp(colors);
      this.lx = -1; this.ly = -1;
    }
    drop(cx, cy, r, s) {
      for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
        const x = (cx | 0) + i, y = (cy | 0) + j, d = Math.hypot(i, j);
        if (d > r || x < 1 || y < 1 || x >= this.cols - 1 || y >= this.rows - 1) continue;
        this.a[y * this.cols + x] -= s * (Math.cos(d / r * Math.PI) + 1) / 2;
      }
    }
    step(dt, p) {
      if (Math.random() < dt * 3.5) this.drop(Math.random() * this.cols, Math.random() * this.rows, 3, 14 + Math.random() * 14);
      if (p.active) {
        if (Math.hypot(p.x - this.lx, p.y - this.ly) > 4) this.drop(p.x / 2, p.y / 2, 2, 4);
        this.lx = p.x; this.ly = p.y;
      }
      const { cols, rows } = this;
      for (let sub = 0; sub < 2; sub++) {
        const a = this.a, b = this.b;
        for (let y = 1; y < rows - 1; y++) {
          for (let x = 1, i = y * cols + 1; x < cols - 1; x++, i++) {
            b[i] = ((a[i - 1] + a[i + 1] + a[i - cols] + a[i + cols]) * 0.5 - b[i]) * 0.986;
          }
        }
        this.a = b; this.b = a;
      }
    }
    draw(ctx) {
      const { a, cols, rows, field, lut } = this;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) { field.set(i, 0, lut); continue; }
          const s = (a[i - 1] - a[i + 1]) + (a[i - cols] - a[i + cols]);   // light from the top-left
          field.set(i, s > 0 ? s * 0.3 : -s * 0.08, lut);
        }
      }
      field.present(ctx, this.w, this.h);
    }
  }

  /* ---------------- reveal: contours that resolve into a picture ---------------- */

  class Reveal extends Topo {
    static caption = 'terrain, slowly surveyed into a picture · hover to scramble';
    constructor(opts) {
      super(opts, 4);
      this.gap = 0.32; this.step_ = 0.085;
      const { cols, rows } = this;
      this.target = new Float32Array(cols * rows).fill(0.5);
      if (opts.image) {
        try { this.target = blur(sampleImage(opts.image, cols, rows, opts.focus, opts.invert), cols, rows, 3); }
        catch (e) { /* canvas tainted (e.g. opened via file://) — stay as plain terrain */ }
      }
      this.dis = new Float32Array(cols * rows);    // hover disruption, 0..1
      this.age = 0;
    }
    settle() { this.age = 60; this.step(0, { active: false }); }
    step(dt, p) {
      this.age += dt; this.t += dt * 0.035;
      const { cols, rows, s, dis, target, f } = this;
      for (let i = 0; i < dis.length; i++) if (dis[i] > 0) dis[i] = Math.max(0, dis[i] - dt * 0.3);
      if (p.active) {
        const R = 38 / s, gx = p.x / s, gy = p.y / s;
        for (let j = Math.max(0, gy - R | 0); j <= Math.min(rows - 1, gy + R + 1 | 0); j++) {
          for (let i = Math.max(0, gx - R | 0); i <= Math.min(cols - 1, gx + R + 1 | 0); i++) {
            const d = Math.hypot(i - gx, j - gy) / R;
            if (d < 1) dis[j * cols + i] = Math.max(dis[j * cols + i], 1 - d * d);
          }
        }
      }
      const z = this.t, sc = 0.0055;
      for (let i = 0; i < cols; i++) {
        // the picture sweeps in from left to right, then holds ~90% (a little noise keeps it breathing)
        const u = Math.min(1, Math.max(0, (this.age - 0.8 - 4.5 * i / cols) / 3.5));
        const sweep = 0.9 * u * u * (3 - 2 * u);
        for (let j = 0; j < rows; j++) {
          const k = j * cols + i, x = i * s * sc, y = j * s * sc;
          const a = sweep * (1 - dis[k]);
          const noise = perlin(x, y, z) + 0.5 * perlin(x * 2.1, y * 2.1, z * 1.3 + 7) + 0.22 * perlin(x * 4.3, y * 4.3, z * 1.7 + 19);
          f[k] = noise * (1 - a) + (target[k] - 0.5) * 1.5 * a;
        }
      }
    }
  }

  /* ---------------- stipple: particles denoised into a picture ---------------- */

  const CYCLE = 24;   // seconds: noise → denoise → hold → re-noise, then a fresh sample

  class Stipple {
    static caption = 'reverse diffusion · a fresh sample every 24 seconds';
    constructor({ w, h, colors, image, focus, shape, invert, count }) {
      this.w = w; this.h = h; this.c = colors;
      this.n = count || Math.min(9000, Math.round(w * h / 17));
      this.gc = Math.max(8, w / 2 | 0); this.gr = Math.max(8, h / 2 | 0);
      let dens = null;
      if (image && shape !== 'rainier') { try { dens = sampleImage(image, this.gc, this.gr, focus, invert); } catch (e) { /* tainted canvas */ } }
      // trees and landscapes are regrown every cycle; other targets stay fixed
      this.gamma = 2.2;
      if (!dens && shape === 'tree') this.regrow = () => treeDensity(this.gc, this.gr);
      else if (!dens && shape === 'grove') { this.regrow = () => groveDensity(this.gc, this.gr); this.gamma = 1; }
      else if (!dens && shape === 'landscape') { this.regrow = () => landscapeDensity(this.gc, this.gr); this.gamma = 1; }
      else if (!dens && shape === 'rainier' && image) {
        this.gamma = 1;
        try { rainierLines(this.gc, this.gr, image); this.regrow = () => rainierLines(this.gc, this.gr, image); }
        catch (e) { this.regrow = () => landscapeDensity(this.gc, this.gr); }   // tainted canvas (file://)
      }
      else if (!dens) dens = shapeDensity(shape || 'spiral', this.gc, this.gr);
      this.fixed = dens;
      const A = () => new Float32Array(this.n);
      this.tx = A(); this.ty = A(); this.ex = A(); this.ey = A();
      this.jx = A(); this.jy = A(); this.ox = A(); this.oy = A(); this.vx = A(); this.vy = A();
      for (let i = 0; i < this.n; i++) { this.ex[i] = gauss(); this.ey[i] = gauss(); }
      this.resample();
      this.clock = 0;
    }
    resample() {
      const raw = this.regrow ? this.regrow() : this.fixed;
      const dens = raw.map(v => Math.min(1, v) ** this.gamma);   // gamma > 1 favors the strongest strokes
      const { gc, gr, w, h } = this;
      // inverse-CDF sampling: every particle lands exactly on the target, however sparse
      const cdf = new Float64Array(dens.length);
      let total = 0;
      for (let i = 0; i < dens.length; i++) cdf[i] = total += dens[i];
      for (let i = 0; i < this.n; i++) {
        const u = Math.random() * total;
        let lo = 0, hi = cdf.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < u) lo = mid + 1; else hi = mid; }
        this.tx[i] = (lo % gc + Math.random()) / gc * w;
        this.ty[i] = ((lo / gc | 0) + Math.random()) / gr * h;
      }
    }
    settle() { this.clock = 12; }
    // noise level σ over the cycle
    sigma() {
      const t = this.clock;
      if (t < 1.5) return 1;
      if (t < 9.5) { const u = (t - 1.5) / 8; return Math.cos(u * Math.PI / 2) ** 2; }
      if (t < 20.5) return 0;
      const u = (t - 20.5) / 3.5; return Math.sin(u * Math.PI / 2) ** 2;
    }
    step(dt, p) {
      this.clock += dt;
      if (this.clock >= (this.cycle || CYCLE)) { this.clock -= this.cycle || CYCLE; this.resample(); }
      const { n, ex, ey, jx, jy, ox, oy, vx, vy } = this;
      const sq = Math.sqrt(dt);
      for (let i = 0; i < n; i++) {
        // slow drift of each particle's noise sample + fast jitter (Ornstein–Uhlenbeck)
        ex[i] += -ex[i] * 0.25 * dt + gauss() * sq * 0.7;
        ey[i] += -ey[i] * 0.25 * dt + gauss() * sq * 0.7;
        jx[i] += -jx[i] * 6 * dt + gauss() * sq * 3.5;
        jy[i] += -jy[i] * 6 * dt + gauss() * sq * 3.5;
        // cursor scatters particles; a spring pulls them back
        if (p.active) {
          const x = this.x(i), y = this.y(i), dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < 3600) { const d = Math.sqrt(d2) || 1, k = (1 - d / 60) * 2600 * dt; vx[i] += dx / d * k; vy[i] += dy / d * k; }
        }
        vx[i] += (-ox[i] * 9 - vx[i] * 4) * dt; vy[i] += (-oy[i] * 9 - vy[i] * 4) * dt;
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
      }
      this.s = this.sigma();
    }
    x(i) {
      const s = this.s ?? 1, nx = this.w / 2 + this.ex[i] * this.w * 0.22;
      return this.tx[i] + (nx - this.tx[i]) * s + this.jx[i] * 9 * s * (1 - s) * 4 + this.ox[i];
    }
    y(i) {
      const s = this.s ?? 1, ny = this.h / 2 + this.ey[i] * this.h * 0.26;
      return this.ty[i] + (ny - this.ty[i]) * s + this.jy[i] * 9 * s * (1 - s) * 4 + this.oy[i];
    }
    draw(ctx) {
      const { w, h, c, n } = this;
      if (this.s === undefined) this.s = this.sigma();
      ctx.fillStyle = c.paperA(1); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = c.inkA(0.85);
      for (let i = 0; i < n; i++) ctx.fillRect(this.x(i) - 0.65, this.y(i) - 0.65, 1.3, 1.3);
    }
  }

  /* ---------------- murmur: starlings that land to form a picture ---------------- */

  class Murmur extends Stipple {
    static caption = 'starlings coming in to roost · your cursor is a falcon';
    constructor(opts) {
      const count = Math.min(4000, Math.round(opts.w * opts.h / 38));
      super({ ...opts, count });
      // simulate a normal-size flock; every dot flies in loose formation around one of its birds
      this.flock = new Flock(opts);
      this.flock.yc = 0.25;                       // circle up in the sky, above the picture
      const m = this.flock.n;
      this.lead = new Uint16Array(this.n); this.fx = new Float32Array(this.n); this.fy = new Float32Array(this.n);
      for (let i = 0; i < this.n; i++) { this.lead[i] = i % m; this.fx[i] = gauss() * 8; this.fy[i] = gauss() * 5; }
      this.p = new Float32Array(this.n);   // per-bird landing progress, 0 flying … 1 perched
      this.restless = Math.round(this.n * 0.03);   // these few keep circling overhead
    }
    settle() { this.clock = 15; this.step(0, { active: false }); }
    // 0 = everyone landed, 1 = everyone flying
    sigma() {
      const t = this.clock;
      if (t < 5) return 1;
      if (t < 12) { const u = (t - 5) / 7; return Math.cos(u * Math.PI / 2) ** 2; }
      if (t < 20.5) return 0;
      const u = (t - 20.5) / 3.5; return Math.sin(u * Math.PI / 2) ** 2;
    }
    step(dt, ptr) {
      this.clock += dt;
      if (this.clock >= CYCLE) { this.clock -= CYCLE; this.resample(); }
      this.flock.step(dt, ptr);
      const u = 1 - this.sigma(), { n, tx, ox, oy, vx, vy, p, w } = this;
      for (let i = 0; i < n; i++) {
        if (i < this.restless) { p[i] = 0; continue; }
        // birds on the left land first, so the picture sweeps in left to right
        const q = Math.min(1, Math.max(0, (u - 0.4 * tx[i] / w) / 0.6));
        p[i] = q * q * (3 - 2 * q);
        if (ptr.active && p[i] > 0.5) {
          const dx = this.x(i) - ptr.x, dy = this.y(i) - ptr.y, d2 = dx * dx + dy * dy;
          if (d2 < 3600) { const d = Math.sqrt(d2) || 1, k = (1 - d / 60) * 2600 * dt; vx[i] += dx / d * k; vy[i] += dy / d * k; }
        }
        vx[i] += (-ox[i] * 9 - vx[i] * 4) * dt; vy[i] += (-oy[i] * 9 - vy[i] * 4) * dt;
        ox[i] += vx[i] * dt; oy[i] += vy[i] * dt;
      }
    }
    x(i) { const a = this.flock.px[this.lead[i]] + this.fx[i]; return a + (this.tx[i] - a) * this.p[i] + this.ox[i] * this.p[i]; }
    y(i) { const a = this.flock.py[this.lead[i]] + this.fy[i]; return a + (this.ty[i] - a) * this.p[i] + this.oy[i] * this.p[i]; }
    draw(ctx) {
      const { w, h, c, n, p } = this, f = this.flock;
      ctx.fillStyle = c.paperA(1); ctx.fillRect(0, 0, w, h);
      // flying birds are short strokes along their heading; perched ones shrink to dots
      ctx.beginPath();
      ctx.fillStyle = c.inkA(0.85);
      for (let i = 0; i < n; i++) {
        const x = this.x(i), y = this.y(i);
        if (p[i] > 0.92) { ctx.fillRect(x - 0.6, y - 0.6, 1.2, 1.2); continue; }
        const j = this.lead[i], sp = Math.hypot(f.vx[j], f.vy[j]) || 1, L = 1.1 * (1 - p[i]) + 0.4;
        ctx.moveTo(x - f.vx[j] / sp * L, y - f.vy[j] / sp * L);
        ctx.lineTo(x + f.vx[j] / sp * L, y + f.vy[j] / sp * L);
      }
      ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.strokeStyle = c.inkA(0.7);
      ctx.stroke();
    }
  }

  /* ---------------- evolve: one swarm, many creatures ---------------- */

  const SPECIES = ['🐟', '🐸', '🦎', '🐒', '🚶', '🤖'];

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

  /* --- little machines, painted in black at height s, centred, feet at +0.45s --- */
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
    courier(x, W, H) {                                  // a six-wheeled delivery bot with a flag
      const s = H / 1.3, c = W / 2, m = H / 2; ink(x, s * 0.06);
      box(x, c - 0.32 * s, m - 0.12 * s, 0.64 * s, 0.38 * s, 0.07 * s);
      seg(x, c - 0.32 * s, m - 0.02 * s, c + 0.32 * s, m - 0.02 * s);
      x.fillRect(c + 0.1 * s, m + 0.04 * s, 0.14 * s, 0.07 * s);
      for (const k of [-0.22, 0, 0.22]) { x.beginPath(); x.arc(c + k * s, m + 0.36 * s, 0.08 * s, 0, Math.PI * 2); x.stroke(); }
      seg(x, c - 0.26 * s, m - 0.12 * s, c - 0.26 * s, m - 0.5 * s);
      x.beginPath(); x.moveTo(c - 0.26 * s, m - 0.5 * s); x.lineTo(c - 0.1 * s, m - 0.45 * s); x.lineTo(c - 0.26 * s, m - 0.4 * s); x.fill();
    },
    dog(x, W, H) {                                      // a four-legged robot dog
      const s = H / 1.3, c = W / 2, m = H / 2; ink(x, s * 0.06);
      box(x, c - 0.32 * s, m - 0.08 * s, 0.52 * s, 0.17 * s, 0.05 * s);
      box(x, c + 0.2 * s, m - 0.24 * s, 0.2 * s, 0.13 * s, 0.04 * s);
      dot(x, c + 0.33 * s, m - 0.19 * s, 0.025 * s);
      for (const k of [-0.27, -0.15, 0.04, 0.15]) {
        x.beginPath(); x.moveTo(c + k * s, m + 0.09 * s); x.lineTo(c + (k - 0.05) * s, m + 0.27 * s); x.lineTo(c + k * s, m + 0.45 * s); x.stroke();
      }
      seg(x, c - 0.32 * s, m - 0.05 * s, c - 0.42 * s, m - 0.2 * s);
    },
    drone(x, W, H) {                                    // a quadcopter carrying a parcel
      const s = H / 1.3, c = W / 2, m = H / 2; ink(x, s * 0.07);
      seg(x, c - 0.75 * s, m - 0.2 * s, c + 0.75 * s, m - 0.2 * s);
      box(x, c - 0.2 * s, m - 0.27 * s, 0.4 * s, 0.15 * s, 0.05 * s);
      for (const k of [-0.75, 0.75]) { x.beginPath(); x.ellipse(c + k * s, m - 0.3 * s, 0.28 * s, 0.05 * s, 0, 0, Math.PI * 2); x.stroke(); }
      seg(x, c, m - 0.12 * s, c, m + 0.05 * s);
      box(x, c - 0.18 * s, m + 0.05 * s, 0.36 * s, 0.3 * s, 0.02 * s);
      seg(x, c - 0.18 * s, m + 0.2 * s, c + 0.18 * s, m + 0.2 * s);
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
    train(x, W, H) {                                    // a maglev, nose to the right
      ink(x, H * 0.06);
      x.beginPath();
      x.moveTo(W * 0.03, H * 0.3); x.lineTo(W * 0.8, H * 0.3);
      x.quadraticCurveTo(W * 0.99, H * 0.35, W * 0.99, H * 0.72); x.lineTo(W * 0.03, H * 0.72); x.closePath(); x.stroke();
      for (let k = 0.06; k < 0.78; k += 0.07) x.fillRect(W * k, H * 0.4, W * 0.045, H * 0.13);
      seg(x, W * 0.03, H * 0.62, W * 0.97, H * 0.62);
    },
  };

  class Evolve {
    static caption = 'fish → frog → lizard → monkey → human → robot';
    constructor({ w, h, colors }) {
      this.w = w; this.h = h; this.c = colors;
      this.n = Math.min(2600, Math.round(w * h / 55));
      const size = Math.min(h * 0.62, w / 7.5), m = w * 0.08;
      this.forms = SPECIES.map((e, k) => emojiPoints(e, this.n, m + (w - 2 * m) * k / (SPECIES.length - 1), h * 0.52, size)).filter(Boolean);
      const A = () => new Float32Array(this.n);
      this.x = A(); this.y = A(); this.px = A(); this.py = A();
      this.ox = A(); this.oy = A(); this.vx = A(); this.vy = A();
      this.curl = A().map(() => (Math.random() - 0.5) * 2);
      this.k = 0; this.t = 0;
      const f = this.forms[0] || new Float32Array(this.n * 2);
      for (let i = 0; i < this.n; i++) { this.x[i] = f[i * 2] + (Math.random() - 0.5) * w; this.y[i] = f[i * 2 + 1] + (Math.random() - 0.5) * h; }
      this.from = Float32Array.from({ length: this.n * 2 }, (_, j) => j % 2 ? this.y[j >> 1] : this.x[j >> 1]);
    }
    settle() { this.t = 3; }
    step(dt, p) {
      if (!this.forms.length) return;
      const HOLD = 2.6, MOVE = this.k === 0 ? 3.2 : 2.2;    // the swim back to the start takes longer
      this.t += dt;
      if (this.t > MOVE + HOLD) {                          // next creature
        this.t = 0;
        this.from = Float32Array.from({ length: this.n * 2 }, (_, j) => j % 2 ? this.y[j >> 1] : this.x[j >> 1]);
        this.k = (this.k + 1) % this.forms.length;
      }
      const to = this.forms[this.k], from = this.from, { n, w, h } = this;
      const back = this.k === 0;                            // robot dissolving into a school of fish
      for (let i = 0; i < n; i++) {
        // stagger: the front of the swarm leads, the rest follow
        const lag = (i / n) * 0.35, q = Math.min(1, Math.max(0, (this.t / MOVE - lag) / 0.65));
        const e = q < 0.5 ? 4 * q * q * q : 1 - (-2 * q + 2) ** 3 / 2;
        const fx = from[i * 2], fy = from[i * 2 + 1], tx = to[i * 2], ty = to[i * 2 + 1];
        // curved paths: bow out perpendicular to the direction of travel
        const dx = tx - fx, dy = ty - fy, len = Math.hypot(dx, dy) || 1, bow = Math.sin(e * Math.PI) * (back ? 0.45 : 0.25);
        let nx = fx + dx * e - dy / len * bow * len * this.curl[i] * 0.5;
        let ny = fy + dy * e + dx / len * bow * len * this.curl[i] * 0.5;
        if (back) ny += Math.sin(e * Math.PI) * Math.sin(fx * 0.03 + e * 12) * h * 0.08;   // swimming wiggle
        // breathing while a creature holds still
        nx += Math.sin(this.t * 2 + i) * 0.3; ny += Math.cos(this.t * 1.7 + i * 1.3) * 0.3;
        // cursor scatters, springs pull back
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
      ctx.fillStyle = c.paperA(1); ctx.fillRect(0, 0, w, h);
      // still dots are specks; moving ones become short strokes along their heading
      ctx.fillStyle = c.inkA(0.85);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const dx = x[i] - px[i], dy = y[i] - py[i], sp = Math.hypot(dx, dy);
        if (sp < 0.4) { ctx.fillRect(x[i] - 0.65, y[i] - 0.65, 1.3, 1.3); continue; }
        const L = Math.min(3, 0.8 + sp * 0.6) / sp;
        ctx.moveTo(x[i] - dx * L, y[i] - dy * L); ctx.lineTo(x[i] + dx * L * 0.3, y[i] + dy * L * 0.3);
      }
      ctx.lineWidth = 1.2; ctx.lineCap = 'round'; ctx.strokeStyle = c.inkA(0.75);
      ctx.stroke();
    }
  }

  /* ---------------- journey: scenes drawn by a swarm that runs between them as a tiger ---------------- */

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
    static caption = 'scenes drawn by a murmuration';
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
      ctx.globalAlpha = Math.min(1, (this.age || 0) / 1.5);   // fade in on first load
      if (this.phase === 'hold') {                             // moving parts stay crisp dots
        const { w, h, c, n, x, y } = this;
        ctx.fillStyle = c.paperA(1); ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = c.inkA(0.85);
        for (let i = 0; i < n; i++) ctx.fillRect(x[i] - 0.65, y[i] - 0.65, 1.3, 1.3);
      } else Evolve.prototype.draw.call(this, ctx);
      ctx.globalAlpha = 1;
    }
  }

  const RENDERERS = { topo: Topo, slime: Slime, flock: Flock, coral: Coral, rain: Rain, reveal: Reveal, stipple: Stipple, murmur: Murmur, evolve: Evolve, journey: Journey };

  /* ---------------- harness ---------------- */

  function mount(root) {
    const Renderer = RENDERERS[root.dataset.viz];
    if (!Renderer) return;
    const canvas = document.createElement('canvas');
    root.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const H = parseInt(root.dataset.height, 10) || 200;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0, active: false };
    let r = null, w = 0, visible = true, last = performance.now();

    const caption = root.closest('figure')?.querySelector('.viz-caption');
    if (caption && !caption.textContent.trim()) caption.textContent = root.dataset.caption || Renderer.caption;
    let image = null;

    function build() {
      w = root.clientWidth;
      if (!w) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      r = new Renderer({
        w, h: H, colors: readColors(), image,
        focus: root.dataset.focus ? +root.dataset.focus : 0.5, shape: root.dataset.shape,
        invert: 'invert' in root.dataset, scenes: root.dataset.scenes,
      });
      // reduced motion shows one settled frame; ?warm=N fast-forwards N steps (handy for screenshots)
      if (reduceMotion && r.settle) r.settle();
      const warm = reduceMotion && !r.settle ? 240 : +new URLSearchParams(location.search).get('warm') || 0;
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
    // theme changes (system or the page's toggle): recolour in place when the renderer allows it
    const recolor = () => { if (r && r.c && !r.lut && !r.field) { Object.assign(r.c, readColors()); r.draw(ctx); } else build(); };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolor);
    document.addEventListener('themechange', recolor);
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

  document.querySelectorAll('[data-viz]').forEach(mount);
})();
