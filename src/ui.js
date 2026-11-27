// UI: HUD chrome, the time axis, the paddock station and the legend.
// Pure DOM/SVG on top of the canvas — no Pixi involvement.

const $ = (sel, root = document) => root.querySelector(sel);

export class UI {
  constructor(app) {
    this.app = app;
    this.el = {
      statStam: $('#v-stam'),
      statR: $('#v-R'),
      statNN: $('#v-nn'),
      statDepth: $('#v-depth'),
      statFiles: $('#v-files'),
      statSw: $('#v-sw'),
      statPress: $('#v-press'),
      statFps: $('#v-fps'),
      seasonLabel: $('#season-label'),
      seasonSub: $('#season-sub'),
      timeline: $('#timeline'),
      timelineFill: $('#timeline-fill'),
      timelineHead: $('#timeline-head'),
      seasonTicks: $('#season-ticks'),
      playBtn: $('#btn-play'),
      speedBtn: $('#btn-speed'),
      popBtn: $('#btn-pop'),
      popLabel: $('#pop-label'),
      padStam: $('#pad-stam'),
      padStamVal: $('#pad-stam-val'),
      padFlip: $('#pad-flip'),
      padState: $('#pad-state'),
      padMeta: $('#pad-meta'),
      padBar: $('#pad-bar'),
      padFlipMark: $('#pad-flip-mark'),
      padZoom: $('#btn-pad-zoom'),
      inset: $('#inset canvas'),
      warnToggle: $('#tg-warn'),
      linkToggle: $('#tg-link'),
      pressToggle: $('#tg-press'),
      padToggle: $('#tg-pad'),
      hint: $('#hint'),
      toast: $('#toast'),
      stages: document.querySelectorAll('[data-season-jump]'),
    };
  }

  bind() {
    const app = this.app;
    // --- timeline scrubbing ---
    const tl = this.el.timeline;
    let dragging = false;
    const seek = (ev) => {
      const r = tl.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      app.setTimeline(t);
    };
    tl.addEventListener('pointerdown', (e) => {
      dragging = true; tl.setPointerCapture(e.pointerId); app.setPlaying(false); seek(e);
    });
    tl.addEventListener('pointermove', (e) => { if (dragging) seek(e); });
    tl.addEventListener('pointerup', (e) => {
      dragging = false;
      try { tl.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    tl.addEventListener('pointercancel', () => { dragging = false; });

    this.el.playBtn.addEventListener('click', () => app.setPlaying(!app.playing));
    this.el.speedBtn.addEventListener('click', () => app.cycleSpeed());
    this.el.popBtn.addEventListener('click', () => app.cyclePopulation());

    // --- paddock stamina ---
    const sl = this.el.padStam;
    const onStam = () => {
      const v = Number(sl.value);
      app.setPaddockStamina(v);
      this.el.padStamVal.textContent = v.toFixed(2);
    };
    sl.addEventListener('input', onStam);
    this.el.padZoom.addEventListener('click', () => app.focusPaddock());

    // --- view toggles ---
    for (const [key, el] of [['warn', this.el.warnToggle], ['link', this.el.linkToggle], ['press', this.el.pressToggle]]) {
      el.addEventListener('click', () => {
        app.toggles[key] = !app.toggles[key];
        el.classList.toggle('on', app.toggles[key]);
        el.setAttribute('aria-pressed', String(app.toggles[key]));
      });
    }
    this.el.padToggle.addEventListener('click', () => {
      app.toggles.padHud = !app.toggles.padHud;
      this.el.padToggle.classList.toggle('on', app.toggles.padHud);
      document.body.classList.toggle('hide-pad', !app.toggles.padHud);
    });

    for (const b of this.el.stages) {
      b.addEventListener('click', () => {
        const t = Number(b.dataset.seasonJump);
        app.flyTimeline(t);
      });
    }

    // keyboard
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      switch (e.key) {
        case ' ': e.preventDefault(); app.setPlaying(!app.playing); break;
        case 'w': case 'W': this.el.warnToggle.click(); break;
        case 'l': case 'L': this.el.linkToggle.click(); break;
        case 'p': case 'P': this.el.pressToggle.click(); break;
        case 'f': case 'F': app.fitAll(); break;
        case 'c': case 'C': app.focusPaddock(); break;
        case '1': app.setTimeline(0.03); break;
        case '2': app.setTimeline(0.97); break;
        case 'ArrowRight': app.nudgeTimeline(0.03); break;
        case 'ArrowLeft': app.nudgeTimeline(-0.03); break;
      }
    });
  }

  setTimeline(t) {
    this.el.timelineFill.style.width = `${(t * 100).toFixed(2)}%`;
    this.el.timelineHead.style.left = `${(t * 100).toFixed(2)}%`;
    this.el.timeline.setAttribute('aria-valuenow', t.toFixed(3));
    const { name, sub } = seasonName(t);
    this.el.seasonLabel.textContent = name;
    this.el.seasonSub.textContent = sub;
  }

  setPlaying(on) {
    this.el.playBtn.classList.toggle('playing', on);
    this.el.playBtn.textContent = on ? '❚❚' : '▶';
    this.el.playBtn.setAttribute('aria-label', on ? '暂停' : '播放');
  }

  setSpeed(mult) {
    this.el.speedBtn.textContent = `${mult.toFixed(1)}×`;
  }

  setPopulation(n) {
    this.el.popLabel.textContent = `${n}`;
  }

  update(stats, paddock, fps, extra) {
    this.el.statStam.textContent = stats.meanStam.toFixed(2);
    this.el.statR.textContent = `${Math.round(stats.meanR)}`;
    this.el.statNN.textContent = stats.meanNN.toFixed(1);
    this.el.statDepth.textContent = stats.maxDepth;
    this.el.statFiles.textContent = stats.files;
    this.el.statSw.textContent = stats.switches;
    this.el.statPress.textContent = (stats.meanPressure ?? 0).toFixed(2);
    this.el.statFps.textContent = `${fps.toFixed(0)}`;

    // paddock readout
    const p = paddock;
    this.el.padMeta.textContent =
      `${p.count} 只 · 接触压力 ${p.pressure.toFixed(2)} · 当前踩踏 ${p.stampeding}`;
    const flips = p.stampeding > 0;
    this.el.padState.textContent = flips ? '踩踏散开' : '正在聚拢';
    this.el.padState.className = flips ? 'state flip' : 'state calm';
    const frac = Math.max(0, Math.min(1, p.pressure / 1.6));
    this.el.padBar.style.width = `${(frac * 100).toFixed(1)}%`;
    this.el.padBar.classList.toggle('hot', flips);
    const flipPos = Math.max(0, Math.min(1, p.tolerance / 1.6));
    this.el.padFlipMark.style.left = `${(flipPos * 100).toFixed(1)}%`;
    this.el.padFlip.textContent = p.tolerance.toFixed(2);
  }

  toast(msg, ms = 2600) {
    const t = this.el.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => t.classList.remove('show'), ms);
  }

