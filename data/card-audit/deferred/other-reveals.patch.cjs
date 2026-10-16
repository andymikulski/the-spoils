// Adds the reveal to every printing whose printed text reveals a card outside a
// search (searches are search-reveal.patch.cjs). Run through the locked tool:
//
//   node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/other-reveals.patch.cjs
//
// A printing's printed text is corrections.json[id].text when present, else the
// card's own `text`. Each rule below names a card and the sentence that makes a
// printing reveal; a printing whose text lacks the sentence is left alone, so a
// reprint that drops the word does not gain the effect. Idempotent: an effect
// already in its list is never inserted twice. A rule throws when the card's
// behavior no longer has the shape it expects (nothing is written).
//
// Reveals that live in the engine and need no card data (face-down "Reveal this
// card" abilities, Witty Worm / Unexpected Codicil's reveal-from-hand deploy,
// Auction House, Mustache Showdown) are not listed here.

const fs = require("node:fs");
const path = require("node:path");

const CORRECTIONS = path.join(__dirname, "..", "corrections.json");

function printedText(card, corrections) {
  const correction = corrections[card.id];
  return correction && correction.text !== undefined ? correction.text : card.text || "";
}

// --- effect builders -------------------------------------------------------

const revealTop = (of, count) => ({ type: "reveal", of, zone: "deckTop", count, viewer: "all" });
const revealHand = (of) => ({ type: "reveal", of, zone: "hand", viewer: "all" });
const revealPick = (selected) => ({ type: "revealCards", selected });

// --- helpers ---------------------------------------------------------------

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Inserts `effect` at `index` unless an identical effect is already in `list`. */
function addAt(list, index, effect) {
  if (list.some((existing) => same(existing, effect))) return;
  list.splice(index, 0, effect);
}

function ability(card, id) {
  const found = ((card.behavior && card.behavior.abilities) || []).find((a) => a.id === id);
  if (!found) throw new Error(`${card.name} (${card.set}): no ability '${id}'`);
  return found;
}

function effectsOf(card, abilityId) {
  const found = ability(card, abilityId);
  if (!Array.isArray(found.effects)) throw new Error(`${card.name} (${card.set}): '${abilityId}' has no effects`);
  return found.effects;
}

/** Depth-first search of an effect tree for the first node satisfying `test`. */
function findEffect(effects, test) {
  for (const effect of effects) {
    if (test(effect)) return effect;
    for (const key of ["effects", "elseEffects"]) {
      if (Array.isArray(effect[key])) {
        const inner = findEffect(effect[key], test);
        if (inner) return inner;
      }
    }
    if (Array.isArray(effect.options)) {
      for (const option of effect.options) {
        const inner = findEffect(option.effects || [], test);
        if (inner) return inner;
      }
    }
  }
  return undefined;
}

/** True when `effect` mentions the pick `id` (as `selected: id` or a `{ type: "selected", id }` ref). */
function mentions(effect, id) {
  const json = JSON.stringify(effect);
  return json.includes(`"selected":"${id}"`) || json.includes(`"type":"selected","id":"${id}"`);
}

/** Inserts `reveal` before the first effect that consumes `id` (looking inside `if` branches); false if none. */
function placeBeforeConsumer(effects, id, reveal) {
  for (let i = 0; i < effects.length; i++) {
    const effect = effects[i];
    if (effect.type === "if") {
      if (placeBeforeConsumer(effect.effects, id, reveal)) return true;
      if (effect.elseEffects && placeBeforeConsumer(effect.elseEffects, id, reveal)) return true;
      continue;
    }
    if (mentions(effect, id)) {
      addAt(effects, i, reveal);
      return true;
    }
  }
  return false;
}

/** Reveals the pick `id` right before the first effect in `effects` that uses it. */
function revealPickIn(effects, id) {
  const reveal = revealPick(id);
  if (JSON.stringify(effects).includes(JSON.stringify(reveal))) return;
  if (!placeBeforeConsumer(effects, id, reveal)) addAt(effects, 0, reveal);
}

/** The effect list of the `chooserSelectsTarget` that declares `declId`. */
function chooserEffects(effects, declId) {
  const chooser = findEffect(
    effects,
    (e) => e.type === "chooserSelectsTarget" && e.declaration && e.declaration.id === declId
  );
  if (!chooser) throw new Error(`no chooserSelectsTarget declaring '${declId}'`);
  return chooser.effects;
}

