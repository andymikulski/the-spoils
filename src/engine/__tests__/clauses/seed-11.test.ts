// Clause tests — batch seed-11: five Seed "starter" faction cards that share one
// rules skeleton (STARTING RESOURCES / STARTING DRAW / RESTORE RULE / DEVELOP RULE
// / DRAW / RESOURCE) and each print one ability of their own:
//   Moist Cave of the Darkpump  (LUCUBRATE)
//   Order of the Golden String  (CONSPIRE)
//   Alliance of Handy Weirdos   ("ENHANCE")
//   Drowned Catacombs           (SNEAK)
//   Hall of Great Justice       (FOR GREAT JUSTICE!)
// See docs/TESTING.md and `npm run card-tests -- manifest seed-11`.
// Expectations come from each card's PRINTED text and RULES.md (§3.5 Resource,
// §3.6 Faction, §4 costs, §5 Setup, §6 Turn structure, §10 Abilities); engine data
// (ability ids, target declaration ids, choice kinds) is only used to DRIVE the engine.
//
// Two ways of building a game are used:
//   - `setupGame(...)` runs the REAL setup path with the faction printing under
//     test, for STARTING RESOURCES / STARTING DRAW;
//   - `buildGame(...)` places a mid-game board directly, for the turn rules
//     (RESTORE / DEVELOP) and the faction's printed abilities.
//
// The shared rules are written once as body functions taking the faction record
// and then called with a literal printing id per group (the coverage scan can't
// see through a loop).

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  location,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "../per-card/_harness.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import {
  battleOf,
  declareAttackBy,
  declareAttackOpenWindow,
  fightThrough
} from "./_battle.js";
import { answerPending, fillers, pending, zoneOf } from "./_board.js";
import { clause, declineAll, printing, refused, holdResourceFace } from "./_clause.js";
import type { Seat } from "./_turn.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, spentResources, developOffers, endTurnRaw, openDevelopPlay } from "./_turn.js";
import { settleTurnStart } from "../support/develop.js";

// --- the five printings under test ---------------------------------------------

const MOIST = "531708e9-3e7d-4027-92f9-e48fb15b60b4";
const GOLDEN = "ab1299d1-ad28-478d-b28e-10763f63d464";
const ALLIANCE = "0cca365d-3cc2-4b48-9f41-ab663ea0b25a";
const CATACOMBS = "9d0ed925-fc2d-4745-82c0-68f90bf5d576";
const HALL = "0e3786c7-c515-4958-8b04-e6b1fb5ee388";

// --- the real staple resources (the cards' STARTING RESOURCES name one of them) ----

const OBSESSION = printing("0c287282-82cf-4602-b37d-35d1bbea519c");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ALL_STAPLES = [OBSESSION, GREED, RAGE, ELITISM, DECEPTION];

// A resource card that is NOT a staple, and a plain filler card.
const ODD = resourceCard({ id: "s11-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "s11-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second, a normal Develop Rule.
const PLAIN_OPP = factionCard({
  id: "s11-plain-opp",
  name: "Plain Opponent",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const plainOppDeck = (): CardDefinition[] => [RAGE, RAGE, ...repeat(FILLER, 40)];

// --- the faction records the shared bodies take -----------------------------------

interface Fac {
  /** The printing under test. */
  id: string;
  /** The resource card named by STARTING RESOURCES ("1 Obsession, ..."). */
  named: CardDefinition;
  /** Engine ids of the DRAW and RESOURCE abilities (only used to drive the engine). */
  draw: string;
  resource: string;
}

const F_MOIST: Fac = { id: MOIST, named: OBSESSION, draw: "moistcave-draw", resource: "moistcave-resource" };
const F_GOLDEN: Fac = { id: GOLDEN, named: GREED, draw: "golden-draw", resource: "golden-resource" };
const F_ALLIANCE: Fac = { id: ALLIANCE, named: ELITISM, draw: "alliance-draw", resource: "alliance-resource" };
const F_CATACOMBS: Fac = { id: CATACOMBS, named: DECEPTION, draw: "catacombs-draw", resource: "catacombs-resource" };
const F_HALL: Fac = { id: HALL, named: RAGE, draw: "hall-draw", resource: "hall-resource" };

/** A staple that is not the named one. */
const otherStaple = (fac: Fac): CardDefinition => (fac.named.id === RAGE.id ? GREED : RAGE);
/** The four staples that are not the named one. */
const otherStaples = (fac: Fac): CardDefinition[] => ALL_STAPLES.filter((def) => def.id !== fac.named.id);
/** The icon a staple resource provides (the staples are named after their icon). */
const iconOf = (def: CardDefinition): string => def.name.toLowerCase();
const thresholdsOf = (engine: SpoilsEngine, pid: PlayerId): Record<string, number> => engine.getThresholds(pid) as unknown as Record<string, number>;

// --- small readers -----------------------------------------------------------------

const handOf = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] => engine.state.players[pid].hand;
const deckOf = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] => engine.state.players[pid].deck;
const discardOf = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] => engine.state.players[pid].discard;
const handSize = (engine: SpoilsEngine, pid: PlayerId): number => handOf(engine, pid).length;
const playCards = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] =>
  engine.state.players[pid].play.filter((cardId) => engine.getDefinition(cardId).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((cardId) => engine.getDefinition(cardId).name).sort();
const other = (pid: PlayerId): PlayerId => (pid === P1 ? P2 : P1);
const factionKey = (owner: PlayerId): string => (owner === P1 ? "__factionA" : "__factionB");

// --- real-setup helpers ---------------------------------------------------------------

const seatOf = (fac: Fac, deck: CardDefinition[]): Seat => ({ faction: printing(fac.id), deck });
const oppSeat = (): Seat => ({ faction: PLAIN_OPP, deck: plainOppDeck() });
/** A 42-card deck holding the named resource and one other staple (so the starting resources are fully determined). */
const deck42 = (fac: Fac): CardDefinition[] => [otherStaple(fac), fac.named, ...repeat(FILLER, 40)];

// --- board helpers --------------------------------------------------------------------

/** A mid-game board with `faction` in seat `mine` and an ordinary Develop-Rule faction opposite. */
function seatGame(faction: CardDefinition, mine: PlayerId, active: PlayerId, cards: CardPlacement[]) {
  return buildGame({
    playerA: { faction: mine === P1 ? faction : developFaction() },
    playerB: { faction: mine === P2 ? faction : developFaction() },
    activePlayerId: active,
    cards
  });
}

function activateFaction(
  engine: SpoilsEngine,
  pid: PlayerId,
  abilityId: string,
  owner: PlayerId = pid,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected, variables });
  resolvePendingResponses(engine);
}

/** Activates WITHOUT draining the response window (to assert what's true while the ability waits for responses). */
function activateFactionRaw(
  engine: SpoilsEngine,
  pid: PlayerId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, pid), abilityId, selected, variables });
}

/** Answers the open "which card?" pick (the RESOURCE / CONSPIRE style `chooserSelectsTarget`) with `cardIds`. */
function pick(engine: SpoilsEngine, cardIds: CardInstanceId[]): void {
  answerPending(engine, "chooserSelectsTarget", { selected: cardIds });
}

// =====================================================================================
// STARTING RESOURCES: "1 <Name>, 1 staple resource."
// =====================================================================================

const startsNamedAndStaple = (fac: Fac) => () => {
  const other1 = otherStaple(fac);
  const engine = setupGame(seatOf(fac, deck42(fac)), oppSeat());
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources: the named one and one staple");
  assert.deepEqual(namesIn(engine, mine), [fac.named.name, other1.name].sort());
  for (const cardId of mine) assert.equal(engine.state.cards[cardId].faceDown, false, "flipped face-up after setup");
  const thresholds = thresholdsOf(engine, P1);
  assert.equal(thresholds[iconOf(fac.named)], 1, `one ${fac.named.name} icon`);
  assert.equal(thresholds[iconOf(other1)], 1, `one ${other1.name} icon`);
  assert.equal(readyCount(engine, P1), 2, "both are resources I can pay with");
};

const namedSlotIsThatResource = (fac: Fac) => () => {
  // The named resource sits deep in the deck behind four other staples: "1 <Name>" still means THAT card.
  const others = otherStaples(fac);
  const engine = setupGame(seatOf(fac, [...others, ...repeat(FILLER, 10), fac.named, ...repeat(FILLER, 30)]), oppSeat());
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2);
  const names = namesIn(engine, mine);
  assert.equal(names.filter((name) => name === fac.named.name).length, 1, `exactly one ${fac.named.name}`);
  const rest = names.filter((name) => name !== fac.named.name);
  assert.equal(rest.length, 1, "and one other card");
  assert.ok(others.some((def) => def.name === rest[0]), `the other card (${rest[0]}) is a staple resource`);
  assert.equal(thresholdsOf(engine, P1)[iconOf(fac.named)], 1);
};

const nonStapleIsNotAStaple = (fac: Fac) => () => {
  const other1 = otherStaple(fac);
  // The non-staple resource is first in the deck, so a careless "any resource" pick would take it.
  const engine = setupGame(seatOf(fac, [ODD, fac.named, other1, ...repeat(FILLER, 40)]), oppSeat());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), [fac.named.name, other1.name].sort(), "the non-staple resource is not a staple resource");
  const oddCard = Object.values(engine.state.cards).find((card) => card.definitionId === ODD.id)!;
  assert.notEqual(oddCard.zone, "play", "it stays out of play");
  assert.equal(thresholdsOf(engine, P1).elitism ?? 0, fac.named.id === ELITISM.id ? 1 : 0, "and its Elitism icon never shows up");
};

const stapleMayBeTheNamedKindToo = (fac: Fac) => () => {
  // Two copies of the named staple and no other staple at all: "1 staple resource" can be a second copy.
  const engine = setupGame(seatOf(fac, [fac.named, fac.named, ...repeat(FILLER, 40)]), oppSeat());
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), [fac.named.name, fac.named.name]);
  assert.equal(thresholdsOf(engine, P1)[iconOf(fac.named)], 2);
};

const exactlyTwoStartingResources = (fac: Fac) => () => {
  const deck = [...ALL_STAPLES, ...ALL_STAPLES, ...ALL_STAPLES, ...repeat(FILLER, 30)];
  const engine = setupGame(seatOf(fac, deck), oppSeat());
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "two starting resources, never more");
  assert.ok(namesIn(engine, mine).includes(fac.named.name), "one of them is the named resource");
  const icons = Object.values(thresholdsOf(engine, P1)).reduce((sum, n) => sum + (n ?? 0), 0);
  assert.equal(icons, 2, "two icons in total");
};

const startingResourcesComeFromTheDeck = (fac: Fac) => () => {
  const first = setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P1 });
  assert.equal(deckOf(first, P1).length, 42 - 2 - 8, "42 cards, 2 starting resources, 8 in the opening hand");
  assert.equal(handSize(first, P1) + deckOf(first, P1).length + playCards(first, P1).length, 42, "no card appears from nowhere");
  const second = setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P2 });
  assert.equal(deckOf(second, P1).length, 42 - 2 - 9);
};

const startingResourcesOpponentUnaffected = (fac: Fac) => () => {
  const engine = setupGame(seatOf(fac, deck42(fac)), { faction: PLAIN_OPP, deck: [GREED, ELITISM, ...repeat(FILLER, 40)] });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Elitism", "Greed"], "the opponent starts with their own two staples");
  assert.equal(playCards(engine, P1).length, 2);
};

const startingResourcesSecondSeat = (fac: Fac) => () => {
  for (const first of [P1, P2]) {
    const engine = setupGame(oppSeat(), seatOf(fac, deck42(fac)), { first });
    assert.deepEqual(namesIn(engine, playCards(engine, P2)), [fac.named.name, otherStaple(fac).name].sort(), `faction in seat 2, ${first} goes first`);
    assert.equal(playCards(engine, P1).length, 2, "the other seat still starts with its own two");
  }
};

const playerChoosesTheStaple = (fac: Fac) => () => {
  // "1 staple resource": a free choice among the staples in my deck, so with the choose-starting-resources step on I must be asked.
  const engine = setupGame(seatOf(fac, [...otherStaples(fac), fac.named, ...repeat(FILLER, 30)]), oppSeat(), { choose: true });
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "I am asked which staple resource to start with");
  const order = (engine.state.setup as unknown as { order?: PlayerId[] }).order;
  assert.ok(order?.includes(P1), "and it is my decision");
};

// =====================================================================================
// STARTING DRAW: "8 going first, 9 going second."
// =====================================================================================

const drawsEightGoingFirst = (fac: Fac) => () => {
  const engine = setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P1 });
  assert.equal(handSize(engine, P1), 8);
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 8, "the 8 cards came out of the deck");
};

const drawsNineGoingSecond = (fac: Fac) => () => {
  const engine = setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P2 });
  assert.equal(handSize(engine, P1), 9);
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 9, "the 9 cards came out of the deck");
};

const startingDrawLeavesOpponentAlone = (fac: Fac) => () => {
  assert.equal(handSize(setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P1 }), P2), 8, "opponent going second keeps their 8");
  assert.equal(handSize(setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P2 }), P2), 7, "opponent going first keeps their 7");
};

const startingDrawSecondSeat = (fac: Fac) => () => {
  const first = setupGame(oppSeat(), seatOf(fac, deck42(fac)), { first: P2 });
  assert.equal(handSize(first, P2), 8, "faction in seat 2, going first");
  assert.equal(handSize(first, P1), 8, "(the plain opponent going second draws its own 8)");
  const second = setupGame(oppSeat(), seatOf(fac, deck42(fac)), { first: P1 });
  assert.equal(handSize(second, P2), 9, "faction in seat 2, going second");
  assert.equal(handSize(second, P1), 7, "(the plain opponent going first draws its own 7)");
};

const startingDrawIsNotTheStartingResources = (fac: Fac) => () => {
  // The cards drawn are an opening HAND: the two starting resources are in play, not among the drawn cards.
  const engine = setupGame(seatOf(fac, deck42(fac)), oppSeat(), { first: P1 });
  const inPlay = new Set(playCards(engine, P1));
  assert.equal(handOf(engine, P1).filter((cardId) => inPlay.has(cardId)).length, 0);
  assert.equal(handSize(engine, P1), 8, "the 8 are drawn in addition to the two starting resources");
};

// =====================================================================================
// RESTORE RULE: "At the start of your turn, restore all your depleted cards and detach
// all resources from your faction."
// =====================================================================================

function restoreBoard(faction: CardDefinition, active: PlayerId, mine: PlayerId = P1) {
  const foe = other(mine);
  return seatGame(faction, mine, active, [
    { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: mine, depleted: true },
    { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: mine, depleted: true },
    { key: "mineLoc", def: location({ name: "My Depleted Location" }), owner: mine, depleted: true },
    { key: "mineReady", def: character({ name: "My Ready Character" }), owner: mine },
    ...spentResources(mine, 3),
    ...volition(1, mine).map((placement) => ({ ...placement, attachedToKey: factionKey(mine) })),
    ...bank("greed", 2, mine), // not attached: stays that way
    { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: foe, depleted: true },
    { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: foe, depleted: true },
    { key: "theirLoc", def: location({ name: "Their Depleted Location" }), owner: foe, depleted: true },
    // control differs from ownership: "your depleted cards" are the ones YOU control
    { key: "stolenIn", def: character({ name: "Stolen In" }), owner: foe, controller: mine, depleted: true },
    { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: mine, controller: foe, depleted: true },
    ...spentResources(foe, 2),
    ...fillers("mydeck", 4, mine, "deck"),
    ...fillers("theirdeck", 4, foe, "deck")
  ]);
}

