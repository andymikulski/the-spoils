// Clause tests — batch seed-3-04, part p1 (the three Seed 3 faction cards:
// Imperial Army, Counter-Imperial Army — the other side of the same physical
// card — and Slightly Less Evil Alliance). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-3-04 --groups 1-3`. Expectations come from
// each card's PRINTED text, RULES.md (§3.6 Faction, §4 paying costs, §5 Setup,
// §6 Turn structure, §10 Abilities) and the Comprehensive Rules (202.x factions,
// 406.x numeric costs, 605.x playing a resource, 610.x ending a turn); engine
// data is only used to drive the engine.
//
//   - `setupGame(...)` runs the REAL setup path for STARTING RESOURCES / STARTING DRAW.
//   - `buildGame(...)` places a mid-game board for the turn rules (RESTORE / DEVELOP),
//     the printed abilities and the coin-flip side swap.

import assert from "node:assert/strict";
import { createFactionGame, getLoyalty, opponentsOf } from "../../../engine.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "../per-card/_harness.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, clauseMismatch, exempt, printing, refused, holdResourceFace } from "./_clause.js";
import type { Seat } from "./_turn.js";
import { attachedCount, developDraw, developResource, endTurn, factionOf, readyCount, setupGame, spentResources, developOffers, endTurnRaw, settleStartFirst } from "./_turn.js";
import { settleTurnStart } from "../support/develop.js";
import * as sd from "./_showdown.js";

// --- the three printings ---------------------------------------------------

const IMP = "2ce14e80-b0c6-4a3a-999b-c240b4fff9d5"; // Imperial Army
const CTR = "78571459-b948-4558-823e-e463e5fc5526"; // Counter-Imperial Army (the other side)
const SLE = "089a2d63-c9b9-4ad7-8c51-1d0d79a0dfbb"; // Slightly Less Evil Alliance

// --- shared cards ----------------------------------------------------------

const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
// A resource that provides Rage but is NOT the staple resource "Rage".
const IDOL = resourceCard({ id: "s304-idol", name: "Rage Idol", resource: { provides: ["rage"], staple: false } });
const FILLER = character({ id: "s304-filler", name: "Filler" });
const BIG4 = character({ id: "s304-big4", name: "Big Four", cost: 4 });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second, a normal Restore / Develop Rule.
const PLAIN_OPP = factionCard({
  id: "s304-plain-opp",
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
const oppDeck = (): CardDefinition[] => [ELITISM, DECEPTION, ...repeat(FILLER, 40)];

// --- helpers ---------------------------------------------------------------

const playCards = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] =>
  engine.state.players[pid].play.filter((id) => engine.getDefinition(id).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((id) => engine.getDefinition(id).name).sort();
const handSize = (engine: SpoilsEngine, pid: PlayerId): number => engine.state.players[pid].hand.length;
const sideName = (engine: SpoilsEngine, pid: PlayerId): string => engine.getDefinition(factionOf(engine, pid)).name;
const mulligan = (engine: SpoilsEngine, p: PlayerId, cardIds: CardInstanceId[]) =>
  engine.perform({ type: "mulligan", playerId: p, cardIds } as never);

/** Four plain characters on top of `owner`'s deck (the first key is the top card). */
function topOfDeck(label: string, owner: PlayerId, n = 4): CardPlacement[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `${label}${i}`,
    def: character({ name: `${label} ${i}` }),
    owner,
    zone: "deck" as const
  }));
}

/** Uses `owner`'s faction ability as `pid` (the faction is not necessarily the user's). */
const useFaction = (engine: SpoilsEngine, pid: PlayerId, abilityId: string, owner: PlayerId = pid): void =>
  activate(engine, pid, factionOf(engine, owner), abilityId, {});

function pickFromHand(engine: SpoilsEngine, pid: PlayerId, cardId: CardInstanceId | undefined): void {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  assert.ok(pc, "the ability asks which card to play");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, pid, "the user of the ability chooses");
  engine.perform({
    type: "resolvePendingChoice",
    playerId: pid,
    choice: { kind: "chooserSelectsTarget", selected: cardId ? [cardId] : [] }
  } as never);
  resolvePendingResponses(engine);
}

/** The other side of the physical card must be registered with the engine for the flip to work. */
const stash = (def: CardDefinition): CardPlacement => ({ key: "otherSide", def, owner: P2, zone: "void" });

// =============================================================================
// Shared clause bodies. Imperial Army and Counter-Imperial Army print the same
// shapes (RESTORE, DRAW, RESOURCE, the coin flip), so each calls the same checks.
// =============================================================================

// ---- printed DRAW / RESOURCE abilities -------------------------------------

function abilityBoard(faction: CardDefinition, resources: number, extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    cards: [
      ...bank("rage", resources, P1),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      ...extra
    ]
  });
}

function drawPaysAndDraws(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 2);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirDeck = [...engine.state.players[P2].deck];
  assert.equal(readyCount(engine, P1), cost + 2);
  useFaction(engine, P1, abilityId);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(readyCount(engine, P1), 2, `exactly ${cost} resources were paid`);
  assert.equal(attachedCount(engine, P1), cost, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand", "the top card of my deck");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1), "only the top card left the deck");
  assert.deepEqual(engine.state.players[P2].deck, theirDeck, "the opponent's deck is untouched");
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
}

function drawPaidWithFaceDown(faction: CardDefinition, abilityId: string, cost: number): void {
  // Any resource pays (CR §406.5): face-down resources (Volition) count.
  const { engine } = buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    cards: [...volition(cost, P1), ...topOfDeck("mydeck", P1)]
  });
  const handBefore = handSize(engine, P1);
  useFaction(engine, P1, abilityId);
  assert.equal(handSize(engine, P1), handBefore + 1);
  assert.equal(attachedCount(engine, P1), cost);
  assert.equal(readyCount(engine, P1), 0);
}

function drawUnaffordable(faction: CardDefinition, abilityId: string, cost: number): void {
  const pattern = /cannot be paid/;
  // one short
  {
    const { engine } = abilityBoard(faction, cost - 1);
    const handBefore = handSize(engine, P1);
    refused(() => useFaction(engine, P1, abilityId), `${cost} are needed, ${cost - 1} are ready`, pattern);
    assert.equal(handSize(engine, P1), handBefore, "nothing is drawn");
    assert.equal(attachedCount(engine, P1), 0, "nothing was half-paid");
    assert.equal(readyCount(engine, P1), cost - 1);
  }
  // enough resources, but some already spent (attached) this turn
  {
    const { engine } = abilityBoard(faction, cost + 1);
    for (const rid of engine.getAvailableResourceIds(P1).slice(0, 2)) engine.state.cards[rid].attachedTo = factionOf(engine, P1);
    assert.equal(readyCount(engine, P1), cost - 1);
    refused(() => useFaction(engine, P1, abilityId), "spent resources can't pay again", pattern);
  }
  // nothing at all
  {
    const { engine } = abilityBoard(faction, 0);
    refused(() => useFaction(engine, P1, abilityId), "no resources", pattern);
  }
  // positive control: exactly enough works
  {
    const { engine } = abilityBoard(faction, cost);
    const handBefore = handSize(engine, P1);
    useFaction(engine, P1, abilityId);
    assert.equal(handSize(engine, P1), handBefore + 1);
  }
}

function drawRepeatable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine } = abilityBoard(faction, cost * 2 + 1);
  const handBefore = handSize(engine, P1);
  useFaction(engine, P1, abilityId);
  useFaction(engine, P1, abilityId);
  assert.equal(handSize(engine, P1), handBefore + 2, "no once-per-turn limit is printed, so it can be used again");
  assert.equal(attachedCount(engine, P1), cost * 2);
  assert.equal(readyCount(engine, P1), 1);
}

function abilityControllerOnly(faction: CardDefinition, abilityId: string): void {
  const { engine } = buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...topOfDeck("theirdeck", P2), ...topOfDeck("mydeck", P1)]
  });
  const theirHand = handSize(engine, P2);
  refused(() => useFaction(engine, P2, abilityId, P1), "the opponent can't use my faction's ability", /do not control/i);
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(attachedCount(engine, P2), 0, "and pays nothing");
  assert.equal(attachedCount(engine, P1), 0);
}

function resourcePaysAndPlays(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 2);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  useFaction(engine, P1, abilityId);
  assert.equal(attachedCount(engine, P1), cost, `exactly ${cost} resources were paid`);
  pickFromHand(engine, P1, id("handRes"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("handRes")].zone, "play", "the resource was played");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "nothing was drawn");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), 3, "2 untouched + the new resource are ready (the paid ones stay attached)");
}

function resourcePlaysNonResourceFaceDown(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost);
  useFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handChar")].zone, "play", "any card can be played as a resource (CR §605.1b)");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource card can only go in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides one Volition");
  assert.equal(engine.state.cards[id("handRes")].zone, "hand", "only the chosen card was played");
}

