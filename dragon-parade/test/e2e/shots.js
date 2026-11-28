const puppeteer = require("puppeteer-core");
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--use-gl=swiftshader",
           "--enable-unsafe-swiftshader", "--window-size=1280,900", "--hide-scrollbars"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:8731/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof BABYLON !== "undefined" &&
    BABYLON.EngineStore.LastCreatedScene &&
    document.getElementById("loading").style.display === "none", { timeout: 30000 });
  await sleep(2000);

  const seek = v => page.evaluate((val) => {
    const tl = document.getElementById("timeline");
    tl.value = val; tl.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
  const pickRoute = r => page.evaluate((id) =>
    document.querySelector(`.rbtn[data-route="${id}"]`).click(), r);

  // 直街：避让进行到中段
  await pickRoute(0); await sleep(400); await seek(300); await sleep(700);
  await page.screenshot({ path: "shot-1-straight.png" });

  // 拐弯：龙头过弯（约 38s/总时长 比例）
  await pickRoute(1); await sleep(400); await seek(340); await sleep(700);
  await page.screenshot({ path: "shot-2-turn.png" });

  // 卡巷：末尾停住
  await pickRoute(2); await sleep(400); await seek(920); await sleep(700);
  await page.screenshot({ path: "shot-3-alley.png" });

  console.log("screenshots done");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
