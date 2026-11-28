const fs = require("fs");
const html = fs.readFileSync("index.html", "utf8");
const core = html.match(/SIM_CORE_START\*\/([\s\S]*?)\/\*SIM_CORE_END/)[1];
let extracted = fs.readFileSync("test/sim_core.js", "utf8").replace(/\nmodule\.exports = SIM;\s*$/, "");
console.log(core.trim() === extracted.trim() ? "✔ 页面内嵌内核与测试内核完全一致" : "✘ 内核不一致");
// 检查关键 DOM 钩子是否齐全
for (const id of ["timeline","playBtn","resetBtn","speedSel","followCam","state","banner","loading","tNow","tEnd"]) {
  console.log((html.includes(`id="${id}"`) ? "✔" : "✘") + " DOM#" + id);
}
// 检查三条路线与卡巷常量
console.log(html.includes("block: 30.0") ? "✔ 卡巷 block=30" : "✘ 缺卡巷");
console.log((html.match(/name: "/g) || []).length === 3 ? "✔ 三条路线" : "✘ 路线数量");