const restoreMyCardsAtMyTurnStart = (fac: Fac, mine: PlayerId) => () => {
  const { engine, id } = restoreBoard(printing(fac.id), other(mine), mine);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  assert.equal(attachedCount(engine, mine), 4, "3 rage + 1 face-down resource are attached before my turn");
  assert.equal(readyCount(engine, mine), 2, "only the two unattached greed are ready");
  endTurn(engine, other(mine)); // my turn starts
  assert.equal(engine.state.activePlayerId, mine);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineLoc")].depleted, false, "my depleted location is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false, "a card that was never depleted is untouched");
  assert.equal(attachedCount(engine, mine), 0, "every resource is detached from my faction (face-up and face-down)");
  assert.equal(readyCount(engine, mine), 6, "all six of my resources are ready again");
};

const restoreMeansCardsIControl = (fac: Fac) => () => {
  const { engine, id } = restoreBoard(printing(fac.id), P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
};

const restoreLeavesOpponentAlone = (fac: Fac) => () => {
  const { engine, id } = restoreBoard(printing(fac.id), P2);
  endTurn(engine, P2); // my turn starts
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards': the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true, "the opponent's item stays depleted");
  assert.equal(engine.state.cards[id("theirLoc")].depleted, true, "the opponent's location stays depleted");
  assert.equal(attachedCount(engine, P2), 2, "'your faction': the opponent's resources stay attached");
};

const restoreOnlyAtMyTurnStart = (fac: Fac) => () => {
  const { engine, id } = restoreBoard(printing(fac.id), P1);
  endTurn(engine, P1); // the OPPONENT's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(engine.state.cards[id("mineLoc")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached at the opponent's turn start");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "nor a card the opponent owns but I control");
  assert.equal(engine.state.cards[id("theirChar")].depleted, false, "(the opponent's own restore rule ran for them)");
  assert.equal(attachedCount(engine, P2), 0);
};

const restoreAfterAttacking = (fac: Fac) => () => {
  const { engine, id } = seatGame(printing(fac.id), P1, P1, [
    { key: "atk", def: character({ name: "Attacker", strength: 2 }), owner: P1 },
    ...fillers("mydeck", 4, P1, "deck"),
    ...fillers("theirdeck", 4, P2, "deck")
  ]);
  const influence = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - engine.state.players[P2].influence, 2, "the unblocked attack hit the faction");
  assert.equal(engine.state.cards[id("atk")].depleted, true, "attacking depletes the attacker");
  refused(() => declareAttackBy(engine, P1, [id("atk")]), "a depleted character cannot attack again this turn");
  endTurn(engine, P1); // the opponent's turn
  assert.equal(engine.state.cards[id("atk")].depleted, true, "still depleted through the opponent's turn");
  endTurn(engine, P2); // my turn again
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("atk")].depleted, false, "restored at the start of my next turn");
  const before = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - engine.state.players[P2].influence, 2, "and ready to attack again");
};

const restoreNothingElseHappens = (fac: Fac) => () => {
  // The Restore Rule is the whole of the start-of-turn rules text: no extra draw, influence change, counter or choice.
  const { engine } = seatGame(printing(fac.id), P1, P2, [...fillers("mydeck", 4, P1, "deck"), ...fillers("theirdeck", 4, P2, "deck"), ...spentResources(P1, 2)]);
  const hand = [...handOf(engine, P1)];
  const deck = [...deckOf(engine, P1)];
  const influence = engine.state.players[P1].influence;
  const theirInfluence = engine.state.players[P2].influence;
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.deepEqual(handOf(engine, P1), hand, "no card is drawn at the start of my turn");
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.equal(engine.state.players[P1].influence, influence, "my influence is unchanged");
  assert.equal(engine.state.players[P2].influence, theirInfluence, "so is theirs");
  assert.deepEqual(engine.state.cards[factionOf(engine, P1)].counters, {}, "no counters appear on the faction");
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked of me");
  assert.equal(playCards(engine, P1).length, 2, "and no resource appears");
};

const factionHasNoUnprintedRules = (fac: Fac) => () => {
  // Phantom-data check (docs/TESTING.md rule 4): the card prints a rules text of exactly STARTING RESOURCES / STARTING
  // DRAW / RESTORE / DEVELOP plus three abilities. Nothing else may be on the faction card.
  const def = printing(fac.id);
  const faction = def.faction!;
  assert.deepEqual(Object.keys(faction).sort(), ["abilities", "setup", "startingInfluence", "turn"], "no OMNIPOTENCE, opponent override, flip-up tax or other faction rule");
  assert.deepEqual(Object.keys(faction.turn).sort(), ["develop", "restore"], "no extra start- or end-of-turn effects");
  assert.deepEqual(Object.keys(faction.setup).sort(), ["mulligan", "openingHand", "startingResources"], "no starting-draw search");
  assert.equal(faction.abilities?.length, 3, "exactly the three printed abilities");
  assert.equal(faction.turn.develop.usesPerTurn, undefined, "the Develop Rule is used once a turn");
  assert.deepEqual(def.behavior?.abilities ?? [], [], "no other abilities on the card");
  assert.deepEqual(def.behavior?.keywords ?? [], [], "no keywords");
};

const restoreOnlyDetachesResources = (fac: Fac) => () => {
  const { engine, id } = seatGame(printing(fac.id), P1, P2, [
    { key: "host", def: character({ name: "Host" }), owner: P1 },
    { key: "gear", def: item({ name: "Attached Gear" }), owner: P1, attachedToKey: "host", depleted: true },
    ...spentResources(P1, 2),
    ...fillers("mydeck", 4, P1, "deck"),
    ...fillers("theirdeck", 4, P2, "deck")
  ]);
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 0, "the resources are detached from my faction");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"), "only RESOURCES are detached: gear on a character stays attached");
  assert.equal(engine.state.cards[id("gear")].depleted, false, "(and as one of my depleted cards it is restored)");
};

const restoreRenewsEveryTurn = (fac: Fac) => () => {
  const { engine, id } = seatGame(printing(fac.id), P1, P1, [
    { key: "c", def: character({ name: "Char" }), owner: P1 },
    ...bank("rage", 6, P1),
    ...fillers("mydeck", 6, P1, "deck"),
    ...fillers("theirdeck", 6, P2, "deck")
  ]);
  void id;
  for (let round = 0; round < 3; round++) {
    assert.equal(readyCount(engine, P1), 6, `round ${round}: all six resources ready at the start of my turn`);
    activateFaction(engine, P1, fac.draw); // spends 3
    assert.equal(attachedCount(engine, P1), 3);
    endTurn(engine, P1);
    assert.equal(attachedCount(engine, P1), 3, "still attached through the opponent's turn");
    endTurn(engine, P2);
    assert.equal(attachedCount(engine, P1), 0, `round ${round}: detached again at the start of my next turn`);
  }
};

const restoreDepletedFaction = (fac: Fac) => () => {
  const { engine } = seatGame(printing(fac.id), P1, P2, [...fillers("mydeck", 4, P1, "deck"), ...fillers("theirdeck", 4, P2, "deck")]);
  engine.state.cards[factionOf(engine, P1)].depleted = true; // "all your depleted cards": the faction is one of my cards
  endTurn(engine, P2);
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "a depleted faction card is one of my depleted cards");
};

// =====================================================================================
// DEVELOP RULE: "At the start of your turn, draw a card or play a resource."
// =====================================================================================

function developBoard(faction: CardDefinition, active: PlayerId = P1) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "discardRes", def: resourceCard({ name: "Discarded Resource" }), owner: P1, zone: "discard" },
      { key: "inPlayChar", def: character({ name: "In Play Character" }), owner: P1, zone: "play" },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource" }), owner: P2, zone: "hand" }
    ]
  });
}

const developDraws = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  const theirHand = handSize(engine, P2);
  const theirDeck = [...deckOf(engine, P2)];
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck is the one drawn");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1), "only the top card left the deck");
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.deepEqual(deckOf(engine, P2), theirDeck, "and their deck is untouched");
  assert.equal(playCards(engine, P1).length, 1, "no resource was played (only the character that was already in play)");
};

const developPlaysResourceFaceUp = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource is now in play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "played face-up");
  assert.equal(thresholdsOf(engine, P1).greed, 1, "and it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1, "one card left my hand");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
};

const developPlaysAnyCardFaceDown = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(thresholdsOf(engine, P1).volition, 1, "a face-down resource provides one Volition");
  // ... even an actual resource card, which then gives Volition instead of its own icon
  const real = developBoard(printing(fac.id));
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(zoneOf(real.engine, real.id("handRes")), "play");
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(thresholdsOf(real.engine, P1).volition, 1);
  assert.equal(thresholdsOf(real.engine, P1).greed ?? 0, 0, "face-down, it no longer provides its Greed");
};

const developNonResourceNotFaceUp = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
  developResource(engine, P1, id("handRes"), false); // control
  assert.equal(zoneOf(engine, id("handRes")), "play");
};

const developOneOrTheOther = (fac: Fac) => () => {
  const drawn = developBoard(printing(fac.id));
  developDraw(drawn.engine, P1);
  assert.equal(drawn.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(drawn.engine, drawn.id("handRes")), "hand");

  const played = developBoard(printing(fac.id));
  const deckBefore = [...deckOf(played.engine, P1)];
  developResource(played.engine, P1, played.id("handRes"), false);
  assert.equal(played.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(deckOf(played.engine, P1), deckBefore);
};

const developOncePerTurn = (fac: Fac) => () => {
  const draws = developBoard(printing(fac.id));
  assert.ok(developOffers(draws.engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(draws.engine, P1);
  assert.equal(draws.engine.state.pendingChoice, undefined, "the Develop Rule is used up");
  const hand = handSize(draws.engine, P1);
  assert.equal(draws.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(draws.engine, P1), hand);

  const plays = developBoard(printing(fac.id));
  developResource(plays.engine, P1, plays.id("handRes"), false);
  assert.equal(plays.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(plays.engine, plays.id("handRes2")), "hand");
  assert.equal(plays.engine.state.pendingChoice, undefined, "the Develop Rule is used up");
};

const developOnlyOnMyTurn = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  const mine = developBoard(printing(fac.id)); // control: on my own turn the same plays work
  developResource(mine.engine, P1, mine.id("handRes"), false);
  assert.equal(zoneOf(mine.engine, mine.id("handRes")), "play");
};

const developOptionalAndRenews = (fac: Fac) => () => {
  const { engine } = developBoard(printing(fac.id));
  const hand = handSize(engine, P1);
  endTurn(engine, P1); // I skipped my Develop Rule entirely
  assert.equal(handSize(engine, P1), hand, "skipping it costs nothing and gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.ok(developOffers(engine, P1).length > 0, "a fresh Develop Rule on my next turn");
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
};

const developOnlyFromMyHand = (fac: Fac) => () => {
  const attempts: Array<[string, string]> = [
    ["a card in my deck", "mydeck0"],
    ["a resource in my discard pile", "discardRes"],
    ["a card in the opponent's hand", "theirHand"],
    ["a character already in play", "inPlayChar"]
  ];
  for (const [label, key] of attempts) {
    const { engine, id } = developBoard(printing(fac.id));
    const zone = zoneOf(engine, id(key));
    refused(() => developResource(engine, P1, id(key), true), label);
    assert.equal(zoneOf(engine, id(key)), zone, `${label} did not move`);
    assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", `${label}: the Develop Rule's resource pick is still open, it is not used up`);
  }
  const control = developBoard(printing(fac.id));
  developResource(control.engine, P1, control.id("handChar"), true); // control: a card from my hand
  assert.equal(zoneOf(control.engine, control.id("handChar")), "play");
};

const developExactlyOneResource = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  openDevelopPlay(engine, P1);
  const pick = (selected: string[]) =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected, faceDown: false } } as never);
  refused(() => pick([id("handRes"), id("handRes2")]), "'a resource' is one resource");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handRes2")), "hand");
  pick([id("handRes")]); // control: one is fine
  assert.equal(zoneOf(engine, id("handRes")), "play");
};

const developResourceIsReady = (fac: Fac) => () => {
  const { engine, id } = developBoard(printing(fac.id));
  const ready = readyCount(engine, P1);
  developResource(engine, P1, id("handRes"), false);
  assert.equal(readyCount(engine, P1), ready + 1, "the new resource is ready to pay for things");
  assert.equal(attachedCount(engine, P1), 0, "and is not attached to the faction");
  const down = developBoard(printing(fac.id));
  developResource(down.engine, P1, down.id("handChar"), true);
  assert.equal(readyCount(down.engine, P1), 1, "a face-down resource is ready too");
};

// =====================================================================================
// DRAW: "Pay 3. Draw a card."   RESOURCE: "Pay 4. Play a resource."
// =====================================================================================

function abilityBoard(faction: CardDefinition, resources: number, extra: CardPlacement[] = [], active: PlayerId = P1) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

const drawPaysAndDraws = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  const theirDeck = [...deckOf(engine, P2)];
  assert.equal(readyCount(engine, P1), 5);
  activateFaction(engine, P1, fac.draw);
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.deepEqual(deckOf(engine, P2), theirDeck, "and their deck is untouched");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
};

const drawNeedsThree = (fac: Fac) => () => {
  const two = abilityBoard(printing(fac.id), 2);
  refused(() => activateFaction(two.engine, P1, fac.draw), "2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), 2, "nothing is drawn");
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  assert.equal(readyCount(two.engine, P1), 2);

  const spent = abilityBoard(printing(fac.id), 4);
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  assert.equal(readyCount(spent.engine, P1), 2);
  refused(() => activateFaction(spent.engine, P1, fac.draw), "4 resources, 2 already spent", /cannot be paid/);

  const none = abilityBoard(printing(fac.id), 0);
  refused(() => activateFaction(none.engine, P1, fac.draw), "no resources", /cannot be paid/);

  const exact = abilityBoard(printing(fac.id), 3);
  activateFaction(exact.engine, P1, fac.draw); // control
  assert.equal(handSize(exact.engine, P1), 3);
};

const drawRepeatable = (fac: Fac) => () => {
  const { engine } = abilityBoard(printing(fac.id), 7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, fac.draw);
  activateFaction(engine, P1, fac.draw);
  assert.equal(handSize(engine, P1), handBefore + 2, "no once-per-turn limit is printed");
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
  refused(() => activateFaction(engine, P1, fac.draw), "a third use needs 3 more resources", /cannot be paid/);
};

const drawSeparateFromDevelop = (fac: Fac) => () => {
  const first = abilityBoard(printing(fac.id), 3);
  const base = handSize(first.engine, P1);
  activateFaction(first.engine, P1, fac.draw);
  assert.ok(developOffers(first.engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(first.engine, P1);
  assert.equal(handSize(first.engine, P1), base + 2);
  const second = abilityBoard(printing(fac.id), 3);
  developDraw(second.engine, P1);
  activateFaction(second.engine, P1, fac.draw);
  assert.equal(handSize(second.engine, P1), base + 2, "and the ability is still usable after the Develop Rule");
};

const drawControllerOnly = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirHand = handSize(engine, P2);
  refused(() => activateFaction(engine, P2, fac.draw, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
};

const drawPaidWithFaceDownResources = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    cards: [...volition(3, P1), ...fillers("mydeck", 4, P1, "deck")]
  });
  assert.equal(readyCount(engine, P1), 3);
  activateFaction(engine, P1, fac.draw);
  assert.equal(handSize(engine, P1), 1, "three face-down resources pay for it");
  assert.equal(attachedCount(engine, P1), 3);
};

const drawOnlyMyResourcesPay = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 2, P1), ...bank("rage", 6, P2), ...fillers("mydeck", 4, P1, "deck")]
  });
  refused(() => activateFaction(engine, P1, fac.draw), "the opponent's resources don't pay for mine", /cannot be paid/);
  assert.equal(attachedCount(engine, P2), 0, "none of theirs were spent");
  assert.equal(handSize(engine, P1), 0);
};

