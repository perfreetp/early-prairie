// 可视化验证：截图 + 临界区微调时确认弹窗始终是 F1 且角向连续更新
const PW = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright';
const { chromium } = require(PW);
const URL = 'http://127.0.0.1:8123/blade-section-viewer.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = 'D:/ccfb/runs/17355/workspace/.smoke';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 30000 });
  await sleep(600);

  const setZ = async v => page.locator('#zSlider').evaluate((el, x) => {
    el.value = x; el.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(v));
  const popupName = () => page.locator('#popup .pt').textContent();
  const theta = () => page.locator('#popup table tr:nth-child(2) td:last-child').textContent();
  const state = () => page.locator('#popup .state').textContent().catch(()=> 'none');

  // 1. 整体视图 z=0
  await setZ(0); await sleep(300);
  await page.screenshot({ path: OUT + '/shot-overview.png' });

  // 2. 临界位置
  await page.click('#btnCritical'); await sleep(1300);
  const zCrit = await page.textContent('#hudZ');
  await page.screenshot({ path: OUT + '/shot-critical-notch.png' });
  const crit = { z: zCrit, name: (await popupName()).trim(), state: (await state()).trim(), theta: (await theta()).trim() };

  // 3. 向左 0.5（更深入孔内，应趋向完整圆）
  await page.click('#btnNudgeL'); await sleep(250);
  const left = { z: await page.textContent('#hudZ'), name:(await popupName()).trim(), state:(await state()).trim(), theta:(await theta()).trim() };
  await page.screenshot({ path: OUT + '/shot-left-full.png' });

  // 4. 回到临界后向右 0.5
  await page.click('#btnCritical'); await sleep(1300);
  await page.click('#btnNudgeR'); await sleep(250);
  const right = { z: await page.textContent('#hudZ'), name:(await popupName()).trim(), state:(await state()).trim(), theta:(await theta()).trim() };

  // 5. 完整圆孔特写：F3 中心
  await page.locator('.hole-item[data-id="F3"]').click(); await sleep(1300);
  await page.screenshot({ path: OUT + '/shot-full-circle.png' });
  const f3 = { z: await page.textContent('#hudZ'), name:(await popupName()).trim(), state:(await state()).trim() };

  console.log(JSON.stringify({ errors, crit, left, right, f3,
    staysOnF1: [crit,left,right].every(s=>s.name.includes('F1')) }, null, 2));
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch(e=>{ console.error(e); process.exit(2); });
