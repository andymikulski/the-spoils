// Turns on `revealCards` for every printing whose printed text reveals the card
// it searched for. Run through the locked tool:
//
//   node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/search-reveal.patch.cjs
//
// A printing's printed text is corrections.json[id].text when present, else the
// card's own `text`. A search sentence "reveals" when it, or the sentence right
// after it, says "reveal it/them/the card". Idempotent: a pick that already has
// a `revealCards` for its declaration is skipped.

const fs = require("node:fs");
const path = require("node:path");

const CORRECTIONS = path.join(__dirname, "..", "corrections.json");

/** Printings whose search sentence is not covered by the generic text test. */
const FORCE = new Set([]);

function loadCorrections() {
  return JSON.parse(fs.readFileSync(CORRECTIONS, "utf8"));
}

function printedText(card, corrections) {
  const correction = corrections[card.id];
  return correction && correction.text !== undefined ? correction.text : card.text || "";
}

/** True when some search sentence in `text` also reveals what it found. */
function textRevealsSearch(text) {
  const segments = text.split(/(?<=[.!?])\s+|\s--\s/);
  return segments.some(
    (segment, i) =>
      /search/i.test(segment) &&
      (/reveal/i.test(segment) || /reveal (it|them|the card)/i.test(segments[i + 1] || ""))
  );
}

/** Every deck-zone TargetDeclaration under `root`, with the object that owns its effect list. */
function findDeckDeclarations(root) {
  const found = [];
  (function visit(node, parent, key) {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, node, key));
    } else if (node && typeof node === "object") {
      // chooserSelectsTarget: { declaration: { selector.zone: "deck" }, effects }
      if (
        node.type === "chooserSelectsTarget" &&
        node.declaration &&
        node.declaration.selector &&
        node.declaration.selector.zone === "deck"
      ) {
        found.push({ kind: "chooser", id: node.declaration.id, host: node, effects: node.effects, parentArray: parent });
      }
      // ability / mode / onPlay: { targets: [declaration...], effects }
      if (Array.isArray(node.targets) && Array.isArray(node.effects)) {
        for (const declaration of node.targets) {
          if (declaration.selector && declaration.selector.zone === "deck") {
            found.push({ kind: "targets", id: declaration.id, host: node, effects: node.effects });
          }
        }
      }
      for (const [k, v] of Object.entries(node)) visit(v, node, k);
    }
  })(root, null, null);
  return found;
}

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
      effects.splice(i, 0, reveal);
      return true;
    }
  }
  return false;
}

function alreadyRevealed(effects, id) {
  return JSON.stringify(effects).includes(`"type":"revealCards","selected":"${id}"`);
}

// Ecto-Distillation picks every copy it finds (`found`) and reveals them all; `one` only chooses
// which already-revealed copy goes to hand, and `opp` is the opponent's own search (no reveal).
const SKIP = { "Ecto-Distillation": new Set(["one", "opp"]) };

function patchCard(card) {
  const roots = { behavior: card.behavior, faction: card.faction };
  const skip = SKIP[card.name] || new Set();
  let changed = 0;
  for (const found of findDeckDeclarations(roots)) {
    if (skip.has(found.id) || alreadyRevealed(found.effects, found.id)) continue;
    const reveal = { type: "revealCards", selected: found.id };
    if (!placeBeforeConsumer(found.effects, found.id, reveal)) found.effects.unshift(reveal);
    changed++;
  }
  // A faction's STARTING DRAW search is engine-driven (no effect list to insert into): flag it.
  const startingDrawSearch = card.faction && card.faction.setup && card.faction.setup.startingDrawSearch;
  if (startingDrawSearch && !startingDrawSearch.reveal) {
    startingDrawSearch.reveal = true;
    changed++;
  }
  return changed;
}

module.exports = function searchReveal({ cards, patch }) {
  const corrections = loadCorrections();
  for (const card of cards) {
    if (!FORCE.has(card.id) && !textRevealsSearch(printedText(card, corrections))) continue;
    if (!card.behavior && !card.faction) continue;
    patch(card.id, (target) => {
      patchCard(target);
    });
  }
};

module.exports.textRevealsSearch = textRevealsSearch;
module.exports.printedText = printedText;
module.exports.patchCard = patchCard;
module.exports.findDeckDeclarations = findDeckDeclarations;