const drawInResponse = (fac: Fac) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "atk", def: character({ name: "Their Attacker" }), owner: P2 },
      ...bank("rage", 3, P1),
      ...fillers("mydeck", 4, P1, "deck")
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority in the response window");
  const handBefore = handSize(engine, P1);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: fac.draw, selected: {}, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(handSize(engine, P1), handBefore + 1, "the faction's ability can be used in response to the opponent's attack");
  assert.equal(attachedCount(engine, P1), 3);
};

const resourceBoardPlays = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 6);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  activateFaction(engine, P1, fac.resource);
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(pending(engine)?.playerId, P1, "I pick the resource to play");
  pick(engine, [id("handRes")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource was played");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(thresholdsOf(engine, P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(engine, P1), deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
};

const resourcePlaysNonResourceFaceDown = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 4);
  activateFaction(engine, P1, fac.resource);
  pick(engine, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play", "any card can be played as a resource");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(thresholdsOf(engine, P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
};

const resourceOnlyFromMyHand = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 4);
  activateFaction(engine, P1, fac.resource);
  refused(() => pick(engine, [id("theirHand")]), "the opponent's hand card", /Illegal target/);
  refused(() => pick(engine, [id("mydeck0")]), "a card in my deck", /Illegal target/);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  pick(engine, [id("handChar")]); // control
  assert.equal(zoneOf(engine, id("handChar")), "play");
};

const resourceNeedsFour = (fac: Fac) => () => {
  const short = abilityBoard(printing(fac.id), 3);
  refused(() => activateFaction(short.engine, P1, fac.resource), "3 resources", /cannot be paid/);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("handRes")), "hand", "no resource was played");
  assert.equal(attachedCount(short.engine, P1), 0);
  assert.equal(readyCount(short.engine, P1), 3);

  const spent = abilityBoard(printing(fac.id), 5);
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => activateFaction(spent.engine, P1, fac.resource), "5 resources, 2 already spent", /cannot be paid/);

  const none = abilityBoard(printing(fac.id), 0);
  refused(() => activateFaction(none.engine, P1, fac.resource), "no resources", /cannot be paid/);

  const exact = abilityBoard(printing(fac.id), 4);
  activateFaction(exact.engine, P1, fac.resource); // control
  pick(exact.engine, [exact.id("handRes")]);
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "with exactly 4 it works");
};

const resourceRepeatable = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 8);
  activateFaction(engine, P1, fac.resource);
  pick(engine, [id("handRes")]);
  activateFaction(engine, P1, fac.resource);
  pick(engine, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8, "no once-per-turn limit is printed");
};

const resourceSeparateFromDevelop = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 4);
  activateFaction(engine, P1, fac.resource);
  pick(engine, [id("handRes")]);
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  const after = abilityBoard(printing(fac.id), 4);
  developResource(after.engine, P1, after.id("handChar"), true);
  activateFaction(after.engine, P1, fac.resource);
  pick(after.engine, [after.id("handRes")]);
  assert.equal(zoneOf(after.engine, after.id("handRes")), "play", "and the ability is still usable after the Develop Rule");
};

const resourceControllerOnly = (fac: Fac) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", 8, P2),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
    ]
  });
  refused(() => activateFaction(engine, P2, fac.resource, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
};

const resourceCanChooseFaceDown = (fac: Fac) => () => {
  holdResourceFace(() => {
  // "Play a resource": when you play a resource you choose face-up or face-down, and ANY card may go face-down
  // (RULES.md 3.5, CR 203.2) -- including an actual resource card, which then gives Volition instead of its icon.
  const { engine, id } = abilityBoard(printing(fac.id), 4);
  activateFaction(engine, P1, fac.resource);
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [id("handRes")] } } as never);
  resolvePendingResponses(engine);
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card I must get to say face-up or face-down; the engine put it in play face-up without asking");
  });
};

const resourcePickIsMandatory = (fac: Fac) => () => {
  // "Play a resource." is not a "may": having paid, with cards in my hand I must play one.
  const { engine, id } = abilityBoard(printing(fac.id), 4);
  activateFaction(engine, P1, fac.resource);
  refused(() => pick(engine, []), "playing no resource at all");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the pick is still waiting");
  assert.equal(handSize(engine, P1), 2);
  pick(engine, [id("handRes")]); // control
  assert.equal(zoneOf(engine, id("handRes")), "play");
};

const resourceEmptyHand = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 5, P1), ...fillers("mydeck", 4, P1, "deck")]
  });
  assert.equal(handSize(engine, P1), 0);
  activateFaction(engine, P1, fac.resource);
  assert.equal(attachedCount(engine, P1), 4, "the cost is paid even with nothing to play");
  assert.equal(engine.state.pendingChoice, undefined, "and there is nothing to pick");
  assert.equal(playCards(engine, P1).length, 5, "no new resource appeared");
  assert.equal(deckOf(engine, P1).length, 4, "nothing was drawn instead");
};

const resourcePaidThenPlayedOnResolution = (fac: Fac) => () => {
  const { engine, id } = abilityBoard(printing(fac.id), 5);
  activateFactionRaw(engine, P1, fac.resource);
  assert.equal(attachedCount(engine, P1), 4, "the cost is paid as soon as the ability is used");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("handRes")), "hand", "the resource is not played until the ability resolves");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "on resolution I am asked which resource to play");
  pick(engine, [id("handRes")]);
  assert.equal(zoneOf(engine, id("handRes")), "play");
};

// =====================================================================================
// More shared bodies (setup shuffle, drawing from an empty deck) and synthetic cards
// =====================================================================================

const startingResourcesThenShuffle = (fac: Fac) => () => {
  // CR 601.1b (RULES.md 5): after the starting resources are taken the deck is shuffled, then the opening hand is drawn.
  const distinct = Array.from({ length: 40 }, (_, index) => character({ id: `s11-distinct-${index}`, name: `Distinct ${String(index).padStart(2, "0")}` }));
  const original = distinct.map((def) => def.name);
  const engine = setupGame(seatOf(fac, [otherStaple(fac), fac.named, ...distinct]), oppSeat());
  const order = [...handOf(engine, P1), ...deckOf(engine, P1)].map((cardId) => engine.getDefinition(cardId).name);
  assert.deepEqual([...order].sort(), [...original].sort(), "the same 40 other cards");
  assert.notDeepEqual(order, original, "the deck was shuffled after the starting resources were taken");
};

const developDrawFromEmptyDeck = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    cards: [{ key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" }, ...fillers("theirdeck", 4, P2, "deck")]
  });
  assert.equal(deckOf(engine, P1).length, 0);
  const influence = engine.state.players[P1].influence;
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), 1, "there was nothing to draw");
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game (RULES.md 1)");
  assert.equal(engine.state.players[P1].influence, influence, "and costs no influence");
};

const drawFromEmptyDeck = (fac: Fac) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(fac.id) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 3, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  assert.equal(deckOf(engine, P1).length, 0);
  activateFaction(engine, P1, fac.draw);
  assert.equal(attachedCount(engine, P1), 3, "the cost was paid");
  assert.equal(handSize(engine, P1), 0, "there was nothing to draw");
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game (RULES.md 1)");
};

const drawTakesTheTopCardOnly = (fac: Fac) => () => {
  // A hand that already holds cards: the new card is added, nothing else moves.
  const { engine, id } = abilityBoard(printing(fac.id), 3);
  const handBefore = [...handOf(engine, P1)];
  activateFaction(engine, P1, fac.draw);
  assert.deepEqual(handOf(engine, P1), [...handBefore, id("mydeck0")], "the top card joins the cards already in my hand");
  assert.equal(zoneOf(engine, id("mydeck1")), "deck", "the second card stays in the deck");
};

// --- synthetic helper cards -------------------------------------------------------------

/** A free tactic that inflicts `amount` damage on one chosen character in play (ability id `z`, declaration `t`). */
const zapTactic = (amount: number): CardDefinition =>
  tactic({
    name: `Zap ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "z",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic that gives one chosen character +`amount` strength this turn (ability id `b`, declaration `t`). */
const buffTactic = (amount: number): CardDefinition =>
  tactic({
    name: `Buff ${amount}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });

/** A free tactic that destroys one chosen character in play (ability id `k`, declaration `t`). */
const killOne = (): CardDefinition =>
  tactic({
    name: "Kill One",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** Plays the free tactic `cardId` (declaration `t` -> `targetId`) from hand for `pid` and drains the response windows. */
function castOn(engine: SpoilsEngine, pid: PlayerId, cardId: CardInstanceId, targetId: CardInstanceId): void {
  engine.perform({ type: "playCard", playerId: pid, cardId, selected: { t: [targetId] }, variables: {} } as never);
  resolvePendingResponses(engine);
}

// =============================================================================
// Moist Cave of the Darkpump
// =============================================================================

// --- STARTING RESOURCES: "1 Obsession, 1 staple resource."

clause(MOIST, "0:rule:STARTING RESOURCES", "starts with exactly 1 Obsession and 1 staple resource in play, both face-up", startsNamedAndStaple(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the named slot is that exact resource, wherever it sits in the deck", namedSlotIsThatResource(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "a non-staple resource is not a 'staple resource'", nonStapleIsNotAStaple(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the 'staple resource' may be a second Obsession (any staple will do)", stapleMayBeTheNamedKindToo(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "exactly two starting resources, never more, from a deck full of staples", exactlyTwoStartingResources(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", startingResourcesComeFromTheDeck(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the deck is shuffled after the starting resources are taken", startingResourcesThenShuffle(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", startingResourcesOpponentUnaffected(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "works the same when the faction is in the second seat", startingResourcesSecondSeat(F_MOIST));
clause(MOIST, "0:rule:STARTING RESOURCES", "the player chooses which staple resource to start with", playerChoosesTheStaple(F_MOIST));

// --- STARTING DRAW: "8 going first, 9 going second."

clause(MOIST, "1:rule:STARTING DRAW", "draws 8 cards going first", drawsEightGoingFirst(F_MOIST));
clause(MOIST, "1:rule:STARTING DRAW", "draws 9 cards going second", drawsNineGoingSecond(F_MOIST));
clause(MOIST, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", startingDrawLeavesOpponentAlone(F_MOIST));
clause(MOIST, "1:rule:STARTING DRAW", "works the same when the faction is in the second seat", startingDrawSecondSeat(F_MOIST));
clause(MOIST, "1:rule:STARTING DRAW", "the drawn cards are an opening hand, in addition to the starting resources", startingDrawIsNotTheStartingResources(F_MOIST));

// --- RESTORE RULE

clause(MOIST, "2:rule:RESTORE RULE", "at the start of my turn: my depleted characters, items and locations are restored and every resource is detached from my faction", restoreMyCardsAtMyTurnStart(F_MOIST, P1));
clause(MOIST, "2:rule:RESTORE RULE", "the same when the faction is in the second seat", restoreMyCardsAtMyTurnStart(F_MOIST, P2));
clause(MOIST, "2:rule:RESTORE RULE", "'your' depleted cards are the ones I control, not the ones I own", restoreMeansCardsIControl(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreLeavesOpponentAlone(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreOnlyAtMyTurnStart(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "a character depleted by attacking is restored at the start of my next turn, not before", restoreAfterAttacking(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "only RESOURCES are detached: gear attached to a character stays attached", restoreOnlyDetachesResources(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "renews every turn: resources spent during my turn are detached at the start of the next", restoreRenewsEveryTurn(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "restores 'all' my depleted cards, the faction card included", restoreDepletedFaction(F_MOIST));
clause(MOIST, "2:rule:RESTORE RULE", "nothing else happens at the start of my turn: no draw, no influence change, no counter, no choice", restoreNothingElseHappens(F_MOIST));

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(MOIST, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", developDraws(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", developPlaysResourceFaceUp(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", developPlaysAnyCardFaceDown(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", developNonResourceNotFaceUp(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", developOneOrTheOther(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "can be used only once per turn", developOncePerTurn(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "can be used only on my own turn", developOnlyOnMyTurn(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "is optional and available again every turn", developOptionalAndRenews(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "the resource must come from my hand", developOnlyFromMyHand(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "plays exactly one resource, not two", developExactlyOneResource(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "the resource it plays is ready to pay for things, not attached", developResourceIsReady(F_MOIST));
clause(MOIST, "3:rule:DEVELOP RULE", "drawing from an empty deck draws nothing and does not lose the game", developDrawFromEmptyDeck(F_MOIST));

// --- DRAW: "Pay 3. Draw a card."

clause(MOIST, "4:ability", "pays exactly 3 resources and draws one card", drawPaysAndDraws(F_MOIST));
clause(MOIST, "4:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", drawNeedsThree(F_MOIST));
clause(MOIST, "4:ability", "can be used again the same turn", drawRepeatable(F_MOIST));
clause(MOIST, "4:ability", "is separate from the Develop Rule (either order)", drawSeparateFromDevelop(F_MOIST));
clause(MOIST, "4:ability", "only its controller can use it", drawControllerOnly(F_MOIST));
clause(MOIST, "4:ability", "face-down resources can pay for it", drawPaidWithFaceDownResources(F_MOIST));
clause(MOIST, "4:ability", "only my own resources pay for it", drawOnlyMyResourcesPay(F_MOIST));
clause(MOIST, "4:ability", "can be used in response to the opponent's attack", drawInResponse(F_MOIST));
clause(MOIST, "4:ability", "the card drawn is the top card, added to the cards already in my hand", drawTakesTheTopCardOnly(F_MOIST));
clause(MOIST, "4:ability", "with an empty deck the cost is paid, nothing is drawn, and the game goes on", drawFromEmptyDeck(F_MOIST));

// --- RESOURCE: "Pay 4. Play a resource."

clause(MOIST, "5:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", resourceBoardPlays(F_MOIST));
clause(MOIST, "5:ability", "plays a non-resource card face-down as a resource", resourcePlaysNonResourceFaceDown(F_MOIST));
clause(MOIST, "5:ability", "the card must come from my own hand", resourceOnlyFromMyHand(F_MOIST));
clause(MOIST, "5:ability", "is refused when the 4 can't be paid", resourceNeedsFour(F_MOIST));
clause(MOIST, "5:ability", "can be used again the same turn", resourceRepeatable(F_MOIST));
clause(MOIST, "5:ability", "is separate from the Develop Rule (either order)", resourceSeparateFromDevelop(F_MOIST));
clause(MOIST, "5:ability", "only its controller can use it", resourceControllerOnly(F_MOIST));
clause(MOIST, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceCanChooseFaceDown(F_MOIST));
clause(MOIST, "5:ability", "'Play a resource' is not a 'may': with cards in my hand I cannot play nothing", resourcePickIsMandatory(F_MOIST));
clause(MOIST, "5:ability", "with nothing in my hand the cost is still paid and nothing else happens", resourceEmptyHand(F_MOIST));
clause(MOIST, "5:ability", "the cost is paid when it is used, the resource is played when it resolves", resourcePaidThenPlayedOnResolution(F_MOIST));

// --- nothing else is printed on the card

clause(MOIST, "6:ability", "the faction card carries no rule or ability beyond the printed ones (no phantom data)", factionHasNoUnprintedRules(F_MOIST));

// --- LUCUBRATE: "Pay 1. Look at the top card of your deck. You may put that card on the bottom."

const LUCUBRATE = "moistcave-lucubrate";

function lucubrateBoard(resources = 3, deckSize = 4) {
  return buildGame({
    playerA: { faction: printing(MOIST) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", deckSize, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" }
    ]
  });
}

/** The ways an engine might let me say "no, leave it on top" to the open look-at-the-top choice, tried in turn. */
function tryKeepOnTop(engine: SpoilsEngine): void {
  const pc = pending(engine)!;
  const attempts: unknown[] = pc.kind === "reorderDeck" ? [{ kind: "reorderDeck", order: [] }, { kind: "reorderDeck", order: [], bottom: [] }] : [declineAll(pc)];
  for (const choice of attempts) {
    try {
      engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
      resolvePendingResponses(engine);
    } catch {
      /* this shape is not accepted: try the next */
    }
    if (!engine.state.pendingChoice) return;
  }
}

clause(MOIST, "6:ability", "pays exactly 1 resource", () => {
  const { engine } = lucubrateBoard(3);
  activateFaction(engine, P1, LUCUBRATE);
  assert.equal(attachedCount(engine, P1), 1, "exactly one resource is attached to the faction");
  assert.equal(readyCount(engine, P1), 2);
});

clause(MOIST, "6:ability", "I look at the top card of MY deck, and only that card", () => {
  const { engine, id } = lucubrateBoard(3);
  activateFaction(engine, P1, LUCUBRATE);
  const choice = pending(engine);
  assert.equal(choice?.kind, "reorderDeck", "the engine shows me the top card and asks what to do with it");
  assert.equal(choice?.playerId, P1, "I am the one who looks and decides");
  assert.equal(choice?.deckOwnerId, P1, "at my own deck");
  assert.deepEqual(choice?.cardIds, [id("mydeck0")], "exactly the top card, not the cards beneath it");
});

clause(MOIST, "6:ability", "putting the looked-at card on the bottom moves only that card; everything else keeps its order", () => {
  const { engine, id } = lucubrateBoard(3);
  const theirDeck = [...deckOf(engine, P2)];
  const hand = [...handOf(engine, P1)];
  activateFaction(engine, P1, LUCUBRATE);
  answerPending(engine, "reorderDeck", { order: [id("mydeck0")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), [id("mydeck1"), id("mydeck2"), id("mydeck3"), id("mydeck0")], "the top card is now the bottom card");
  assert.deepEqual(handOf(engine, P1), hand, "nothing was drawn");
  assert.deepEqual(deckOf(engine, P2), theirDeck, "the opponent's deck is untouched");
});

clause(MOIST, "6:ability", "'You may put that card on the bottom': I can decline, and then the card stays on top", () => {
  const { engine } = lucubrateBoard(3);
  const before = [...deckOf(engine, P1)];
  activateFaction(engine, P1, LUCUBRATE);
  tryKeepOnTop(engine);
  assert.equal(engine.state.pendingChoice, undefined, "I can finish the ability without moving the card");
  assert.deepEqual(deckOf(engine, P1), before, "declined: the card stays on top and the deck is unchanged");
});

clause(MOIST, "6:ability", "used again, it looks at the new top card", () => {
  const { engine, id } = lucubrateBoard(3);
  activateFaction(engine, P1, LUCUBRATE);
  answerPending(engine, "reorderDeck", { order: [id("mydeck0")] });
  activateFaction(engine, P1, LUCUBRATE);
  assert.deepEqual(pending(engine)?.cardIds, [id("mydeck1")], "the second look sees the card that is on top now");
  answerPending(engine, "reorderDeck", { order: [id("mydeck1")] });
  assert.deepEqual(deckOf(engine, P1), [id("mydeck2"), id("mydeck3"), id("mydeck0"), id("mydeck1")]);
  assert.equal(attachedCount(engine, P1), 2, "each use pays 1: no once-per-turn limit is printed");
});

clause(MOIST, "6:ability", "is refused with no resource to pay (and works with exactly one)", () => {
  const none = lucubrateBoard(0);
  refused(() => activateFaction(none.engine, P1, LUCUBRATE), "no resources", /cannot be paid/);
  assert.equal(none.engine.state.pendingChoice, undefined);
  const spent = lucubrateBoard(2);
  for (const resourceId of spent.engine.getAvailableResourceIds(P1)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => activateFaction(spent.engine, P1, LUCUBRATE), "every resource already spent", /cannot be paid/);
  const one = lucubrateBoard(1);
  activateFaction(one.engine, P1, LUCUBRATE); // control
  assert.equal(pending(one.engine)?.kind, "reorderDeck");
  assert.equal(attachedCount(one.engine, P1), 1);
});

clause(MOIST, "6:ability", "only its controller can use it", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(MOIST) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 3, P2), ...fillers("mydeck", 4, P1, "deck"), ...fillers("theirdeck", 4, P2, "deck")]
  });
  refused(() => activateFaction(engine, P2, LUCUBRATE, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(attachedCount(engine, P2), 0);
});

clause(MOIST, "6:ability", "the cost is paid when it is used; the look happens when it resolves", () => {
  const { engine, id } = lucubrateBoard(3);
  activateFactionRaw(engine, P1, LUCUBRATE);
  assert.equal(attachedCount(engine, P1), 1, "paid as soon as it is used");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(engine.state.pendingChoice, undefined, "I have not looked at the card yet");
  resolvePendingResponses(engine);
  assert.deepEqual(pending(engine)?.cardIds, [id("mydeck0")], "on resolution I look at the top card");
});

clause(MOIST, "6:ability", "with an empty deck there is nothing to look at: the cost is paid and the game goes on", () => {
  const { engine } = lucubrateBoard(3, 0);
  activateFaction(engine, P1, LUCUBRATE);
  assert.equal(attachedCount(engine, P1), 1);
  assert.equal(engine.state.pendingChoice, undefined, "no card to look at, so nothing to decide");
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.result, undefined, "running out of cards does not lose the game");
});

clause(MOIST, "6:ability", "with a one-card deck, the only card is the top card and the bottom card", () => {
  const { engine, id } = lucubrateBoard(3, 1);
  activateFaction(engine, P1, LUCUBRATE);
  assert.deepEqual(pending(engine)?.cardIds, [id("mydeck0")]);
  answerPending(engine, "reorderDeck", { order: [id("mydeck0")] });
  assert.deepEqual(deckOf(engine, P1), [id("mydeck0")]);
});

// =============================================================================
// Order of the Golden String
// =============================================================================

// --- STARTING RESOURCES: "1 Greed, 1 staple resource."

clause(GOLDEN, "0:rule:STARTING RESOURCES", "starts with exactly 1 Greed and 1 staple resource in play, both face-up", startsNamedAndStaple(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the named slot is that exact resource, wherever it sits in the deck", namedSlotIsThatResource(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "a non-staple resource is not a 'staple resource'", nonStapleIsNotAStaple(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the 'staple resource' may be a second Greed (any staple will do)", stapleMayBeTheNamedKindToo(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "exactly two starting resources, never more, from a deck full of staples", exactlyTwoStartingResources(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", startingResourcesComeFromTheDeck(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the deck is shuffled after the starting resources are taken", startingResourcesThenShuffle(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", startingResourcesOpponentUnaffected(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "works the same when the faction is in the second seat", startingResourcesSecondSeat(F_GOLDEN));
clause(GOLDEN, "0:rule:STARTING RESOURCES", "the player chooses which staple resource to start with", playerChoosesTheStaple(F_GOLDEN));

// --- STARTING DRAW: "8 going first, 9 going second."

clause(GOLDEN, "1:rule:STARTING DRAW", "draws 8 cards going first", drawsEightGoingFirst(F_GOLDEN));
clause(GOLDEN, "1:rule:STARTING DRAW", "draws 9 cards going second", drawsNineGoingSecond(F_GOLDEN));
clause(GOLDEN, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", startingDrawLeavesOpponentAlone(F_GOLDEN));
clause(GOLDEN, "1:rule:STARTING DRAW", "works the same when the faction is in the second seat", startingDrawSecondSeat(F_GOLDEN));
clause(GOLDEN, "1:rule:STARTING DRAW", "the drawn cards are an opening hand, in addition to the starting resources", startingDrawIsNotTheStartingResources(F_GOLDEN));

// --- RESTORE RULE

clause(GOLDEN, "2:rule:RESTORE RULE", "at the start of my turn: my depleted characters, items and locations are restored and every resource is detached from my faction", restoreMyCardsAtMyTurnStart(F_GOLDEN, P1));
clause(GOLDEN, "2:rule:RESTORE RULE", "the same when the faction is in the second seat", restoreMyCardsAtMyTurnStart(F_GOLDEN, P2));
clause(GOLDEN, "2:rule:RESTORE RULE", "'your' depleted cards are the ones I control, not the ones I own", restoreMeansCardsIControl(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreLeavesOpponentAlone(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreOnlyAtMyTurnStart(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "a character depleted by attacking is restored at the start of my next turn, not before", restoreAfterAttacking(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "only RESOURCES are detached: gear attached to a character stays attached", restoreOnlyDetachesResources(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "renews every turn: resources spent during my turn are detached at the start of the next", restoreRenewsEveryTurn(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "restores 'all' my depleted cards, the faction card included", restoreDepletedFaction(F_GOLDEN));
clause(GOLDEN, "2:rule:RESTORE RULE", "nothing else happens at the start of my turn: no draw, no influence change, no counter, no choice", restoreNothingElseHappens(F_GOLDEN));

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(GOLDEN, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", developDraws(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", developPlaysResourceFaceUp(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", developPlaysAnyCardFaceDown(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", developNonResourceNotFaceUp(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", developOneOrTheOther(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "can be used only once per turn", developOncePerTurn(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "can be used only on my own turn", developOnlyOnMyTurn(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "is optional and available again every turn", developOptionalAndRenews(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "the resource must come from my hand", developOnlyFromMyHand(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "plays exactly one resource, not two", developExactlyOneResource(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "the resource it plays is ready to pay for things, not attached", developResourceIsReady(F_GOLDEN));
clause(GOLDEN, "3:rule:DEVELOP RULE", "drawing from an empty deck draws nothing and does not lose the game", developDrawFromEmptyDeck(F_GOLDEN));

// --- DRAW: "Pay 3. Draw a card."

clause(GOLDEN, "4:ability", "pays exactly 3 resources and draws one card", drawPaysAndDraws(F_GOLDEN));
clause(GOLDEN, "4:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", drawNeedsThree(F_GOLDEN));
clause(GOLDEN, "4:ability", "can be used again the same turn", drawRepeatable(F_GOLDEN));
clause(GOLDEN, "4:ability", "is separate from the Develop Rule (either order)", drawSeparateFromDevelop(F_GOLDEN));
clause(GOLDEN, "4:ability", "only its controller can use it", drawControllerOnly(F_GOLDEN));
clause(GOLDEN, "4:ability", "face-down resources can pay for it", drawPaidWithFaceDownResources(F_GOLDEN));
clause(GOLDEN, "4:ability", "only my own resources pay for it", drawOnlyMyResourcesPay(F_GOLDEN));
clause(GOLDEN, "4:ability", "can be used in response to the opponent's attack", drawInResponse(F_GOLDEN));
clause(GOLDEN, "4:ability", "the card drawn is the top card, added to the cards already in my hand", drawTakesTheTopCardOnly(F_GOLDEN));
clause(GOLDEN, "4:ability", "with an empty deck the cost is paid, nothing is drawn, and the game goes on", drawFromEmptyDeck(F_GOLDEN));

// --- RESOURCE: "Pay 4. Play a resource."

clause(GOLDEN, "5:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", resourceBoardPlays(F_GOLDEN));
clause(GOLDEN, "5:ability", "plays a non-resource card face-down as a resource", resourcePlaysNonResourceFaceDown(F_GOLDEN));
clause(GOLDEN, "5:ability", "the card must come from my own hand", resourceOnlyFromMyHand(F_GOLDEN));
clause(GOLDEN, "5:ability", "is refused when the 4 can't be paid", resourceNeedsFour(F_GOLDEN));
clause(GOLDEN, "5:ability", "can be used again the same turn", resourceRepeatable(F_GOLDEN));
clause(GOLDEN, "5:ability", "is separate from the Develop Rule (either order)", resourceSeparateFromDevelop(F_GOLDEN));
clause(GOLDEN, "5:ability", "only its controller can use it", resourceControllerOnly(F_GOLDEN));
clause(GOLDEN, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceCanChooseFaceDown(F_GOLDEN));
clause(GOLDEN, "5:ability", "'Play a resource' is not a 'may': with cards in my hand I cannot play nothing", resourcePickIsMandatory(F_GOLDEN));
clause(GOLDEN, "5:ability", "with nothing in my hand the cost is still paid and nothing else happens", resourceEmptyHand(F_GOLDEN));
clause(GOLDEN, "5:ability", "the cost is paid when it is used, the resource is played when it resolves", resourcePaidThenPlayedOnResolution(F_GOLDEN));

// --- nothing else is printed on the card

clause(GOLDEN, "6:ability", "the faction card carries no rule or ability beyond the printed ones (no phantom data)", factionHasNoUnprintedRules(F_GOLDEN));

// --- CONSPIRE: "Pay 4. Draw 2 cards. Discard a card."

const CONSPIRE = "golden-conspire";

function conspireBoard(options: { resources?: number; deck?: number; hand?: boolean } = {}) {
  const resources = options.resources ?? 6;
  const deck = options.deck ?? 5;
  const hand = options.hand ?? true;
  return buildGame({
    playerA: { faction: printing(GOLDEN) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", deck, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      ...(hand
        ? [
            { key: "hChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" as const },
            { key: "hRes", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" as const },
            { key: "hTac", def: tactic({ name: "Hand Tactic" }), owner: P1, zone: "hand" as const }
          ]
        : []),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" },
      { key: "inPlayChar", def: character({ name: "In Play Character" }), owner: P1, zone: "play" }
    ]
  });
}

clause(GOLDEN, "6:ability", "pays exactly 4 resources, draws the top 2 cards of my deck, then asks me to discard", () => {
  const { engine, id } = conspireBoard();
  const theirDeck = [...deckOf(engine, P2)];
  const theirHand = handSize(engine, P2);
  activateFaction(engine, P1, CONSPIRE);
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(readyCount(engine, P1), 2);
  assert.equal(handSize(engine, P1), 5, "3 cards in hand + 2 drawn, before the discard");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card was drawn");
  assert.equal(zoneOf(engine, id("mydeck1")), "hand", "and the second card");
  assert.equal(zoneOf(engine, id("mydeck2")), "deck", "but not the third");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now I must discard a card");
  assert.equal(pending(engine)?.playerId, P1, "I choose");
  assert.deepEqual(deckOf(engine, P2), theirDeck, "the opponent's deck is untouched");
  assert.equal(handSize(engine, P2), theirHand, "and so is their hand");
});

clause(GOLDEN, "6:ability", "I discard a card of my choice from my hand: it goes to my discard pile and the hand ends up one card bigger", () => {
  const { engine, id } = conspireBoard();
  activateFaction(engine, P1, CONSPIRE);
  pick(engine, [id("hRes")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hRes")), "discard", "the card I chose is discarded");
  assert.deepEqual(discardOf(engine, P1), [id("hRes")], "to MY discard pile, and nothing else is discarded");
  assert.equal(handSize(engine, P1), 4, "3 + 2 - 1");
  for (const key of ["hChar", "hTac", "mydeck0", "mydeck1"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} stays in my hand`);
});

clause(GOLDEN, "6:ability", "a card of any type can be the one discarded (character, resource, tactic)", () => {
  for (const key of ["hChar", "hRes", "hTac"]) {
    const { engine, id } = conspireBoard();
    activateFaction(engine, P1, CONSPIRE);
    pick(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "discard", key);
    assert.equal(handSize(engine, P1), 4, key);
  }
});

clause(GOLDEN, "6:ability", "the discard comes AFTER the draw, so one of the two cards just drawn can be the one discarded", () => {
  for (const key of ["mydeck0", "mydeck1"]) {
    const { engine, id } = conspireBoard();
    activateFaction(engine, P1, CONSPIRE);
    pick(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "discard", `the freshly drawn ${key} is discarded`);
    assert.equal(handSize(engine, P1), 4);
    assert.equal(zoneOf(engine, id("hChar")), "hand", "the card that was already in hand stays");
  }
});

clause(GOLDEN, "6:ability", "I must discard exactly one card: none and two are refused, and the discard stays pending", () => {
  const { engine, id } = conspireBoard();
  activateFaction(engine, P1, CONSPIRE);
  refused(() => pick(engine, []), "discarding nothing");
  refused(() => pick(engine, [id("hChar"), id("hRes")]), "discarding two");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal discard");
  assert.equal(handSize(engine, P1), 5, "nothing was discarded by the refused answers");
  pick(engine, [id("hChar")]); // control
  assert.equal(zoneOf(engine, id("hChar")), "discard");
  assert.equal(handSize(engine, P1), 4);
});

clause(GOLDEN, "6:ability", "the discarded card must come from my own hand", () => {
  const { engine, id } = conspireBoard();
  activateFaction(engine, P1, CONSPIRE);
  refused(() => pick(engine, [id("theirHand")]), "the opponent's hand card", /Illegal target/);
  refused(() => pick(engine, [id("mydeck2")]), "a card still in my deck", /Illegal target/);
  refused(() => pick(engine, [id("inPlayChar")]), "a character in play", /Illegal target/);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(zoneOf(engine, id("inPlayChar")), "play");
  pick(engine, [id("hTac")]); // control
  assert.equal(zoneOf(engine, id("hTac")), "discard");
});

clause(GOLDEN, "6:ability", "is refused when the 4 can't be paid (3 resources, 5 with 2 already spent, none)", () => {
  const three = conspireBoard({ resources: 3 });
  refused(() => activateFaction(three.engine, P1, CONSPIRE), "3 resources", /cannot be paid/);
  assert.equal(three.engine.state.pendingChoice, undefined);
  assert.equal(handSize(three.engine, P1), 3, "nothing was drawn");
  assert.equal(attachedCount(three.engine, P1), 0, "nothing was half-paid");

  const spent = conspireBoard({ resources: 5 });
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => activateFaction(spent.engine, P1, CONSPIRE), "5 resources, 2 already spent", /cannot be paid/);

  const none = conspireBoard({ resources: 0 });
  refused(() => activateFaction(none.engine, P1, CONSPIRE), "no resources", /cannot be paid/);

  const exact = conspireBoard({ resources: 4 });
  activateFaction(exact.engine, P1, CONSPIRE); // control
  assert.equal(handSize(exact.engine, P1), 5);
});

clause(GOLDEN, "6:ability", "can be used again the same turn", () => {
  const { engine, id } = conspireBoard({ resources: 8 });
  activateFaction(engine, P1, CONSPIRE);
  pick(engine, [id("hChar")]);
  activateFaction(engine, P1, CONSPIRE);
  assert.equal(handSize(engine, P1), 4 + 2, "the second use drew 2 more");
  pick(engine, [id("hRes")]);
  assert.equal(handSize(engine, P1), 5);
  assert.equal(attachedCount(engine, P1), 8);
  assert.equal(zoneOf(engine, id("mydeck3")), "hand", "the 3rd and 4th cards of the deck were drawn by the second use");
});

clause(GOLDEN, "6:ability", "only its controller can use it", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(GOLDEN) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  refused(() => activateFaction(engine, P2, CONSPIRE, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), 0);
  assert.equal(attachedCount(engine, P2), 0);
});

clause(GOLDEN, "6:ability", "with only one card left in the deck I draw that one, then discard", () => {
  const { engine, id } = conspireBoard({ deck: 1, hand: false });
  activateFaction(engine, P1, CONSPIRE);
  assert.equal(attachedCount(engine, P1), 4);
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the only card was drawn");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "and it is the only card I can discard");
  pick(engine, [id("mydeck0")]);
  assert.equal(zoneOf(engine, id("mydeck0")), "discard");
  assert.equal(handSize(engine, P1), 0);
  assert.equal(engine.state.result, undefined, "drawing from a short deck does not lose the game");
});

clause(GOLDEN, "6:ability", "with an empty deck I draw nothing but still discard a card from my hand", () => {
  const { engine, id } = conspireBoard({ deck: 0 });
  activateFaction(engine, P1, CONSPIRE);
  assert.equal(attachedCount(engine, P1), 4, "the cost is paid");
  assert.equal(handSize(engine, P1), 3, "nothing was drawn");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the discard still happens");
  pick(engine, [id("hRes")]);
  assert.equal(zoneOf(engine, id("hRes")), "discard");
  assert.equal(handSize(engine, P1), 2);
  assert.equal(engine.state.result, undefined);
});

clause(GOLDEN, "6:ability", "with an empty deck and an empty hand nothing is drawn and nothing is discarded", () => {
  const { engine } = conspireBoard({ deck: 0, hand: false });
  activateFaction(engine, P1, CONSPIRE);
  assert.equal(attachedCount(engine, P1), 4, "the cost is paid");
  assert.equal(engine.state.pendingChoice, undefined, "no card to discard, so nothing to ask");
  assert.equal(handSize(engine, P1), 0);
  assert.equal(discardOf(engine, P1).length, 0);
  assert.equal(engine.state.result, undefined);
});

clause(GOLDEN, "6:ability", "the cost is paid when it is used; the cards are drawn when it resolves", () => {
  const { engine, id } = conspireBoard();
  activateFactionRaw(engine, P1, CONSPIRE);
  assert.equal(attachedCount(engine, P1), 4, "paid as soon as it is used");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(handSize(engine, P1), 3, "nothing is drawn before it resolves");
  assert.equal(zoneOf(engine, id("mydeck0")), "deck");
  resolvePendingResponses(engine);
  assert.equal(handSize(engine, P1), 5, "drawn on resolution");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

// =============================================================================
// Alliance of Handy Weirdos
// =============================================================================

// --- STARTING RESOURCES: "1 Elitism, 1 staple resource."

clause(ALLIANCE, "0:rule:STARTING RESOURCES", "starts with exactly 1 Elitism and 1 staple resource in play, both face-up", startsNamedAndStaple(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the named slot is that exact resource, wherever it sits in the deck", namedSlotIsThatResource(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "a non-staple resource is not a 'staple resource'", nonStapleIsNotAStaple(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the 'staple resource' may be a second Elitism (any staple will do)", stapleMayBeTheNamedKindToo(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "exactly two starting resources, never more, from a deck full of staples", exactlyTwoStartingResources(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", startingResourcesComeFromTheDeck(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the deck is shuffled after the starting resources are taken", startingResourcesThenShuffle(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", startingResourcesOpponentUnaffected(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "works the same when the faction is in the second seat", startingResourcesSecondSeat(F_ALLIANCE));
clause(ALLIANCE, "0:rule:STARTING RESOURCES", "the player chooses which staple resource to start with", playerChoosesTheStaple(F_ALLIANCE));

// --- STARTING DRAW: "8 going first, 9 going second."

clause(ALLIANCE, "1:rule:STARTING DRAW", "draws 8 cards going first", drawsEightGoingFirst(F_ALLIANCE));
clause(ALLIANCE, "1:rule:STARTING DRAW", "draws 9 cards going second", drawsNineGoingSecond(F_ALLIANCE));
clause(ALLIANCE, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", startingDrawLeavesOpponentAlone(F_ALLIANCE));
clause(ALLIANCE, "1:rule:STARTING DRAW", "works the same when the faction is in the second seat", startingDrawSecondSeat(F_ALLIANCE));
clause(ALLIANCE, "1:rule:STARTING DRAW", "the drawn cards are an opening hand, in addition to the starting resources", startingDrawIsNotTheStartingResources(F_ALLIANCE));

// --- RESTORE RULE

clause(ALLIANCE, "2:rule:RESTORE RULE", "at the start of my turn: my depleted characters, items and locations are restored and every resource is detached from my faction", restoreMyCardsAtMyTurnStart(F_ALLIANCE, P1));
clause(ALLIANCE, "2:rule:RESTORE RULE", "the same when the faction is in the second seat", restoreMyCardsAtMyTurnStart(F_ALLIANCE, P2));
clause(ALLIANCE, "2:rule:RESTORE RULE", "'your' depleted cards are the ones I control, not the ones I own", restoreMeansCardsIControl(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreLeavesOpponentAlone(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreOnlyAtMyTurnStart(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "a character depleted by attacking is restored at the start of my next turn, not before", restoreAfterAttacking(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "only RESOURCES are detached: gear attached to a character stays attached", restoreOnlyDetachesResources(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "renews every turn: resources spent during my turn are detached at the start of the next", restoreRenewsEveryTurn(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "restores 'all' my depleted cards, the faction card included", restoreDepletedFaction(F_ALLIANCE));
clause(ALLIANCE, "2:rule:RESTORE RULE", "nothing else happens at the start of my turn: no draw, no influence change, no counter, no choice", restoreNothingElseHappens(F_ALLIANCE));

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(ALLIANCE, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", developDraws(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", developPlaysResourceFaceUp(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", developPlaysAnyCardFaceDown(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", developNonResourceNotFaceUp(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", developOneOrTheOther(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "can be used only once per turn", developOncePerTurn(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "can be used only on my own turn", developOnlyOnMyTurn(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "is optional and available again every turn", developOptionalAndRenews(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "the resource must come from my hand", developOnlyFromMyHand(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "plays exactly one resource, not two", developExactlyOneResource(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "the resource it plays is ready to pay for things, not attached", developResourceIsReady(F_ALLIANCE));
clause(ALLIANCE, "3:rule:DEVELOP RULE", "drawing from an empty deck draws nothing and does not lose the game", developDrawFromEmptyDeck(F_ALLIANCE));

// --- DRAW: "Pay 3. Draw a card."

clause(ALLIANCE, "4:ability", "pays exactly 3 resources and draws one card", drawPaysAndDraws(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", drawNeedsThree(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "can be used again the same turn", drawRepeatable(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "is separate from the Develop Rule (either order)", drawSeparateFromDevelop(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "only its controller can use it", drawControllerOnly(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "face-down resources can pay for it", drawPaidWithFaceDownResources(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "only my own resources pay for it", drawOnlyMyResourcesPay(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "can be used in response to the opponent's attack", drawInResponse(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "the card drawn is the top card, added to the cards already in my hand", drawTakesTheTopCardOnly(F_ALLIANCE));
clause(ALLIANCE, "4:ability", "with an empty deck the cost is paid, nothing is drawn, and the game goes on", drawFromEmptyDeck(F_ALLIANCE));

// --- RESOURCE: "Pay 4. Play a resource."

clause(ALLIANCE, "5:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", resourceBoardPlays(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "plays a non-resource card face-down as a resource", resourcePlaysNonResourceFaceDown(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "the card must come from my own hand", resourceOnlyFromMyHand(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "is refused when the 4 can't be paid", resourceNeedsFour(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "can be used again the same turn", resourceRepeatable(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "is separate from the Develop Rule (either order)", resourceSeparateFromDevelop(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "only its controller can use it", resourceControllerOnly(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceCanChooseFaceDown(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "'Play a resource' is not a 'may': with cards in my hand I cannot play nothing", resourcePickIsMandatory(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "with nothing in my hand the cost is still paid and nothing else happens", resourceEmptyHand(F_ALLIANCE));
clause(ALLIANCE, "5:ability", "the cost is paid when it is used, the resource is played when it resolves", resourcePaidThenPlayedOnResolution(F_ALLIANCE));

// --- nothing else is printed on the card

clause(ALLIANCE, "6:ability", "the faction card carries no rule or ability beyond the printed ones (no phantom data)", factionHasNoUnprintedRules(F_ALLIANCE));

// --- "ENHANCE": "Pay 3. Pick a character. This turn, the character gains 1 strength and 1 life."

const ENHANCE = "alliance-enhance";

function enhanceBoard(resources = 5, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(ALLIANCE) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      { key: "mine", def: character({ name: "My Character", strength: 2, life: 3, speed: 2 }), owner: P1 },
      { key: "mine2", def: character({ name: "My Other Character", strength: 2, life: 3 }), owner: P1 },
      { key: "foe", def: character({ name: "Their Character", strength: 1, life: 4, speed: 3 }), owner: P2 },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      ...extra
    ]
  });
}

const enhance = (engine: SpoilsEngine, targetId: CardInstanceId): void => activateFaction(engine, P1, ENHANCE, P1, { c: [targetId] });
const statsOf = (engine: SpoilsEngine, cardId: CardInstanceId) => ({
  strength: engine.getStat(cardId, "strength"),
  life: engine.getStat(cardId, "life"),
  speed: engine.getStat(cardId, "speed")
});

clause(ALLIANCE, "6:ability", "pays exactly 3 resources", () => {
  const { engine, id } = enhanceBoard(5);
  enhance(engine, id("mine"));
  assert.equal(attachedCount(engine, P1), 3, "exactly 3 resources were paid");
  assert.equal(readyCount(engine, P1), 2);
});

clause(ALLIANCE, "6:ability", "the picked character gains 1 strength and 1 life (and nothing else changes)", () => {
  const { engine, id } = enhanceBoard();
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 2, life: 3, speed: 2 });
  enhance(engine, id("mine"));
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 3, life: 4, speed: 2 }, "+1 strength, +1 life, same speed");
});

clause(ALLIANCE, "6:ability", "any character can be picked, the opponent's included", () => {
  const { engine, id } = enhanceBoard();
  enhance(engine, id("foe"));
  assert.deepEqual(statsOf(engine, id("foe")), { strength: 2, life: 5, speed: 3 }, "their character gets +1 / +1");
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 2, life: 3, speed: 2 }, "mine is untouched");
});

clause(ALLIANCE, "6:ability", "only the picked character is affected", () => {
  const { engine, id } = enhanceBoard();
  enhance(engine, id("mine"));
  assert.deepEqual(statsOf(engine, id("mine2")), { strength: 2, life: 3, speed: 1 }, "my other character is unchanged");
  assert.deepEqual(statsOf(engine, id("foe")), { strength: 1, life: 4, speed: 3 }, "and so is the opponent's");
});

clause(ALLIANCE, "6:ability", "only a CHARACTER in play can be picked (not an item, location, faction, face-down card, or a character in hand or discard pile)", () => {
  const extra: CardPlacement[] = [
    { key: "gear", def: item({ name: "My Item" }), owner: P1 },
    { key: "loc", def: location({ name: "Their Location" }), owner: P2 },
    { key: "fd", def: character({ name: "Face-Down Card" }), owner: P1, faceDown: true },
    { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
    { key: "discChar", def: character({ name: "Discarded Character" }), owner: P1, zone: "discard" }
  ];
  const { engine, id } = enhanceBoard(6, extra);
  const ready = readyCount(engine, P1);
  for (const [label, target] of [
    ["an item", id("gear")],
    ["a location", id("loc")],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("handChar")],
    ["a character in my discard pile", id("discChar")],
    ["my faction", factionOf(engine, P1)],
    ["the opponent's faction", factionOf(engine, P2)]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => enhance(engine, target), label);
    assert.equal(attachedCount(engine, P1), 0, `${label}: nothing was paid`);
    assert.equal(readyCount(engine, P1), ready, `${label}: nothing was spent`);
  }
  enhance(engine, id("mine")); // control: a character in play
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
});

clause(ALLIANCE, "6:ability", "a character must be picked, and exactly one", () => {
  const { engine, id } = enhanceBoard();
  refused(() => activateFaction(engine, P1, ENHANCE, P1, {}), "no pick");
  refused(() => activateFaction(engine, P1, ENHANCE, P1, { c: [] }), "an empty pick");
  refused(() => activateFaction(engine, P1, ENHANCE, P1, { c: [id("mine"), id("mine2")] }), "two characters");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid by the refused attempts");
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine2"), "strength"), 2);
  enhance(engine, id("mine")); // control
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
});

clause(ALLIANCE, "6:ability", "cannot be used with no character in play to pick", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(ALLIANCE) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 5, P1), { key: "gear", def: item({ name: "My Item" }), owner: P1 }]
  });
  refused(() => activateFaction(engine, P1, ENHANCE, P1, {}), "no characters on the board");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(ALLIANCE, "6:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", () => {
  const two = enhanceBoard(2);
  refused(() => enhance(two.engine, two.id("mine")), "2 resources", /cannot be paid/);
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  assert.equal(two.engine.getStat(two.id("mine"), "strength"), 2, "and the character is unchanged");

  const spent = enhanceBoard(4);
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => enhance(spent.engine, spent.id("mine")), "4 resources, 2 already spent", /cannot be paid/);

  const none = enhanceBoard(0);
  refused(() => enhance(none.engine, none.id("mine")), "no resources", /cannot be paid/);

  const exact = enhanceBoard(3);
  enhance(exact.engine, exact.id("mine")); // control
  assert.equal(exact.engine.getStat(exact.id("mine"), "strength"), 3);
});

clause(ALLIANCE, "6:ability", "the bonus lasts this turn only: it is gone when the next turn starts", () => {
  const { engine, id } = enhanceBoard();
  enhance(engine, id("mine"));
  assert.equal(engine.getStat(id("mine"), "strength"), 3, "during my turn");
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 2, life: 3, speed: 2 }, "back to normal on the opponent's turn");
  endTurn(engine, P2);
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 2, life: 3, speed: 2 }, "and on my next turn");
});

clause(ALLIANCE, "6:ability", "can be used again the same turn, on the same character: the bonuses add up", () => {
  const { engine, id } = enhanceBoard(7);
  enhance(engine, id("mine"));
  enhance(engine, id("mine"));
  assert.deepEqual(statsOf(engine, id("mine")), { strength: 4, life: 5, speed: 2 }, "+2 / +2");
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
  refused(() => enhance(engine, id("mine2")), "a third use needs 3 more resources", /cannot be paid/);
  assert.equal(engine.getStat(id("mine2"), "strength"), 2, "so the other character is unchanged");
});

clause(ALLIANCE, "6:ability", "the extra life is real: damage equal to the old life no longer destroys the character", () => {
  const zap = zapTactic(3);
  const withEnhance = enhanceBoard(5, [{ key: "zap", def: zap, owner: P1, zone: "hand" }]);
  enhance(withEnhance.engine, withEnhance.id("mine"));
  castOn(withEnhance.engine, P1, withEnhance.id("zap"), withEnhance.id("mine"));
  assert.equal(zoneOf(withEnhance.engine, withEnhance.id("mine")), "play", "3 damage on a 4-life character: it survives");
  assert.equal(withEnhance.engine.state.cards[withEnhance.id("mine")].damage, 3);

  const control = enhanceBoard(5, [{ key: "zap", def: zap, owner: P1, zone: "hand" }]);
  castOn(control.engine, P1, control.id("zap"), control.id("mine"));
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: without ENHANCE 3 damage destroys the 3-life character");
});

clause(ALLIANCE, "6:ability", "the extra strength is real: an enhanced attacker deals 1 more damage", () => {
  const enhanced = enhanceBoard(5);
  const base = enhanced.engine.state.players[P2].influence;
  enhance(enhanced.engine, enhanced.id("mine"));
  fightThrough(enhanced.engine, P1, [enhanced.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(base - enhanced.engine.state.players[P2].influence, 3, "strength 2 + 1 = 3 damage to the unblocked faction");

  const control = enhanceBoard(5);
  fightThrough(control.engine, P1, [control.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(base - control.engine.state.players[P2].influence, 2, "control: strength 2 deals 2");
});

clause(ALLIANCE, "6:ability", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(ALLIANCE) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), { key: "foe", def: character({ name: "Their Character" }), owner: P2 }]
  });
  refused(() => activateFaction(engine, P2, ENHANCE, P1, { c: [id("foe")] }), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(attachedCount(engine, P2), 0);
  assert.equal(engine.getStat(id("foe"), "strength"), 1);
});

clause(ALLIANCE, "6:ability", "can be used in response to the opponent's attack", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(ALLIANCE) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "atk", def: character({ name: "Their Attacker", strength: 1 }), owner: P2 },
      { key: "mine", def: character({ name: "My Character", strength: 2, life: 3 }), owner: P1 },
      ...bank("rage", 3, P1)
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority");
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: ENHANCE, selected: { c: [id("mine")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.deepEqual([engine.getStat(id("mine"), "strength"), engine.getStat(id("mine"), "life")], [3, 4]);
  assert.equal(attachedCount(engine, P1), 3);
});

clause(ALLIANCE, "6:ability", "the cost is paid when it is used; the bonus comes when it resolves", () => {
  const { engine, id } = enhanceBoard();
  activateFactionRaw(engine, P1, ENHANCE, { c: [id("mine")] });
  assert.equal(attachedCount(engine, P1), 3, "paid as soon as it is used");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "no bonus yet");
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
});

// =============================================================================
// Drowned Catacombs
// =============================================================================

// --- STARTING RESOURCES: "1 Deception, 1 staple resource."

clause(CATACOMBS, "0:rule:STARTING RESOURCES", "starts with exactly 1 Deception and 1 staple resource in play, both face-up", startsNamedAndStaple(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the named slot is that exact resource, wherever it sits in the deck", namedSlotIsThatResource(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "a non-staple resource is not a 'staple resource'", nonStapleIsNotAStaple(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the 'staple resource' may be a second Deception (any staple will do)", stapleMayBeTheNamedKindToo(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "exactly two starting resources, never more, from a deck full of staples", exactlyTwoStartingResources(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", startingResourcesComeFromTheDeck(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the deck is shuffled after the starting resources are taken", startingResourcesThenShuffle(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", startingResourcesOpponentUnaffected(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "works the same when the faction is in the second seat", startingResourcesSecondSeat(F_CATACOMBS));
clause(CATACOMBS, "0:rule:STARTING RESOURCES", "the player chooses which staple resource to start with", playerChoosesTheStaple(F_CATACOMBS));

// --- STARTING DRAW: "8 going first, 9 going second."

clause(CATACOMBS, "1:rule:STARTING DRAW", "draws 8 cards going first", drawsEightGoingFirst(F_CATACOMBS));
clause(CATACOMBS, "1:rule:STARTING DRAW", "draws 9 cards going second", drawsNineGoingSecond(F_CATACOMBS));
clause(CATACOMBS, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", startingDrawLeavesOpponentAlone(F_CATACOMBS));
clause(CATACOMBS, "1:rule:STARTING DRAW", "works the same when the faction is in the second seat", startingDrawSecondSeat(F_CATACOMBS));
clause(CATACOMBS, "1:rule:STARTING DRAW", "the drawn cards are an opening hand, in addition to the starting resources", startingDrawIsNotTheStartingResources(F_CATACOMBS));

// --- RESTORE RULE

clause(CATACOMBS, "2:rule:RESTORE RULE", "at the start of my turn: my depleted characters, items and locations are restored and every resource is detached from my faction", restoreMyCardsAtMyTurnStart(F_CATACOMBS, P1));
clause(CATACOMBS, "2:rule:RESTORE RULE", "the same when the faction is in the second seat", restoreMyCardsAtMyTurnStart(F_CATACOMBS, P2));
clause(CATACOMBS, "2:rule:RESTORE RULE", "'your' depleted cards are the ones I control, not the ones I own", restoreMeansCardsIControl(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreLeavesOpponentAlone(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreOnlyAtMyTurnStart(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "a character depleted by attacking is restored at the start of my next turn, not before", restoreAfterAttacking(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "only RESOURCES are detached: gear attached to a character stays attached", restoreOnlyDetachesResources(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "renews every turn: resources spent during my turn are detached at the start of the next", restoreRenewsEveryTurn(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "restores 'all' my depleted cards, the faction card included", restoreDepletedFaction(F_CATACOMBS));
clause(CATACOMBS, "2:rule:RESTORE RULE", "nothing else happens at the start of my turn: no draw, no influence change, no counter, no choice", restoreNothingElseHappens(F_CATACOMBS));

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(CATACOMBS, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", developDraws(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", developPlaysResourceFaceUp(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", developPlaysAnyCardFaceDown(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", developNonResourceNotFaceUp(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", developOneOrTheOther(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "can be used only once per turn", developOncePerTurn(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "can be used only on my own turn", developOnlyOnMyTurn(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "is optional and available again every turn", developOptionalAndRenews(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "the resource must come from my hand", developOnlyFromMyHand(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "plays exactly one resource, not two", developExactlyOneResource(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "the resource it plays is ready to pay for things, not attached", developResourceIsReady(F_CATACOMBS));
clause(CATACOMBS, "3:rule:DEVELOP RULE", "drawing from an empty deck draws nothing and does not lose the game", developDrawFromEmptyDeck(F_CATACOMBS));

// --- DRAW: "Pay 3. Draw a card."

clause(CATACOMBS, "4:ability", "pays exactly 3 resources and draws one card", drawPaysAndDraws(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", drawNeedsThree(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "can be used again the same turn", drawRepeatable(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "is separate from the Develop Rule (either order)", drawSeparateFromDevelop(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "only its controller can use it", drawControllerOnly(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "face-down resources can pay for it", drawPaidWithFaceDownResources(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "only my own resources pay for it", drawOnlyMyResourcesPay(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "can be used in response to the opponent's attack", drawInResponse(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "the card drawn is the top card, added to the cards already in my hand", drawTakesTheTopCardOnly(F_CATACOMBS));
clause(CATACOMBS, "4:ability", "with an empty deck the cost is paid, nothing is drawn, and the game goes on", drawFromEmptyDeck(F_CATACOMBS));

// --- RESOURCE: "Pay 4. Play a resource."

clause(CATACOMBS, "5:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", resourceBoardPlays(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "plays a non-resource card face-down as a resource", resourcePlaysNonResourceFaceDown(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "the card must come from my own hand", resourceOnlyFromMyHand(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "is refused when the 4 can't be paid", resourceNeedsFour(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "can be used again the same turn", resourceRepeatable(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "is separate from the Develop Rule (either order)", resourceSeparateFromDevelop(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "only its controller can use it", resourceControllerOnly(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceCanChooseFaceDown(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "'Play a resource' is not a 'may': with cards in my hand I cannot play nothing", resourcePickIsMandatory(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "with nothing in my hand the cost is still paid and nothing else happens", resourceEmptyHand(F_CATACOMBS));
clause(CATACOMBS, "5:ability", "the cost is paid when it is used, the resource is played when it resolves", resourcePaidThenPlayedOnResolution(F_CATACOMBS));

// --- nothing else is printed on the card

clause(CATACOMBS, "6:ability", "the faction card carries no rule or ability beyond the printed ones (no phantom data)", factionHasNoUnprintedRules(F_CATACOMBS));

// --- SNEAK: "X is the number of characters your opponent controls. Pay X. Pick a character with X
// strength or less. This turn, the character gains COVERT."

const SNEAK = "catacombs-sneak";

function sneakBoard(options: { resources?: number; foes?: number[]; mine?: number[]; extra?: CardPlacement[] } = {}) {
  const foes = options.foes ?? [1, 1];
  const mine = options.mine ?? [1];
  return buildGame({
    playerA: { faction: printing(CATACOMBS) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", options.resources ?? 6, P1),
      ...foes.map((strength, index) => ({ key: `foe${index}`, def: character({ name: `Foe ${index}`, strength, life: 4 }), owner: P2 })),
      ...mine.map((strength, index) => ({ key: `mine${index}`, def: character({ name: `Mine ${index}`, strength, life: 4 }), owner: P1 })),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      ...(options.extra ?? [])
    ]
  });
}

const sneak = (engine: SpoilsEngine, targetId: CardInstanceId): void => activateFaction(engine, P1, SNEAK, P1, { c: [targetId] });
const isCovert = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.getKeywords(cardId).includes("covert");

clause(CATACOMBS, "6:ability", "X is the number of characters my opponent controls, and I pay exactly X (0, 1, 2 and 3)", () => {
  for (const foeCount of [0, 1, 2, 3]) {
    const { engine, id } = sneakBoard({ resources: 6, foes: Array.from({ length: foeCount }, () => 1), mine: [0] });
    sneak(engine, id("mine0"));
    assert.equal(attachedCount(engine, P1), foeCount, `opponent controls ${foeCount} characters: X = ${foeCount}`);
    assert.equal(readyCount(engine, P1), 6 - foeCount);
    assert.equal(isCovert(engine, id("mine0")), true, `X = ${foeCount}: the pick gains COVERT`);
  }
});

clause(CATACOMBS, "6:ability", "X counts characters the opponent CONTROLS, and only characters", () => {
  const extra: CardPlacement[] = [
    { key: "foeItem", def: item({ name: "Their Item" }), owner: P2 },
    { key: "foeLoc", def: location({ name: "Their Location" }), owner: P2 },
    { key: "foeHand", def: character({ name: "Their Hand Character" }), owner: P2, zone: "hand" },
    { key: "foeDisc", def: character({ name: "Their Discarded Character" }), owner: P2, zone: "discard" },
    // the opponent OWNS this but I control it: not theirs to count
    { key: "stolenIn", def: character({ name: "Stolen In", strength: 1 }), owner: P2, controller: P1 },
    // I OWN this but the opponent controls it: it counts
    { key: "stolenOut", def: character({ name: "Stolen Out", strength: 1 }), owner: P1, controller: P2 }
  ];
  // foe0, foe1 + stolenOut = 3 characters they control
  const { engine, id } = sneakBoard({ resources: 3, foes: [1, 1], mine: [3], extra });
  sneak(engine, id("mine0"));
  assert.equal(attachedCount(engine, P1), 3, "X = 3: two of their own characters + the one of mine they control; items, locations, cards in hand / discard and the card I control don't count");
  assert.equal(isCovert(engine, id("mine0")), true, "a strength-3 character is within X = 3");
  // ... and X is not 4: a strength-4 character is too strong
  const big = sneakBoard({ resources: 6, foes: [1, 1], mine: [4], extra });
  refused(() => sneak(big.engine, big.id("mine0")), "strength 4 with X = 3");
  assert.equal(attachedCount(big.engine, P1), 0);
});

clause(CATACOMBS, "6:ability", "a face-down card is not a character, so it is not counted", () => {
  const { engine, id } = sneakBoard({
    resources: 6,
    foes: [1],
    mine: [2],
    extra: [{ key: "foeFd", def: character({ name: "Their Face-Down Card", strength: 1 }), owner: P2, faceDown: true }]
  });
  // X = 1 (only foe0), so a strength-2 character is too strong
  refused(() => sneak(engine, id("mine0")), "strength 2 with X = 1");
  assert.equal(attachedCount(engine, P1), 0);
  const ok = sneakBoard({ resources: 6, foes: [1], mine: [1] });
  sneak(ok.engine, ok.id("mine0")); // control
  assert.equal(attachedCount(ok.engine, P1), 1);
});

clause(CATACOMBS, "6:ability", "the pick must have X strength or less: strength 0, 1 and 2 are fine with X = 2, strength 3 and 4 are refused", () => {
  for (const strength of [0, 1, 2, 3, 4]) {
    const { engine, id } = sneakBoard({ foes: [1, 1], mine: [strength] });
    if (strength <= 2) {
      sneak(engine, id("mine0"));
      assert.equal(isCovert(engine, id("mine0")), true, `strength ${strength} <= X`);
    } else {
      refused(() => sneak(engine, id("mine0")), `strength ${strength} > X = 2`);
      assert.equal(isCovert(engine, id("mine0")), false);
      assert.equal(attachedCount(engine, P1), 0, `strength ${strength}: nothing was paid`);
    }
  }
});

clause(CATACOMBS, "6:ability", "'strength' is the character's current strength, bonuses included", () => {
  const { engine, id } = sneakBoard({
    foes: [1, 1],
    mine: [1, 1],
    extra: [{ key: "buff", def: buffTactic(2), owner: P1, zone: "hand" }]
  });
  castOn(engine, P1, id("buff"), id("mine0"));
  assert.equal(engine.getStat(id("mine0"), "strength"), 3, "printed 1, +2 this turn");
  refused(() => sneak(engine, id("mine0")), "current strength 3 > X = 2");
  assert.equal(attachedCount(engine, P1), 0);
  sneak(engine, id("mine1")); // control: the unbuffed character (strength 1)
  assert.equal(isCovert(engine, id("mine1")), true);
});

clause(CATACOMBS, "6:ability", "with X = 0 (the opponent controls no characters) it costs nothing and only a strength-0 character qualifies", () => {
  const { engine, id } = sneakBoard({ foes: [], mine: [0, 1] });
  refused(() => sneak(engine, id("mine1")), "strength 1 > X = 0");
  assert.equal(isCovert(engine, id("mine1")), false);
  sneak(engine, id("mine0"));
  assert.equal(isCovert(engine, id("mine0")), true);
  assert.equal(attachedCount(engine, P1), 0, "X = 0: nothing to pay");
});

clause(CATACOMBS, "6:ability", "X is worked out each time it is used (the opponent lost a character in between)", () => {
  const { engine, id } = sneakBoard({
    resources: 5,
    foes: [1, 1, 1],
    mine: [0],
    extra: [{ key: "kill", def: killOne(), owner: P1, zone: "hand" }]
  });
  sneak(engine, id("mine0"));
  assert.equal(attachedCount(engine, P1), 3, "first use: X = 3");
  castOn(engine, P1, id("kill"), id("foe0"));
  assert.equal(zoneOf(engine, id("foe0")), "discard");
  sneak(engine, id("mine0"));
  assert.equal(attachedCount(engine, P1), 5, "second use: X = 2");
});

clause(CATACOMBS, "6:ability", "is refused when X can't be paid (X = 3 with 2 resources), and then nothing is paid or granted", () => {
  const short = sneakBoard({ resources: 2, foes: [1, 1, 1], mine: [0] });
  refused(() => sneak(short.engine, short.id("mine0")), "X = 3, 2 resources", /cannot be paid/);
  assert.equal(attachedCount(short.engine, P1), 0, "nothing was half-paid");
  assert.equal(isCovert(short.engine, short.id("mine0")), false);
  const spent = sneakBoard({ resources: 4, foes: [1, 1, 1], mine: [0] });
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => sneak(spent.engine, spent.id("mine0")), "X = 3, 4 resources of which 2 are spent", /cannot be paid/);
  const exact = sneakBoard({ resources: 3, foes: [1, 1, 1], mine: [0] });
  sneak(exact.engine, exact.id("mine0")); // control: exactly X
  assert.equal(isCovert(exact.engine, exact.id("mine0")), true);
});

clause(CATACOMBS, "6:ability", "the picked character gains COVERT, and no other character does", () => {
  const { engine, id } = sneakBoard({ foes: [1, 1], mine: [1, 1] });
  assert.equal(isCovert(engine, id("mine0")), false, "not covert before");
  sneak(engine, id("mine0"));
  assert.equal(isCovert(engine, id("mine0")), true);
  assert.equal(isCovert(engine, id("mine1")), false, "my other character is not covert");
  assert.equal(isCovert(engine, id("foe0")), false, "nor is the opponent's");
});

clause(CATACOMBS, "6:ability", "gaining COVERT keeps the keywords the character already has", () => {
  const { engine, id } = sneakBoard({
    foes: [1, 1],
    mine: [],
    extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 3, behavior: { keywords: ["aggro"] } }), owner: P1 }]
  });
  assert.deepEqual(engine.getKeywords(id("raider")).filter((keyword) => keyword === "aggro" || keyword === "covert").sort(), ["aggro"]);
  sneak(engine, id("raider"));
  assert.deepEqual(engine.getKeywords(id("raider")).filter((keyword) => keyword === "aggro" || keyword === "covert").sort(), ["aggro", "covert"]);
});

clause(CATACOMBS, "6:ability", "the opponent's character can be picked too (it gains COVERT, mine does not)", () => {
  const { engine, id } = sneakBoard({ foes: [1, 1], mine: [1] });
  sneak(engine, id("foe0"));
  assert.equal(isCovert(engine, id("foe0")), true);
  assert.equal(isCovert(engine, id("mine0")), false);
  assert.equal(attachedCount(engine, P1), 2);
});

clause(CATACOMBS, "6:ability", "COVERT lasts this turn only: it is gone when the next turn starts", () => {
  const { engine, id } = sneakBoard({ foes: [1], mine: [1] });
  sneak(engine, id("mine0"));
  assert.equal(isCovert(engine, id("mine0")), true, "during my turn");
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isCovert(engine, id("mine0")), false, "gone on the opponent's turn");
  endTurn(engine, P2);
  assert.equal(isCovert(engine, id("mine0")), false, "and on my next turn");
});

clause(CATACOMBS, "6:ability", "the COVERT it grants works: the picked attacker can't be blocked by a non-covert character", () => {
  const covertFoe: CardPlacement = { key: "covertFoe", def: character({ name: "Covert Foe", strength: 1, life: 4, behavior: { keywords: ["covert"] } }), owner: P2 };
  const { engine, id } = sneakBoard({ foes: [1], mine: [1], extra: [covertFoe] }); // X = 2
  sneak(engine, id("mine0"));
  assert.equal(attachedCount(engine, P1), 2);
  declareAttackBy(engine, P1, [id("mine0")]);
  refused(() => engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("foe0")] }), "a non-covert character can't block a covert attacker");
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [id("covertFoe")] }); // control: a covert character can
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("covertFoe")]);

  const control = sneakBoard({ foes: [1], mine: [1], extra: [covertFoe] }); // no SNEAK
  declareAttackBy(control.engine, P1, [control.id("mine0")]);
  control.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [control.id("foe0")] });
  assert.deepEqual(battleOf(control.engine)?.blockingParty, [control.id("foe0")], "control: without SNEAK the plain character blocks fine");
});

clause(CATACOMBS, "6:ability", "only a CHARACTER in play can be picked (not an item, location, faction, face-down card, or a character in hand or discard pile)", () => {
  const extra: CardPlacement[] = [
    { key: "gear", def: item({ name: "My Item" }), owner: P1 },
    { key: "loc", def: location({ name: "Their Location" }), owner: P2 },
    { key: "fd", def: character({ name: "Face-Down Card", strength: 0 }), owner: P1, faceDown: true },
    { key: "handChar", def: character({ name: "Hand Character", strength: 0 }), owner: P1, zone: "hand" },
    { key: "discChar", def: character({ name: "Discarded Character", strength: 0 }), owner: P1, zone: "discard" }
  ];
  const { engine, id } = sneakBoard({ resources: 8, foes: [1, 1], mine: [0], extra });
  for (const [label, target] of [
    ["an item", id("gear")],
    ["a location", id("loc")],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("handChar")],
    ["a character in my discard pile", id("discChar")],
    ["my faction", factionOf(engine, P1)],
    ["the opponent's faction", factionOf(engine, P2)]
  ] as Array<[string, CardInstanceId]>) {
    refused(() => sneak(engine, target), label);
    assert.equal(attachedCount(engine, P1), 0, `${label}: nothing was paid`);
  }
  sneak(engine, id("mine0")); // control: a character in play
  assert.equal(isCovert(engine, id("mine0")), true);
});

clause(CATACOMBS, "6:ability", "a character must be picked, and exactly one", () => {
  const { engine, id } = sneakBoard({ foes: [1, 1], mine: [0, 0] });
  refused(() => activateFaction(engine, P1, SNEAK, P1, {}), "no pick");
  refused(() => activateFaction(engine, P1, SNEAK, P1, { c: [] }), "an empty pick");
  refused(() => activateFaction(engine, P1, SNEAK, P1, { c: [id("mine0"), id("mine1")] }), "two characters");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid by the refused attempts");
  assert.equal(isCovert(engine, id("mine0")) || isCovert(engine, id("mine1")), false);
  sneak(engine, id("mine0")); // control
  assert.equal(isCovert(engine, id("mine0")), true);
});

clause(CATACOMBS, "6:ability", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(CATACOMBS) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), { key: "foe", def: character({ name: "Their Character", strength: 0 }), owner: P2 }, { key: "mine", def: character({ name: "Mine", strength: 0 }), owner: P1 }]
  });
  refused(() => activateFaction(engine, P2, SNEAK, P1, { c: [id("foe")] }), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(attachedCount(engine, P2), 0);
  assert.equal(isCovert(engine, id("foe")), false);
});

clause(CATACOMBS, "6:ability", "the cost is paid when it is used; COVERT is granted when it resolves", () => {
  const { engine, id } = sneakBoard({ foes: [1, 1], mine: [1] });
  activateFactionRaw(engine, P1, SNEAK, { c: [id("mine0")] });
  assert.equal(attachedCount(engine, P1), 2, "X = 2 is paid as soon as it is used");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(isCovert(engine, id("mine0")), false, "not covert yet");
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("mine0")), true);
});

clause(CATACOMBS, "6:ability", "can be used in response to the opponent's attack", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(CATACOMBS) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      { key: "atk", def: character({ name: "Their Attacker", strength: 1 }), owner: P2 },
      { key: "mine", def: character({ name: "My Character", strength: 1 }), owner: P1 },
      ...bank("rage", 3, P1)
    ]
  });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I hold priority");
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: SNEAK, selected: { c: [id("mine")] }, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(isCovert(engine, id("mine")), true, "granted in response");
  assert.equal(attachedCount(engine, P1), 1, "X = 1 (their one attacker)");
});

// =============================================================================
// Hall of Great Justice
// =============================================================================

// --- STARTING RESOURCES: "1 Rage, 1 staple resource."

clause(HALL, "0:rule:STARTING RESOURCES", "starts with exactly 1 Rage and 1 staple resource in play, both face-up", startsNamedAndStaple(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the named slot is that exact resource, wherever it sits in the deck", namedSlotIsThatResource(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "a non-staple resource is not a 'staple resource'", nonStapleIsNotAStaple(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the 'staple resource' may be a second Rage (any staple will do)", stapleMayBeTheNamedKindToo(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "exactly two starting resources, never more, from a deck full of staples", exactlyTwoStartingResources(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", startingResourcesComeFromTheDeck(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the deck is shuffled after the starting resources are taken", startingResourcesThenShuffle(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the opponent starts with their own resources", startingResourcesOpponentUnaffected(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "works the same when the faction is in the second seat", startingResourcesSecondSeat(F_HALL));
clause(HALL, "0:rule:STARTING RESOURCES", "the player chooses which staple resource to start with", playerChoosesTheStaple(F_HALL));

// --- STARTING DRAW: "8 going first, 9 going second."

clause(HALL, "1:rule:STARTING DRAW", "draws 8 cards going first", drawsEightGoingFirst(F_HALL));
clause(HALL, "1:rule:STARTING DRAW", "draws 9 cards going second", drawsNineGoingSecond(F_HALL));
clause(HALL, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", startingDrawLeavesOpponentAlone(F_HALL));
clause(HALL, "1:rule:STARTING DRAW", "works the same when the faction is in the second seat", startingDrawSecondSeat(F_HALL));
clause(HALL, "1:rule:STARTING DRAW", "the drawn cards are an opening hand, in addition to the starting resources", startingDrawIsNotTheStartingResources(F_HALL));

// --- RESTORE RULE

clause(HALL, "2:rule:RESTORE RULE", "at the start of my turn: my depleted characters, items and locations are restored and every resource is detached from my faction", restoreMyCardsAtMyTurnStart(F_HALL, P1));
clause(HALL, "2:rule:RESTORE RULE", "the same when the faction is in the second seat", restoreMyCardsAtMyTurnStart(F_HALL, P2));
clause(HALL, "2:rule:RESTORE RULE", "'your' depleted cards are the ones I control, not the ones I own", restoreMeansCardsIControl(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreLeavesOpponentAlone(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreOnlyAtMyTurnStart(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "a character depleted by attacking is restored at the start of my next turn, not before", restoreAfterAttacking(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "only RESOURCES are detached: gear attached to a character stays attached", restoreOnlyDetachesResources(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "renews every turn: resources spent during my turn are detached at the start of the next", restoreRenewsEveryTurn(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "restores 'all' my depleted cards, the faction card included", restoreDepletedFaction(F_HALL));
clause(HALL, "2:rule:RESTORE RULE", "nothing else happens at the start of my turn: no draw, no influence change, no counter, no choice", restoreNothingElseHappens(F_HALL));

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(HALL, "3:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", developDraws(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", developPlaysResourceFaceUp(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition), even an actual resource card", developPlaysAnyCardFaceDown(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", developNonResourceNotFaceUp(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "draw OR play a resource: not both", developOneOrTheOther(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "can be used only once per turn", developOncePerTurn(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "can be used only on my own turn", developOnlyOnMyTurn(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "is optional and available again every turn", developOptionalAndRenews(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "the resource must come from my hand", developOnlyFromMyHand(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "plays exactly one resource, not two", developExactlyOneResource(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "the resource it plays is ready to pay for things, not attached", developResourceIsReady(F_HALL));
clause(HALL, "3:rule:DEVELOP RULE", "drawing from an empty deck draws nothing and does not lose the game", developDrawFromEmptyDeck(F_HALL));

// --- DRAW: "Pay 3. Draw a card."

clause(HALL, "4:ability", "pays exactly 3 resources and draws one card", drawPaysAndDraws(F_HALL));
clause(HALL, "4:ability", "is refused when the 3 can't be paid (2 resources, 4 with 2 already spent, none)", drawNeedsThree(F_HALL));
clause(HALL, "4:ability", "can be used again the same turn", drawRepeatable(F_HALL));
clause(HALL, "4:ability", "is separate from the Develop Rule (either order)", drawSeparateFromDevelop(F_HALL));
clause(HALL, "4:ability", "only its controller can use it", drawControllerOnly(F_HALL));
clause(HALL, "4:ability", "face-down resources can pay for it", drawPaidWithFaceDownResources(F_HALL));
clause(HALL, "4:ability", "only my own resources pay for it", drawOnlyMyResourcesPay(F_HALL));
clause(HALL, "4:ability", "can be used in response to the opponent's attack", drawInResponse(F_HALL));
clause(HALL, "4:ability", "the card drawn is the top card, added to the cards already in my hand", drawTakesTheTopCardOnly(F_HALL));
clause(HALL, "4:ability", "with an empty deck the cost is paid, nothing is drawn, and the game goes on", drawFromEmptyDeck(F_HALL));

// --- RESOURCE: "Pay 4. Play a resource."

clause(HALL, "5:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", resourceBoardPlays(F_HALL));
clause(HALL, "5:ability", "plays a non-resource card face-down as a resource", resourcePlaysNonResourceFaceDown(F_HALL));
clause(HALL, "5:ability", "the card must come from my own hand", resourceOnlyFromMyHand(F_HALL));
clause(HALL, "5:ability", "is refused when the 4 can't be paid", resourceNeedsFour(F_HALL));
clause(HALL, "5:ability", "can be used again the same turn", resourceRepeatable(F_HALL));
clause(HALL, "5:ability", "is separate from the Develop Rule (either order)", resourceSeparateFromDevelop(F_HALL));
clause(HALL, "5:ability", "only its controller can use it", resourceControllerOnly(F_HALL));
clause(HALL, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceCanChooseFaceDown(F_HALL));
clause(HALL, "5:ability", "'Play a resource' is not a 'may': with cards in my hand I cannot play nothing", resourcePickIsMandatory(F_HALL));
clause(HALL, "5:ability", "with nothing in my hand the cost is still paid and nothing else happens", resourceEmptyHand(F_HALL));
clause(HALL, "5:ability", "the cost is paid when it is used, the resource is played when it resolves", resourcePaidThenPlayedOnResolution(F_HALL));

// --- nothing else is printed on the card

clause(HALL, "6:ability", "the faction card carries no rule or ability beyond the printed ones (no phantom data)", factionHasNoUnprintedRules(F_HALL));

// --- FOR GREAT JUSTICE!: "COST: Pay 5. Pick a character you control. X is its strength. Destroy it.
// Pick another character.   EFFECT: Inflict X damage to the character."

const JUSTICE = "hall-for-great-justice";

function justiceBoard(resources = 7, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: printing(HALL) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      { key: "sac", def: character({ name: "Sacrifice", strength: 3, life: 5 }), owner: P1 },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 2 }), owner: P1 },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6 }), owner: P2 },
      { key: "foe2", def: character({ name: "Weak Foe", strength: 1, life: 2 }), owner: P2 },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      ...extra
    ]
  });
}

const justice = (engine: SpoilsEngine, c1: CardInstanceId, c2: CardInstanceId): void => activateFaction(engine, P1, JUSTICE, P1, { c1: [c1], c2: [c2] });
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;

clause(HALL, "6:ability", "pays exactly 5 resources", () => {
  const { engine, id } = justiceBoard(7);
  justice(engine, id("sac"), id("foe"));
  assert.equal(attachedCount(engine, P1), 5, "exactly 5 resources were paid");
  assert.equal(readyCount(engine, P1), 2);
});

clause(HALL, "6:ability", "the character I pick is destroyed (it goes to its owner's discard pile) and nothing else of mine is", () => {
  const { engine, id } = justiceBoard();
  justice(engine, id("sac"), id("foe"));
  assert.equal(zoneOf(engine, id("sac")), "discard", "destroyed");
  assert.deepEqual(discardOf(engine, P1), [id("sac")], "in my discard pile");
  assert.equal(zoneOf(engine, id("ally")), "play", "my other character is untouched");
  assert.equal(damageOn(engine, id("ally")), 0);
});

clause(HALL, "6:ability", "X is the destroyed character's strength: it inflicts that much damage on the other character (3 and 1)", () => {
  for (const [sacrifice, expected] of [["sac", 3], ["ally", 1]] as Array<[string, number]>) {
    const { engine, id } = justiceBoard();
    justice(engine, id(sacrifice), id("foe"));
    assert.equal(damageOn(engine, id("foe")), expected, `${sacrifice}: strength ${expected}`);
    assert.equal(zoneOf(engine, id("foe")), "play", "Foe has 6 life: it survives");
    assert.equal(damageOn(engine, id("foe2")), 0, "no other character is damaged");
  }
});

clause(HALL, "6:ability", "X is the character's CURRENT strength, bonuses included", () => {
  const { engine, id } = justiceBoard(7, [{ key: "buff", def: buffTactic(2), owner: P1, zone: "hand" }]);
  castOn(engine, P1, id("buff"), id("sac"));
  assert.equal(engine.getStat(id("sac"), "strength"), 5);
  justice(engine, id("sac"), id("foe"));
  assert.equal(damageOn(engine, id("foe")), 5, "X = 3 + 2");
});

clause(HALL, "6:ability", "a strength-0 character gives X = 0: it is destroyed and no damage is inflicted", () => {
  const { engine, id } = justiceBoard(7, [{ key: "zero", def: character({ name: "Zero", strength: 0, life: 3 }), owner: P1 }]);
  justice(engine, id("zero"), id("foe"));
  assert.equal(zoneOf(engine, id("zero")), "discard");
  assert.equal(damageOn(engine, id("foe")), 0, "X = 0");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(HALL, "6:ability", "enough damage destroys the other character: the opponent's, or my own other character", () => {
  const theirs = justiceBoard();
  justice(theirs.engine, theirs.id("sac"), theirs.id("foe2")); // 3 damage on a 2-life character
  assert.equal(zoneOf(theirs.engine, theirs.id("foe2")), "discard", "3 damage destroys the 2-life character");
  assert.deepEqual(discardOf(theirs.engine, P2), [theirs.id("foe2")]);

  const mine = justiceBoard();
  justice(mine.engine, mine.id("sac"), mine.id("ally")); // 'another character' may be my own
  assert.equal(zoneOf(mine.engine, mine.id("ally")), "discard", "my 2-life ally takes 3 damage");
  assert.equal(zoneOf(mine.engine, mine.id("sac")), "discard");
});

clause(HALL, "6:ability", "the damage is the only thing that hurts the other character: less damage than its life leaves it standing", () => {
  const { engine, id } = justiceBoard();
  justice(engine, id("ally"), id("foe2")); // 1 damage on a 2-life character
  assert.equal(damageOn(engine, id("foe2")), 1);
  assert.equal(zoneOf(engine, id("foe2")), "play");
});

clause(HALL, "6:ability", "the first pick must be a character I control: the opponent's is refused", () => {
  const { engine, id } = justiceBoard();
  refused(() => justice(engine, id("foe"), id("foe2")), "the opponent's character as the sacrifice");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
  assert.equal(zoneOf(engine, id("foe")), "play");
  justice(engine, id("sac"), id("foe2")); // control: my own character
  assert.equal(zoneOf(engine, id("sac")), "discard");
});

clause(HALL, "6:ability", "'a character you control': one I control but don't own can be the sacrifice (and goes to its owner's discard pile); one I own but don't control can't", () => {
  const extra: CardPlacement[] = [
    { key: "stolenIn", def: character({ name: "Stolen In", strength: 2, life: 3 }), owner: P2, controller: P1 },
    { key: "stolenOut", def: character({ name: "Stolen Out", strength: 2, life: 3 }), owner: P1, controller: P2 }
  ];
  const out = justiceBoard(7, extra);
  refused(() => justice(out.engine, out.id("stolenOut"), out.id("foe")), "a character I own but the opponent controls");
  assert.equal(zoneOf(out.engine, out.id("stolenOut")), "play");
  assert.equal(attachedCount(out.engine, P1), 0);

  const inn = justiceBoard(7, extra);
  justice(inn.engine, inn.id("stolenIn"), inn.id("foe"));
  assert.equal(zoneOf(inn.engine, inn.id("stolenIn")), "discard", "destroyed");
  assert.deepEqual(discardOf(inn.engine, P2), [inn.id("stolenIn")], "into its owner's discard pile");
  assert.equal(damageOn(inn.engine, inn.id("foe")), 2, "X = its strength");
});

clause(HALL, "6:ability", "'another character': the damaged character cannot be the one that was destroyed", () => {
  const { engine, id } = justiceBoard();
  refused(() => justice(engine, id("sac"), id("sac")), "the same character twice");
  assert.equal(zoneOf(engine, id("sac")), "play");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
  justice(engine, id("sac"), id("ally")); // control: a different character
  assert.equal(zoneOf(engine, id("sac")), "discard");
});

clause(HALL, "6:ability", "with only one character in play there is no 'another character' to pick, so it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(HALL) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 6, P1), { key: "lone", def: character({ name: "Lone Character", strength: 2 }), owner: P1 }]
  });
  refused(() => justice(engine, id("lone"), id("lone")), "the only character twice");
  assert.equal(zoneOf(engine, id("lone")), "play");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(HALL, "6:ability", "both picks are needed, each exactly one character", () => {
  const { engine, id } = justiceBoard();
  refused(() => activateFaction(engine, P1, JUSTICE, P1, { c1: [id("sac")] }), "no second pick");
  refused(() => activateFaction(engine, P1, JUSTICE, P1, { c2: [id("foe")] }), "no first pick");
  refused(() => activateFaction(engine, P1, JUSTICE, P1, {}), "no picks");
  refused(() => activateFaction(engine, P1, JUSTICE, P1, { c1: [id("sac"), id("ally")], c2: [id("foe")] }), "two sacrifices");
  refused(() => activateFaction(engine, P1, JUSTICE, P1, { c1: [id("sac")], c2: [id("foe"), id("foe2")] }), "two damage targets");
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid by the refused attempts");
  assert.equal(zoneOf(engine, id("sac")), "play", "and nothing was destroyed");
  justice(engine, id("sac"), id("foe")); // control
  assert.equal(zoneOf(engine, id("sac")), "discard");
});

clause(HALL, "6:ability", "only a CHARACTER in play can be picked, for either pick (not an item, location, faction, face-down card, or a character in hand or discard pile)", () => {
  const extra: CardPlacement[] = [
    { key: "gear", def: item({ name: "My Item" }), owner: P1 },
    { key: "loc", def: location({ name: "Their Location" }), owner: P2 },
    { key: "fd", def: character({ name: "Face-Down Card" }), owner: P1, faceDown: true },
    { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
    { key: "discChar", def: character({ name: "Discarded Character" }), owner: P1, zone: "discard" }
  ];
  const { engine, id } = justiceBoard(12, extra);
  const notCharacters = [
    ["an item", id("gear")],
    ["a location", id("loc")],
    ["a face-down card", id("fd")],
    ["a character in my hand", id("handChar")],
    ["a character in my discard pile", id("discChar")],
    ["my faction", factionOf(engine, P1)],
    ["the opponent's faction", factionOf(engine, P2)]
  ] as Array<[string, CardInstanceId]>;
  for (const [label, target] of notCharacters) {
    refused(() => justice(engine, target, id("foe")), `${label} as the sacrifice`);
    refused(() => justice(engine, id("sac"), target), `${label} as the damaged character`);
    assert.equal(attachedCount(engine, P1), 0, `${label}: nothing was paid`);
    assert.equal(zoneOf(engine, id("sac")), "play", `${label}: nothing was destroyed`);
  }
  justice(engine, id("sac"), id("foe")); // control
  assert.equal(zoneOf(engine, id("sac")), "discard");
});

clause(HALL, "6:ability", "is refused when the 5 can't be paid (4 resources, 6 with 2 already spent, none): nothing is destroyed", () => {
  const four = justiceBoard(4);
  refused(() => justice(four.engine, four.id("sac"), four.id("foe")), "4 resources", /cannot be paid/);
  assert.equal(attachedCount(four.engine, P1), 0, "nothing was half-paid");
  assert.equal(zoneOf(four.engine, four.id("sac")), "play", "the character was not destroyed");
  assert.equal(damageOn(four.engine, four.id("foe")), 0);

  const spent = justiceBoard(6);
  for (const resourceId of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[resourceId].attachedTo = factionOf(spent.engine, P1);
  refused(() => justice(spent.engine, spent.id("sac"), spent.id("foe")), "6 resources, 2 already spent", /cannot be paid/);
  assert.equal(zoneOf(spent.engine, spent.id("sac")), "play");

  const none = justiceBoard(0);
  refused(() => justice(none.engine, none.id("sac"), none.id("foe")), "no resources", /cannot be paid/);

  const exact = justiceBoard(5);
  justice(exact.engine, exact.id("sac"), exact.id("foe")); // control
  assert.equal(zoneOf(exact.engine, exact.id("sac")), "discard");
});

clause(HALL, "6:ability", "can be used again the same turn", () => {
  const { engine, id } = justiceBoard(10);
  justice(engine, id("sac"), id("foe"));
  justice(engine, id("ally"), id("foe"));
  assert.equal(damageOn(engine, id("foe")), 3 + 1);
  assert.equal(attachedCount(engine, P1), 10);
});

clause(HALL, "6:ability", "only its controller can use it", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(HALL) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", 6, P2),
      { key: "theirs", def: character({ name: "Their Character", strength: 2 }), owner: P2 },
      { key: "theirs2", def: character({ name: "Their Other Character", strength: 2 }), owner: P2 }
    ]
  });
  refused(() => activateFaction(engine, P2, JUSTICE, P1, { c1: [id("theirs")], c2: [id("theirs2")] }), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(attachedCount(engine, P2), 0);
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(HALL, "6:ability", "the damage is inflicted when it resolves, not when it is used", () => {
  const { engine, id } = justiceBoard();
  activateFactionRaw(engine, P1, JUSTICE, { c1: [id("sac")], c2: [id("foe")] });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(attachedCount(engine, P1), 5, "the cost is paid as soon as it is used");
  assert.equal(damageOn(engine, id("foe")), 0, "no damage yet: it is the EFFECT");
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("foe")), 3);
});

clause(HALL, "6:ability", "destroying the character is part of the COST: it is already destroyed when the opponent gets to respond", () => {
  const { engine, id } = justiceBoard();
  activateFactionRaw(engine, P1, JUSTICE, { c1: [id("sac")], c2: [id("foe")] });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(engine, id("sac")), "discard", "the cost (destroy it) has already been paid");
});

clause(HALL, "6:ability", "the sacrificed character is gone when the opponent responds, so it cannot be targeted, and X stays what it was", () => {
  const { engine, id } = justiceBoard(7, [{ key: "kill", def: killOne(), owner: P2, zone: "hand" }]);
  activateFactionRaw(engine, P1, JUSTICE, { c1: [id("sac")], c2: [id("foe")] });
  refused(() => castOn(engine, P2, id("kill"), id("sac")), "the sacrificed character is no longer in play to be picked");
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("foe")), 3, "X = 3, the strength it had when it was sacrificed");
});

clause(HALL, "6:ability", "if the opponent destroys the damaged character in response, the sacrifice is still paid and the game goes on", () => {
  const { engine, id } = justiceBoard(7, [{ key: "kill", def: killOne(), owner: P2, zone: "hand" }]);
  activateFactionRaw(engine, P1, JUSTICE, { c1: [id("sac")], c2: [id("foe")] });
  castOn(engine, P2, id("kill"), id("foe"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined, "nothing is left hanging");
  assert.equal(zoneOf(engine, id("sac")), "discard", "the sacrifice stays destroyed");
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(attachedCount(engine, P1), 5);
  assert.equal(damageOn(engine, id("foe2")), 0, "no other character was damaged instead");
});
