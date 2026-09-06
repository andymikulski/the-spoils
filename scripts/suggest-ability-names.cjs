// Proposes AbilityDefinition.name values for unnamed activated abilities on
// non-tactic cards, sourced from the ALLCAPS keyword in the card's `text`.
// Output is advisory — review before writing to data/cards.json.
const fs = require('node:fs');
const path = require('node:path');

const cards = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'data', 'cards.json'), 'utf8')
);

const IGNORE = /^(COST|EFFECT|EXTRA COST|REQUIREMENT|REQUIRES|FLIP UP|RECUR|RETIRE|EXHUMATION|OPTION \d|MODE \d|ATTACH TO |UNIQUE |HIDDEN |PARTY|BATTLE|NODE\b|TREAT |NOTE)/;
const SMALL = new Set(['a', 'an', 'of', 'the', 'to', 'and', 'or', 'for', 'in', 'on']);

const titleCase = (kw) =>
  kw.toLowerCase().split(' ')
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');

const segments = (t) => (t || '').split(/\s--\s/).map((s) => s.trim());

function keywords(text) {
  const s = segments(text);
  const out = [];
  for (let i = 0; i < s.length - 1; i++) {
    const a = s[i], b = s[i + 1];
    if (
      /^[A-Z0-9][A-Z0-9 '!?.,-]{1,28}$/.test(a) &&
      /[A-Z]/.test(a) &&
      !IGNORE.test(a) &&
      /^(COST|REQUIREMENT|REQUIRES)\b/.test(b)
    ) {
      out.push(a);
    }
  }
  return out;
}

const rows = [];
for (const c of cards) {
  if (c.type === 'tactic') continue;
  const acts = (c.behavior?.abilities ?? []).filter((x) => x.type === 'activated');
  const unnamed = acts.filter((x) => !x.name);
  if (!unnamed.length) continue;

  const kws = keywords(c.text);
  const clean = kws.length === acts.length;

  acts.forEach((ability, idx) => {
    if (ability.name) return;
    const suggestion = clean && kws[idx] ? titleCase(kws[idx]) : '';
    rows.push([
      c.name,
      ability.id,
      suggestion,
      clean ? 'clean' : 'manual',
      clean ? '' : `candidates=${JSON.stringify(kws)}`,
      (c.text || '').replace(/\s+/g, ' ').slice(0, 200),
    ].join('\t'));
  });
}

console.log(['card', 'abilityId', 'suggestedName', 'confidence', 'notes', 'text'].join('\t'));
console.log(rows.join('\n'));
const clean = rows.filter((r) => r.split('\t')[3] === 'clean').length;
console.error(
  `${rows.length} unnamed in-scope abilities ` +
  `(${clean} clean / ${rows.length - clean} manual) ` +
  `across ${new Set(rows.map((r) => r.split('\t')[0])).size} unique card names`
);
