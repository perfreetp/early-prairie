import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('.');
const server = http.createServer((req,res)=>{
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e,d)=>{ if(e){res.writeHead(404);res.end('nf');} else {res.writeHead(200,{'content-type': p.endsWith('.html')?'text/html':'application/octet-stream'});res.end(d);} });
});
await new Promise(r=>server.listen(8765,r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--disable-gpu-sandbox','--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({width: 1200, height: 800, deviceScaleFactor: 1});
page.on('console', m => console.log('[page]', m.text()));
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8765/test/smoke.html', {waitUntil:'networkidle0', timeout: 60000});
await new Promise(r=>setTimeout(r, 2500));
await page.screenshot({path: 'test/smoke.png'});
await browser.close(); server.close();
