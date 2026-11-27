/* ============================================================
 * 沙雕塔受压连锁塌陷试验台 — PlayCanvas 1.73
 *
 * 模型概要（允许简化截面，连锁传力严格守恒）：
 *  - 4 根粗颗粒沙柱，柱顶由 6 根木横梁（4 边梁 + 2 对角梁）连成框架，
 *    框架上承一块石板，外载荷按 1/4 均分到 4 个柱顶节点。
 *  - 每根柱子是一根非线性轴向弹簧：
 *      弹性段 N = k·Δh ；越过峰值 Nᵤ 后进入应变软化（沙柱剪胀、
 *      承载力跌落至残余摩擦强度）；Δh 达到极限阈值 → 局部塌陷。
 *  - 横梁对柱顶提供竖向剪力耦合：Fb_i = kb·Σ(y_j−y_i)。
 *    某柱软化下沉时，横梁对它的合力向上（托举），对邻柱合力向下
 *    （把它承担的重量转嫁给邻柱）—— 力在节点上严格成对、总和为 0。
 *  - 动力学用半隐式欧拉 + 阻尼积分，塌陷因此会沿横梁网络逐柱蔓延。
 * ============================================================ */
'use strict';

if (typeof pc === 'undefined') {
  document.body.innerHTML = '<p style="color:#fff;padding:30px">PlayCanvas 引擎加载失败，请检查 vendor/playcanvas.min.js。</p>';
  throw new Error('PlayCanvas not loaded');
}

/* ---------------- 全局配置 ---------------- */
const CFG = {
  // 塔几何
  columnSpread: 0.8,          // 柱中心到塔心的 x/z 距离
  H0: 3.2,                    // 柱自然高度 (m)
  r0: 0.26,                   // 柱初始半径 (m)（简化圆形截面）
  slabSize: 2.45,
  slabThick: 0.22,

  // 沙柱材料（各柱略有差异，C1 最弱，便于从一处起裂）
  // k0: 轴向刚度 kN/m；Nu: 极限轴力 kN
  columnK:   [225, 240, 258, 278],
  columnNu:  [13.8, 15.4, 17.2, 19.0],
  softBand: 0.24,             // 峰后软化带长度 (m)
  residualFrac: 0.26,         // 软化后的残余承载比例
  collapseBand: 0.82,         // 进入软化带 82% 处触发局部塌陷
  poisson: 0.55,              // 压短变粗的表观泊松系数

  // 横梁竖向抗剪刚度 kN/m（传力强弱）
  // 取较低值：塌陷后邻柱有明显的逐根加速变形（~0.2s 间隔），而非整体同时垮
  beamK: 22,

  // 动力学
  nodeMass: 8.5,              // 单个柱顶节点当量质量 (t)
  damping: 3.4,               // 正常阻尼 1/s
  searchDamping: 7.0,         // 临界载荷搜索时的强阻尼（准静态）
  substeps: 4,
  presetMargin: 1.02,         // 临界预设 = 1.02·F*：紧贴首柱塌陷临界点，缓动加载下可靠触发
  presetPulseFrac: 0.004,     // 预设附加的微小扰动（模拟砂粒剥落），占目标载荷比例
  maxCrushFrac: 0.42,         // 塌陷后柱高最多损失 42%（局部压碎保留残高，而非压成饼）

  // 弯曲（初偏心 / 压屈）
  ecc: [0.055, -0.040, 0.048, -0.060],
  bowAngles: [0.7, 2.3, 3.9, 5.5],
  crumpleU: [0.42, 0.55, 0.36, 0.60],   // 各柱局部塌陷带的高度位置

  // 外观
  sandBase: [0.784, 0.635, 0.412],
};

const NCOL = 4;
const tmpV1 = new pc.Vec3();

/* ============================================================
 * 1. PlayCanvas 基础场景
 * ============================================================ */
const appContainer = document.getElementById('app');
// pc.Application 必须接收真正的 <canvas>（#app 是 div 容器）
const canvasEl = document.createElement('canvas');
canvasEl.id = 'pc-canvas';
appContainer.appendChild(canvasEl);
// 输入设备：仅用引擎 Mouse（拾取/轨道）。触摸改用原生 DOM 事件，
// 绕开部分浏览器（含无头环境）合成 Touch 事件 target 缺失导致引擎包装器崩溃的问题。
const app = new pc.Application(canvasEl, { mouse: new pc.Mouse(canvasEl) });
app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
app.setCanvasResolution(pc.RESOLUTION_AUTO);
window.addEventListener('resize', () => app.resizeCanvas());

const scene = app.scene;
scene.ambientLight = new pc.Color(0.55, 0.50, 0.43);
// 1.73 版本雾由 scene 的 fog 字符串 + fogColor/fogStart/fogEnd 属性控制（无 Fog 类）
scene.fog = pc.FOG_LINEAR;
scene.fogColor = new pc.Color(0.80, 0.73, 0.62);
scene.fogStart = 16;
scene.fogEnd = 42;

/* ---- 相机 ---- */
const cam = new pc.Entity('camera');
cam.addComponent('camera', {
  fov: 52,
  nearFar: [0.1, 120],
  clearColor: new pc.Color(0.80, 0.73, 0.62),
});
app.root.addChild(cam);
const orbit = { yaw: -0.65, pitch: 0.34, dist: 8.6, tx: 0, ty: 1.75, tz: 0 };
let camPreview = null; // 电影式绕塔预演状态

/* ---- 灯光 ---- */
const sun = new pc.Entity('sun');
sun.addComponent('light', {
  type: 'directional',
  color: new pc.Color(1.0, 0.93, 0.80),
  intensity: 1.35,
  castShadow: true,
  shadowBias: 0.18,
  normalOffsetBias: 0.04,
  shadowDistance: 26,
});
sun.setLocalEulerAngles(42, -38, 0);
app.root.addChild(sun);

const hemi = new pc.Entity('hemi');
hemi.addComponent('light', { type: 'omni', color: new pc.Color(0.7, 0.75, 0.9), intensity: 0.35, range: 30 });
hemi.setLocalPosition(0, 8, 0);
app.root.addChild(hemi);

/* ============================================================
 * 2. 程序化材质：粗颗粒沙 / 木材 / 石材
 * ============================================================ */
