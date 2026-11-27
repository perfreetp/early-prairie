/* ============================================================
 * 自动喂食器 · 可拆解剖面仿真
 * PixiJS 7 + pixi-viewport；颗粒碰撞仅做 圆-线段 检测
 * ============================================================ */
/* 全局 PIXI / pixi_viewport 由 <script> 注入（Pixi v6 + pixi-viewport v4 UMD） */
const Viewport = PIXI.Viewport || (window.pixi_viewport && window.pixi_viewport.Viewport);
const DEG = Math.PI / 180;

/* Pixi v6 兼容封装（v6 无链式 .fill()/.stroke()，用 beginFill/lineStyle 表达） */
function fill(g, opt) { g.beginFill(opt.color, opt.alpha ?? 1); return g; }
function stroke(g, opt) {
  g.lineStyle(opt.width, opt.color, opt.alpha ?? 1, opt.alignment ?? 0.5, opt.native ?? false);
  return g;
}

/* ---------------- 几何（单位 px，按 1px = 1mm 解读） ---------------- */
const G = {
  D: 8, r: 4,                       // 颗粒直径 / 半径
  // 料斗（梯形斗）
  hopTL: { x: 250, y: 70 }, hopTR: { x: 650, y: 70 },
  neckL: { x: 430, y: 310 }, neckR: { x: 520, y: 310 },
  // 绞龙管
  tubeL: 300, tubeR: 820, tubeTop: 310, tubeBot: 420,
  // 闸门（闸刀式薄插板）：厚度 14px，位于颈口右缘 x=520；板顶穿过管顶伸到 y=236，
  // 管内部分是一道从管顶 310 到板底的竖直墙，没有水平搁板。
  // 颈口 430~520 的来料全部落在插板左侧，右侧管顶 520~820 为实心，无旁路；
  // 颗粒唯一通路 = 板底 yb 与管底之间的开度缝（g<D 时卡粒）。
  gateCX: 520, gateHalf: 7, gateTopY: 236,
  // 绞龙
  augY: 365, augL: 318, augR: 792, lead: 26, flightR: 44, spokeGap: 13,
  // 出粮斜槽 + 接粮碗
  chuteA: { x: 795, y: 420 }, chuteB: { x: 880, y: 470 },
  rimL: { x: 880, y: 470 }, rimR: { x: 1030, y: 470 },
  bowlBL: { x: 800, y: 560 }, bowlBR: { x: 1000, y: 560 },
};

/* ---------------- 标定关系（唯一数据源，物理/HUD 同源） ---------------- */
const S_MIN = 1, S_MAX = 10;
const GAP_MAX = 50, GAP_MIN = 4;                       // px，s=10 / s=1
/** 闸门开度 g(s)：线性，s 越大开度越大（s=1→4px，s=10→50px） */
function gapOf(s) {
  return GAP_MIN + (GAP_MAX - GAP_MIN) * (s - 1) / (S_MAX - 1); // 斜率 +4.667
}
/** 绞龙转速 ω(s)：60 → 600 °/s 线性 */
function omegaDegOf(s) { return 60 + 60 * (s - 1); }
/** 螺旋运动学：轴向输送速度 v = ω·L/(2π)（px/s） */
function feedSpeedOf(s) { return omegaDegOf(s) / 360 * G.lead; }
/** 堵塞边界解析解：g(s*) = D（开度小于颗粒直径即卡粒） */
const S_CRIT = 1 + (G.D - GAP_MIN) / ((GAP_MAX - GAP_MIN) / (S_MAX - 1)); // ≈ 1.783

/* ---------------- Pixi 基础 ---------------- */
const host = document.getElementById('pixi-host');
const app = new PIXI.Application({
  resizeTo: host, antialias: true,
  backgroundColor: 0xf1f5f9, resolution: window.devicePixelRatio || 1, autoDensity: true,
});
host.appendChild(app.view);

// Pixi v6 + pixi-viewport v4：不传 events，viewport 内部使用 renderer.plugins.interaction
const vp = new Viewport({
  screenWidth: app.renderer.width / app.renderer.resolution,
  screenHeight: app.renderer.height / app.renderer.resolution,
  worldWidth: 1220, worldHeight: 680,
});
vp.drag({ direction: 'all' }).wheel({ center: 1, percent: 12, smooth: 5 })
  .pinch().decelerate().clamp({ direction: 'all' });
vp.setZoom(1.05, true);
app.stage.addChild(vp);

const gGrid = new PIXI.Graphics();
const gStatic = new PIXI.Graphics();
const gAuger = new PIXI.Graphics();
const gGate = new PIXI.Graphics();
const gPart = new PIXI.Graphics();
const gLabel = new PIXI.Graphics();
const shellL = new PIXI.Container();
const shellR = new PIXI.Container();
const gGateHit = new PIXI.Graphics();
vp.addChild(gGrid, gStatic, gAuger, gPart, gGate, gLabel, shellL, shellR, gGateHit);

/* 旋钮放在屏幕空间（viewport 之外），不参与缩放平移 */
const uiLayer = new PIXI.Container();
app.stage.addChild(uiLayer);
const gKnob = new PIXI.Graphics();
uiLayer.addChild(gKnob);
let knobC = { x: 0, y: 0 };

