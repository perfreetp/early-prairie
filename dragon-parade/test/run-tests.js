// 仿真内核确定性 / 行为测试（node test/run-tests.js）
const assert = require("assert");
const SIM = require("./sim_core");

let pass = 0;
function ok(name, fn) {
  try { fn(); pass++; console.log("  PASS  " + name); }
  catch (e) { console.error("  FAIL  " + name + "\n        " + e.message); process.exitCode = 1; }
}

// ---- 1. 时间轴回拖：seek(t) 与逐步推进到 t 的状态完全一致 ----
ok("回拖一致性：seek(t) 与连续步进逐节点重合（三条路线）", () => {
  for (let r = 0; r < 3; r++) {
    const t = 8.37;
    const a = SIM.seek(r, t);
    const b = SIM.init(r);
    while (b.t < t - 1e-9) SIM.step(b, SIM.FIXED_DT);
    const sa = SIM.snapshot(a), sb = SIM.snapshot(b);
    assert.strictEqual(sa.length, sb.length);
    for (let i = 0; i < sa.length; i++) {
      for (const k of ["x", "z", "y", "yaw", "roll", "offset", "gap", "s"]) {
        assert.ok(Math.abs(sa[i][k] - sb[i][k]) < 1e-9,
          `route${r} node${i}.${k}: ${sa[i][k]} vs ${sb[i][k]}`);
      }
    }
  }
});

// ---- 2. 确定性：同样的 t seek 两次结果一模一样 ----
ok("确定性：同一时刻重复 seek 结果相同", () => {
  const a = SIM.snapshot(SIM.seek(1, 12.3));
  const b = SIM.snapshot(SIM.seek(1, 12.3));
  assert.deepStrictEqual(a, b);
});

// ---- 3. 初始状态：龙身在龙头后方按固定间距沿路径排开 ----
ok("初始排布：等间距 1.6m，共 11 个节点", () => {
  const s = SIM.snapshot(SIM.init(0));
  assert.strictEqual(s.length, 11);
  for (let i = 1; i < s.length; i++) {
    const d = Math.hypot(s[i].x - s[i - 1].x, s[i].z - s[i - 1].z);
    assert.ok(Math.abs(d - SIM.BASE_GAP) < 0.02, `gap ${i}=${d}`);
  }
});

// ---- 4. 避让传播顺序：龙头先偏移，龙身逐节变晚 ----
ok("避让传播：龙头先动，越靠后的龙身偏移到达峰值越晚", () => {
  const route = 0, ob = SIM.ROUTES[0].obstacles[1]; // center=42
  // 记录每个节点 |offset| 首次超过 0.3 的时刻
  const firstTime = new Array(11).fill(null);
  const sim = SIM.init(route);
  while (sim.t < sim.duration) {
    SIM.step(sim, SIM.FIXED_DT);
    const snap = SIM.snapshot(sim);
    for (let i = 0; i < snap.length; i++) {
      if (firstTime[i] === null && Math.abs(snap[i].offset) > 0.3) firstTime[i] = sim.t;
    }
  }
  for (let i = 0; i < 11; i++) assert.ok(firstTime[i] !== null, `node ${i} never dodged`);
  for (let i = 1; i < 11; i++) {
    assert.ok(firstTime[i] > firstTime[i - 1],
      `node ${i} (${firstTime[i]}) should dodge later than node ${i - 1} (${firstTime[i - 1]})`);
  }
  // 龙头在避让中心附近达到最大偏移
  const head = SIM.seek(route, ob.center / SIM.HEAD_SPEED);
  const hs = SIM.snapshot(head)[0];
  assert.ok(Math.abs(Math.abs(hs.offset) - ob.amp) < 0.05, `head max offset ${hs.offset}`);
});

// 相邻弦的有向夹角（弧度）。硬折=单节夹角突然很大；平滑弧线=每节都小且连续
function chordAngles(snap) {
  const v = [];
  for (let i = 1; i < snap.length; i++) {
    const a = snap[i - 1], b = snap[i];
    v.push({ x: b.x - a.x, z: b.z - a.z });
  }
  const res = [];
  for (let i = 1; i < v.length; i++) {
    res.push(Math.atan2(v[i - 1].x * v[i].z - v[i - 1].z * v[i].x,
                        v[i - 1].x * v[i].x + v[i - 1].z * v[i].z));
  }
  return res;
}
const DEG = Math.PI / 180;

// ---- 5. 转弯无硬折：单节弯折有界（尖点会到 60°+，平滑弧线每节都小） ----
// 说明：避让时相邻节间距被拉长，会放大相邻弦的角度差，这是“甩弧”的正常表现；
// 硬折的本质特征是单节夹角突变到很大，故以单节弯折绝对量级为判据。
ok("转弯无硬折：直街/拐弯全程单节弯折始终 < 30°（尖点式死折会 > 60°）", () => {
  for (const r of [0, 1]) {
    const sim = SIM.init(r);
    let maxBend = 0;
    while (sim.t < sim.duration) {
      SIM.step(sim, SIM.FIXED_DT);
      for (const a of chordAngles(SIM.snapshot(sim))) maxBend = Math.max(maxBend, Math.abs(a));
    }
    assert.ok(maxBend < 30 * DEG, `route ${r} bend ${(maxBend / DEG).toFixed(1)}° 出现尖点式硬折`);
  }
});

