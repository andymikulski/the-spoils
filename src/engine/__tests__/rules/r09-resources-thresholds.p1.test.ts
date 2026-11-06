// Batch r09-resources-thresholds, part 1 (docs/TESTING.md): CR 202 Factions.
// Written from the wording of the Comprehensive Rules, not from the engine.

import assert from "node:assert/strict";
import {
  createFactionGame,
  findDeckConstructionIssues,
  type CardDefinition,
  type Effect,
  type FactionDefinition,
  type PlayerId,
  type SpoilsEngine
} from "../../../engine.js";
import {
  autoResolveBattle,
  buildGame,
  character,
  defaultFactionDefinition,
  factionCard,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic
} from "../support/fixtures.js";
import { refused, rule } from "./_rule.js";
import { chooseDevelopOption, developPlayAtTurnStart, orderUntilDevelopPrompt, settleTurnStart } from "../support/develop.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAGE = resourceCard({ id: "r09p1-rage", name: "Rage", resource: { provides: ["rage"], staple: true } });
const GREED = resourceCard({ id: "r09p1-greed", name: "Greed", resource: { provides: ["greed"], staple: true } });
const FANCY = resourceCard({ id: "r09p1-fancy", name: "Fancy", resource: { provides: ["rage"] } });
const FILL = character({ id: "r09p1-fill", name: "Fill" });

type Turn = FactionDefinition["turn"];

/** A faction with a chosen starting influence, setup and turn rules; everything else is the fixture default. */
function faction(
  id: string,
  over: { influence?: number; setup?: Partial<FactionDefinition["setup"]>; turn?: Turn } = {}
): CardDefinition {
  const base = defaultFactionDefinition();
  return factionCard({
    id,
    name: id,
    faction: defaultFactionDefinition({
      startingInfluence: over.influence ?? 25,
      setup: { ...base.setup, ...over.setup },
      turn: over.turn ?? base.turn
    })
  });
}

const turnRules = (detachResources: boolean, restoreNonResources: boolean, choices: Turn["develop"]["choices"]): Turn => ({
  restore: { detachResources, restoreNonResources },
  develop: { choices }
});

/** The deck list for a player: the faction first, then `cards`. */
const deckOf = (factionId: string, ...cards: string[]): string[] => [factionId, ...cards];

/** `count` copies of a definition id. */
const copies = (id: string, count: number): string[] => Array.from({ length: count }, () => id);

function newGame(
  definitions: CardDefinition[],
  deckA: string[],
  deckB: string[],
  options: Parameters<typeof createFactionGame>[2] = {}
): SpoilsEngine {
  return createFactionGame(
    definitions,
    [{ id: P1, name: "Alice", deckDefinitionIds: deckA },
    { id: P2, name: "Bob", deckDefinitionIds: deckB }],
    { firstPlayerId: P1, seed: 11, ...options }
  );
}

const factionIdOf = (engine: SpoilsEngine, playerId: PlayerId) => engine.state.players[playerId].factionId!;

/** The names of the cards a player holds in play other than the faction. */
const inPlayNames = (engine: SpoilsEngine, playerId: PlayerId): string[] =>
  engine.state.players[playerId].play
    .filter((cardId) => cardId !== factionIdOf(engine, playerId))
    .map((cardId) => engine.getDefinition(cardId).name);

/** A tactic that deals `amount` damage to a player's faction. */
const damageToFaction = (name: string, player: "opponent" | "controller", amount: number) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          effects: [{ type: "dealDamage", target: { type: "factionOf", player }, amount }]
        }
      ]
    }
  });

function cast(engine: SpoilsEngine, playerId: PlayerId, cardId: string): void {
  engine.perform({ type: "playCard", playerId, cardId });
  resolvePendingResponses(engine);
}

/** Passes priority and advances flow until the response windows are gone or a choice is pending. */
function settleWindows(engine: SpoilsEngine): void {
  for (let guard = 0; engine.state.responseWindow && !engine.state.pendingChoice; guard++) {
    assert.ok(guard < 100, "the response windows must close");
    const window = engine.state.responseWindow;
    if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
    else engine.perform({ type: "advanceFlow" });
  }
}

