/* app.js — layered rendering + spirit simulation + probe charts */
(function () {
  'use strict';

  const T = window.Terrain;
  const W = T.W, H = T.H, PROBE_R = T.PROBE_R;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const clamp01 = v => clamp(v, 0, 1);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };

  // ---------------------------------------------------------------- state
  const state = { fog: 0.5, hum: 0.5, dens: 0.55, probe: null, hover: null, time: 0 };
  const view = { scale: 1, x: 0, y: 0, fit: 1, base: 1 };

  const stage = new Konva.Stage({
    container: 'stage',
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(2, window.devicePixelRatio || 1)
  });

  const terrainLayer = new Konva.Layer({ listening: false });
  const fogLayer = new Konva.Layer({ listening: false });
  const spiritLayer = new Konva.Layer({ listening: false });
  const markerLayer = new Konva.Layer();
  stage.add(terrainLayer, fogLayer, spiritLayer, markerLayer);

  // ---------------------------------------------------------------- height grid
  const GRID = 4;
  const GX = Math.round(W / GRID), GY = Math.round(H / GRID);
  const rawHz = new Float32Array((GX + 1) * (GY + 1));
  for (let j = 0; j <= GY; j++) for (let i = 0; i <= GX; i++) rawHz[j * (GX + 1) + i] = T.heightAt(i * GRID, j * GRID);

  // separable box blur to tame the fine noise before shading / contours
  function blur(src, passes, rad) {
    const w = GX + 1, h = GY + 1;
    let a = Float32Array.from(src), b = new Float32Array(a.length);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let s = 0, n = 0;
          for (let k = -rad; k <= rad; k++) { const ii = i + k; if (ii < 0 || ii >= w) continue; s += a[j * w + ii]; n++; }
          b[j * w + i] = s / n;
        }
      }
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          let s = 0, n = 0;
          for (let k = -rad; k <= rad; k++) { const jj = j + k; if (jj < 0 || jj >= h) continue; s += b[jj * w + i]; n++; }
          a[j * w + i] = s / n;
        }
      }
    }
    return a;
  }
  const hz = blur(rawHz, 2, 2);
  const hSmooth = (i, j) => hz[clamp(j, 0, GY) * (GX + 1) + clamp(i, 0, GX)];

  function sampleSmooth(wx, wy) {
    const fi = wx / GRID, fj = wy / GRID;
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const ti = fi - i0, tj = fj - j0;
    const a = hSmooth(i0, j0), b = hSmooth(i0 + 1, j0), c = hSmooth(i0, j0 + 1), d = hSmooth(i0 + 1, j0 + 1);
    return lerp(lerp(a, b, ti), lerp(c, d, ti), tj);
  }

  // ---------------------------------------------------------------- terrain bake
  // 1.25x is enough for a painted look at fit zoom; the image is smoothed by
  // bilinear sampling and the dapple layer, so the pixel loop stays cheap.
  const BAKE = 1.25;
  function bakeTerrain() {
    const w = Math.round(W * BAKE), h = Math.round(H * BAKE);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(w, h);
    const d = img.data;

    // forest-floor palette: wet hollow -> moss -> dry leaf -> pale stone
    const stops = [
      [0.00, 9, 26, 30],
      [0.10, 11, 33, 34],
      [0.20, 15, 44, 40],
      [0.30, 21, 55, 45],
      [0.40, 28, 66, 50],
      [0.50, 38, 78, 55],
      [0.60, 52, 90, 59],
      [0.70, 71, 102, 65],
      [0.79, 98, 112, 72],
      [0.87, 132, 124, 84],
      [0.94, 172, 146, 104],
      [1.00, 208, 180, 136]
    ];
    const G = 22;
    const ramps = [];
    for (let k = 0; k < stops.length; k++) {
      const s = stops[k];
      ramps.push([s[0], s[1] * G, s[2] * G, s[3] * G]);
    }
    function ramp(t, out) {
      let k = 1;
      while (k < ramps.length - 1 && ramps[k][0] < t) k++;
      const a = ramps[k - 1], b = ramps[k];
      const u = (t - a[0]) / (b[0] - a[0] || 1);
      out[0] = (a[1] + (b[1] - a[1]) * u) / G;
      out[1] = (a[2] + (b[2] - a[2]) * u) / G;
      out[2] = (a[3] + (b[3] - a[3]) * u) / G;
    }
    const col = [0, 0, 0];
    const LX = -0.48, LY = -0.74, LZ = 0.47;

    // Sample the smoothed grid bilinearly from plain arrays — the per-pixel
    // helper costs four function calls each, which dominated the bake.
    const BX = GX + 1, BY = GY + 1;
    function sampleArr(arr, wx, wy) {
      const fi = wx / GRID, fj = wy / GRID;
      const i0 = fi | 0, j0 = fj | 0;
      const ti = fi - i0, tj = fj - j0;
      const ci0 = i0 < 0 ? 0 : i0 > GX ? GX : i0;
      const cj0 = j0 < 0 ? 0 : j0 > GY ? GY : j0;
      const ci1 = ci0 < GX ? ci0 + 1 : GX;
      const cj1 = cj0 < GY ? cj0 + 1 : GY;
      const a = arr[cj0 * BX + ci0], b = arr[cj0 * BX + ci1];
      const c = arr[cj1 * BX + ci0], e = arr[cj1 * BX + ci1];
      return (a + (b - a) * ti) + ((c + (e - c) * ti) - (a + (b - a) * ti)) * tj;
    }

    // canopy dapple, two scales
    const dap1 = new Float32Array(BX * BY), dap2 = new Float32Array(BX * BY);
    const wet = new Float32Array(BX * BY), basinF = new Float32Array(BX * BY);
    for (let j = 0; j < BY; j++) for (let i = 0; i < BX; i++) {
      const x = i * GRID, y = j * GRID;
      const k = j * BX + i;
      dap1[k] = T.fbm(x / 300 + 40, y / 300 + 90, 3);
      dap2[k] = T.fbm(x / 74 + 11, y / 74 + 280, 3);
      wet[k] = T.veinDist(x, y);
      basinF[k] = T.basinField(x, y);
    }

    for (let py = 0; py < h; py++) {
      const wy = (py + 0.5) / BAKE;
      for (let px = 0; px < w; px++) {
        const wx = (px + 0.5) / BAKE;

        const hh = sampleArr(hz, wx, wy);
        // broad normal from smoothed terrain, modest gain so descents don't band
        const gx = (sampleArr(hz, wx + 4, wy) - sampleArr(hz, wx - 4, wy)) * 0.125;
        const gy = (sampleArr(hz, wx, wy + 4) - sampleArr(hz, wx, wy - 4)) * 0.125;
        const ex = -gx * 95, ey = -gy * 95;
        const nl = Math.sqrt(ex * ex + ey * ey + 1);
        const nx = ex / nl, ny = ey / nl, nz = 1 / nl;
        let lam = nx * LX + ny * LY + nz * LZ;
        lam = clamp01((lam + 0.12) / 1.04);
        const shade = 0.52 + 0.70 * Math.pow(lam, 0.78);

        const d1 = sampleArr(dap1, wx, wy);
        const d2 = sampleArr(dap2, wx, wy);
        const vd = sampleArr(wet, wx, wy);
        const light = shade * (0.90 + 0.24 * (d1 - 0.5) + 0.16 * (d2 - 0.5) * 2);

        ramp(hh, col);
        let r = col[0], g = col[1], b = col[2];

        // leaf-litter warmth on dry high ground
        const dry = smooth((hh - 0.55) / 0.35) * smooth((d2 - 0.4) / 0.4);
        r += dry * 30; g += dry * 20; b += dry * 6;

        // damp darkening and a faint cold sheen near the veins
        const damp = Math.exp(-(vd * vd) / (2 * 46 * 46));
        r *= 1 - 0.30 * damp; g *= 1 - 0.20 * damp; b *= 1 - 0.10 * damp;
        g += damp * 5; b += damp * 6;

        r *= light; g *= light; b *= light;

        // basin hollows read cooler and darker
        const bf = sampleArr(basinF, wx, wy);
        const bd = 1 - 0.22 * bf;
        r *= bd; g *= bd * 1.015; b *= bd * 1.05;

        // light vignette toward the frame edge (not a black mask)
        const edgeX = Math.min(wx, W - wx) / W, edgeY = Math.min(wy, H - wy) / H;
        const edge = smooth(Math.min(edgeX, edgeY) / 0.10);
        const atm = 0.74 + 0.26 * edge;

        const o = (py * w + px) * 4;
        d[o] = r * atm;
        d[o + 1] = g * atm;
        d[o + 2] = b * atm;
        d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // speckle film: a small tiling pattern is far cheaper than a per-pixel pass
    const tile = document.createElement('canvas');
    tile.width = tile.height = 128;
    const tg = tile.getContext('2d');
    const tid = tg.createImageData(128, 128);
    let seed = 991;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 128 * 128; i++) {
      const v = 128 + (rnd() - 0.5) * 90;
      tid.data[i * 4] = v; tid.data[i * 4 + 1] = v; tid.data[i * 4 + 2] = v;
      tid.data[i * 4 + 3] = 20 + rnd() * 26;
    }
    tg.putImageData(tid, 0, 0);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = ctx.createPattern(tile, 'repeat');
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // organic mottling: coarse noise fields drawn small, then scaled up with a blur
    function noiseCanvas(nw, nh, scale, oct, seedOff, contrast) {
      const nc = document.createElement('canvas');
      nc.width = nw; nc.height = nh;
      const nctx = nc.getContext('2d');
      const nim = nctx.createImageData(nw, nh);
      const t0 = 1; // noise tile span in world units
      for (let j = 0; j < nh; j++) {
        for (let i = 0; i < nw; i++) {
          let v = T.fbm(i * scale + seedOff, j * scale + seedOff * 0.7, oct);
          v = clamp01((v - 0.5) * contrast + 0.5);
          const g = 128 + (v - 0.5) * 255;
          const o = (j * nw + i) * 4;
          nim.data[o] = g; nim.data[o + 1] = g; nim.data[o + 2] = g; nim.data[o + 3] = 255;
        }
      }
      nctx.putImageData(nim, 0, 0);
      const up = document.createElement('canvas');
      up.width = w; up.height = h;
      const uctx = up.getContext('2d');
      uctx.imageSmoothingEnabled = true;
      uctx.filter = 'blur(6px)';
      uctx.drawImage(nc, 0, 0, w, h);
      uctx.filter = 'none';
      return up;
    }
    // broad moss patches
    const mottle = noiseCanvas(240, 150, 0.05, 3, 3, 1.5);
    const grain = noiseCanvas(300, 188, 0.18, 2, 61, 1.9);
    const wash = noiseCanvas(160, 100, 0.035, 2, 133, 1.3);
    ctx.globalCompositeOperation = 'overlay';
    ctx.globalAlpha = 0.30;
    ctx.drawImage(mottle, 0, 0, w, h);
    ctx.globalAlpha = 0.18;
    ctx.drawImage(grain, 0, 0, w, h);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.15;
    ctx.drawImage(wash, 0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    return cv;
  }

  // ---- contours (marching squares on the smoothed grid) ----
  function buildContours(levels) {
    const out = [];
    for (const lev of levels) {
      const arr = [];
      for (let j = 0; j < GY; j++) {
        for (let i = 0; i < GX; i++) {
          const v0 = hSmooth(i, j), v1 = hSmooth(i + 1, j), v2 = hSmooth(i + 1, j + 1), v3 = hSmooth(i, j + 1);
          const mx = Math.max(v0, v1, v2, v3), mn = Math.min(v0, v1, v2, v3);
          if (mx - mn < 0.004) continue;
          let code = 0;
          if (v0 > lev) code |= 1;
          if (v1 > lev) code |= 2;
          if (v2 > lev) code |= 4;
          if (v3 > lev) code |= 8;
          if (code === 0 || code === 15) continue;
          const x0 = i * GRID, y0 = j * GRID;
          const pts = [];
          if (((code & 1) !== 0) !== ((code & 2) !== 0)) pts.push(x0 + (lev - v0) / (v1 - v0) * GRID, y0);
          if (((code & 2) !== 0) !== ((code & 4) !== 0)) pts.push(x0 + GRID, y0 + (lev - v1) / (v2 - v1) * GRID);
          if (((code & 4) !== 0) !== ((code & 8) !== 0)) pts.push(x0 + (1 - (lev - v2) / (v3 - v2)) * GRID, y0 + GRID);
          if (((code & 8) !== 0) !== ((code & 1) !== 0)) pts.push(x0, y0 + (1 - (lev - v3) / (v0 - v3)) * GRID);
          if (pts.length >= 4) {
            arr.push(pts[0], pts[1], pts[2], pts[3]);
            if (pts.length >= 8) arr.push(pts[4], pts[5], pts[6], pts[7]);
          }
        }
      }
      out.push({ level: lev, data: new Float32Array(arr) });
    }
    return out;
  }
  const minorContours = buildContours([0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.80, 0.88]);
  const majorContours = buildContours([0.24, 0.40, 0.56, 0.72, 0.88]);

  // ---- tree glyphs ----
  const trees = (function () {
    const r = T.mulberry32(5150);
    const list = [];
    for (let k = 0; k < 9000; k++) {
      const x = 14 + r() * (W - 28), y = 14 + r() * (H - 28);
      const h = T.heightAt(x, y);
      const vd = T.veinDist(x, y);
      // density: heavy in the wooded middle slopes, thin on the bare crest and in open water
      let p = 0.34 + 0.5 * Math.sin(Math.min(1, Math.max(0, (h - 0.12) / 0.78)) * Math.PI);
      p *= 0.55 + 0.9 * T.fbm(x / 90 + 5, y / 90 + 21, 3);
      if (vd < 26) continue;
      if (r() > p) continue;
      const near = 1 - 0.5 * Math.max(0, (h - 0.7) / 0.3);
      list.push({
        x, y,
        s: (5 + r() * 7) * near,
        lean: (r() - 0.5) * 0.6,
        a: (0.055 + r() * 0.10) * near,
        tone: r() < 0.18 ? 1 : 0
      });
    }
    return list;
  })();

  // ---- fog tiers ----
  const fogTiers = (function () {
    // density field at quarter resolution, then three thresholded canvases
    const q = 4, fw = W / q, fh = H / q;
    const dens = new Float32Array(fw * fh);
    for (let j = 0; j < fh; j++) {
      for (let i = 0; i < fw; i++) {
        const x = i * q + q / 2, y = j * q + q / 2;
        const hh = sampleSmooth(x, y);
        // fog pools in hollows; the field is ragged rather than a clean pool edge
        let dd = clamp01((0.62 - hh) / 0.40);
        dd = Math.pow(dd, 1.15);
        const ragged = T.fbm(x / 120 + 17, y / 120 + 53, 4);
        dd *= 0.45 + 0.95 * ragged;
        dd *= 0.55 + 0.95 * T.basinField(x, y);
        dens[j * fw + i] = clamp01(dd);
      }
    }
    const make = (threshold, soft, blurPx) => {
      const cv = document.createElement('canvas');
      cv.width = fw; cv.height = fh;
      const c = cv.getContext('2d');
      const im = c.createImageData(fw, fh);
      for (let i = 0; i < fw * fh; i++) {
        const v = clamp01((dens[i] - threshold) / soft);
        im.data[i * 4] = 208; im.data[i * 4 + 1] = 230; im.data[i * 4 + 2] = 224;
        im.data[i * 4 + 3] = Math.round(v * v * (3 - 2 * v) * 255);
      }
      c.putImageData(im, 0, 0);
      const big = document.createElement('canvas');
      big.width = W; big.height = H;
      const bc = big.getContext('2d');
      bc.filter = 'blur(' + blurPx + 'px)';
      bc.imageSmoothingEnabled = true;
      bc.drawImage(cv, 0, 0, W, H);
      bc.filter = 'none';
      return big;
    };
    return [
      { cv: make(0.04, 0.62, 16), a: 0.055 },
      { cv: make(0.30, 0.44, 12), a: 0.15 },
      { cv: make(0.58, 0.38, 9), a: 0.28 }
    ];
  })();

  // ---------------------------------------------------------------- terrain nodes
  const terrainImg = new Konva.Image({ image: bakeTerrain(), x: 0, y: 0, width: W, height: H, listening: false });
  terrainLayer.add(terrainImg);

  const contourShape = new Konva.Shape({
    listening: false,
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      c.lineCap = 'round';
      const draw = (set, color, width) => {
        c.strokeStyle = color; c.lineWidth = width; c.beginPath();
        for (const s of set) {
          const a = s.data;
          for (let k = 0; k < a.length; k += 4) { c.moveTo(a[k], a[k + 1]); c.lineTo(a[k + 2], a[k + 3]); }
        }
        c.stroke();
      };
      draw(minorContours, 'rgba(196,224,204,0.048)', 0.75);
      draw(majorContours, 'rgba(214,238,216,0.10)', 1.05);
    }
  });
  terrainLayer.add(contourShape);

  const waterShape = new Konva.Shape({
    listening: false,
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      c.lineCap = 'round'; c.lineJoin = 'round';
      const paths = T.veins.map(v => {
        const p = new Path2D();
        p.moveTo(v[0][0], v[0][1]);
        for (let i = 1; i < v.length - 1; i++) {
          const mx = (v[i][0] + v[i + 1][0]) / 2, my = (v[i][1] + v[i + 1][1]) / 2;
          p.quadraticCurveTo(v[i][0], v[i][1], mx, my);
        }
        const l = v[v.length - 1];
        p.lineTo(l[0], l[1]);
        return p;
      });
      const passes = [
        [30, 'rgba(12,44,44,0.35)'],
        [13, 'rgba(30,92,86,0.32)'],
        [4.5, 'rgba(78,168,150,0.24)'],
        [1.3, 'rgba(168,232,214,0.38)']
      ];
      for (const [wd, col] of passes) {
        c.strokeStyle = col; c.lineWidth = wd;
        for (const p of paths) c.stroke(p);
      }
      c.strokeStyle = 'rgba(196,244,228,0.16)';
      c.lineWidth = 0.8;
      c.beginPath();
      for (const v of T.veins) {
        for (let i = 0; i < v.length - 1; i++) {
          const x1 = v[i][0], y1 = v[i][1], x2 = v[i + 1][0], y2 = v[i + 1][1];
          const len = Math.hypot(x2 - x1, y2 - y1);
          const n = Math.floor(len / 42);
          for (let k = 0; k < n; k++) {
            const x = lerp(x1, x2, (k + 0.4) / n), y = lerp(y1, y2, (k + 0.4) / n);
            c.moveTo(x - 2.6, y + 1.2);
            c.lineTo(x + 2.6, y - 1.2);
          }
        }
      }
      c.stroke();
    }
  });
  terrainLayer.add(waterShape);

  const treeShape = new Konva.Shape({
    listening: false,
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      c.lineCap = 'round';
      c.lineWidth = 0.85;
      for (const t of trees) {
        c.strokeStyle = t.tone
          ? `rgba(216,198,150,${t.a * 0.9})`
          : `rgba(176,208,172,${t.a})`;
        const s = t.s;
        c.beginPath();
        // a small trident: two side limbs and a leader
        c.moveTo(t.x, t.y);
        c.lineTo(t.x - s * 0.36 + t.lean * s * 0.7, t.y - s * 0.92);
        c.moveTo(t.x, t.y);
        c.lineTo(t.x + s * 0.36 + t.lean * s * 0.7, t.y - s * 0.92);
        c.moveTo(t.x, t.y);
        c.lineTo(t.x + t.lean * s, t.y - s * 0.48);
        // a hint of canopy
        c.moveTo(t.x - s * 0.2 + t.lean * s * 0.8, t.y - s * 0.70);
        c.lineTo(t.x + s * 0.2 + t.lean * s * 0.8, t.y - s * 0.70);
        c.stroke();
      }
    }
  });
  terrainLayer.add(treeShape);

  // ---------------------------------------------------------------- fog layer
  const fogShape = new Konva.Shape({
    listening: false,
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      const f = state.fog;
      const t = state.time;

      // tier 0 always drifts; higher tiers fade in with fog strength
      const weights = [
        weightsOf(0, f),
        weightsOf(1, f),
        weightsOf(2, f)
      ];
      const dx = [Math.sin(t * 0.035) * 18, Math.cos(t * 0.021 + 1.2) * 26, Math.sin(t * 0.017 + 2.1) * 32];
      const dy = [Math.cos(t * 0.028) * 11, Math.sin(t * 0.019 + 0.4) * 15, Math.cos(t * 0.014 + 1.7) * 21];

      for (let i = 0; i < 3; i++) {
        const tier = fogTiers[i];
        const a = tier.a * weights[i];
        if (a < 0.002) continue;
        c.globalAlpha = a;
        c.drawImage(tier.cv, dx[i], dy[i], W, H);
      }
      c.globalAlpha = 1;
    }
  });
  function weightsOf(tier, f) {
    if (tier === 0) return 1;
    if (tier === 1) return smooth((f - 0.12) / 0.55);
    return smooth((f - 0.45) / 0.5);
  }
  fogLayer.add(fogShape);

  // ---------------------------------------------------------------- spirits
  const CLS_KEYS = ['valley', 'ridge', 'water'];
  const COL = { valley: [127, 230, 198], ridge: [244, 202, 138], water: [162, 218, 242] };
  function makeSprite(rgb) {
    const s = 72;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const c = cv.getContext('2d');
    const m = s / 2;
    // a small lantern-shape: soft aura, then a teardrop body and a warm core
    const g = c.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0.00, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.55)`);
    g.addColorStop(0.18, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.22)`);
    g.addColorStop(0.48, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.07)`);
    g.addColorStop(1.00, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);

    // body: tapered wisp
    c.beginPath();
    c.moveTo(m, m - 11);
    c.bezierCurveTo(m + 7.5, m - 4, m + 6, m + 5, m, m + 10);
    c.bezierCurveTo(m - 6, m + 5, m - 7.5, m - 4, m, m - 11);
    c.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.32)`;
    c.fill();

    const core = c.createRadialGradient(m, m - 1, 0, m, m - 1, 5.2);
    core.addColorStop(0, 'rgba(255,255,252,1)');
    core.addColorStop(0.42, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0.95)`);
    core.addColorStop(1, `rgba(${rgb[0]},${rgb[1]},${rgb[2]},0)`);
    c.fillStyle = core;
    c.beginPath();
    c.arc(m, m - 1, 5.2, 0, Math.PI * 2);
    c.fill();
    return cv;
  }
  const sprites = { valley: makeSprite(COL.valley), ridge: makeSprite(COL.ridge), water: makeSprite(COL.water) };

  const spirits = [];
  let targetN = T.N_TOTAL(state.dens);
  const RNG = T.mulberry32(8675309);

  function anchorFor(cls) { return T.sites[T.pick(T.cls[CLS_KEYS[cls]], T.cw[CLS_KEYS[cls]])]; }

  // physics constants (tuned headlessly — see the sim harness)
  const PHYS = {
    sepBase: 24, repel: 180, spring: 4.2, dampBase: 0.90, maxSpeed: 220, wander: 10,
    biasAmt: 0.30, periodMin: 4.5, periodMax: 8.0, spread: 0.55
  };

  function makeSpirit(fadeIn) {
    const r = RNG;
    const anchor = [anchorFor(0), anchorFor(1), anchorFor(2)];
    const p0 = anchor[0];
    return {
      x: p0.x + (r() - 0.5) * 80,
      y: p0.y + (r() - 0.5) * 80,
      vx: 0, vy: 0,
      u: r(),
      isWater: r() < 0.5,
      vu: r(),
      bias: [(1 - PHYS.biasAmt / 2) + r() * PHYS.biasAmt,
             (1 - PHYS.biasAmt / 2) + r() * PHYS.biasAmt,
             (1 - PHYS.biasAmt / 2) + r() * PHYS.biasAmt],
      anchor,
      period: PHYS.periodMin + r() * (PHYS.periodMax - PHYS.periodMin),
      phase: r(),
      wob: r() * 100,
      pole: 0,
      cls: 0,
      size: 0.8 + r() * 0.5,
      alpha: fadeIn ? 0 : 1,
      dying: false
    };
  }

  function syncPopulation() {
    targetN = T.N_TOTAL(state.dens);
    // Count only living spirits: ones already fading out still occupy the
    // array, and treating them as population would starve the next increase.
    let alive = 0;
    for (let i = 0; i < spirits.length; i++) if (!spirits[i].dying) alive++;
    while (alive < targetN) { spirits.push(makeSpirit(true)); alive++; }
    let excess = alive - targetN;
    for (let i = spirits.length - 1; i >= 0 && excess > 0; i--) {
      if (!spirits[i].dying) { spirits[i].dying = true; excess--; }
    }
  }

  const HASH = 56;
  const grid = new Map();
  function rebuildGrid() {
    grid.clear();
    for (let i = 0; i < spirits.length; i++) {
      const p = spirits[i];
      if (p.dying) continue;
      const key = (((p.x / HASH) | 0) * 73856093) ^ (((p.y / HASH) | 0) * 19349663);
      let cell = grid.get(key);
      if (!cell) { cell = []; grid.set(key, cell); }
      cell.push(p);
    }
  }

  function stepSpirits(dt, now) {
    const damp = Math.pow(PHYS.dampBase, dt * 60);
    const N = Math.max(1, spirits.length);
    const sep = PHYS.sepBase * clamp(Math.sqrt(320 / N), 0.6, 1.5);
    rebuildGrid();

    for (const p of spirits) {
      if (p.dying) {
        p.alpha = Math.max(0, p.alpha - dt * 2.2);
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= damp; p.vy *= damp;
        continue;
      }
      p.alpha = Math.min(1, p.alpha + dt * 1.6);

      const bs = T.classShares(state.fog, state.hum, { v: p.bias[0], r: p.bias[1], w: p.bias[2] });
      let tx, ty;

      if (p.u < bs.w) {
        p.cls = 2;
        const a = p.anchor[2];
        tx = a.x; ty = a.y;
      } else {
        p.cls = 0;
        // time-share between the valley and ridge anchors
        const landV = bs.v / (bs.v + bs.r + 1e-9);
        const duty = clamp(0.5 + (landV - p.vu) / PHYS.spread, 0, 1);
        const ph = (now / p.period + p.phase) % 1;
        const pole = ph < duty ? 0 : 1;
        if (pole !== p.pole) { p.pole = pole; }
        const a = p.anchor[pole];
        tx = a.x; ty = a.y;
      }

      let ax = (tx - p.x) * PHYS.spring + Math.sin(now * 0.9 + p.wob) * PHYS.wander;
      let ay = (ty - p.y) * PHYS.spring + Math.cos(now * 0.8 + p.wob) * PHYS.wander;

      const ci = (p.x / HASH) | 0, cj = (p.y / HASH) | 0;
      for (let oi = -1; oi <= 1; oi++) {
        for (let oj = -1; oj <= 1; oj++) {
          const cell = grid.get(((ci + oi) * 73856093) ^ ((cj + oj) * 19349663));
          if (!cell) continue;
          for (let k = 0; k < cell.length; k++) {
            const q = cell[k];
            if (q === p) continue;
            const dx = p.x - q.x, dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > sep * sep || d2 < 0.001) continue;
            const d = Math.sqrt(d2);
            const f = PHYS.repel * (1 - d / sep);
            ax += (dx / d) * f;
            ay += (dy / d) * f;
          }
        }
      }

      p.vx = (p.vx + ax * dt) * damp;
      p.vy = (p.vy + ay * dt) * damp;
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > PHYS.maxSpeed) { p.vx = p.vx / sp * PHYS.maxSpeed; p.vy = p.vy / sp * PHYS.maxSpeed; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < 6) { p.x = 6; p.vx = Math.abs(p.vx) * 0.4; }
      if (p.x > W - 6) { p.x = W - 6; p.vx = -Math.abs(p.vx) * 0.4; }
      if (p.y < 6) { p.y = 6; p.vy = Math.abs(p.vy) * 0.4; }
      if (p.y > H - 6) { p.y = H - 6; p.vy = -Math.abs(p.vy) * 0.4; }
    }

    for (let i = spirits.length - 1; i >= 0; i--) {
      if (spirits[i].dying && spirits[i].alpha <= 0.01) spirits.splice(i, 1);
    }
  }

  function spiritKey(p) {
    if (p.cls === 2) return 'water';
    return p.pole === 0 ? 'valley' : 'ridge';
  }

  const spiritShape = new Konva.Shape({
    listening: false,
    sceneFunc(ctx) {
      const c = ctx._context || ctx;
      const now = state.time;
      const fogDim = 1 - 0.45 * state.fog;
      c.globalCompositeOperation = 'lighter';
      for (const p of spirits) {
        if (p.alpha <= 0.01) continue;
        const key = spiritKey(p);
        const sp = sprites[key];
        const sz = 40 * p.size;
        const tw = 0.70 + 0.30 * Math.sin(now * 1.7 + p.wob);
        c.globalAlpha = p.alpha * tw * fogDim;
        c.drawImage(sp, p.x - sz / 2, p.y - sz / 2, sz, sz);

        const spd = Math.hypot(p.vx, p.vy);
        if (spd > 26) {
          c.globalAlpha = p.alpha * fogDim * 0.26;
          c.strokeStyle = `rgba(${COL[key][0]},${COL[key][1]},${COL[key][2]},1)`;
          c.lineWidth = 1;
          c.beginPath();
          c.moveTo(p.x, p.y - 1);
          c.lineTo(p.x - p.vx * 0.085, p.y - 1 - p.vy * 0.085);
          c.stroke();
        }
      }
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha = 1;
    }
  });
  spiritLayer.add(spiritShape);

  // ---------------------------------------------------------------- probes
  const probeMeta = {
    valley: { name: '谷底', index: '壹', sub: '洼地积雾 · 沉于低处', color: '#7fe6c6' },
    ridge: { name: '坡脊', index: '贰', sub: '风口疏雾 · 立于高处', color: '#f0c483' },
    water: { name: '水脉', index: '叁', sub: '湿气成带 · 沿流而列', color: '#9fd7ef' }
  };
  const markers = {};

  function buildMarker(key) {
    const m = probeMeta[key];
    const pos = T.probes[key];
    const g = new Konva.Group({ x: pos.x, y: pos.y });
    const ring = new Konva.Circle({ radius: PROBE_R, stroke: 'rgba(226,216,188,0.20)', strokeWidth: 1, dash: [4, 9], listening: false });
    const halo = new Konva.Circle({ radius: 21, stroke: m.color, strokeWidth: 1, opacity: 0.28, listening: false });
    const dot = new Konva.Circle({ radius: 3, fill: m.color, listening: false, shadowColor: m.color, shadowBlur: 10 });
    const cross = new Konva.Shape({
      listening: false,
      sceneFunc(ctx) {
        const c = ctx._context || ctx;
        c.strokeStyle = 'rgba(236,229,210,0.45)';
        c.lineWidth = 1;
        c.beginPath();
        c.moveTo(-8, 0); c.lineTo(8, 0); c.moveTo(0, -8); c.lineTo(0, 8);
        c.stroke();
      }
    });
    const labelGroup = new Konva.Group({ listening: false });
    const label = new Konva.Text({
      text: m.name, fontSize: 12.5, fontFamily: '"Noto Serif SC", serif',
      fill: '#ece5d2', letterSpacing: 3,
      shadowColor: 'rgba(0,0,0,0.95)', shadowBlur: 9, shadowOffsetY: 1
    });
    const count = new Konva.Text({
      text: '', fontSize: 10.5, fontFamily: 'ui-monospace, monospace',
      fill: m.color, letterSpacing: 1, shadowColor: 'rgba(0,0,0,0.9)', shadowBlur: 6
    });
    labelGroup.add(label, count);
    const hit = new Konva.Circle({ radius: 34, fill: 'rgba(0,0,0,0.001)', listening: true });
    g.add(ring, halo, cross, dot, hit, labelGroup);

    hit.on('mouseenter', () => { state.hover = key; document.getElementById('stage').classList.add('hot'); });
    hit.on('mouseleave', () => { if (state.hover === key) state.hover = null; document.getElementById('stage').classList.remove('hot'); });
    hit.on('mousedown touchstart', ev => { ev.cancelBubble = true; });
    hit.on('click tap', ev => { ev.cancelBubble = true; selectProbe(state.probe === key ? null : key); });

    g.ring = ring; g.halo = halo; g.dot = dot; g.labelGroup = labelGroup; g.label = label; g.count = count;
    g.probeKey = key;
    return g;
  }
  for (const key of Object.keys(T.probes)) {
    const g = buildMarker(key);
    markers[key] = g;
    markerLayer.add(g);
  }

  function layoutMarker(g) {
    const s = view.scale;
    g.labelGroup.scale({ x: 1 / s, y: 1 / s });
    g.labelGroup.position({ x: 0, y: -(PROBE_R + 12 / s) });
    g.label.offsetX(g.label.width() / 2);
    g.label.y(0);
    g.count.offsetX(g.count.width() / 2);
    g.count.y(15);
  }

  function countAt(key) {
    const p = T.probes[key];
    let n = 0;
    for (const q of spirits) {
      if (q.dying) continue;
      const dx = q.x - p.x, dy = q.y - p.y;
      if (dx * dx + dy * dy < PROBE_R * PROBE_R) n++;
    }
    return n;
  }

  // ---------------------------------------------------------------- view
  function applyView() {
    stage.scale({ x: view.scale, y: view.scale });
    stage.position({ x: view.x, y: view.y });
    for (const k in markers) layoutMarker(markers[k]);
    stage.batchDraw();
  }

  function fitView(keepRel) {
    const vw = stage.width(), vh = stage.height();
    const rel = keepRel && view.fit ? view.scale / view.fit : 1;
    // cover the frame: a map that stops short of the edge reads as an image,
    // not as ground you can walk on
    const s = Math.max(vw / W, vh / H) * 1.02 * rel;
    view.fit = s / rel;
    view.scale = s;
    view.x = vw / 2 - (W / 2) * s;
    view.y = vh / 2 - (H / 2) * s + (vw < 900 ? -vh * 0.04 : 0);
    applyView();
    updateStatusZoom();
  }
  function updateStatusZoom() {
    const el = document.getElementById('stZoom');
    if (el) el.textContent = (view.scale / view.fit).toFixed(2) + '×';
  }

  window.addEventListener('resize', () => {
    stage.width(window.innerWidth);
    stage.height(window.innerHeight);
    fitView(true);
    resizeCharts();
    scheduleCharts();
  });

  // Pan is handled natively (mouse + touch) so the same code path owns the
  // gesture and pinch can pre-empt it; markers keep their own Konva handlers.
  let dragging = false, lastX = 0, lastY = 0, activeId = null;
  const stageEl = stage.container();
  const pointers = new Map();

  function isMarkerTarget(el, clientX, clientY) {
    // Konva paints to a canvas, so ask the scene graph what is under the pointer
    const rect = stageEl.getBoundingClientRect();
    const hit = stage.getIntersection({ x: clientX - rect.left, y: clientY - rect.top });
    let n = hit;
    while (n) {
      if (n.getParent && n.getParent() && n.getParent().probeKey) return true;
      if (n.probeKey) return true;
      n = n.getParent ? n.getParent() : null;
    }
    return false;
  }

  stageEl.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isMarkerTarget(e.target, e.clientX, e.clientY)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX; lastY = e.clientY;
      stageEl.classList.add('drag');
      if (e.pointerType !== 'mouse') stageEl.setPointerCapture(e.pointerId);
    } else if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      pinch = {
        d: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        scale: view.scale,
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
        x: view.x, y: view.y
      };
    }
  });

  stageEl.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      const next = clamp(pinch.scale * (d / pinch.d), view.fit * 0.72, view.fit * 7);
      const wx = (pinch.cx - pinch.x) / pinch.scale;
      const wy = (pinch.cy - pinch.y) / pinch.scale;
      view.scale = next;
      view.x = cx - wx * next;
      view.y = cy - wy * next;
      clampView();
      applyView();
      updateStatusZoom();
      return;
    }
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    view.x += dx; view.y += dy;
    clampView();
    stage.position({ x: view.x, y: view.y });
    stage.batchDraw();
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      dragging = false;
      stageEl.classList.remove('drag');
    }
  }
  stageEl.addEventListener('pointerup', endPointer);
  stageEl.addEventListener('pointercancel', endPointer);

  function clampView() {
    const vw = stage.width(), vh = stage.height();
    const mw = W * view.scale, mh = H * view.scale;
    const mx = Math.min(vw * 0.4, mw * 0.5);
    const my = Math.min(vh * 0.4, mh * 0.5);
    view.x = clamp(view.x, mx - mw, vw - mx);
    view.y = clamp(view.y, my - mh, vh - my);
  }

  // Wheel zoom is bound natively: Konva's synthetic event payload differs
  // between versions, and we need the raw deltaY/clipboard coordinates anyway.
  stage.container().addEventListener('wheel', e => {
    e.preventDefault();
    const rect = stage.container().getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const old = view.scale;
    const dir = e.deltaY > 0 ? -1 : 1;
    const factor = Math.pow(1.0016, dir * Math.min(400, Math.abs(e.deltaY)));
    const next = clamp(old * factor, view.fit * 0.72, view.fit * 7);
    const wx = (px - view.x) / old;
    const wy = (py - view.y) / old;
    view.scale = next;
    view.x = px - wx * next;
    view.y = py - wy * next;
    clampView();
    applyView();
    updateStatusZoom();
    scheduleCharts();
  }, { passive: false });

  // pinch state shared with the pointer handlers above
  let pinch = null;

  // ---------------------------------------------------------------- UI
  const el = id => document.getElementById(id);
  const fogIn = el('fog'), humIn = el('hum'), densIn = el('dens');
  const fogOut = el('fogOut'), humOut = el('humOut'), densOut = el('densOut');

  function onControls() {
    state.fog = +fogIn.value;
    state.hum = +humIn.value;
    state.dens = +densIn.value;
    fogOut.textContent = state.fog.toFixed(2);
    humOut.textContent = state.hum.toFixed(2);
    densOut.textContent = state.dens.toFixed(2);
    syncPopulation();
    updateBalance();
    updateTicks();
    updateStatusTotal();
    scheduleCharts();
    if (state.probe) updateCardMeta();
  }
  fogIn.addEventListener('input', onControls);
  humIn.addEventListener('input', onControls);
  densIn.addEventListener('input', onControls);

  function updateBalance() {
    const b = T.balance(state.fog, state.hum);
    const needle = el('balNeedle');
    needle.style.left = (b.ratio * 100).toFixed(1) + '%';
    const pctV = Math.round(b.ratio * 100);
    el('balLeft').textContent = '谷地偏好 ' + pctV + '%';
    el('balRight').textContent = '坡脊偏好 ' + (100 - pctV) + '%';
    const st = el('balState');
    const near = b.crit > 0.72;
    needle.classList.toggle('crit', near);
    st.classList.toggle('crit', near);
    st.textContent = near ? '临界 · 游移不决' : b.ratio > 0.5 ? '偏聚谷地' : '偏散坡脊';
  }

  function humCritical(fog) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      if (T.shares(fog, mid).shareV < 0.5) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  function updateTicks() {
    const ft = el('fogTick');
    ft.style.left = (T.criticalFog(state.hum) * 100).toFixed(2) + '%';
    ft.classList.add('on');
    const ht = el('humTick');
    ht.style.left = (humCritical(state.fog) * 100).toFixed(2) + '%';
    ht.classList.add('on');
  }

  el('btnCrit').addEventListener('click', () => {
    fogIn.value = T.criticalFog(state.hum);
    onControls();
  });
  el('btnFit').addEventListener('click', () => fitView(false));

  const chipWrap = el('chips');
  for (const key of Object.keys(probeMeta)) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.probe = key;
    b.innerHTML = '<i class="dot" style="background:' + probeMeta[key].color + '"></i>' + probeMeta[key].name;
    b.addEventListener('click', () => selectProbe(state.probe === key ? null : key));
    chipWrap.appendChild(b);
  }

  function selectProbe(key) {
    state.probe = key;
    el('probeCard').classList.toggle('on', !!key);
    for (const k in markers) {
      const g = markers[k], on = k === key;
      g.ring.stroke(on ? probeMeta[k].color : 'rgba(226,216,188,0.20)');
      g.ring.dash(on ? [2, 5] : [4, 9]);
      g.ring.strokeWidth(on ? 1.4 : 1);
      g.halo.opacity(on ? 0.8 : 0.28);
      g.dot.radius(on ? 4 : 3);
    }
    for (const chip of chipWrap.children) chip.classList.toggle('on', chip.dataset.probe === key);
    if (key) {
      const m = probeMeta[key];
      el('pcTag').textContent = '对照点 ' + m.index;
      el('pcName').textContent = m.name;
      el('pcName').style.color = m.color;
      el('pcSub').textContent = m.sub + ' · 坐标 ' + T.probes[key].x + ',' + T.probes[key].y;
      el('pcLive').style.color = m.color;
      el('stProbe').textContent = m.name;
      resizeCharts();
      updateCardMeta();
      drawCharts();
    } else {
      el('stProbe').textContent = '未选';
    }
    markerLayer.batchDraw();
  }

  function updateCardMeta() {
    if (!state.probe) return;
    el('capFog').textContent = '湿度 ' + state.hum.toFixed(2) + ' 下的剖面';
    el('capHum').textContent = '雾气 ' + state.fog.toFixed(2) + ' 下的剖面';
    el('pcExp').textContent = '期望 ' + T.expectedCount(state.probe, state.fog, state.hum, state.dens).toFixed(0);
    scheduleCharts();
  }
  el('pcClose').addEventListener('click', () => selectProbe(null));
  window.addEventListener('keydown', e => { if (e.key === 'Escape') selectProbe(null); });

  // ---------------------------------------------------------------- charts
  const chartFog = el('chartFog'), chartHum = el('chartHum');
  let chartDirty = false, chartRaf = 0;
  function scheduleCharts() {
    chartDirty = true;
    if (!chartRaf) chartRaf = requestAnimationFrame(() => { chartRaf = 0; if (state.probe) drawCharts(); });
  }
  function sizeCanvas(cv) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth || 260, h = cv.clientHeight || 78;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }
  function resizeCharts() { sizeCanvas(chartFog); sizeCanvas(chartHum); }

  function curve(key, axis, fixed) {
    const out = new Float32Array(65);
    for (let i = 0; i <= 64; i++) {
      const v = i / 64;
      out[i] = T.expectedCount(key, axis === 'fog' ? v : fixed, axis === 'hum' ? v : fixed, state.dens);
    }
    return out;
  }

  function drawChart(cv, data, cur, axis, live) {
    const { w, h, dpr } = sizeCanvas(cv);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, w, h);
    const padL = 2, padR = 2, padT = 7, padB = 3;
    const iw = w - padL - padR, ih = h - padT - padB;
    let max = 4;
    for (const v of data) if (v > max) max = v;
    if (typeof live === 'number') max = Math.max(max, live);
    max *= 1.12;
    const X = v => padL + v * iw;
    const Y = v => padT + ih - (v / max) * ih;

    c.strokeStyle = 'rgba(226,216,188,0.075)';
    c.lineWidth = 1;
    for (let k = 1; k <= 2; k++) {
      const yy = padT + (ih * k) / 3;
      c.beginPath(); c.moveTo(padL, yy); c.lineTo(padL + iw, yy); c.stroke();
    }

    const critX = axis === 'fog' ? T.criticalFog(state.hum) : humCritical(state.fog);
    if (isFinite(critX)) {
      c.save();
      c.strokeStyle = 'rgba(127,230,198,0.38)';
      c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(X(critX), padT); c.lineTo(X(critX), padT + ih); c.stroke();
      c.restore();
    }

    const grad = c.createLinearGradient(0, padT, 0, padT + ih);
    grad.addColorStop(0, 'rgba(217,176,112,0.26)');
    grad.addColorStop(1, 'rgba(217,176,112,0.01)');
    c.beginPath();
    c.moveTo(X(0), padT + ih);
    for (let i = 0; i < data.length; i++) c.lineTo(X(i / (data.length - 1)), Y(data[i]));
    c.lineTo(X(1), padT + ih);
    c.closePath();
    c.fillStyle = grad;
    c.fill();

    c.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = X(i / (data.length - 1)), y = Y(data[i]);
      if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.strokeStyle = 'rgba(217,176,112,0.95)';
    c.lineWidth = 1.35;
    c.lineJoin = 'round';
    c.stroke();

    const idx = Math.round(cur * (data.length - 1));
    const cx = X(cur), cy = Y(data[idx]);
    c.beginPath();
    c.arc(cx, cy, 3.3, 0, Math.PI * 2);
    c.fillStyle = '#7fe6c6';
    c.shadowColor = 'rgba(127,230,198,0.9)';
    c.shadowBlur = 8;
    c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = 'rgba(127,230,198,0.28)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, padT); c.lineTo(cx, padT + ih); c.stroke();

    // measured count, when it differs from the curve's expectation
    if (typeof live === 'number' && Math.abs(live - data[idx]) > 0.8) {
      const ly = Y(live);
      c.beginPath();
      c.arc(cx, ly, 2.2, 0, Math.PI * 2);
      c.fillStyle = 'rgba(244,202,138,0.95)';
      c.fill();
      c.strokeStyle = 'rgba(244,202,138,0.45)';
      c.setLineDash([2, 3]);
      c.beginPath(); c.moveTo(cx, ly); c.lineTo(cx, cy); c.stroke();
      c.setLineDash([]);
    }

    c.font = '9px ui-monospace, monospace';
    c.fillStyle = 'rgba(169,173,154,0.8)';
    c.textAlign = 'left';
    c.fillText('0', padL, h - 1);
    // top-right scale hint, backed so it stays legible over the curve
    const maxTxt = String(Math.round(max));
    c.textAlign = 'right';
    const tw = c.measureText(maxTxt).width;
    c.fillStyle = 'rgba(8,19,15,0.72)';
    c.fillRect(w - padR - tw - 7, padT - 1, tw + 5, 12);
    c.fillStyle = 'rgba(169,173,154,0.9)';
    c.fillText(maxTxt, w - padR - 3, padT + 8);
  }

  function drawCharts() {
    if (!state.probe) { chartDirty = false; return; }
    const k = state.probe;
    const live = countAt(k);
    drawChart(chartFog, curve(k, 'fog', state.hum), state.fog, 'fog', live);
    drawChart(chartHum, curve(k, 'hum', state.fog), state.hum, 'hum', live);
    chartDirty = false;
  }

  function updateStatusTotal() {
    const e = el('stTotal');
    if (e) e.textContent = T.N_TOTAL(state.dens);
  }

  // ---------------------------------------------------------------- loop
  let last = 0, liveTick = 0;
  function frame(now) {
    if (!last) last = now;
    const dt = Math.max(0, Math.min(0.045, (now - last) / 1000));
    last = now;
    state.time = now / 1000;

    stepSpirits(dt, state.time);
    fogLayer.batchDraw();
    spiritLayer.batchDraw();

    if (now - liveTick > 110) {
      liveTick = now;
      updateMarkers();
      if (state.probe) el('pcLive').textContent = countAt(state.probe);
    }
    if (chartDirty && state.probe) drawCharts();
    requestAnimationFrame(frame);
  }

  function updateMarkers() {
    for (const key of Object.keys(T.probes)) {
      const n = countAt(key);
      const g = markers[key];
      const txt = String(n);
      if (g.count.text() !== txt) {
        g.count.text(txt);
        g.count.offsetX(g.count.width() / 2);
      }
      const on = state.probe === key, hov = state.hover === key;
      const t = state.time;
      g.dot.radius((on ? 4 : 3) * (1 + (on ? 0.16 * Math.sin(t * 4) : 0)));
      g.halo.opacity(on ? 0.8 : hov ? 0.55 : 0.28);
      g.dot.shadowBlur(on ? 16 : hov ? 12 : 9);
    }
    markerLayer.batchDraw();
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    syncPopulation();
    fitView(false);
    onControls();
    for (let i = 0; i < 120; i++) stepSpirits(1 / 60, i / 60);
    for (const p of spirits) p.alpha = 1;
    state.time = performance.now() / 1000;
    markerLayer.batchDraw();
    requestAnimationFrame(frame);
    setTimeout(() => el('veil').classList.add('off'), 80);
    setTimeout(() => el('hint').classList.add('off'), 10000);
  }

  window.__app = {
    state, view, spirits, selectProbe, countAt, fitView, stage, markers,
    setSliders(f, h, d) {
      if (typeof f === 'number') { fogIn.value = f; }
      if (typeof h === 'number') { humIn.value = h; }
      if (typeof d === 'number') { densIn.value = d; }
      onControls();
    },
    criticalFog: T.criticalFog,
    humCritical,
    expected: k => T.expectedCount(k, state.fog, state.hum, state.dens),
    shares: () => T.shares(state.fog, state.hum),
    balance: () => T.balance(state.fog, state.hum)
  };

  boot();
})();