function makeSandCanvas(size, bump) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  if (bump) {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, size, size);
  } else {
    g.fillStyle = '#c8a268';
    g.fillRect(0, 0, size, size);
  }
  // 细噪点底
  for (let i = 0; i < size * size / 3; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const v = Math.random();
    if (bump) {
      const sh = 90 + Math.floor(v * 130);
      g.fillStyle = `rgb(${sh},${sh},${sh})`;
    } else {
      const r = 178 + Math.floor(v * 60);
      const gg = 138 + Math.floor(v * 48);
      const b = 84 + Math.floor(v * 36);
      g.fillStyle = `rgba(${r},${gg},${b},0.55)`;
    }
    g.fillRect(x, y, 1.4, 1.4);
  }
  // 粗颗粒：大小不一的砂粒
  for (let i = 0; i < 1500; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const rad = 0.8 + Math.random() * 2.1;
    if (bump) {
      const sh = Math.random() > 0.5 ? 205 : 55;
      g.fillStyle = `rgb(${sh},${sh},${sh})`;
    } else {
      const warm = Math.random();
      const r = 150 + Math.floor(warm * 80);
      const gg = 112 + Math.floor(warm * 62);
      const b = 66 + Math.floor(warm * 40);
      g.fillStyle = `rgb(${r},${gg},${b})`;
    }
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  // 少量深色矿物斑点
  if (!bump) {
    for (let i = 0; i < 220; i++) {
      g.fillStyle = `rgba(86,60,36,${0.25 + Math.random() * 0.35})`;
      g.beginPath();
      g.arc(Math.random() * size, Math.random() * size, 0.7 + Math.random() * 1.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  return c;
}

function makeWoodCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#7a5230';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const y = Math.random() * size;
    g.strokeStyle = `rgba(${90 + Math.random() * 50},${58 + Math.random() * 34},${28 + Math.random() * 20},0.55)`;
    g.lineWidth = 1 + Math.random() * 2.5;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= size; x += 16) {
      g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3 + (Math.random() - 0.5) * 2);
    }
    g.stroke();
  }
  return c;
}

function textureFromCanvas(canvas, srgb) {
  const tex = new pc.Texture(app.graphicsDevice, {
    width: canvas.width,
    height: canvas.height,
    mipmaps: true,
    srgb: srgb,          // 颜色贴图走 sRGB，凹凸贴图保持线性
  });
  tex.setSource(canvas);
  tex.addressU = tex.addressV = pc.ADDRESS_REPEAT;
  return tex;
}
// 该引擎版本平铺在材质的 *MapTiling 上（纹理本身无 repeat）
function setTiling(material, u, v) {
  if (material.diffuseMapTiling && material.diffuseMapTiling.set) {
    material.diffuseMapTiling.set(u, v);
  }
  if (material.emissiveMapTiling && material.emissiveMapTiling.set) {
    material.emissiveMapTiling.set(u, v);
  }
}

const sandDiffuse = textureFromCanvas(makeSandCanvas(256, false), true);
const sandNormal = textureFromCanvas(makeSandCanvas(256, true), false);
const woodTex = textureFromCanvas(makeWoodCanvas(256), true);

function makeSandMaterial() {
  const m = new pc.StandardMaterial();
  m.diffuseMap = sandDiffuse;
  m.normalMap = sandNormal;        // 该版本用 normalMap + bumpiness（非 bumpMap）
  m.bumpiness = 0.9;
  m.diffuse.set(1, 1, 1);
  m.roughness = 0.97;
  m.metalness = 0.0;
  m.emissive.set(0, 0, 0);
  setTiling(m, 3, 3);
  m.update();
  return m;
}
const beamMat = new pc.StandardMaterial();
beamMat.diffuseMap = woodTex;
beamMat.diffuse.set(1, 1, 1);
beamMat.roughness = 0.82;
beamMat.metalness = 0;
setTiling(beamMat, 2, 2);
beamMat.update();

const stoneMat = new pc.StandardMaterial();
stoneMat.diffuse.set(0.60, 0.62, 0.65);
stoneMat.roughness = 0.9;
stoneMat.metalness = 0;
stoneMat.update();

const grainMat = new pc.StandardMaterial();
grainMat.diffuseMap = sandDiffuse;
grainMat.diffuse.set(1.05, 0.98, 0.85);
grainMat.roughness = 1;
grainMat.update();

/* ============================================================
 * 3. 地面
 * ============================================================ */
const groundTex = textureFromCanvas(makeSandCanvas(256, false), true);
const groundMat = new pc.StandardMaterial();
groundMat.diffuseMap = groundTex;
groundMat.normalMap = sandNormal;
groundMat.bumpiness = 0.7;
groundMat.roughness = 1;
setTiling(groundMat, 18, 18);
groundMat.update();
const ground = new pc.Entity('ground');
ground.addComponent('render', { type: 'plane', material: groundMat });
ground.setLocalScale(4.2, 1, 4.2); //  primitive 默认 10m → 42m
ground.render.receiveShadow = true;
app.root.addChild(ground);

/* ============================================================
 * 4. 沙柱数据结构 + 连续自定义网格（无分段缝隙）
 * ============================================================ */
const s = CFG.columnSpread;
const colPositions = [
  new pc.Vec3(-s, 0, -s),
  new pc.Vec3( s, 0, -s),
  new pc.Vec3( s, 0,  s),
  new pc.Vec3(-s, 0,  s),
];
const colNames = ['C1', 'C2', 'C3', 'C4'];

// 网格分辨率：nRing 个高度环（含两端），nRad 个径向分段
const nRing = 26, nRad = 20;

/* 生成圆柱初始拓扑（位置/UV/索引只建一次，每帧仅更新顶点与法线） */
function buildCylinderTopology() {
  const vcount = nRing * nRad + 2;           // 环顶点 + 顶/底盖中心
  const uvs = new Float32Array(vcount * 2);
  const indices = [];
  for (let j = 0; j < nRing; j++) {
    for (let i = 0; i < nRad; i++) {
      const vi = j * nRad + i;
      uvs[vi * 2] = i / nRad * 4;
      uvs[vi * 2 + 1] = j / (nRing - 1) * 6;
    }
  }
  // 侧面
  for (let j = 0; j < nRing - 1; j++) {
    for (let i = 0; i < nRad; i++) {
      const a = j * nRad + i;
      const b = j * nRad + (i + 1) % nRad;
      const c = (j + 1) * nRad + i;
      const d = (j + 1) * nRad + (i + 1) % nRad;
      indices.push(a, c, b, b, c, d);
    }
  }
  // 顶盖 / 底盖（中心扇形，复用环上顶点）
  const topCenter = nRing * nRad;
  uvs[topCenter * 2] = 0.5; uvs[topCenter * 2 + 1] = 0.5;
  for (let i = 0; i < nRad; i++) {
    const a = (nRing - 1) * nRad + i;
    const b = (nRing - 1) * nRad + (i + 1) % nRad;
    indices.push(topCenter, b, a);
  }
  const botCenter = topCenter + 1;
  uvs[botCenter * 2] = 0.5; uvs[botCenter * 2 + 1] = 0.5;
  for (let i = 0; i < nRad; i++) {
    const a = i;
    const b = (i + 1) % nRad;
    indices.push(botCenter, a, b);
  }
  return { uvs, indices, topCenter, botCenter, vcount };
}