function resourceRealResourceFaceDown(faction: CardDefinition, abilityId: string, cost: number): void {
  holdResourceFace(() => {
  // CR §605.1b: "Decide if you are going to play a face-up or facedown resource. Any card can be played face-down,
  // but only actual resource cards can be played face-up." So after picking an actual resource card the player
  // chooses face-up or face-down; face-down it provides Volition instead of its own icon.
  const { engine, id } = abilityBoard(faction, cost);
  useFaction(engine, P1, abilityId);
  engine.perform({
    type: "resolvePendingChoice",
    playerId: P1,
    choice: { kind: "chooserSelectsTarget", selected: [id("handRes")] }
  } as never);
  resolvePendingResponses(engine);
  const asked = engine.state.pendingChoice !== undefined && engine.state.cards[id("handRes")].zone === "hand";
  const faceDown = engine.state.cards[id("handRes")].zone === "play" && engine.state.cards[id("handRes")].faceDown;
  assert.ok(
    asked || faceDown,
    "after picking an actual resource card the player must get to say face-up or face-down; the engine put it in play face-up without asking"
  );
  });
}

function resourceOnlyOwnHand(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost);
  useFaction(engine, P1, abilityId);
  const choose = (cards: CardInstanceId[]) =>
    engine.perform({
      type: "resolvePendingChoice",
      playerId: P1,
      choice: { kind: "chooserSelectsTarget", selected: cards }
    } as never);
  refused(() => choose([id("theirHand")]), "the opponent's hand card isn't a legal pick", /Illegal target/);
  assert.equal(engine.state.cards[id("theirHand")].zone, "hand");
  refused(() => choose([id("mydeck0")]), "a card from my deck isn't either (it has to come from my hand)", /Illegal target/);
  assert.equal(engine.state.cards[id("mydeck0")].zone, "deck");
  refused(() => choose([id("handRes"), id("handChar")]), "'a resource' is one card", /Illegal target|requires/i);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
  // positive control: a card from my own hand works
  choose([id("handChar")]);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
}

function resourceUnaffordable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost - 1);
  refused(() => useFaction(engine, P1, abilityId), `${cost} are needed, ${cost - 1} are ready`, /cannot be paid/);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand", "no resource was played");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), cost - 1);
  const none = abilityBoard(faction, 0);
  refused(() => useFaction(none.engine, P1, abilityId), "no resources", /cannot be paid/);
  // one of them already spent
  const spentOne = abilityBoard(faction, cost);
  spentOne.engine.state.cards[spentOne.engine.getAvailableResourceIds(P1)[0]].attachedTo = factionOf(spentOne.engine, P1);
  refused(() => useFaction(spentOne.engine, P1, abilityId), "a spent resource can't pay", /cannot be paid/);
}

function resourceRepeatable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost * 2);
  useFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handRes"));
  // the new resource (1 ready) + the leftovers (cost) can pay again
  useFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(attachedCount(engine, P1), cost * 2, "no once-per-turn limit is printed");
}

function resourceIsMandatory(faction: CardDefinition, abilityId: string, cost: number): void {
  // "Play a resource." is not a "may": with cards in hand the user must pick one; picking none is refused.
  const { engine, id } = abilityBoard(faction, cost);
  useFaction(engine, P1, abilityId);
  const pc = engine.state.pendingChoice as unknown as { kind: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget");
  refused(
    () =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [] }
      } as never),
    "'Play a resource' is not optional while the hand holds cards: an empty answer is refused",
    /Illegal target|requires|at least|must|required|exactly/i
  );
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
}

// ---- the coin-flip side swap -------------------------------------------------

interface Roll {
  v: number;
}
const WIN = 0.1;
const LOSE = 0.9;

function flipBoard(front: CardDefinition, back: CardDefinition, roll: Roll, extra: CardPlacement[] = [], opp?: CardDefinition, active?: PlayerId) {
  return buildGame({
    playerA: { faction: front },
    playerB: { faction: opp ?? developFaction() },
    activePlayerId: active,
    cards: [stash(back), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2), ...extra],
    random: () => roll.v
  });
}

const coinFlips = (engine: SpoilsEngine) => engine.getLog().filter((e) => e.event?.type === "coinFlipped");

function flipOnWin(front: CardDefinition, back: CardDefinition): void {
  const { engine, id } = flipBoard(front, back, { v: WIN });
  const factionId = id("__factionA");
  assert.equal(sideName(engine, P1), front.name);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn ended");
  assert.equal(coinFlips(engine).length, 1, "a coin was flipped");
  assert.equal(sideName(engine, P1), back.name, "I won the flip: the card is turned over");
  assert.equal(factionOf(engine, P1), factionId, "it is the same physical card");
  assert.equal(engine.getDefinition(factionId).id, back.id);
}

function noFlipOnLoss(front: CardDefinition, back: CardDefinition): void {
  const { engine } = flipBoard(front, back, { v: LOSE });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(coinFlips(engine).length, 1, "a coin was flipped");
  assert.equal(sideName(engine, P1), front.name, "I lost the flip: the card is not turned over");
  assert.equal(engine.getDefinition(factionOf(engine, P1)).id, front.id);
}

function flipsEveryTurn(front: CardDefinition, back: CardDefinition): void {
  const roll: Roll = { v: LOSE };
  const { engine } = flipBoard(front, back, roll);
  endTurn(engine, P1);
  assert.equal(sideName(engine, P1), front.name, "lost the first flip");
  endTurn(engine, P2);
  roll.v = WIN;
  endTurn(engine, P1); // the next end of MY turn flips a fresh coin
  assert.equal(coinFlips(engine).length, 2, "one coin per turn I end");
  assert.equal(sideName(engine, P1), back.name, "won the second flip");
}

function noFlipAtOpponentsEnd(front: CardDefinition, back: CardDefinition): void {
  const { engine } = flipBoard(front, back, { v: WIN }, [], undefined, P2); // the opponent's turn
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(coinFlips(engine).length, 0, "no coin is flipped at the end of the OPPONENT's turn");
  assert.equal(sideName(engine, P1), front.name, "my card is not turned over at the end of the opponent's turn");
  endTurn(engine, P1);
  assert.equal(sideName(engine, P1), back.name, "but it is at the end of mine (control)");
}

function onlyThisCardFlips(front: CardDefinition, back: CardDefinition): void {
  const { engine } = flipBoard(front, back, { v: WIN }, [], front);
  endTurn(engine, P1);
  assert.equal(sideName(engine, P1), back.name, "my copy turned over");
  assert.equal(sideName(engine, P2), front.name, "'this card': the opponent's copy of the same faction is not turned over");
  assert.equal(coinFlips(engine).length, 1, "the opponent's copy flipped no coin at my turn's end");
}

function flipHappensWhenTurnReallyEnds(front: CardDefinition, back: CardDefinition): void {
  // CR §610.1a: "End of turn triggers happen after your opponent has made all their responses, at the moment the
  // turn actually ends."
  const { engine } = flipBoard(front, back, { v: WIN });
  engine.perform({ type: "endTurn", playerId: P1 });
  assert.ok(engine.state.responseWindow, "the opponent gets to respond to the announcement");
  assert.equal(engine.state.activePlayerId, P1, "the turn has not ended yet");
  assert.equal(coinFlips(engine).length, 0, "no coin has been flipped while the opponent is still responding");
  assert.equal(sideName(engine, P1), front.name, "the card is not turned over before the turn actually ends");
  resolvePendingResponses(engine);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(sideName(engine, P1), back.name, "it turns over once the turn ends");
}

function flipKeepsTheBoard(front: CardDefinition, back: CardDefinition): void {
  const { engine, id } = flipBoard(front, back, { v: WIN }, [
    ...spentResources(P1, 2),
    ...bank("greed", 1, P1),
    { key: "depChar", def: character({ name: "Depleted" }), owner: P1, depleted: true }
  ]);
  endTurn(engine, P1);
  assert.equal(sideName(engine, P1), back.name);
  assert.equal(attachedCount(engine, P1), 2, "turning the card over doesn't detach the resources on it");
  assert.equal(readyCount(engine, P1), 1);
  assert.equal(engine.state.cards[id("depChar")].depleted, true, "nor restore anything");
}

// =============================================================================
// IMPERIAL ARMY
// =============================================================================

// ---- 0:rule:STARTING RESOURCES: "2 Rage" ----------------------------------

const impSeat = (): Seat => ({
  faction: printing(IMP),
  deck: [GREED, IDOL, RAGE, DECEPTION, RAGE, RAGE, ...repeat(FILLER, 40)]
});

clause(IMP, "0:rule:STARTING RESOURCES", "starts with exactly 2 Rage in play, face-up", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() });
  const mine = playCards(engine, P1);
  assert.deepEqual(namesIn(engine, mine), ["Rage", "Rage"], "two Rage, nothing else");
  for (const id of mine) assert.equal(engine.state.cards[id].faceDown, false, "face-up");
  assert.equal(engine.getThresholds(P1).rage, 2, "they provide two Rage icons");
  assert.equal(readyCount(engine, P1), 2, "and are ready to pay for things");
});

