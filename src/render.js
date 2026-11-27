// Renderer: builds the Pixi scene and draws the herd each frame.
//
// The herd is drawn as ONE MeshSimple whose quads each sample a cell of an atlas.
// Per-quad UVs give pose, gait frame and coat, so thousands of animals cost a
// single draw call. Below a zoom threshold the same technique draws a small
// state-coloured dot per animal instead, which stays legible when the animals
// are sub-pixel.
import { ATLAS, buildAnimalAtlas, buildTerrainCanvas, buildDetailTexture, buildDotAtlas, DOT_COLORS } from './art.js';
import { clamp, lerp, smoothstep } from './rng.js';
import { ST, STATE_COLOR } from './herd.js';

const MAX_INST = 7000;

export class Renderer {
  constructor(app, world, herd, opts = {}) {
    this.app = app;
    this.world = world;
    this.herd = herd;
    this.scaleShown = opts.scaleShown || 1;
    this.maxInst = opts.maxInst || MAX_INST;
    this.showWarn = false;
    this.showLinks = false;
    this.showPressure = false;
    this.animalScale = 1.0;
    this.tintSterile = false;
    this.debug = {};
  }

  async init() {
    const P = PIXI;
    const app = this.app;

    this.root = new P.Container();
    app.stage.addChild(this.root);

    this.worldLayer = new P.Container();
    this.herdLayer = new P.Container();
    this.overLayer = new P.Container();
    this.root.addChild(this.worldLayer, this.herdLayer, this.overLayer);

    // ---- terrain ----
    this.terrainCanvas = buildTerrainCanvas(this.world, { wet: 1 - this.herd.aridity });
    this.terrainTex = P.Texture.from(this.terrainCanvas);
    this.terrainTex.source.scaleMode = 'linear';
    this.terrain = new P.Sprite(this.terrainTex);
    this.terrain.width = this.world.w;
    this.terrain.height = this.world.h;
    this.worldLayer.addChild(this.terrain);
    this._terrainSeason = this.herd.aridity;

    // near-field detail, tiled over the whole world (crisp tufts at high zoom)
    this.detailTex = P.Texture.from(buildDetailTexture(256));
    this.detail = new P.TilingSprite({ texture: this.detailTex, width: this.world.w, height: this.world.h });
    this.detail.tileScale.set(1, 1);
    this.detail.alpha = 0;
    this.worldLayer.addChild(this.detail);

    // ---- animal atlas ----
    const atlas = buildAnimalAtlas(1.6);
    this.atlasCanvas = atlas.canvas;
    this.atlasTex = P.Texture.from(atlas.canvas);
    this.atlasTex.source.scaleMode = 'linear';
    this.atlasW = atlas.canvas.width;
    this.atlasH = atlas.canvas.height;
    this.cellW = atlas.cellW;
    this.cellH = atlas.cellH;
    this.uvs = [];
    // UVs are just the grid cell, 1/cols × 1/rows — the atlas canvas is larger
    // than the logical grid because it is drawn at a supersampling scale, and
    // that scale must NOT leak into the texture coordinates.
    const W = 1 / ATLAS.cols, H = 1 / ATLAS.rows;
    const pu = 0.35 / this.atlasW, pv = 0.35 / this.atlasH;
    for (let pose = 0; pose < ATLAS.poses; pose++) {
      this.uvs[pose] = [];
      for (let tint = 0; tint < ATLAS.tints; tint++) {
        this.uvs[pose][tint] = [];
        for (let f = 0; f < ATLAS.frames; f++) {
          const id = pose * ATLAS.frames * ATLAS.tints + f * ATLAS.tints + tint;
          const col = id % ATLAS.cols, row = (id / ATLAS.cols) | 0;
          const u0 = col * W + pu;
          const v0 = row * H + pv;
          const u1 = (col + 1) * W - pu;
          const v1 = (row + 1) * H - pv;
          this.uvs[pose][tint][f] = [u0, v0, u1, v1];
        }
      }
    }

    // ---- dot atlas (far zoom) ----
    const dots = buildDotAtlas(48);
    this.dotTex = P.Texture.from(dots.canvas);
    this.dotTex.source.scaleMode = 'linear';
    this.dotCount = DOT_COLORS.length;
    this.dotUv = [];
    for (let k = 0; k < DOT_COLORS.length; k++) {
      const u0 = k / DOT_COLORS.length, u1 = (k + 1) / DOT_COLORS.length;
      this.dotUv.push([u0 + 0.004, 0.05, u1 - 0.004, 0.95]);
    }

    const n = this.maxInst;
    this.pos = new Float32Array(n * 8);
    this.uv = new Float32Array(n * 8);
    this.dotPos = new Float32Array(n * 8);
    this.dotUvArr = new Float32Array(n * 8);
    const idx = new Uint32Array(n * 6);
    for (let q = 0; q < n; q++) {
      const b = q * 4, o = q * 6;
      idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
      idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }

    this.mesh = new P.MeshSimple({ texture: this.atlasTex, vertices: this.pos, uvs: this.uv, indices: idx });
    this.herdLayer.addChild(this.mesh);

    this.dotMesh = new P.MeshSimple({ texture: this.dotTex, vertices: this.dotPos, uvs: this.dotUvArr, indices: idx });
    this.dotMesh.visible = false;
    this.herdLayer.addChild(this.dotMesh);

    // ---- overlays ----
    this.overlay = new P.Graphics();
    this.overLayer.addChild(this.overlay);
    this.windG = new P.Graphics();
    this.overLayer.addChild(this.windG);
    this.plumeG = new P.Graphics();
    this.overLayer.addChild(this.plumeG);
    this.fenceG = new P.Graphics();
    this.overLayer.addChild(this.fenceG);
    // one Graphics per overlay: they are cleared independently each frame
    this.warnG = new P.Graphics();
    this.linkG = new P.Graphics();
    this.pressG = new P.Graphics();
    this.overLayer.addChild(this.pressG);
    this.overLayer.addChild(this.warnG);
    this.overLayer.addChild(this.linkG);
    this.hudG = this.warnG;

    this._prevMeshQ = 0;
    this._prevDotQ = 0;
    this.detailPhase = 0;
    return this;
  }

