import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';
const file = pathToFileURL(path.resolve('../upper-limb-cun.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:900}, deviceScaleFactor:2 });
await page.goto(file,{waitUntil:'networkidle'});
await page.waitForTimeout(400);
// 肘区大致在画面中下部,裁剪放大
await page.screenshot({path:'../crop-elbow.png', clip:{x:560,y:470,width:360,height:240}});
// 腕区
await page.screenshot({path:'../crop-wrist.png', clip:{x:980,y:230,width:280,height:180}});
await browser.close();
console.log('done');
