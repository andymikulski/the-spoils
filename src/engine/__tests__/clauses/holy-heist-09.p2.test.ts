// Clause tests, batch holy-heist-09, part p2: the two Holy Heist factions
// Unlikely Heroes and Lugubrian Council Expedition Division.
// Expectations come from the printed text, never from engine data.
import assert from "node:assert/strict";
import { buildGame, bank, character, developFaction, item, resolvePendingResponses, resourceCard, tactic, volition, P1, P2 } from "../per-card/_harness.js";
import { clause, printing, refused, holdResourceFace } from "./_clause.js";
import { fillers } from "./_board.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, setupGame, spentResources, developOffers, endTurnRaw, settleStartFirst } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart } from "../support/develop.js";

type Pid = typeof P1 | typeof P2;

const HEROES = "710d5ee7-a234-46dc-9e78-8d49a146c6ec"; // Unlikely Heroes
const LUG = "8d9ffff2-e3a6-4caf-be4f-4dc6e7241a0d"; // Lugubrian Council Expedition Division

// The real staple resources.
const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
const OBSESSION = printing("dab6e897-b5be-4760-95c0-20c2795a9ae3");
const ODD_RESOURCE = resourceCard({ id: "hh9-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "hh9-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);
const handSize = (engine: SpoilsEngine, pid: Pid): number => engine.state.players[pid].hand.length;
const deckOf = (engine: SpoilsEngine, pid: Pid): CardInstanceId[] => engine.state.players[pid].deck;
const zoneOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].zone;
const readyCount = (engine: SpoilsEngine, pid: Pid): number => engine.getAvailableResourceCount(pid);
const tokens = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters?.token ?? 0;
const playCards = (engine: SpoilsEngine, pid: Pid): CardInstanceId[] => engine.state.players[pid].play.filter((c) => engine.getDefinition(c).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((c) => engine.getDefinition(c).name).sort();
const revealEvents = (engine: SpoilsEngine) =>
  engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? [entry.event] : []));

// A plain opponent: 2 staples, 7 going first / 8 going second.
const PLAIN_OPP = factionCard({
  id: "hh9-plain-opp",
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

/** Activates a faction ability whose pick is made at resolution (chooserSelectsTarget) and answers that pick. */
function useFaction(engine: SpoilsEngine, pid: Pid, abilityId: string, picks: CardInstanceId[], owner: Pid = pid): void {
  activateFaction(engine, pid, abilityId, owner);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc, "the ability asks for a pick");
  assert.equal(pc.kind, "chooserSelectsTarget");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: picks } } as never);
  resolvePendingResponses(engine);
}

interface Cfg { id: string; draw: string; resource: string }
const H: Cfg = { id: HEROES, draw: "heroes-draw", resource: "heroes-resource" };
const L: Cfg = { id: LUG, draw: "lugubrian-draw", resource: "lugubrian-resource" };

function activateFaction(engine: SpoilsEngine, pid: Pid, abilityId: string, owner: Pid = pid, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "activateAbility", playerId: pid, cardId: factionOf(engine, owner), abilityId, selected, variables: {} });
  resolvePendingResponses(engine);
}

// =============================================================================
// Shared rule bodies (RESTORE RULE / DEVELOP RULE / DRAW / RESOURCE are printed identically)
// =============================================================================

function restoreBoard(faction: CardDefinition, active: Pid) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck")
    ]
  });
}