clause(IMP, "0:rule:STARTING RESOURCES", "the other staples, the Rage-providing non-staple and the third Rage stay out of play", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() });
  const elsewhere = [...engine.state.players[P1].deck, ...engine.state.players[P1].hand].map((id) => engine.getDefinition(id).name);
  assert.equal(elsewhere.filter((n) => n === "Rage").length, 1, "only two of the three Rage were taken");
  assert.equal(elsewhere.filter((n) => n === "Greed").length, 1, "the Greed was not taken");
  assert.equal(elsewhere.filter((n) => n === "Deception").length, 1, "the Deception was not taken");
  assert.equal(elsewhere.filter((n) => n === "Rage Idol").length, 1, "a non-staple card that merely provides Rage is not 'Rage'");
});

clause(IMP, "0:rule:STARTING RESOURCES", "the starting resources come out of the deck (they are not extra cards)", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() });
  const inPlay = playCards(engine, P1).length;
  assert.equal(inPlay, 2);
  assert.equal(engine.state.players[P1].deck.length + handSize(engine, P1) + inPlay, 46, "6 resources + 40 characters in the deck, nothing created");
});

clause(IMP, "0:rule:STARTING RESOURCES", "only its own player: the opponent starts with their own resources, and Imperial Army as the second seat starts with Rage", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"], "their own 2 staples, not Rage");
  const second = setupGame({ faction: PLAIN_OPP, deck: oppDeck() }, impSeat());
  assert.deepEqual(namesIn(second, playCards(second, P2)), ["Rage", "Rage"], "the same 2 Rage as P2");
  assert.deepEqual(namesIn(second, playCards(second, P1)), ["Deception", "Elitism"]);
});

// ---- 1:rule:STARTING DRAW: "3 going first, 3 going second" ------------------

clause(IMP, "1:rule:STARTING DRAW", "draws 3 cards going first", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() }, { first: P1 });
  assert.equal(handSize(engine, P1), 3);
  assert.equal(engine.state.players[P1].deck.length, 41, "they came from the deck (after the 2 starting resources)");
});

clause(IMP, "1:rule:STARTING DRAW", "draws 3 cards going second", () => {
  const engine = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() }, { first: P2 });
  assert.equal(handSize(engine, P1), 3);
});

clause(IMP, "1:rule:STARTING DRAW", "also applies in the second seat (P2), going first or second", () => {
  const goingFirst = setupGame({ faction: PLAIN_OPP, deck: oppDeck() }, impSeat(), { first: P2 });
  assert.equal(handSize(goingFirst, P2), 3);
  const goingSecond = setupGame({ faction: PLAIN_OPP, deck: oppDeck() }, impSeat(), { first: P1 });
  assert.equal(handSize(goingSecond, P2), 3);
});

clause(IMP, "1:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  const first = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() }, { first: P1 });
  assert.equal(handSize(first, P2), 8, "the opponent, going second, draws their own 8");
  const second = setupGame(impSeat(), { faction: PLAIN_OPP, deck: oppDeck() }, { first: P2 });
  assert.equal(handSize(second, P2), 7, "the opponent, going first, draws their own 7");
});

// ---- 2:rule:RESTORE RULE: restore all depleted cards, don't detach resources -

function restoreBoard(faction: CardDefinition, active: PlayerId) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineLoc", def: location({ name: "My Depleted Location" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spentResources(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      // control differs from ownership: "your depleted cards" are the ones YOU control
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spentResources(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}

clause(IMP, "2:rule:RESTORE RULE", "at the start of my turn every depleted card I control is restored: character, item, location", () => {
  const { engine, id } = restoreBoard(printing(IMP), P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  endTurn(engine, P2); // my (P1's) turn starts
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineLoc")].depleted, false, "my depleted location is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
});

clause(IMP, "2:rule:RESTORE RULE", "does not detach resources: the ones spent on my faction stay attached (face-up and face-down)", () => {
  const { engine } = restoreBoard(printing(IMP), P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  assert.equal(readyCount(engine, P1), 2);
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P1), 4, "(But don't detach your resources.) all four stay attached");
  assert.equal(readyCount(engine, P1), 2, "so only the 2 never-spent resources can pay");
});

clause(IMP, "2:rule:RESTORE RULE", "does not restore the opponent's cards or touch the opponent's resources", () => {
  const { engine, id } = restoreBoard(printing(IMP), P2);
  endTurn(engine, P2); // my turn starts
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards' — the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true, "the opponent's item stays depleted");
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "'your faction' — the opponent's resources stay attached");
});

clause(IMP, "2:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(printing(IMP), P1);
  endTurn(engine, P1); // the OPPONENT's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "nor a card the opponent owns but I control");
  assert.equal(attachedCount(engine, P1), 4);
  // ... while the opponent's own (different) restore rule ran for them.
  assert.equal(engine.state.cards[id("theirChar")].depleted, false);
  assert.equal(attachedCount(engine, P2), 0);
});

// ---- 3:rule:DEVELOP RULE: reduce the next character's numeric cost by 2 -------

/** P1 (Imperial Army, active after `endTurn(P2)`) holding `hand`, with `res` ready Rage. */
function reduceBoard(hand: CardPlacement[], res: number, extra: CardPlacement[] = []) {
  const board = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...hand.map((h) => ({ ...h, owner: P1, zone: "hand" as const })), ...bank("rage", res, P1), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2), ...extra]
  });
  endTurn(board.engine, P2); // P1's turn starts: the Develop Rule's reduction is granted
  assert.equal(board.engine.state.activePlayerId, P1);
  return board;
}
const hc = (key: string, def: CardDefinition): CardPlacement => ({ key, def, owner: P1, zone: "hand" });

clause(IMP, "3:rule:DEVELOP RULE", "the next character I play this turn costs 2 less (a cost-3 character is paid with 1 resource)", () => {
  const { engine, id } = reduceBoard([hc("c3", character({ name: "Three", cost: 3 }))], 1);
  play(engine, P1, id("c3"));
  assert.equal(engine.state.cards[id("c3")].zone, "play");
  assert.equal(attachedCount(engine, P1), 1, "paid 3 - 2 = 1");
  assert.equal(readyCount(engine, P1), 0);
});

clause(IMP, "3:rule:DEVELOP RULE", "positive control: without the start of MY turn the same character costs its full 3", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    cards: [hc("c3", character({ name: "Three", cost: 3 })), ...bank("rage", 3, P1)]
  });
  play(engine, P1, id("c3"));
  assert.equal(attachedCount(engine, P1), 3, "no turn start has happened, so no reduction: the printed cost is 3");
  const short = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    cards: [hc("c3", character({ name: "Three", cost: 3 })), ...bank("rage", 1, P1)]
  });
  refused(() => play(short.engine, P1, short.id("c3")), "cost 3 with 1 resource", /cannot be paid|Costs/i);
});

clause(IMP, "3:rule:DEVELOP RULE", "a cost-5 character costs 3: refused with 2 resources, played with 3", () => {
  const poor = reduceBoard([hc("c5", character({ name: "Five", cost: 5 }))], 2);
  refused(() => play(poor.engine, P1, poor.id("c5")), "5 - 2 = 3 needs 3 resources", /cannot be paid|Costs/i);
  assert.equal(poor.engine.state.cards[poor.id("c5")].zone, "hand");
  const rich = reduceBoard([hc("c5", character({ name: "Five", cost: 5 }))], 3);
  play(rich.engine, P1, rich.id("c5"));
  assert.equal(rich.engine.state.cards[rich.id("c5")].zone, "play");
  assert.equal(attachedCount(rich.engine, P1), 3);
});

clause(IMP, "3:rule:DEVELOP RULE", "only the NEXT character: a second character pays its full cost", () => {
  const { engine, id } = reduceBoard(
    [hc("a", character({ name: "A", cost: 3 })), hc("b", character({ name: "B", cost: 3 }))],
    4
  );
  play(engine, P1, id("a"));
  assert.equal(attachedCount(engine, P1), 1, "the first costs 3 - 2");
  play(engine, P1, id("b"));
  assert.equal(engine.state.cards[id("b")].zone, "play");
  assert.equal(attachedCount(engine, P1), 4, "the second paid the full 3");
  // and with too few resources the second is refused
  const tight = reduceBoard([hc("a", character({ name: "A", cost: 3 })), hc("b", character({ name: "B", cost: 3 }))], 3);
  play(tight.engine, P1, tight.id("a"));
  refused(() => play(tight.engine, P1, tight.id("b")), "2 left, the full price is 3", /cannot be paid|Costs/i);
  assert.equal(tight.engine.state.cards[tight.id("b")].zone, "hand");
});

clause(IMP, "3:rule:DEVELOP RULE", "the cost never goes below 0: a cost-1 character is free, and still uses up the reduction", () => {
  const { engine, id } = reduceBoard(
    [hc("c1", character({ name: "One", cost: 1 })), hc("c3", character({ name: "Three", cost: 3 }))],
    3
  );
  play(engine, P1, id("c1"));
  assert.equal(engine.state.cards[id("c1")].zone, "play");
  assert.equal(attachedCount(engine, P1), 0, "1 - 2 floors at 0: nothing is paid");
  play(engine, P1, id("c3"));
  assert.equal(attachedCount(engine, P1), 3, "the reduction went to the cost-1 character, so the next one pays in full");
});

