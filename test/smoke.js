/* 无头冒烟测试：CDP 驱动 Edge，加载页面、采集报错、模拟交互、截图 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT = __dirname;

/* 静态服务器 */
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.min.js': 'text/javascript' };
const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function getJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const DEBUG_PORT = PORT + 1000;
  const userDir = path.join(OUT, 'edge-profile');
  const edge = spawn(EDGE, [
    '--headless=new',
    '--no-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${path.join(OUT, 'edge-profile-' + Date.now())}`,
    'about:blank',
  ], { stdio: 'ignore' });

  let wsUrl = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const list = await getJSON(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
      const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) { wsUrl = page.webSocketDebuggerUrl; break; }
    } catch { /* retry */ }
  }
  if (!wsUrl) { console.error('EDGE_DEBUGGER_TIMEOUT'); edge.kill(); process.exit(1); }

  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let msgId = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method) events.push(m);
  };
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

  const errors = [];
  const logs = [];
  const onEvent = (m) => {
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = m.params.args.map(a => a.value ?? a.description ?? '').join(' ');
      logs.push(`[${m.params.type}] ${text}`);
      if (m.params.type === 'error') errors.push(text);
    }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    }
  };
  ws.addEventListener ? ws.addEventListener('message', (e) => onEvent(JSON.parse(e.data)))
                     : ws.on('message', (d) => onEvent(JSON.parse(d)));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Log.enable');

  // 视口
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });

  // 等页面初始化 + 临界载荷搜索
  await sleep(5000);

  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      errors.push('EVAL EXCEPTION: ' + JSON.stringify(r.result.exceptionDetails));
      return null;
    }
    return r.result?.result?.value;
  };

  const state0 = await evalJs(`({
    fstar: typeof Fstar!=='undefined' ? Fstar : null,
    cols: columns.map(c=>({name:c.name,state:c.state,f:c.fCol,d:c.d})),
    appStarted: app.running,
    canvasSize: [document.querySelector('canvas').width, document.querySelector('canvas').height],
  })`);
  console.log('STATE@0s:', JSON.stringify(state0));

  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, 'shot1_initial.png'), Buffer.from(r.result.data, 'base64'));
  });

  // 滑块拖到 60% 载荷，验证变形
  await evalJs(`(() => {
    const sl = document.getElementById('loadSlider');
    sl.value = 600;
    sl.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await sleep(2500);
  const state1 = await evalJs(`({
    load: loadCurrent,
    cols: columns.map(c=>({name:c.name,state:c.state,f:+c.fCol.toFixed(2),d:+c.d.toFixed(4),beam:+c.fBeam.toFixed(2)})),
  })`);
  console.log('STATE@60%:', JSON.stringify(state1));
  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, 'shot2_loaded.png'), Buffer.from(r.result.data, 'base64'));
  });

  // 点击 C1（通过 UI 列表选择，保证遥测面板工作）
  await evalJs(`document.querySelectorAll('.col-row')[0].click()`);
  await sleep(300);
  const tel = await evalJs(`({
    force: document.getElementById('mForce').textContent,
    util: document.getElementById('mUtil').textContent,
    comp: document.getElementById('mComp').textContent,
    bend: document.getElementById('mBend').textContent,
    beam: document.getElementById('mBeam').textContent,
    chip: document.getElementById('selChip').textContent,
  })`);
  console.log('TELEMETRY C1:', JSON.stringify(tel));

  // 真实 3D 射线拾取：俯视角度让 4 柱互不遮挡，逐根投影后走 pickColumn
  const pickRes = await evalJs(`(() => {
    orbit.yaw = Math.PI / 4; orbit.pitch = 1.05; applyCamera();
    const results = [];
    for (let k = 0; k < 4; k++) {
      const c = columns[k];
      const world = new pc.Vec3(c.base.x, (3.2 - c.d) * 0.5, c.base.z);
      const vp = new pc.Mat4().mul2(cam.camera.projectionMatrix, cam.camera.viewMatrix);
      const v = new pc.Vec3(); vp.transformPoint(world, v);
      const w = world.x * vp.data[3] + world.y * vp.data[7] + world.z * vp.data[11] + vp.data[15];
      const sx = (v.x / w * 0.5 + 0.5) * 1440;
      const sy = (1 - (v.y / w * 0.5 + 0.5)) * 900;
      selected = null;
      pickColumn(sx, sy);
      results.push({ target: c.name, got: selected ? selected.name : null });
    }
    return results;
  })()`);
  console.log('3D_PICK all:', JSON.stringify(pickRes));
  const pickOk = pickRes && pickRes.length === 4 && pickRes.every(p => p.target === p.got);
  if (!pickOk) errors.push('3D 射线拾取存在错误: ' + JSON.stringify(pickRes));

  // 复位后一键加载临界预设
  await evalJs(`document.getElementById('btnReset').click()`);
  await sleep(1200);
  const presetInfo = await evalJs(`({fstar:+Fstar.toFixed(2), preset:+presetLoad.toFixed(2)})`);
  console.log('PRESET:', JSON.stringify(presetInfo));
  await evalJs(`document.getElementById('btnCrit').click()`);
  // 缓动加载下首塌约在 7s 左右；先在 6.5s 截一张塌陷前，再等到 11s 看完整连锁
  await sleep(6500);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, 'shot3a_precollapse.png'), Buffer.from(r.result.data, 'base64'));
  });
  await sleep(4500);
  const state2 = await evalJs(`({
    load: +loadCurrent.toFixed(2),
    order: columns.map(c=>({name:c.name,state:c.state,at:c.collapseAt>0?+c.collapseAt.toFixed(2):null,f:+c.fCol.toFixed(2),d:+c.d.toFixed(3)})),
    grainsActive: grainPool.filter(g=>g.active).length,
  })`);
  console.log('STATE@CRIT+11s:', JSON.stringify(state2));
  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, 'shot3_cascade.png'), Buffer.from(r.result.data, 'base64'));
  });

  // 镜头预演
  await evalJs(`document.getElementById('btnOrbit').click()`);
  await sleep(3000);
  await send('Page.captureScreenshot', { format: 'png' }).then(r => {
    fs.writeFileSync(path.join(OUT, 'shot4_orbit.png'), Buffer.from(r.result.data, 'base64'));
  });
  const camState = await evalJs(`({yaw:+orbit.yaw.toFixed(2), preview: camPreview!==null})`);
  console.log('CAMERA:', JSON.stringify(camState));

  console.log('CONSOLE_LOGS:', logs.length, 'entries');
  logs.slice(0, 20).forEach(l => console.log('  ', l));
  console.log('ERRORS:', errors.length);
  errors.forEach(e => console.log('  !!', e));

  // 业务断言：临界预设必须真正引发至少 2 根柱子塌陷（连锁传播），且首柱 C1 先塌
  const collapsed = state2.order.filter(c => c.state === 'collapsed');
  const chainOk = collapsed.length >= 2 && state2.order[0].state === 'collapsed';
  console.log('CASCADE_CHECK:', chainOk ? 'PASS' : 'FAIL', `(${collapsed.length}/4 塌陷, 首柱=${state2.order[0].name})`);
  const fail = errors.length > 0 || !chainOk;

  ws.close();
  edge.kill();
  server.close();
  process.exit(fail ? 2 : 0);
})().catch((e) => { console.error('TEST CRASH:', e); process.exit(1); });
