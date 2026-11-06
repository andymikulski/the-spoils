// node scripts/table-matrix.cjs <mode> [repoDir]   (mode: ffa3 | ffa4 | showdown; see src/engine/__tests__/support/bystander.ts)
// Runs every src/**/*.test.ts with SPOILS_TABLE=<mode>; writes .work/table-matrix-<mode>.json:
// { mode, summary, failures: [{ file, test, error }] } and prints counts per file.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const mode = process.argv[2];
const root = path.resolve(process.argv[3] || path.join(__dirname, ".."));
function find(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...find(p));
    else if (e.name.endsWith(".test.ts")) out.push(path.relative(root, p));
  }
  return out;
}
const files = find(path.join(root, "src"));
const failures = [];
const summary = { tests: 0, pass: 0, fail: 0 };
// One node --test run per file group keeps each failure attributable to its file.
const groups = [];
for (let i = 0; i < files.length; i += 40) groups.push(files.slice(i, i + 40));
for (const group of groups) {
  const r = spawnSync(process.execPath, ["--import", "tsx", "--test", "--test-reporter=tap", ...group], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 1 << 30,
    env: { ...process.env, SPOILS_TABLE: mode }
  });
  const lines = (r.stdout || "").split(/\r?\n/);
  for (const l of lines) {
    const m = /^# (tests|pass|fail) (\d+)/.exec(l);
    if (m) summary[m[1]] += Number(m[2]);
  }
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)not ok \d+ - (.*)$/.exec(lines[i]);
    if (!m || /# TODO/.test(lines[i])) continue;
    const block = lines.slice(i + 1, i + 30);
    if (block.some(l => /type: 'suite'/.test(l))) continue;
    const loc = block.find(l => /location:/.test(l)) || "";
    const fileMatch = /location: '([^']+?):\d+:\d+'/.exec(loc);
    const file = fileMatch ? path.relative(root, fileMatch[1].replace(/\\\\/g, "\\")) : "?";
    const errIndex = block.findIndex(l => /^\s+error:/.test(l));
    const error = errIndex >= 0 ? block.slice(errIndex, errIndex + 4).map(s => s.trim()).join(" ") : "";
    failures.push({ file, test: m[2], error: error.slice(0, 400) });
  }
}
fs.mkdirSync(path.join(root, ".work"), { recursive: true });
fs.writeFileSync(path.join(root, ".work", `table-matrix-${mode}.json`), JSON.stringify({ mode, summary, failures }, null, 1));
const byFile = {};
for (const f of failures) byFile[f.file] = (byFile[f.file] || 0) + 1;
console.log(mode, JSON.stringify(summary));
for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1])) console.log(`${n}\t${file}`);