  rebuildTerrain(wet) {
    const c = buildTerrainCanvas(this.world, { wet });
    this.terrainTex.source.canvas = c;
    this.terrainTex.source.update();
    this.terrain.width = this.world.w;
    this.terrain.height = this.world.h;
    this._terrainSeason = 1 - wet;
  }

  /* ---------------------------------------------------------------- frame */
  draw(cam, dt, opts = {}) {
    const P = PIXI;
    const app = this.app;
    const W = app.screen.width, H = app.screen.height;
    const z = cam.zoom;

    this.root.position.set(Math.round(W * 0.5 - cam.x * z), Math.round(H * 0.5 - cam.y * z));
    this.root.scale.set(z);

    const view = cam.visible(0);
    // screen-space margin around the view, in world units
    const mx = 24 / z, my = 24 / z;
    const x0 = view.x0 - mx, x1 = view.x1 + mx, y0 = view.y0 - my, y1 = view.y1 + my;

    this.detailPhase += dt * 0.05;
    this.detail.alpha = smoothstep(0.45, 1.4, z) * 0.30;
    this.detail.tilePosition.set(0, 0);
    this.detail.visible = this.detail.alpha > 0.01;

    const herd = this.herd;
    const n = herd.n;
    const useDots = z < 0.22;

    if (!useDots) this.buildAnimalMesh(herd, n, x0, y0, x1, y1, z);
    else this.buildDotMesh(herd, n, x0, y0, x1, y1, z);

    this.mesh.visible = !useDots;
    this.dotMesh.visible = useDots;

    // ---- overlays & guides ----
    this.drawTerrainMarks(dt);
    this.drawFence();
    this.drawWind(cam);
    this.drawPlume(cam);
    if (this.showWarn) this.drawWarn(cam, x0, y0, x1, y1);
    if (this.showLinks) this.drawLinks(cam, x0, y0, x1, y1);
    if (this.showPressure) this.drawPressure(cam, x0, y0, x1, y1);
  }