/**
 * The active player ends their turn and the opponent's turn starts: the Restore Rule and Develop Rule are start-of-turn
 * triggers (user ruling 2026-10-27), so they are put in order (Restore first) and the Develop Rule is skipped.
 */
function passTurn(engine: SpoilsEngine, playerId: PlayerId): void {
  engine.perform({ type: "endTurn", playerId });
  settleWindows(engine);
  settleTurnStart(engine);
}

/** As `passTurn`, but stops at the new active player's Develop Rule prompt and returns the options it offers (Skip excluded). */
function passTurnToDevelop(engine: SpoilsEngine, playerId: PlayerId): string[] {
  engine.perform({ type: "endTurn", playerId });
  settleWindows(engine);
  return orderUntilDevelopPrompt(engine).filter((label) => label !== "Skip the Develop Rule");
}

// ---------------------------------------------------------------------------
// CR 202.1 One faction per deck
// ---------------------------------------------------------------------------

const F_A = faction("r09p1-fa");
const F_B = faction("r09p1-fb");

const construction = (cards: CardDefinition[]) =>
  findDeckConstructionIssues(cards, { minimumSize: false, factionRules: false }).map((issue) => issue.kind);

rule("CR 202.1", "a decklist with exactly one faction card has no faction-count problem", () => {
  assert.deepEqual(construction([F_A, RAGE, FILL]), []);
});

rule("CR 202.1", "a decklist with two faction cards is not a legal deck", () => {
  assert.deepEqual(construction([F_A, F_B, RAGE, FILL]), ["factionCount"]);
  assert.deepEqual(construction([F_A, F_A, RAGE, FILL]), ["factionCount"], "two copies of the same faction are two faction cards");
});

rule("CR 202.1", "a decklist with no faction card is not a legal deck", () => {
  assert.deepEqual(construction([RAGE, FILL]), ["factionCount"]);
});

rule("CR 202.1", "starting a game with a deck holding two faction cards, or none, is refused; one is accepted", () => {
  const defs = [F_A, F_B, RAGE, FILL];
  const ok = deckOf(F_B.id, ...copies(FILL.id, 5));
  refused(() => newGame(defs, [F_A.id, F_B.id, ...copies(FILL.id, 5)], ok), "two faction cards in one deck", /exactly one faction/);
  refused(() => newGame(defs, copies(FILL.id, 5), ok), "no faction card in the deck", /faction/);
  const engine = newGame(defs, deckOf(F_A.id, ...copies(FILL.id, 5)), ok);
  assert.equal(engine.getDefinition(factionIdOf(engine, P1)).id, F_A.id, "control: a deck with one faction card starts");
});

// ---------------------------------------------------------------------------
// CR 202.2 Your faction starts the game in play
// ---------------------------------------------------------------------------

rule("CR 202.2", "each player's faction card starts the game in play, not in their deck or hand", () => {
  const engine = newGame([F_A, F_B, RAGE, FILL], deckOf(F_A.id, ...copies(FILL.id, 6)), deckOf(F_B.id, ...copies(FILL.id, 6)));
  for (const [playerId, faction] of [[P1, F_A], [P2, F_B]] as const) {
    const player = engine.state.players[playerId];
    const factionId = player.factionId!;
    assert.equal(engine.getDefinition(factionId).id, faction.id, `${playerId} has their own faction`);
    assert.equal(engine.state.cards[factionId]!.zone, "play", `${playerId}'s faction is in play`);
    assert.ok(player.play.includes(factionId), "the faction is in the play list");
    assert.ok(!player.deck.includes(factionId), "the faction is not in the deck");
    assert.ok(!player.hand.includes(factionId), "the faction is not in the hand");
  }
});

