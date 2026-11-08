// test-freeze.cjs
//
// The two-player test freeze. `data/test-freeze.json` records a SHA-256 of
// every `*.test.ts` file under src/ (content with CRLF normalized to LF). The
// gate test `src/engine/__tests__/test-freeze.test.ts` fails if any recorded
// file is missing or its content differs, so the existing tests keep proving
// two-player behavior exactly as written. New test files are not recorded and
// never trip the gate.
//
//   node scripts/test-freeze.cjs           # check (exit 1 on drift)
//   node scripts/test-freeze.cjs --record  # (re)write data/test-freeze.json

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const BASELINE = path.join(ROOT, 'data', 'test-freeze.json');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function hashFile(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** Current hashes of every test file under src/, keyed by repo-relative path. */
function currentHashes() {
  const files = {};
  for (const file of walk(SRC).sort()) files[relative(file)] = hashFile(file);
  return files;
}

/** Recorded files that are missing or whose content changed. */
function drift() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const current = currentHashes();
  const problems = [];
  for (const [file, hash] of Object.entries(baseline.files)) {
    if (!(file in current)) problems.push(`${file}: deleted`);
    else if (current[file] !== hash) problems.push(`${file}: modified`);
  }
  return problems;
}

module.exports = { currentHashes, drift, BASELINE };

if (require.main === module) {
  if (process.argv.includes('--record')) {
    const files = currentHashes();
    fs.writeFileSync(BASELINE, JSON.stringify({ files }, null, 2) + '\n');
    console.log(`Recorded ${Object.keys(files).length} test files in ${relative(BASELINE)}.`);
  } else {
    const problems = drift();
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
    console.log('Test freeze intact.');
  }
}
