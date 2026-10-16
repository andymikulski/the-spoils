// Emergency Obfuscation: adds the seat swap ("While this card is in play, both
// players switch seats. Both players are in control of their opponent's side.
// If the game ends, the owner of the winning deck wins the game.") as a
// continuous `swapsSides` ability on every printing. The start-of-turn token and
// end-of-turn self-destruct abilities were already authored.
//
//   node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/emergency-obfuscation.patch.cjs
//
// Idempotent: a printing that already has the ability is left alone.

module.exports = ({ cards, patch }) => {
  const printings = cards.filter((card) => card.name === "Emergency Obfuscation");
  if (printings.length === 0) throw new Error("no Emergency Obfuscation printings found");
  for (const printing of printings) {
    patch(printing.id, (card) => {
      const abilities = card.behavior.abilities;
      if (abilities.some((ability) => ability.type === "continuous" && ability.swapsSides)) return;
      abilities.unshift({ id: "swap", type: "continuous", modifiers: [], swapsSides: true });
    });
  }
};