const columns = colPositions.map((base, i) => {
  const dyPeak = CFG.columnNu[i] / CFG.columnK[i];
  const col = {
    idx: i,
    name: colNames[i],
    base,
    k0: CFG.columnK[i],
    Nu: CFG.columnNu[i],
    dyPeak,
    dyCollapse: dyPeak + CFG.softBand * CFG.collapseBand,
    residual: CFG.columnNu[i] * CFG.residualFrac,
    ecc: CFG.ecc[i],
    bowDir: new pc.Vec3(Math.cos(CFG.bowAngles[i]), 0, Math.sin(CFG.bowAngles[i])),
    uCrump: CFG.crumpleU[i],
    // 仿真状态
    d: 0, v: 0,                 // 柱顶压缩位移 / 速度 (m, m/s)
    fCol: 0, fBeam: 0,          // 当前柱轴力 / 横梁耦合合力 (kN，向下为正)
    state: 'elastic',           // elastic | yielding | collapsed
    crumple: 0,                 // 局部塌陷发育程度 0..1
    collapseAt: -1,
    // 渲染
    material: makeSandMaterial(),
    mesh: null,
    meshPos: null,
    meshNorm: null,
    label: null,
    ring: null,
  };
  const topo = buildCylinderTopology();
  // 位置/法线缓冲（盖中心位置每帧写）
  col.meshPos = new Float32Array(topo.vcount * 3);
  col.meshNorm = new Float32Array(topo.vcount * 3);
  const mesh = new pc.Mesh(app.graphicsDevice);
  mesh.setPositions(col.meshPos);
  mesh.setUvs(0, topo.uvs);
  mesh.setNormals(col.meshNorm);
  mesh.setIndices(topo.indices);
  mesh.update();
  col.mesh = mesh;
  col.topo = topo;

  const entity = new pc.Entity(`col_${colNames[i]}`);
  entity.addComponent('render', {
    meshInstances: [new pc.MeshInstance(mesh, col.material)],
  });
  entity.render.castShadow = true;
  entity.render.receiveShadow = true;
  app.root.addChild(entity);
  col.entity = entity;
  return col;
});

/* 柱位编号牌（画布贴图 + 双面无光照） */
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(28,22,15,0.85)';
  if (g.roundRect) {
    g.beginPath(); g.roundRect(8, 14, 112, 68, 14); g.fill();
    g.strokeStyle = '#e8a33d'; g.lineWidth = 4;
    g.beginPath(); g.roundRect(8, 14, 112, 68, 14); g.stroke();
  } else {
    g.fillRect(8, 14, 112, 68);
    g.strokeStyle = '#e8a33d'; g.lineWidth = 4;
    g.strokeRect(8, 14, 112, 68);
  }
  g.fillStyle = '#f3e2c2';
  g.font = 'bold 44px Segoe UI, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 64, 50);
  const tex = new pc.Texture(app.graphicsDevice, { width: 128, height: 96, mipmaps: false, srgb: true });
  tex.setSource(c);
  const mat = new pc.BasicMaterial();
  mat.colorMap = tex;
  mat.cull = pc.CULLFACE_NONE;
  mat.update();
  const e = new pc.Entity(`label_${text}`);
  e.addComponent('render', { type: 'plane', material: mat });
  e.setLocalScale(0.42, 0.32, 1);
  app.root.addChild(e);
  return e;
}
columns.forEach((col) => {
  col.label = makeLabel(col.name);
  const outward = new pc.Vec3(col.base.x, 0, col.base.z).normalize();
  col.labelPos = new pc.Vec3(col.base.x + outward.x * 0.46, 0.42, col.base.z + outward.z * 0.46);
});

/* 选中高亮环 */
const ringMat = new pc.BasicMaterial();
ringMat.color.set(1.0, 0.72, 0.22);
ringMat.update();
columns.forEach((col) => {
  const ring = new pc.Entity(`ring_${col.name}`);
  ring.addComponent('render', { type: 'torus', material: ringMat });
  ring.setLocalScale(0.72, 0.72, 0.72);
  ring.setLocalPosition(col.base.x, 0.04, col.base.z);
  ring.enabled = false;
  app.root.addChild(ring);
  col.ring = ring;
});

/* ============================================================
 * 5. 横梁框架（4 边梁 + 2 对角梁，材质明显区别于沙柱）
 * ============================================================ */
const beamPairs = [[0,1],[1,2],[2,3],[3,0],[0,2],[1,3]];
const beams = beamPairs.map(([a, b]) => {
  const e = new pc.Entity(`beam_${colNames[a]}_${colNames[b]}`);
  e.addComponent('render', { type: 'box', material: beamMat });
  e.render.castShadow = true;
  app.root.addChild(e);
  return { a, b, entity: e, force: 0, diag: a + b === 2 || a + b === 4 };
});

/* ============================================================
 * 6. 承压石板 + 载荷指示箭头
 * ============================================================ */
const slab = new pc.Entity('slab');
slab.addComponent('render', { type: 'box', material: stoneMat });
slab.render.castShadow = true;
slab.render.receiveShadow = true;
app.root.addChild(slab);

const arrowMat = new pc.StandardMaterial();
arrowMat.diffuse.set(0.85, 0.28, 0.16);
arrowMat.emissive.set(0.85, 0.22, 0.10);
arrowMat.emissiveIntensity = 0.9;
arrowMat.roughness = 0.6;
arrowMat.update();
const loadArrow = new pc.Entity('loadArrow');
loadArrow.addComponent('render', { type: 'cone', material: arrowMat });
app.root.addChild(loadArrow);