/* ---------------- 仿真状态 ---------------- */
let setting = 8;                 // 旋钮档位（拖动时可为小数，松手吸合整数）
let gateGap = gapOf(setting);    // 实际闸门开度
let gateDragging = false;
let augDeg = 0;                  // 绞龙累计转角
let paused = false;
let particles = [];
let flowEvents = [];             // 最近出粮时间戳（秒）
let simT = 0;
let settleMode = false;          // 静置模式：绞龙冻结，仅重力沉降
const FIXED = 1 / 120;
let acc = 0;

/* ============================================================
 * 静态墙体：全部用线段表达（圆-线段碰撞）
 * ============================================================ */
function wallSegments() {
  const T = G.tubeTop, B = G.tubeBot;
  const segs = [
    // 料斗左右斜壁
    [G.hopTL.x, G.hopTL.y, G.neckL.x, G.neckL.y],
    [G.hopTR.x, G.hopTR.y, G.neckR.x, G.neckR.y],
    // 绞龙管：顶板（颈部 430~520 留口；527 起为实顶，520~527 被闸板占据）、底板、左端盖
    [G.tubeL, T, G.neckL.x, T],
    [G.gateCX + G.gateHalf, T, G.tubeR, T],
    [G.tubeL, B, 795, B],
    [G.tubeL, T, G.tubeL, B],
    // 右端挡檐（上半截，下方为出粮口）
    [G.tubeR, T, G.tubeR, 350],
    // 出粮斜槽
    [G.chuteA.x, G.chuteA.y, G.chuteB.x, G.chuteB.y],
    // 接粮碗 U 形
    [G.rimL.x, G.rimL.y, G.bowlBL.x, G.bowlBL.y],
    [G.bowlBL.x, G.bowlBL.y, G.bowlBR.x, G.bowlBR.y],
    [G.bowlBR.x, G.bowlBR.y, G.rimR.x, G.rimR.y],
  ];
  return segs;
}
const WALLS = wallSegments();

/** 闸门线段（随开度每步重建）：插板底边高度 = 管底 - 开度 */
function gateSegments(gap) {
  const x1 = G.gateCX - G.gateHalf, x2 = G.gateCX + G.gateHalf;
  const yb = G.tubeBot - gap;
  return {
    yb,
    segs: [
      [x1, G.gateTopY, x1, yb],
      [x2, G.gateTopY, x2, yb],
      [x1, G.gateTopY, x2, G.gateTopY],
      [x1, yb, x2, yb],                 // 底缘：卡住粮粒的关键线段
    ],
  };
}

/* ============================================================
 * 绞龙：交替辐条螺旋（侧视），碰撞点带转动线速度 + 轴向输送速度
 * ============================================================ */
const spokes = [];
for (let x = G.augL + 8; x <= G.augR - 8; x += G.spokeGap) spokes.push(x);

function flightSegments(deg) {
  const th = deg * DEG;
  return spokes.map((x, k) => {
    const a = th + k * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    return {
      x1: x + G.flightR * c, y1: G.augY + G.flightR * s,
      x2: x - G.flightR * c, y2: G.augY - G.flightR * s,
      cx: x, cy: G.augY,
    };
  });
}

/* ============================================================
 * 圆-线段碰撞（唯一碰撞原语；颗粒-颗粒等价为 圆 vs 退化线段）
 * ============================================================ */
function circleSeg(p, ax, ay, bx, by, rest, fric, pvxFn, pvyFn) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - ax) * dx + (p.y - ay) * dy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx, qy = ay + t * dy;
  let nx = p.x - qx, ny = p.y - qy;
  let d = Math.hypot(nx, ny);
  if (d >= G.r) return;
  if (d < 1e-6) { const l = Math.hypot(dx, dy) || 1; nx = -dy / l; ny = dx / l; d = 0; }
  else { nx /= d; ny /= d; }
  const pvx = pvxFn ? pvxFn(qx, qy) : 0;
  const pvy = pvyFn ? pvyFn(qx, qy) : 0;
  // 法向冲量
  const rvn = (p.vx - pvx) * nx + (p.vy - pvy) * ny;
  if (rvn < 0) { const j = -(1 + rest) * rvn; p.vx += j * nx; p.vy += j * ny; }
  // 切向摩擦
  const tx = -ny, ty = nx;
  const vt = (p.vx - pvx) * tx + (p.vy - pvy) * ty;
  p.vx -= fric * vt * tx; p.vy -= fric * vt * ty;
  // 位置修正
  const pen = G.r - d;
  p.x += nx * pen; p.y += ny * pen;
}

