// 从 index.html 抽取纯仿真内核（SIM_CORE 标记之间），导出给测试用
const fs = require("fs");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/\/\*SIM_CORE_START\*\/([\s\S]*?)\/\*SIM_CORE_END\*\//);
if (!m) throw new Error("SIM core markers not found");

const code = m[1] + "\nmodule.exports = SIM;";
const outPath = path.join(__dirname, "sim_core.js");
fs.writeFileSync(outPath, code);
console.log("extracted", code.length, "chars ->", outPath);
