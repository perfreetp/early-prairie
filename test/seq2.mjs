import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('.');
const server = http.createServer((req,res)=>{
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.stat(p,(e,st)=>{ if(e){res.writeHead(404);res.end('nf');return;}
    if(st.isDirectory()) p=path.join(p,'index.html');
    fs.readFile(p,(e2,d)=>{ if(e2){res.writeHead(404);res.end('nf');} else {
      const ext=path.extname(p); res.writeHead(200,{'content-type': ext==='.html'?'text/html; charset=utf-8': ext==='.js'?'text/javascript':'application/octet-stream'}); res.end(d);} });
  });
});
await new Promise(r=>server.listen(0,r)); const PORT=server.address().port;
const browser = await puppeteer.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.setViewport({width:1280,height:800,deviceScaleFactor:1});
page.on('pageerror', e=>console.log('[err]', e.message));
await page.goto(`http://localhost:${PORT}/index.html`, {waitUntil:'networkidle0', timeout:90000});
await page.waitForFunction(()=>window.__app && window.__app.renderer && window.__app.renderer.mesh, {timeout:60000});
await new Promise(r=>setTimeout(r,1000));
await page.evaluate(()=>{ document.querySelectorAll('.stats,.pad,#inset,.topbar,.bottombar,#hint').forEach(e=>e.style.display='none'); });
// give the herd a long head start so shapes are close to steady state
await page.evaluate(()=>{ const a=window.__app; for(let i=0;i<180*30;i++) a.herd.step(1/30); });
for (const [name,t] of [['wet',0.05],['mid',0.45],['dryish',0.72],['dry',0.95]]) {
  await page.evaluate((t)=>{
    const a=window.__app; a.setPlaying(false); a.setTimeline(t);
    a._pendingCatchUp = 60;           // let it settle into the new season
    a.cam.jumpTo(1900,1380, Math.max(a.app.screen.width/4000, a.app.screen.height/2760));
  }, t);
  await new Promise(r=>setTimeout(r,2600));
  await page.screenshot({path:`test/seq-${name}.png`});
  const s = await page.evaluate(()=>{ const a=window.__app; a.herd.computeStats(); return {stam:+a.herd.stats.meanStam.toFixed(2), R:+a.herd.stats.meanR.toFixed(0), files:a.herd.stats.files, elo:+a.herd.stats.elongation.toFixed(2)}; });
  console.log(name, JSON.stringify(s));
}
await browser.close(); server.close();
