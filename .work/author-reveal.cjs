#!/usr/bin/env node
/* author-reveal.cjs — re-author the cards that need the new reveal
 * primitives (revealFromTopUntil, grantsReveal continuous). Patches every
 * printing of each named card.
 *
 *   node .work/author-reveal.cjs [--dry]  ; then: npm run sync-cards
 */
const fs = require("fs");
const path = require("path");
const CARDS = path.resolve(__dirname, "..", "data", "cards.json");
const DRY = process.argv.includes("--dry");

const cards = JSON.parse(fs.readFileSync(CARDS, "utf8"));
const byName = new Map();
for (const c of cards) {
  if (!byName.has(c.name)) byName.set(c.name, []);
  byName.get(c.name).push(c);
}
const touched = [];
const patch = (name, fn) => {
  for (const c of byName.get(name) ?? []) {
    fn(c);
    touched.push(`${c.set} / ${c.name}`);
  }
};
const cand = { type: "selected", id: "__candidate" };

// ---- Surprise! ---------------------------------------------------------------
// "Reveal cards from the top of your deck until a character with numeric
//  cost X or less is revealed or no cards are left. If an appropriate
//  character is revealed, put it into play ... as a member of the blocking
//  party. Shuffle all other revealed cards into your deck."
patch("Surprise!", c => {
  const body = c.behavior.abilities.find(a => a.id === "body");
  body.effects = [
    { type: "bind", id: "x", value: { type: "cardCost", target: { type: "selected", id: "k" } } },
    {
      type: "revealFromTopUntil",
      player: "controller",
      match: {
        type: "and",
        conditions: [
          { type: "cardTypeIs", target: cand, cardType: "character" },
          {
            type: "numberCompare",
            left: { type: "cardCost", target: cand },
            operator: "<=",
            right: { type: "variable", id: "x" }
          }
        ]
      },
      bindAs: "rec",
      onMatch: [
        { type: "putIntoPlay", target: { type: "selected", id: "rec" }, controller: "controller" },
        { type: "addToBattle", target: { type: "selected", id: "rec" }, side: "blocking" }
      ],
      rest: "shuffle"
    }
  ];
});

// ---- "revealed at all times" cycle -----------------------------------------
const revealHead = (id, zone, of) => ({ id, type: "continuous", modifiers: [], grantsReveal: { zone, of } });
const prependReveal = (name, id, zone, of) =>
  patch(name, c => {
    c.behavior.abilities = c.behavior.abilities.filter(a => a.id !== id);
    c.behavior.abilities.unshift(revealHead(id, zone, of));
  });

// "The top card of your deck is revealed at all times."
prependReveal("Cheats McGuillicutty", "cheats-topcard-public", "deckTop", "self");
prependReveal("Axeclaw Grandchest", "axeclaw-topcard-public", "deckTop", "self");
// "The top card of each opponent's deck is revealed at all times."
prependReveal("Bottlebeard Brandyshanks", "bottlebeard-topcard-public", "deckTop", "opponent");
// "Each opponent's hand is revealed at all times."
prependReveal("Odious Diva", "odious-diva-hand-public", "hand", "opponent");

console.log(`patched ${touched.length} printings:`);
for (const t of [...new Set(touched)]) console.log(`  ${t}`);
if (DRY) console.log("(dry run)");
else {
  fs.writeFileSync(CARDS, JSON.stringify(cards, null, 2) + "\n");
  console.log("wrote data/cards.json");
}