/** 颗粒-颗粒：等质量圆碰撞（数学等价于圆-线段，线段退化为点） */
function pairCollide(a, b) {
  let nx = b.x - a.x, ny = b.y - a.y;
  let d = Math.hypot(nx, ny);
  if (d >= G.D || d < 1e-6) return;
  nx /= d; ny /= d;
  const rvn = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (rvn < 0) {
    const j = -(1 + 0.12) * rvn / 2;
    a.vx += j * nx; a.vy += j * ny;
    b.vx -= j * nx; b.vy -= j * ny;
  }
  const tx = -ny, ty = nx;
  const vt = (a.vx - b.vx) * tx + (a.vy - b.vy) * ty;
  a.vx -= 0.5 * vt * tx; a.vy -= 0.5 * vt * ty;
  b.vx += 0.5 * vt * tx; b.vy += 0.5 * vt * ty;
  const pen = (G.D - d) / 2;
  a.x -= nx * pen; a.y -= ny * pen;
  b.x += nx * pen; b.y += ny * pen;
}

/* ---------------- 空间哈希（仅用于颗粒配对） ---------------- */
const CELL = G.D + 6;
const hash = new Map();
function hkey(cx, cy) { return cx * 100000 + cy; }
function rebuildHash() {
  hash.clear();
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const k = hkey(Math.floor(p.x / CELL), Math.floor(p.y / CELL));
    let arr = hash.get(k);
    if (!arr) { arr = []; hash.set(k, arr); }
    arr.push(i);
  }
}

/* ============================================================
 * 颗粒初始化：预置“粮斗快满”布局
 * ============================================================ */
function insideHopper(x, y, margin) {
  if (y < G.hopTL.y + margin || y > G.neckL.y - margin) return false;
  const f = (y - G.hopTL.y) / (G.neckL.y - G.hopTL.y);
  const xl = G.hopTL.x + (G.neckL.x - G.hopTL.x) * f + margin;
  const xr = G.hopTR.x + (G.neckR.x - G.hopTR.x) * f - margin;
  return x > xl && x < xr;
}
function makeParticle(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    shade: 0.85 + Math.random() * 0.3,
    flowed: false,
  };
}
function fillHopper() {
  particles.length = 0;
  const sp = 12;
  for (let y = G.hopTL.y + 14; y <= G.neckL.y - 12; y += sp) {
    const f = (y - G.hopTL.y) / (G.neckL.y - G.hopTL.y);
    const xl = G.hopTL.x + (G.neckL.x - G.hopTL.x) * f + 8;
    const xr = G.hopTR.x + (G.neckR.x - G.hopTR.x) * f - 8;
    for (let x = xl; x <= xr; x += sp) {
      const jx = x + (Math.random() - 0.5) * 5;
      const jy = y + (Math.random() - 0.5) * 5;
      if (insideHopper(jx, jy, G.r + 1)) particles.push(makeParticle(jx, jy));
    }
  }
}

