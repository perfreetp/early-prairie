import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('.');
const server = http.createServer((req,res)=>{
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(p, (e, st) => {
    if (e) { res.writeHead(404); res.end('nf'); return; }
    if (st.isDirectory()) p = path.join(p, 'index.html');
    fs.readFile(p,(e2,d)=>{ if(e2){res.writeHead(404);res.end('nf');} else {
      const ext=path.extname(p);
      const ty = ext==='.html'?'text/html; charset=utf-8': ext==='.js'?'text/javascript': ext==='.css'?'text/css':'application/octet-stream';
      res.writeHead(200,{'content-type': ty}); res.end(d); } });
  });
});
await new Promise(r=>server.listen(0,r));
const PORT = server.address().port;
const browser = await puppeteer.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-gpu-sandbox','--ignore-gpu-blocklist','--enable-webgl'] });
const page = await browser.newPage();
const W = Number(process.env.W||1440), H = Number(process.env.H||900);
await page.setViewport({width: W, height: H, deviceScaleFactor:1});
const errors = [];
page.on('console', async m=>{ const t=m.text(); if(t.includes('GL Driver')||t.includes('Tracking Prevention')) return; console.log('[page]', t); for (const a of m.args()) { try { const v = await a.evaluate(o => o && o.stack ? o.stack : String(o)); if (v && v !== t) console.log('   ->', v); } catch(_){} } });
page.on('pageerror', e=>{ errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('requestfailed', r => console.log('[reqfail]', r.url(), r.failure()?.errorText));
await page.goto(`http://localhost:${PORT}/index.html`, {waitUntil:'networkidle0', timeout:90000});
// wait for boot to clear
try {
  await page.waitForFunction(() => window.__app && window.__app.herd && window.__app.renderer && window.__app.renderer.mesh, {timeout: 60000});
} catch(e) { console.log('BOOT TIMEOUT'); }
await new Promise(r=>setTimeout(r, 2500));
const script = process.env.SCRIPT || '';
if (script) {
  const out = await page.evaluate(script);
  console.log('[eval]', JSON.stringify(out, null, 1));
  await new Promise(r=>setTimeout(r, Number(process.env.AFTER||1500)));
}
const stats = await page.evaluate(() => {
  const a = window.__app;
  if (!a || !a.herd) return null;
  return { n: a.herd.n, fps: a.fps, stats: a.herd.stats, cam: {x:a.cam.x,y:a.cam.y,z:a.cam.zoom},
           debug: a.renderer && a.renderer.debug, season: a.timeline,
           q: a.renderer && a.renderer.debug.meshQ, dotQ: a.renderer && a.renderer.debug.dotQ };
});
console.log('[state]', JSON.stringify(stats, null, 1));
await page.screenshot({path: process.env.OUT || 'test/app.png'});
console.log('errors:', errors.length);
await browser.close(); server.close();
