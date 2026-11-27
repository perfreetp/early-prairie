// Herd simulation core — pure JS, no DOM. Runs in the browser and under Node.
//
// The model, in one paragraph
// ---------------------------
// Each animal owns three inspectable quantities: stamina, a vigilance radius
// R = R0·(floor + (1-floor)·stamina), and a guide (another animal, or nobody).
// Social seniority is a static total order fixed for the season, so the guide
// graph is acyclic by construction: chains run from the weak toward the strong
// and can never loop.
//
// An animal follows the nearest more-senior animal whose vigilance circle still
// covers it, and it stations itself behind that animal. Two consequences carry
// the whole piece:
//   • stamina falls → R falls → the circle stops covering a follower that was
//     riding its rim → that follower re-links to a nearer animal. A retiring
//     guide therefore hands its followers down the chain, one hop at a time.
//   • the station distance is proportional to R, so as circles shrink every
//     follower walks in. The group contracts from a loose scatter into files,
//     because each station sits behind its guide and the file inherits the
//     direction of travel.
//
// Crowding is contact pressure: neighbours inside a personal radius, weighted by
// how deep inside they are. Above a stamina-dependent tolerance the animal
// accumulates stress; past 1.0 it bolts — a short gallop away from the local
// crowd, refusing guide links while it runs. Below the tolerance, cohesion pulls
// the group back. Near the critical packing both outcomes are self-sustaining,
// which is what the corner paddock exposes.
//
// Alerts come from scent (a downwind plume) or from a neighbour. An alerted
// animal lifts its head, then steps upwind. Body-to-body transfer has a gain
// below 1, so the front sweeps the herd at a finite speed and dies out when
// nothing feeds it.

import { clamp, lerp, smoothstep, wrapAngle, mulberry32 } from './rng.js';
import { Grid } from './grid.js';

export const ST = { GRAZE: 0, FOLLOW: 1, ALERT: 2, FLEE: 3, STAMPEDE: 4, VIGIL: 5 };
export const STATE_NAME = ['采食', '跟随', '抬头', '逆风移动', '踩踏', '警戒'];
export const STATE_COLOR = ['#93a06f', '#e0c87d', '#ffd166', '#79d0ff', '#ff6a55', '#ffb15c'];

export const P = {
  R0: 112,
  Rfloor: 0.26,
  senseR: 140,

  personal: [10.0, 8.0],     // personal radius at stamina 1 … stamina 0
  sepSpeed: 30,
  shoveSpeed: 46,
  crowdR: 30,

  tolBase: 0.42,             // pressure tolerance at stamina 0
  tolGain: 2.75,             // … plus this much at stamina 1
  stressRate: 2.4,
  stressDecay: 0.24,
  stampedeTime: [1.6, 3.2],
  coolTime: [5.0, 9.0],
  stampedeDrain: 0.020,

  capacity: 3,
  capacityAlpha: 6,

  // Hunger decides who joins a file. A fit animal grazes where it stands; once
  // stamina falls past followStam it looks for a guide, and it leaves the file
  // only after recovering past releaseStam — the hysteresis stops flicker.
  followStam: 0.62,
  releaseStam: 0.70,

  lateralCalm: 0.10,      // how much cross-line separation survives on a route

  walk: 6.8,
  trot: 17,
  gallop: 34,
  turn: 4.6,
  accel: 3.2,
  accelPanic: 8.0,

  stationDepth: 0.55,        // × guide's R, behind the guide
  stationLane: 0.055,

  alertDecay: 0.20,
  alertHop: 0.80,
  plumeGain: 0.95,
  plumeHalf: 26,             // half-width of the scent cone at zero distance
  plumeSpread: 0.20,         // … widening with distance

  cohesion: 1.15,
};

const TAU = Math.PI * 2;

export class Herd {
  constructor(world, cap = 7000) {
    this.world = world;
    this.cap = cap;
    this.n = 0;
    const A = (k, T = Float32Array) => new T(k);

    this.x = A(cap); this.y = A(cap);
    this.vx = A(cap); this.vy = A(cap);
    this.hd = A(cap); this.spd = A(cap);

    this.stam = A(cap); this.R = A(cap); this.personal = A(cap);
    this.guide = A(cap, Int32Array); this.fcount = A(cap, Int32Array);
    this.senior = A(cap, Int32Array);   // lower = more senior

    this.state = new Uint8Array(cap); this.stateT = A(cap);
    this.alert = A(cap);
    this.pressure = A(cap); this.stress = A(cap); this.crowd = A(cap);
    this.cool = A(cap);
    this.pose = new Uint8Array(cap); this.phase = A(cap);
    this.eyes = A(cap); this.flash = A(cap);

    this.group = new Uint8Array(cap);
    this.seed = A(cap); this.size = A(cap); this.tint = new Uint8Array(cap);
    this.wander = A(cap); this.jitter = A(cap); this.depthJit = A(cap);
    this.slotRank = new Uint8Array(cap);

    this.sepX = A(cap); this.sepY = A(cap);
    this.nbX = A(cap); this.nbY = A(cap); this.nbN = A(cap, Int32Array);
    this.dropHere = A(cap); this.greenHere = A(cap); this.waterHere = A(cap);

    this.stampedeDir = A(cap);
    this.paddock = new Uint8Array(cap);
    this.alpha = new Int32Array(16).fill(-1);

    this.grid = new Grid(world.w, world.h, 70);
    this._q = []; this._q2 = [];

    this.time = 0;
    this.windA = 0.6; this.windTarget = 0.6; this.windRate = 0.05; this.gust = 1;
    this.windX = Math.cos(0.6); this.windY = Math.sin(0.6);

    this.groups = [];
    this.sources = [];
    this.pending = 0;          // animals still in motion after a retarget

    this.switches = 0;
    this.stampedes = 0;
    this.alertEvents = 0;

    this._senseCursor = 0;
    this._senseAcc = 0;
    this._statT = 0;
    this._depth = new Uint16Array(cap);

    this.fenceX = 0; this.fenceY = 0; this.fenceR = 0;
    this.stats = {};
    this.setSeason(0.35);
    this._rnd = mulberry32(12345);
  }

