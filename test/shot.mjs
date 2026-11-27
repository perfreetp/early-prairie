import puppeteer from 'puppeteer-core';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const root = path.resolve('.');
const server = http.createServer((req,res)=>{
  let p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (p.includes('..')) { res.writeHead(403); return res.end(); }
  fs.readFile(p,(e,d)=>{ if(e){res.writeHead(404);res.end('nf');} else {
    const ext=path.extname(p);
    res.writeHead(200,{'content-type': ext==='.html'?'text/html; charset=utf-8': ext==='.js'?'text/javascript':'application/octet-stream'});
    res.end(d); } });
});
let PORT = 0;
await new Promise(r=>server.listen(0,r)); PORT = server.address().port;
const browser = await puppeteer.launch({ executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true,
  args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox','--disable-gpu-sandbox'] });
const page = await browser.newPage();
await page.setViewport({width: Number(process.env.W||1200), height: Number(process.env.H||800), deviceScaleFactor:1});
page.on('console', m=>{ const t=m.text(); if(!t.includes('GL Driver')) console.log('[page]', t); });
page.on('pageerror', e=>console.log('[pageerror]', e.message));
const url = process.argv[2] || 'test/art.html';
await page.goto(`http://localhost:${PORT}/${url}`, {waitUntil:'networkidle0', timeout:60000});
await new Promise(r=>setTimeout(r, Number(process.env.WAIT||2500)));
if (process.env.EVAL) { const v = await page.evaluate(process.env.EVAL); console.log('[eval]', JSON.stringify(v)); }
await page.screenshot({path: process.env.OUT || 'test/shot.png'});
await browser.close(); server.close();