/* ---------------- 物理步进（2 子步防高速隧穿） ---------------- */
const SUB = 2;
function physicsStep(dt) {
  simT += dt;
  const h = dt / SUB;
  for (let sub = 0; sub < SUB; sub++) physicsSub(h);
}
function physicsSub(dt) {
  const omegaDeg = settleMode ? 0 : omegaDegOf(setting);
  const omegaRad = omegaDeg * DEG;
  const vFeed = settleMode ? 0 : feedSpeedOf(setting);   // 严格由螺旋运动学给出
  if (!paused) augDeg = (augDeg + omegaDeg * dt) % 360;

  const gt = gateSegments(gateGap);
  const flights = flightSegments(augDeg);
  const pileH = pileHeight();   // 每步只算一次，供堆积阻尼使用
  const VMAX = 320;             // 速度封顶：单步位移 < 2.7px，杜绝穿透 8px 颗粒并抑制颈部抛射

  for (const p of particles) {
    if (!paused) {
      p.vy += 900 * dt;                               // 重力
      p.vx *= 0.992; p.vy *= 0.992;                   // 轻微空气阻尼
      const sp = Math.hypot(p.vx, p.vy);
      if (sp > VMAX) { p.vx *= VMAX / sp; p.vy *= VMAX / sp; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      // 世界边界钳制（数值兜底；底部不钳制——碗壁本身兜底，避免把颗粒钉在非法位置）
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y < -200) {
        p.x = G.augL + 20; p.y = G.tubeBot - 12; p.vx = 0; p.vy = 0;   // 数值异常回收
      }
      // 颈部单向阀：颗粒可自由下落（vy>0）穿过颈部进入管内；被辐条上抛（vy<0）时压回管顶，
      // 从源头杜绝颗粒经颈部抛飞回料斗/机外（等效止回阀，不影响正常下料）
      const inNeckX = p.x > G.neckL.x && p.x < G.neckR.x;
      if (inNeckX && p.vy < 0 && p.y < G.tubeTop + G.r) {
        p.y = G.tubeTop + G.r; p.vy = Math.max(0, p.vy);
      }
      // 管段硬钳制：实墙区域限制颗粒在管内（左管顶 300~430、右管顶 527~816）；
      // 颈部开口 430~527 上方是料斗，不钳制，颗粒可在斗与管间自由流动
      const inLeftWall = p.x > G.tubeL + G.r && p.x < G.neckL.x - G.r;
      const inRightWall = p.x > G.gateCX + G.gateHalf + G.r && p.x < G.tubeR - G.r;
      if (inLeftWall || inRightWall) {
        const yTop = G.tubeTop + G.r, yBot = G.tubeBot - G.r;
        if (p.y < yTop) { p.y = yTop; p.vy = Math.abs(p.vy) * 0.15; }
        if (p.y > yBot) { p.y = yBot; p.vy = -Math.abs(p.vy) * 0.15; }
      }
      // 机器内腔顶盖：颗粒被辐条抛起时由机壳挡回，不飞出机器
      if (p.x > 240 && p.x < 830 && p.y < 58) {
        p.y = 58; p.vy = Math.abs(p.vy) * 0.2;
      }
      if (p.x < 20) { p.x = 20; p.vx = Math.abs(p.vx); }
      if (p.x > 1080) { p.x = 1080; p.vx = -Math.abs(p.vx); }
      if (p.y < 20) { p.y = 20; p.vy = Math.abs(p.vy); }
    }
  }

  if (!paused) {
    // 墙体（圆-线段）
    for (const p of particles) {
      for (const w of WALLS) {
        circleSeg(p, w[0], w[1], w[2], w[3], 0.08, 0.85);
      }
      // 闸门（圆-线段），低摩擦便于绞龙辐条破拱
      for (const w of gt.segs) {
        circleSeg(p, w[0], w[1], w[2], w[3], 0.05, 0.55);
      }
      // 绞龙辐条（运动线段：转动线速度 + 轴向输送速度，见 collideFlight）
      for (const f of flights) {
        if (Math.abs(p.x - f.cx) > G.flightR + G.r) continue;
        collideFlight(p, f, omegaRad, vFeed);
      }
      // 堆积高度影响下落速度：碗区上方按料堆高度施加阻尼
      if (p.x > 795 && p.x < 1035 && p.y > 300) {
        const k = Math.exp(-3.2 * (pileH / 90) * dt * 10);
        p.vx *= 1 - (1 - k) * 0.9;
        p.vy *= 1 - (1 - k) * 0.9;
      }
    }
    // 颗粒-颗粒
    rebuildHash();
    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      const cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const arr = hash.get(hkey(gx, gy));
          if (!arr) continue;
          for (const j of arr) if (j > i) pairCollide(a, particles[j]);
        }
      }
    }
    // 硬性几何闸门（最终裁决，在所有碰撞之后）：开度 < 颗粒直径时，开度缝物理上无法过粒，
    // 闸门面在管高内刚性封闭——左侧颗粒一律挡在 gateCX 左缘，杜绝软接触重叠挤穿。
    // 这保证 g(s)<D ⇔ 堵塞 的对应关系严格成立；g≥D 时不启用，颗粒正常通过。
    if (gateGap < G.D) {
      for (const p of particles) {
        if (p.y > G.tubeTop - G.r && p.y < G.tubeBot + G.r && p.x > G.gateCX - G.r) {
          p.x = G.gateCX - G.r;
          if (p.vx > 0) p.vx = 0;
        }
      }
    }
    // 出粮传感器：穿过出口截面 x=800 且位于管底/斜槽高度带（排除顶部抛飞颗粒）
    for (const p of particles) {
      if (!p.flowed && p.x > 800 && p.y > G.tubeTop + 40 && p.y < G.tubeBot + 60) {
        p.flowed = true; flowEvents.push(simT);
      }
    }
    flowEvents = flowEvents.filter((t) => simT - t < 3);
  }
}

/** 绞龙辐条精确接触：点速度 v = ω×r + 轴向 vFeed */
function collideFlight(p, f, omegaRad, vFeed) {
  const dx = f.x2 - f.x1, dy = f.y2 - f.y1;
  const L2 = dx * dx + dy * dy || 1e-9;
  let t = ((p.x - f.x1) * dx + (p.y - f.y1) * dy) / L2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = f.x1 + t * dx, qy = f.y1 + t * dy;
  let nx = p.x - qx, ny = p.y - qy;
  const d = Math.hypot(nx, ny);
  if (d >= G.r || d < 1e-6) return;
  nx /= d; ny /= d;
  // 辐条上 q 点的速度：绕 (cx,cy) 转动 + 轴向输送
  const pvx = -omegaRad * (qy - f.cy) + vFeed;
  const pvy = omegaRad * (qx - f.cx);
  const rvn = (p.vx - pvx) * nx + (p.vy - pvy) * ny;
  if (rvn < 0) {
    const j = -(1 + 0.04) * rvn;
    p.vx += j * nx; p.vy += j * ny;
  }
  const tx = -ny, ty = nx;
  const vt = (p.vx - pvx) * tx + (p.vy - pvy) * ty;
  p.vx -= 0.25 * vt * tx; p.vy -= 0.25 * vt * ty;
  p.x += nx * (G.r - d); p.y += ny * (G.r - d);
}

/* 碗内堆积高度（取碗中央柱内最高颗粒） */
let _pileCache = 0;
function pileHeight() {
  let topY = G.bowlBL.y;
  for (const p of particles) {
    if (p.x > 860 && p.x < 970 && p.y > G.rimL.y - 30 && p.y < G.bowlBL.y) {
      if (p.y < topY) topY = p.y;
    }
  }
  _pileCache = G.bowlBL.y - topY;
  return Math.max(0, Math.min(90, _pileCache));
}