clause(IMP, "3:rule:DEVELOP RULE", "only characters: an item, a location and a tactic cost their full price and leave the reduction for the next character", () => {
  const { engine, id } = reduceBoard(
    [
      hc("it", item({ name: "Item", cost: 2 })),
      hc("lo", location({ name: "Loc", cost: 2 })),
      hc("ta", tactic({ name: "Tac", cost: 1 })),
      hc("ch", character({ name: "Char", cost: 3 }))
    ],
    8
  );
  play(engine, P1, id("it"));
  assert.equal(attachedCount(engine, P1), 2, "the item paid its full 2");
  play(engine, P1, id("lo"));
  assert.equal(attachedCount(engine, P1), 4, "the location paid its full 2");
  play(engine, P1, id("ta"));
  assert.equal(attachedCount(engine, P1), 5, "the tactic paid its full 1");
  play(engine, P1, id("ch"));
  assert.equal(attachedCount(engine, P1), 6, "the character still got the 2 off: 5 + (3 - 2)");
});

clause(IMP, "3:rule:DEVELOP RULE", "only the numeric cost: the character's threshold still has to be met", () => {
  const rageChar = () => hc("tc", character({ name: "Threshold", cost: 3, threshold: "R" }));
  // plenty of resources, but none of them Rage
  const noRage = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [rageChar(), ...bank("greed", 3, P1)]
  });
  endTurn(noRage.engine, P2);
  refused(() => play(noRage.engine, P1, noRage.id("tc")), "the [R] threshold is not met", /threshold/i);
  assert.equal(noRage.engine.state.cards[noRage.id("tc")].zone, "hand");
  // positive control: with a Rage it plays, at the reduced price
  const withRage = reduceBoard([rageChar()], 1);
  play(withRage.engine, P1, withRage.id("tc"));
  assert.equal(withRage.engine.state.cards[withRage.id("tc")].zone, "play");
  assert.equal(attachedCount(withRage.engine, P1), 1);
});

clause(IMP, "3:rule:DEVELOP RULE", "using the DRAW ability first doesn't use the reduction up (an ability's 'pay' isn't a character play)", () => {
  const { engine, id } = reduceBoard([hc("c3", character({ name: "Three", cost: 3 }))], 2);
  useFaction(engine, P1, "imperial-draw"); // pay 1
  assert.equal(attachedCount(engine, P1), 1, "the ability costs its printed 1, not 0");
  play(engine, P1, id("c3"));
  assert.equal(attachedCount(engine, P1), 2, "the character still got its reduction: 1 + (3 - 2)");
});

clause(IMP, "3:rule:DEVELOP RULE", "the reduction lasts this turn only: an unused one does not carry over or stack", () => {
  const { engine, id } = reduceBoard([hc("c5", character({ name: "Five", cost: 5 }))], 2);
  endTurn(engine, P1); // I used nothing
  endTurn(engine, P2); // my next turn: a fresh reduction of 2 (not 4)
  assert.equal(engine.state.activePlayerId, P1);
  refused(() => play(engine, P1, id("c5")), "5 - 2 = 3 with 2 resources: last turn's unused reduction is gone", /cannot be paid|Costs/i);
  assert.equal(engine.state.cards[id("c5")].zone, "hand");
});

clause(IMP, "3:rule:DEVELOP RULE", "renews every one of my turns", () => {
  const { engine, id } = reduceBoard([hc("a", character({ name: "A", cost: 3 })), hc("b", character({ name: "B", cost: 3 }))], 2);
  play(engine, P1, id("a"));
  assert.equal(attachedCount(engine, P1), 1);
  endTurn(engine, P1);
  endTurn(engine, P2); // my next turn: Imperial Army detaches nothing, 1 resource is still ready
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(readyCount(engine, P1), 1);
  play(engine, P1, id("b"));
  assert.equal(engine.state.cards[id("b")].zone, "play", "a cost-3 character with 1 ready resource: this turn's fresh reduction");
  assert.equal(attachedCount(engine, P1), 2);
});

clause(IMP, "3:rule:DEVELOP RULE", "at the start of the opponent's turn the opponent's characters get no reduction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    cards: [{ key: "oc", def: character({ name: "Opp Three", cost: 3 }), owner: P2, zone: "hand" }, ...bank("rage", 3, P2), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2)]
  });
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  play(engine, P2, id("oc"));
  assert.equal(attachedCount(engine, P2), 3, "'your turn' — the reduction isn't theirs: the character costs the full 3");
});

clause(IMP, "3:rule:DEVELOP RULE", "it is the whole Develop Rule: there is no free draw or resource play", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(IMP) },
    playerB: { faction: developFaction() },
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1)
    ]
  });
  const hand = handSize(engine, P1);
  assert.deepEqual(developOffers(engine, P1), [], "Imperial Army prints no draw-or-resource option");
  refused(() => developDraw(engine, P1), "no develop draw");
  refused(() => developResource(engine, P1, id("handRes"), false), "no develop resource");
  assert.equal(handSize(engine, P1), hand);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
});

clause(IMP, "3:rule:DEVELOP RULE", "applies from the very first turn of a real game (set up through the real setup path)", () => {
  const big = (): Seat => ({ faction: printing(IMP), deck: [RAGE, RAGE, ...repeat(BIG4, 40)] });
  const engine = setupGame(big(), { faction: PLAIN_OPP, deck: oppDeck() }, { first: P1 });
  mulligan(engine, P1, []);
  mulligan(engine, P2, []);
  settleStartFirst(engine); // the first turn's Restore Rule and Imperial Army's start-of-turn discount
  assert.equal(engine.state.activePlayerId, P1);
  const bigId = engine.state.players[P1].hand[0];
  assert.equal(engine.getDefinition(bigId).name, "Big Four");
  play(engine, P1, bigId);
  assert.equal(engine.state.cards[bigId].zone, "play", "a cost-4 character with only 2 starting Rage: 4 - 2 = 2");
  assert.equal(attachedCount(engine, P1), 2);
  const second = engine.state.players[P1].hand[0];
  refused(() => play(engine, P1, second), "the second pays the full 4", /cannot be paid|Costs/i);
});

// ---- 4:ability DRAW (pay 1) -------------------------------------------------

clause(IMP, "4:ability", "pays exactly 1 resource and draws the top card of my deck", () => drawPaysAndDraws(printing(IMP), "imperial-draw", 1));
clause(IMP, "4:ability", "a face-down resource can pay the 1", () => drawPaidWithFaceDown(printing(IMP), "imperial-draw", 1));
clause(IMP, "4:ability", "is refused when the 1 can't be paid (none ready; the only one already spent)", () => drawUnaffordable(printing(IMP), "imperial-draw", 1));
clause(IMP, "4:ability", "can be used again the same turn", () => drawRepeatable(printing(IMP), "imperial-draw", 1));
clause(IMP, "4:ability", "only its controller can use it", () => abilityControllerOnly(printing(IMP), "imperial-draw"));

// ---- 5:ability RESOURCE (pay 2) ---------------------------------------------

