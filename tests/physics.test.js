/*
 * 无浏览器物理验证：从 app.js 抽取与 Pixi 无关的纯函数/常量，
 * 复刻 physicsStep 的数值部分，覆盖标定、堵塞、出粮、边界扫描、空转。
 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

function extract(startMarker, openCh, closeCh) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('marker not found: ' + startMarker);
  const oi = src.indexOf(openCh, i);
  let depth = 0;
  for (let k = oi; k < src.length; k++) {
    const c = src[k];
    if (c === openCh) depth++;
    if (c === closeCh) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + startMarker);
}
const Gsrc = extract('const G =', '{', '}');
const cns = src.slice(src.indexOf('const S_MIN'), src.indexOf('/** 堵塞边界'));
const crit = extract('const S_CRIT', ';', ';');
const fns = ['gapOf', 'omegaDegOf', 'feedSpeedOf', 'gateSegments', 'flightSegments',
  'circleSeg', 'pairCollide', 'collideFlight'].map((n) =>
  extract('function ' + n + '(', '{', '}'));

const code = `
const DEG = Math.PI/180;
${Gsrc}
${cns}
${crit}
const spokes = [];
for (let x = G.augL + 8; x <= G.augR - 8; x += G.spokeGap) spokes.push(x);
${fns.join('\n')}
module.exports = { G, gapOf, omegaDegOf, feedSpeedOf, gateSegments, flightSegments,
  circleSeg, pairCollide, collideFlight, S_CRIT, S_MIN, S_MAX };
`;
const modPath = path.join(__dirname, 'extracted.js');
fs.writeFileSync(modPath, code);
const M = require(modPath);
const { G, gapOf, omegaDegOf, feedSpeedOf, gateSegments, flightSegments,
  circleSeg, pairCollide, collideFlight, S_CRIT, S_MIN } = M;
const DEG = Math.PI / 180;
const FIXED = 1 / 120;
const CELL = G.D + 6;
const GAP_MIN_SAFE = 4;

const WALLS = [
  [G.hopTL.x, G.hopTL.y, G.neckL.x, G.neckL.y],
  [G.hopTR.x, G.hopTR.y, G.neckR.x, G.neckR.y],
  [G.tubeL, G.tubeTop, G.neckL.x, G.tubeTop],
  [G.gateCX + G.gateHalf, G.tubeTop, G.tubeR, G.tubeTop],
  [G.tubeL, G.tubeBot, 795, G.tubeBot],
  [G.tubeL, G.tubeTop, G.tubeL, G.tubeBot],
  [G.tubeR, G.tubeTop, G.tubeR, 350],
  [G.chuteA.x, G.chuteA.y, G.chuteB.x, G.chuteB.y],
  [G.rimL.x, G.rimL.y, G.bowlBL.x, G.bowlBL.y],
  [G.bowlBL.x, G.bowlBL.y, G.bowlBR.x, G.bowlBR.y],
  [G.bowlBR.x, G.bowlBR.y, G.rimR.x, G.rimR.y],
];

function insideHopper(x, y, m) {
  if (y < G.hopTL.y + m || y > G.neckL.y - m) return false;
  const f = (y - G.hopTL.y) / (G.neckL.y - G.hopTL.y);
  const xl = G.hopTL.x + (G.neckL.x - G.hopTL.x) * f + m;
  const xr = G.hopTR.x + (G.neckR.x - G.hopTR.x) * f - m;
  return x > xl && x < xr;
}
// 确定性随机数（mulberry32），保证每次测试颗粒布局一致、结果可复现
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
Math.random = mulberry32(20261128);

function seed() {
  const ps = [];
  const sp = 12;
  for (let y = G.hopTL.y + 14; y <= G.neckL.y - 12; y += sp) {
    const f = (y - G.hopTL.y) / (G.neckL.y - G.hopTL.y);
    const xl = G.hopTL.x + (G.neckL.x - G.hopTL.x) * f + 8;
    const xr = G.hopTR.x + (G.neckR.x - G.hopTR.x) * f - 8;
    for (let x = xl; x <= xr; x += sp) {
      const jx = x + (Math.random() - 0.5) * 5, jy = y + (Math.random() - 0.5) * 5;
      if (insideHopper(jx, jy, G.r + 1)) ps.push({ x: jx, y: jy, vx: 0, vy: 0, flowed: false });
    }
  }
  return ps;
}
function substep(ps, setting, gateGap, augDeg, dt, frozen) {
  const omegaDeg = frozen ? 0 : omegaDegOf(setting);
  const omegaRad = omegaDeg * DEG;
  const vFeed = frozen ? 0 : feedSpeedOf(setting);
  augDeg = (augDeg + omegaDeg * dt) % 360;
  const gt = gateSegments(gateGap);
  const flights = flightSegments(augDeg);
  const VMAX = 320;
  for (const p of ps) {
    p.vy += 900 * dt; p.vx *= .992; p.vy *= .992;
    const sp = Math.hypot(p.vx, p.vy);
    if (sp > VMAX) { p.vx *= VMAX / sp; p.vy *= VMAX / sp; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.y < -200) {
      p.x = G.augL + 20; p.y = G.tubeBot - 12; p.vx = 0; p.vy = 0;
    }
    const inNeckX = p.x > G.neckL.x && p.x < G.neckR.x;
    if (inNeckX && p.vy < 0 && p.y < G.tubeTop + G.r) {
      p.y = G.tubeTop + G.r; p.vy = Math.max(0, p.vy);
    }
    const inLeftWall = p.x > G.tubeL + G.r && p.x < G.neckL.x - G.r;
    const inRightWall = p.x > G.gateCX + G.gateHalf + G.r && p.x < G.tubeR - G.r;
    if (inLeftWall || inRightWall) {
      const yTop = G.tubeTop + G.r, yBot = G.tubeBot - G.r;
      if (p.y < yTop) { p.y = yTop; p.vy = Math.abs(p.vy) * .15; }
      if (p.y > yBot) { p.y = yBot; p.vy = -Math.abs(p.vy) * .15; }
    }
    if (p.x > 240 && p.x < 830 && p.y < G.hopTL.y - 6) {
      p.y = G.hopTL.y - 6; p.vy = Math.abs(p.vy) * .2;
    }
    if (p.x < 20) { p.x = 20; p.vx = Math.abs(p.vx); }
    if (p.x > 1080) { p.x = 1080; p.vx = -Math.abs(p.vx); }
    if (p.y < 20) { p.y = 20; p.vy = Math.abs(p.vy); }
  }
  for (const p of ps) {
    for (const w of WALLS) circleSeg(p, w[0], w[1], w[2], w[3], .08, .85);
    for (const w of gt.segs) circleSeg(p, w[0], w[1], w[2], w[3], .05, .55);
    for (const f of flights) if (Math.abs(p.x - f.cx) <= G.flightR + G.r) collideFlight(p, f, omegaRad, vFeed);
  }
  const hm = new Map();
  for (let i = 0; i < ps.length; i++) {
    const k = Math.floor(ps[i].x / CELL) * 100000 + Math.floor(ps[i].y / CELL);
    if (!hm.has(k)) hm.set(k, []); hm.get(k).push(i);
  }
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i], cx = Math.floor(a.x / CELL), cy = Math.floor(a.y / CELL);
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const arr = hm.get(gx * 100000 + gy);
      if (!arr) continue;
      for (const j of arr) if (j > i) pairCollide(a, ps[j]);
    }
  }
  // 硬性几何闸门（最终裁决，在所有碰撞之后）：开度 < 颗粒直径时，颗粒无法通过开度缝，
  // 闸门面在管高内刚性封闭——左侧颗粒一律挡在 gateCX 左缘，杜绝软接触重叠挤穿
  if (gateGap < G.D) {
    for (const p of ps) {
      if (p.y > G.tubeTop - G.r && p.y < G.tubeBot + G.r && p.x > G.gateCX - G.r) {
        p.x = G.gateCX - G.r;
        if (p.vx > 0) p.vx = 0;
      }
    }
  }
  // 一次性闩锁：跨过出口截面且位于管底/斜槽高度带（排除顶部抛飞颗粒）
  for (const p of ps) if (!p.flowed && p.x > 800 && p.y > G.tubeTop + 40 && p.y < G.tubeBot + 60) p.flowed = true;
  return augDeg;
}
function step(ps, setting, gateGap, augDeg) {
  augDeg = substep(ps, setting, gateGap, augDeg, FIXED / 2, false);
  return substep(ps, setting, gateGap, augDeg, FIXED / 2, false);
}
function settleStep(ps, augDeg) {
  augDeg = substep(ps, S_MIN, GAP_MIN_SAFE, augDeg, FIXED / 2, true);
  return substep(ps, S_MIN, GAP_MIN_SAFE, augDeg, FIXED / 2, true);
}
function run(setting, seconds) {
  const ps = seed();
  let aug = 0, augTotal = 0;
  for (let i = 0; i < 300; i++) aug = settleStep(ps, aug);
  for (const p of ps) p.flowed = false;   // 静置期不计出粮，观测窗从开闸算起
  // 空间快照：真正通过闸门的颗粒最终位于闸门右侧的管段/斜槽/碗内（y 低于管顶，排除顶部飞粒）
  const rightOf = (p) => p.x > G.gateCX + G.gateHalf && p.y > G.tubeTop - G.r;
  const rightBase = ps.filter(rightOf).length;
  const gap = gapOf(setting);
  const tSteps = Math.round(seconds / FIXED);
  let maxNearSpeed = 0;
  for (let i = 0; i < tSteps; i++) {
    const before = aug;
    aug = step(ps, setting, gap, aug);
    let d = aug - before; if (d < 0) d += 360;
    augTotal += d;
    if (i > tSteps - 120) {
      for (const p of ps) {
        if (p.x < G.gateCX && Math.abs(p.x - G.gateCX) < 60 && p.y > G.tubeTop) {
          maxNearSpeed = Math.max(maxNearSpeed, Math.hypot(p.vx, p.vy));
        }
      }
    }
  }
  const flowed = ps.filter((p) => p.flowed).length;
  // 净通过闸门 = 观测后位于闸门右侧的颗粒数 − settle 后基数（空间快照，抗往复抖动）
  const netRight = ps.filter(rightOf).length - rightBase;
  if (process.env.DBG) {
    const topEscape = ps.filter((p) => p.y < G.tubeTop - 40).length;
    const illegal = ps.filter((p) => p.x > 531 && p.x < 792 && (p.y < G.tubeTop + G.r - 1 || p.y > G.tubeBot - G.r + 1)).length;
    console.log(`  [DBG s=${setting}] 净右移=${netRight} 顶部逃逸=${topEscape} illegal=${illegal} 出口=${flowed}`);
  }
  return { flowed, netRight, gap, n: ps.length, augRotated: augTotal, maxNearSpeed };
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!cond) failures++;
};

console.log('--- 1. 标定关系与运动学 ---');
check('堵塞解析边界 S_CRIT ≈ 1.783', Math.abs(S_CRIT - 1.783) < 0.01, `S_CRIT=${S_CRIT.toFixed(3)}`);
check('g(1)=4 且 g(10)=50（单调递增）', gapOf(1) === 4 && gapOf(10) === 50,
  `g(1)=${gapOf(1)}, g(10)=${gapOf(10)}`);
let kinOK = true;
for (let s = 1; s <= 10; s++) {
  const w = omegaDegOf(s), v = feedSpeedOf(s);
  if (Math.abs(v - w / 360 * G.lead) > 1e-10) kinOK = false;
  if (s === 1) check('s=1 处于堵塞区（g<D）', gapOf(s) < G.D, `g=${gapOf(s)} < D=${G.D}`);
  if (s === 2) check('s=2 处于流通区（g>D）', gapOf(s) > G.D, `g=${gapOf(s).toFixed(2)} > D=${G.D}`);
}
check('全部档位 v=ω·L/2π 严格成立', kinOK);
check('ω 线性 60→600 °/s', omegaDegOf(1) === 60 && omegaDegOf(10) === 600);

console.log('\n--- 2. 堵塞侧：s=1（g=4 < D=8），12 秒 ---');
const A = run(1, 12);
console.log(`  开度=${A.gap}mm 出口出粮=${A.flowed}粒 净右移(诊断)=${A.netRight} 绞龙转角=${A.augRotated.toFixed(0)}° 闸前最大粒速=${A.maxNearSpeed.toFixed(0)}px/s`);
check('零颗粒到达出粮口（堵塞金标准）', A.flowed === 0, `出口=${A.flowed}`);
check('绞龙仍在旋转（空转）', A.augRotated > 180, `累计转角 ${A.augRotated.toFixed(0)}°`);
check('闸前粮粒被辐条搅动（非静止）', A.maxNearSpeed > 15, `${A.maxNearSpeed.toFixed(0)} px/s`);

console.log('\n--- 3. 流通侧：s=8（g≈39.8 > D=8），12 秒 ---');
const B = run(8, 12);
console.log(`  开度=${B.gap.toFixed(1)}mm 出口出粮=${B.flowed}粒 净右移(诊断)=${B.netRight}`);
check('稳定出粮到碗（>20 粒）', B.flowed > 20, `${B.flowed} 粒`);

console.log('\n--- 4. 低速档 s=4 也能出粮，10 秒 ---');
const Dd = run(4, 10);
check('s=4 出口出粮 > 5 粒', Dd.flowed > 5, `${Dd.flowed} 粒`);

console.log('\n--- 5. 边界扫描：通过性与 g−D 符号一致（以出口出粮为准） ---');
for (const s of [1, 2, 3, 5, 8, 10]) {
  const r = run(s, s <= 3 ? 18 : 10);
  const expectJam = gapOf(s) < G.D;
  const actualJam = r.flowed === 0;
  check(`s=${s} (g=${gapOf(s).toFixed(1)}) ${expectJam ? '应堵塞' : '应流通'}`,
    actualJam === expectJam, `出口=${r.flowed} 净右移=${r.netRight}`);
}

console.log('\n--- 6. 亚档位边界：s=S_CRIT 两侧 0.05（近临界输送慢，各 30 秒） ---');
const lo = run(+(S_CRIT - 0.05).toFixed(2), 30);
const hi = run(+(S_CRIT + 0.05).toFixed(2), 30);
console.log(`  s=${(S_CRIT - 0.05).toFixed(2)} (g=${lo.gap.toFixed(2)}<D): 出口=${lo.flowed}`);
console.log(`  s=${(S_CRIT + 0.05).toFixed(2)} (g=${hi.gap.toFixed(2)}>D): 出口=${hi.flowed}`);
check('边界下侧堵塞（g<D，零出粮）', lo.flowed === 0);
check('边界上侧流通（g>D，有出粮）', hi.flowed > 0);

console.log(failures === 0 ? '\n全部通过 ✔' : `\n${failures} 项失败 ✘`);
process.exit(failures === 0 ? 0 : 1);