  /* ------------------------------------------------------------------ setup */
  useSeed(seed) { this._rnd = mulberry32(seed); }

  addGroup(id, opts) {
    this.groups[id] = Object.assign({
      id, name: `群${id}`, target: null, radius: 240, tint: id % 4,
    }, opts);
    return this.groups[id];
  }

  add(x, y, gid, stam, opts = {}) {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    const r = this._rnd;
    this.x[i] = x; this.y[i] = y;
    const a = r() * TAU;
    this.vx[i] = 0; this.vy[i] = 0;
    this.hd[i] = a; this.spd[i] = 0;
    this.stam[i] = stam !== undefined ? clamp(stam, 0.12, 1) : 0.4 + r() * 0.55;
    this.updateBody(i);
    this.state[i] = ST.GRAZE; this.stateT[i] = r() * 2;
    this.alert[i] = 0; this.guide[i] = -1;
    this.phase[i] = r() * TAU;
    this.size[i] = 0.84 + r() * 0.3;
    this.tint[i] = Math.floor(r() * 4);
    this.group[i] = gid;
    this.seed[i] = r();
    this.wander[i] = r() * TAU;
    this.jitter[i] = (r() - 0.5) * 2;
    this.depthJit[i] = r();
    this.cool[i] = 0;
    this.pose[i] = 0; this.eyes[i] = 0; this.flash[i] = 0;
    this.pressure[i] = 0; this.stress[i] = 0; this.crowd[i] = 0;
    this.sepX[i] = 0; this.sepY[i] = 0;
    this.nbX[i] = x; this.nbY[i] = y; this.nbN[i] = 0;
    this.dropHere[i] = 0.4; this.greenHere[i] = 0.5; this.waterHere[i] = 0;
    this.stampedeDir[i] = 0;
    this.fcount[i] = 0;
    this.senior[i] = i;
    if (opts.paddock) { this.paddock[i] = 1; this.group[i] = opts.group ?? 4; }
    return i;
  }

  updateBody(i) {
    const s = this.stam[i];
    this.R[i] = P.R0 * (P.Rfloor + (1 - P.Rfloor) * s);
    // A depleted animal cannot hold its own spacing: it is pressed in against
    // its neighbours. So shrinking stamina tightens personal space as well as
    // the vigilance circle, and the two effects compound.
    this.personal[i] = lerp(P.personal[0], P.personal[1], s);
  }

  /**
   * Seniority is local, not global. Each animal ranks itself against the
   * neighbours around it, so "the nearest animal that outranks me" is a
   * meaningful social relation almost everywhere. A global rank would leave
   * most animals with nobody senior inside their vigilance circle, and no
   * chains would ever form.
   */
  assignSeniority() {
    for (let i = 0; i < this.n; i++) {
      this.senior[i] = i;
      this.guide[i] = -1;
      this.fcount[i] = 0;
    }
    // compress the stamina into a neighbourhood contest: within one sense
    // radius, the freshest animal is the local leader and the rest queue behind
    const scratch = this._scratch || (this._scratch = []);
    scratch.length = 0;
    this.grid.clear(this.n);
    for (let i = 0; i < this.n; i++) {
      this.grid.insert(i, this.x[i], this.y[i]);
      scratch.push(i);
    }
    // rank by how much stamina this animal has compared with its surroundings
    const localRank = this._localRank || (this._localRank = new Int32Array(this.cap));
    for (let i = 0; i < this.n; i++) {
      let better = 0;
      const list = this.grid.query(this.x[i], this.y[i], P.senseR * 1.2, this._q2);
      for (let q = 0; q < list.length; q++) {
        const j = list[q];
        if (j === i) continue;
        const si = this.stam[i], sj = this.stam[j];
        if (sj > si + 0.02 || (Math.abs(sj - si) <= 0.02 && j < i)) better++;
      }
      localRank[i] = better;
    }
    for (let i = 0; i < this.n; i++) this.senior[i] = localRank[i];

    this.alpha.fill(-1);
    for (let i = 0; i < this.n; i++) {
      const g = this.group[i];
      if (this.alpha[g] < 0 || this.senior[i] < this.senior[this.alpha[g]]) this.alpha[g] = i;
    }
    this.fcount.fill(0, 0, this.n);
  }

