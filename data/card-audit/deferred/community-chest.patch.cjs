// Community Chest: "If you control at least [D] and choose to put this card on
// the bottom of your deck as part of your mulligan at the start of a game, you
// may reveal it. If you do, draw a card at the start of your turn."
//
// Adds the reveal as a deck-zone trigger on the `cardsMulliganed` event the
// opening mulligan emits (after the cards reach the bottom of the deck, before
// the replacements are drawn). The [D] gate is read at that moment, as printed;
// the optional "you may" is taken automatically (RULES.md section 5). Run
// through the locked tool:
//
//   node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/community-chest.patch.cjs
//
// Idempotent. Throws when the printing no longer has the draw ability the reveal
// sits next to (nothing is written).

const SEED_3 = "fe7095e0-d918-420c-9303-fbc5054d2564";

const REVEAL = {
  id: "chest-mulligan-reveal",
  type: "triggered",
  triggerZone: "deck",
  event: "cardsMulliganed",
  condition: {
    type: "and",
    conditions: [
      { type: "eventPlayerIs", player: "controller" },
      { type: "bottomedInMulligan" },
      {
        type: "numberCompare",
        left: { type: "resourceIcons", player: "controller", icon: "deception" },
        operator: ">=",
        right: 1
      }
    ]
  },
  effects: [{ type: "revealCards", target: "source" }]
};

module.exports = function communityChest({ patch }) {
  patch(SEED_3, (card) => {
    const abilities = card.behavior && card.behavior.abilities;
    const draw = abilities && abilities.findIndex((a) => a.id === "chest-mulligan-draw");
    if (!abilities || draw < 0) throw new Error(`${card.name} (${card.set}): no 'chest-mulligan-draw' ability`);
    const existing = abilities.findIndex((a) => a.id === REVEAL.id);
    if (existing >= 0) abilities[existing] = REVEAL;
    else abilities.splice(draw, 0, REVEAL);
  });
};

module.exports.REVEAL = REVEAL;