clause(IMP, "5:ability", "pays exactly 2 resources and plays a resource card from my hand face-up", () => resourcePaysAndPlays(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "plays a non-resource card from my hand face-down as a resource", () => resourcePlaysNonResourceFaceDown(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () =>
  resourceRealResourceFaceDown(printing(IMP), "imperial-resource", 2)
);
clause(IMP, "5:ability", "the card must come from my own hand, and is exactly one card", () => resourceOnlyOwnHand(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "is refused when the 2 can't be paid (1 ready, none, 1 of 2 already spent)", () => resourceUnaffordable(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "can be used again the same turn", () => resourceRepeatable(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "is not optional: with cards in hand an empty pick is refused", () => resourceIsMandatory(printing(IMP), "imperial-resource", 2));
clause(IMP, "5:ability", "only its controller can use it", () => abilityControllerOnly(printing(IMP), "imperial-resource"));

// ---- 6:rule:INTERNAL CONFLICT -------------------------------------------------

clause(IMP, "6:rule:INTERNAL CONFLICT", "winning the end-of-turn coin flip turns the card over into Counter-Imperial Army (same card)", () =>
  flipOnWin(printing(IMP), printing(CTR))
);
clause(IMP, "6:rule:INTERNAL CONFLICT", "losing the flip leaves Imperial Army face-up", () => noFlipOnLoss(printing(IMP), printing(CTR)));
clause(IMP, "6:rule:INTERNAL CONFLICT", "a coin is flipped at the end of every one of my turns", () => flipsEveryTurn(printing(IMP), printing(CTR)));
clause(IMP, "6:rule:INTERNAL CONFLICT", "only at the end of MY turn: nothing is flipped at the end of the opponent's turn", () =>
  noFlipAtOpponentsEnd(printing(IMP), printing(CTR))
);
clause(IMP, "6:rule:INTERNAL CONFLICT", "'this card': only the faction card with the rule turns over", () => onlyThisCardFlips(printing(IMP), printing(CTR)));
clause(IMP, "6:rule:INTERNAL CONFLICT", "the coin is flipped when the turn actually ends, after the opponent has finished responding (CR §610.1a)", () =>
  flipHappensWhenTurnReallyEnds(printing(IMP), printing(CTR))
);
clause(IMP, "6:rule:INTERNAL CONFLICT", "turning it over keeps the resources on it and restores nothing", () => flipKeepsTheBoard(printing(IMP), printing(CTR)));

clause(IMP, "6:rule:INTERNAL CONFLICT", "only the face-up side is active: after the flip Counter-Imperial Army's rules and abilities apply, Imperial Army's don't", () => {
  const { engine, id } = flipBoard(printing(IMP), printing(CTR), { v: WIN }, [
    ...spentResources(P1, 2),
    { key: "depChar", def: character({ name: "Depleted" }), owner: P1, depleted: true },
    ...bank("greed", 3, P1)
  ]);
  endTurn(engine, P1);
  endTurn(engine, P2); // my next turn starts under the Counter-Imperial Army side
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(sideName(engine, P1), "Counter-Imperial Army");
  assert.equal(attachedCount(engine, P1), 0, "its RESTORE RULE detaches my resources (Imperial's would not)");
  assert.equal(engine.state.cards[id("depChar")].depleted, true, "and doesn't restore depleted cards (Imperial's would)");
  assert.ok(developOffers(engine, P1).length > 0, "its DEVELOP RULE lets me draw or play a resource");
  refused(() => useFaction(engine, P1, "imperial-draw"), "Imperial Army's DRAW is on the inactive side", /not found|Activated ability/i);
  const hand = handSize(engine, P1);
  useFaction(engine, P1, "counter-imperial-draw");
  assert.equal(handSize(engine, P1), hand + 1, "the face-up side's DRAW works");
  assert.equal(attachedCount(engine, P1), 3, "for its printed 3");
});

// =============================================================================
// COUNTER-IMPERIAL ARMY
// =============================================================================

// ---- 0:rule:RESTORE RULE: detach all resources, don't restore depleted cards ----

clause(CTR, "0:rule:RESTORE RULE", "at the start of my turn every resource is detached from my faction (face-up and face-down)", () => {
  const { engine } = restoreBoard(printing(CTR), P2);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");
  assert.equal(readyCount(engine, P1), 2);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(attachedCount(engine, P1), 0, "every resource is detached from my faction");
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
});

clause(CTR, "0:rule:RESTORE RULE", "does not restore depleted cards: characters, items and locations I control stay depleted", () => {
  const { engine, id } = restoreBoard(printing(CTR), P2);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "(But don't restore your depleted cards.) my depleted character stays depleted");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true, "my depleted item stays depleted");
  assert.equal(engine.state.cards[id("mineLoc")].depleted, true, "my depleted location stays depleted");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "a depleted card I control stays depleted");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false, "(a ready one is of course still ready)");
});

clause(CTR, "0:rule:RESTORE RULE", "detaches only MY faction's resources: the opponent's stay attached", () => {
  const { engine } = restoreBoard(printing(CTR), P2);
  endTurn(engine, P2);
  assert.equal(attachedCount(engine, P2), 2, "'your faction' — the opponent's resources stay attached");
});

clause(CTR, "0:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  const { engine, id } = restoreBoard(printing(CTR), P1);
  endTurn(engine, P1); // the OPPONENT's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  // ... while the opponent's own (different) restore rule ran for them.
  assert.equal(engine.state.cards[id("theirChar")].depleted, false);
  assert.equal(attachedCount(engine, P2), 0);
});

// ---- 1:rule:DEVELOP RULE: draw a card or play a resource --------------------

function developBoard(faction: CardDefinition, active: PlayerId = P1) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handRes2", def: resourceCard({ name: "Hand Resource 2", resource: { provides: ["rage"], staple: true } }), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "theirHand", def: character({ name: "Their Hand Card" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(CTR, "1:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", () => {
  const { engine, id } = developBoard(printing(CTR));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand", "the top card of my deck is the one drawn");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1), "only the top card left the deck");
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
});

clause(CTR, "1:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", () => {
  const { engine, id } = developBoard(printing(CTR));
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(engine.state.cards[id("handRes")].zone, "play", "the resource is now in play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "played face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "and it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "no card was drawn");
  assert.equal(engine.state.cards[id("handRes2")].zone, "hand", "only one resource is played");
});

clause(CTR, "1:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition); an actual resource face-down gives Volition, not its icon", () => {
  const { engine, id } = developBoard(printing(CTR));
  developResource(engine, P1, id("handChar"), true);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides one Volition");
  const real = developBoard(printing(CTR));
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].zone, "play");
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down, it no longer provides its Greed");
});

clause(CTR, "1:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  const { engine, id } = developBoard(printing(CTR));
  developResource(engine, P1, id("handChar"), false); // asked to play it face-up
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up (CR §605.1b): a non-resource card enters face-down");
  assert.equal(engine.state.pendingChoice, undefined, "that was the Develop Rule's one resource play");
});

clause(CTR, "1:rule:DEVELOP RULE", "draw OR play a resource: not both", () => {
  {
    const { engine, id } = developBoard(printing(CTR));
    developDraw(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "the draw was the Develop Rule: no resource play is offered");
    assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  }
  {
    const { engine, id } = developBoard(printing(CTR));
    const deckBefore = [...engine.state.players[P1].deck];
    developResource(engine, P1, id("handRes"), false);
    assert.equal(engine.state.pendingChoice, undefined, "the resource play was the Develop Rule: no draw is offered");
    assert.deepEqual(engine.state.players[P1].deck, deckBefore);
  }
});

clause(CTR, "1:rule:DEVELOP RULE", "can be used only once per turn", () => {
  {
    const { engine } = developBoard(printing(CTR));
    developDraw(engine, P1);
    const hand = handSize(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "a second draw is not offered");
    assert.equal(handSize(engine, P1), hand);
  }
  {
    const { engine, id } = developBoard(printing(CTR));
    developResource(engine, P1, id("handRes"), false);
    assert.equal(engine.state.pendingChoice, undefined, "a second resource play is not offered");
    assert.equal(engine.state.cards[id("handRes2")].zone, "hand");
  }
});

clause(CTR, "1:rule:DEVELOP RULE", "can be used only on my own turn", () => {
  const { engine, id } = developBoard(printing(CTR));
  const handBefore = engine.state.players[P1].hand.length;
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: string } | undefined;
  assert.equal(pending?.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.players[P1].hand.length, handBefore, "I draw nothing at the opponent's turn start");
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
});

clause(CTR, "1:rule:DEVELOP RULE", "is optional and renews every turn", () => {
  const { engine } = developBoard(printing(CTR));
  const hand = handSize(engine, P1);
  endTurn(engine, P1); // I skipped my Develop Rule entirely
  assert.equal(handSize(engine, P1), hand, "skipping it costs nothing and gives nothing");
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "the Develop Rule is available again on my next turn: the Develop Rule offered a draw at the start of my turn");
});

clause(CTR, "1:rule:DEVELOP RULE", "unlike Imperial Army's, it gives no cost reduction at the start of my turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: printing(CTR) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [hc("c3", character({ name: "Three", cost: 3 })), ...bank("rage", 2, P1), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2)]
  });
  endTurn(engine, P2);
  refused(() => play(engine, P1, id("c3")), "a cost-3 character with 2 resources: nothing reduces the cost", /cannot be paid|Costs/i);
  assert.equal(engine.state.cards[id("c3")].zone, "hand");
});

// ---- 2:ability DRAW (pay 3), 3:ability RESOURCE (pay 4) ----------------------

clause(CTR, "2:ability", "pays exactly 3 resources and draws the top card of my deck", () => drawPaysAndDraws(printing(CTR), "counter-imperial-draw", 3));
clause(CTR, "2:ability", "face-down resources can pay the 3", () => drawPaidWithFaceDown(printing(CTR), "counter-imperial-draw", 3));
clause(CTR, "2:ability", "is refused when the 3 can't be paid (2 ready, 3 with 2 already spent, none)", () => drawUnaffordable(printing(CTR), "counter-imperial-draw", 3));
clause(CTR, "2:ability", "can be used again the same turn", () => drawRepeatable(printing(CTR), "counter-imperial-draw", 3));
clause(CTR, "2:ability", "is separate from the Develop Rule: both draw", () => {
  const { engine } = abilityBoard(printing(CTR), 3);
  const base = handSize(engine, P1);
  useFaction(engine, P1, "counter-imperial-draw");
  assert.ok(developOffers(engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), base + 2, "ability draw + develop draw");
  const other = abilityBoard(printing(CTR), 3);
  developDraw(other.engine, P1);
  useFaction(other.engine, P1, "counter-imperial-draw");
  assert.equal(handSize(other.engine, P1), base + 2, "and the other way round");
});
clause(CTR, "2:ability", "only its controller can use it", () => abilityControllerOnly(printing(CTR), "counter-imperial-draw"));