const restoreMine = (c: Cfg) => () => {
  const { engine, id } = restoreBoard(printing(c.id), P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
  assert.equal(attachedCount(engine, P1), 0, "every resource is detached from my faction (face-up and face-down)");
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
  assert.equal(engine.state.cards[id("mineChar")].zone, "play");
};

const restoreNotTheirs = (c: Cfg) => () => {
  const { engine, id } = restoreBoard(printing(c.id), P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards': the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "'your faction': the opponent's resources stay attached");
};

const restoreNotOnTheirTurn = (c: Cfg) => () => {
  const { engine, id } = restoreBoard(printing(c.id), P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached at the opponent's turn start");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "nor a card the opponent owns but I control");
  assert.equal(engine.state.cards[id("theirChar")].depleted, false, "(the opponent's own restore rule ran for them)");
  assert.equal(attachedCount(engine, P2), 0);
};

function developBoard(faction: CardDefinition, active: Pid = P1) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...fillers("mydeck", 4, P1, "deck"),
      ...fillers("theirdeck", 4, P2, "deck"),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

const developDrawBody = (c: Cfg) => () => {
  const { engine, id } = developBoard(printing(c.id));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck is the one drawn");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1), "only the top card left the deck");
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
};

const developResourceUp = (c: Cfg) => () => {
  const { engine, id } = developBoard(printing(c.id));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource is now in play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "played face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "and it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1, "one card left my hand");
  assert.deepEqual(deckOf(engine, P1), deckBefore, "no card was drawn");
  assert.equal(zoneOf(engine, id("handRes2")), "hand", "only one resource is played");
};

const developResourceDown = (c: Cfg) => () => {
  const { engine, id } = developBoard(printing(c.id));
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides one Volition");
  const real = developBoard(printing(c.id));
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down, it no longer provides its Greed");
};

const developNonResourceUp = (c: Cfg) => () => {
  const { engine, id } = developBoard(printing(c.id));
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up: a non-resource card enters face-down");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
  developResource(engine, P1, id("handRes"), false); // control
  assert.equal(zoneOf(engine, id("handRes")), "play");
};

const developEither = (c: Cfg) => () => {
  const drawn = developBoard(printing(c.id));
  developDraw(drawn.engine, P1);
  assert.equal(drawn.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.equal(zoneOf(drawn.engine, drawn.id("handRes")), "hand");
  const played = developBoard(printing(c.id));
  const deckBefore = [...deckOf(played.engine, P1)];
  developResource(played.engine, P1, played.id("handRes"), false);
  assert.equal(played.engine.state.pendingChoice, undefined, "the rule was used: it offers nothing more");
  assert.deepEqual(deckOf(played.engine, P1), deckBefore);
};

const developOnce = (c: Cfg) => () => {
  const draws = developBoard(printing(c.id));
  developDraw(draws.engine, P1);
  const hand = handSize(draws.engine, P1);
  assert.equal(draws.engine.state.pendingChoice, undefined, "a second draw is not offered");
  assert.equal(handSize(draws.engine, P1), hand);
  const plays = developBoard(printing(c.id));
  developResource(plays.engine, P1, plays.id("handRes"), false);
  assert.equal(plays.engine.state.pendingChoice, undefined, "a second resource play is not offered");
  assert.equal(zoneOf(plays.engine, plays.id("handRes2")), "hand");
};

const developMyTurn = (c: Cfg) => () => {
  const { engine, id } = developBoard(printing(c.id));
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  const mine = developBoard(printing(c.id)); // control
  developResource(mine.engine, P1, mine.id("handRes"), false);
  assert.equal(zoneOf(mine.engine, mine.id("handRes")), "play");
};

const developRenews = (c: Cfg) => () => {
  const { engine } = developBoard(printing(c.id));
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  assert.equal(handSize(engine, P1), hand, "skipping it costs nothing and gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "available again on my next turn: the Develop Rule offered a draw at the start of my turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
};

function abilityBoard(faction: CardDefinition, resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
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

const drawPays = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 5);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  assert.equal(readyCount(engine, P1), 5);
  activateFaction(engine, P1, c.draw);
  assert.equal(readyCount(engine, P1), 2, "exactly 3 resources were paid");
  assert.equal(attachedCount(engine, P1), 3, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand", "the top card of my deck");
  assert.deepEqual(deckOf(engine, P1), deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
};

const drawUnaffordable = (c: Cfg) => () => {
  const two = abilityBoard(printing(c.id), 2);
  refused(() => activateFaction(two.engine, P1, c.draw), "2 resources", /cannot be paid/);
  assert.equal(handSize(two.engine, P1), 2, "nothing is drawn");
  assert.equal(attachedCount(two.engine, P1), 0, "nothing was half-paid");
  assert.equal(readyCount(two.engine, P1), 2);
  const spent = abilityBoard(printing(c.id), 4);
  for (const rid of spent.engine.getAvailableResourceIds(P1).slice(0, 2)) spent.engine.state.cards[rid].attachedTo = factionOf(spent.engine, P1);
  assert.equal(readyCount(spent.engine, P1), 2);
  refused(() => activateFaction(spent.engine, P1, c.draw), "4 resources, 2 already spent", /cannot be paid/);
  const none = abilityBoard(printing(c.id), 0);
  refused(() => activateFaction(none.engine, P1, c.draw), "no resources", /cannot be paid/);
  const exact = abilityBoard(printing(c.id), 3);
  activateFaction(exact.engine, P1, c.draw); // control
  assert.equal(handSize(exact.engine, P1), 3);
};

const drawAgain = (c: Cfg) => () => {
  const { engine } = abilityBoard(printing(c.id), 7);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, c.draw);
  activateFaction(engine, P1, c.draw);
  assert.equal(handSize(engine, P1), handBefore + 2);
  assert.equal(attachedCount(engine, P1), 6);
  assert.equal(readyCount(engine, P1), 1);
};

const drawSeparate = (c: Cfg) => () => {
  const first = abilityBoard(printing(c.id), 3);
  const base = handSize(first.engine, P1);
  activateFaction(first.engine, P1, c.draw);
  assert.ok(developOffers(first.engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(first.engine, P1);
  assert.equal(handSize(first.engine, P1), base + 2);
  const second = abilityBoard(printing(c.id), 3);
  developDraw(second.engine, P1);
  activateFaction(second.engine, P1, c.draw);
  assert.equal(handSize(second.engine, P1), base + 2);
};

const drawControllerOnly = (c: Cfg) => () => {
  const { engine } = buildGame({
    playerA: { faction: printing(c.id) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...fillers("theirdeck", 4, P2, "deck")]
  });
  const theirHand = handSize(engine, P2);
  refused(() => activateFaction(engine, P2, c.draw, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P2), 0);
};

const resourcePays = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 6);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...deckOf(engine, P1)];
  useFaction(engine, P1, c.resource, [id("handRes")]);
  assert.equal(attachedCount(engine, P1), 4, "exactly 4 resources were paid");
  assert.equal(zoneOf(engine, id("handRes")), "play", "the resource was played");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(deckOf(engine, P1), deckBefore, "nothing was drawn");
  assert.equal(zoneOf(engine, id("handChar")), "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 6 - 4 + 1, "the new resource is ready to pay for things");
};

const resourceFaceDownBody = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 4);
  useFaction(engine, P1, c.resource, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play", "any card can be played as a resource");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(zoneOf(engine, id("handRes")), "hand");
};

const resourceChoice = (c: Cfg) => () => {
  holdResourceFace(() => {
  const { engine, id } = abilityBoard(printing(c.id), 4);
  useFaction(engine, P1, c.resource, [id("handRes")]);
  const asked = engine.state.pendingChoice !== undefined && zoneOf(engine, id("handRes")) === "hand";
  const faceDown = zoneOf(engine, id("handRes")) === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(asked || faceDown, "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking");
  });
};

const resourceMyHand = (c: Cfg) => () => {
  for (const key of ["theirHand", "mydeck0"]) {
    const { engine, id } = abilityBoard(printing(c.id), 4);
    const was = zoneOf(engine, id(key));
    refused(() => useFaction(engine, P1, c.resource, [id(key)]), `picking ${key}`);
    assert.equal(zoneOf(engine, id(key)), was, `${key} was not played`);
  }
  const { engine, id } = abilityBoard(printing(c.id), 4); // control
  useFaction(engine, P1, c.resource, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handChar")), "play");
};

const resourceUnaffordable = (c: Cfg) => () => {
  const short = abilityBoard(printing(c.id), 3);
  refused(() => useFaction(short.engine, P1, c.resource, [short.id("handRes")]), "3 resources", /cannot be paid/);
  assert.equal(short.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(short.engine, short.id("handRes")), "hand", "no resource was played");
  assert.equal(attachedCount(short.engine, P1), 0);
  assert.equal(readyCount(short.engine, P1), 3);
  const none = abilityBoard(printing(c.id), 0);
  refused(() => useFaction(none.engine, P1, c.resource, [none.id("handRes")]), "no resources", /cannot be paid/);
  const exact = abilityBoard(printing(c.id), 4);
  useFaction(exact.engine, P1, c.resource, [exact.id("handRes")]); // control
  assert.equal(zoneOf(exact.engine, exact.id("handRes")), "play", "with exactly 4 it works");
};

const resourceAgain = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 8);
  useFaction(engine, P1, c.resource, [id("handRes")]);
  useFaction(engine, P1, c.resource, [id("handChar")]);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "play");
  assert.equal(attachedCount(engine, P1), 8, "no once-per-turn limit is printed");
};

const resourceSeparate = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 4);
  useFaction(engine, P1, c.resource, [id("handRes")]);
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(zoneOf(engine, id("handChar")), "play");
};

const resourceControllerOnly = (c: Cfg) => () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(c.id) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", 8, P2),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
    ]
  });
  refused(() => activateFaction(engine, P2, c.resource, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(engine, id("theirHand")), "hand");
  assert.equal(attachedCount(engine, P2), 0);
};

