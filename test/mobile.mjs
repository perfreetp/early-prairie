import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const file = pathToFileURL(path.resolve('../upper-limb-cun.html')).href;
const browser = await chromium.launch();
// 手机尺寸
const page = await browser.newPage({ viewport:{width:420,height:880}, deviceScaleFactor:2, hasTouch:true });
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(file,{waitUntil:'networkidle'});
await page.waitForTimeout(400);
// 侧栏应在顶部,画布在下方
const asideH = await page.locator('aside').boundingBox();
const stageH = await page.locator('#stage').boundingBox();
const stacked = asideH.y < stageH.y && stageH.height > 300;
console.log('窄屏纵向堆叠:', stacked, '| 侧栏高', Math.round(asideH.height), '画布高', Math.round(stageH.height));
// 临界按钮在窄屏可点
await page.click('#pose-crit');
await page.waitForTimeout(100);
const dev = await page.locator('#crit-dev').textContent();
console.log('窄屏临界偏差:', dev.trim());
await page.screenshot({path:'../shot-mobile.png'});
// 触摸拖动腕关节
const before = await page.evaluate(()=>Math.hypot(state.W.x-state.E.x,state.W.y-state.E.y));
const h = await page.evaluate(()=>{const r=document.querySelector('#stage svg').getBoundingClientRect();
  const p=hitAreas.find(a=>a.kind==='joint'&&a.ref==='W');
  return {x:r.left+p.x*(r.width/two.width), y:r.top+p.y*(r.height/two.height)};});
await page.touchscreen.tap(h.x,h.y).catch(()=>{});
await page.mouse.move(h.x,h.y); await page.mouse.down();
await page.mouse.move(h.x-60,h.y+40,{steps:6}); await page.mouse.up();
const after = await page.evaluate(()=>Math.hypot(state.W.x-state.E.x,state.W.y-state.E.y));
console.log('触摸拖动骨长守恒:', Math.abs(after-before)<0.5, before.toFixed(1),'→',after.toFixed(1));
console.log('错误:', errors.length?errors:'无');
await browser.close();