rule("CR 202.2", "the faction is in play even when the deck's opening hand is empty and nothing else starts in play", () => {
  const f = faction("r09p1-bare", { setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const engine = newGame([f, FILL], deckOf(f.id, ...copies(FILL.id, 3)), deckOf(f.id, ...copies(FILL.id, 3)));
  assert.equal(engine.state.players[P1].play.length, 1, "only the faction is in play");
  assert.equal(engine.state.cards[factionIdOf(engine, P1)]!.zone, "play");
});

// ---------------------------------------------------------------------------
// CR 202.3 / 202.3a Influence is the score
// ---------------------------------------------------------------------------

rule("CR 202.3", "a faction's influence is its player's score: the player holds exactly the faction's influence at the start", () => {
  const engine = newGame([F_A, F_B, FILL], deckOf(F_A.id, ...copies(FILL.id, 6)), deckOf(F_B.id, ...copies(FILL.id, 6)));
  assert.equal(engine.state.players[P1].influence, 25);
  assert.equal(engine.state.players[P2].influence, 25);
  assert.equal(engine.state.result, undefined, "nobody has won yet");
});

rule("CR 202.3", "once the influence runs out you lose: damage down to exactly 0 ends the game", () => {
  const { engine, id } = buildGame({
    playerB: { influence: 3 },
    cards: [{ key: "ping", def: damageToFaction("Ping Three", "opponent", 3), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("ping"));
  assert.equal(engine.state.players[P2].influence, 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] }, "the player whose influence ran out loses");
  assert.equal(engine.getFlowView().mode, "gameOver");
});

rule("CR 202.3", "with influence left (one short of running out) the player has not lost", () => {
  const { engine, id } = buildGame({
    playerB: { influence: 3 },
    cards: [{ key: "ping", def: damageToFaction("Ping Two", "opponent", 2), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("ping"));
  assert.equal(engine.state.players[P2].influence, 1);
  assert.equal(engine.state.result, undefined, "1 influence left is not out");
  assert.notEqual(engine.getFlowView().mode, "gameOver");
});

rule("CR 202.3", "more damage than the influence left also runs it out", () => {
  const { engine, id } = buildGame({
    playerB: { influence: 2 },
    cards: [{ key: "ping", def: damageToFaction("Ping Five", "opponent", 5), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("ping"));
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] });
});

rule("CR 202.3", "the loser is whoever's influence ran out, including the active player's own faction", () => {
  const { engine, id } = buildGame({
    playerA: { influence: 2 },
    cards: [{ key: "ouch", def: damageToFaction("Self Harm", "controller", 2), owner: P1, zone: "hand" }]
  });
  cast(engine, P1, id("ouch"));
  assert.equal(engine.state.players[P1].influence, 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P2] }, "the opponent wins when your own influence runs out");
});

rule("CR 202.3", "influence lost by an effect (not damage) also counts toward running out", () => {
  const drain = tactic({
    name: "Drain Three",
    behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }] }
  });
  const { engine, id } = buildGame({ playerB: { influence: 3 }, cards: [{ key: "drain", def: drain, owner: P1, zone: "hand" }] });
  cast(engine, P1, id("drain"));
  assert.equal(engine.state.players[P2].influence, 0);
  assert.deepEqual(engine.state.result, { outcome: "victory", winners: [P1] });
});

rule("CR 202.3a", "every faction has its own starting influence: the printed number is what its player starts with", () => {
  const low = faction("r09p1-low", { influence: 17 });
  const high = faction("r09p1-high", { influence: 23 });
  const defs = [low, high, FILL];
  const engine = newGame(defs, deckOf(low.id, ...copies(FILL.id, 4)), deckOf(high.id, ...copies(FILL.id, 4)));
  assert.equal(engine.state.players[P1].influence, 17);
  assert.equal(engine.state.players[P2].influence, 23);
});

rule("CR 202.3a", "the starting influence follows the faction, not the seat", () => {
  const low = faction("r09p1-low2", { influence: 17 });
  const high = faction("r09p1-high2", { influence: 23 });
  const engine = newGame([low, high, FILL], deckOf(high.id, ...copies(FILL.id, 4)), deckOf(low.id, ...copies(FILL.id, 4)));
  assert.equal(engine.state.players[P1].influence, 23);
  assert.equal(engine.state.players[P2].influence, 17);
});

// ---------------------------------------------------------------------------
// CR 202.4 Damage to a faction is influence lost
// ---------------------------------------------------------------------------

rule("CR 202.4", "damage inflicted to a faction takes an equal amount of influence: 1, then 4", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "one", def: damageToFaction("Ping One", "opponent", 1), owner: P1, zone: "hand" },
      { key: "four", def: damageToFaction("Ping Four", "opponent", 4), owner: P1, zone: "hand" }
    ]
  });
  cast(engine, P1, id("one"));
  assert.equal(engine.state.players[P2].influence, 24);
  cast(engine, P1, id("four"));
  assert.equal(engine.state.players[P2].influence, 20);
});