/* ============================================================
 * 渲染
 * ============================================================ */
function drawGrid() {
  gGrid.clear();
  stroke(gGrid, { width: 1, color: 0xe2e8f0 });
  for (let x = 0; x <= 1220; x += 40) {
    gGrid.moveTo(x, 0).lineTo(x, 680);
  }
  for (let y = 0; y <= 680; y += 40) {
    gGrid.moveTo(0, y).lineTo(1220, y);
  }
}

function drawStatic() {
  const s = gStatic;
  s.clear();
  stroke(s, { width: 5, color: 0x475569 });
  // 料斗与绞龙管主体（剖面壁：深灰金属 + 剖面线）
  s.moveTo(G.hopTL.x, G.hopTL.y).lineTo(G.neckL.x, G.neckL.y)
   .lineTo(G.tubeL, G.tubeTop).lineTo(G.tubeL, G.tubeBot)
   .lineTo(795, G.tubeBot);
  s.moveTo(G.hopTR.x, G.hopTR.y).lineTo(G.neckR.x, G.neckR.y)
   .lineTo(G.tubeR, G.tubeTop).lineTo(G.tubeR, 350);

  // 底板、顶板（527 起为实顶，520~527 被闸板占据）
  s.moveTo(G.tubeL, G.tubeBot).lineTo(795, G.tubeBot)
   .moveTo(G.tubeL, G.tubeTop).lineTo(G.neckL.x, G.tubeTop)
   .moveTo(G.gateCX + G.gateHalf, G.tubeTop).lineTo(G.tubeR, G.tubeTop);

  // 斜槽 + 接粮碗
  s.moveTo(G.chuteA.x, G.chuteA.y).lineTo(G.chuteB.x, G.chuteB.y)
   .lineTo(G.bowlBL.x, G.bowlBL.y).lineTo(G.bowlBR.x, G.bowlBR.y)
   .lineTo(G.rimR.x, G.rimR.y);

  // 闸门导轨（固定机架部分）：先描边后填充
  stroke(s, { width: 2, color: 0x475569 });
  fill(s, { color: 0x94a3b8 });
  s.drawRoundedRect(G.gateCX - 16, G.gateTopY - 14, 32, 20, 4);
  s.endFill();

  // 剖面斜线（剖面视图标识）
  hatch(s, G.hopTL.x, G.hopTL.y, G.neckL.x, G.neckL.y);
  hatch(s, G.hopTR.x, G.hopTR.y, G.neckR.x, G.neckR.y);
}
function hatch(s, ax, ay, bx, by) {
  const nx = -(by - ay), ny = bx - ax;
  const l = Math.hypot(nx, ny);
  stroke(s, { width: 1.5, color: 0x94a3b8 });
  for (let t = 0.08; t < 0.95; t += 0.14) {
    const px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
    s.moveTo(px, py).lineTo(px + (nx / l) * 9, py + (ny / l) * 9);
  }
}

function drawAuger() {
  const s = gAuger;
  s.clear();
  const flights = flightSegments(augDeg);
  // 中心轴
  stroke(s, { width: 7, color: 0x334155 });
  s.moveTo(G.augL - 4, G.augY).lineTo(G.augR + 4, G.augY);
  // 螺旋叶片（交替辐条形成侧视螺旋）
  stroke(s, { width: 3.5, color: 0x1d4ed8 });
  for (const f of flights) {
    s.moveTo(f.x1, f.y1).lineTo(f.x2, f.y2);
  }
  // 轴端轴承
  fill(s, { color: 0x64748b });
  s.drawCircle(G.augL - 6, G.augY, 9).drawCircle(G.augR + 6, G.augY, 9);
  s.endFill();
}

function drawGate() {
  const s = gGate;
  s.clear();
  const yb = G.tubeBot - gateGap;
  const x1 = G.gateCX - G.gateHalf, x2 = G.gateCX + G.gateHalf;
  // 插板主体（先描边再填充）
  stroke(s, { width: 2, color: 0x7f1d1d });
  fill(s, { color: gateDragging ? 0xf87171 : 0xdc2626 });
  s.drawRoundedRect(x1, G.gateTopY, x2 - x1, yb - G.gateTopY, 3);
  s.endFill();
  // 开度刻度线
  stroke(s, { width: 1.5, color: 0x7f1d1d });
  for (let g = 10; g <= 50; g += 10) {
    const y = G.tubeBot - g;
    if (y < G.gateTopY + 6) continue;
    s.moveTo(x2 + 3, y).lineTo(x2 + 9, y);
  }
}

function drawParticles() {
  const s = gPart;
  s.clear();
  for (const p of particles) {
    s.lineStyle(0.6, 0x92400e, 1);
    s.beginFill(shadeColor(p.shade), 1);
    s.drawCircle(p.x, p.y, G.r);
    s.endFill();
  }
}
function shadeColor(k) {
  const base = [217, 145, 40];
  return ((Math.round(base[0] * k) << 16) | (Math.round(base[1] * k) << 8) | Math.round(base[2] * k));
}

