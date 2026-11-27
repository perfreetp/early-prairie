import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const file = pathToFileURL(path.resolve('../upper-limb-cun.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:900} });
await page.goto(file,{waitUntil:'networkidle'});
await page.waitForTimeout(400);
// 默认 120° 开肘,12寸模式,中立旋前
await page.screenshot({path:'../shot-default.png'});
// 临界
await page.evaluate(()=>pose(90,72));
await page.waitForTimeout(150);
await page.screenshot({path:'../shot-critical.png'});
// 伸直
await page.evaluate(()=>pose(0,0));
await page.waitForTimeout(150);
await page.screenshot({path:'../shot-straight.png'});
// 9寸模式 + 120°
await page.evaluate(()=>{ pose(120,0); setMode(9); });
await page.waitForTimeout(150);
await page.screenshot({path:'../shot-mode9.png'});
await browser.close();
console.log('done');