clause(CTR, "3:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", () => resourcePaysAndPlays(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "plays a non-resource card from my hand face-down as a resource", () => resourcePlaysNonResourceFaceDown(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () =>
  resourceRealResourceFaceDown(printing(CTR), "counter-imperial-resource", 4)
);
clause(CTR, "3:ability", "the card must come from my own hand, and is exactly one card", () => resourceOnlyOwnHand(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "is refused when the 4 can't be paid (3 ready, none, 1 of 4 already spent)", () => resourceUnaffordable(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "can be used again the same turn", () => resourceRepeatable(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "is not optional: with cards in hand an empty pick is refused", () => resourceIsMandatory(printing(CTR), "counter-imperial-resource", 4));
clause(CTR, "3:ability", "is separate from the Develop Rule: the ability's resource play doesn't use it up", () => {
  const { engine, id } = abilityBoard(printing(CTR), 4);
  useFaction(engine, P1, "counter-imperial-resource");
  pickFromHand(engine, P1, id("handRes"));
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
});
clause(CTR, "3:ability", "only its controller can use it", () => abilityControllerOnly(printing(CTR), "counter-imperial-resource"));

// ---- 4:rule:CONSTANT IN-FIGHTING ---------------------------------------------

clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "winning the end-of-turn coin flip turns the card over into Imperial Army (same card)", () =>
  flipOnWin(printing(CTR), printing(IMP))
);
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "losing the flip leaves Counter-Imperial Army face-up", () => noFlipOnLoss(printing(CTR), printing(IMP)));
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "a coin is flipped at the end of every one of my turns", () => flipsEveryTurn(printing(CTR), printing(IMP)));
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "only at the end of MY turn: nothing is flipped at the end of the opponent's turn", () =>
  noFlipAtOpponentsEnd(printing(CTR), printing(IMP))
);
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "'this card': only the faction card with the rule turns over", () => onlyThisCardFlips(printing(CTR), printing(IMP)));
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "the coin is flipped when the turn actually ends, after the opponent has finished responding (CR §610.1a)", () =>
  flipHappensWhenTurnReallyEnds(printing(CTR), printing(IMP))
);
clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "turning it over keeps the resources on it and restores nothing", () => flipKeepsTheBoard(printing(CTR), printing(IMP)));

clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "only the face-up side is active: after the flip Imperial Army's rules and abilities apply, Counter-Imperial Army's don't", () => {
  const { engine, id } = flipBoard(printing(CTR), printing(IMP), { v: WIN }, [
    ...spentResources(P1, 2),
    { key: "depChar", def: character({ name: "Depleted" }), owner: P1, depleted: true },
    hc("c5", character({ name: "Five", cost: 5 })),
    ...bank("greed", 4, P1)
  ]);
  endTurn(engine, P1);
  endTurn(engine, P2); // my next turn starts under the Imperial Army side
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(sideName(engine, P1), "Imperial Army");
  assert.equal(attachedCount(engine, P1), 2, "its RESTORE RULE detaches nothing (Counter-Imperial's would)");
  assert.equal(engine.state.cards[id("depChar")].depleted, false, "and restores depleted cards (Counter-Imperial's would not)");
  assert.deepEqual(developOffers(engine, P1), [], "its DEVELOP RULE has no free draw / resource play");
  refused(() => useFaction(engine, P1, "counter-imperial-draw"), "Counter-Imperial Army's DRAW is on the inactive side", /not found|Activated ability/i);
  const hand = handSize(engine, P1);
  useFaction(engine, P1, "imperial-draw");
  assert.equal(handSize(engine, P1), hand + 1, "the face-up side's DRAW works");
  assert.equal(attachedCount(engine, P1), 3, "for its printed 1");
  play(engine, P1, id("c5"));
  assert.equal(attachedCount(engine, P1), 6, "and its DEVELOP RULE's reduction applied: 5 - 2 = 3");
});

clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "(other side starts face-up): a game that uses this printing as the faction starts with Imperial Army face-up", () => {
  // Both sides must be registered for the flip; the real catalog always has both.
  const mine = [RAGE, RAGE, ...repeat(FILLER, 40)];
  const theirs = oppDeck();
  const engine = createFactionGame(
    [printing(CTR), printing(IMP), PLAIN_OPP, ...mine, ...theirs],
    [{ id: P1, name: "Alice", deckDefinitionIds: [CTR, ...mine.map((d) => d.id)] },
    { id: P2, name: "Bob", deckDefinitionIds: [PLAIN_OPP.id, ...theirs.map((d) => d.id)] }],
    { firstPlayerId: P1, seed: 7 }
  );
  assert.equal(sideName(engine, P1), "Imperial Army", "the printing's note says the OTHER side starts face-up");
});

// "(Other side starts face-up.)": the game's first side is Imperial Army, so it is Imperial Army's printed
// STARTING RESOURCES (2 Rage) and STARTING DRAW (3 / 3) that set the game up when this printing is the faction.
function ctrSetup(first: PlayerId): SpoilsEngine {
  const mine = [GREED, IDOL, RAGE, DECEPTION, RAGE, RAGE, ...repeat(FILLER, 40)];
  const theirs = oppDeck();
  return createFactionGame(
    [printing(CTR), printing(IMP), PLAIN_OPP, ...mine, ...theirs],
    [{ id: P1, name: "Alice", deckDefinitionIds: [CTR, ...mine.map((d) => d.id)] },
    { id: P2, name: "Bob", deckDefinitionIds: [PLAIN_OPP.id, ...theirs.map((d) => d.id)] }],
    { firstPlayerId: first, seed: 7 }
  );
}

clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "(other side starts face-up): the game is set up with Imperial Army's 2 Rage and 3-card opening hand, going first", () => {
  const engine = ctrSetup(P1);
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"], "Imperial Army's STARTING RESOURCES: 2 Rage");
  assert.equal(handSize(engine, P1), 3, "Imperial Army's STARTING DRAW: 3 going first");
  assert.equal(handSize(engine, P2), 8, "the opponent keeps their own 8 going second");
});

clause(CTR, "4:rule:CONSTANT IN-FIGHTING", "(other side starts face-up): 3 cards going second as well", () => {
  const engine = ctrSetup(P2);
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(handSize(engine, P1), 3, "Imperial Army's STARTING DRAW: 3 going second");
});

// ---- 5:rule: tournament legality ----------------------------------------------

exempt(CTR, "5:rule", "Tournament legality is a format rule outside the game engine (nothing in a played game changes); the engine has no format layer.");

// =============================================================================
// SLIGHTLY LESS EVIL ALLIANCE
// The Showdown faction every Hero shares (Heroes, a Villain, a Temptation Pile, a Hero deck, Allegiance cards).
// The Showdown clauses run on a REAL Showdown game (`createFactionGame`, format `showdown`: the Villain plays The
// Evil Alliance, this card sits on the table); the classic two-player board only shows what a non-Showdown game
// does with it. See `_showdown.ts` for the fixtures.
// =============================================================================

const sleBoard = (extra: CardPlacement[] = [], active?: PlayerId) =>
  buildGame({
    playerA: { faction: printing(SLE) },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [...bank("rage", 8, P1), ...bank("rage", 8, P2), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2), ...extra]
  });

const sdIds = {
  give: "give-in-to-temptation",
  spring: "spring-forth-my-burly-protector",
  teamwork: "teamwork"
};
const counters = (engine: SpoilsEngine): Record<string, number> => engine.state.cards[sd.sharedFaction(engine)].counters;
const controller = (engine: SpoilsEngine, card: CardInstanceId): PlayerId => engine.state.cards[card].controllerId;
const ready = sd.readyResources;
const charactersIn = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] =>
  engine.state.players[pid].play.filter((c) => engine.getDefinition(c).type === "character");

/**
 * Hero 2 plays a Filler on their (first) turn. The Villain then puts `pile` Hero cards into the Temptation Pile
 * (ENTICEMENT, once per Villain turn) and, when `pawns` is 2, Hero 2 plays a second Filler on their next turn. It ends
 * on Hero 1's turn.
 */
function temptationTable(options: { pawns: 1 | 2; pile: 0 | 1 | 2 }) {
  const engine = sd.showdownGame({ heroes: 2, first: sd.H2, heroDeck: [sd.CHAMPION, sd.CHAMPION, sd.CHAMPION] });
  const pawns: CardInstanceId[] = [];
  const playPawn = () => {
    const pawn = engine.state.players[sd.H2].hand[0];
    play(engine, sd.H2, pawn);
    pawns.push(pawn);
  };
  playPawn();
  sd.advanceTo(engine, sd.VILLAIN);
  if (options.pile >= 1) sd.entice(engine);
  sd.advanceTo(engine, sd.H1);
  if (options.pawns === 2 || options.pile === 2) {
    sd.advanceTo(engine, sd.H2);
    if (options.pawns === 2) playPawn();
    sd.advanceTo(engine, sd.VILLAIN);
    if (options.pile === 2) sd.entice(engine);
    sd.advanceTo(engine, sd.H1);
  }
  assert.equal(engine.state.activePlayerId, sd.H1);
  return { engine, pawns };
}

