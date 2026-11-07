// The card catalog on disk: data/sets.json lists every set in catalog order,
// and data/cards/<set id>.json holds that set's printings. The catalog is the
// concatenation of the set files in manifest order.
//
// Every script that reads or writes card data goes through this module so the
// layout and its invariants live in one place.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const SETS_PATH = path.join(ROOT, "data", "sets.json");
const CARDS_DIR = path.join(ROOT, "data", "cards");

/** The set id for a set name: lowercase, runs of non-alphanumerics become "-". */
function setId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function setPath(id) {
  return path.join(CARDS_DIR, `${id}.json`);
}

/** data/sets.json: `[{ id, name }]` in catalog order. */
function loadSets() {
  const sets = JSON.parse(fs.readFileSync(SETS_PATH, "utf8"));
  const ids = new Set();
  const names = new Set();
  for (const set of sets) {
    if (set.id !== setId(set.name)) throw new Error(`data/sets.json: "${set.name}" must have id "${setId(set.name)}", not "${set.id}"`);
    if (ids.has(set.id) || names.has(set.name)) throw new Error(`data/sets.json: "${set.name}" is listed twice`);
    ids.add(set.id);
    names.add(set.name);
  }
  const files = fs.readdirSync(CARDS_DIR).filter((file) => file.endsWith(".json"));
  for (const file of files) {
    if (!ids.has(file.slice(0, -".json".length))) throw new Error(`data/cards/${file} is not listed in data/sets.json`);
  }
  return sets;
}

/**
 * Reads and validates the whole catalog. Returns the sets with their printings
 * (`{ id, name, cards, text }`, `text` being the file's exact contents) and the
 * concatenated catalog.
 */
function loadCatalog() {
  const sets = loadSets().map((set) => {
    const file = setPath(set.id);
    if (!fs.existsSync(file)) throw new Error(`data/sets.json lists "${set.name}" but data/cards/${set.id}.json is missing`);
    const text = fs.readFileSync(file, "utf8");
    const cards = JSON.parse(text);
    for (const card of cards) {
      if (card.set !== set.name) throw new Error(`data/cards/${set.id}.json: ${card.id} (${card.name}) belongs to set "${card.set}"`);
    }
    return { ...set, cards, text };
  });
  const cards = sets.flatMap((set) => set.cards);
  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.id)) throw new Error(`printing id ${card.id} (${card.name}) appears more than once`);
    seen.add(card.id);
  }
  return { sets, cards };
}

/** The on-disk form of a set file. */
function serializeSet(cards) {
  return JSON.stringify(cards, null, 2).replace(/\n/g, "\r\n") + "\r\n";
}

function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text);
  fs.renameSync(temp, file);
}

/**
 * Splits `cards` into set files by each printing's `set`, keeping their
 * relative order, and writes only the files whose contents change. A printing
 * naming a set missing from data/sets.json throws before anything is written.
 * Returns the ids of the sets written.
 */
function writeCatalog(cards, sets = loadSets()) {
  const byName = new Map(sets.map((set) => [set.name, []]));
  for (const card of cards) {
    const bucket = byName.get(card.set);
    if (!bucket) throw new Error(`${card.id} (${card.name}) names set "${card.set}", which is not in data/sets.json`);
    bucket.push(card);
  }
  const written = [];
  fs.mkdirSync(CARDS_DIR, { recursive: true });
  for (const set of sets) {
    const file = setPath(set.id);
    const text = serializeSet(byName.get(set.name));
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) continue;
    writeAtomic(file, text);
    written.push(set.id);
  }
  return written;
}

module.exports = { ROOT, SETS_PATH, CARDS_DIR, setId, setPath, loadSets, loadCatalog, serializeSet, writeCatalog };