/* ============================================================
 * 7. 砂粒粒子池（塌陷时崩落）
 * ============================================================ */
const POOL = 420;
const grainPool = [];
for (let i = 0; i < POOL; i++) {
  const e = new pc.Entity(`grain_${i}`);
  e.addComponent('render', { type: 'sphere', material: grainMat });
  e.enabled = false;
  app.root.addChild(e);
  grainPool.push({
    entity: e, active: false,
    pos: new pc.Vec3(), vel: new pc.Vec3(),
    life: 0, maxLife: 1, rad: 0.03,
  });
}
function spawnGrain(pos, power) {
  const g = grainPool.find(q => !q.active);
  if (!g) return;
  g.active = true;
  g.entity.enabled = true;
  g.pos.copy(pos);
  g.rad = 0.022 + Math.random() * 0.035;
  g.vel.set(
    (Math.random() - 0.5) * power,
    0.6 + Math.random() * power * 0.9,
    (Math.random() - 0.5) * power
  );
  g.life = 0;
  g.maxLife = 1.6 + Math.random() * 1.4;
  g.entity.setLocalScale(g.rad, g.rad, g.rad);
}
function updateGrains(dt) {
  for (const g of grainPool) {
    if (!g.active) continue;
    g.life += dt;
    g.vel.y -= 9.8 * dt;
    g.vel.mulScalar(1 - 0.6 * dt);
    g.pos.addScaled(g.vel, dt);
    if (g.pos.y < g.rad) {
      g.pos.y = g.rad;
      g.vel.y *= -0.25;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    if (g.life > g.maxLife) {
      g.active = false;
      g.entity.enabled = false;
      continue;
    }
    g.entity.setPosition(g.pos);
  }
}

/* ============================================================
 * 8. 仿真核心
 * ============================================================ */
let simTime = 0;
let simLive = true;          // false = 临界载荷离线搜索中
let loadTarget = 0, loadCurrent = 0, loadPulse = 0;
let Fstar = 0;               // 首柱塌陷临界载荷（准静态搜索）
let presetLoad = 0;          // 临界预设目标载荷 = presetMargin · F*

/* 沙柱非线性轴力（向上承载，kN），位移 d 向下为正 */
function columnForce(col, d) {
  if (d <= col.dyPeak) {
    return col.k0 * d;                          // 线弹性
  }
  const t = Math.min(1, (d - col.dyPeak) / CFG.softBand);
  const soft = col.Nu * (1 - (1 - CFG.residualFrac) * t);
  if (d <= col.dyCollapse || col.state === 'collapsed') {
    if (col.state === 'collapsed') {
      // 塌陷后残余摩擦继续缓慢衰减
      const extra = Math.max(0, d - col.dyCollapse);
      return Math.max(col.Nu * 0.12, col.residual * Math.exp(-extra / 0.14));
    }
    return soft;
  }
  return soft;
}

function resetSim() {
  for (const col of columns) {
    col.d = 0; col.v = 0; col.fCol = 0; col.fBeam = 0;
    col.state = 'elastic';
    col.crumple = 0;
    col.collapseAt = -1;
  }
  for (const g of grainPool) { g.active = false; g.entity.enabled = false; }
  simTime = 0;
  loadTarget = 0; loadCurrent = 0; loadPulse = 0;
  if (simLive) {
    document.getElementById('loadSlider').value = 0;
    logLine('沙塔已复位，所有柱体恢复初始状态。');
  }
}

/* 单步积分（半隐式欧拉）。L = 当前总外载 kN */
function simStep(dt, L, damping) {
  const h = dt / CFG.substeps;
  for (let n = 0; n < CFG.substeps; n++) {
    // 横梁耦合合力（节点 i 受到的竖向力，向下为正）
    for (const col of columns) col.fBeam = 0;
    for (const beam of beams) {
      const A = columns[beam.a], B = columns[beam.b];
      const f = CFG.beamK * (A.d - B.d);   // 弹簧伸长对应力
      A.fBeam -= f;                        // A 下沉多 → f>0 → A 受向上托举
      B.fBeam += f;                        // B 受到额外下压
      beam.force = f;
    }
    for (const col of columns) {
      col.fCol = columnForce(col, col.d);
      const fExt = L / NCOL;                       // 石板均布外载
      const fDown = fExt + col.fBeam;              // 外载 + 横梁转嫁
      const fNet = fDown - col.fCol;               // 向下合力
      const acc = fNet / CFG.nodeMass;
      col.v += acc * h;
      col.v *= Math.exp(-damping * h);
      col.d = Math.max(0, col.d + col.v * h);
      // 塌陷后限制最大压缩量，保留残高（局部压碎的沙柱不会无限塌缩）
      const dMax = col.state === 'collapsed' ? CFG.H0 * CFG.maxCrushFrac : Infinity;
      if (col.d > dMax) { col.d = dMax; if (col.v > 0) col.v = 0; }

      // 状态判定
      if (col.state !== 'collapsed') {
        if (col.d >= col.dyCollapse) {
          col.state = 'collapsed';
          col.collapseAt = simTime;
          if (simLive) onCollapse(col);
        } else if (col.d >= col.dyPeak * 0.92) {
          if (col.state === 'elastic' && simLive) onYield(col);
          col.state = 'yielding';
        } else {
          col.state = 'elastic';
        }
      }
    }
  }
  // 塌陷带发育（可视化用）
  for (const col of columns) {
    if (col.state === 'collapsed') col.crumple = Math.min(1, col.crumple + dt * 1.4);
  }
  if (simLive) simTime += dt;
}

/* 准静态爬升搜索首柱塌陷临界载荷 F* */
function findCriticalLoad() {
  simLive = false;
  for (const col of columns) { col.d = 0; col.v = 0; col.state = 'elastic'; col.crumple = 0; col.fBeam = 0; }
  const dL = 0.15;
  let L = 0, lastSafe = 0;
  while (L < 120) {
    L += dL;
    for (let k = 0; k < 600; k++) simStep(1 / 120, L, CFG.searchDamping);
    if (columns.some(c => c.state === 'collapsed')) break;
    lastSafe = L;
  }
  for (const col of columns) { col.d = 0; col.v = 0; col.state = 'elastic'; col.crumple = 0; col.fBeam = 0; }
  simLive = true;
  return lastSafe;
}

/* ---------------- 事件回调 ---------------- */
function onYield(col) {
  logLine(`<b>${col.name}</b> 达到屈服点，进入塑性变形（N≈${col.Nu.toFixed(1)} kN）`, 'warn');
}
function onCollapse(col) {
  // 崩落砂粒
  const H = CFG.H0 - col.d;
  for (let k = 0; k < 46; k++) {
    const ang = Math.random() * Math.PI * 2;
    const rr = Math.random() * CFG.r0;
    const pos = new pc.Vec3(
      col.base.x + Math.cos(ang) * rr,
      H * col.uCrump + (Math.random() - 0.5) * 0.3,
      col.base.z + Math.sin(ang) * rr
    );
    spawnGrain(pos, 2.6);
  }
  // 邻柱受荷增量（横梁此刻转嫁的力）
  const neighbors = [];
  for (const beam of beams) {
    if (beam.a === col.idx || beam.b === col.idx) {
      const other = columns[beam.a === col.idx ? beam.b : beam.a];
      neighbors.push({ name: other.name, add: beam.force });
    }
  }
  const detail = neighbors
    .sort((a, b) => b.add - a.add)
    .map(n => `<b>${n.name}</b> +${Math.max(0, n.add).toFixed(1)}kN`)
    .join('，');
  logLine(`<b>${col.name}</b> 局部塌陷！承载力跌落，重量经横梁转嫁：${detail}`, 'danger');
  showToast(`${col.name} 局部塌陷 — 连锁传力启动`);
}

/* ============================================================
 * 9. 视觉更新：柱体压短变粗 / 弯曲 / 局部塌陷
 * ============================================================ */
function gauss(u, c, w) {
  const z = (u - c) / w;
  return Math.exp(-z * z);
}
const _q = new pc.Quat(), _qr = new pc.Quat(), _y = new pc.Vec3(), _x = new pc.Vec3(), _z = new pc.Vec3();
/* 由正交基 (x,y,z) 直接构造四元数（旋转矩阵 trace 法），避免依赖该版本 Mat4 的数据接口 */
function quatFromBasis(x, y, z) {
  const m00 = x.x, m01 = x.y, m02 = x.z;
  const m10 = y.x, m11 = y.y, m12 = y.z;
  const m20 = z.x, m21 = z.y, m22 = z.z;
  const tr = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1.0) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1.0 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1.0 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1.0 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return _q.set(qx, qy, qz, qw).normalize();
}
function orientAlong(entity, mid, dir, extraRoll) {
  const y = _y.copy(dir).normalize();
  const ref = Math.abs(y.y) > 0.92 ? tmpV1.set(1, 0, 0) : tmpV1.set(0, 1, 0);
  const x = _x.cross(ref, y).normalize();
  const z = _z.cross(x, y).normalize();
  const q = quatFromBasis(x, y, z);
  if (extraRoll) {
    _qr.setFromAxisAngle(y, extraRoll);
    q.mul(_qr);
  }
  entity.setPosition(mid);
  entity.setRotation(q);
}