  buildAnimalMesh(herd, n, x0, y0, x1, y1, z) {
    const pos = this.pos, uv = this.uv, uvs = this.uvs;
    const x = herd.x, y = herd.y, hd = herd.hd, pose = herd.pose, phase = herd.phase;
    const siz = herd.size, tint = herd.tint;
    const BODY = 22.0 * this.animalScale;
    // at far-ish zoom, hold a minimum on-screen size so animals stay visible
    const minWorld = 16.0 / z;
    let q = 0;
    const lim = this.maxInst;

    for (let i = 0; i < n && q < lim; i++) {
      const px = x[i], py = y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const s = Math.max(BODY * siz[i], minWorld);
      const cr = Math.cos(hd[i]), sr = Math.sin(hd[i]);
      const hx = s * 1.50, hy = s * 0.98;
      const o = q * 8;

      pos[o] = px - cr * hx - sr * hy;
      pos[o + 1] = py - sr * hx + cr * hy;
      pos[o + 2] = px + cr * hx - sr * hy;
      pos[o + 3] = py + sr * hx + cr * hy;
      pos[o + 4] = px + cr * hx + sr * hy;
      pos[o + 5] = py + sr * hx + cr * hy;
      pos[o + 6] = px - cr * hx + sr * hy;
      pos[o + 7] = py - sr * hx + cr * hy;

      const p = pose[i] | 0;
      const ph = phase[i];
      let f;
      if (p === 0) f = ((ph * 0.34) | 0) % ATLAS.frames;
      else if (p === 2) f = ((ph * 0.5) | 0) % ATLAS.frames;
      else f = ((ph * 1.55) | 0) % ATLAS.frames;
      const set = uvs[p][tint[i] & 3][f];
      // quad winding: bl(−hx,−hy) br(+hx,−hy) tr(+hx,+hy) tl(−hx,+hy)
      // texture v runs along the animal's width, u along its length
      uv[o] = set[0]; uv[o + 1] = set[3];
      uv[o + 2] = set[2]; uv[o + 3] = set[3];
      uv[o + 4] = set[2]; uv[o + 5] = set[1];
      uv[o + 6] = set[0]; uv[o + 7] = set[1];
      q++;
    }

    // park unused quads offscreen
    for (let k = q; k < this._prevMeshQ; k++) {
      const o = k * 8;
      for (let j = 0; j < 8; j++) pos[o + j] = -1e7;
    }
    this._prevMeshQ = q;

    const pb = this.mesh.geometry.getBuffer('aPosition');
    const ub = this.mesh.geometry.getBuffer('aUV');
    pb.data = pos; pb.update();
    ub.data = uv; ub.update();
    this.debug.meshQ = q;
    this.debug.dropped = n - q;
  }

  buildDotMesh(herd, n, x0, y0, x1, y1, z) {
    const pos = this.dotPos, uv = this.dotUvArr;
    const x = herd.x, y = herd.y, st = herd.state;
    // fixed screen size dot: radius in screen px → world units
    const rWorld = clamp(2.2 / z, 0.8, 40);
    const lim = this.maxInst;
    let q = 0;
    for (let i = 0; i < n && q < lim; i++) {
      const px = x[i], py = y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const o = q * 8;
      pos[o] = px - rWorld; pos[o + 1] = py - rWorld;
      pos[o + 2] = px + rWorld; pos[o + 3] = py - rWorld;
      pos[o + 4] = px + rWorld; pos[o + 5] = py + rWorld;
      pos[o + 6] = px - rWorld; pos[o + 7] = py + rWorld;
      const k = dotState(st[i]);
      const set = this.dotUv[k];
      uv[o] = set[0]; uv[o + 1] = set[1];
      uv[o + 2] = set[2]; uv[o + 3] = set[1];
      uv[o + 4] = set[2]; uv[o + 5] = set[3];
      uv[o + 6] = set[0]; uv[o + 7] = set[3];
      q++;
    }
    for (let k = q; k < this._prevDotQ; k++) {
      const o = k * 8;
      for (let j = 0; j < 8; j++) pos[o + j] = -1e7;
    }
    this._prevDotQ = q;
    const pb = this.dotMesh.geometry.getBuffer('aPosition');
    const ub = this.dotMesh.geometry.getBuffer('aUV');
    pb.data = pos; pb.update();
    ub.data = uv; ub.update();
    this.debug.dotQ = q;
  }