  reset() {
    this.n = 0; this.time = 0;
    this.switches = 0; this.stampedes = 0; this.alertEvents = 0;
    this.alpha.fill(-1);
  }

  /** aridity: 0 = wet season, 1 = height of the dry season */
  setSeason(aridity) {
    this.aridity = aridity;
    // dry: green feed is scarce and walking is costly. wet: feed is abundant.
    this.drainSeason = lerp(0.42, 0.92, aridity);
    this.grazeGain = lerp(0.110, 0.020, aridity);
    // the condition a well-fed animal settles at in this season: wet animals are
    // fresh, dry ones are worn down. Stamina relaxes toward it, so scrubbing the
    // timeline retunes the whole population in a few seconds rather than minutes.
    this.equilibrium = lerp(0.90, 0.34, aridity);
    this.drinkGain = 0.30;
  }

  capacityOf(i) { return i === this.alpha[this.group[i]] ? P.capacityAlpha : P.capacity; }
  outranks(i, j) { return this.senior[j] < this.senior[i]; }

  /* ------------------------------------------------------------------- step */
  step(dt) {
    const n = this.n;
    if (!n) return;
    this.time += dt;
    const dw = wrapAngle(this.windTarget - this.windA);
    this.windA += clamp(dw, -this.windRate * dt, this.windRate * dt);
    this.windX = Math.cos(this.windA); this.windY = Math.sin(this.windA);

    const g = this.grid;
    g.clear(n);
    for (let i = 0; i < n; i++) g.insert(i, this.x[i], this.y[i]);

    const fc = this.fcount;
    fc.fill(0, 0, n);
    const gd = this.guide;
    for (let i = 0; i < n; i++) { const j = gd[i]; if (j >= 0 && j < n) fc[j]++; }

    // adaptive sense budget: aim for ~10 full sweeps per second
    this._senseAcc += dt * 10 * n;
    const budget = Math.min(n, Math.max(1, Math.floor(this._senseAcc)));
    this._senseAcc -= budget;
    let i = this._senseCursor;
    for (let k = 0; k < budget; k++) {
      if (i >= n) i = 0;
      this.sense(i);
      i++;
    }
    this._senseCursor = i % n;

    // the route line each group is walking, for stations and route pulls
    if (!this._routeLine) this._routeLine = {};
    for (const g of this.groups) {
      if (!g || !g.target || g.target.dirX === undefined) { if (g) this._routeLine[g.id] = null; continue; }
      const t = g.target;
      this._routeLine[g.id] = { x0: t.x, y0: t.y, dx: t.dirX, dy: t.dirY };
    }

    this.act(dt);

    this._statT += dt;
    if (this._statT > 0.3) { this._statT = 0; this.computeStats(); }
  }

