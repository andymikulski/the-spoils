// sync-cards.js
//
// data/cards.json is the source of truth for card data. src/data/cards.js
// is a generated copy (as an ES module, since the app imports it directly)
// for the engine/app to consume. Copying only ever goes one way: this
// script reads data/cards.json and overwrites src/data/cards.js. Never
// hand-edit src/data/cards.js — edit data/cards.json and re-run this.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'data', 'cards.json');
const DEST = path.join(__dirname, '..', 'src', 'data', 'cards.js');

const json = fs.readFileSync(SOURCE, 'utf8');
const cards = JSON.parse(json);

const output = `export default ${JSON.stringify(cards, null, 2)}\n`;

fs.writeFileSync(DEST, output);

console.log(`Synced ${cards.length} cards from data/cards.json -> src/data/cards.js`);