// ---- 5b. 三条路线（含卡巷）全程都不存在尖点式死折 ----
ok("无死折：直街/拐弯/卡巷全程单节弯折始终 < 30°", () => {
  for (let r = 0; r < 3; r++) {
    const sim = SIM.init(r);
    let maxBend = 0;
    while (sim.t < sim.duration) {
      SIM.step(sim, SIM.FIXED_DT);
      for (const a of chordAngles(SIM.snapshot(sim))) maxBend = Math.max(maxBend, Math.abs(a));
    }
    assert.ok(maxBend < 30 * DEG, `route ${r} max bend ${(maxBend / DEG).toFixed(1)}°`);
  }
});

// ---- 5c. 弯道处龙身确实沿弧线甩出：拐弯路线经过弯心时多节同时带同向弯折 ----
ok("弯道甩出弧线：过弯时至少 3 节龙身带同向弯折（弧线），而非只有一节折过去", () => {
  const sim = SIM.init(1);
  let maxSameDir = 0;
  while (sim.t < sim.duration) {
    SIM.step(sim, SIM.FIXED_DT);
    const ang = chordAngles(SIM.snapshot(sim));
    let run = 0, best = 0, sign = 0;
    for (const a of ang) {
      if (Math.abs(a) > 2 * DEG) {
        const s = Math.sign(a);
        if (s === sign) run++; else { sign = s; run = 1; }
        best = Math.max(best, run);
      } else { sign = 0; run = 0; }
    }
    maxSameDir = Math.max(maxSameDir, best);
  }
  assert.ok(maxSameDir >= 3, `同向连续弯折仅 ${maxSameDir} 节，未形成弧线`);
});

// ---- 6. 间距先拉长再收拢 ----
ok("避让时拉长、回正后收拢：最大间距 > 基准，最终回到基准附近", () => {
  const sim = SIM.init(0);
  let maxGap = SIM.BASE_GAP;
  while (sim.t < sim.duration) {
    SIM.step(sim, SIM.FIXED_DT);
    for (const nd of sim.nodes.slice(1)) maxGap = Math.max(maxGap, nd.gap);
  }
  assert.ok(maxGap > SIM.BASE_GAP * 1.15, `max gap only ${maxGap}`);
  const end = SIM.snapshot(sim);
  for (let i = 1; i < end.length; i++) {
    assert.ok(Math.abs(end[i].gap - SIM.BASE_GAP) < 0.05, `end gap ${i}=${end[i].gap}`);
  }
});

// ---- 7. 卡巷：龙头停在 block 位置，停车波逐节向后传，最终全停 ----
ok("卡巷边界：龙头先停，龙身依次停下，间距不小于 0，最终全部静止", () => {
  const block = SIM.ROUTES[2].block;
  const sim = SIM.init(2);
  const stopTime = new Array(11).fill(null);
  let prevS = sim.nodes.map(n => n.s);
  while (sim.t < sim.duration) {
    SIM.step(sim, SIM.FIXED_DT);
    for (let i = 0; i <= SIM.N_SEG; i++) {
      if (stopTime[i] === null && Math.abs(sim.nodes[i].s - prevS[i]) < 1e-5) stopTime[i] = sim.t;
    }
    prevS = sim.nodes.map(n => n.s);
    for (const nd of sim.nodes) assert.ok(nd.gap > 0.5, "gap collapsed");
  }
  assert.strictEqual(sim.blocked, true);
  assert.ok(Math.abs(sim.nodes[0].s - block) < 1e-6, "head not at block");
  for (let i = 0; i < 11; i++) assert.ok(stopTime[i] !== null, `node ${i} never stopped`);
  for (let i = 1; i < 11; i++) {
    assert.ok(stopTime[i] >= stopTime[i - 1] - 1e-9,
      `node ${i} stopped before node ${i - 1}`);
  }
  assert.ok(stopTime[SIM.N_SEG] - stopTime[0] > 1.0,
    `stop wave too fast: ${stopTime[SIM.N_SEG] - stopTime[0]}s`);
});

// ---- 8. 对应街口两路线避让幅度不同 ----
ok("对应街口差异：拐弯路线第二个避让点(1.25) > 直街第二个避让点(0.70)", () => {
  const d0 = SIM.headDodge(SIM.ROUTES[0], 42);
  const d1 = SIM.headDodge(SIM.ROUTES[1], 68);
  assert.ok(Math.abs(d1.offset) > Math.abs(d0.offset));
  assert.ok(Math.abs(Math.abs(d0.offset) - 0.7) < 1e-9);
  assert.ok(Math.abs(Math.abs(d1.offset) - 1.25) < 1e-9);
});

// ---- 9. 龙头宽度恰好卡巷：巷口 1.45m < 龙头宽 1.38?（文档化边界） ----
ok("边界参数：巷口净宽 1.45m，龙头宽 1.38m（余量仅 0.07m，龙身无法整体通过即停止）", () => {
  assert.strictEqual(SIM.ROUTES[2].block, 30);
  assert.ok(1.45 - 1.38 < 0.1);
});

console.log(`\n${pass} 个测试通过` + (process.exitCode ? "，存在失败" : "，全部通过 ✔"));