  sense(i) {
    const n = this.n;
    const x = this.x, y = this.y, stam = this.stam, R = this.R;
    const cx = x[i], cy = y[i];
    const list = this.grid.query(cx, cy, P.senseR, this._q);
    const myR = R[i];
    const myPers = this.personal[i];
    const gi = this.group[i];
    const pad = this.paddock[i];
    const senI = this.senior[i];

    let sx = 0, sy = 0, crowd = 0, pressure = 0, maxAlert = 0;
    let nbx = 0, nby = 0, nbn = 0;
    let best = -1, bestScore = 1e9, bestDist = 1e9;
    // hysteresis: enter the file when stamina drops below followStam, leave it
    // when it has recovered past releaseStam
    const hungry = this.guide[i] >= 0
      ? this.stam[i] < P.releaseStam
      : this.stam[i] < P.followStam;

    const R2 = P.senseR * P.senseR;

    for (let q = 0; q < list.length; q++) {
      const j = list[q];
      if (j === i) continue;
      const dx = cx - x[j], dy = cy - y[j];
      const d2 = dx * dx + dy * dy;
      if (d2 > R2) continue;
      if (this.paddock[j] !== pad) continue;
      const d = Math.sqrt(d2) + 1e-4;

      // --- social spacing and contact pressure ---
      const sr = (myPers + this.personal[j]) * 0.5;
      if (d < sr) {
        const w = 1 - d / sr;
        const inv = 1 / (d + 0.55);
        sx += dx * inv * w;
        sy += dy * inv * w;
      }
      if (d < P.crowdR) {
        crowd++;
        const t = 1 - d / P.crowdR;
        pressure += t * t;             // crowding, weighted toward actual contact
      }

      if (this.alert[j] > maxAlert) maxAlert = this.alert[j];
      if (this.group[j] !== gi) continue;

      if (d < myR) { nbx += x[j]; nby += y[j]; nbn++; }

      // --- guide candidacy ---
      // Only hungry animals look for a guide. A fit animal grazes where it
      // stands; a depleted one locks onto the nearest senior body that still
      // covers it with its (smaller) vigilance circle.
      if (hungry && this.senior[j] < senI && d < R[j] * 0.95 &&
          this.fcount[j] < this.capacityOf(j) &&
          this.state[j] !== ST.STAMPEDE && this.cool[j] <= 0) {
        // A guide must be *ahead of me along the way we are both going*. The
        // heading test alone is not enough — animals facing the same way but
        // side by side would still pair up, and the file would be a blob.
        const toJx = x[j] - cx, toJy = y[j] - cy;
        let ax2 = null, ay2 = null;
        const gT = this.groups[gi];
        if (gT && gT.target && gT.target.dirX !== undefined) { ax2 = gT.target.dirX; ay2 = gT.target.dirY; }
        let along = 0, lateral = 0;
        if (ax2 !== null) {
          along = (toJx * ax2 + toJy * ay2) / d;           // +1: j is ahead on the route
          lateral = Math.abs(-toJx * ay2 + toJy * ax2);
          if (along < 0.25) continue;                     // only queue behind someone ahead
        } else {
          const cosh = Math.cos(this.hd[j]), sinh = Math.sin(this.hd[j]);
          along = (toJx * cosh + toJy * sinh) / d;
          lateral = Math.abs(-toJx * sinh + toJy * cosh);
        }
        // A file is: near, well ahead, small lateral offset.
        const score = d + lateral * 2.2 - along * 26;
        if (score < bestScore) { bestScore = score; best = j; bestDist = d; }
      }
    }

    const sl = Math.hypot(sx, sy);
    if (sl > 4.0) { sx *= 4.0 / sl; sy *= 4.0 / sl; }
    this.sepX[i] = sx; this.sepY[i] = sy;
    this.crowd[i] = crowd;
    this.pressure[i] = pressure;
    if (nbn) { this.nbX[i] = nbx / nbn; this.nbY[i] = nby / nbn; }
    else { this.nbX[i] = cx; this.nbY[i] = cy; }
    this.nbN[i] = nbn;

    // --- keep the current guide while it still covers me (hysteresis) ---
    const cur = this.guide[i];
    let next = hungry ? best : -1;
    if (hungry && cur >= 0 && cur < n && this.cool[i] <= 0) {
      const dcur = Math.hypot(cx - x[cur], cy - y[cur]) + 1e-4;
      const stillCovered = dcur < R[cur] * 1.06;
      const stillSenior = this.senior[cur] < senI;
      if (stillCovered && stillSenior && this.fcount[cur] <= this.capacityOf(cur)) {
        // stay put unless a clearly nearer animal now covers me
        if (best < 0 || bestDist > dcur * 0.72) next = cur;
      }
    }
    if (next !== cur) {
      if (next >= 0 || cur >= 0) this.switches++;
      this.guide[i] = next;
      this.flash[i] = 1;
    }

    // --- alarm conducted body to body, gain < 1 ---
    if (maxAlert > this.alert[i] + 0.01) {
      const before = this.alert[i];
      const v = this.alert[i] + P.alertHop * (maxAlert - this.alert[i]);
      if (before < 0.35 && v >= 0.35) this.alertEvents++;
      this.alert[i] = Math.min(1.0, v);
    }

    // --- scent plume ---
    const srcs = this.sources;
    for (let s = 0; s < srcs.length; s++) {
      const src = srcs[s];
      if (!src.active) continue;
      const dx = cx - src.x, dy = cy - src.y;
      const along = dx * this.windX + dy * this.windY;
      if (along < 12) continue;                    // upwind of the source: no scent
      const perp = Math.abs(dx * this.windY - dy * this.windX);
      const spread = P.plumeHalf + along * P.plumeSpread;
      if (perp > spread) continue;
      const dist = Math.hypot(dx, dy);
      if (dist > src.radius) continue;
      const str = (1 - dist / src.radius) * (1 - perp / spread) * src.strength;
      if (str > 0.04) {
        const before = this.alert[i];
        this.alert[i] = Math.min(1.0, this.alert[i] + str * P.plumeGain * this.gust * 0.6);
        if (before < 0.35 && this.alert[i] >= 0.35) this.alertEvents++;
      }
    }

    const w = this.world;
    this.dropHere[i] = w.dropAt(cx, cy);
    this.greenHere[i] = w.eatAt(cx, cy);
    this.waterHere[i] = w.drinkDist(cx, cy) < 42 ? 1 : 0;
  }

