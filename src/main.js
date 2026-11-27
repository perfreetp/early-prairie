// Main application: wires the sim, renderer, camera, input and UI together.
import { World, Camera, WORLD } from './world.js';
import { Herd, ST } from './herd.js';
import { Renderer } from './render.js';
import { makeHerd, retargetGroups, setPaddockStamina, PADDOCK, LAKE } from './scenario.js';
import { UI, seasonName } from './ui.js';
import { clamp, lerp, mulberry32 } from './rng.js';

const PIXI_READY = () => typeof PIXI !== 'undefined';

class App {
  constructor() {
    this.world = new World();
    this.cam = new Camera(this.world);
    this.season = 0.10;
    this.timeline = 0.10;
    this.playing = false;
    this.playSpeed = 1;
    this.speeds = [0.5, 1, 2, 4];
    this.speedIdx = 1;
    this.popLevels = [800, 1600, 2600, 4000, 5600];
    this.popIdx = 2;
    this.toggles = { warn: false, link: false, press: false, padHud: true };
    this.simRate = 1;
    this.frame = 0;
    this.fps = 60;
    this._fpsAcc = 0; this._fpsN = 0;
    this.herd = null;
    this.renderer = null;
    this.ui = null;
    this._lastTs = 0;
    this._timelineTarget = null;
    this._rebuildAt = null;
  }

  async init() {
    const P = PIXI;
    this.px = Math.min(window.devicePixelRatio || 1, 2);
    this.app = new P.Application();
    await this.app.init({
      background: '#0d0b08',
      antialias: true,
      resolution: this.px,
      autoDensity: true,
      resizeTo: window,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    document.getElementById('stage').appendChild(this.app.canvas);

    this.cam.setViewport(this.app.screen.width, this.app.screen.height);
    this.cam.jumpTo(this.world.w * 0.5, this.world.h * 0.52, this.fitZoom() * 1.0);

    this.herd = makeHerd(this.world, {
      pop: this.popLevels[this.popIdx],
      season: this.season,
      seed: 13,
    });
    this.herd.setSeason(this.season);

    this.renderer = new Renderer(this.app, this.world, this.herd);
    await this.renderer.init();

    this.ui = new UI(this);
    this.ui.bind();
    this.ui.setTimeline(this.timeline);
    this.ui.setPlaying(false);
    this.ui.setSpeed(this.speeds[this.speedIdx]);
    this.ui.setPopulation(this.popLevels[this.popIdx]);
    this.resetPadSlider();
    this.bindCanvas();

    this.fitAll(true);
    this.ui.toast('拖动时间轴看旱季→雨季，或按空格播放');
    setTimeout(() => this.ui.el.hint && this.ui.el.hint.classList.add('fade'), 9000);

    this.app.ticker.maxFPS = 60;
    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS / 1000));
  }

  fitZoom() {
    const w = this.app.screen.width, h = this.app.screen.height;
    // "cover": the terrain always fills the viewport, no letterboxing
    return Math.max(w / this.world.w, h / this.world.h) * 1.0;
  }

  resetPadSlider() {
    const sl = this.ui.el.padStam;
    sl.value = PADDOCK.stamina;
    this.ui.el.padStamVal.textContent = PADDOCK.stamina.toFixed(2);
  }

  /* -------------------------------------------------------------- timeline */
  setTimeline(t, opts = {}) {
    this.timeline = clamp(t, 0, 1);
    this._timelineTarget = null;
    this.ui.setTimeline(this.timeline);
    const wasBig = Math.abs(t - (this._lastApplied ?? t)) > 0.001;
    this.applySeason(this.timeline);
    // Scrubbing changes a condition the herd has been living in, so after the
    // drag we run the sim quietly to the new equilibrium. Only one settle job can
    // be in flight; a newer scrub replaces it.
    if (opts.settle !== false) {
      this.requestSettle(wasBig ? 150 : 0);
    }
  }

  requestSettle(seconds) {
    this._settleLeft = Math.max(this._settleLeft || 0, Math.round(seconds * 30));
  }

  nudgeTimeline(d) { this.setTimeline(this.timeline + d); }

