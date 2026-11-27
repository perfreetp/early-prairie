// World: the terrain itself, the fields sampled from it, and the camera.
import { fbm, ridged, clamp, lerp } from './rng.js';

export const WORLD = { w: 4000, h: 2760, cell: 40 };

export class World {
  constructor(seed = 20261128) {
    this.seed = seed;
    this.w = WORLD.w; this.h = WORLD.h;
    this.cell = WORLD.cell;
    this.nx = Math.ceil(this.w / this.cell) + 1;
    this.ny = Math.ceil(this.h / this.cell) + 1;
    const N = this.nx * this.ny;
    this.fMoist = new Float32Array(N);
    this.fDrop = new Float32Array(N);
    this.fGreen = new Float32Array(N);
    this.fElev = new Float32Array(N);

    // permanent water + ephemeral pans that only fill in the wet season
    this.pools = [
      { x: 1290, y: 1290, r: 245, main: true },
      { x: 2810, y: 1880, r: 150, main: false },
      { x: 700, y: 2280, r: 105, main: false },
      { x: 3120, y: 520, r: 130, main: false },
      { x: 1980, y: 780, r: 90, main: false },
    ];
    this.poolR = new Float32Array(this.pools.length);

    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        this.fElev[j * this.nx + i] = this.elev(i * this.cell, j * this.cell);
      }
    }
    this.season = 0.2;
    this.build(this.season);
  }

  elev(x, y) {
    const n = fbm(x / 980, y / 900, this.seed, 4);
    const r = ridged(x / 560, y / 560, this.seed + 51, 3);
    return clamp(0.56 * n + 0.34 * r, 0, 1);
  }

  rawMoist(x, y) {
    const base = fbm(x / 800 + 11, y / 680 - 7, this.seed + 313, 4);
    const warp = fbm(x / 290, y / 290, this.seed + 77, 2);
    return clamp(0.16 + 0.86 * base + 0.24 * (warp - 0.5), 0, 1);
  }

  /** season 0 = dry, 1 = wet */
  build(season) {
    this.season = season;
    let greenThr = lerp(0.70, 0.36, season);
    this.greenThr = greenThr;
    this.moisBoost = lerp(-0.10, 0.16, season);
    for (let i = 0; i < this.pools.length; i++) {
      const p = this.pools[i];
      this.poolR[i] = p.main
        ? p.r * lerp(0.55, 1.0, season)
        : p.r * clamp((season - 0.18) / 0.6, 0, 1);
    }
    const { nx, ny, cell, fMoist, fDrop, fGreen, fElev } = this;
    for (let j = 0; j < ny; j++) {
      const wy = j * cell;
      for (let ii = 0; ii < nx; ii++) {
        const wx = ii * cell;
        const k = j * nx + ii;
        let nearest = 1e9;
        for (let p = 0; p < this.pools.length; p++) {
          const r = this.poolR[p];
          if (r <= 1) continue;
          const d = Math.hypot(wx - this.pools[p].x, wy - this.pools[p].y) - r;
          if (d < nearest) nearest = d;
        }
        const near = clamp(1 - Math.max(0, nearest) / 480, 0, 1);
        const m = clamp(this.rawMoist(wx, wy) + this.moisBoost + 0.30 * near * near, 0, 1);
        fMoist[k] = m;
        // Forage: the fraction of the water the ground actually holds. Grass
        // grows where the moisture beats the season's threshold, in proportion
        // to how far past it — no cliff, so a shrinking patch of green lasts a
        // while and then thins out instead of vanishing.
        fGreen[k] = clamp((m - greenThr) / (1 - greenThr) + 0.10, 0, 1) * 0.9
                  + 0.10 * clamp(m, 0, 1);
        const e = fElev[k];
        const ex = fElev[j * nx + Math.min(nx - 1, ii + 1)];
        const ey = fElev[Math.min(ny - 1, j + 1) * nx + ii];
        const slope = Math.abs(ex - e) + Math.abs(ey - e);
        // where an animal burns stamina: dry, high, steep ground is costly
        fDrop[k] = clamp(0.06 + 0.70 * (1 - m) + 0.28 * e + 7.5 * slope, 0, 1.25);
      }
    }
  }

  idx(x, y) {
    let ix = (x / this.cell) | 0, iy = (y / this.cell) | 0;
    if (ix < 0) ix = 0; else if (ix >= this.nx) ix = this.nx - 1;
    if (iy < 0) iy = 0; else if (iy >= this.ny) iy = this.ny - 1;
    return iy * this.nx + ix;
  }
  moistAt(x, y) { return this.fMoist[this.idx(x, y)]; }
  dropAt(x, y) { return this.fDrop[this.idx(x, y)]; }
  eatAt(x, y) { return this.fGreen[this.idx(x, y)]; }
  elevAt(x, y) { return this.fElev[this.idx(x, y)]; }

  nearestWater(x, y) {
    let best = null, bd = 1e9;
    for (let p = 0; p < this.pools.length; p++) {
      const r = this.poolR[p];
      if (r <= 1) continue;
      const pool = this.pools[p];
      const d = Math.hypot(x - pool.x, y - pool.y) - r;
      if (d < bd) { bd = d; best = { x: pool.x, y: pool.y, r }; }
    }
    return best;
  }

  drinkDist(x, y) {
    let bd = 1e9;
    for (let p = 0; p < this.pools.length; p++) {
      const r = this.poolR[p];
      if (r <= 1) continue;
      const d = Math.hypot(x - this.pools[p].x, y - this.pools[p].y) - r;
      if (d < bd) bd = d;
    }
    return bd;
  }
}