  drawInset(herd, world) {
    const c = this.el.inset;
    if (!c) return;
    const g = c.getContext('2d');
    const W = c.width, H = c.height;
    g.clearRect(0, 0, W, H);
    const sx = W / world.w, sy = H / world.h;
    // water
    for (let p = 0; p < world.pools.length; p++) {
      const r = world.poolR[p];
      if (r <= 1) continue;
      g.fillStyle = 'rgba(80,140,150,0.55)';
      g.beginPath();
      g.arc(world.pools[p].x * sx, world.pools[p].y * sy, r * sx, 0, Math.PI * 2);
      g.fill();
    }
    // herd
    for (let i = 0; i < herd.n; i++) {
      if (herd.paddock[i]) continue;
      const st = herd.state[i];
      g.fillStyle = st === ST_STAMP ? 'rgba(255,106,85,0.9)'
        : (st === ST_ALERT ? 'rgba(255,180,90,0.85)' : 'rgba(240,226,180,0.62)');
      g.fillRect(herd.x[i] * sx - 0.7, herd.y[i] * sy - 0.7, 1.4, 1.4);
    }
    // paddock marker
    g.strokeStyle = 'rgba(255,210,120,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(3520 * sx, 2360 * sy, 12, 0, Math.PI * 2);
    g.stroke();
    // viewport rect
    const app = this.app;
    const cam = app.cam;
    const v = cam.visible(0);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineWidth = 1;
    g.strokeRect(v.x0 * sx, v.y0 * sy, (v.x1 - v.x0) * sx, (v.y1 - v.y0) * sy);
  }
}

const ST_STAMP = 4, ST_ALERT = 2;

export function seasonName(t) {
  if (t < 0.14) return { name: '雨季', sub: '水草丰茂 · 兽群散在其各自的草场' };
  if (t < 0.36) return { name: '雨季末', sub: '雨渐少 · 队伍开始朝水塘收拢' };
  if (t < 0.58) return { name: '旱季初', sub: '草色转黄 · 警戒圈开始缩小' };
  if (t < 0.80) return { name: '旱季', sub: '只剩主水塘 · 群兽排成纵队' };
  return { name: '大旱', sub: '水塘见底 · 一路纵队挤向水面' };
}
