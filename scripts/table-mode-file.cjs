// node scripts/table-mode-file.cjs <mode> <test file> [max]  — failing tests of one file at one table mode (classic | ffa3 | ffa4 | showdown)
const { spawnSync } = require("child_process");
const [mode, file, max = "30"] = process.argv.slice(2);
const r = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", file], {
  encoding: "utf8",
  maxBuffer: 1 << 28,
  env: { ...process.env, SPOILS_TABLE: mode }
});
const lines = (r.stdout || "").split(/\r?\n/);
let shown = 0;
for (let i = 0; i < lines.length && shown < Number(max); i++) {
  const m = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
  if (!m || /# TODO/.test(lines[i])) continue;
  const block = lines.slice(i + 1, i + 30);
  if (block.some(l => /type: 'suite'/.test(l))) continue;
  const e = block.findIndex(l => /^\s+error:/.test(l));
  console.log("- " + m[2] + "\n    " + block.slice(e, e + 5).map(s => s.trim()).join(" "));
  shown++;
}
console.log(lines.filter(l => /^# (pass|fail)/.test(l)).join(" "));