/** Hero 1 uses GIVE IN TO TEMPTATION on `target` and, when asked, claims `claim` from the Temptation Pile. */
function giveIn(engine: SpoilsEngine, target: CardInstanceId, claim?: CardInstanceId): void {
  sd.useAbility(engine, sd.H1, sdIds.give, { c: [target] });
  if (engine.state.pendingChoice?.kind === "chooserSelectsTarget") sd.pickPending(engine, sd.H1, claim ?? sd.pileOf(engine)[0]);
}

// ---- 0:rule  All Heroes can use abilities on this card --------------------------------------------

clause(SLE, "0:rule", "All Heroes can use abilities on this card: every Hero can use them, paying from their own resources", () => {
  const engine = sd.showdownGame({ heroes: 3, heroDeck: [sd.CHAMPION, sd.CHAMPION, sd.CHAMPION] });
  sd.advanceTo(engine, sd.H1);
  sd.useAbility(engine, sd.H1, sdIds.spring);
  assert.equal(ready(engine, sd.H1), 0, "Hero 1 paid 6 of their own");
  assert.equal(ready(engine, sd.H2), 6, "nobody else paid");
  sd.advanceTo(engine, sd.H3);
  sd.useAbility(engine, sd.H3, sdIds.spring);
  assert.equal(ready(engine, sd.H3), 0, "Hero 3 paid 6 of their own");
  assert.equal(sd.heroDeckOf(engine).length, 1, "each Hero claimed a Hero card");
  assert.equal(ready(engine, sd.VILLAIN), 4, "the Villain's own resources are untouched (the Evil Alliance's four staples)");
});

clause(SLE, "0:rule", "the Villain is not a Hero: they cannot use abilities on this card, and are not offered them", () => {
  const engine = sd.showdownGame({ heroes: 2 });
  assert.equal(engine.state.activePlayerId, sd.VILLAIN);
  refused(() => sd.useAbility(engine, sd.VILLAIN, sdIds.spring), "the Villain on their own turn", /Only a Hero/);
  refused(() => sd.useAbility(engine, sd.VILLAIN, sdIds.teamwork, { card: [], player: [] }), "TEAMWORK either", /Only a Hero/);
  const offered = engine.getAvailableActivatedAbilities(sd.VILLAIN).filter((a) => a.cardId === sd.sharedFaction(engine));
  assert.deepEqual(offered, [], "nothing is offered to the Villain from the shared faction");
  assert.equal(sd.heroDeckOf(engine).length, 1, "nothing was claimed");
});

clause(SLE, "0:rule", "outside Showdown nobody is a Hero: in a two-player game the faction offers no abilities and refuses them", () => {
  const { engine } = sleBoard();
  const offered = engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === factionOf(engine, P1));
  assert.deepEqual(offered, []);
  refused(() => activate(engine, P1, factionOf(engine, P1), "spring-forth-my-burly-protector"), "no Hero", /Only a Hero/);
});

// ---- 1:ability GIVE IN TO TEMPTATION -------------------------------------------------------------

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION: pay 2, pick a character another Hero controls; the Villain takes control of it and I claim one card in the Temptation Pile", () => {
  const { engine, pawns } = temptationTable({ pawns: 1, pile: 1 });
  const [pawn] = pawns;
  const [card] = sd.pileOf(engine);
  assert.equal(controller(engine, pawn), sd.H2);
  assert.equal(ready(engine, sd.H1), 6);
  giveIn(engine, pawn);
  assert.equal(ready(engine, sd.H1), 4, "COST: pay 2");
  assert.equal(controller(engine, pawn), sd.VILLAIN, "the Villain takes control of the character");
  assert.equal(engine.state.cards[pawn].ownerId, sd.H2, "ownership doesn't change");
  assert.equal(engine.state.cards[card].zone, "play", "the claimed card is in play");
  assert.equal(controller(engine, card), sd.H1, "under my control");
  assert.deepEqual(sd.pileOf(engine), [], "and out of the Temptation Pile");
});

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION claims ONE card: with two in the Temptation Pile I choose which and the other stays", () => {
  const { engine, pawns } = temptationTable({ pawns: 1, pile: 2 });
  const [first, second] = sd.pileOf(engine);
  giveIn(engine, pawns[0], second);
  assert.equal(controller(engine, second), sd.H1, "the one I chose");
  assert.deepEqual(sd.pileOf(engine), [first], "the other stays in the pile");
  assert.equal(engine.state.cards[first].zone, "table");
});

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION with an empty Temptation Pile still costs 2 and gives the Villain the character; there is just nothing to claim", () => {
  const { engine, pawns } = temptationTable({ pawns: 1, pile: 0 });
  assert.deepEqual(sd.pileOf(engine), []);
  giveIn(engine, pawns[0]);
  assert.equal(engine.state.pendingChoice, undefined, "nothing to choose");
  assert.equal(ready(engine, sd.H1), 4);
  assert.equal(controller(engine, pawns[0]), sd.VILLAIN);
});

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION can pick only a character ANOTHER Hero controls: not my own, not the Villain's, not a non-character", () => {
  const { engine, pawns } = temptationTable({ pawns: 1, pile: 1 });
  const mine = engine.state.players[sd.H1].hand[0];
  play(engine, sd.H1, mine);
  assert.equal(controller(engine, mine), sd.H1);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [mine] }), "my own character", /Illegal target/);
  const hero2Resource = engine.state.players[sd.H2].play.find((c) => engine.getDefinition(c).type === "resource")!;
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [hero2Resource] }), "another Hero's resource isn't a character", /Illegal target/);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [sd.factionOfPlayer(engine, sd.H2)] }), "nor is their faction", /Illegal target/);
  assert.equal(ready(engine, sd.H1), 6, "nothing was paid");
  assert.equal(sd.pileOf(engine).length, 1, "nothing was claimed");
  // The Villain's own character, once the Villain holds one, is not another Hero's either.
  giveIn(engine, pawns[0]);
  sd.advanceTo(engine, sd.H1);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [pawns[0]] }), "a character the Villain controls", /Illegal target/);
});

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION is refused when the 2 can't be paid", () => {
  const { engine, pawns } = temptationTable({ pawns: 1, pile: 1 });
  sd.useAbility(engine, sd.H1, sdIds.spring);
  assert.equal(ready(engine, sd.H1), 0);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [pawns[0]] }), "nothing left to pay with");
  assert.equal(controller(engine, pawns[0]), sd.H2);
});

clause(SLE, "1:ability", "GIVE IN TO TEMPTATION can be used only during my own turn, and only once per turn", () => {
  const { engine, pawns } = temptationTable({ pawns: 2, pile: 2 });
  giveIn(engine, pawns[0]);
  assert.equal(controller(engine, pawns[0]), sd.VILLAIN);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [pawns[1]] }), "once per turn", /each turn/i);
  assert.equal(controller(engine, pawns[1]), sd.H2);
  assert.equal(ready(engine, sd.H1), 4, "only one use was paid");
  // On the next Hero's turn I may not use it (it is not my turn) ...
  sd.advanceTo(engine, sd.H2);
  refused(() => sd.useAbility(engine, sd.H1, sdIds.give, { c: [pawns[1]] }), "not my turn", /timing/i);
  // ... and in a later turn of mine it is available again.
  sd.advanceTo(engine, sd.H1);
  giveIn(engine, pawns[1]);
  assert.equal(controller(engine, pawns[1]), sd.VILLAIN, "available again on my next turn");
});

// ---- 2:ability SPRING FORTH MY BURLY PROTECTOR! --------------------------------------------------

clause(SLE, "2:ability", "SPRING FORTH MY BURLY PROTECTOR!: pay 6, reveal the top card of the Hero deck and claim it (a character enters play under my control)", () => {
  const engine = sd.showdownGame({ heroes: 2, heroDeck: [sd.CHAMPION, sd.CHAMPION] });
  sd.advanceTo(engine, sd.H1);
  const [top, next] = sd.heroDeckOf(engine);
  assert.equal(ready(engine, sd.H1), 6);
  sd.useAbility(engine, sd.H1, sdIds.spring);
  const reveals = engine.getLog().flatMap((entry) => (entry.event?.type === "cardsRevealed" ? [entry.event] : []));
  assert.deepEqual(reveals.map((event) => event.cardIds), [[top]], "the top card of the Hero deck was revealed (to everyone), and only it");
  assert.equal(reveals[0].viewerId, "all");
  assert.equal(ready(engine, sd.H1), 0, "COST: pay 6");
  assert.equal(engine.state.cards[top].zone, "play", "the top card is in play");
  assert.equal(controller(engine, top), sd.H1, "under my control");
  assert.equal(engine.state.cards[top].ownerId, sd.H1, "and mine");
  assert.deepEqual(sd.heroDeckOf(engine), [next], "the Hero deck lost exactly its top card");
  assert.equal(engine.state.cards[next].zone, "table", "the next card is still face-down on the table");
});