rule("CR 202.4", "only the damaged faction loses influence", () => {
  const { engine, id } = buildGame({ cards: [{ key: "three", def: damageToFaction("Ping Three", "opponent", 3), owner: P1, zone: "hand" }] });
  cast(engine, P1, id("three"));
  assert.equal(engine.state.players[P2].influence, 22);
  assert.equal(engine.state.players[P1].influence, 25, "the other faction is untouched");
});

rule("CR 202.4", "damage to your own faction loses your own influence", () => {
  const { engine, id } = buildGame({ cards: [{ key: "two", def: damageToFaction("Self Two", "controller", 2), owner: P1, zone: "hand" }] });
  cast(engine, P1, id("two"));
  assert.equal(engine.state.players[P1].influence, 23);
  assert.equal(engine.state.players[P2].influence, 25);
});

rule("CR 202.4", "battle damage assigned to a faction takes that much influence", () => {
  const { engine, id } = buildGame({ cards: [{ key: "atk", def: character({ name: "Striker", strength: 3 }), owner: P1 }] });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  resolvePendingResponses(engine);
  engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, 22);
});

// ---------------------------------------------------------------------------
// CR 202.5 Starting Resources
// ---------------------------------------------------------------------------

rule("CR 202.5", "Starting Resources puts the listed number of resources from the deck into play at the start", () => {
  const f = faction("r09p1-start2", { setup: { startingResources: { count: 2, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const deck = deckOf(f.id, RAGE.id, GREED.id, RAGE.id, ...copies(FILL.id, 6));
  const engine = newGame([f, RAGE, GREED, FILL], deck, deck);
  assert.deepEqual(inPlayNames(engine, P1), ["Rage", "Greed"], "two staples are in play");
  assert.equal(engine.state.players[P1].deck.length, 7, "they came out of the deck (the third staple and six fillers remain)");
});

rule("CR 202.5", "a Starting Resources section of 0 starts no resources", () => {
  const f = faction("r09p1-start0", { setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const deck = deckOf(f.id, RAGE.id, RAGE.id, ...copies(FILL.id, 4));
  const engine = newGame([f, RAGE, FILL], deck, deck);
  assert.deepEqual(inPlayNames(engine, P1), []);
});

rule("CR 202.5", "a Starting Resources section naming a resource starts that resource, not the first one in the deck", () => {
  const f = faction("r09p1-startgreed", { setup: { startingResources: { count: 1, names: ["Greed"] }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const deck = deckOf(f.id, RAGE.id, GREED.id, ...copies(FILL.id, 4));
  const engine = newGame([f, RAGE, GREED, FILL], deck, deck);
  assert.deepEqual(inPlayNames(engine, P1), ["Greed"]);
});

rule("CR 202.5", "a Starting Resources section for staples starts a staple, skipping a non-staple resource ahead of it", () => {
  const f = faction("r09p1-startstaple", { setup: { startingResources: { count: 1, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const deck = deckOf(f.id, FANCY.id, GREED.id, ...copies(FILL.id, 4));
  const engine = newGame([f, FANCY, GREED, FILL], deck, deck);
  assert.deepEqual(inPlayNames(engine, P1), ["Greed"]);
});

rule("CR 202.5", "each faction's own Starting Resources section applies to its own player", () => {
  const one = faction("r09p1-startone", { setup: { startingResources: { count: 1, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const three = faction("r09p1-startthree", { setup: { startingResources: { count: 3, stapleOnly: true }, openingHand: { goingFirst: 0, goingSecond: 0 } } });
  const rest = [RAGE.id, GREED.id, RAGE.id, ...copies(FILL.id, 4)];
  const engine = newGame([one, three, RAGE, GREED, FILL], deckOf(one.id, ...rest), deckOf(three.id, ...rest));
  assert.equal(inPlayNames(engine, P1).length, 1);
  assert.equal(inPlayNames(engine, P2).length, 3);
});

// ---------------------------------------------------------------------------
// CR 202.6 Starting Draw
// ---------------------------------------------------------------------------

const drawFaction = (id: string, first: number, second: number) =>
  faction(id, { setup: { startingResources: { count: 0 }, openingHand: { goingFirst: first, goingSecond: second } } });

rule("CR 202.6", "Starting Draw sets the opening hand: the first player draws the going-first number, the second the going-second number", () => {
  const f = drawFaction("r09p1-draw", 3, 5);
  const deck = deckOf(f.id, ...copies(FILL.id, 8));
  const engine = newGame([f, FILL], deck, deck, { firstPlayerId: P1 });
  assert.equal(engine.state.players[P1].hand.length, 3, "the first player draws the going-first number");
  assert.equal(engine.state.players[P2].hand.length, 5, "the second player draws the going-second number");
});

rule("CR 202.6", "the numbers follow who goes first, not the seat", () => {
  const f = drawFaction("r09p1-draw2", 3, 5);
  const deck = deckOf(f.id, ...copies(FILL.id, 8));
  const engine = newGame([f, FILL], deck, deck, { firstPlayerId: P2 });
  assert.equal(engine.state.players[P2].hand.length, 3, "P2 goes first");
  assert.equal(engine.state.players[P1].hand.length, 5, "P1 goes second");
});

rule("CR 202.6", "a Starting Draw of 0 draws nothing, and each faction's section applies to its own player", () => {
  const none = drawFaction("r09p1-draw0", 0, 0);
  const two = drawFaction("r09p1-draw2b", 2, 2);
  const engine = newGame([none, two, FILL], deckOf(none.id, ...copies(FILL.id, 5)), deckOf(two.id, ...copies(FILL.id, 5)));
  assert.equal(engine.state.players[P1].hand.length, 0);
  assert.equal(engine.state.players[P2].hand.length, 2);
});

// ---------------------------------------------------------------------------
// CR 202.7 Restore Rule
// ---------------------------------------------------------------------------

const RESTORING = faction("r09p1-restoring", { turn: turnRules(true, true, [{ type: "draw", count: 1 }]) });
const NOT_RESTORING = faction("r09p1-notrestoring", { turn: turnRules(false, false, [{ type: "draw", count: 1 }]) });

/** A game where both players hold spent resources and a depleted character. */
function spentBoard(factionB: CardDefinition = RESTORING) {
  const game = buildGame({
    playerB: { faction: factionB },
    cards: [
      { key: "ra", def: resourceCard({ name: "Ra" }), owner: P1 },
      { key: "rb1", def: resourceCard({ name: "Rb1" }), owner: P2 },
      { key: "rb2", def: resourceCard({ name: "Rb2" }), owner: P2 },
      { key: "ca", def: character({ name: "Ca" }), owner: P1, depleted: true },
      { key: "cb", def: character({ name: "Cb" }), owner: P2, depleted: true },
      { key: "dk", def: character({ name: "Deck B" }), owner: P2, zone: "deck" }
    ]
  });
  const { engine, id } = game;
  engine.state.cards[id("ra")]!.attachedTo = factionIdOf(engine, P1);
  engine.state.cards[id("rb1")]!.attachedTo = factionIdOf(engine, P2);
  engine.state.cards[id("rb2")]!.attachedTo = factionIdOf(engine, P2);
  return game;
}

rule("CR 202.7", "the Restore Rule replenishes resources every turn: the new active player's attached resources come free", () => {
  const { engine, id } = spentBoard();
  assert.equal(engine.getAvailableResourceCount(P2), 0, "both of P2's resources are spent");
  passTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("rb1")]!.attachedTo, undefined);
  assert.equal(engine.state.cards[id("rb2")]!.attachedTo, undefined);
  assert.equal(engine.getAvailableResourceCount(P2), 2);
});

rule("CR 202.7", "the Restore Rule replenishes cards every turn: the new active player's depleted card is restored", () => {
  const { engine, id } = spentBoard();
  assert.equal(engine.state.cards[id("cb")]!.depleted, true);
  passTurn(engine, P1);
  assert.equal(engine.state.cards[id("cb")]!.depleted, false);
});

rule("CR 202.7", "the Restore Rule restores only its own player's cards and resources, at the start of their own turn", () => {
  const { engine, id } = spentBoard();
  passTurn(engine, P1);
  assert.equal(engine.state.cards[id("ra")]!.attachedTo, factionIdOf(engine, P1), "the other player's resource stays spent");
  assert.equal(engine.state.cards[id("ca")]!.depleted, true, "the other player's character stays depleted");
  passTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("ra")]!.attachedTo, undefined, "now it is their turn: restored");
  assert.equal(engine.state.cards[id("ca")]!.depleted, false);
});

rule("CR 202.7", "it happens every turn, not only the first", () => {
  const { engine, id } = spentBoard();
  passTurn(engine, P1);
  passTurn(engine, P2);
  engine.state.cards[id("rb1")]!.attachedTo = factionIdOf(engine, P2);
  engine.state.cards[id("cb")]!.depleted = true;
  passTurn(engine, P1);
  assert.equal(engine.state.cards[id("rb1")]!.attachedTo, undefined, "restored again on P2's second turn");
  assert.equal(engine.state.cards[id("cb")]!.depleted, false);
});

rule("CR 202.7", "what is replenished is whatever the faction's Restore Rule section says: a faction without those lines replenishes nothing", () => {
  const { engine, id } = spentBoard(NOT_RESTORING);
  passTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("rb1")]!.attachedTo, factionIdOf(engine, P2), "its resources stay spent");
  assert.equal(engine.state.cards[id("cb")]!.depleted, true, "its depleted card stays depleted");
});

// ---------------------------------------------------------------------------
// CR 202.8 Develop Rule
// ---------------------------------------------------------------------------

const developBoard = (choices: Turn["develop"]["choices"]) =>
  buildGame({
    playerB: { faction: faction("r09p1-dev-" + choices.map((choice) => `${choice.type}${choice.count}`).join("-"), { turn: turnRules(true, true, choices) }) },
    cards: [
      { key: "d1", def: character({ name: "Deck One" }), owner: P2, zone: "deck" },
      { key: "d2", def: character({ name: "Deck Two" }), owner: P2, zone: "deck" },
      { key: "d3", def: character({ name: "Deck Three" }), owner: P2, zone: "deck" },
      { key: "hr", def: resourceCard({ name: "Hand Rage" }), owner: P2, zone: "hand" }
    ]
  });

rule("CR 202.8", "the Develop Rule is offered to the active player each turn, listing the faction's options", () => {
  const { engine } = developBoard([{ type: "draw", count: 1 }, { type: "playResource", count: 1 }]);
  const offers = passTurnToDevelop(engine, P1);
  assert.equal(engine.state.pendingChoice?.playerId, P2, "the new active player is the one offered the Develop Rule");
  assert.equal(offers.length, 2, "both of the faction's options are listed");
  assert.match(offers[0]!, /^Draw /);
  assert.match(offers[1]!, /^Play a resource/);
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsOption", index: 0 } }),
    "the other player answers the Develop Rule"
  );
});

rule("CR 202.8", "each of the two players is offered it on their own turn, one turn after another", () => {
  const { engine } = buildGame({
    playerA: { faction: faction("r09p1-dev-a", { turn: turnRules(true, true, [{ type: "draw", count: 1 }]) }) },
    playerB: { faction: faction("r09p1-dev-b", { turn: turnRules(true, true, [{ type: "draw", count: 1 }]) }) }
  });
  assert.ok(passTurnToDevelop(engine, P1).length > 0, "the Develop Rule offers something on P2's turn");
  assert.equal(engine.state.pendingChoice?.playerId, P2, "P2 is offered the Develop Rule on their turn");
  chooseDevelopOption(engine, P2, /^Draw /);
  resolvePendingResponses(engine);
  assert.ok(passTurnToDevelop(engine, P2).length > 0, "the Develop Rule offers something on P1's turn");
  assert.equal(engine.state.pendingChoice?.playerId, P1, "P1 is offered it on their turn");
});

rule("CR 202.8", "a Develop Rule that draws lets the player draw a card each turn", () => {
  const { engine } = developBoard([{ type: "draw", count: 1 }]);
  passTurnToDevelop(engine, P1);
  assert.equal(engine.state.players[P2].hand.length, 1, "before: only the resource in hand");
  chooseDevelopOption(engine, P2, /^Draw /);
  assert.equal(engine.state.players[P2].hand.length, 2, "one card was drawn");
});

rule("CR 202.8", "a Develop Rule that plays resources lets the player play a resource each turn", () => {
  const { engine, id } = developBoard([{ type: "playResource", count: 1 }]);
  engine.perform({ type: "endTurn", playerId: P1 });
  settleWindows(engine);
  developPlayAtTurnStart(engine, P2, id("hr"));
  assert.equal(engine.state.cards[id("hr")]!.zone, "play", "the resource is in play");
  assert.equal(engine.state.players[P2].hand.length, 0);
});

rule("CR 202.8", "the Develop Rule only offers what the faction's rules text says: a draw-only faction cannot play a resource, a resource-only faction cannot draw", () => {
  const drawOnly = developBoard([{ type: "draw", count: 1 }]);
  const drawOffers = passTurnToDevelop(drawOnly.engine, P1);
  assert.equal(drawOffers.length, 1, "a draw-only Develop Rule offers one thing");
  assert.match(drawOffers[0]!, /^Draw /, "and it is the draw, not a resource play");
  assert.equal(drawOnly.engine.state.cards[drawOnly.id("hr")]!.zone, "hand", "nothing moved");
  chooseDevelopOption(drawOnly.engine, P2, /^Draw /);
  assert.equal(drawOnly.engine.state.players[P2].hand.length, 2, "control: drawing is allowed");

  const resourceOnly = developBoard([{ type: "playResource", count: 1 }]);
  const resourceOffers = passTurnToDevelop(resourceOnly.engine, P1);
  assert.equal(resourceOffers.length, 1, "a resource-only Develop Rule offers one thing");
  assert.match(resourceOffers[0]!, /^Play a resource/, "and it is the resource play, not a draw");
  assert.equal(resourceOnly.engine.state.players[P2].hand.length, 1, "nothing was drawn");
});

// ---------------------------------------------------------------------------
// CR 202.9 / 202.9a Factions are not affected, and cannot be picked
// ---------------------------------------------------------------------------

const cand = { type: "selected", id: "__candidate" } as const;

/** A tactic that applies `effect` to every card in play matching `selector`. */
const sweep = (name: string, selector: object, effect: Effect) =>
  tactic({ name, behavior: { abilities: [{ id: "a", type: "activated", effects: [{ type: "forEach", selector, effects: [effect] }] }] } });

const factionState = (engine: SpoilsEngine) => [P1, P2].map((playerId) => engine.state.cards[factionIdOf(engine, playerId)]!);

function sweepBoard(def: CardDefinition) {
  return buildGame({
    cards: [
      { key: "sweep", def, owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 9 }), owner: P1 },
      { key: "theirs", def: character({ name: "Theirs", life: 9 }), owner: P2 }
    ]
  });
}

rule("CR 202.9", "damage to everything in play does not reach a faction: no influence is lost", () => {
  const { engine, id } = sweepBoard(sweep("Blanket Damage", { zone: "play", controller: "any" }, { type: "dealDamage", target: cand, amount: 2 }));
  cast(engine, P1, id("sweep"));
  assert.equal(engine.state.cards[id("mine")]!.damage, 2, "control: the ordinary characters were hit");
  assert.equal(engine.state.cards[id("theirs")]!.damage, 2);
  assert.equal(engine.state.players[P1].influence, 25, "my faction is unaffected");
  assert.equal(engine.state.players[P2].influence, 25, "their faction is unaffected");
});

rule("CR 202.9", "depleting everything in play does not deplete a faction", () => {
  const { engine, id } = sweepBoard(sweep("Blanket Deplete", { zone: "play", controller: "any" }, { type: "deplete", target: cand }));
  cast(engine, P1, id("sweep"));
  assert.equal(engine.state.cards[id("theirs")]!.depleted, true, "control: the ordinary characters were depleted");
  assert.deepEqual(factionState(engine).map((card) => card.depleted), [false, false]);
});

rule("CR 202.9", "destroying everything in play does not destroy a faction", () => {
  const { engine, id } = sweepBoard(sweep("Blanket Destroy", { zone: "play", controller: "any" }, { type: "destroy", target: cand }));
  cast(engine, P1, id("sweep"));
  assert.equal(engine.state.cards[id("theirs")]!.zone, "discard", "control: the ordinary characters were destroyed");
  assert.deepEqual(factionState(engine).map((card) => card.zone), ["play", "play"]);
});

rule("CR 202.9", "an effect that specifically applies to factions does affect them", () => {
  const { engine, id } = sweepBoard(sweep("Faction Damage", { zone: "play", controller: "any", type: "faction" }, { type: "dealDamage", target: cand, amount: 2 }));
  cast(engine, P1, id("sweep"));
  assert.equal(engine.state.players[P1].influence, 23);
  assert.equal(engine.state.players[P2].influence, 23);
  assert.equal(engine.state.cards[id("mine")]!.damage, 0, "and only factions");
});

const pickerTactic = (name: string, selector: object) =>
  tactic({
    name,
    behavior: {
      abilities: [
        {
          id: "a",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        }
      ]
    }
  });

rule("CR 202.9a", "you cannot pick a faction with an ordinary pick, yours or theirs", () => {
  for (const playerId of [P1, P2]) {
    const { engine, id } = buildGame({
      cards: [
        { key: "pick", def: pickerTactic("Pick Anything", { zone: "play", controller: "any" }), owner: P1, zone: "hand" },
        { key: "victim", def: character({ name: "Victim", life: 9 }), owner: P2 }
      ]
    });
    refused(
      () => engine.perform({ type: "playCard", playerId: P1, cardId: id("pick"), selected: { t: [factionIdOf(engine, playerId)] } }),
      `picking ${playerId}'s faction with an ordinary pick`,
      /Illegal target/
    );
    assert.equal(engine.state.players[playerId].influence, 25, "nothing happened to the faction");
    engine.perform({ type: "playCard", playerId: P1, cardId: id("pick"), selected: { t: [id("victim")] } });
    resolvePendingResponses(engine);
    assert.equal(engine.state.cards[id("victim")]!.damage, 2, "control: an ordinary card can be picked");
  }
});

rule("CR 202.9a", "you can pick a faction when the pick explicitly asks for one", () => {
  const { engine, id } = buildGame({
    cards: [{ key: "pick", def: pickerTactic("Pick A Faction", { zone: "play", controller: "any", type: "faction" }), owner: P1, zone: "hand" }]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("pick"), selected: { t: [factionIdOf(engine, P2)] } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.players[P2].influence, 23);
});
