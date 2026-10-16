// The Billionaire: the 1st Edition and Open Beta printings print "You may use
// abilities on your opponent's cards as though you were your opponent. (The
// effect still happens to your opponent.)", so every cost of a borrowed
// ability, numeric included, is paid by the opponent
// (`canUseOpponentAbilities: "asOpponent"`). The 2nd Edition printing keeps
// `true` (it prints "pay any numeric cost with your own resources"). Run
// through the locked tool:
//
//   node scripts/card-audit/patch-cards.cjs data/card-audit/deferred/billionaire.patch.cjs
//
// Idempotent.

const FIRST_EDITION = "ff195e18-a459-4594-b155-8572b869f368";
const OPEN_BETA = "2ec131a8-26eb-4dd7-914d-ced1ca9e770c";
const SECOND_EDITION = "fb604d54-0aa5-40b5-9430-9d163e03fcc9";

module.exports = ({ patch }) => {
  const setBorrow = (value) => (card) => {
    const borrow = card.behavior.abilities.find((a) => a.id === "borrow");
    if (!borrow || borrow.canUseOpponentAbilities === undefined) {
      throw new Error(`${card.id} has no borrow ability`);
    }
    borrow.canUseOpponentAbilities = value;
  };
  patch(FIRST_EDITION, setBorrow("asOpponent"));
  patch(OPEN_BETA, setBorrow("asOpponent"));
  patch(SECOND_EDITION, setBorrow(true));
};
