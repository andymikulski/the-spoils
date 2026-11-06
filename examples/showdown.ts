// Usage example: a three-player Showdown game (docs/rules/showdown-rules.md) —
// one Villain playing The Evil Alliance against two Heroes, a shared Hero Deck
// and the Slightly Less Evil Alliance on the table.
//
//   npx tsx examples/showdown.ts
//
// A consumer imports the same names from "the-spoils" and "the-spoils/data".
import { createFactionGame, getLoyalty, opponentsOf, redactStateFor } from "../src/engine.js";
import { CARD_CATALOG } from "../src/data.js";
// The package ships no decklists; these are the test suite's two real-card decks.
import { ARCANIST_DECK_IDS, WARLORD_DECK_IDS } from "../src/engine/__tests__/support/decks.js";

const byName = (name: string, type?: string) => {
  const card = CARD_CATALOG.find(c => c.name === name && (!type || c.type === type));
  if (!card) throw new Error(`No catalog card named '${name}'.`);
  return card.id;
};

// Each deck names its own faction; the Villain's deck swaps in The Evil Alliance.
const withoutFaction = (ids: readonly string[]) =>
  ids.filter(id => CARD_CATALOG.find(c => c.id === id)?.type !== "faction");
const villainDeck = [byName("The Evil Alliance", "faction"), ...withoutFaction(WARLORD_DECK_IDS)];

// A Hero Deck: a handful of characters and tactics every Hero can reach through effects (SD 3).
const heroDeck = CARD_CATALOG.filter(c => (c.type === "character" || c.type === "tactic") && c.set === "Seed 3").map(c => c.id);

const game = createFactionGame(
  CARD_CATALOG,
  [
    { id: "villain", name: "The Villain", deckDefinitionIds: villainDeck },
    { id: "hero1", name: "Hero One", deckDefinitionIds: ARCANIST_DECK_IDS },
    { id: "hero2", name: "Hero Two", deckDefinitionIds: WARLORD_DECK_IDS }
  ],
  {
    seed: 2026,
    format: { kind: "showdown", villainId: "villain" },
    showdown: { heroDeck, sharedFactionDefinitionId: byName("Slightly Less Evil Alliance", "faction") }
  }
);

for (const player of Object.values(game.state.players)) {
  console.log(
    `${player.name}: ${player.influence} influence, opponents ${opponentsOf(game.state, player.id).join(", ")}`
  );
}

// Allegiance cards are dealt face-down (SD 6): the Villain sees them all, a Hero only their own (SD 7).
console.log("Villain sees:", redactStateFor(game.state, "villain").showdown?.allegiance);
console.log("Hero One sees:", redactStateFor(game.state, "hero1").showdown?.allegiance);
console.log("Hero One is loyal to:", getLoyalty(game.state, "hero1"));
console.log(`Hero Deck: ${game.state.showdown?.heroDeck.length} cards; Temptation Pile: empty`);
console.log("flow:", game.getFlowView().mode);