/** Puts `effect` first in every option of the (single) `chooserSelectsOption` in `effects`. */
function addToEveryOption(effects, effect) {
  const chooser = findEffect(effects, (e) => e.type === "chooserSelectsOption");
  if (!chooser) throw new Error("no chooserSelectsOption");
  for (const option of chooser.options) addAt(option.effects, 0, effect);
}

// --- rules -----------------------------------------------------------------

const RULES = [
  // "Reveal the top X cards of your opponent's deck" / "...top 7..." / "...top 5..."
  {
    name: "Jackmove",
    when: /reveal (?:up to )?the top X cards of your opponent's deck/i,
    apply: (card) =>
      addAt(effectsOf(card, "body"), 0, revealTop("opponent", { type: "variable", id: "x" }))
  },
  {
    name: "Eccentric Inquisition",
    when: /reveal the top 7 cards of your opponent's deck/i,
    apply: (card) => addAt(effectsOf(card, "body"), 0, revealTop("opponent", 7))
  },
  {
    name: "Rosy Palmer, and Her Five Friends",
    when: /reveal the top 5 cards of (?:your|an) opponent's deck/i,
    apply: (card) => addAt(effectsOf(card, "parting-gift"), 0, revealTop("opponent", 5))
  },
  {
    name: "Meager Research",
    when: /reveal the top card of your opponent's deck/i,
    apply: (card) => addAt(effectsOf(card, "body"), 0, revealTop("opponent", 1))
  },

  // "Look at the top N cards ... choose X among them and reveal it"
  {
    name: "Intellectual Reliquary",
    when: /choose a tactic among them and reveal it/i,
    apply: (card) => revealPickIn(effectsOf(card, "imbibe"), "pick")
  },
  {
    name: "Gilda, Mother of Gideon",
    when: /reveal a tactic among them/i,
    apply: (card) => revealPickIn(effectsOf(card, "peek"), "tac")
  },
  {
    name: "Auspicious Arrival",
    when: /character among them with 1 strength or less and reveal it/i,
    apply: (card) => revealPickIn(effectsOf(card, "auspicious-arrival-play"), "pick")
  },

  // "Reveal the top card of your deck" (own deck)
  {
    // "you may choose a card type. If you do, reveal the top card" - after the choice.
    name: "Dauntless Gambler",
    when: /if you do, reveal the top card of your deck/i,
    apply: (card) => addToEveryOption(effectsOf(card, "etb"), revealTop("controller", 1))
  },
  {
    name: "Flailing Knife",
    when: /if you do, reveal the top card of your deck/i,
    apply: (card) => addToEveryOption(effectsOf(card, "reattach"), revealTop("controller", 1))
  },
  {
    name: "Flimflam Man",
    when: /if you do, reveal the top card of your deck/i,
    apply: (card) => addToEveryOption(effectsOf(card, "etb"), revealTop("controller", 1))
  },
  {
    name: "Opportune Slotpuller",
    when: /effect: reveal the top card of your deck/i,
    apply: (card) => addToEveryOption(effectsOf(card, "gamble"), revealTop("controller", 1))
  },
  {
    name: "Gambling Den",
    when: /at the start of your turn, reveal the top card of your deck/i,
    apply: (card) => addAt(effectsOf(card, "wheel"), 0, revealTop("controller", 1))
  },
  {
    name: "Roulette Wheel of DOOM!",
    when: /reveal the top card of your deck/i,
    apply: (card) => addAt(effectsOf(card, "body"), 0, revealTop("controller", 1))
  },
  {
    // "you may reveal ..." - the optional reveal sits inside the mayPay.
    name: "Prophetic Assistant",
    when: /you may reveal the top card of your deck/i,
    apply: (card) => {
      const mayPay = findEffect(effectsOf(card, "prophetic-peek"), (e) => e.type === "mayPay");
      if (!mayPay) throw new Error("no mayPay");
      addAt(mayPay.effects, 0, revealTop("controller", 1));
    }
  },
  {
    name: "Dweedle Tee",
    when: /effect: reveal the top card of your deck/i,
    apply: (card) => addAt(effectsOf(card, "dweedle-bulge"), 0, revealTop("controller", 1))
  },
  {
    name: "Sharpey Pointy Lethal Army Tool",
    when: /reveal the top card of your deck/i,
    apply: (card) => addAt(effectsOf(card, "sharpey-unfold"), 0, revealTop("controller", 1))
  },
  {
    // "Shuffle your deck and then reveal the top card" - after the shuffle.
    name: "Barracks of Precipitancy",
    when: /shuffle your deck and then reveal the top card/i,
    apply: (card) => {
      const effects = effectsOf(card, "bop-gotime");
      const shuffle = effects.findIndex((e) => e.type === "shuffleDeck");
      if (shuffle < 0) throw new Error("no shuffleDeck");
      addAt(effects, shuffle + 1, revealTop("controller", 1));
    }
  },
  {
    // 1st Edition Part 2's CHEAT says "look at"; only the 2nd Edition text reveals.
    name: "Cheats McGuillicutty",
    when: /effect: reveal the top card of your deck/i,
    apply: (card) => addAt(effectsOf(card, "cheat"), 0, revealTop("controller", 1))
  },

  // "...reveals their hand"
  {
    name: "Discommodiousness",
    when: /reveals? their hand/i,
    apply: (card) => addAt(effectsOf(card, "body"), 0, revealHand("opponent"))
  },
  {
    name: "Spatchcocking",
    when: /each opponent reveals their hand/i,
    apply: (card) => addAt(effectsOf(card, "spatchcocking-recur"), 0, revealHand("opponent"))
  },

  // A pick that is revealed
  {
    name: "Demolition Investment",
    when: /that player reveals a face-down resource/i,
    apply: (card) => revealPickIn(chooserEffects(effectsOf(card, "body"), "r"), "r")
  },
  {
    name: "I Drink Your Milkshake!",
    when: /you may reveal the (?:removed|voided) card/i,
    apply: (card) => revealPickIn(chooserEffects(effectsOf(card, "milkshake-echo"), "voided"), "voided")
  },
  {
    // EXTRA COST: three characters from your hand, shown before the opponent chooses among them.
    name: "Enter The Demon Knights",
    when: /reveal 3 characters/i,
    apply: (card) => addAt(effectsOf(card, "body"), 0, revealPick("revealed"))
  },

  // "COST: Reveal a face-down <type> you control" - the pick is declared as a target.
  ...[
    ["Manifest", "manifest", "rev"],
    ["Hidden Ruins", "ruins-play", "loc"],
    ["Accidental Invention", "accidental-invention", "revealed"],
    ["Burly Assailment", "assail-play", "rev"],
    ["Implosive Explosion", "implosive-explosion", "fdres"],
    ["Gang Weapon Dealer", "gwd-delivery", "g"]
  ].map(([name, abilityId, pickId]) => ({
    name,
    when: /reveal a face-down/i,
    apply: (card) => addAt(effectsOf(card, abilityId), 0, revealPick(pickId))
  })),

  // "you may reveal this card" from the hand, before the optional deploy.
  {
    name: "Thabbashite Desert Creature",
    when: /you may reveal this card when/i,
    apply: (card) => {
      const mayPay = findEffect(effectsOf(card, "emerge"), (e) => e.type === "mayPay");
      if (!mayPay) throw new Error("no mayPay");
      addAt(mayPay.effects, 0, { type: "revealCards", target: "source" });
    }
  },

  // "COST: Reveal a resource from your hand and shuffle it into your deck" - paid as a cost.
  {
    name: "Uhluhtc Niudla",
    when: /cost: reveal a resource from your hand and shuffle it into your deck/i,
    apply: (card) => {
      const cost = (ability(card, "uhluhtc-avail").costs || []).find((c) => c.type === "moveSelected" && c.id === "rev");
      if (!cost) throw new Error("no moveSelected cost 'rev'");
      cost.reveal = true;
    }
  }
];

const RULES_BY_NAME = new Map();
for (const rule of RULES) {
  if (!RULES_BY_NAME.has(rule.name)) RULES_BY_NAME.set(rule.name, []);
  RULES_BY_NAME.get(rule.name).push(rule);
}

module.exports = function otherReveals({ cards, patch }) {
  const corrections = JSON.parse(fs.readFileSync(CORRECTIONS, "utf8"));
  for (const card of cards) {
    const rules = RULES_BY_NAME.get(card.name);
    if (!rules) continue;
    const text = printedText(card, corrections);
    for (const rule of rules) {
      if (!rule.when.test(text)) continue;
      patch(card.id, (target) => rule.apply(target));
    }
  }
};

module.exports.RULES = RULES;
module.exports.printedText = printedText;