/* 柱中心线偏移（弯曲 + 塌陷折曲），u∈[0,1]，端点钉在柱基/柱顶。返回 {x,z} */
function centerlineXYZ(col, u, H) {
  const util = Math.min(1.15, col.fCol / col.Nu);
  const strain = col.d / CFG.H0;
  // 压屈弯曲：随承压比快速增长的半正弦挠曲
  const bowAmp = col.ecc * (0.25 + 2.6 * Math.pow(Math.max(0, util), 2.1)) * (1 + strain * 1.5);
  const bow = bowAmp * Math.sin(Math.PI * u);
  // 塌陷局部折曲（方向与弯曲垂直，形成明显的剪切带）
  const kink = 0.30 * col.crumple * gauss(u, col.uCrump, 0.10);
  const px = col.bowDir.x * bow - col.bowDir.z * kink;
  const pz = col.bowDir.z * bow + col.bowDir.x * kink;
  return { x: col.base.x + px, z: col.base.z + pz };
}

/* 每帧重建沙柱连续网格：顶点位移 + 解析法线，表现压短变粗/弯曲/塌陷带 */
function updateColumnMesh(col) {
  const H = CFG.H0 - col.d;
  const strain = col.d / CFG.H0;
  const bulge = 1 + CFG.poisson * strain;                 // 压短变粗
  const pos = col.meshPos, nrm = col.meshNorm;
  const bx = col.base.x, bz = col.base.z;

  // 高度方向的压缩重映射：塌陷带附近的环被向下挤压（局部轴向压缩）
  function heightMap(u) {
    const squeeze = 0.5 * col.crumple * gauss(u, col.uCrump, 0.12);
    return u * (1 - squeeze);
  }

  for (let j = 0; j < nRing; j++) {
    const u = j / (nRing - 1);
    const y = H * heightMap(u);
    const c = centerlineXYZ(col, u, H);
    // 局部粗化：塌陷带砂粒堆胀
    const localBulge = 1 + 0.7 * col.crumple * gauss(u, col.uCrump, 0.11);
    const r = CFG.r0 * bulge * localBulge;
    for (let i = 0; i < nRad; i++) {
      const a = (i / nRad) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const vi = j * nRad + i;
      pos[vi * 3]     = c.x + r * ca;
      pos[vi * 3 + 1] = y;
      pos[vi * 3 + 2] = c.z + r * sa;
    }
  }
  // 盖中心
  const topC = col.topo.topCenter, botC = col.topo.botCenter;
  const cTop = centerlineXYZ(col, 1, H), cBot = centerlineXYZ(col, 0, H);
  pos[topC * 3] = cTop.x; pos[topC * 3 + 1] = H; pos[topC * 3 + 2] = cTop.z;
  pos[botC * 3] = cBot.x; pos[botC * 3 + 1] = 0; pos[botC * 3 + 2] = cBot.z;

  // ---- 解析法线：由相邻环/相邻角的切线叉积得到平滑侧面法线 ----
  for (let j = 0; j < nRing; j++) {
    const jUp = Math.min(nRing - 1, j + 1), jDn = Math.max(0, j - 1);
    for (let i = 0; i < nRad; i++) {
      const iN = (i + 1) % nRad, iP = (i - 1 + nRad) % nRad;
      const v0 = j * nRad + i;
      const va = j * nRad + iN, vb = j * nRad + iP;
      const vu = jUp * nRad + i, vd = jDn * nRad + i;
      // 切向（环绕方向）
      const tx = pos[va * 3] - pos[vb * 3], ty = pos[va * 3 + 1] - pos[vb * 3 + 1], tz = pos[va * 3 + 2] - pos[vb * 3 + 2];
      // 纵向（高度方向）
      const sx = pos[vu * 3] - pos[vd * 3], sy = pos[vu * 3 + 1] - pos[vd * 3 + 1], sz = pos[vu * 3 + 2] - pos[vd * 3 + 2];
      // 法线 = 纵向 × 切向（朝外）
      let nx = sy * tz - sz * ty;
      let ny = sz * tx - sx * tz;
      let nz = sx * ty - sy * tx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nrm[v0 * 3] = nx / nl; nrm[v0 * 3 + 1] = ny / nl; nrm[v0 * 3 + 2] = nz / nl;
    }
  }
  // 盖中心法线
  nrm[topC * 3] = 0; nrm[topC * 3 + 1] = 1; nrm[topC * 3 + 2] = 0;
  nrm[botC * 3] = 0; nrm[botC * 3 + 1] = -1; nrm[botC * 3 + 2] = 0;

  col.mesh.setPositions(pos);
  col.mesh.setNormals(nrm);
  col.mesh.update();

  // 材质随状态变化（沙色 → 暗黄 → 灰裂）
  const m = col.material;
  const sel = selected === col;
  if (col.state === 'collapsed') {
    m.diffuse.set(0.62, 0.52, 0.42);
    m.emissive.set(sel ? 0.35 : 0.10, sel ? 0.16 : 0.04, 0.02);
  } else if (col.state === 'yielding') {
    m.diffuse.set(0.95, 0.78, 0.50);
    m.emissive.set(sel ? 0.30 : 0.12, sel ? 0.16 : 0.06, 0.02);
  } else {
    m.diffuse.set(1, 1, 1);
    m.emissive.set(sel ? 0.28 : 0, sel ? 0.18 : 0, sel ? 0.08 : 0);
  }
  m.emissiveIntensity = 1;
  m.update();

  // 编号牌跟随 + 朝向相机
  col.label.setPosition(col.labelPos);
  col.label.lookAt(cam.getPosition());
  col.ring.enabled = sel;
}

