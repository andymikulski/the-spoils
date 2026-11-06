// run-tests.js
//
// Finds every `*.test.ts` file under src/ and runs them with Node's built-in
// test runner via tsx. Node's own --test glob support isn't reliable across
// shells (bash vs cmd.exe), so this walks the filesystem itself instead of
// depending on `**` glob expansion in package.json scripts.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

function findTestFiles(dir) {
  const results = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }

  return results;
}

const testFiles = findTestFiles(SRC_ROOT);

if (testFiles.length === 0) {
  console.error('No *.test.ts files found under src/.');
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