  /** Run the sim forward in one burst so a scrubbed season shows its settled shape. */
  settle(seconds = 45) {
    const dt = 1 / 30;
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) this.herd.step(dt);
    this.herd.computeStats();
  }

  flyTimeline(t) {
    this._timelineTarget = clamp(t, 0, 1);
    if (!this.playing) this.setPlaying(true);
  }

  retargetGroupsFor(t) { retargetGroups(this.herd, t); }

  applySeason(t) {
    const drift = Math.abs(t - (this._appliedT ?? t));
    this.season = t;
    this.timeline = t;
    this.herd.setSeason(t);
    // A season change is a *condition*, not an event: when the user scrubs to a
    // new season the animals have in fact been living in it. Rather than show a
    // herd still mid-migration, we let the sim run forward out of sight until
    // the formation has settled at that condition, then show the result.
    this._appliedT = t;
    // rebuild sampled fields only when the season moved appreciably
    const key = Math.round(t * 40) / 40;
    if (key !== this._seasonKey) {
      this._seasonKey = key;
      this.world.build(t);
      this.renderer.rebuildTerrain(t);
    }
    retargetGroups(this.herd, t);
  }

  setPlaying(on) {
    this.playing = on;
    this.ui.setPlaying(on);
    if (on && this.timeline >= 0.995) this.timeline = 0.0;
  }

  cycleSpeed() {
    this.speedIdx = (this.speedIdx + 1) % this.speeds.length;
    this.playSpeed = this.speeds[this.speedIdx];
    this.ui.setSpeed(this.playSpeed);
  }

  cyclePopulation() {
    this.popIdx = (this.popIdx + 1) % this.popLevels.length;
    this.ui.setPopulation(this.popLevels[this.popIdx]);
    this.rebuild();
    this.ui.toast(`重设场景：${this.popLevels[this.popIdx]} 只`);
  }

  rebuild() {
    const keepSeason = this.timeline;
    this.herd = makeHerd(this.world, {
      pop: this.popLevels[this.popIdx],
      season: keepSeason,
      seed: 13 + this.popIdx,
    });
    this.herd.setSeason(keepSeason);
    retargetGroups(this.herd, keepSeason);
    this.renderer.herd = this.herd;
    this.resetPadSlider();
    setPaddockStamina(this.herd, PADDOCK.stamina);
  }

  setPaddockStamina(v) {
    setPaddockStamina(this.herd, v);
    this.ui.el.padStamVal.textContent = v.toFixed(2);
    const side = v < PADDOCK.flip ? '低于' : '高于';
    this.ui.toast(`${side}临界值 ${PADDOCK.flip.toFixed(2)} → ${v < PADDOCK.flip ? '开始踩踏散开' : '重新聚拢'}`, 1800);
  }

  /* ---------------------------------------------------------------- camera */
  fitAll(instant) {
    const z = this.fitZoom();
    if (instant) this.cam.jumpTo(this.world.w * 0.5, this.world.h * 0.52, z);
    else this.cam.flyTo(this.world.w * 0.5, this.world.h * 0.52, z);
  }

  focusPaddock() {
    this.cam.flyTo(PADDOCK.x - 30, PADDOCK.y - 10, 1.55);
    this.ui.toast('围栏站：拖动「体力」滑块观察翻转', 3000);
    if (!this.toggles.warn) {
      this.toggles.warn = true;
      this.ui.el.warnToggle.classList.add('on');
    }
  }

  bindCanvas() {
    const c = this.app.canvas;
    const cam = this.cam;
    let dragging = false, lastX = 0, lastY = 0, moved = 0;

    c.addEventListener('pointerdown', (e) => {
      if (e.button === 1 || e.button === 2) return;
      dragging = true; moved = 0;
      lastX = e.clientX; lastY = e.clientY;
      c.setPointerCapture(e.pointerId);
      c.classList.add('grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX, dy = e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      cam.pan(dx, dy);
    });
    const end = (e) => {
      dragging = false;
      c.classList.remove('grabbing');
      try { c.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const f = Math.pow(1.0018, -e.deltaY);
      cam.zoomAt(e.clientX, e.clientY, f);
    }, { passive: false });

    // double-click: fly to that spot and zoom in
    c.addEventListener('dblclick', (e) => {
      const [wx, wy] = cam.toWorld(e.clientX, e.clientY);
      cam.flyTo(wx, wy, Math.min(cam.maxZoom, cam.zoom * 3.2));
    });

    // pinch zoom
    const pts = new Map();
    c.addEventListener('pointerdown', (e) => pts.set(e.pointerId, e));
    c.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (this._pinch) {
          cam.zoomAt((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2, d / this._pinch);
        }
        this._pinch = d;
        dragging = false;
      }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) this._pinch = null; };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);

    // inset click to jump
    const inset = document.querySelector('#inset canvas');
    if (inset) {
      inset.addEventListener('click', (e) => {
        const r = inset.getBoundingClientRect();
        const wx = (e.clientX - r.left) / r.width * this.world.w;
        const wy = (e.clientY - r.top) / r.height * this.world.h;
        this.cam.flyTo(wx, wy, Math.max(this.cam.zoom, 0.55));
      });
      inset.style.cursor = 'pointer';
    }

    window.addEventListener('resize', () => {
      this.app.resize();
      this.cam.setViewport(this.app.screen.width, this.app.screen.height);
    });
  }

  /* ------------------------------------------------------------------ loop */
  tick(dt) {
    const raw = dt;
    this.frame++;
    this._fpsAcc += raw; this._fpsN++;
    if (this._fpsAcc > 0.5) {
      this.fps = this._fpsN / this._fpsAcc;
      this._fpsAcc = 0; this._fpsN = 0;
    }

    // timeline auto-advance
    if (this.playing) {
      const next = this.timeline + raw * 0.035 * this.playSpeed;
      let t = this._timelineTarget != null ? next : next;
      if (t >= 1) { t = 1; this.setPlaying(false); }
      this.applySeason(clamp(t, 0, 1));
      this.ui.setTimeline(this.timeline);
      if (this.timeline >= 1) this.playing = false;
    } else if (this._timelineTarget != null) {
      const d = this._timelineTarget - this.timeline;
      if (Math.abs(d) < 0.004) {
        this.applySeason(this._timelineTarget);
        this.ui.setTimeline(this.timeline);
        this._timelineTarget = null;
      } else {
        const step = Math.sign(d) * Math.min(Math.abs(d), raw * 0.20);
        this.applySeason(clamp(this.timeline + step, 0, 1));
        this.ui.setTimeline(this.timeline);
      }
    }

    // quietly finish a scrub's settling: a capped number of sim steps per frame
    if (this._settleLeft > 0 && !this._dragging) {
      const chunk = Math.min(this._settleLeft, 300);
      const dtS = 1 / 30;
      for (let i = 0; i < chunk; i++) this.herd.step(dtS);
      this._settleLeft -= chunk;
    }

    this.cam.update(raw);

    // simulation: fixed sub-steps, decoupled from the render fps
    const simDt = Math.min(raw, 1 / 20);
    const steps = simDt > 1 / 45 ? 2 : 1;
    const h = simDt / steps;
    for (let s = 0; s < steps; s++) this.herd.step(h);

    this.renderer.showWarn = this.toggles.warn;
    this.renderer.showLinks = this.toggles.link;
    this.renderer.showPressure = this.toggles.press;
    this.renderer.draw(this.cam, raw, {});

    if (this.frame % 6 === 0) {
      const pad = this.herd.paddockStats();
      pad.tolerance = padTolerance(this.herd);
      this.ui.update(this.herd.stats, pad, this.fps, null);
      this.ui.drawInset(this.herd, this.world);
    }
  }
}

function padTolerance(herd) {
  // average tolerance across the paddock, shown as the flip mark on the bar
  let sum = 0, k = 0;
  for (let i = 0; i < herd.n; i++) {
    if (!herd.paddock[i]) continue;
    sum += 0.42 + 2.75 * herd.stam[i];
    k++;
  }
  return k ? sum / k : 0;
}

window.addEventListener('DOMContentLoaded', async () => {
  const boot = document.getElementById('boot');
  try {
    const app = new App();
    window.__app = app;
    await app.init();
    boot.classList.add('gone');
    setTimeout(() => boot.remove(), 700);
  } catch (err) {
    console.error(err);
    if (boot) {
      boot.innerHTML = `<div class="err"><h2>无法启动</h2><pre>${String(err && err.stack || err)}</pre></div>`;
    }
  }
});
