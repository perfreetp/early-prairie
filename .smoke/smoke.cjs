// 冒烟测试：加载页面、等待 CSG 构建、驱动剖切面与临界位置，捕获页面错误
const path = require('path');
const PW = 'C:/Users/Administrator/AppData/Local/npm-cache/_npx/41b79885fbdb2a18/node_modules/playwright';
const { chromium } = require(PW);

const URL = 'http://127.0.0.1:8123/blade-section-viewer.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });

  // 等待 loading 消失（CSG 完成）
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 30000 });
  await sleep(500);

  const result = {};
  // 1. 初始状态
  result.hudZ = await page.textContent('#hudZ');
  result.hudCount = await page.textContent('#hudCount');
  result.statMin = await page.textContent('#statMin');
  result.statPct = await page.textContent('#statPct');
  result.holeItems = await page.locator('.hole-item').count();
  result.popupVisibleInit = await page.locator('#popup.show').count();

  // 2. 拖动滑块到 F1 附近 z=-58
  await page.locator('#zSlider').evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '-58');
  await sleep(300);
  result.atF1_count = await page.textContent('#hudCount');
  result.atF1_popup = await page.locator('#popup.show').count();
  result.atF1_popupText = (await page.textContent('#popup')).replace(/\s+/g, ' ').trim().slice(0, 160);
  result.activeItems = await page.locator('.hole-item.active').count();

  // 3. 点击临界按钮
  await page.click('#btnCritical');
  await sleep(1200); // 等 tween
  result.criticalZ = await page.textContent('#hudZ');
  result.criticalState = await page.locator('#popup .state').count()
    ? (await page.textContent('#popup .state')).trim() : 'none';

  // 4. 角向逐帧更新：读取临界位置角向，再小幅右移 0.5mm，确认数值变化
  const theta1 = await page.locator('#popup table tr:nth-child(2) td:last-child').textContent();
  await page.click('#btnNudgeR');
  await sleep(200);
  const theta2 = await page.locator('#popup table tr:nth-child(2) td:last-child').textContent();
  result.thetaBefore = theta1.trim();
  result.thetaAfter = theta2.trim();
  result.thetaChanged = theta1.trim() !== theta2.trim();

  // 5. 阈值调整
  await page.locator('#thrSlider').evaluate((el, v) => {
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, '8');
  await sleep(200);
  result.thr8_pct = await page.textContent('#statPct');
  result.thr8_val = await page.textContent('#thrVal');

  // 6. 列表点击：点 F3，平面应滑到其中心 z
  await page.locator('.hole-item[data-id="F3"]').click();
  await sleep(1200);
  result.afterListClickZ = await page.textContent('#hudZ');

  // 7. 渲染了 WebGL（canvas 非空）
  result.canvasW = await page.locator('#canvas3d').evaluate(el => el.width);
  result.sectionChildren = await page.evaluate(() => {
    // 触发一次重绘后读取 sectionGroup（通过全局不可见则跳过）
    return document.querySelector('#canvas3d') ? 'canvas-present' : 'missing';
  });

  await browser.close();

  console.log(JSON.stringify({ errors, result }, null, 2));
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('SMOKE-FAIL', e); process.exit(2); });
