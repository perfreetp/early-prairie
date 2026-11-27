import { chromium } from 'playwright';
import { pathToFileURL } from 'url';
import path from 'path';

const file = pathToFileURL(path.resolve('../upper-limb-cun.html')).href;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport:{width:1280,height:860} });
const errors = [];
page.on('console', m => { if(m.type()==='error') errors.push('CONSOLE: '+m.text()); });
page.on('pageerror', e => errors.push('PAGEERROR: '+e.message));
await page.goto(file, { waitUntil:'networkidle' });
await page.waitForTimeout(400);

const results = [];
const check=(name, cond, extra='')=> results.push({name, pass:!!cond, extra});

// 1. Two.js 加载且 SVG 已渲染
const svgCount = await page.locator('#stage svg').count();
check('Two.js SVG 渲染', svgCount>=1, svgCount+' svg');
const twoLoaded = await page.evaluate(()=>typeof Two!=='undefined');
check('Two 全局存在', twoLoaded);

// 2. 腧穴与关节命中区已建立
const hitN = await page.evaluate(()=>hitAreas.length);
check('命中区数量>0(腧穴+关节)', hitN>=15, hitN+'');

// 3. 临界角解析核验:θ=72 时偏差≈0
const dev72 = await page.evaluate(()=>{
  setPron(72);
  const th=72*Math.PI/180;
  const pLat = CRIT_W*Math.cos(CRIT_PHI-th);
  const sLat = styloidLateral(th);
  return {dev:pLat-sLat, pLat, sLat, A:STY_A};
});
check('θ=72° 临界偏差≈0', Math.abs(dev72.dev)<1e-9, JSON.stringify(dev72));

// 4. +1° 偏出、-1° 反向(再旋一点就偏出)
const around = await page.evaluate(()=>{
  const f=t=>{const th=t*Math.PI/180;return CRIT_W*Math.cos(CRIT_PHI-th)-styloidLateral(th);};
  return {m1:f(71), p1:f(73), p2:f(74), zero:f(72)};
});
check('72°偏差为0', Math.abs(around.zero)<1e-9);
check('+1°偏到尺侧(负)', around.p1<0, around.p1.toFixed(3));
check('-1°仍在桡侧(正)', around.m1>0, around.m1.toFixed(3));
check('+2°偏出更明显', around.p2<around.p1, around.p2.toFixed(3));

// 5. 临界姿势按钮可稳定复现(两次偏差一致)
await page.click('#pose-crit'); await page.waitForTimeout(50);
const snap1 = await page.evaluate(()=>{
  const th=state.pron*Math.PI/180; return CRIT_W*Math.cos(CRIT_PHI-th)-styloidLateral(th);
});
await page.click('#pose-crit');
const snap2 = await page.evaluate(()=>{
  const th=state.pron*Math.PI/180; return CRIT_W*Math.cos(CRIT_PHI-th)-styloidLateral(th);
});
check('临界按钮可复现(两次相等且≈0)', Math.abs(snap1)<1e-9 && snap1===snap2, snap1+' / '+snap2);
const pronShown = await page.locator('#pron-val').textContent();
check('滑杆显示72.0°', pronShown.trim().startsWith('72.0'), pronShown);

// 6. 屈肘90 / 伸直预置
await page.click('#pose-flex');
const angFlex = await page.evaluate(()=>elbowAngle());
check('屈肘预置≈90°', Math.abs(angFlex-90)<0.5, angFlex.toFixed(2));
await page.click('#pose-straight');
const angStr = await page.evaluate(()=>elbowAngle());
check('伸直预置≈0°', Math.abs(angStr)<0.5, angStr.toFixed(2));

// 7. 骨长约束:拖动腕后前臂长度不变
const before = await page.evaluate(()=>Math.hypot(state.W.x-state.E.x, state.W.y-state.E.y));
const wPos = await page.evaluate(()=>{const r=document.querySelector('#stage svg').getBoundingClientRect();
  const h=hitAreas.find(a=>a.kind==='joint'&&a.ref==='W');
  return {x:r.left+h.x*(r.width/two.width), y:r.top+h.y*(r.height/two.height)};});
await page.mouse.move(wPos.x,wPos.y); await page.mouse.down();
await page.mouse.move(wPos.x+120, wPos.y-90,{steps:8}); await page.mouse.up();
const after = await page.evaluate(()=>Math.hypot(state.W.x-state.E.x, state.W.y-state.E.y));
check('拖腕后前臂骨长守恒', Math.abs(after-before)<0.5, before+' → '+after);

// 8. 基准切换:同段 1寸像素随基准变化
await page.evaluate(()=>setMode(12));
const px12 = await page.locator('#px-cun').textContent();
await page.evaluate(()=>setMode(9));
const px9 = await page.locator('#px-cun').textContent();
check('基准切换改变寸/像素', px12!==px9, px12.trim()+' | '+px9.trim());
const tag9 = await page.locator('#mode-tag').textContent();
check('9寸模式标签', tag9.includes('腋前纹头') && tag9.includes('9 寸'), tag9);

// 9. 点选腧穴显示分寸
await page.evaluate(()=>setMode(12));
await page.evaluate(()=>{
  const h=hitAreas.find(a=>a.kind==='point'&&a.ref.id==='LU7');
  state.selected=h.ref; render();
});
const info = await page.locator('#info-card').textContent();
check('点列缺显示到腕1.5寸', info.includes('1.5 寸'), '');
check('点列缺显示到肘10.5寸', info.includes('10.5 寸'), '');
check('信息含经络名', info.includes('手太阴肺经'), '');

// 10. 腧穴随旋前滑移:列缺世界坐标在 θ=0 与 θ=72 不同
const move = await page.evaluate(()=>{
  setPron(0); render(); const a=hitAreas.find(h=>h.ref.id==='LU7');
  const p0={x:a.x,y:a.y};
  setPron(72); render(); const b=hitAreas.find(h=>h.ref.id==='LU7');
  const p1={x:b.x,y:b.y};
  return {d:Math.hypot(p1.x-p0.x,p1.y-p0.y)};
});
check('旋前使列缺沿体表滑移', move.d>5, move.d.toFixed(2)+'px');

// 11. 标尺刻度数:12寸段13个刻度,9寸段10个(通过 SVG 文本含"寸")
const tickTexts = await page.evaluate(()=>
  [...document.querySelectorAll('#stage svg text')].map(t=>t.textContent).filter(t=>/寸$/.test(t)));
check('含12寸与9寸刻度标注', tickTexts.includes('12寸')&&tickTexts.includes('9寸'), tickTexts.join(','));

// 截图(屈肘+临界)
await page.evaluate(()=>{ pose(90,72); });
await page.waitForTimeout(200);
await page.screenshot({ path:'../shot-critical.png', fullPage:false });
await page.evaluate(()=>{ pose(0,0); setMode(12); });
await page.waitForTimeout(200);
await page.screenshot({ path:'../shot-straight.png' });
await page.evaluate(()=>{ setMode(9); });
await page.waitForTimeout(200);
await page.screenshot({ path:'../shot-mode9.png' });

console.log('\n==== 测试结果 ====');
let pass=0;
for(const r of results){ console.log((r.pass?'PASS':'FAIL')+' | '+r.name+(r.extra?'  ['+r.extra+']':'')); if(r.pass)pass++; }
console.log(`\n${pass}/${results.length} 通过`);
console.log('页面错误:', errors.length? errors : '无');
await browser.close();
process.exit(pass===results.length && errors.length===0 ? 0 : 1);