const _bA = new pc.Vec3(), _bB = new pc.Vec3(), _bDir = new pc.Vec3(), _bMid = new pc.Vec3();
function updateBeams() {
  for (const beam of beams) {
    const A = columns[beam.a], B = columns[beam.b];
    const pA = _bA.set(A.base.x, CFG.H0 - A.d, A.base.z);
    const pB = _bB.set(B.base.x, CFG.H0 - B.d, B.base.z);
    const dir = _bDir.copy(pB).sub(pA);
    const len = dir.length();
    const mid = _bMid.copy(pA).add(pB).mulScalar(0.5);
    orientAlong(beam.entity, mid, dir, 0);
    const t = beam.diag ? 0.13 : 0.17;
    beam.entity.setLocalScale(t, t, len); // 单位 box 边长 1
    // 横梁受力越大越偏红（直观显示传力路径）
    const stress = Math.min(1, Math.abs(beam.force) / 6);
    const m = beamMat;
    m.emissive.set(0.25 * stress, 0.08 * stress, 0.02);
    m.emissiveIntensity = 1;
  }
  beamMat.update();
}

function updateSlabAndArrow() {
  const avg = new pc.Vec3();
  for (const c of columns) avg.x += c.base.x, avg.y += CFG.H0 - c.d, avg.z += c.base.z;
  avg.mulScalar(1 / NCOL);
  slab.setLocalPosition(avg.x, avg.y + CFG.slabThick / 2, avg.z);
  // 由四角高差求石板倾角（沿 z 向高差 → 绕 x 轴；沿 x 向高差 → 绕 z 轴）
  const [p0, p1, p2, p3] = columns.map(c => CFG.H0 - c.d);
  const dzY = ((p2 + p3) - (p0 + p1)) / 2;   // z+ 边与 z− 边的高差
  const dxY = ((p1 + p2) - (p0 + p3)) / 2;   // x+ 边与 x− 边的高差
  const span = CFG.columnSpread * 2;
  const rx = Math.atan2(dzY, span);
  const rz = Math.atan2(dxY, span);
  slab.setLocalEulerAngles(-rx * 0.9, 0, rz * 0.9);

  // 载荷箭头：cone 基元尖端朝上，绕 Z 转 180° 使尖端向下（指向塔顶）
  const frac = Fstar > 0 ? loadCurrent / (Fstar * 1.45) : 0;
  loadArrow.setLocalPosition(0, avg.y + CFG.slabThick + 0.75 + frac * 0.5, 0);
  loadArrow.setLocalEulerAngles(0, 0, 180);
  loadArrow.setLocalScale(0.34, 0.5 + frac * 1.1, 0.34);
  arrowMat.emissive.set(0.85, 0.55 - frac * 0.4, 0.18 - frac * 0.12);
  arrowMat.emissiveIntensity = 0.7 + frac * 0.8;
  arrowMat.update();
}

/* ============================================================
 * 10. 轨道相机 + 绕塔电影预演
 * ============================================================ */
function applyCamera() {
  const cp = Math.cos(orbit.pitch), sp = Math.sin(orbit.pitch);
  cam.setPosition(
    orbit.tx + orbit.dist * cp * Math.sin(orbit.yaw),
    orbit.ty + orbit.dist * sp,
    orbit.tz + orbit.dist * cp * Math.cos(orbit.yaw)
  );
  cam.lookAt(orbit.tx, orbit.ty, orbit.tz);
}
function startPreview() {
  camPreview = { t: 0, dur: 18, yaw0: orbit.yaw, pitch0: orbit.pitch, dist0: orbit.dist };
  showToast('镜头绕塔预演开始（拖动鼠标可随时退出）');
}
function updateCamera(dt) {
  if (camPreview) {
    camPreview.t += dt;
    const k = Math.min(1, camPreview.t / camPreview.dur);
    const ease = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    orbit.yaw = camPreview.yaw0 + ease * Math.PI * 4;      // 两整圈
    orbit.pitch = camPreview.pitch0 + 0.22 * Math.sin(Math.PI * k);
    orbit.dist = camPreview.dist0 - 0.9 * Math.sin(Math.PI * k);
    if (k >= 1) { camPreview = null; showToast('镜头预演结束'); }
  }
  applyCamera();
}