export class Camera {
  constructor(world) {
    this.w = world.w; this.h = world.h;
    this.x = this.w * 0.5; this.y = this.h * 0.5;
    this.zoom = 0.30;
    this.vw = 1200; this.vh = 800;
    this.minZoom = 0.05;
    this.maxZoom = 3.0;
    this._fly = null;
  }
  setViewport(w, h) { this.vw = w; this.vh = h; this.refit(); }
  refit() {
    this.minZoom = Math.max(0.03, Math.min(this.vw / (this.w * 1.04), this.vh / (this.h * 1.04)));
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);
    this.clamp();
  }
  toScreen(wx, wy) {
    return [(wx - this.x) * this.zoom + this.vw * 0.5, (wy - this.y) * this.zoom + this.vh * 0.5];
  }
  toWorld(sx, sy) {
    return [(sx - this.vw * 0.5) / this.zoom + this.x, (sy - this.vh * 0.5) / this.zoom + this.y];
  }
  clamp() {
    const hw = this.vw / (2 * this.zoom), hh = this.vh / (2 * this.zoom);
    const mx = this.w * 0.10, my = this.h * 0.10;
    const loX = Math.min(hw, this.w * 0.5) - mx, hiX = this.w - Math.min(hw, this.w * 0.5) + mx;
    const loY = Math.min(hh, this.h * 0.5) - my, hiY = this.h - Math.min(hh, this.h * 0.5) + my;
    this.x = clamp(this.x, loX, hiX);
    this.y = clamp(this.y, loY, hiY);
  }
  zoomAt(sx, sy, f) {
    const [wx, wy] = this.toWorld(sx, sy);
    this.zoom = clamp(this.zoom * f, this.minZoom, this.maxZoom);
    const [nx, ny] = this.toWorld(sx, sy);
    this.x += wx - nx; this.y += wy - ny;
    this.clamp();
  }
  pan(dx, dy) { this.x -= dx / this.zoom; this.y -= dy / this.zoom; this.clamp(); }
  flyTo(x, y, zoom) {
    this._fly = { x, y, z: clamp(zoom, this.minZoom, this.maxZoom) };
  }
  jumpTo(x, y, zoom) {
    this.x = x; this.y = y;
    this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.clamp();
  }
  update(dt) {
    const f = this._fly;
    if (!f) return false;
    const k = Math.min(1, dt * 4.5);
    this.x += (f.x - this.x) * k;
    this.y += (f.y - this.y) * k;
    this.zoom += (f.z - this.zoom) * k;
    this.clamp();
    if (Math.abs(f.x - this.x) < 1 && Math.abs(f.y - this.y) < 1 && Math.abs(f.z - this.zoom) < 0.002) {
      this.x = f.x; this.y = f.y; this.zoom = f.z;
      this._fly = null; this.clamp();
      return false;
    }
    return true;
  }
  visible(pad = 0) {
    const [x0, y0] = this.toWorld(-pad, -pad);
    const [x1, y1] = this.toWorld(this.vw + pad, this.vh + pad);
    return { x0, y0, x1, y1 };
  }
}
