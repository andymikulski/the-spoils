// Locked read-modify-write of data/cards.json for behavior/field fixes, then sync-cards.
// Several sessions may fix cards at once; every edit to data/cards.json goes through here.
//
//   node scripts/card-audit/patch-cards.cjs <patch-module.cjs>
//
// The patch module exports `function (api) { ... }` where api is
// { cards, byId, patch(id, fn), walk(node, fn) }. `patch` logs whether the
// printing's behavior changed. Ids not found throw, and nothing is written.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..", "..");
const CARDS = path.join(ROOT, "data", "cards.json");
const LOCK = path.join(ROOT, "data", "card-audit", ".cards-lock");

function lock() {
  const started = Date.now();
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      return;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 120_000) fs.rmSync(LOCK, { recursive: true, force: true });
      } catch {}
      if (Date.now() - started > 300_000) throw new Error(`Timed out waiting for ${LOCK}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

function walk(node, fn) {
  if (Array.isArray(node)) node.forEach((child) => walk(child, fn));
  else if (node && typeof node === "object") {
    fn(node);
    Object.values(node).forEach((child) => walk(child, fn));
  }
}

function main() {
  const modulePath = process.argv[2];
  if (!modulePath) throw new Error("usage: node scripts/card-audit/patch-cards.cjs <patch-module.cjs>");
  const patchModule = require(path.resolve(modulePath));
  lock();
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
    const byId = new Map(cards.map((card) => [card.id, card]));
    const patch = (id, fn) => {
      const card = byId.get(id);
      if (!card) throw new Error(`no printing ${id}`);
      const before = JSON.stringify(card);
      fn(card);
      console.log(`${card.name} (${card.set}) ${before === JSON.stringify(card) ? "unchanged" : "patched"}`);
    };
    patchModule({ cards, byId, patch, walk });
    const temp = `${CARDS}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(cards, null, 2).replace(/\n/g, "\r\n") + "\r\n");
    fs.renameSync(temp, CARDS);
    execFileSync(process.execPath, [path.join(ROOT, "scripts", "sync-cards.cjs")], { stdio: "ignore" });
  } finally {
    fs.rmSync(LOCK, { recursive: true, force: true });
  }
}

main();