/* 鼠标 / 触摸轨道控制 */
let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0;
app.mouse.on('mousedown', (e) => {
  dragging = true; lastX = downX = e.x; lastY = downY = e.y; downT = performance.now();
  camPreview = null;
});
app.mouse.on('mousemove', (e) => {
  if (!dragging) return;
  orbit.yaw -= (e.x - lastX) * 0.006;
  orbit.pitch = pc.math.clamp(orbit.pitch + (e.y - lastY) * 0.006, -0.15, 1.25);
  lastX = e.x; lastY = e.y;
});
app.mouse.on('mouseup', (e) => {
  dragging = false;
  const moved = Math.hypot(e.x - downX, e.y - downY);
  if (moved < 6 && performance.now() - downT < 450) pickColumn(e.x, e.y);
});
app.mouse.on('mousewheel', (e) => {
  orbit.dist = pc.math.clamp(orbit.dist + e.event.deltaY * 0.01, 3.2, 16);
  camPreview = null;
});
/* 触摸（原生 DOM 实现，不依赖 pc.Touch）：单指旋转，双指捏合，轻点拾取 */
let pinchDist = 0;
function touchPoint(touch) {
  const rect = canvasEl.getBoundingClientRect();
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}
canvasEl.addEventListener('touchstart', (ev) => {
  camPreview = null;
  if (ev.touches.length === 1) {
    const p = touchPoint(ev.touches[0]);
    dragging = true; lastX = downX = p.x; lastY = downY = p.y; downT = performance.now();
  } else if (ev.touches.length === 2) {
    dragging = false;
    const a = touchPoint(ev.touches[0]), b = touchPoint(ev.touches[1]);
    pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
  }
}, { passive: true });
canvasEl.addEventListener('touchmove', (ev) => {
  if (ev.cancelable) ev.preventDefault();
  if (ev.touches.length === 1 && dragging) {
    const p = touchPoint(ev.touches[0]);
    orbit.yaw -= (p.x - lastX) * 0.007;
    orbit.pitch = pc.math.clamp(orbit.pitch + (p.y - lastY) * 0.007, -0.15, 1.25);
    lastX = p.x; lastY = p.y;
  } else if (ev.touches.length === 2) {
    const a = touchPoint(ev.touches[0]), b = touchPoint(ev.touches[1]);
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) orbit.dist = pc.math.clamp(orbit.dist * (pinchDist / d), 3.2, 16);
    pinchDist = d;
  }
}, { passive: false });
canvasEl.addEventListener('touchend', (ev) => {
  if (ev.touches.length === 0 && dragging) {
    dragging = false;
    const t = touchPoint(ev.changedTouches[0]);
    if (Math.hypot(t.x - downX, t.y - downY) < 12 && performance.now() - downT < 450) {
      pickColumn(t.x, t.y);
    }
  }
}, { passive: true });

/* 射线拾取：与柱当前外接圆柱求交（XZ 平面距离判定） */
function pickColumn(sx, sy) {
  const near = cam.camera.screenToWorld(sx, sy, cam.camera.nearClip, new pc.Vec3());
  const far = cam.camera.screenToWorld(sx, sy, cam.camera.farClip, new pc.Vec3());
  const o = near, d = far.sub(near).normalize();
  let best = null, bestT = Infinity;
  for (const col of columns) {
    const topY = CFG.H0 - col.d;
    const ox = o.x - col.base.x, oz = o.z - col.base.z;
    const a = d.x * d.x + d.z * d.z;
    if (a < 1e-6) continue;
    const b = 2 * (ox * d.x + oz * d.z);
    const cc = ox * ox + oz * oz - CFG.r0 * CFG.r0 * 1.25;
    const disc = b * b - 4 * a * cc;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t < 0) continue;
    const y = o.y + d.y * t;
    if (y >= 0 && y <= topY && t < bestT) { bestT = t; best = col; }
  }
  selectColumn(selected === best ? null : best);
}

/* ============================================================
 * 11. UI 绑定
 * ============================================================ */
const $ = (id) => document.getElementById(id);
const slider = $('loadSlider');
let selected = null;

function showToast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2200);
}
function logLine(html, cls) {
  const body = $('logBody');
  const line = document.createElement('div');
  line.className = 'log-line' + (cls ? ' ' + cls : '');
  const mm = Math.floor(simTime / 60), ss = (simTime % 60).toFixed(1).padStart(4, '0');
  line.innerHTML = `<span class="t">${mm}:${ss}</span>${html}`;
  body.appendChild(line);
  while (body.children.length > 40) body.removeChild(body.firstChild);
  body.scrollTop = body.scrollHeight;
}

function selectColumn(col) {
  selected = col;
  $('telEmpty').hidden = !!col;
  $('telBody').hidden = !col;
  const chip = $('selChip');
  if (!col) {
    chip.textContent = '未选择';
    chip.className = 'state-chip elastic';
  } else {
    chip.textContent = col.name;
  }
  renderColumnList();
}

function stateChipClass(col) {
  return col.state === 'collapsed' ? 'collapsed' : col.state === 'yielding' ? 'yielding' : 'elastic';
}
function stateLabel(col) {
  return col.state === 'collapsed' ? '已塌陷' : col.state === 'yielding' ? '屈服中' : '弹性';
}

function renderColumnList() {
  const list = $('colList');
  list.innerHTML = '';
  for (const col of columns) {
    const row = document.createElement('div');
    row.className = 'col-row' + (selected === col ? ' sel' : '');
    const util = pc.math.clamp(col.fCol / col.Nu, 0, 1.05);
    const dotColor = col.state === 'collapsed' ? '#e05a3e' : col.state === 'yielding' ? '#e8c547' : '#8fc47a';
    row.innerHTML =
      `<span class="nm">${col.name}</span>
       <span class="st" style="background:${dotColor}"></span>
       <span class="mini"><span class="bar"><i style="width:${Math.min(100, util * 100).toFixed(0)}%"></i></span></span>
       <span style="width:52px;text-align:right;color:var(--muted)">${(util * 100).toFixed(0)}%</span>`;
    row.onclick = () => selectColumn(selected === col ? null : col);
    list.appendChild(row);
  }
}