/* ---------------- 世界文字标注 ---------------- */
function addLabel(text, x, y, anchor = 0.5) {
  const t = new PIXI.Text(text, {
    fontFamily: 'Microsoft YaHei, Segoe UI, sans-serif',
    fontSize: 15, fill: 0x0f172a, fontWeight: '700',
  });
  t.anchor.set(anchor, anchor);
  t.position.set(x, y);
  gLabel.addChild(t);
  return t;
}
function drawLabels() {
  gLabel.clear();
  addLabel('料斗（快满预置）', 450, 46);
  addLabel('绞龙（转速随旋钮）', 560, 288);
  addLabel('闸门', G.gateCX + 14, G.gateTopY - 8, 0);
  addLabel('出粮口', 868, 446);
  // 引线
  stroke(gLabel, { width: 1.5, color: 0xdc2626 });
  gLabel.moveTo(G.gateCX + 12, G.gateTopY - 10).lineTo(G.gateCX + 4, G.gateTopY + 24);
}

/* ============================================================
 * 可拆解外壳：左右两半半透明罩壳，拖动拉开，双击合盖
 * ============================================================ */
function buildShell(container, x, y, w, h, title) {
  container.removeChildren();
  container.position.set(x, y);
  const panel = new PIXI.Graphics();
  stroke(panel, { width: 3, color: 0x0284c7, alpha: 0.85 });
  fill(panel, { color: 0x7dd3fc, alpha: 0.22 });
  panel.drawRoundedRect(0, 0, w, h, 14);
  panel.endFill();
  // 剖面切割边（锯齿示意）
  stroke(panel, { width: 2, color: 0x0284c7, alpha: 0.7 });
  for (let yy = 20; yy < h - 10; yy += 22) {
    panel.moveTo(w - 6, yy).lineTo(w, yy + 11).lineTo(w - 6, yy + 22);
  }
  container.addChild(panel);
  const t = new PIXI.Text(title, {
    fontFamily: 'Microsoft YaHei, Segoe UI, sans-serif',
    fontSize: 14, fill: 0x075985, fontWeight: '700',
  });
  t.anchor.set(0.5, 0); t.position.set(w / 2, 10);
  container.addChild(t);
  // 抓手（唯一可交互区域，避免挡住闸门点击）
  const grip = new PIXI.Graphics();
  stroke(grip, { width: 2, color: 0x0c4a6e });
  fill(grip, { color: 0x0284c7 });
  grip.drawRoundedRect(w / 2 - 26, h - 34, 52, 22, 8);
  grip.endFill();
  const gt = new PIXI.Text('拖动', { fontSize: 12, fill: 0xffffff, fontWeight: '700',
    fontFamily: 'Microsoft YaHei, sans-serif' });
  gt.anchor.set(0.5);
  gt.position.set(w / 2, h - 23);
  grip.addChild(gt);
  grip.interactive = true; grip.cursor = 'grab';
  container.addChild(grip);

  let baseX = 0, grabX = 0;
  grip.on('pointerdown', (e) => {
    e.stopPropagation();
    vp.plugins.pause('drag');
    grip.cursor = 'grabbing';
    const w0 = vp.toWorld(e.global);
    baseX = container.position.x; grabX = w0.x;
    const move = (ev) => {
      const w1 = vp.toWorld(ev.global);
      container.position.x = baseX + (w1.x - grabX);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      grip.cursor = 'grab';
      vp.plugins.resume('drag');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  grip.on('pointerdblclick', (e) => {
    e.stopPropagation();
    animateShell(container, x);
  });
}
function animateShell(container, targetX) {
  const tick = () => {
    container.position.x += (targetX - container.position.x) * 0.18;
    if (Math.abs(targetX - container.position.x) > 0.5) requestAnimationFrame(tick);
    else container.position.x = targetX;
  };
  tick();
}

/* ============================================================
 * 闸门交互：点中可单独拖动，松手按当前档位弹回
 * ============================================================ */
function buildGateHit() {
  const h = gGateHit;
  h.clear();
  fill(h, { color: 0xffffff, alpha: 0.015 });
  h.drawRect(G.gateCX - 22, G.gateTopY - 18, 44, G.tubeBot - G.gateTopY + 24);
  h.endFill();
  h.interactive = true; h.cursor = 'pointer';
  h.on('pointerdown', (e) => {
    e.stopPropagation();
    gateDragging = true;
    vp.plugins.pause('drag');
    const move = (ev) => {
      const rect = app.view.getBoundingClientRect();
      const w = vp.toWorld({ x: ev.clientX - rect.left, y: ev.clientY - rect.top });
      gateGap = Math.max(2, Math.min(GAP_MAX + 12, G.tubeBot - w.y));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      gateDragging = false;
      vp.plugins.resume('drag');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

/* ============================================================
 * 屏幕空间旋钮：拖动 / 滚轮调档，松手吸合整数档
 * 角度区间 -135° ~ +135° 映射 s=1 ~ 10
 * ============================================================ */
const KNOB_R = 58;
function knobAngleOf(s) { return -135 + ((s - S_MIN) / (S_MAX - S_MIN)) * 270; }
function settingOfAngle(deg) {
  const c = Math.max(-135, Math.min(135, deg));
  return S_MIN + ((c + 135) / 270) * (S_MAX - S_MIN);
}
function drawKnob() {
  const g = gKnob;
  g.clear();
  const { x: cx, y: cy } = knobC;
  const a0 = -135 * DEG, a1 = 135 * DEG;
  // 底盘圆（先边后填充）
  stroke(g, { width: 2, color: 0xcbd5e1 });
  fill(g, { color: 0xffffff, alpha: 0.95 });
  g.drawCircle(cx, cy, KNOB_R + 16);
  g.endFill();
  // 弧槽（灰底 + 堵塞区红弧）
  stroke(g, { width: 8, color: 0xcbd5e1 });
  g.arc(cx, cy, KNOB_R + 4, a0, a1);
  const aCrit = knobAngleOf(S_CRIT) * DEG;
  stroke(g, { width: 8, color: 0xef4444 });
  g.arc(cx, cy, KNOB_R + 4, a0, aCrit);
  // 刻度
  for (let s = 1; s <= 10; s++) {
    const a = knobAngleOf(s) * DEG;
    const r1 = KNOB_R + 12, r2 = KNOB_R + (s === Math.round(setting) ? 20 : 17);
    stroke(g, { width: s <= S_CRIT ? 2.5 : 1.5, color: s <= S_CRIT ? 0xef4444 : 0x64748b });
    g.moveTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a))
     .lineTo(cx + r2 * Math.cos(a), cy + r2 * Math.sin(a));
  }
  // 旋钮本体
  const ka = knobAngleOf(setting) * DEG;
  stroke(g, { width: 4, color: 0x475569 });
  fill(g, { color: 0x1e293b });
  g.drawCircle(cx, cy, KNOB_R - 6);
  g.endFill();
  fill(g, { color: 0x94a3b8 });
  g.drawCircle(cx, cy, 10);
  g.endFill();
  // 指针
  stroke(g, { width: 5, color: 0xfbbf24 });
  g.moveTo(cx, cy).lineTo(cx + (KNOB_R - 16) * Math.cos(ka), cy + (KNOB_R - 16) * Math.sin(ka));
  // 档位数字（独立 Text 对象，避免 clear 后残留）
  knobValText.text = gateDragging || knobDrag ? setting.toFixed(1) : String(Math.round(setting));
  knobValText.position.set(cx, cy + 22);
}
const knobValText = new PIXI.Text('', {
  fontFamily: 'Segoe UI, sans-serif', fontSize: 22, fill: 0xffffff, fontWeight: 800,
});
knobValText.anchor.set(0.5);
uiLayer.addChild(knobValText);

let knobDrag = false;
function buildKnob() {
  gKnob.interactive = true; gKnob.cursor = 'grab';
  gKnob.hitArea = new PIXI.Rectangle(
    knobC.x - KNOB_R - 20, knobC.y - KNOB_R - 20, (KNOB_R + 20) * 2, (KNOB_R + 20) * 2);
  gKnob.on('pointerdown', (e) => {
    e.stopPropagation();
    knobDrag = true;
    const move = (ev) => {
      const rect = app.view.getBoundingClientRect();
      const dx = ev.clientX - rect.left - knobC.x;
      const dy = ev.clientY - rect.top - knobC.y;
      let deg = Math.atan2(dy, dx) / DEG;
      if (deg > 135) deg = 135;
      if (deg < -135) deg = -135;
      setting = settingOfAngle(deg);
      drawKnob();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setting = Math.max(S_MIN, Math.min(S_MAX, Math.round(setting)));
      knobDrag = false;
      drawKnob();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  gKnob.on('wheel', (e) => {
    e.stopPropagation();
    setting = Math.max(S_MIN, Math.min(S_MAX, Math.round(setting) + (e.deltaY < 0 ? 1 : -1)));
    drawKnob();
  });
}
function positionUI() {
  const w = app.renderer.width / app.renderer.resolution;
  knobC = { x: w - 140, y: 150 };
  gKnob.hitArea = new PIXI.Rectangle(
    knobC.x - KNOB_R - 20, knobC.y - KNOB_R - 20, (KNOB_R + 20) * 2, (KNOB_R + 20) * 2);
  drawKnob();
  const cap = document.getElementById('knob-caption');
  cap.style.left = `${knobC.x - 115}px`;
}

/* ============================================================
 * HUD
 * ============================================================ */
const el = (id) => document.getElementById(id);
function updateHUD() {
  const gapTarget = gapOf(setting);
  const omega = omegaDegOf(setting);
  const vFeed = feedSpeedOf(setting);
  const rpm = omega / 6;
  const perMin = Math.round(vFeed / G.lead * 12 * 60);   // 估算颗粒/分（每转约12粒）
  el('r-setting').textContent = setting.toFixed(1);
  el('r-gap').textContent = `${gateGap.toFixed(1)} px（档位目标 ${gapTarget.toFixed(1)}）`;
  el('r-rpm').textContent = `${omega.toFixed(0)} °/s（${rpm.toFixed(1)} rpm）`;
  el('r-feed').textContent = `${vFeed.toFixed(1)} mm/s · 估算 ${perMin} 粒/分`;
  el('r-pile').textContent = `${_pileCache.toFixed(0)} / 90 mm`;

  const hopperN = particles.filter((p) => p.y < G.neckL.y).length;
  const flowRate = flowEvents.filter((t) => simT - t < 2).length / 2;
  const yb = G.tubeBot - gateGap;
  const wedged = particles.some((p) =>
    Math.abs(p.x - G.gateCX) < G.gateHalf + 8 && Math.abs(p.y - yb) < G.r + 3 &&
    Math.hypot(p.vx, p.vy) < 25);
  const tag = el('r-status');
  const banner = el('banner');
  let cls = 'idle', txt = '待机';
  if (hopperN < 3) { cls = 'empty'; txt = '粮斗已空'; }
  else if (gateGap < G.D) {
    cls = 'jam';
    txt = wedged ? '卡粒堵塞 · 绞龙空转' : '堵塞边界 · 绞龙空转';
  } else if (flowRate > 0.8) { cls = 'flow'; txt = '出粮中'; }
  else { cls = 'idle'; txt = '进料 / 待机'; }
  tag.className = `tag ${cls}`;
  tag.textContent = txt;

  banner.className = '';
  if (cls === 'jam') {
    banner.className = 'show jam';
    banner.textContent = `⚠ 闸门开度 ${gateGap.toFixed(1)}mm < 颗粒 8mm：粮粒被闸门底缘卡住，绞龙保持 ${rpm.toFixed(0)}rpm 空转`;
  } else if (cls === 'flow') {
    banner.className = 'show flow';
    banner.textContent = `● 正常出粮：开度 ${gateGap.toFixed(1)}mm，绞龙 ${rpm.toFixed(0)}rpm`;
  }
}

/* ============================================================
 * 按钮
 * ============================================================ */
let demo = null;   // {t0, dur, from, to}
el('btn-pause').onclick = () => {
  paused = !paused;
  el('btn-pause').textContent = paused ? '继续' : '暂停';
};
el('btn-demo').onclick = () => {
  setting = 8; drawKnob();                 // 先回到高档
  demo = { t0: performance.now(), dur: 14000, from: 8, to: 1 };
  el('btn-demo').textContent = '演示中…';
};
el('btn-refill').onclick = () => { fillHopper(); settle(220); };
el('btn-reset').onclick = () => {
  setting = 8; gateGap = GAP_MIN; augDeg = 0; simT = 0; flowEvents = [];
  demo = null; el('btn-demo').textContent = '堵塞边界演示';
  shellL.position.x = 210; shellR.position.x = 470;
  fillHopper(); settle(320);
  gateGap = gapOf(setting);
  drawKnob();
};

/* ============================================================
 * 主循环
 * ============================================================ */
function settle(steps) {
  const savedGap = gateGap;
  const savedSetting = setting;
  gateGap = GAP_MIN;                 // 静置时闸门近乎关闭，粮不进管
  settleMode = true;                 // 冻结绞龙，纯重力沉降
  const savedAug = augDeg;
  for (let i = 0; i < steps; i++) physicsStep(FIXED);
  augDeg = savedAug;
  settleMode = false;
  setting = savedSetting;
  gateGap = savedGap;
  flowEvents = [];
  for (const p of particles) p.flowed = false;
}

function frame() {
  const dt = Math.min(app.ticker.deltaMS / 1000, 0.05);
  if (!paused) {
    // 演示：旋钮从 8 缓慢拧到 1，跨越 s*≈1.78 堵塞边界
    if (demo) {
      const k = Math.min(1, (performance.now() - demo.t0) / demo.dur);
      setting = demo.from + (demo.to - demo.from) * k;
      if (k >= 1) { demo = null; el('btn-demo').textContent = '堵塞边界演示'; drawKnob(); }
    }
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < 6) { physicsStep(FIXED); acc -= FIXED; n++; }
    if (n === 6) acc = 0;
    // 闸门未拖动时，向当前档位对应开度弹回
    if (!gateDragging) {
      const target = gapOf(setting);
      gateGap += (target - gateGap) * Math.min(1, 12 * dt);
    }
    pileHeight();
  }
  drawAuger(); drawGate(); drawParticles();
  if (demo) drawKnob();
  updateHUD();
}

/* ---------------- 启动 ---------------- */
function resize() {
  const w = app.renderer.width / app.renderer.resolution;
  const h = app.renderer.height / app.renderer.resolution;
  vp.resize(w, h, 1220, 680);
  positionUI();
}
window.addEventListener('resize', resize);

drawGrid();
drawStatic();
drawLabels();
buildShell(shellL, 210, 40, 260, 420, '左外壳');
buildShell(shellR, 470, 40, 390, 420, '右外壳');
buildGateHit();
buildKnob();
positionUI();

fillHopper();
settle(320);                       // 预置“粮斗快满”静置布局
gateGap = gapOf(setting);

app.ticker.add(frame);