  act(dt) {
    const n = this.n;
    const x = this.x, y = this.y, vx = this.vx, vy = this.vy;
    const hd = this.hd, spd = this.spd;
    const st = this.state, stT = this.stateT;
    const stam = this.stam, R = this.R;
    const alert = this.alert, guide = this.guide;
    const sepX = this.sepX, sepY = this.sepY;
    const world = this.world;
    const W = world.w, H = world.h;
    const wx = this.windX, wy = this.windY;

    for (let k = 0; k < n; k++) {
      let desX = sepX[k] * P.sepSpeed;
      let desY = sepY[k] * P.sepSpeed;
      // On a route, separation is suppressed across the line of travel and kept
      // along it: animals queue nose-to-tail instead of fanning out sideways.
      const grpT = this.groups[this.group[k]];
      const onRoute = grpT && grpT.target && grpT.target.dirX !== undefined &&
                      grpT.target.patrolR > 40;
      if (onRoute) {
        const dxA = grpT.target.dirX, dyA = grpT.target.dirY;
        const along = sepX[k] * dxA + sepY[k] * dyA;
        const perpX = sepX[k] - along * dxA, perpY = sepY[k] - along * dyA;
        desX = (along * dxA + perpX * P.lateralCalm) * P.sepSpeed;
        desY = (along * dyA + perpY * P.lateralCalm) * P.sepSpeed;
      }
      let maxS = P.walk;
      let s = st[k];
      const a = alert[k];

      // ------------------------- timers -------------------------
      if (stT[k] > 0) {
        stT[k] -= dt;
        if (stT[k] <= 0) {
          if (s === ST.ALERT) { s = ST.FLEE; stT[k] = 0.8 + this.seed[k] * 1.1; }
          else if (s === ST.FLEE) { s = ST.GRAZE; stT[k] = 0.4 + this.seed[k]; }
          else if (s === ST.STAMPEDE) { s = ST.VIGIL; stT[k] = 0.5 + this.seed[k] * 0.8; this.stress[k] = 0; }
          else if (s === ST.VIGIL) { s = ST.GRAZE; stT[k] = 0.5 + this.seed[k] * 2.2; }
          st[k] = s;
        }
      }
      if (this.cool[k] > 0) this.cool[k] -= dt;
      if (this.flash[k] > 0) this.flash[k] = Math.max(0, this.flash[k] - dt * 1.8);

      // ---------------------- alarm state ----------------------
      if (a > 0.62 && (s === ST.GRAZE || s === ST.VIGIL)) {
        st[k] = ST.ALERT; s = ST.ALERT; stT[k] = 0.45 + this.seed[k] * 0.75;
      } else if (a > 0.34 && s === ST.GRAZE && this.seed[k] > 0.55) {
        st[k] = ST.VIGIL; s = ST.VIGIL; stT[k] = 0.35 + this.seed[k] * 0.7;
      }

      // ------------- pressure → stress → stampede -------------
      const tol = P.tolBase + P.tolGain * stam[k];
      const over = this.pressure[k] - tol;
      if (over > 0) this.stress[k] = Math.min(3.0, this.stress[k] + over * P.stressRate * dt);
      else this.stress[k] = Math.max(0, this.stress[k] - P.stressDecay * dt);
      if (s !== ST.STAMPEDE && this.cool[k] <= 0 && this.stress[k] > 1.0) {
        this.bolt(k);
        s = ST.STAMPEDE;
      }

      const f = guide[k];

      // ------------------------ behaviour ------------------------
      if (s === ST.STAMPEDE) {
        const dir = this.stampedeDir[k];
        desX += Math.cos(dir) * P.gallop * 1.2;
        desY += Math.sin(dir) * P.gallop * 1.2;
        maxS = P.gallop;
      } else if (s === ST.FLEE) {
        const up = smoothstep(0.22, 0.95, a);
        desX += -wx * P.trot * 0.6 * up;
        desY += -wy * P.trot * 0.6 * up;
        maxS = P.walk + (P.trot - P.walk) * up;
        if (a < 0.16) { st[k] = ST.GRAZE; stT[k] = 0.5; s = ST.GRAZE; }
      } else if (s === ST.ALERT || s === ST.VIGIL) {
        desX *= 0.18; desY *= 0.18;
        const up = smoothstep(0.35, 1.0, a);
        desX += -wx * 5.0 * up;      // head up first, then a step into the wind
        desY += -wy * 5.0 * up;
        maxS = 2.3 + 6.2 * up;
      } else if (f >= 0 && f < n && this.cool[k] <= 0) {
        // ---------- follower: hold station in the file ----------
        // The station is directly behind the guide at a distance set by the
        // guide's vigilance radius, so a shrinking circle pulls the queue in.
        // Followers of the same guide take distinct lateral lanes, which is what
        // turns a knot of bodies into an actual file rather than a blob.
        const guideReady = spd[f];
        const gR = R[f];
        const lhd = hd[f];
        const cosH = Math.cos(lhd), sinH = Math.sin(lhd);
        const lead = f === this.alpha[this.group[k]];
        // spread followers of one guide along the column, not side by side
        const rank = Math.min(3, this.fcount[f] > 0 ? (this.slotRank[k] % 3) : 0);
        const depth = clamp(gR * P.stationDepth, 5.0, 40) * (1 + rank * 0.55)
                    + this.depthJit[k] * (lead ? 8 : 4);
        const lane = clamp(gR * P.stationLane, 0.9, 4.0) * this.jitter[k] * (lead ? 2.2 : 1.3);
        let tx = x[f] - cosH * depth - sinH * lane;
        let ty = y[f] - sinH * depth + cosH * lane;
        // if the group is walking a route, pull the station onto the route line
        const gT = this.groups[this.group[k]];
        if (gT && gT.target && gT.target.dirX !== undefined && gT.target.patrolR > 40 && this._routeLine) {
          const rl = this._routeLine[this.group[k]];
          if (rl) {
            const dxr = tx - rl.x0, dyr = ty - rl.y0;
            const along = dxr * rl.dx + dyr * rl.dy;
            const perp = -dxr * rl.dy + dyr * rl.dx;
            const perp2 = perp * 0.30;
            tx = rl.x0 + rl.dx * along - rl.dy * perp2;
            ty = rl.y0 + rl.dy * along + rl.dx * perp2;
          }
        }
        const ddx = tx - x[k], ddy = ty - y[k];
        const dd = Math.hypot(ddx, ddy) + 1e-3;
        const urgency = clamp((dd - 5) / 22, 0, 1.3);
        const fs = Math.min(P.trot, Math.max(1.0, guideReady) * lerp(0.85, 1.5, clamp(urgency, 0, 1)));
        desX += (ddx / dd) * fs;
        desY += (ddy / dd) * fs;
        maxS = Math.max(P.walk * 0.8, Math.min(P.trot, fs * 1.35));
        st[k] = ST.FOLLOW;
      } else {
        // --------------------- free animal ---------------------
        // A free animal grazes where it stands unless it is hungry (then it
        // walks to water) or its group has been moved (then it follows the
        // group's migration target). Both pulls fade out near the destination,
        // so the herd settles and can rest — which is what lets stamina recover.
        st[k] = ST.GRAZE;
        const grp = this.groups[this.group[k]];
        const thirst = 1 - stam[k];
        let tx = null, ty = null, strength = 0;
        if (grp && grp.target) {
          // A target is a *place the group is walking to*, not a set of static
          // parking bays. As long as there is distance left, everyone simply
          // heads for it; the file that forms on the way is the formation. Once
          // the group is there, the aim point strolls slowly along its axis, so
          // the column keeps walking in place instead of collapsing to a disc.
          const tg = grp.target;
          // The aim point runs a slow closed route around the water. Every
          // animal walks that route — so they all travel in the same direction,
          // and "stand behind your guide" lays the group out along the path as
          // a file. This is the difference between a crowd and a column.
          // Every animal owns a *point on the route*, not the whole route: they
          // are spread along it by their own seed. A chain of animals each
          // standing behind its guide, all of them strung out along one line,
          // is a single file — and it stays a file while the route moves.
          const pr = tg.patrolR || 60;
          const lead = tg.patrolW || 0.02;
          const spanU = tg.spread || pr;
          const u = (this.seed[k] - 0.5) * 2;                       // −1 … 1 along the route
          // the whole route creeps forward at walking pace — a fraction of the
          // route length per second, so every slot stays reachable
          const pos = u * spanU + Math.sin(this.time * lead * 1.4) * 70;
          const wob = this.jitter[k] * (tg.width || 18) + Math.sin(this.time*0.7 + k*1.7) * 2.0;
          const sCal = Math.sin(this.time * lead * 9 + grp.id) * 0.5;
          const ax = tg.x + tg.dirX * (pos + sCal * 40) - tg.dirY * wob;
          const ay = tg.y + tg.dirY * (pos + sCal * 40) + tg.dirX * wob;
          // aim a little way along the route, not at the moving point itself:
          // a lead the whole group can actually follow
          const lx = ax, ly = ay;
          const gdx = lx - x[k], gdy = ly - y[k];
          const gd2 = Math.hypot(gdx, gdy);
          if (gd2 > 4) {
            // weight the pull: strongly along the line, weakly across it, so the
            // crowd is squeezed into a band and then strung out along it
            const alongC = gdx * tg.dirX + gdy * tg.dirY;
            const perpC = -gdx * tg.dirY + gdy * tg.dirX;
            const wx2 = alongC * 1.0, wy2 = perpC * 1.9;
            const mx = tg.dirX * wx2 - tg.dirY * wy2;
            const my = tg.dirY * wx2 + tg.dirX * wy2;
            const ml = Math.hypot(mx, my) + 1e-3;
            tx = x[k] + mx; ty = y[k] + my;
            strength = tg.strength * clamp(ml / 110, 0.5, 1);
          }

        }
        if (tx === null && thirst > 0.55) {
          const wt = world.nearestWater(x[k], y[k]);
          if (wt) {
            const dxw = wt.x - x[k], dyw = wt.y - y[k];
            const dwn = Math.hypot(dxw, dyw) + 1e-3;
            tx = wt.x - (dxw / dwn) * wt.r * 0.85;
            ty = wt.y - (dyw / dwn) * wt.r * 0.85;
            strength = clamp((thirst - 0.55) * 2.2, 0, 1);
          }
        }
        if (tx !== null && strength > 0.01) {
          const dx = tx - x[k], dy = ty - y[k];
          const dd = Math.hypot(dx, dy) + 1e-3;
          const push = P.trot * 1.05 * strength;
          desX += (dx / dd) * push;
          desY += (dy / dd) * push;
          maxS = Math.max(maxS, P.trot * 1.05);
        }
        if (this.nbN[k] > 0) {
          const dx = this.nbX[k] - x[k], dy = this.nbY[k] - y[k];
          const dd = Math.hypot(dx, dy) + 1e-3;
          const pref = clamp(R[k] * 0.26, 7, 40);
          const pull = clamp((dd - pref) / 60, -0.25, 0.30) * P.cohesion;
          desX += (dx / dd) * P.walk * 0.30 * pull;
          desY += (dy / dd) * P.walk * 0.30 * pull;
        }
        const wA = this.wander[k] + this.time * 0.2;
        desX += Math.cos(wA) * 1.5;
        desY += Math.sin(wA) * 1.5;
      }

      // ---------------- active outward shove ----------------
      if (this.pressure[k] > tol * 0.5) {
        const sl = Math.hypot(sepX[k], sepY[k]);
        if (sl > 0.05) {
          const extra = (this.pressure[k] / (tol + 1e-3)) * P.shoveSpeed;
          desX += (sepX[k] / sl) * extra;
          desY += (sepY[k] / sl) * extra;
        }
      }

      // ----------------------- fence -----------------------
      if (this.paddock[k]) {
        const pdx = x[k] - this.fenceX, pdy = y[k] - this.fenceY;
        const pd = Math.hypot(pdx, pdy);
        if (pd > this.fenceR) {
          const nx = pdx / (pd + 1e-6), ny = pdy / (pd + 1e-6);
          const push = (pd - this.fenceR) * 2.4 + 12;
          desX -= nx * push; desY -= ny * push;
        }
      }

      // --------------------- world edge ---------------------
      const bm = 90;
      if (x[k] < bm) desX += (bm - x[k]) * 0.3;
      if (x[k] > W - bm) desX -= (x[k] - (W - bm)) * 0.3;
      if (y[k] < bm) desY += (bm - y[k]) * 0.3;
      if (y[k] > H - bm) desY -= (y[k] - (H - bm)) * 0.3;

      // ---------------------- integrate ----------------------
      const accel = (s === ST.STAMPEDE || s === ST.FLEE) ? P.accelPanic : P.accel;
      const mix = Math.min(1, accel * dt);
      vx[k] += (desX - vx[k]) * mix;
      vy[k] += (desY - vy[k]) * mix;
      let sp = Math.hypot(vx[k], vy[k]);
      if (sp > maxS) { const q = maxS / sp; vx[k] *= q; vy[k] *= q; sp = maxS; }
      x[k] += vx[k] * dt;
      y[k] += vy[k] * dt;
      if (x[k] < 4) x[k] = 4; else if (x[k] > W - 4) x[k] = W - 4;
      if (y[k] < 4) y[k] = 4; else if (y[k] > H - 4) y[k] = H - 4;
      spd[k] = sp;

      if (sp > 0.4 && s !== ST.ALERT && s !== ST.VIGIL) {
        const target = Math.atan2(vy[k], vx[k]);
        const mt = P.turn * dt * (sp < 3 ? 0.5 : 1);
        hd[k] += clamp(wrapAngle(target - hd[k]), -mt, mt);
        this.phase[k] += dt * (2.0 + sp * 0.25);
        if (this.phase[k] > 1e6) this.phase[k] %= TAU;
      } else {
        this.phase[k] += dt * 0.55;
        hd[k] += Math.sin(this.wander[k] + this.time * 0.35) * 0.3 * dt;
      }

      // ---------------------- stamina ----------------------
      // Dry season: grazing is nearly worthless and walking is expensive, so
      // stamina runs down and every vigilance circle shrinks. Wet season: the
      // ground is green, so animals recover while they graze and the circles
      // reopen. That difference is what the season timeline drives.
      if (!this.paddock[k]) {
        const gait = sp < 1.2 ? 0 : sp < P.walk + 1 ? 1 : sp < P.trot + 2 ? 2 : 3;
        let drain = 0.0015 + 0.0080 * this.dropHere[k] * (0.35 + 0.32 * gait);
        drain *= this.drainSeason;
        if (s === ST.STAMPEDE) drain += P.stampedeDrain;
        let gain = 0;
        // Forage is only metabolised at rest: an animal has to stop, put its
        // head down and chew. That is what makes a depleted herd stop moving —
        // and stopping is the only way anybody recovers. The forage floor itself
        // falls away through the dry season, so the same animal burns down.
        if (sp < 4.2) {
          gain = Math.max(lerp(0.055, 0.004, this.aridity), this.greenHere[k] * lerp(0.075, 0.010, this.aridity));
          if (this.waterHere[k] > 0.5) gain += this.drinkGain;
        }
        const before = stam[k];
        let next = stam[k] + (gain - drain) * dt;
        // relax toward the season's equilibrium condition
        next += (this.equilibrium - next) * Math.min(1, dt * 0.55);
        next = clamp(next, P.stamMin, 1);
        stam[k] = next;
        if (Math.abs(stam[k] - before) > 0.003) this.updateBody(k);
      }

      alert[k] = Math.max(0, a - P.alertDecay * dt);

      // ------------------------ pose ------------------------
      let pose;
      if (s === ST.STAMPEDE) pose = 4;
      else if (s === ST.FLEE) pose = sp > 9 ? 3 : 1;
      else if (s === ST.ALERT || s === ST.VIGIL) pose = 2;
      else if (sp > P.trot * 0.7) pose = 3;
      else if (sp > 1.2) pose = 1;
      else pose = 0;
      this.pose[k] = pose;
      this.eyes[k] = (s === ST.ALERT || s === ST.VIGIL) ? 1 : clamp(a * 1.6, 0, 1);
    }
  }