function updateTelemetry() {
  // 全局
  $('stLoad').textContent = `${loadCurrent.toFixed(1)} kN`;
  const nCol = columns.filter(c => c.state === 'collapsed').length;
  $('stCollapsed').textContent = `${nCol} / ${NCOL}`;
  const dot = $('stateDot'), txt = $('stateText');
  if (nCol >= 3) { dot.className = 'state-dot danger'; txt.textContent = '结构失效'; }
  else if (nCol >= 1) { dot.className = 'state-dot danger'; txt.textContent = '塌陷蔓延中'; }
  else if (columns.some(c => c.state === 'yielding')) { dot.className = 'state-dot warn'; txt.textContent = '塑性屈服'; }
  else { dot.className = 'state-dot'; txt.textContent = '完好'; }
  $('loadVal').textContent = `${loadCurrent.toFixed(1)} kN`;

  if (selected) {
    const c = selected;
    const chip = $('selChip');
    chip.className = 'state-chip ' + stateChipClass(c);
    chip.textContent = `${c.name} · ${stateLabel(c)}`;
    const util = c.fCol / c.Nu;
    $('mForce').textContent = `${c.fCol.toFixed(2)} kN（极限 ${c.Nu.toFixed(1)}）`;
    $('mUtil').textContent = `${(util * 100).toFixed(1)} %`;
    $('mComp').textContent = `${(c.d * 100).toFixed(1)} cm / 极限 ${(c.dyCollapse * 100).toFixed(1)} cm`;
    const H = CFG.H0 - c.d;
    const utilB = Math.min(1.15, c.fCol / c.Nu);
    const bowAmp = Math.abs(c.ecc) * (0.25 + 2.6 * Math.pow(Math.max(0, utilB), 2.1));
    $('mBend').textContent = `${(bowAmp * 100).toFixed(1)} cm（压屈侧向挠度）`;
    $('mDisp').textContent = `下沉 ${(c.d * 100).toFixed(1)} cm · 应变 ${(c.d / CFG.H0 * 100).toFixed(2)}%`;
    const beamTxt = c.fBeam >= 0
      ? `传入 ${c.fBeam.toFixed(2)} kN（邻柱转嫁给它）`
      : `传出 ${Math.abs(c.fBeam).toFixed(2)} kN（由横梁托举卸给邻柱）`;
    $('mBeam').textContent = beamTxt;
    $('bForce').style.width = `${Math.min(100, util * 100)}%`;
    $('bUtil').style.width = `${Math.min(100, util * 100)}%`;
    $('bComp').style.width = `${Math.min(100, c.d / c.dyCollapse * 100)}%`;
    $('bBend').style.width = `${Math.min(100, bowAmp / 0.3 * 100)}%`;
  }
  renderColumnList();
}

/* 滑块：刻度映射 0..1000 → 0..maxLoad */
let maxLoad = 20;
function sliderToLoad(v) { return v / 1000 * maxLoad; }
function loadToSlider(L) { return Math.round(L / maxLoad * 1000); }
slider.addEventListener('input', () => {
  loadTarget = sliderToLoad(+slider.value);
  loadPulse = 0;
});

$('btnReset').onclick = () => { resetSim(); slider.value = 0; };
$('btnCrit').onclick = () => {
  // 临界预设：载荷卡在首柱塌陷临界点（1.02·F*），再给微小扰动模拟砂粒剥落触发失稳
  loadTarget = presetLoad;
  slider.value = loadToSlider(presetLoad);
  loadPulse = presetLoad * CFG.presetPulseFrac;
  showToast(`临界预设：载荷卡在 F* = ${Fstar.toFixed(1)} kN 临界边缘`);
  logLine(`一键加载临界预设（目标 <b>${presetLoad.toFixed(1)} kN</b> ≈ 1.02·F*），等待首柱失稳…`, 'warn');
};
let ramping = null;
$('btnRamp').onclick = () => {
  ramping = { from: loadCurrent, to: presetLoad, t: 0, dur: 9 };
  logLine('开始缓慢加压（准静态爬升至临界边缘）…');
};
$('btnOrbit').onclick = startPreview;
$('btnCamReset').onclick = () => {
  camPreview = null;
  orbit.yaw = -0.65; orbit.pitch = 0.34; orbit.dist = 8.6;
};
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'c' || e.key === 'C') $('btnCrit').click();
  if (e.key === 'r' || e.key === 'R') $('btnRamp').click();
  if (e.key === '0') $('btnReset').click();
  if (e.key === 'o' || e.key === 'O') startPreview();
});

/* ============================================================
 * 12. 启动 + 主循环
 * ============================================================ */
Fstar = findCriticalLoad();
presetLoad = Fstar * CFG.presetMargin;
maxLoad = Math.ceil(presetLoad * 1.42 * 2) / 2;
slider.max = 1000;
$('stCrit').textContent = `${Fstar.toFixed(1)} kN`;
// 滑块刻度：0 / 半临界 / 临界 F* / 满量程
const tickRow = $('tickRow');
[0, Fstar * 0.5, Fstar, maxLoad].forEach((L, i) => {
  const t = document.createElement('span');
  t.className = 'tick' + (i === 2 ? ' crit' : '');
  t.style.left = `${(L / maxLoad) * 100}%`;
  t.textContent = i === 2 ? `F* ${L.toFixed(1)}` : L.toFixed(1);
  tickRow.appendChild(t);
});
logLine(`临界载荷搜索完成：首柱塌陷临界 <b>F* = ${Fstar.toFixed(1)} kN</b>。`);
logLine('提示：点击柱体查看受力；按 C 一键加载临界预设，按 O 播放绕塔镜头。');

let uiAccum = 0;
app.on('update', (dtRaw) => {
  const dt = Math.min(dtRaw, 0.05);

  // 缓动加压（载荷增减平滑）
  if (ramping) {
    ramping.t += dt;
    const k = Math.min(1, ramping.t / ramping.dur);
    loadTarget = ramping.from + (ramping.to - ramping.from) * k;
    slider.value = loadToSlider(loadTarget);
    if (k >= 1) ramping = null;
  }
  loadCurrent += (loadTarget - loadCurrent) * Math.min(1, dt * 2.2);
  if (loadPulse > 0) loadPulse *= Math.exp(-dt * 2.2);

  simStep(dt, loadCurrent + loadPulse, CFG.damping);

  for (const col of columns) updateColumnMesh(col);
  updateBeams();
  updateSlabAndArrow();
  updateGrains(dt);
  updateCamera(dt);

  uiAccum += dt;
  if (uiAccum > 0.1) {
    uiAccum = 0;
    updateTelemetry();
  }
});

app.start();
applyCamera();
