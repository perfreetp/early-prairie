/* world.js — terrain field, habitat sites, preference model.
   Everything here is pure math (no DOM) so it can be unit-checked in Node. */
(function (global) {
  'use strict';

  const W = 1600, H = 1000;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---- value noise -------------------------------------------------------
  const perm = new Uint8Array(512);
  (function () {
    const r = mulberry32(20261128);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const v00 = perm[perm[X] + Y] / 255;
    const v10 = perm[perm[(X + 1) & 255] + Y] / 255;
    const v01 = perm[perm[X] + ((Y + 1) & 255)] / 255;
    const v11 = perm[perm[(X + 1) & 255] + ((Y + 1) & 255)] / 255;
    const u = fade(xf), v = fade(yf);
    return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
  }
  function fbm(x, y, oct) {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  }

  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx, qy = ay + t * dy;
    return Math.hypot(px - qx, py - qy);
  }
  function polyDist(px, py, pts) {
    let d = 1e9;
    for (let i = 0; i < pts.length - 1; i++) {
      const q = segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
      if (q < d) d = q;
    }
    return d;
  }
  function ellQ(px, py, e) {
    const dx = px - e.x, dy = py - e.y;
    const c = Math.cos(e.rot), s = Math.sin(e.rot);
    const u = (dx * c + dy * s) / e.rx, v = (-dx * s + dy * c) / e.ry;
    return u * u + v * v;
  }

  // ---- geography ---------------------------------------------------------
  const crest = [[40,360],[180,300],[330,240],[480,190],[640,158],[800,148],[960,180],[1120,228],[1270,290],[1410,365],[1560,450]];
  const veins = [
    [[960,185],[935,255],[905,330],[878,400],[868,470],[885,540],[925,605],[980,665],[1040,720],[1090,780],[1125,845],[1150,915],[1160,1000]],
    [[885,540],[800,580],[720,620],[650,680],[610,750],[590,830],[580,900],[575,980]]
  ];
  const basins = [
    { x: 470, y: 690, rx: 240, ry: 150, rot: -0.10, d: 0.31 },
    { x: 1210, y: 815, rx: 190, ry: 120, rot: 0.14, d: 0.26 }
  ];

  function veinDist(x, y) { let d = 1e9; for (const v of veins) { const q = polyDist(x, y, v); if (q < d) d = q; } return d; }
  function basinField(x, y) { let m = 0; for (const b of basins) { const q = Math.exp(-ellQ(x, y, b) * 1.2); if (q > m) m = q; } return m; }

  function heightAt(x, y) {
    const dC = polyDist(x, y, crest), dR = veinDist(x, y);
    let h = 0.42;
    h += 0.36 * Math.exp(-(dC / 100) * (dC / 100));
    h += 0.12 * Math.exp(-(dC / 290) * (dC / 290));
    h -= 0.10 * Math.exp(-(dR / 95) * (dR / 95));
    h -= 0.035 * Math.exp(-(dR / 22) * (dR / 22));
    for (const b of basins) h -= b.d * Math.exp(-ellQ(x, y, b) * 1.1);
    h += 0.065 * (fbm(x / 160, y / 160, 4) - 0.5) * 2;
    h += 0.028 * (fbm(x / 48 + 31, y / 48 + 17, 3) - 0.5) * 2;
    return h < 0.035 ? 0.035 : h > 0.96 ? 0.96 : h;
  }

  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const lowness = h => clamp01((0.33 - h) / 0.205);
  const exposure = h => clamp01((h - 0.55) / 0.30);
  const riverness = vd => Math.exp(-(vd / 40) * (vd / 40));

  // Three observation points: basin floor, crest, river vein.
  const probes = {
    valley: { x: 470, y: 690 },
    ridge:  { x: 1080, y: 208 },
    water:  { x: 868, y: 470 }
  };

  // ---- habitat sites -----------------------------------------------------
  function buildSites() {
    const r = mulberry32(777);
    const list = [];
    const step = 42;
    for (let y = 14; y < H; y += step) {
      for (let x = 14; x < W; x += step) {
        const jx = x + (r() - 0.5) * step * 0.7;
        const jy = y + (r() - 0.5) * step * 0.7;
        if (jx < 8 || jx > W - 8 || jy < 8 || jy > H - 8) continue;
        const h = heightAt(jx, jy), vd = veinDist(jx, jy);
        list.push({ x: jx, y: jy, h, vd,
          a: lowness(h) * Math.pow(basinField(jx, jy), 0.7),
          b: exposure(h),
          c: riverness(vd), kind: 0 });
      }
    }
    // extra samples along the water veins so bands read as bands
    const rr = mulberry32(4242);
    for (const v of veins) {
      for (let i = 0; i < v.length - 1; i++) {
        const x1 = v[i][0], y1 = v[i][1], x2 = v[i + 1][0], y2 = v[i + 1][1];
        const len = Math.hypot(x2 - x1, y2 - y1);
        const n = Math.max(1, Math.round(len / 20));
        const nx = -(y2 - y1) / len, ny = (x2 - x1) / len;
        for (let k = 0; k < n; k++) {
          const t = (k + (rr() - 0.5) * 0.8) / n;
          const off = (rr() - 0.5) * 22;
          const x = lerp(x1, x2, t) + nx * off;
          const y = lerp(y1, y2, t) + ny * off;
          if (x < 8 || x > W - 8 || y < 8 || y > H - 8) continue;
          const h = heightAt(x, y), vd = veinDist(x, y);
          list.push({ x, y, h, vd,
            a: lowness(h) * basinField(x, y) * 0.8,
            b: exposure(h) * 0.5,
            c: Math.max(0.55, riverness(vd)), kind: 1 });
        }
      }
    }
    // extra samples in the basins
    const br = mulberry32(9091);
    for (const b of basins) {
      for (let k = 0; k < 90; k++) {
        const ang = br() * Math.PI * 2, rad = Math.pow(br(), 0.6);
        const lx = Math.cos(ang) * rad * b.rx * 0.9;
        const ly = Math.sin(ang) * rad * b.ry * 0.9;
        const c = Math.cos(b.rot), s = Math.sin(b.rot);
        const x = b.x + lx * c - ly * s;
        const y = b.y + lx * s + ly * c;
        if (x < 8 || x > W - 8 || y < 8 || y > H - 8) continue;
        const h = heightAt(x, y), vd = veinDist(x, y);
        list.push({ x, y, h, vd,
          a: Math.max(0.5, lowness(h) * 1.1),
          b: exposure(h) * 0.4,
          c: riverness(vd) * 0.7, kind: 2 });
      }
    }
    return list;
  }

  const sites = buildSites();
  const S = sites.length;

  // class arrays for region sampling
  const cls = { valley: [], ridge: [], water: [] };
  const cw = { valley: [], ridge: [], water: [] };
  for (let i = 0; i < S; i++) {
    const s = sites[i];
    if (s.a >= s.b && s.a >= s.c && s.a > 0.25) {
      const w = Math.pow(s.a, 1.7);
      if (w > 1e-4) { cls.valley.push(i); cw.valley.push(w); }
    }
    if (s.b >= s.a && s.b >= s.c && s.b > 0.28) {
      const w = Math.pow(s.b, 2.0);
      if (w > 1e-4) { cls.ridge.push(i); cw.ridge.push(w); }
    }
    if (s.c > 0.45 && s.c >= s.a * 0.9) {
      const w = Math.pow(s.c, 3.0);
      if (w > 1e-4) { cls.water.push(i); cw.water.push(w); }
    }
  }
  for (const k of ['valley', 'ridge', 'water']) {
    const arr = cw[k]; let sum = 0;
    for (const v of arr) sum += v;
    for (let i = 0; i < arr.length; i++) arr[i] /= sum;
  }

  // ---- preference weights ------------------------------------------------
  // fog: pools spirits into low basins; humidity: pulls them onto water veins.
  function weights(fog, hum) {
    const Wv = (0.050 + 1.250 * Math.pow(fog, 1.45)) * (0.66 + 0.80 * hum);
    const Wr = (1.000 - 0.900 * fog) * (1.08 - 0.34 * hum);
    const Ww = (0.012 + 1.300 * Math.pow(hum, 1.9)) * (0.80 + 0.30 * fog);
    return { Wv, Wr, Ww };
  }

  const GAMMA = 1.55;
  // per-individual habitat bias (v/r/w multipliers) yields that individual's mix
  function classShares(fog, hum, bias) {
    const w = weights(fog, hum);
    const b = bias || { v: 1, r: 1, w: 1 };
    const pv = Math.pow(w.Wv * b.v, GAMMA);
    const pr = Math.pow(w.Wr * b.r, GAMMA);
    const pw = Math.pow(w.Ww * b.w, GAMMA);
    const z = pv + pr + pw;
    return { v: pv / z, r: pr / z, w: pw / z };
  }
  function shares(fog, hum) {
    const s = classShares(fog, hum, null);
    return { v: s.v, r: s.r, w: s.w, shareV: s.v / (s.v + s.r) };
  }

  // how closely valley and ridge preference are tied (1 = dead heat)
  function balance(fog, hum) {
    const s = shares(fog, hum);
    const ratio = s.v / (s.v + s.r);
    const crit = Math.max(0, Math.min(1, 1 - Math.abs(ratio - 0.5) / 0.085));
    return { ratio, crit, v: s.v, r: s.r, w: s.w };
  }

  // fog at which valley and ridge preference balance for a given humidity
  function criticalFog(hum) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const w = weights(mid, hum);
      if (w.Wv < w.Wr) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  // fraction of each class' spirits that fall within a probe radius
  const PROBE_R = 112;
  const capture = {};
  for (const key of ['valley', 'ridge', 'water']) {
    const p = probes[key];
    const cap = { valley: 0, ridge: 0, water: 0 };
    for (const k of ['valley', 'ridge', 'water']) {
      const ids = cls[k], ws = cw[k];
      let inw = 0;
      for (let i = 0; i < ids.length; i++) {
        const s = sites[ids[i]];
        if (Math.hypot(s.x - p.x, s.y - p.y) < PROBE_R) inw += ws[i];
      }
      cap[k] = inw;
    }
    capture[key] = cap;
  }

  const N_TOTAL = d => Math.round(150 + 380 * d);
  function expectedCount(probe, fog, hum, dens) {
    const sh = shares(fog, hum), cap = capture[probe], N = N_TOTAL(dens);
    return N * (sh.v * cap.valley + sh.r * cap.ridge + sh.w * cap.water);
  }

  // ---- sampling helpers --------------------------------------------------
  const rand = mulberry32(31337);
  function pick(arr, w) {
    let u = rand(), acc = 0;
    for (let i = 0; i < arr.length; i++) { acc += w[i]; if (u <= acc) return arr[i]; }
    return arr[arr.length - 1];
  }

  const Terrain = {
    W, H, mulberry32, vnoise, fbm, polyDist, veinDist, basinField,
    heightAt, lowness, exposure, riverness, probes, sites, cls, cw,
    weights, shares, classShares, balance, criticalFog, capture, PROBE_R, N_TOTAL, expectedCount,
    pick, rand, crest, veins, basins
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Terrain;
  global.Terrain = Terrain;
})(typeof window !== 'undefined' ? window : globalThis);