// =============================================================================
// Unlikely Heroes
// STARTING RESOURCES: Any 2 different staple resources.
// STARTING DRAW: You may search your deck for a staple resource that is not any of your starting resources, reveal it and put it into your hand. Then draw 7 going first, 8 going second.
// =============================================================================

const heroesSeat = (deck: CardDefinition[]) => ({ faction: printing(HEROES), deck });

clause(HEROES, "0:rule:STARTING RESOURCES", "starts with 2 DIFFERENT staples in play face-up even when the deck leads with two of one kind", () => {
  const engine = setupGame(heroesSeat([RAGE, RAGE, GREED, ELITISM, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  assert.deepEqual(namesIn(engine, mine), ["Greed", "Rage"], "two different kinds, not Rage + Rage");
  for (const cardId of mine) assert.equal(engine.state.cards[cardId].faceDown, false, "face-up after setup");
  assert.equal(engine.getThresholds(P1).rage, 1);
  assert.equal(engine.getThresholds(P1).greed, 1);
});

clause(HEROES, "0:rule:STARTING RESOURCES", "non-staple resources and non-resource cards are not taken as starting resources", () => {
  const engine = setupGame(heroesSeat([ODD_RESOURCE, FILLER, RAGE, GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"]);
  const total = Object.values(engine.getThresholds(P1)).reduce((sum, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
});

clause(HEROES, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck and the opponent starts with their own", () => {
  const engine = setupGame(heroesSeat([RAGE, GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: [ELITISM, DECEPTION, ...repeat(FILLER, 40)] });
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 7, "42 cards, 2 starting resources, 7 in the opening hand");
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

clause(HEROES, "0:rule:STARTING RESOURCES", "applies the same when Unlikely Heroes sits in the second seat", () => {
  const engine = setupGame(
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    heroesSeat([RAGE, RAGE, GREED, ...repeat(FILLER, 40)]),
    { first: P1 }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Greed", "Rage"]);
});

clause(HEROES, "0:rule:STARTING RESOURCES", "with the choose step on, the player picks 2 staples of different kinds", () => {
  const engine = setupGame(
    heroesSeat([ODD_RESOURCE, RAGE, RAGE, GREED, GREED, DECEPTION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "'any' 2 different staples: I am asked which");
  const choice = engine.getStartingResourceChoice(P1)!;
  assert.ok(choice, "P1 is offered a choice");
  assert.equal(choice.count, 2);
  assert.equal(choice.candidateCardIds.length, 5, "the five staples in the deck (not the non-staple resource, not the characters)");
  const named = (n: string) => choice.candidateCardIds.filter((c) => engine.getDefinition(c).name === n);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [named("Rage")[0], named("Deception")[0]] });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Rage"], "exactly the picked staples are in play");
});

clause(HEROES, "0:rule:STARTING RESOURCES", "choosing the 2 starting staples: two of the same kind is refused ('different')", () => {
  const mk = () => setupGame(
    heroesSeat([RAGE, RAGE, GREED, GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const ok = mk();
  const c = ok.getStartingResourceChoice(P1)!.candidateCardIds;
  const rage = c.filter((x) => ok.getDefinition(x).name === "Rage");
  const greed = c.filter((x) => ok.getDefinition(x).name === "Greed");
  ok.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rage[0], greed[0]] }); // control
  assert.equal(playCards(ok, P1).length, 2);
  const engine = mk();
  const cc = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const rr = cc.filter((x) => engine.getDefinition(x).name === "Rage");
  refused(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [rr[0], rr[1]] }), "Rage + Rage is not 2 different staples");
  assert.equal(playCards(engine, P1).length, 0);
});

clause(HEROES, "0:rule:STARTING RESOURCES", "the choice must be exactly 2 staples from my deck (not 1, not 3, not a non-staple)", () => {
  const engine = setupGame(
    heroesSeat([ODD_RESOURCE, RAGE, GREED, DECEPTION, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [r, g, d] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Odd Resource")!;
  const choose = (cardIds: string[]) => () => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds });
  refused(choose([r]), "one is too few", /exactly 2/);
  refused(choose([r, g, d]), "three is too many", /exactly 2/);
  refused(choose([r, odd]), "a non-staple resource", /staple/);
  assert.equal(playCards(engine, P1).length, 0);
  choose([r, g])(); // control
  assert.equal(playCards(engine, P1).length, 2);
});

clause(HEROES, "1:rule:STARTING DRAW", "searches the deck for a staple that is not a starting resource, puts it into my hand, then draws 7 going first", () => {
  const engine = setupGame(heroesSeat([RAGE, RAGE, GREED, ELITISM, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  const hand = engine.state.players[P1].hand;
  assert.equal(hand.length, 7 + 1, "7 drawn + the searched-for staple");
  const elitism = hand.filter((c) => engine.getDefinition(c).name === "Elitism");
  assert.equal(elitism.length, 1, "the staple that is not a starting resource (Elitism) is in my hand");
  assert.equal(zoneOf(engine, elitism[0]), "hand");
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Rage"], "the starting resources are Rage and Greed");
});

clause(HEROES, "1:rule:STARTING DRAW", "draws 8 going second (plus the searched staple)", () => {
  const engine = setupGame(heroesSeat([RAGE, GREED, ELITISM, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 });
  assert.equal(handSize(engine, P1), 8 + 1);
  assert.equal(engine.state.players[P1].hand.filter((c) => engine.getDefinition(c).name === "Elitism").length, 1);
});

clause(HEROES, "1:rule:STARTING DRAW", "when no staple outside the starting resources exists the search finds nothing: 7 going first, 8 going second, no reveal", () => {
  const first = setupGame(heroesSeat([RAGE, RAGE, GREED, GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  assert.equal(handSize(first, P1), 7, "second copies of the starting resources are not fetched");
  assert.equal(revealEvents(first).filter((e) => e.ownerId === P1).length, 0);
  const second = setupGame(heroesSeat([RAGE, GREED, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 });
  assert.equal(handSize(second, P1), 8);
});

clause(HEROES, "1:rule:STARTING DRAW", "the fetched card is revealed to everyone, from my deck, and nothing is revealed when nothing is fetched", () => {
  const engine = setupGame(heroesSeat([RAGE, GREED, DECEPTION, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  const mine = revealEvents(engine).filter((e) => e.ownerId === P1);
  assert.equal(mine.length, 1, "revealed");
  const fetched = engine.state.players[P1].hand.find((c) => engine.getDefinition(c).name === "Deception")!;
  assert.deepEqual(mine[0].cardIds, [fetched]);
  assert.equal(mine[0].viewerId, "all");
  assert.equal(mine[0].zone, "deck");
  assert.equal(revealEvents(engine).filter((e) => e.ownerId === P2).length, 0, "the plain opponent searches for nothing");
});

clause(HEROES, "1:rule:STARTING DRAW", "only searches my own deck: the opponent's extra staples are not fetched for me", () => {
  const engine = setupGame(
    heroesSeat([RAGE, GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: [RAGE, GREED, ELITISM, DECEPTION, ...repeat(FILLER, 40)] },
    { first: P1 }
  );
  assert.equal(handSize(engine, P1), 7);
  assert.equal(engine.state.players[P1].hand.filter((c) => engine.getDefinition(c).type === "resource").length, 0);
});

clause(HEROES, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  const seat = () => heroesSeat([RAGE, GREED, ...repeat(FILLER, 40)]);
  assert.equal(handSize(setupGame(seat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setupGame(seat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

clause(HEROES, "1:rule:STARTING DRAW", "applies the same when Unlikely Heroes sits in the second seat (7 going first)", () => {
  const engine = setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, heroesSeat([RAGE, GREED, ...repeat(FILLER, 40)]), { first: P2 });
  assert.equal(handSize(engine, P2), 7);
});

/** A Heroes game with the setup prompts on: P1 picks Rage + Greed as the starting resources; leaves the STARTING DRAW search prompt open. */
const heroesAskedGame = () => {
  const engine = setupGame(heroesSeat([RAGE, GREED, ELITISM, DECEPTION, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1, choose: true });
  const offered = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const named = (n: string) => offered.find((c) => engine.getDefinition(c).name === n)!;
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [named("Rage"), named("Greed")] });
  return engine;
};
const pendingSearch = (engine: SpoilsEngine) =>
  engine.state.pendingChoice as unknown as { kind: string; playerId: Pid; declaration: { optional?: boolean }; effects: unknown[] } | undefined;

clause(HEROES, "1:rule:STARTING DRAW", "'You may search' is optional: the player is asked and can decline", () => {
  const engine = heroesAskedGame();
  const pc = pendingSearch(engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "the player must get to say yes or no to the search");
  assert.equal(pc?.playerId, P1);
  assert.equal(pc?.declaration.optional, true, "the search is optional");
  assert.equal(handSize(engine, P1), 0, "nothing is fetched (or drawn) before the answer");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [], declined: true } } as never);
  assert.equal(engine.state.pendingChoice, undefined, "setup went on");
  assert.equal(handSize(engine, P1), 7, "declined: just the 7 going first");
  assert.equal(revealEvents(engine).filter((e) => e.ownerId === P1).length, 0, "nothing was revealed");
  assert.equal(deckOf(engine, P1).filter((c) => ["Elitism", "Deception"].includes(engine.getDefinition(c).name)).length, 2, "both non-starting staples stay in the deck");
});

clause(HEROES, "1:rule:STARTING DRAW", "'You may search': the player picks WHICH staple outside the starting resources (not the first in deck order), and it is revealed", () => {
  const engine = heroesAskedGame();
  const offered = engine.state.pendingChoice as unknown as { declaration: { selector: unknown }; context: unknown };
  const candidates = engine.queryCards(offered.declaration.selector as never, offered.context as never).map((c) => engine.getDefinition(c.id).name).sort();
  assert.deepEqual(candidates, ["Deception", "Elitism"], "only staples that are not a starting resource can be picked");
  const deception = deckOf(engine, P1).find((c) => engine.getDefinition(c).name === "Deception")!;
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [deckOf(engine, P1).find((c) => engine.getDefinition(c).type !== "resource")!] } } as never),
    "a non-staple card cannot be picked"
  );
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [deception] } } as never);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handSize(engine, P1), 7 + 1, "7 drawn + the picked staple");
  assert.equal(zoneOf(engine, deception), "hand", "the picked Deception, not the first match in deck order (Elitism)");
  const mine = revealEvents(engine).filter((e) => e.ownerId === P1);
  assert.equal(mine.length, 1, "revealed");
  assert.deepEqual(mine[0].cardIds, [deception]);
  assert.equal(mine[0].viewerId, "all");
});

// --- RESTORE RULE
clause(HEROES, "2:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", restoreMine(H));
clause(LUG, "2:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", restoreMine(L));
clause(HEROES, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreNotTheirs(H));
clause(LUG, "2:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", restoreNotTheirs(L));
clause(HEROES, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreNotOnTheirTurn(H));
clause(LUG, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", restoreNotOnTheirTurn(L));

// --- DEVELOP RULE
const T_DRAW = "may draw a card (the top of the deck) as its Develop Rule";
const T_UP = "may play a resource card face-up as its Develop Rule";
const T_DOWN = "may play any card face-down as its resource (Volition), even an actual resource card";
const T_NONRES = "a non-resource card cannot be played face-up as a resource";
const T_EITHER = "draw OR play a resource: not both";
const T_ONCE = "can be used only once per turn";
const T_TURN = "can be used only on my own turn";
const T_RENEW = "is optional and available again every turn";
clause(HEROES, "3:rule:DEVELOP RULE", T_DRAW, developDrawBody(H));
clause(LUG, "3:rule:DEVELOP RULE", T_DRAW, developDrawBody(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_UP, developResourceUp(H));
clause(LUG, "3:rule:DEVELOP RULE", T_UP, developResourceUp(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_DOWN, developResourceDown(H));
clause(LUG, "3:rule:DEVELOP RULE", T_DOWN, developResourceDown(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_NONRES, developNonResourceUp(H));
clause(LUG, "3:rule:DEVELOP RULE", T_NONRES, developNonResourceUp(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_EITHER, developEither(H));
clause(LUG, "3:rule:DEVELOP RULE", T_EITHER, developEither(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_ONCE, developOnce(H));
clause(LUG, "3:rule:DEVELOP RULE", T_ONCE, developOnce(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_TURN, developMyTurn(H));
clause(LUG, "3:rule:DEVELOP RULE", T_TURN, developMyTurn(L));
clause(HEROES, "3:rule:DEVELOP RULE", T_RENEW, developRenews(H));
clause(LUG, "3:rule:DEVELOP RULE", T_RENEW, developRenews(L));

// --- DRAW (pay 3: draw a card)
const D_PAY = "pays exactly 3 resources and draws one card";
const D_SHORT = "is refused when the 3 can't be paid (2 resources, 3 with 2 already spent, none)";
const D_AGAIN = "can be used again the same turn (no once-per-turn limit is printed)";
const D_SEP = "is separate from the Develop Rule (either order)";
const D_CTRL = "only its controller can use it";
clause(HEROES, "4:ability", D_PAY, drawPays(H));
clause(LUG, "4:ability", D_PAY, drawPays(L));
clause(HEROES, "4:ability", D_SHORT, drawUnaffordable(H));
clause(LUG, "4:ability", D_SHORT, drawUnaffordable(L));
clause(HEROES, "4:ability", D_AGAIN, drawAgain(H));
clause(LUG, "4:ability", D_AGAIN, drawAgain(L));
clause(HEROES, "4:ability", D_SEP, drawSeparate(H));
clause(LUG, "4:ability", D_SEP, drawSeparate(L));
clause(HEROES, "4:ability", D_CTRL, drawControllerOnly(H));
clause(LUG, "4:ability", D_CTRL, drawControllerOnly(L));

// --- RESOURCE (pay 4: play a resource)
const R_PAY = "pays exactly 4 resources and plays a resource card from my hand face-up";
const R_DOWN = "plays a non-resource card face-down as a resource";
const R_HAND = "the card must come from my own hand";
const R_SHORT = "is refused when the 4 can't be paid";
const R_AGAIN = "can be used again the same turn";
const R_SEP = "is separate from the Develop Rule";
const R_CTRL = "only its controller can use it";
clause(HEROES, "5:ability", R_PAY, resourcePays(H));
clause(LUG, "5:ability", R_PAY, resourcePays(L));
clause(HEROES, "5:ability", R_DOWN, resourceFaceDownBody(H));
clause(LUG, "5:ability", R_DOWN, resourceFaceDownBody(L));
clause(HEROES, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceChoice(H));
clause(LUG, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", resourceChoice(L));
clause(HEROES, "5:ability", R_HAND, resourceMyHand(H));
clause(LUG, "5:ability", R_HAND, resourceMyHand(L));
clause(HEROES, "5:ability", R_SHORT, resourceUnaffordable(H));
clause(LUG, "5:ability", R_SHORT, resourceUnaffordable(L));
clause(HEROES, "5:ability", R_AGAIN, resourceAgain(H));
clause(LUG, "5:ability", R_AGAIN, resourceAgain(L));
clause(HEROES, "5:ability", R_SEP, resourceSeparate(H));
clause(LUG, "5:ability", R_SEP, resourceSeparate(L));
clause(HEROES, "5:ability", R_CTRL, resourceControllerOnly(H));
clause(LUG, "5:ability", R_CTRL, resourceControllerOnly(L));

// =============================================================================
// Lugubrian Council Expedition Division
// STARTING RESOURCES: 1 Obsession, 1 staple resource.
// STARTING DRAW: 8 going first, 9 going second.
// DEVELOP RULE: At the start of your turn put a token on this card then, draw a card or play a resource.
// EVIL PLAN -- COST: Remove 4 tokens from this card. Pay 3. -- EFFECT: Search your deck for a tactic, reveal it and put it into your hand.
// ENERGIZE WITH HUMOUR -- COST: Remove 2 tokens from this card. Pick a character. -- EFFECT: Put a token on that character.
// =============================================================================

const lugSeat = (deck: CardDefinition[]) => ({ faction: printing(LUG), deck });

clause(LUG, "0:rule:STARTING RESOURCES", "starts with 1 Obsession and 1 other staple in play face-up", () => {
  const engine = setupGame(lugSeat([GREED, RAGE, OBSESSION, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2);
  assert.deepEqual(namesIn(engine, mine), ["Greed", "Obsession"], "Obsession (even though it is deeper in the deck) + the first staple");
  for (const cardId of mine) assert.equal(engine.state.cards[cardId].faceDown, false);
  assert.equal(engine.getThresholds(P1).obsession, 1);
  assert.equal(engine.getThresholds(P1).greed, 1);
});

clause(LUG, "0:rule:STARTING RESOURCES", "the staple slot is a staple: a non-staple resource and a non-resource are skipped", () => {
  const engine = setupGame(lugSeat([ODD_RESOURCE, FILLER, OBSESSION, RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Obsession", "Rage"]);
});

clause(LUG, "0:rule:STARTING RESOURCES", "the staple slot may also be a second Obsession (Obsession is a staple)", () => {
  const engine = setupGame(lugSeat([OBSESSION, OBSESSION, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Obsession", "Obsession"]);
  assert.equal(engine.getThresholds(P1).obsession, 2);
});

clause(LUG, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck and the opponent starts with their own", () => {
  const engine = setupGame(lugSeat([OBSESSION, RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: [ELITISM, DECEPTION, ...repeat(FILLER, 40)] });
  assert.equal(deckOf(engine, P1).length, 42 - 2 - 8, "42 cards, 2 starting resources, 8 in the opening hand");
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

clause(LUG, "0:rule:STARTING RESOURCES", "with the choose step on, the player picks WHICH staple fills the staple slot (Obsession is fixed)", () => {
  const engine = setupGame(
    lugSeat([OBSESSION, RAGE, GREED, ...repeat(FILLER, 40)]),
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "'1 staple resource': I am asked which staple");
  const choice = engine.getStartingResourceChoice(P1)!;
  assert.ok(choice, "choice");
  const named = (n: string) => choice.candidateCardIds.filter((c) => engine.getDefinition(c).name === n);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [named("Greed")[0]] });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Obsession"]);
});

clause(LUG, "1:rule:STARTING DRAW", "draws 8 going first", () => {
  assert.equal(handSize(setupGame(lugSeat([OBSESSION, RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});

clause(LUG, "1:rule:STARTING DRAW", "draws 9 going second", () => {
  assert.equal(handSize(setupGame(lugSeat([OBSESSION, RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});

clause(LUG, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8) and has no search", () => {
  const seat = () => lugSeat([OBSESSION, RAGE, GREED, ELITISM, ...repeat(FILLER, 40)]);
  const a = setupGame(seat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  assert.equal(handSize(a, P2), 8, "opponent going second");
  assert.equal(revealEvents(a).length, 0, "no search/reveal in this STARTING DRAW");
  assert.equal(handSize(setupGame(seat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

clause(LUG, "1:rule:STARTING DRAW", "applies the same when the faction sits in the second seat (8 first / 9 second)", () => {
  const seat = () => lugSeat([OBSESSION, RAGE, ...repeat(FILLER, 40)]);
  assert.equal(handSize(setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, seat(), { first: P1 }), P2), 9);
  assert.equal(handSize(setupGame({ faction: PLAIN_OPP, deck: plainOppDeck() }, seat(), { first: P2 }), P2), 8);
});

// --- DEVELOP RULE: the token
const lugBoard = (active: Pid = P2, extra: CardPlacement[] = []) =>
  buildGame({
    playerA: { faction: printing(LUG) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "My Character" }), owner: P1 },
      ...fillers("mydeck", 6, P1, "deck"),
      ...fillers("theirdeck", 6, P2, "deck"),
      ...extra
    ]
  });

clause(LUG, "3:rule:DEVELOP RULE", "at the start of my turn a token is put on the faction, BEFORE I choose to draw or play a resource", () => {
  const { engine, id } = lugBoard(P2);
  const f = factionOf(engine, P1);
  assert.equal(tokens(engine, f), 0);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokens(engine, f), 1, "one token on this card");
  assert.ok(developOffers(engine, P1).length > 0, "the develop choice is still unused: the token came first");
  developDraw(engine, P1);
  assert.equal(tokens(engine, f), 1, "the draw doesn't remove it");
  assert.equal(zoneOf(engine, id("mydeck0")), "hand");
});

clause(LUG, "3:rule:DEVELOP RULE", "the token is put on even if I then play a resource, and skipping the develop choice keeps it", () => {
  const a = lugBoard(P2);
  endTurn(a.engine, P2);
  developResource(a.engine, P1, a.id("handRes"), false);
  assert.equal(tokens(a.engine, factionOf(a.engine, P1)), 1);
  const b = lugBoard(P2);
  endTurn(b.engine, P2);
  endTurn(b.engine, P1);
  assert.equal(tokens(b.engine, factionOf(b.engine, P1)), 1, "no develop choice used: the token is still there");
});

clause(LUG, "3:rule:DEVELOP RULE", "a token is added at the start of EVERY one of my turns (they accumulate)", () => {
  const { engine } = lugBoard(P2);
  const f = factionOf(engine, P1);
  endTurn(engine, P2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokens(engine, f), 2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokens(engine, f), 3);
});

clause(LUG, "3:rule:DEVELOP RULE", "no token at the start of the opponent's turn, and none on any other card", () => {
  const { engine, id } = lugBoard(P1);
  const f = factionOf(engine, P1);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(tokens(engine, f), 0, "not at the opponent's turn start");
  assert.equal(tokens(engine, factionOf(engine, P2)), 0);
  endTurn(engine, P2);
  assert.equal(tokens(engine, f), 1);
  assert.equal(tokens(engine, id("mine")), 0, "only this card gets the token");
  assert.equal(tokens(engine, factionOf(engine, P2)), 0);
});

clause(LUG, "3:rule:DEVELOP RULE", "the first turn of the game counts as the start of my turn: going first I start turn 1 with a token", () => {
  const engine = setupGame(lugSeat([OBSESSION, RAGE, ...repeat(FILLER, 40)]), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  engine.perform({ type: "mulligan", playerId: P1, cardIds: [] } as never);
  engine.perform({ type: "mulligan", playerId: P2, cardIds: [] } as never);
  settleStartFirst(engine); // the first turn's Restore and Develop Rules
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokens(engine, factionOf(engine, P1)), 1);
});

// --- EVIL PLAN
const TACTIC_A = tactic({ name: "Tactic A" });
const TACTIC_B = tactic({ name: "Tactic B" });

function evilBoard(tokenCount: number, resources: number, extra: CardPlacement[] = []) {
  const built = buildGame({
    playerA: { faction: printing(LUG) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...fillers("mydeck", 8, P1, "deck"),
      { key: "tacA", def: TACTIC_A, owner: P1, zone: "deck" },
      { key: "tacB", def: TACTIC_B, owner: P1, zone: "deck" },
      ...fillers("mydeck2", 8, P1, "deck"),
      { key: "tacHand", def: tactic({ name: "Hand Tactic" }), owner: P1, zone: "hand" },
      { key: "tacDisc", def: tactic({ name: "Discard Tactic" }), owner: P1, zone: "discard" },
      { key: "theirTac", def: tactic({ name: "Their Tactic" }), owner: P2, zone: "deck" },
      ...fillers("theirdeck", 4, P2, "deck"),
      ...extra
    ]
  });
  built.engine.state.cards[factionOf(built.engine, P1)].counters = { token: tokenCount };
  return built;
}
const PLAN = "lugubrian-evil-plan";

clause(LUG, "6:ability", "removes exactly 4 tokens, pays exactly 3 resources, and puts the chosen tactic from my deck into my hand", () => {
  const { engine, id } = evilBoard(6, 5);
  const handBefore = handSize(engine, P1);
  const deckBefore = deckOf(engine, P1).length;
  useFaction(engine, P1, PLAN, [id("tacA")]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, factionOf(engine, P1)), 2, "6 - 4 tokens");
  assert.equal(attachedCount(engine, P1), 3, "3 resources paid");
  assert.equal(readyCount(engine, P1), 2);
  assert.equal(zoneOf(engine, id("tacA")), "hand", "the tactic is in my hand");
  assert.equal(handSize(engine, P1), handBefore + 1, "exactly one card");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(zoneOf(engine, id("tacB")), "deck", "the other tactic stays in the deck");
  assert.equal(zoneOf(engine, id("theirTac")), "deck");
});

clause(LUG, "6:ability", "can fetch any tactic of my deck (the second one too)", () => {
  const { engine, id } = evilBoard(4, 3);
  useFaction(engine, P1, PLAN, [id("tacB")]);
  assert.equal(zoneOf(engine, id("tacB")), "hand");
  assert.equal(zoneOf(engine, id("tacA")), "deck");
  assert.equal(tokens(engine, factionOf(engine, P1)), 0, "exactly 4 tokens were enough");
});

clause(LUG, "6:ability", "is refused with fewer than 4 tokens (3 tokens, 0 tokens) and works with exactly 4", () => {
  const three = evilBoard(3, 5);
  refused(() => useFaction(three.engine, P1, PLAN, [three.id("tacA")]), "3 tokens", /cannot be paid|token/i);
  assert.equal(attachedCount(three.engine, P1), 0, "no resources were paid");
  assert.equal(tokens(three.engine, factionOf(three.engine, P1)), 3, "no tokens were removed");
  assert.equal(zoneOf(three.engine, three.id("tacA")), "deck");
  const none = evilBoard(0, 5);
  refused(() => useFaction(none.engine, P1, PLAN, [none.id("tacA")]), "0 tokens", /cannot be paid|token/i);
  const four = evilBoard(4, 5);
  useFaction(four.engine, P1, PLAN, [four.id("tacA")]); // control
  assert.equal(zoneOf(four.engine, four.id("tacA")), "hand");
});

clause(LUG, "6:ability", "is refused when the 3 resources can't be paid (2 resources, none, 3 with one spent) even with plenty of tokens", () => {
  const two = evilBoard(8, 2);
  refused(() => useFaction(two.engine, P1, PLAN, [two.id("tacA")]), "2 resources", /cannot be paid/);
  assert.equal(tokens(two.engine, factionOf(two.engine, P1)), 8, "no tokens were removed");
  assert.equal(zoneOf(two.engine, two.id("tacA")), "deck");
  const none = evilBoard(8, 0);
  refused(() => useFaction(none.engine, P1, PLAN, [none.id("tacA")]), "no resources", /cannot be paid/);
  const spent = evilBoard(8, 3);
  spent.engine.state.cards[spent.engine.getAvailableResourceIds(P1)[0]].attachedTo = factionOf(spent.engine, P1);
  refused(() => useFaction(spent.engine, P1, PLAN, [spent.id("tacA")]), "3 resources with 1 spent", /cannot be paid/);
  const exact = evilBoard(8, 3);
  useFaction(exact.engine, P1, PLAN, [exact.id("tacA")]); // control
  assert.equal(zoneOf(exact.engine, exact.id("tacA")), "hand");
});

clause(LUG, "6:ability", "only a tactic in my deck can be picked (not a character, not a tactic in hand or discard, not the opponent's deck)", () => {
  for (const key of ["mydeck0", "tacHand", "tacDisc", "theirTac", "theirdeck0"]) {
    const { engine, id } = evilBoard(8, 8);
    const was = zoneOf(engine, id(key));
    const hand = handSize(engine, P1);
    refused(() => useFaction(engine, P1, PLAN, [id(key)]), `picking ${key}`);
    assert.equal(zoneOf(engine, id(key)), was, `${key} did not move`);
    assert.equal(handSize(engine, P1), hand, "nothing entered my hand");
  }
  const { engine, id } = evilBoard(8, 8); // control
  useFaction(engine, P1, PLAN, [id("tacA")]);
  assert.equal(zoneOf(engine, id("tacA")), "hand");
});

clause(LUG, "6:ability", "reveals the tactic it fetched to everyone", () => {
  const { engine, id } = evilBoard(4, 3);
  useFaction(engine, P1, PLAN, [id("tacA")]);
  const ev = revealEvents(engine).filter((e) => e.ownerId === P1);
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].cardIds, [id("tacA")]);
  assert.equal(ev[0].viewerId, "all");
  assert.equal(ev[0].zone, "deck");
});

clause(LUG, "6:ability", "shuffles my deck after the search", () => {
  const { engine, id } = evilBoard(4, 3);
  const before = deckOf(engine, P1).filter((c) => c !== id("tacA"));
  useFaction(engine, P1, PLAN, [id("tacA")]);
  const after = deckOf(engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a different order");
  const opp = evilBoard(4, 3);
  const theirs = [...deckOf(opp.engine, P2)];
  useFaction(opp.engine, P1, PLAN, [opp.id("tacA")]);
  assert.deepEqual(deckOf(opp.engine, P2), theirs, "the opponent's deck is untouched");
});

clause(LUG, "6:ability", "a search may find nothing: with no tactic in my deck the costs are paid, nothing moves, and the deck is shuffled", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(LUG) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 3, P1), ...fillers("mydeck", 20, P1, "deck"), ...fillers("theirdeck", 4, P2, "deck")]
  });
  engine.state.cards[factionOf(engine, P1)].counters = { token: 4 };
  const before = [...deckOf(engine, P1)];
  const hand = handSize(engine, P1);
  activateFaction(engine, P1, PLAN);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(tokens(engine, factionOf(engine, P1)), 0);
  assert.equal(attachedCount(engine, P1), 3);
  assert.equal(handSize(engine, P1), hand);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(engine, P1), before, "a failed search still shuffles");
});

clause(LUG, "6:ability", "I may decline to take a tactic even though my deck has one (costs stay paid, deck shuffled)", () => {
  const { engine, id } = evilBoard(4, 3);
  const before = [...deckOf(engine, P1)];
  useFaction(engine, P1, PLAN, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("tacA")), "deck");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
  assert.equal(tokens(engine, factionOf(engine, P1)), 0);
  assert.equal(attachedCount(engine, P1), 3);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...before].sort());
  assert.notDeepEqual(deckOf(engine, P1), before);
});

clause(LUG, "6:ability", "can be used again when I have 8 tokens and 6 resources; only its controller can use it", () => {
  const { engine, id } = evilBoard(8, 6);
  useFaction(engine, P1, PLAN, [id("tacA")]);
  useFaction(engine, P1, PLAN, [id("tacB")]);
  assert.equal(zoneOf(engine, id("tacA")), "hand");
  assert.equal(zoneOf(engine, id("tacB")), "hand");
  assert.equal(tokens(engine, factionOf(engine, P1)), 0);
  assert.equal(attachedCount(engine, P1), 6);
  const opp = evilBoard(8, 6, [...bank("rage", 6, P2)]);
  opp.engine.state.activePlayerId = P2;
  refused(() => activateFaction(opp.engine, P2, PLAN, P1), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(zoneOf(opp.engine, opp.id("tacA")), "deck");
  assert.equal(tokens(opp.engine, factionOf(opp.engine, P1)), 8);
});

// --- ENERGIZE WITH HUMOUR
const ENERGIZE = "lugubrian-energize";

function energizeBoard(tokenCount: number, resources = 0) {
  const built = buildGame({
    playerA: { faction: printing(LUG) },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      { key: "mine", def: character({ name: "My Character" }), owner: P1 },
      { key: "mine2", def: character({ name: "My Other Character" }), owner: P1, counters: { token: 1 } },
      { key: "theirs", def: character({ name: "Their Character" }), owner: P2 },
      { key: "myItem", def: item({ name: "My Item" }), owner: P1 },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "deckChar", def: character({ name: "Deck Character" }), owner: P1, zone: "deck" },
      { key: "discChar", def: character({ name: "Discard Character" }), owner: P1, zone: "discard" },
      ...fillers("theirdeck", 4, P2, "deck")
    ]
  });
  built.engine.state.cards[factionOf(built.engine, P1)].counters = { token: tokenCount };
  return built;
}

clause(LUG, "7:ability", "removes exactly 2 tokens from the faction and puts exactly one token on the picked character", () => {
  const { engine, id } = energizeBoard(5);
  activateFaction(engine, P1, ENERGIZE, P1, { c: [id("mine")] });
  assert.equal(tokens(engine, factionOf(engine, P1)), 3, "5 - 2 tokens");
  assert.equal(tokens(engine, id("mine")), 1, "+1 token on the character");
  assert.equal(tokens(engine, id("mine2")), 1, "another character is untouched");
  assert.equal(tokens(engine, id("theirs")), 0);
  assert.equal(attachedCount(engine, P1), 0, "no resources are paid");
});

clause(LUG, "7:ability", "a character that already has tokens gets one more, and it can be used repeatedly", () => {
  const { engine, id } = energizeBoard(4);
  activateFaction(engine, P1, ENERGIZE, P1, { c: [id("mine2")] });
  assert.equal(tokens(engine, id("mine2")), 2);
  activateFaction(engine, P1, ENERGIZE, P1, { c: [id("mine2")] });
  assert.equal(tokens(engine, id("mine2")), 3);
  assert.equal(tokens(engine, factionOf(engine, P1)), 0);
});

clause(LUG, "7:ability", "any character can be picked, including the opponent's", () => {
  const { engine, id } = energizeBoard(2);
  activateFaction(engine, P1, ENERGIZE, P1, { c: [id("theirs")] });
  assert.equal(tokens(engine, id("theirs")), 1);
  assert.equal(tokens(engine, factionOf(engine, P1)), 0);
});

clause(LUG, "7:ability", "is refused with fewer than 2 tokens (1 token, 0) and works with exactly 2", () => {
  const one = energizeBoard(1);
  refused(() => activateFaction(one.engine, P1, ENERGIZE, P1, { c: [one.id("mine")] }), "1 token", /cannot be paid|token/i);
  assert.equal(tokens(one.engine, one.id("mine")), 0);
  assert.equal(tokens(one.engine, factionOf(one.engine, P1)), 1, "no tokens removed");
  const zero = energizeBoard(0);
  refused(() => activateFaction(zero.engine, P1, ENERGIZE, P1, { c: [zero.id("mine")] }), "0 tokens", /cannot be paid|token/i);
  const two = energizeBoard(2);
  activateFaction(two.engine, P1, ENERGIZE, P1, { c: [two.id("mine")] }); // control
  assert.equal(tokens(two.engine, two.id("mine")), 1);
});

clause(LUG, "7:ability", "only a character in play can be picked (not an item, the factions, or a character in hand / deck / discard)", () => {
  const { engine, id } = energizeBoard(8);
  const cands: CardInstanceId[] = [id("myItem"), factionOf(engine, P1), factionOf(engine, P2), id("handChar"), id("deckChar"), id("discChar")];
  for (const target of cands) refused(() => activateFaction(engine, P1, ENERGIZE, P1, { c: [target] }), `target ${target}`);
  assert.equal(tokens(engine, factionOf(engine, P1)), 8, "nothing was paid by the refused attempts");
  activateFaction(engine, P1, ENERGIZE, P1, { c: [id("mine")] }); // control
  assert.equal(tokens(engine, id("mine")), 1);
});

clause(LUG, "7:ability", "a character must be picked (no target is refused) and only one is picked", () => {
  const { engine, id } = energizeBoard(8);
  refused(() => activateFaction(engine, P1, ENERGIZE, P1, {}), "no target");
  refused(() => activateFaction(engine, P1, ENERGIZE, P1, { c: [id("mine"), id("theirs")] }), "two targets");
  assert.equal(tokens(engine, factionOf(engine, P1)), 8);
  assert.equal(tokens(engine, id("mine")), 0);
  assert.equal(tokens(engine, id("theirs")), 0);
});

clause(LUG, "7:ability", "only its controller can use it", () => {
  const { engine, id } = energizeBoard(4);
  engine.state.activePlayerId = P2;
  refused(() => activateFaction(engine, P2, ENERGIZE, P1, { c: [id("theirs")] }), "the opponent cannot use my faction's ability", /do not control/i);
  assert.equal(tokens(engine, id("theirs")), 0);
  assert.equal(tokens(engine, factionOf(engine, P1)), 4);
});


// --- additions after the mutation pass

clause(HEROES, "1:rule:STARTING DRAW", "the search takes a STAPLE RESOURCE: non-staple resources and non-resource cards earlier in the deck are never the fetched card (any shuffle)", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const engine = setupGame(
      heroesSeat([ODD_RESOURCE, FILLER, RAGE, RAGE, GREED, ELITISM, ...repeat(FILLER, 12)]),
      { faction: PLAIN_OPP, deck: plainOppDeck() },
      { first: P1, seed }
    );
    assert.equal(engine.state.players[P1].hand.filter((c) => engine.getDefinition(c).name === "Elitism").length, 1, `seed ${seed}: Elitism fetched`);
    assert.equal(handSize(engine, P1), 8, `seed ${seed}`);
    const ev = revealEvents(engine).filter((e) => e.ownerId === P1);
    assert.equal(engine.getDefinition(ev[0].cardIds[0]).name, "Elitism", `seed ${seed}: the revealed card is the staple`);
  }
});

const resourceExactlyOne = (c: Cfg) => () => {
  const { engine, id } = abilityBoard(printing(c.id), 4);
  activateFaction(engine, P1, c.resource);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  const answer = (selected: CardInstanceId[]) => () =>
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected } } as never);
  refused(answer([id("handRes"), id("handChar")]), "two resources at once");
  assert.equal(zoneOf(engine, id("handRes")), "hand");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
  answer([id("handRes")])(); // control: exactly one
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("handRes")), "play");
  assert.equal(zoneOf(engine, id("handChar")), "hand");
};
clause(HEROES, "5:ability", "plays exactly one resource, never two", resourceExactlyOne(H));
clause(LUG, "5:ability", "plays exactly one resource, never two", resourceExactlyOne(L));

const resourceMandatory = (c: Cfg) => () => {
  const { engine } = abilityBoard(printing(c.id), 4);
  activateFaction(engine, P1, c.resource);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "'Play a resource' is not 'you may': with cards in hand the 4 resources cannot be spent for nothing"
  );
};
clause(HEROES, "5:ability", "'Play a resource' is mandatory: with cards in hand the pick cannot be left empty", resourceMandatory(H));
clause(LUG, "5:ability", "'Play a resource' is mandatory: with cards in hand the pick cannot be left empty", resourceMandatory(L));

clause(LUG, "6:ability", "fetches exactly one tactic, never two", () => {
  const { engine, id } = evilBoard(4, 3);
  activateFaction(engine, P1, PLAN);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string };
  assert.equal(pc.kind, "chooserSelectsTarget");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id("tacA"), id("tacB")] } } as never),
    "two tactics"
  );
  assert.equal(zoneOf(engine, id("tacA")), "deck");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "chooserSelectsTarget", selected: [id("tacA")] } } as never); // control
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("tacA")), "hand");
  assert.equal(zoneOf(engine, id("tacB")), "deck");
});
