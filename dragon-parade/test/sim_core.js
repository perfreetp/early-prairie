

const SIM = (() => {

  const N_SEG = 10;            // 龙身节数（另加 1 个龙头，共 11 个节点）
  const BASE_GAP = 1.6;        // 固定间距（米，沿轨迹弧长）
  const HEAD_SPEED = 1.4;      // 龙头前进速度 米/秒
  const CHASE_K = 2.6;         // 龙身追赶弹簧（越小停车波拖得越长）
  const GAP_K = 3.2;           // 间距收拢弹簧
  const MAX_STRETCH = 1.35;    // 避让时间距最多拉长到 1.35 倍
  const BOB_AMP = 0.055;       // 上下起伏幅度
  const FIXED_DT = 1 / 120;    // 固定仿真步长，保证回放确定性

  // 向心 Catmull-Rom（alpha=0.5）：保证急弯处不打环、不出尖点
  function catmull(p0, p1, p2, p3, u, alpha = 0.5) {
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) || 1e-6;
    const t1 = Math.pow(dist(p0, p1), alpha);
    const t2 = t1 + Math.pow(dist(p1, p2), alpha);
    const t3 = t2 + Math.pow(dist(p2, p3), alpha);
    const t = t1 + u * (t2 - t1);
    const L = (a, b, ta, tb) => {
      const f = (t - ta) / (tb - ta);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    };
    const A1 = L(p0, p1, 0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
    const B1 = L(A1, A2, 0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  }

  // 折线圆角：在每个显著转角插入半径 r 的圆弧控制点（共线点自动跳过）
  function fillet(points, r, arcSegs = 7) {
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const A = points[i - 1], B = points[i], C = points[i + 1];
      const u1 = norm(sub(B, A)), u2 = norm(sub(C, B));
      const cosT = clamp(dot(u1, u2), -1, 1);
      const theta = Math.acos(cosT);           // 转角
      if (theta < 0.12) { out.push(B); continue; } // 近似直走，不处理
      const d = r / Math.tan(theta / 2);       // 切点到角点距离
      const T1 = { x: B.x - u1.x * d, z: B.z - u1.z * d };
      const T2 = { x: B.x + u2.x * d, z: B.z + u2.z * d };
      const perp = { x: -u1.z, z: u1.x };
      const sign = dot(perp, u2) >= 0 ? 1 : -1;
      const n = { x: perp.x * sign, z: perp.z * sign }; // 内侧法线
      const O = { x: T1.x + n.x * r, z: T1.z + n.z * r };
      const a0 = Math.atan2(T1.z - O.z, T1.x - O.x);
      const a1 = Math.atan2(T2.z - O.z, T2.x - O.x);
      let da = a1 - a0;
      if (sign > 0 && da < 0) da += Math.PI * 2;
      if (sign < 0 && da > 0) da -= Math.PI * 2;
      for (let k = 0; k <= arcSegs; k++) {
        const a = a0 + da * (k / arcSegs);
        out.push({ x: O.x + r * Math.cos(a), z: O.z + r * Math.sin(a) });
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }
  const sub = (a, b) => ({ x: a.x - b.x, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.z * b.z;
  const norm = v => { const l = Math.hypot(v.x, v.z) || 1e-6; return { x: v.x / l, z: v.z / l }; };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // 折线等距重采样：消除“密弧点 + 长直段”导致的样条 S 形抖动
  function resample(points, spacing) {
    const out = [points[0]];
    let used = 0;                         // 当前线段起点已被前一段“预支”的距离
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const segLen = Math.hypot(b.x - a.x, b.z - a.z);
      if (segLen < 1e-9) { used = 0; continue; }
      const ux = (b.x - a.x) / segLen, uz = (b.z - a.z) / segLen;
      let d = spacing - used;             // 距下一个样本点还需沿本段走多远
      while (d <= segLen) {
        out.push({ x: a.x + ux * d, z: a.z + uz * d });
        d += spacing;
      }
      used = segLen - (d - spacing);      // 本段末端到下一个样本点的欠账
    }
    const last = points[points.length - 1];
    if (Math.hypot(last.x - out[out.length - 1].x, last.z - out[out.length - 1].z) > 1e-6) out.push(last);
    return out;
  }

  // ---------- 路径：圆角折线 + 向心 Catmull-Rom + 弧长重采样 ----------
  class Path {
    constructor(ctrl, cornerRadius = 6) {
      if (cornerRadius > 0) ctrl = fillet(ctrl, cornerRadius);
      ctrl = resample(ctrl, 1.4);
      this.ctrl = ctrl;
      const samples = [];
      const seg = ctrl.length - 1;
      const per = 120;
      const P = i => ctrl[Math.max(0, Math.min(seg, i))];
      for (let i = 0; i < seg; i++) {
        for (let j = 0; j < per; j++) {
          samples.push(catmull(P(i - 1), P(i), P(i + 1), P(i + 2), j / per));
        }
      }
      samples.push({ x: ctrl[seg].x, z: ctrl[seg].z });
      // 弧长表（约 0.25m 一行）
      this.arc = [0];
      let acc = 0;
      for (let i = 1; i < samples.length; i++) {
        acc += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z);
        this.arc.push(acc);
      }
      this.samples = samples;
      this.length = acc;
    }
    _idxAt(s) {
      if (s <= 0) return 0;
      if (s >= this.length) return this.arc.length - 1;
      let lo = 0, hi = this.arc.length - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.arc[mid] <= s) lo = mid; else hi = mid;
      }
      return lo;
    }
    pointAt(s) {
      if (s < 0) { // 起点之前沿初始切线外推（用于排布初始龙身）
        const p = this.samples[0], n = this.samples[4] || this.samples[1];
        const d = Math.hypot(n.x - p.x, n.z - p.z) || 1;
        return { x: p.x + s * (n.x - p.x) / d, z: p.z + s * (n.z - p.z) / d };
      }
      if (s >= this.length) {
        const a = this.samples[this.samples.length - 1], b = this.samples[this.samples.length - 2];
        const d = Math.hypot(a.x - b.x, a.z - b.z) || 1;
        const over = s - this.length;
        return { x: a.x + over * (a.x - b.x) / d, z: a.z + over * (a.z - b.z) / d };
      }
      const i = this._idxAt(s), s0 = this.arc[i], s1 = this.arc[i + 1];
      const f = (s - s0) / Math.max(1e-6, s1 - s0);
      const a = this.samples[i], b = this.samples[i + 1];
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
    }
    // 左侧法线（切线逆时针转 90°）
    normalAt(s) {
      const a = this.pointAt(s - 0.35), b = this.pointAt(s + 0.35);
      const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz) || 1;
      return { x: -dz / d, z: dx / d };
    }
  }

  // ---------- 三条预置路线 ----------
  // obstacle: {center, half, amp(侧身幅度米), side(-1=路径左侧避让 +1=右侧)}
  // block: 龙头被巷口卡住的弧长位置；无则 null
  const ROUTES = [
    {
      name: "直街",
      ctrl: [{ x: 0, z: -46 }, { x: 0, z: -20 }, { x: 0, z: 10 }, { x: 0, z: 46 }],
      obstacles: [
        { center: 14, half: 6, amp: 0.7, side: -1 },
        { center: 42, half: 6, amp: 0.7, side: 1 }   // 对应街口，幅度 0.7
      ],
      block: null
    },
    {
      name: "拐弯",
      ctrl: [{ x: -34, z: -30 }, { x: -8, z: -30 }, { x: 8, z: -30 },
             { x: 8, z: -6 }, { x: 8, z: 22 }, { x: 30, z: 22 }, { x: 40, z: 22 }],
      obstacles: [
        { center: 18, half: 6, amp: 0.95, side: 1 },
        { center: 68, half: 6, amp: 1.25, side: -1 }  // 对应街口，幅度 1.25（比直街的 0.70 大）
      ],
      block: null
    },
    {
      name: "卡巷",
      ctrl: [{ x: -18, z: 0 }, { x: 2, z: 0 }, { x: 22, z: 0 }, { x: 36, z: 0 }],
      obstacles: [
        { center: 12, half: 5, amp: 0.8, side: -1 }   // 先正常避让一次，再卡巷
      ],
      block: 30.0
    }
  ];

  function smoothBump(d, half) {
    if (d >= half) return 0;
    return 0.5 * (1 + Math.cos(Math.PI * d / half)); // 平滑钟形，边缘导数为 0
  }

  // 龙头在弧长 s 处的避让信息
  function headDodge(route, s) {
    let offset = 0, roll = 0, active = false, stretch = 0;
    for (const ob of route.obstacles) {
      const d = Math.abs(s - ob.center);
      const b = smoothBump(d, ob.half);
      if (b > 0) active = true;
      offset += ob.side * ob.amp * b;
      roll += -ob.side * 0.28 * b;       // 向摊位一侧倾斜
      stretch = Math.max(stretch, b);    // 偏移越大，目标间距拉得越长
    }
    return { offset, roll, active, stretch };
  }

  function init(routeId) {
    const cfg = ROUTES[routeId];
    const path = new Path(cfg.ctrl);
    // 龙头历史轨迹：每 0.2m 弧长存一个“锚点 + 侧身偏移 + 侧倾”，
    // 龙身沿这条轨迹按弧长滞后跟随 → 避让/回正沿队伍逐节传播，且转弯天然成弧
    const trail = { ds: 0.2, pts: [] };
    const nodes = [];
    // nodes[0]=龙头，nodes[1..10]=龙身；初始沿路径在龙头后方按固定间距排开
    for (let i = 0; i <= N_SEG; i++) {
      const targetS = -i * BASE_GAP;
      nodes.push({
        s: targetS, anchor: { x: 0, z: 0 },
        yaw: 0, roll: 0, offset: 0, stretch: 0,
        targetS, gap: BASE_GAP
      });
    }
    for (const nd of nodes) {
      const p = path.pointAt(nd.targetS);
      nd.anchor.x = p.x; nd.anchor.z = p.z;
    }
    const sim = {
      routeId, cfg, path, trail, nodes,
      t: 0, headS: 0, blocked: false, blockT: null,
      duration: cfg.block == null
        ? (path.length + N_SEG * BASE_GAP) / HEAD_SPEED + 1.5
        : (cfg.block + N_SEG * BASE_GAP) / HEAD_SPEED + 4.0
    };
    return sim;
  }

  // 在龙头历史轨迹上按弧长 s 取值（线性插值；s<0 时给零偏移的起点外推）
  function trailAt(sim, s) {
    const { trail, path } = sim;
    if (trail.pts.length === 0 || s <= 0) {
      const p = path.pointAt(s);
      return { x: p.x, z: p.z, offset: 0, roll: 0, stretch: 0 };
    }
    const pts = trail.pts;
    if (s <= pts[0].s) return pts[0];
    if (s >= pts[pts.length - 1].s) return pts[pts.length - 1];
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[hi];
    const u = (s - a.s) / Math.max(1e-9, b.s - a.s);
    return {
      x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u,
      offset: a.offset + (b.offset - a.offset) * u,
      roll: a.roll + (b.roll - a.roll) * u,
      stretch: a.stretch + (b.stretch - a.stretch) * u
    };
  }

  // 固定步长推进一次（确定性）
  function step(sim, dt) {
    const { path, cfg, nodes } = sim;
    sim.t += dt;

    // --- 龙头：沿弧长前进（卡巷后冻结） ---
    if (!sim.blocked) {
      sim.headS += HEAD_SPEED * dt;
      if (cfg.block != null && sim.headS >= cfg.block) {
        sim.headS = cfg.block;
        sim.blocked = true;
        sim.blockT = sim.t;
      }
    }
    const hd = headDodge(cfg, sim.headS);
    const hn = path.normalAt(sim.headS);
    const hp = path.pointAt(sim.headS);
    const head = nodes[0];
    head.targetS = sim.headS;
    head.s = sim.headS;
    head.anchor.x = hp.x; head.anchor.z = hp.z;
    head.offset = hd.offset; head.roll = hd.roll; head.stretch = hd.stretch;
    {
      const a = path.pointAt(sim.headS - 0.35), b = path.pointAt(sim.headS + 0.35);
      head.yaw = Math.atan2(b.x - a.x, b.z - a.z);
    }
    // 记录龙头历史轨迹（含侧身偏移后的世界位置），按固定弧长间隔采样
    const hx = hp.x + hn.x * hd.offset, hz = hp.z + hn.z * hd.offset;
    const pts = sim.trail.pts;
    if (pts.length === 0 || sim.headS >= pts[pts.length - 1].s + sim.trail.ds) {
      pts.push({ s: sim.headS, x: hx, z: hz, offset: hd.offset, roll: hd.roll, stretch: hd.stretch });
    }

    // --- 龙身：每节只追前一节，沿“龙头历史轨迹”按弧长滞后；间距弹簧 ---
    for (let i = 1; i <= N_SEG; i++) {
      const nd = nodes[i], prev = nodes[i - 1];
      // 目标间距 = 固定间距 ×（1 + 前一节的拉伸量），即“先拉长、再慢慢收拢”
      const targetGap = BASE_GAP * (1 + MAX_STRETCH * prev.stretch);
      nd.gap += (targetGap - nd.gap) * Math.min(1, GAP_K * dt);
      nd.targetS = prev.targetS - nd.gap;

      // 追赶弹簧：龙头停住后，停车波逐节向后传
      nd.s += (nd.targetS - nd.s) * Math.min(1, CHASE_K * dt);

      // 在龙头轨迹上取自己滞后位置 → 转弯成弧、避让沿队伍传播，都不会硬折
      const tp = trailAt(sim, Math.max(0, nd.s));
      nd.anchor.x = tp.x; nd.anchor.z = tp.z;
      nd.offset = tp.offset; nd.roll = tp.roll; nd.stretch = tp.stretch;
      {
        const ta = trailAt(sim, Math.max(0, nd.s - 0.35));
        const tb = trailAt(sim, Math.max(0, nd.s + 0.35));
        nd.yaw = Math.atan2(tb.x - ta.x, tb.z - ta.z);
      }
      nd._n = path.normalAt(nd.s);
    }
    head._n = hn;
  }

  // 渲染读取的节点状态（含起伏），纯派生量
  // 龙头的 anchor 是路径锚点（需加法线偏移）；龙身的 anchor 已是含偏移的轨迹位置
  function snapshot(sim) {
    return sim.nodes.map((nd, i) => {
      let x, z;
      if (i === 0) {
        const n = nd._n || sim.path.normalAt(nd.s);
        x = nd.anchor.x + n.x * nd.offset;
        z = nd.anchor.z + n.z * nd.offset;
      } else {
        x = nd.anchor.x; z = nd.anchor.z;
      }
      const bob = Math.sin(sim.t * 3.1 - i * 0.55) * BOB_AMP;
      return {
        index: i,
        x, z,
        y: 0.62 + bob,
        yaw: nd.yaw, roll: nd.roll,
        offset: nd.offset, stretch: nd.stretch,
        gap: nd.gap, s: nd.s
      };
    });
  }

  // 从 t=0 确定性重放到任意时刻（时间轴回拖 / 跳转时调用）
  function seek(routeId, t) {
    const sim = init(routeId);
    let guard = 0;
    while (sim.t < t - 1e-9 && guard < 200000) {
      step(sim, FIXED_DT);
      guard++;
    }
    return sim;
  }

  return { N_SEG, BASE_GAP, HEAD_SPEED, FIXED_DT, ROUTES, Path,
           init, step, seek, snapshot, headDodge, smoothBump };
})();

module.exports = SIM;