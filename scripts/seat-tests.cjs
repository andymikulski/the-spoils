// `npm run test:seats [1] [2] [--list] [--allowed] [--only <text>...]`
//
// Bystander replay (docs/TESTING.md, "Bystander replay"): runs the whole test suite with SPOILS_TEST_EXTRA_SEATS=1 and/or
// 2 (default: both, one after the other) and prints, per run, the number of tests that pass and the failures that are
// EXPECTED, by kind:
//   - quantified: a failure on a card with a "quantified" clause (each opponent / each player / ...) in
//     data/card-tests/mp-inventory.json, matched by card name (a generated rule);
//   - recorded: a failure listed in data/card-tests/seat-differences.json (one entry per test: file, full title, category;
//     each category names the rule atoms that make the two-player assertion differ, and why).
// Everything else is unexpected, and so is a stale recorded entry (one that passes, or whose file is gone). The exit code is
// 0 only when there are no unexpected failures and no stale entries. The full result of each run is written to
// <tmpdir>/spoils-seats-<n>.json.
//
//   --list         print every unexpected failure (otherwise only the counts per file)
//   --allowed      also print the expected (quantified and recorded) failures
//   --only <text>  run only the test files whose path contains <text> (repeatable); stale entries are then judged only
//                  for the files that ran

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SRC_ROOT = path.join(REPO_ROOT, 'src');

function findTestFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findTestFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.test.ts')) results.push(fullPath);
  }
  return results;
}

const args = process.argv.slice(2);
const seats = [];
const only = [];
let list = false;
let showAllowed = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '1' || arg === '2') seats.push(arg);
  else if (arg === '--list') list = true;
  else if (arg === '--allowed') showAllowed = true;
  else if (arg === '--only') only.push(args[++i]);
  else {
    console.error(`test:seats: unknown argument '${arg}'`);
    process.exit(2);
  }
}
if (seats.length === 0) seats.push('1', '2');

// --- expected differences: the clauses of data/card-tests/mp-inventory.json marked "quantified" -----------------------

const inventory = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'card-tests', 'mp-inventory.json'), 'utf8'));
/** card name -> clause keys ("0:ability", ...) with a quantified phrase */
const quantified = new Map();
for (const group of inventory) {
  for (const clause of group.clauses) {
    if (clause.mp !== 'quantified') continue;
    if (!quantified.has(group.name)) quantified.set(group.name, new Set());
    quantified.get(group.name).add(clause.key);
  }
}

/**
 * The card with a quantified clause that a failing test is about, or undefined. Clause tests are titled `Name (Set) [key
 * key] text`, per-card tests sit in a `describe("Set — Name")`. A card counts as a whole: its other clauses (the options of a
 * card whose "each player's turn" trigger is the quantified one) run through the quantified one.
 */
function quantifiedCard(failure) {
  for (const title of failure.path) {
    const clauseTitle = title.match(/^(.+?) \([^()]*\) (?:\\#[0-9a-f]+ )?\[([^\]]*)\]/);
    if (clauseTitle) {
      return quantified.has(clauseTitle[1]) ? clauseTitle[1] : undefined;
    }
    const perCard = title.match(/^[^—]+ — (.+)$/);
    if (perCard && quantified.has(perCard[1])) return perCard[1];
  }
  return undefined;
}


// --- recorded differences: data/card-tests/seat-differences.json ---------------------------------------------------------

const TEST_ROOT = 'src/engine/__tests__/';
const differences = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'data', 'card-tests', 'seat-differences.json'), 'utf8'));
const differenceKey = (file, title) => `${file}\u0000${title}`;
/** key -> entry */
const recorded = new Map();
for (const entry of differences.tests) {
  if (!differences.categories[entry.category]) {
    console.error(`test:seats: seat-differences.json: '${entry.file}' / '${entry.title}' names an unknown category '${entry.category}'`);
    process.exit(2);
  }
  const key = differenceKey(entry.file, entry.title);
  if (recorded.has(key)) {
    console.error(`test:seats: seat-differences.json: '${entry.file}' / '${entry.title}' is listed twice`);
    process.exit(2);
  }
  recorded.set(key, entry);
}
/** Whether the entry applies at `n` bystander seats (no `seats` list: at every table size). */
const appliesAt = (entry, n) => entry.seats === undefined || entry.seats.includes(Number(n));
/** The recorded entry a failure (file relative to the test root) matches at `n` bystander seats, if any. */
function recordedDifference(file, failure, n) {
  const entry = recorded.get(differenceKey(file, failure.path.join(' > ')));
  return entry && appliesAt(entry, n) ? entry : undefined;
}