clause(SLE, "2:ability", "SPRING FORTH MY BURLY PROTECTOR! claims a tactic as a free play; a Hero card leaves the game once it is done", () => {
  const engine = sd.showdownGame({ heroes: 2, heroDeck: [sd.BOON] });
  sd.advanceTo(engine, sd.H1);
  const [top] = sd.heroDeckOf(engine);
  sd.useAbility(engine, sd.H1, sdIds.spring);
  assert.equal(engine.state.pendingChoice?.kind, "deployForFree", "the claimed tactic is offered to me to play for free");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: sd.H1, choice: { kind: "deployForFree" } }),
    "a playable claimed tactic must be played (SD 9)",
    /must be played/
  );
  engine.perform({ type: "resolvePendingChoice", playerId: sd.H1, choice: { kind: "deployForFree", cardId: top } });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[top].zone, "removed", "removed from the game once it is done resolving");
  assert.deepEqual(sd.heroDeckOf(engine), []);
});

clause(SLE, "2:ability", "SPRING FORTH MY BURLY PROTECTOR! is refused when the 6 can't be paid and claims nothing; with the Hero deck empty it costs 6 and claims nothing", () => {
  const engine = sd.showdownGame({ heroes: 2, heroDeck: [sd.CHAMPION, sd.CHAMPION] });
  sd.advanceTo(engine, sd.H1);
  sd.useAbility(engine, sd.H1, sdIds.spring);
  const deck = [...sd.heroDeckOf(engine)];
  refused(() => sd.useAbility(engine, sd.H1, sdIds.spring), "no resources left");
  assert.deepEqual(sd.heroDeckOf(engine), deck, "nothing claimed");
  const empty = sd.showdownGame({ heroes: 2, heroDeck: [] });
  sd.advanceTo(empty, sd.H1);
  sd.useAbility(empty, sd.H1, sdIds.spring);
  assert.equal(ready(empty, sd.H1), 0, "the cost was paid");
  assert.equal(charactersIn(empty, sd.H1).length, 0, "and no card was claimed");
});

// ---- 3:ability TEAMWORK ---------------------------------------------------------------------------

/** Hero 1 (first player) has a Filler in play. */
function teamworkTable(heroes: 2 | 3 = 2) {
  const engine = sd.showdownGame({ heroes, first: sd.H1 });
  const pawn = engine.state.players[sd.H1].hand[0];
  play(engine, sd.H1, pawn);
  return { engine, pawn };
}
const teamwork = (engine: SpoilsEngine, card: CardInstanceId, player: PlayerId): void =>
  sd.useAbility(engine, sd.H1, sdIds.teamwork, { card: [card], player: [sd.factionOfPlayer(engine, player)] });

clause(SLE, "3:ability", "TEAMWORK: pay 2, pick a card I control, choose another player, who takes control of it", () => {
  const { engine, pawn } = teamworkTable();
  teamwork(engine, pawn, sd.H2);
  assert.equal(ready(engine, sd.H1), 4, "COST: pay 2");
  assert.equal(controller(engine, pawn), sd.H2, "the other player takes control of the card");
  assert.equal(engine.state.cards[pawn].ownerId, sd.H1, "ownership doesn't change");
  assert.ok(engine.state.players[sd.H2].play.includes(pawn), "it is in their play area");
});

clause(SLE, "3:ability", "TEAMWORK can choose any other player: a third Hero, or the Villain", () => {
  const { engine, pawn } = teamworkTable(3);
  teamwork(engine, pawn, sd.H3);
  assert.equal(controller(engine, pawn), sd.H3);
  const villain = teamworkTable();
  teamwork(villain.engine, villain.pawn, sd.VILLAIN);
  assert.equal(controller(villain.engine, villain.pawn), sd.VILLAIN, "the Villain is another player too");
});

clause(SLE, "3:ability", "TEAMWORK can give away any card I control, not only a character (a resource), and never the one I don't control", () => {
  const { engine } = teamworkTable();
  const resource = engine.state.players[sd.H1].play.find((c) => engine.getDefinition(c).type === "resource")!;
  teamwork(engine, resource, sd.H2);
  assert.equal(controller(engine, resource), sd.H2);
  const theirs = engine.state.players[sd.H2].play.find((c) => engine.getDefinition(c).type === "resource")!;
  const villainsResource = engine.state.players[sd.VILLAIN].play.find((c) => engine.getDefinition(c).type === "resource")!;
  refused(() => teamwork(engine, theirs, sd.H2), "another player's card", /Illegal target/);
  refused(() => teamwork(engine, villainsResource, sd.H2), "the Villain's card", /Illegal target/);
});

clause(SLE, "3:ability", "TEAMWORK must choose ANOTHER player: not myself, and the shared Alliance card is not a player", () => {
  const { engine, pawn } = teamworkTable();
  refused(() => teamwork(engine, pawn, sd.H1), "myself", /Illegal target/);
  refused(
    () => sd.useAbility(engine, sd.H1, sdIds.teamwork, { card: [pawn], player: [sd.sharedFaction(engine)] }),
    "the shared faction card",
    /Illegal target/
  );
  assert.equal(ready(engine, sd.H1), 6, "nothing was paid");
  assert.equal(controller(engine, pawn), sd.H1);
});

clause(SLE, "3:ability", "TEAMWORK is refused when the 2 can't be paid, and can be used again (no printed limit)", () => {
  const { engine, pawn } = teamworkTable();
  const resources = engine.state.players[sd.H1].play.filter((c) => engine.getDefinition(c).type === "resource");
  teamwork(engine, pawn, sd.H2);
  teamwork(engine, resources[0], sd.H2);
  assert.equal(ready(engine, sd.H1), 2, "4 paid in two uses");
  teamwork(engine, resources[1], sd.H2);
  assert.equal(ready(engine, sd.H1), 0);
  refused(() => teamwork(engine, resources[2], sd.H2), "nothing left to pay with");
  assert.equal(controller(engine, resources[2]), sd.H1);
});

// ---- 4:rule:YOUR TRUE COLORS ARE REVEALED ---------------------------------------------------------

clause(SLE, "4:rule:YOUR TRUE COLORS ARE REVEALED", "at the start of the Villain's turn a token is put on this card, and only then", () => {
  const engine = sd.showdownGame({ heroes: 2 });
  assert.equal(counters(engine).token, 1, "the Villain's first turn has started");
  sd.advanceTo(engine, sd.H1);
  assert.equal(counters(engine).token, 1, "not at the start of a Hero's turn");
  sd.advanceTo(engine, sd.H2);
  assert.equal(counters(engine).token, 1);
  sd.advanceTo(engine, sd.VILLAIN);
  assert.equal(counters(engine).token, 2, "the Villain's next turn");
  assert.equal(engine.state.cards[sd.factionOfPlayer(engine, sd.VILLAIN)].counters.token ?? 0, 0, "on this card, not on the Villain's faction");
});

clause(SLE, "4:rule:YOUR TRUE COLORS ARE REVEALED", "if there are 7 tokens on this card, all Heroes turn their Allegiance cards face-up (not before)", () => {
  const engine = sd.showdownGame({ heroes: 3 });
  const faceUp = () => Object.values(engine.state.showdown!.allegiance).map((card) => card.faceUp);
  assert.deepEqual(faceUp(), [false, false, false]);
  for (let tokens = 2; tokens <= 6; tokens++) {
    sd.advanceTo(engine, sd.VILLAIN);
    assert.equal(counters(engine).token, tokens);
    assert.deepEqual(faceUp(), [false, false, false], `${tokens} tokens: still hidden`);
  }
  sd.advanceTo(engine, sd.VILLAIN);
  assert.equal(counters(engine).token, 7);
  assert.deepEqual(faceUp(), [true, true, true], "7 tokens: every Hero's Allegiance card is face-up");
});

clause(SLE, "4:rule:YOUR TRUE COLORS ARE REVEALED", "a revealed Villain-loyal Hero must then pick another Hero as their opponent", () => {
  const engine = sd.showdownGame({ heroes: 2, allegiance: ["villain", "villain"] });
  assert.deepEqual(opponentsOf(engine.state, sd.H1), [sd.VILLAIN], "hidden: opposes the Villain");
  for (let tokens = 2; tokens <= 7; tokens++) sd.advanceTo(engine, sd.VILLAIN);
  assert.equal(getLoyalty(engine.state, sd.H1), "villain");
  assert.deepEqual(opponentsOf(engine.state, sd.H1), [sd.H2], "revealed: opposes the other Hero");
  assert.deepEqual(opponentsOf(engine.state, sd.H2), [sd.H1]);
});

exempt(SLE, "5:rule", "Reminder text only (\"See the included Showdown rules card for more details\"): it points at a physical rules card and prints no game behavior of its own.");
