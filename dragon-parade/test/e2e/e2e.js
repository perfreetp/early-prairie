const puppeteer = require("puppeteer-core");

const URL = "http://127.0.0.1:8731/index.html";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = ms => new Promise(r => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.error("  FAIL  " + name + " " + extra); }
};

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader",
           "--enable-unsafe-swiftshader", "--window-size=1280,900"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  const errors = [];
  page.on("pageerror", e => errors.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 等 Babylon 场景就绪（loading 隐藏）
  await page.waitForFunction(() => typeof BABYLON !== "undefined" &&
    BABYLON.EngineStore.LastCreatedScene &&
    (!document.getElementById("loading") || document.getElementById("loading").style.display === "none"),
    { timeout: 30000 });
  await sleep(1500);

  // 1. 无运行时报错（忽略 CDN favicon 类噪音）
  const realErr = errors.filter(e => !/favicon|net::ERR|404|status of 404/i.test(e));
  check("页面加载无 JS 运行时错误", realErr.length === 0, JSON.stringify(realErr));

  // 2. Babylon 已创建渲染画布且 WebGL 在跑
  const glOk = await page.evaluate(() => {
    const c = document.getElementById("c");
    return c && c.width > 0 && c.height > 0 && typeof BABYLON !== "undefined" && !!BABYLON.EngineStore.LastCreatedScene;
  });
  check("Babylon 场景与 WebGL 画布已启动", glOk);

  // 读取龙头世界坐标
  const headPos = () => page.evaluate(() => {
    const n = document.querySelector("#c") && window;
    // 通过场景里名字为 n0 的 TransformNode 取位置
    const node = BABYLON.EngineStore.LastCreatedScene.getTransformNodeByName("n0");
    return node ? { x: +node.position.x.toFixed(3), z: +node.position.z.toFixed(3) } : null;
  });

  // 3. 龙头随时间前进（默认直街，沿 -z 起步，z 应减小）
  const p0 = await headPos();
  await sleep(2500);
  const p1 = await headPos();
  check("龙头沿路径前进（位置发生变化）", p0 && p1 &&
    Math.hypot(p1.x - p0.x, p1.z - p0.z) > 1.5, JSON.stringify({ p0, p1 }));

  // 4. 龙身共 11 个节点且连接筒存在
  const counts = await page.evaluate(() => {
    const sc = BABYLON.EngineStore.LastCreatedScene;
    return {
      nodes: sc.transformNodes.filter(n => /^n\d+$/.test(n.name)).length,
      links: sc.meshes.filter(m => m.name === "link").length
    };
  });
  check("龙 = 1 龙头 + 10 龙身（11 节点），10 个连接筒",
    counts.nodes === 11 && counts.links === 10, JSON.stringify(counts));

  // 5. 时间轴回拖：拖到中间记录状态，再拖回 0，再拖回中间，两次应一致
  const seekAndRead = async val => page.evaluate((v) => {
    const tl = document.getElementById("timeline");
    tl.value = v;
    tl.dispatchEvent(new Event("input", { bubbles: true }));
    const sc = BABYLON.EngineStore.LastCreatedScene;
    return sc.transformNodes.filter(n => /^n\d+$/.test(n.name))
      .sort((a, b) => +a.name.slice(1) - +b.name.slice(1))
      .map(n => [+n.position.x.toFixed(4), +n.position.y.toFixed(4), +n.position.z.toFixed(4)]);
  }, val);
  const mid1 = await seekAndRead(500);
  const zero = await seekAndRead(0);
  const mid2 = await seekAndRead(500);
  check("时间轴回拖可复原：同一刻度两次状态完全相同",
    JSON.stringify(mid1) === JSON.stringify(mid2));
  check("拖回起点：龙头回到初始位置附近（s≈0）",
    Math.abs(zero[0][0] - 0) < 0.5 && Math.abs(zero[0][2] - (-46)) < 1.0,
    JSON.stringify(zero[0]));

  // 6. 切换到拐弯路线：龙灯从头走（龙头回到该路线起点），且时长不同
  const routeInfo = await page.evaluate(() => {
    document.querySelector('.rbtn[data-route="1"]').click();
    return {
      tEnd: document.getElementById("tEnd").textContent,
      head: (() => { const n = BABYLON.EngineStore.LastCreatedScene.getTransformNodeByName("n0");
        return [+n.position.x.toFixed(2), +n.position.z.toFixed(2)]; })()
    };
  });
  check("切换拐弯路线后龙头回到该路线起点 (-34,-30) 附近",
    Math.abs(routeInfo.head[0] - (-34)) < 1.5 && Math.abs(routeInfo.head[1] - (-30)) < 1.5,
    JSON.stringify(routeInfo));
  check("路线显示全程时长", /全程/.test(routeInfo.tEnd), routeInfo.tEnd);

  // 7. 卡巷路线：先切换到路线 2，再拖到接近末尾，应出现卡停横幅，龙头弧长停在 block=30
  const blocked = await page.evaluate(async () => {
    document.querySelector('.rbtn[data-route="2"]').click();
    await new Promise(r => setTimeout(r, 200));
    const tl = document.getElementById("timeline");
    tl.value = 950; tl.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    const banner = getComputedStyle(document.getElementById("banner")).display !== "none";
    // 直接读龙头节点在巷口的世界坐标，不依赖面板文本解析
    const sc = BABYLON.EngineStore.LastCreatedScene;
    const h = sc.getTransformNodeByName("n0");
    const stateTxt = document.getElementById("state").textContent;
    const m = stateTxt.match(/s=([\d.]+)m/);
    return { banner, headS: m ? +m[1] : null, headPos: [+h.position.x.toFixed(2), +h.position.z.toFixed(2)] };
  });
  check("卡巷：显示卡停警示横幅", blocked.banner);
  check("卡巷：龙头弧长停在巷口 block=30（而非继续前进）",
    blocked.headS != null && Math.abs(blocked.headS - 30) < 0.2, JSON.stringify(blocked));

  // 8. 巷口宽度标尺存在
  const alley = await page.evaluate(() =>
    BABYLON.EngineStore.LastCreatedScene.meshes.some(m => m.name === "mk" && m.isEnabled()));
  check("卡巷场景存在巷口宽度标尺", alley);

  // 最终错误复查
  const realErr2 = errors.filter(e => !/favicon|net::ERR|404|status of 404/i.test(e));
  check("全程无新增 JS 错误", realErr2.length === 0, JSON.stringify(realErr2));

  await browser.close();
  console.log(`\nE2E：${pass} 通过，${fail} 失败`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("E2E 崩溃:", e); process.exit(1); });