/** Runs one test file with `n` bystander seats: resolves { file, summary }. */
function runFile(file, n, outDir, index) {
  const out = path.join(outDir, `${index}.json`);
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--test-reporter=./scripts/seat-reporter.mjs', file], {
      stdio: ['ignore', 'ignore', 'pipe'],
      cwd: REPO_ROOT,
      env: { ...process.env, SPOILS_TEST_EXTRA_SEATS: n, SPOILS_SEATS_OUT: out }
    });
    let stderr = '';
    child.stderr.on('data', chunk => {
      if (stderr.length < 4000) stderr += chunk;
    });
    child.on('close', code => {
      let summary = { pass: 0, fail: 0, todo: 0, skipped: 0, failures: [] };
      if (fs.existsSync(out)) summary = JSON.parse(fs.readFileSync(out, 'utf8'));
      // A file that died before reporting (a load error, a crash) is one failure of its own.
      if (!fs.existsSync(out) || (code !== 0 && summary.fail === 0)) {
        const reason = stderr.split('\n').find(line => /error/i.test(line)) ?? `exit code ${code}`;
        summary.fail += 1;
        summary.failures.push({ path: [file], error: reason.trim().slice(0, 300) });
      }
      resolve({ file, summary });
    });
  });
}

async function main() {
  let unexpected = 0;
  const workers = Math.max(1, os.cpus().length - 1);
  for (const n of seats) {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `spoils-seats-${n}-`));
    let files = findTestFiles(SRC_ROOT).map(file => path.relative(REPO_ROOT, file));
    if (only.length > 0) files = files.filter(file => only.some(text => file.replace(/\\/g, '/').includes(text)));
    console.log(`test:seats: ${files.length} files with ${n} bystander seat${n === '1' ? '' : 's'} ...`);
    const results = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (next < files.length) {
          const index = next++;
          results.push(await runFile(files[index], n, outDir, index));
        }
      })
    );
    const total = { pass: 0, todo: 0, skipped: 0 };
    const allowed = [];
    const other = [];
    const byCategory = new Map();
    const failed = new Set();
    const ran = new Set();
    for (const { file, summary } of results) {
      total.pass += summary.pass;
      total.todo += summary.todo;
      total.skipped += summary.skipped;
      const relative = file.replace(/\\/g, '/').replace(TEST_ROOT, '');
      ran.add(relative);
      for (const failure of summary.failures) {
        const entry = { ...failure, file: file.replace(/\\/g, '/') };
        failed.add(differenceKey(relative, failure.path.join(' > ')));
        const difference = recordedDifference(relative, failure, n);
        if (quantifiedCard(failure)) allowed.push(entry);
        else if (difference) {
          allowed.push({ ...entry, category: difference.category });
          byCategory.set(difference.category, (byCategory.get(difference.category) ?? 0) + 1);
        } else other.push(entry);
      }
    }
    // A recorded difference that no longer fails (or whose file is gone) must leave the list.
    const stale = [...recorded.values()].filter(
      entry => appliesAt(entry, n) && ran.has(entry.file) && !failed.has(differenceKey(entry.file, entry.title))
    );
    if (only.length === 0) {
      // The run covers every file: an entry whose file is gone is stale too.
      for (const entry of recorded.values()) {
        if (appliesAt(entry, n) && !ran.has(entry.file)) stale.push(entry);
      }
    }
    const resultFile = path.join(os.tmpdir(), `spoils-seats-${n}${only.length > 0 ? '-partial' : ''}.json`);
    fs.writeFileSync(resultFile, JSON.stringify({ ...total, allowed, other, stale }, null, 1));
    const byFile = new Map();
    for (const failure of other) {
      if (!byFile.has(failure.file)) byFile.set(failure.file, []);
      byFile.get(failure.file).push(failure);
    }
    const quantifiedCount = allowed.filter(failure => failure.category === undefined).length;
    console.log(
      `+${n} seat${n === '1' ? '' : 's'}: pass ${total.pass}, quantified ${quantifiedCount}, recorded ${allowed.length - quantifiedCount}` +
        ` (${[...byCategory].sort().map(([category, count]) => `${category} ${count}`).join(', ')}), unexpected ${other.length}, stale ${stale.length}` +
        ` (todo ${total.todo}, skipped ${total.skipped}); full result: ${resultFile}`
    );
    for (const entry of stale) {
      console.log(`  stale: ${entry.file}: ${entry.title.slice(0, 200)}\n      it no longer fails (or its file is gone): remove it from data/card-tests/seat-differences.json`);
    }
    for (const [file, failures] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`  ${failures.length}\t${file}`);
      if (list) for (const failure of failures) console.log(`      ${failure.path.join(' > ').slice(0, 220)}\n        ${failure.error.slice(0, 160)}  @ ${failure.at ?? ""}`);
    }
    if (showAllowed) for (const failure of allowed) console.log(`  ${failure.category ?? 'quantified'}: ${failure.file}: ${failure.path.join(' > ').slice(0, 200)}`);
    unexpected += other.length + stale.length;
  }
  process.exit(unexpected === 0 ? 0 : 1);
}

main();