  bolt(i) {
    const st = this.state;
    st[i] = ST.STAMPEDE;
    this.stateT[i] = lerp(P.stampedeTime[0], P.stampedeTime[1], this.seed[i]);
    this.alert[i] = Math.max(this.alert[i], 0.92);
    this.cool[i] = lerp(P.coolTime[0], P.coolTime[1], this.seed[i]);
    this.stress[i] = 0;
    this.guide[i] = -1;
    this.stampedes++;
    const list = this.grid.query(this.x[i], this.y[i], 70, this._q2);
    let cx = 0, cy = 0, m = 0;
    for (let q = 0; q < list.length; q++) {
      const j = list[q];
      if (j === i || this.paddock[j] !== this.paddock[i]) continue;
      cx += this.x[j]; cy += this.y[j]; m++;
    }
    let ang;
    if (m) { cx /= m; cy /= m; ang = Math.atan2(this.y[i] - cy, this.x[i] - cx); }
    else ang = this.seed[i] * TAU;
    this.stampedeDir[i] = ang + (this.seed[i] - 0.5) * 0.6;
    for (let q = 0; q < list.length; q++) {
      const j = list[q];
      if (j === i) continue;
      this.alert[j] = Math.max(this.alert[j], 0.8);
    }
  }

  computeStats() {
    const n = this.n;
    if (!n) return;
    const step = Math.max(1, Math.floor(n / 700));
    let grazing = 0, following = 0, stamp = 0, alerted = 0, fleeing = 0, switching = 0;
    for (let i = 0; i < n; i++) {
      const s = this.state[i];
      if (s === ST.GRAZE) grazing++;
      else if (s === ST.FOLLOW) following++;
      else if (s === ST.STAMPEDE) stamp++;
      if (s === ST.ALERT || s === ST.FLEE || s === ST.STAMPEDE) fleeing++;
      if (this.alert[i] > 0.35) alerted++;
      if (this.flash[i] > 0.5) switching++;
    }
    let nnSum = 0, stSum = 0, rSum = 0, cnt = 0, linkSum = 0, linkN = 0;
    let mx = 0, my = 0, mc = 0, prSum = 0;
    for (let i = 0; i < n; i += step) {
      const list = this.grid.query(this.x[i], this.y[i], 70, this._q2);
      let best = 1e18;
      for (let q = 0; q < list.length; q++) {
        const j = list[q];
        if (j === i || this.paddock[j] !== this.paddock[i]) continue;
        const dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j];
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
      if (best < 1e18) { nnSum += Math.sqrt(best); cnt++; }
      stSum += this.stam[i]; rSum += this.R[i]; prSum += this.pressure[i];
      const f = this.guide[i];
      if (f >= 0 && f < n) linkSum += Math.hypot(this.x[i] - this.x[f], this.y[i] - this.y[f]), linkN++;
      mx += this.x[i]; my += this.y[i]; mc++;
    }
    mx /= mc; my /= mc;
    let m2x = 0, m2y = 0, mxy = 0;
    for (let i = 0; i < n; i += step) {
      const dx = this.x[i] - mx, dy = this.y[i] - my;
      m2x += dx * dx; m2y += dy * dy; mxy += dx * dy;
    }
    m2x /= mc; m2y /= mc; mxy /= mc;
    const tr = m2x + m2y, det = m2x * m2y - mxy * mxy;
    const disc = Math.sqrt(Math.max(0, tr * tr * 0.25 - det));
    const l1 = tr * 0.5 + disc, l2 = Math.max(1e-9, tr * 0.5 - disc);

    const depth = this._depth;
    depth.fill(0, 0, n);
    let sumD = 0, maxD = 0, roots = 0, files = 0;
    for (let i = 0; i < n; i++) {
      if (depth[i]) { sumD += depth[i]; continue; }
      let j = i, guard = 0;
      const stack = [];
      while (j >= 0 && j < n && !depth[j] && guard++ < 2000) { stack.push(j); j = this.guide[j]; }
      let base = (j >= 0 && j < n) ? depth[j] : 0;
      if (j < 0 || j >= n) { roots++; if (this.fcount[i] >= 2) files++; }
      for (let q = stack.length - 1; q >= 0; q--) { base++; depth[stack[q]] = base; }
      if (stack.length) sumD += base;
    }
    for (let i = 0; i < n; i++) if (depth[i] > maxD) maxD = depth[i];

    const S = this.stats;
    S.pop = n;
    S.grazing = grazing; S.following = following; S.stampede = stamp;
    S.alerted = alerted; S.fleeing = fleeing; S.switching = switching;
    S.meanNN = cnt ? nnSum / cnt : 0;
    S.meanStam = stSum / cnt;
    S.meanR = rSum / cnt;
    S.meanPressure = prSum / cnt;
    S.meanLink = linkN ? linkSum / linkN : 0;
    S.files = files; S.roots = roots;
    S.depth = sumD / n; S.maxDepth = maxD;
    S.elongation = Math.sqrt(l1 / l2);
    S.switches = this.switches;
    S.stampedes = this.stampedes;
    S.alertEvents = this.alertEvents;
  }

  setPaddockFence(x, y, r) { this.fenceX = x; this.fenceY = y; this.fenceR = r; }

  paddockStats() {
    let k = 0, p = 0, s = 0, stam = 0, stamp = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.paddock[i]) continue;
      k++; p += this.pressure[i]; s += this.stress[i]; stam += this.stam[i];
      if (this.state[i] === ST.STAMPEDE) stamp++;
    }
    if (!k) return { count: 0, pressure: 0, stress: 0, stamina: 0, stampeding: 0 };
    return { count: k, pressure: p / k, stress: s / k, stamina: stam / k, stampeding: stamp };
  }
}