  /* -------------------------------------------------------------- overlays */
  drawTerrainMarks(dt) {
    // water: static shape per season, drawn cheaply
    const g = this.overlay;
    g.clear();
    const t = 1 - this.herd.aridity;
    const world = this.world;
    for (let p = 0; p < world.pools.length; p++) {
      const r = world.poolR[p];
      if (r <= 1) continue;
      const pool = world.pools[p];
      g.circle(pool.x, pool.y, r).fill({ color: 0x3f6f7a, alpha: 0.80 });
      g.circle(pool.x, pool.y, r).stroke({ width: 3.5, color: 0xd9cfa8, alpha: 0.30 });
      g.circle(pool.x, pool.y, r * 0.72).fill({ color: 0x2f5f6c, alpha: 0.42 });
    }
  }

  drawFence() {
    const pad = this.herd;
    const g = this.fenceG;
    g.clear();
    if (!pad.fenceR) return;
    g.circle(pad.fenceX, pad.fenceY, pad.fenceR)
      .stroke({ width: 2.4, color: 0xe8d9a8, alpha: 0.55 });
    g.circle(pad.fenceX, pad.fenceY, pad.fenceR - 6)
      .stroke({ width: 1, color: 0xe8d9a8, alpha: 0.22 });
    // posts
    const N = 48;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const px = pad.fenceX + Math.cos(a) * pad.fenceR;
      const py = pad.fenceY + Math.sin(a) * pad.fenceR;
      g.circle(px, py, 3.2).fill({ color: 0xf2e6bd, alpha: 0.55 });
    }
  }

  drawWind(cam) {
    const g = this.windG;
    g.clear();
    const h = this.herd;
    const z = cam.zoom;
    const screenW = this.app.screen.width, screenH = this.app.screen.height;
    // world-space arrow scale that keeps a constant screen size
    const s = 1 / z;
    const n = 7;
    const ax = cam.x, ay = cam.y;
    // spread the arrows across the visible area
    const spanX = screenW * 0.42 * s, spanY = screenH * 0.42 * s;
    for (let k = 0; k < n; k++) {
      const fx = ((k * 0.37) % 1 - 0.5) * 2;
      const fy = ((k * 0.61) % 1 - 0.5) * 2;
      const bx = ax + fx * spanX * 0.9;
      const by = ay + fy * spanY * 0.9;
      const len = 74 * s;
      const ex = bx + h.windX * len, ey = by + h.windY * len;
      g.moveTo(bx, by).lineTo(ex, ey)
        .stroke({ width: 2.0 * s, color: 0xf6ecd0, alpha: 0.20 });
      // head
      const a = Math.atan2(h.windY, h.windX);
      const hw = 9 * s;
      g.moveTo(ex, ey)
        .lineTo(ex - Math.cos(a - 0.45) * hw, ey - Math.sin(a - 0.45) * hw)
        .lineTo(ex - Math.cos(a + 0.45) * hw, ey - Math.sin(a + 0.45) * hw)
        .closePath().fill({ color: 0xf6ecd0, alpha: 0.26 });
    }
  }

  drawPlume(cam) {
    const g = this.plumeG;
    g.clear();
    const h = this.herd;
    for (const src of h.sources) {
      if (!src.active) continue;
      const len = src.radius * 0.9;
      const half = 26 + len * 0.20;
      const a = h.windA;
      const ca = Math.cos(a), sa = Math.sin(a);
      const px = -sa, py = ca;
      const p0x = src.x, p0y = src.y;
      const p1x = src.x + ca * len, p1y = src.y + sa * len;
      g.moveTo(p0x, p0y)
        .lineTo(p1x + px * half, p1y + py * half)
        .lineTo(p1x - px * half, p1y - py * half)
        .closePath()
        .fill({ color: 0xff8a5c, alpha: 0.055 });
      g.moveTo(p0x, p0y)
        .lineTo(p1x + px * half * 0.6, p1y + py * half * 0.6)
        .lineTo(p1x - px * half * 0.6, p1y - py * half * 0.6)
        .closePath()
        .fill({ color: 0xffb27a, alpha: 0.055 });
      // source marker
      g.circle(src.x, src.y, 16).fill({ color: 0xff6a55, alpha: 0.5 });
      g.circle(src.x, src.y, 34).stroke({ width: 2, color: 0xffb27a, alpha: 0.35 });
    }
  }

  drawWarn(cam, x0, y0, x1, y1) {
    const g = this.warnG;
    g.clear();
    const z = cam.zoom;
    const h = this.herd;
    const cap = z > 0.9 ? 260 : z > 0.5 ? 140 : 70;
    let drawn = 0;
    const stride = Math.max(1, Math.floor(h.n / 2600));
    for (let i = 0; i < h.n && drawn < cap; i += stride) {
      const px = h.x[i], py = h.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const R = h.R[i];
      const alert = h.alert[i];
      const col = alert > 0.35 ? 0xffb35c : 0x9ec6d8;
      g.circle(px, py, R).stroke({ width: 1.1 / z, color: col, alpha: 0.30 });
      drawn++;
    }
    // the paddock's animals always show their bubbles
    for (let i = 0; i < h.n; i++) {
      if (!h.paddock[i]) continue;
      if (h.x[i] < x0 || h.x[i] > x1 || h.y[i] < y0 || h.y[i] > y1) continue;
      g.circle(h.x[i], h.y[i], h.R[i]).stroke({ width: 1.0 / z, color: 0x9ec6d8, alpha: 0.22 });
    }
  }

  drawLinks(cam, x0, y0, x1, y1) {
    const g = this.linkG;
    g.clear();
    const z = cam.zoom;
    const h = this.herd;
    let drawn = 0;
    const cap = 900;
    for (let i = 0; i < h.n && drawn < cap; i++) {
      const f = h.guide[i];
      if (f < 0) continue;
      const px = h.x[i], py = h.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const fx = h.x[f], fy = h.y[f];
      const sw = h.flash[i];
      g.moveTo(px, py).lineTo(fx, fy)
        .stroke({ width: (sw > 0.3 ? 2.0 : 1.0) / z, color: sw > 0.3 ? 0xffe08a : 0x8fd0b8, alpha: sw > 0.3 ? 0.85 : 0.34 });
      drawn++;
    }
    // mark guides with followers
    for (let i = 0; i < h.n; i++) {
      if (h.fcount[i] < 1) continue;
      if (h.x[i] < x0 || h.x[i] > x1 || h.y[i] < y0 || h.y[i] > y1) continue;
      g.circle(h.x[i], h.y[i], 5.5 / z).stroke({ width: 1.6 / z, color: 0xfff0b0, alpha: 0.7 });
    }
    this.debug.links = drawn;
  }

  drawPressure(cam, x0, y0, x1, y1) {
    const g = this.pressG;
    g.clear();
    const h = this.herd;
    const scale = 26;
    for (let i = 0; i < h.n; i++) {
      const p = h.pressure[i];
      if (p < 0.25) continue;
      const px = h.x[i], py = h.y[i];
      if (px < x0 || px > x1 || py < y0 || py > y1) continue;
      const t = clamp(p / 1.6, 0, 1);
      g.circle(px, py, 6 + 9 * t).fill({ color: t > 0.7 ? 0xff4433 : 0xff9a3c, alpha: 0.10 + 0.30 * t });
    }
  }
}

function dotState(s) {
  switch (s) {
    case ST.STAMPEDE: return 4;
    case ST.FLEE: return 3;
    case ST.ALERT: return 2;
    case ST.VIGIL: return 2;
    case ST.FOLLOW: return 1;
    default: return 0;
  }
}

export { STATE_COLOR };
