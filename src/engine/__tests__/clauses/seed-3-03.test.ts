// Clause tests — batch seed-3-03 (the four Seed 3 "for fun" faction cards:
// The Society of Magical Propriety, The Knitting Coalition, The Open R&D
// Faction, The Union of Unextraordinary Miners). See docs/TESTING.md and
// `npm run card-tests -- manifest seed-3-03`. Expectations come from each
// card's PRINTED text and RULES.md (§3.6 Faction, §4 paying costs, §5 Setup,
// §6 Turn structure, §10 Abilities); engine data is only used to drive the engine.
//
// Two ways of building a game are used:
//   - `setup(...)` runs the REAL setup path (`createFactionGame`) with
//     the faction printing under test, for STARTING RESOURCES / STARTING DRAW.
//   - `buildGame(...)` places a mid-game board directly, for the turn rules
//     (RESTORE / DEVELOP) and the faction's printed abilities.

import assert from "node:assert/strict";
import { createFactionGame, CREATED_ABILITY_ID } from "../../../engine.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  P1,
  P2,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "../per-card/_harness.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";
import { settleTurnStart, openDevelop } from "../support/develop.js";
import { developDraw, developOffers, developResource, endTurn, endTurnRaw, factionOf, pickDevelopDraw, pickDevelopResource, orderUntilDevelop, developDrawLeft } from "./_turn.js";
import { clause, clauseMismatch, exempt, printing, refused, holdResourceFace } from "./_clause.js";

// --- the four printings ----------------------------------------------------

const SOCIETY = "ce1ccf05-7a09-4363-b3b2-67d3d28b1973";
const KNITTING = "c58d0e3c-4f76-4665-aca4-2ba01a42d863";
const RND = "ebef8b79-0dcb-401f-81e9-eafd9235fd7d";
const MINERS = "71038369-24cc-48d9-a58c-e658edc01944";

// --- shared cards ----------------------------------------------------------

// The real staple resources (the card text names Greed / Deception).
const RAGE = printing("3be26b3f-2c78-4d0c-8849-0b4ca48951fd");
const GREED = printing("61766da9-6482-4ecb-8306-becda47294ec");
const DECEPTION = printing("ebcdd443-efdf-4a16-a0b9-b1307cd13d0b");
const ELITISM = printing("b4ddcf43-e508-4a11-9953-697acdcaf116");
// A resource card that is NOT a staple.
const ODD = resourceCard({ id: "s303-odd", name: "Odd Resource", resource: { provides: ["elitism"], staple: false } });
const FILLER = character({ id: "s303-filler", name: "Filler" });

const repeat = (def: CardDefinition, n: number): CardDefinition[] => Array.from({ length: n }, () => def);

// A plain opponent: 2 staples, 7 going first / 8 going second, a normal Develop Rule.
const PLAIN_OPP = factionCard({
  id: "s303-plain-opp",
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

// --- real-setup helpers ----------------------------------------------------

interface Seat {
  faction: CardDefinition;
  deck: CardDefinition[];
}

interface SetupOptions {
  first?: PlayerId;
  x?: Record<PlayerId, number>;
  choose?: boolean;
}

function setup(p1: Seat, p2: Seat, options: SetupOptions = {}): SpoilsEngine {
  const defs = new Map<string, CardDefinition>();
  for (const def of [p1.faction, p2.faction, ...p1.deck, ...p2.deck]) defs.set(def.id, def);
  return createFactionGame(
    [...defs.values()],
    [{ id: P1, name: "Alice", deckDefinitionIds: [p1.faction.id, ...p1.deck.map((d) => d.id)] },
    { id: P2, name: "Bob", deckDefinitionIds: [p2.faction.id, ...p2.deck.map((d) => d.id)] }],
    { firstPlayerId: options.first ?? P1, seed: 7, startingResourceX: options.x, chooseStartingResources: options.choose }
  );
}

const playCards = (engine: SpoilsEngine, pid: PlayerId): CardInstanceId[] =>
  engine.state.players[pid].play.filter((id) => engine.getDefinition(id).type !== "faction");
const namesIn = (engine: SpoilsEngine, ids: CardInstanceId[]): string[] => ids.map((id) => engine.getDefinition(id).name).sort();
const handSize = (engine: SpoilsEngine, pid: PlayerId): number => engine.state.players[pid].hand.length;

// --- board helpers ---------------------------------------------------------

const attachedCount = (engine: SpoilsEngine, pid: PlayerId): number =>
  engine.state.players[pid].play.filter(
    (id) => engine.isResource(id) && engine.state.cards[id].attachedTo === engine.state.players[pid].factionId
  ).length;
const readyCount = (engine: SpoilsEngine, pid: PlayerId): number => engine.getAvailableResourceCount(pid);

/** `n` rage resources for `owner`, already attached to `owner`'s faction (spent). */
function spent(owner: PlayerId, n: number): CardPlacement[] {
  return bank("rage", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

function topOfDeck(label: string, owner: PlayerId = P1): CardPlacement[] {
  return Array.from({ length: 4 }, (_, i) => ({
    key: `${label}${i}`,
    def: character({ name: `${label} ${i}` }),
    owner,
    zone: "deck" as const
  }));
}

// =============================================================================
// Shared clause bodies. The four factions print the same RESTORE RULE and
// (three of them) the same DEVELOP RULE and DRAW / RESOURCE shapes, so each
// group calls the same checks with its own printing.
// =============================================================================

// ---- RESTORE RULE ----------------------------------------------------------
// "At the start of your turn, restore all your depleted cards and detach all
// resources from your faction."

function restoreBoard(faction: CardDefinition, active: PlayerId) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      { key: "mineItem", def: item({ name: "My Depleted Item" }), owner: P1, depleted: true },
      { key: "mineReady", def: character({ name: "My Ready Character" }), owner: P1 },
      ...spent(P1, 3),
      ...volition(1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })),
      ...bank("greed", 2, P1), // not attached: stays that way
      { key: "theirChar", def: character({ name: "Their Depleted Character" }), owner: P2, depleted: true },
      { key: "theirItem", def: item({ name: "Their Depleted Item" }), owner: P2, depleted: true },
      // control differs from ownership: "your depleted cards" are the ones YOU control
      { key: "stolenIn", def: character({ name: "Stolen In" }), owner: P2, controller: P1, depleted: true },
      { key: "stolenOut", def: character({ name: "Stolen Out" }), owner: P1, controller: P2, depleted: true },
      ...spent(P2, 2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2)
    ]
  });
}

function restoreAtMyTurnStart(faction: CardDefinition): void {
  const { engine, id } = restoreBoard(faction, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "3 rage + 1 face-down resource are attached before my turn");

  endTurn(engine, P2); // my (P1's) turn starts

  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "my depleted character is restored");
  assert.equal(engine.state.cards[id("mineItem")].depleted, false, "my depleted item is restored");
  assert.equal(engine.state.cards[id("mineReady")].depleted, false);
  assert.equal(engine.state.cards[id("stolenIn")].depleted, false, "a depleted card I control (owned by the opponent) is mine to restore");
  assert.equal(attachedCount(engine, P1), 0, "every resource is detached from my faction (face-up and face-down)");
  assert.equal(readyCount(engine, P1), 6, "all six of my resources are ready again");
}

function restoreLeavesOpponentAlone(faction: CardDefinition): void {
  const { engine, id } = restoreBoard(faction, P2);
  endTurn(engine, P2); // my turn starts
  assert.equal(engine.state.cards[id("theirChar")].depleted, true, "'your depleted cards' — the opponent's character stays depleted");
  assert.equal(engine.state.cards[id("theirItem")].depleted, true, "the opponent's item stays depleted");
  assert.equal(engine.state.cards[id("stolenOut")].depleted, true, "a card I own but the opponent controls is not 'my' card to restore");
  assert.equal(attachedCount(engine, P2), 2, "'your faction' — the opponent's resources stay attached");
}

function restoreOnlyAtMyTurnStart(faction: CardDefinition): void {
  const { engine, id } = restoreBoard(faction, P1);
  endTurn(engine, P1); // the OPPONENT's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("mineChar")].depleted, true, "my depleted character does not restore at the opponent's turn start");
  assert.equal(engine.state.cards[id("mineItem")].depleted, true);
  assert.equal(attachedCount(engine, P1), 4, "my resources stay attached at the opponent's turn start");
  assert.equal(engine.state.cards[id("stolenIn")].depleted, true, "nor a card the opponent owns but I control");
  // ... and the opponent's own (different) restore rule did run for them.
  assert.equal(engine.state.cards[id("theirChar")].depleted, false);
  assert.equal(engine.state.cards[id("stolenOut")].depleted, false, "(the opponent controls this one)");
  assert.equal(attachedCount(engine, P2), 0);
}

// ---- DEVELOP RULE ----------------------------------------------------------
// "At the start of your turn, draw a card or play a resource."

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

function developDrawWorks(faction: CardDefinition): void {
  const { engine, id } = developBoard(faction);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  const theirHand = handSize(engine, P2);
  assert.ok(developOffers(engine, P1).includes("Draw 1 card"), "the Develop Rule offers a draw");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), handBefore + 1, "drew exactly one card");
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand", "the top card of my deck is the one drawn");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1), "only the top card left the deck");
  assert.equal(handSize(engine, P2), theirHand, "the opponent draws nothing");
  assert.equal(playCards(engine, P1).length, 0, "no resource was played");
}

function developResourceWorks(faction: CardDefinition): void {
  const { engine, id } = developBoard(faction);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  developResource(engine, P1, id("handRes"), false);
  assert.equal(engine.state.cards[id("handRes")].zone, "play", "the resource is now in play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "played face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "and it provides its icon");
  assert.equal(handSize(engine, P1), handBefore - 1, "one card left my hand");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "no card was drawn");
  assert.equal(engine.state.cards[id("handRes2")].zone, "hand", "only one resource is played");
}

function developFaceDownWorks(faction: CardDefinition): void {
  const { engine, id } = developBoard(faction);
  // Any card may be played face-down as a resource (RULES.md §3.5) ...
  developResource(engine, P1, id("handChar"), true);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true);
  assert.equal(engine.getThresholds(P1).volition, 1, "a face-down resource provides one Volition");
  // ... including an actual resource card: face-down it gives Volition instead of its own icon.
  const real = developBoard(faction);
  developResource(real.engine, P1, real.id("handRes"), true);
  assert.equal(real.engine.state.cards[real.id("handRes")].zone, "play");
  assert.equal(real.engine.state.cards[real.id("handRes")].faceDown, true);
  assert.equal(real.engine.getThresholds(P1).volition, 1);
  assert.equal(real.engine.getThresholds(P1).greed ?? 0, 0, "face-down, it no longer provides its Greed");
}

function developFaceUpNonResourceRefused(faction: CardDefinition): void {
  const { engine, id } = developBoard(faction);
  // ... but only an actual resource card may be played face-up: a non-resource card is never offered the face-up
  // choice, it enters face-down.
  developResource(engine, P1, id("handChar"), false);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "only an actual resource card may be played face-up");
  const control = developBoard(faction);
  developResource(control.engine, P1, control.id("handRes"), false);
  assert.equal(control.engine.state.cards[control.id("handRes")].faceDown, false, "an actual resource card can be played face-up");
}

function developIsOneOrTheOther(faction: CardDefinition): void {
  // draw first -> can't also play a resource
  {
    const { engine, id } = developBoard(faction);
    developDraw(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "the draw was the Develop Rule: nothing more is offered");
    assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  }
  // play a resource first -> can't also draw
  {
    const { engine, id } = developBoard(faction);
    const deckBefore = [...engine.state.players[P1].deck];
    developResource(engine, P1, id("handRes"), false);
    assert.equal(engine.state.pendingChoice, undefined, "the resource play was the Develop Rule: nothing more is offered");
    assert.deepEqual(engine.state.players[P1].deck, deckBefore);
  }
}

function developOncePerTurn(faction: CardDefinition): void {
  {
    const { engine } = developBoard(faction);
    developDraw(engine, P1);
    const hand = handSize(engine, P1);
    assert.equal(engine.state.pendingChoice, undefined, "a second draw is not offered");
    assert.equal(handSize(engine, P1), hand);
  }
  {
    const { engine, id } = developBoard(faction);
    developResource(engine, P1, id("handRes"), false);
    assert.equal(engine.state.pendingChoice, undefined, "a second resource play is not offered");
    assert.equal(engine.state.cards[id("handRes2")].zone, "hand");
  }
}

/** The Develop Rule is a start-of-MY-turn trigger: the opponent's turn start offers it to the opponent only. */
function developOnlyOnMyTurn(faction: CardDefinition): void {
  const { engine, id } = developBoard(faction);
  const hand = handSize(engine, P1);
  endTurnRaw(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  const pending = engine.state.pendingChoice as unknown as { playerId: PlayerId; kind: string };
  assert.equal(pending.kind, "orderTriggers");
  assert.equal(pending.playerId, P2, "only the player whose turn it is gets a Develop Rule to use");
  settleTurnStart(engine, "draw");
  assert.equal(handSize(engine, P1), hand, "I drew nothing at the opponent's turn start");
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
}

/** The Society's "you may put a token on this card" is offered at the start of my turn: say no (it is not what these tests are about). */
function declineStartOfTurnMay(engine: SpoilsEngine): void {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  if (pc?.kind === "mayPay") {
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay: false } } as never);
    resolvePendingResponses(engine);
  }
}

function developIsOptionalAndRenews(faction: CardDefinition): void {
  const { engine } = developBoard(faction);
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  endTurn(engine, P2); // I skipped my Develop Rule entirely
  declineStartOfTurnMay(engine);
  assert.equal(handSize(engine, P1), hand, "skipping it costs nothing and gives nothing");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  declineStartOfTurnMay(engine);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(handSize(engine, P1), hand + 1, "the Develop Rule is available again on my next turn");
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  settleTurnStart(engine, "draw");
  declineStartOfTurnMay(engine);
  assert.equal(handSize(engine, P1), hand + 2, "and renews every turn");
}

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

function activateFaction(engine: SpoilsEngine, pid: PlayerId, abilityId: string, owner: PlayerId = pid): void {
  engine.perform({
    type: "activateAbility",
    playerId: pid,
    cardId: factionOf(engine, owner),
    abilityId,
    selected: {},
    variables: {}
  });
  resolvePendingResponses(engine);
}

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

function drawAbilityPaysAndDraws(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 2);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  assert.equal(readyCount(engine, P1), cost + 2);
  activateFaction(engine, P1, abilityId);
  assert.equal(readyCount(engine, P1), 2, `exactly ${cost} resources were paid`);
  assert.equal(attachedCount(engine, P1), cost, "paid resources are attached to the faction");
  assert.equal(handSize(engine, P1), handBefore + 1, "drew one card");
  assert.equal(engine.state.cards[id("mydeck0")].zone, "hand", "the top card of my deck");
  assert.deepEqual(engine.state.players[P1].deck, deckBefore.slice(1));
  assert.equal(handSize(engine, P2), 1, "the opponent drew nothing");
  assert.equal(engine.state.cards[factionOf(engine, P1)].depleted, false, "the faction isn't depleted by it");
}

function drawAbilityUnaffordable(faction: CardDefinition, abilityId: string, cost: number): void {
  // one short
  {
    const { engine } = abilityBoard(faction, cost - 1);
    const handBefore = handSize(engine, P1);
    assert.throws(() => activateFaction(engine, P1, abilityId), /cannot be paid/);
    assert.equal(handSize(engine, P1), handBefore, "nothing is drawn");
    assert.equal(attachedCount(engine, P1), 0, "nothing was half-paid");
    assert.equal(readyCount(engine, P1), cost - 1);
  }
  // enough resources, but some already spent (attached) this turn
  {
    const { engine } = abilityBoard(faction, cost + 1);
    const first = engine.getAvailableResourceIds(P1);
    for (const rid of first.slice(0, 2)) engine.state.cards[rid].attachedTo = factionOf(engine, P1);
    // cost+1 resources, 2 already spent -> cost-1 left
    assert.equal(readyCount(engine, P1), cost - 1);
    assert.throws(() => activateFaction(engine, P1, abilityId), /cannot be paid/);
  }
  // nothing at all
  {
    const { engine } = abilityBoard(faction, 0);
    assert.throws(() => activateFaction(engine, P1, abilityId), /cannot be paid/);
  }
}

function drawAbilityRepeatable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine } = abilityBoard(faction, cost * 2 + 1);
  const handBefore = handSize(engine, P1);
  activateFaction(engine, P1, abilityId);
  activateFaction(engine, P1, abilityId);
  assert.equal(handSize(engine, P1), handBefore + 2, "no once-per-turn limit is printed, so it can be used again");
  assert.equal(attachedCount(engine, P1), cost * 2);
  assert.equal(readyCount(engine, P1), 1);
}

function drawAbilityIsSeparateFromDevelop(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine } = abilityBoard(faction, cost);
  const base = handSize(engine, P1);
  activateFaction(engine, P1, abilityId);
  assert.ok(developOffers(engine, P1).length > 0, "using the ability doesn't use up the Develop Rule");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), base + 2, "ability draw + develop draw");
  // and the other way round: after a develop the ability is still usable
  const b = abilityBoard(faction, cost);
  developDraw(b.engine, P1);
  developDrawLeft(b.engine, P1); // (the Miners' OVERTIME offers a second use, which cannot be skipped: it draws too)
  activateFaction(b.engine, P1, abilityId);
  const draws = faction.faction?.turn.develop.usesPerTurn ?? 1;
  assert.equal(handSize(b.engine, P1), base + 1 + draws, "the ability's draw and every draw the Develop Rule made");
}

function drawAbilityControllerOnly(faction: CardDefinition, abilityId: string): void {
  const { engine } = buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...bank("rage", 6, P2), ...bank("rage", 6, P1), ...topOfDeck("theirdeck", P2)]
  });
  const theirHand = handSize(engine, P2);
  assert.throws(() => activateFaction(engine, P2, abilityId, P1), /do not control/i);
  assert.equal(handSize(engine, P2), theirHand, "the opponent cannot use my faction's ability");
  assert.equal(attachedCount(engine, P2), 0);
}

function resourceAbilityPaysAndPlays(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 2);
  const handBefore = handSize(engine, P1);
  const deckBefore = [...engine.state.players[P1].deck];
  activateFaction(engine, P1, abilityId);
  assert.equal(attachedCount(engine, P1), cost, `exactly ${cost} resources were paid`);
  pickFromHand(engine, P1, id("handRes"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play", "the resource was played");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false, "an actual resource card goes in face-up");
  assert.equal(engine.getThresholds(P1).greed, 1, "providing its icon");
  assert.equal(handSize(engine, P1), handBefore - 1);
  assert.deepEqual(engine.state.players[P1].deck, deckBefore, "nothing was drawn");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand", "only the chosen card was played");
  assert.equal(readyCount(engine, P1), cost + 2 - cost + 1, "the new resource is ready to pay for things");
}

function resourceAbilityFaceDown(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost);
  activateFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handChar")].zone, "play", "any card can be played as a resource");
  assert.equal(engine.state.cards[id("handChar")].faceDown, true, "a non-resource goes in face-down");
  assert.equal(engine.getThresholds(P1).volition, 1);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand");
}

function resourceAbilityRealResourceFaceDown(faction: CardDefinition, abilityId: string, cost: number): void {
  holdResourceFace(() => {
  // "Play a resource": when you play a resource you choose face-up or face-down, and ANY card may go in face-down
  // (RULES.md §3.5, CR §203.2) -- including an actual resource card, which then gives Volition instead of its icon.
  const { engine, id } = abilityBoard(faction, cost);
  activateFaction(engine, P1, abilityId);
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

function resourceAbilityOnlyOwnHand(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost);
  activateFaction(engine, P1, abilityId);
  assert.throws(
    () =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [id("theirHand")] }
      } as never),
    /Illegal target/
  );
  assert.equal(engine.state.cards[id("theirHand")].zone, "hand", "the opponent's hand card isn't a legal pick");
  // a card from my deck isn't either (it has to come from my hand)
  assert.throws(
    () =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [id("mydeck0")] }
      } as never),
    /Illegal target/
  );
}

function resourceAbilityUnaffordable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost - 1);
  assert.throws(() => activateFaction(engine, P1, abilityId), /cannot be paid/);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand", "no resource was played");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(readyCount(engine, P1), cost - 1);
  const none = abilityBoard(faction, 0);
  assert.throws(() => activateFaction(none.engine, P1, abilityId), /cannot be paid/);
}

function resourceAbilityRepeatable(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost * 2);
  activateFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handRes"));
  // the new resource (1 ready) + the leftovers (cost) can pay again
  activateFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handChar"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
  assert.equal(attachedCount(engine, P1), cost * 2, "no once-per-turn limit is printed");
}

/** "Play a resource" is not a "may" (SYS-20): with a card in hand, choosing nothing is refused; choosing a card works. */
function resourceAbilityMandatory(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 1);
  activateFaction(engine, P1, abilityId);
  assert.equal(attachedCount(engine, P1), cost, `the ${cost} was paid`);
  assert.ok(handSize(engine, P1) >= 2, "cards in hand to play");
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never),
    "must play a resource when there is a card in hand to play",
    /select|choose|must|required|exactly/i
  );
  pickFromHand(engine, P1, id("handRes"));
  assert.equal(engine.state.cards[id("handRes")].zone, "play", "choosing a card works");
}

function resourceAbilityIsSeparateFromDevelop(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost);
  activateFaction(engine, P1, abilityId);
  pickFromHand(engine, P1, id("handRes"));
  assert.ok(developOffers(engine, P1).length > 0, "the ability's resource play isn't the Develop Rule's");
  developResource(engine, P1, id("handChar"), true);
  assert.equal(engine.state.cards[id("handChar")].zone, "play");
}

function resourceAbilityControllerOnly(faction: CardDefinition, abilityId: string): void {
  const { engine, id } = buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", 8, P2),
      { key: "theirHand", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" }
    ]
  });
  assert.throws(() => activateFaction(engine, P2, abilityId, P1), /do not control/i);
  assert.equal(engine.state.cards[id("theirHand")].zone, "hand");
  assert.equal(attachedCount(engine, P2), 0);
}

// =============================================================================
// The Society of Magical Propriety
// =============================================================================

exempt(SOCIETY, "0:rule", "Tournament legality is a format rule outside the game engine (nothing in a played game changes); the engine has no format layer.");
exempt(SOCIETY, "3:rule:MINIMUM DECK SIZE", "A deck-construction rule (a 300-card minimum); the engine builds games from whatever deck it is handed and has no deck-legality check to test.");

// --- STARTING RESOURCES: "Any 1 resource, Any 1 card (if it's not a resource, put it into play face-down.)"

clause(SOCIETY, "1:rule:STARTING RESOURCES", "starts with one resource and one other card in play; a non-resource 'any card' is face-down (Volition), the resource face-up", () => {
  const engine = setup(
    { faction: printing(SOCIETY), deck: [GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting cards: 1 resource + 1 card");
  const resource = mine.find((id) => engine.getDefinition(id).type === "resource");
  const other = mine.find((id) => engine.getDefinition(id).type !== "resource");
  assert.ok(resource, "one of them is a resource card");
  assert.ok(other, "and the other is the non-resource 'any card'");
  assert.equal(engine.getDefinition(resource).name, "Greed");
  assert.equal(engine.state.cards[resource].faceDown, false, "the resource is face-up (flipped up after setup)");
  assert.equal(engine.state.cards[other].faceDown, true, "'if it's not a resource, put it into play face-down'");
  assert.equal(engine.getThresholds(P1).greed, 1);
  assert.equal(engine.getThresholds(P1).volition, 1, "the face-down card provides Volition");
  assert.equal(readyCount(engine, P1), 2, "both count as resources I can pay with");
  assert.equal(playCards(engine, P2).length, 2, "the opponent still starts with their own two staples");
});

clause(SOCIETY, "1:rule:STARTING RESOURCES", "an 'any card' that IS a resource is put into play face-up, not face-down", () => {
  // A deck made only of resource cards: both picks are necessarily resources.
  const engine = setup(
    { faction: printing(SOCIETY), deck: [GREED, RAGE, ...repeat(DECEPTION, 20), ...repeat(ELITISM, 20)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2);
  for (const id of mine) {
    assert.equal(engine.getDefinition(id).type, "resource");
    assert.equal(engine.state.cards[id].faceDown, false, "a resource card is never put in face-down by this rule");
  }
  assert.equal(engine.getThresholds(P1).volition ?? 0, 0);
});

clause(SOCIETY, "1:rule:STARTING RESOURCES", "'Any 1 resource' is any resource card, not only a staple", () => {
  const engine = setup(
    { faction: printing(SOCIETY), deck: [ODD, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2);
  const odd = mine.find((id) => engine.getDefinition(id).name === "Odd Resource");
  assert.ok(odd, "the non-staple resource is a legal starting resource");
  assert.equal(engine.state.cards[odd].faceDown, false);
  assert.equal(engine.getThresholds(P1).elitism, 1);
});

clause(SOCIETY, "1:rule:STARTING RESOURCES", "the starting cards come out of the deck (they are not extra)", () => {
  const deck = [GREED, ...repeat(FILLER, 40)];
  const engine = setup({ faction: printing(SOCIETY), deck }, { faction: PLAIN_OPP, deck: plainOppDeck() });
  // 41 deck cards - 2 starting cards - 10 opening hand
  assert.equal(engine.state.players[P1].deck.length, 41 - 2 - 10);
  assert.equal(handSize(engine, P1), 10);
});

clause(SOCIETY, "1:rule:STARTING RESOURCES", "'Any' — the player chooses which resource and which card to start with", () => {
  // Two different resources and plenty of other cards: a real choice exists, so
  // setup (with the choose-starting-resources phase on) must hand it to P1.
  const engine = setup(
    { faction: printing(SOCIETY), deck: [GREED, RAGE, DECEPTION, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "P1 is asked which resource and which card to start with");
  const setupState = engine.state.setup as { order?: PlayerId[] };
  assert.ok(setupState.order?.includes(P1), "setupState.order?.includes(P1)");
});

// --- STARTING DRAW: "10 going first, 9 going second"

const societySeat = (): Seat => ({ faction: printing(SOCIETY), deck: [GREED, ...repeat(FILLER, 40)] });

clause(SOCIETY, "2:rule:STARTING DRAW", "draws 10 cards going first", () => {
  const engine = setup(societySeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  assert.equal(handSize(engine, P1), 10);
});

clause(SOCIETY, "2:rule:STARTING DRAW", "draws 9 cards going second", () => {
  const engine = setup(societySeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 });
  assert.equal(handSize(engine, P1), 9);
});

clause(SOCIETY, "2:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  assert.equal(handSize(setup(societySeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8, "opponent going second");
  assert.equal(handSize(setup(societySeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7, "opponent going first");
});

// --- RESTORE RULE

clause(SOCIETY, "4:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", () => {
  restoreAtMyTurnStart(printing(SOCIETY));
});
clause(SOCIETY, "4:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  restoreLeavesOpponentAlone(printing(SOCIETY));
});
clause(SOCIETY, "4:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  restoreOnlyAtMyTurnStart(printing(SOCIETY));
});

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource. You may put a token on this card."

clause(SOCIETY, "5:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", () => {
  developDrawWorks(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", () => {
  developResourceWorks(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition)", () => {
  developFaceDownWorks(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  developFaceUpNonResourceRefused(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "draw OR play a resource: not both", () => {
  developIsOneOrTheOther(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "can be used only once per turn", () => {
  developOncePerTurn(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "can be used only on my own turn", () => {
  developOnlyOnMyTurn(printing(SOCIETY));
});
clause(SOCIETY, "5:rule:DEVELOP RULE", "is optional and available again every turn", () => {
  developIsOptionalAndRenews(printing(SOCIETY));
});

function societyTokens(engine: SpoilsEngine): number {
  return engine.state.cards[factionOf(engine, P1)].counters.token ?? 0;
}

/** Starts P1's turn (P2 ends theirs); answers an offered token decision if the engine asks one. */
function startMyTurn(engine: SpoilsEngine, putToken: boolean): void {
  endTurn(engine, P2);
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;
  if (pc) {
    assert.equal(pc.playerId, P1, "the faction's controller decides");
    const choice =
      pc.kind === "mayPay" ? { kind: "mayPay", pay: putToken } : pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: putToken ? 0 : 1 } : { kind: pc.kind };
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice } as never);
    resolvePendingResponses(engine);
  }
}

function tokenBoard() {
  return buildGame({
    playerA: { faction: printing(SOCIETY) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2)]
  });
}

clause(SOCIETY, "5:rule:DEVELOP RULE", "I may put a token on this card at the start of my turn (accepting puts exactly one)", () => {
  const { engine } = tokenBoard();
  assert.equal(societyTokens(engine), 0);
  startMyTurn(engine, true);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(societyTokens(engine), 1, "one token on the Society");
  const stray = Object.values(engine.state.cards).filter((c) => c.id !== factionOf(engine, P1) && (c.counters.token ?? 0) > 0);
  assert.equal(stray.length, 0, "the token goes on this card and nowhere else");
  endTurn(engine, P1); // the opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(societyTokens(engine), 1, "no token is put on at the opponent's turn start");
});

clause(SOCIETY, "5:rule:DEVELOP RULE", "tokens accumulate: one more each of my turns (accepting)", () => {
  const { engine } = tokenBoard();
  startMyTurn(engine, true);
  endTurn(engine, P1);
  startMyTurn(engine, true);
  assert.equal(societyTokens(engine), 2);
});

clause(SOCIETY, "5:rule:DEVELOP RULE", "'You MAY put a token' — I can decline, and then no token is put on", () => {
  const { engine } = tokenBoard();
  startMyTurn(engine, false);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(societyTokens(engine), 0, "declined: no token");
});

clause(SOCIETY, "5:rule:DEVELOP RULE", "no token is put on at the start of the opponent's turn", () => {
  const { engine } = tokenBoard();
  engine.state.activePlayerId = P1;
  engine.state.priorityPlayerId = P1;
  endTurn(engine, P1); // opponent's turn starts
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(societyTokens(engine), 0);
});

// --- DRAW: "Pay 3. Draw a card."
clause(SOCIETY, "6:ability", "pays exactly 3 resources and draws one card", () => {
  drawAbilityPaysAndDraws(printing(SOCIETY), "society-draw", 3);
});
clause(SOCIETY, "6:ability", "is refused when the 3 can't be paid (2 resources, 3 with 2 already spent, none)", () => {
  drawAbilityUnaffordable(printing(SOCIETY), "society-draw", 3);
});
clause(SOCIETY, "6:ability", "can be used again the same turn", () => {
  drawAbilityRepeatable(printing(SOCIETY), "society-draw", 3);
});
clause(SOCIETY, "6:ability", "is separate from the Develop Rule", () => {
  drawAbilityIsSeparateFromDevelop(printing(SOCIETY), "society-draw", 3);
});
clause(SOCIETY, "6:ability", "only its controller can use it", () => {
  drawAbilityControllerOnly(printing(SOCIETY), "society-draw");
});

// --- RESOURCE: "Pay 3. Play a resource."
clause(SOCIETY, "7:ability", "pays exactly 3 resources and plays a resource card from my hand face-up", () => {
  resourceAbilityPaysAndPlays(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "plays a non-resource card face-down as a resource", () => {
  resourceAbilityFaceDown(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "the card must come from my own hand", () => {
  resourceAbilityOnlyOwnHand(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "is refused when the 3 can't be paid", () => {
  resourceAbilityUnaffordable(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "can be used again the same turn", () => {
  resourceAbilityRepeatable(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "'Play a resource' is mandatory when I have cards in hand: choosing nothing is refused", () => {
  resourceAbilityMandatory(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "is separate from the Develop Rule", () => {
  resourceAbilityIsSeparateFromDevelop(printing(SOCIETY), "society-resource", 3);
});
clause(SOCIETY, "7:ability", "only its controller can use it", () => {
  resourceAbilityControllerOnly(printing(SOCIETY), "society-resource");
});

// --- ENCYCLOPEDIC KNOWLEDGE [O][O]: "Remove 3 tokens from this card. Search your deck for a tactic and reveal it. Put it into your hand."

const ENCYCLOPEDIC = "society-encyclopedic";
const TUTOR_A = tactic({ id: "s303-tutor-a", name: "Tutor Target A" });
const TUTOR_B = tactic({ id: "s303-tutor-b", name: "Tutor Target B" });

function encyclopedicBoard(options: { tokens: number; obsession?: number; others?: CardPlacement[]; tacticsInDeck?: boolean }) {
  const tacticsInDeck = options.tacticsInDeck ?? true;
  const built = buildGame({
    playerA: { faction: printing(SOCIETY) },
    playerB: { faction: developFaction() },
    random: () => 0,
    cards: [
      ...bank("obsession", options.obsession ?? 2, P1),
      { key: "c0", def: character({ name: "Deck Character 0" }), owner: P1, zone: "deck" },
      ...(tacticsInDeck ? [{ key: "tA", def: TUTOR_A, owner: P1, zone: "deck" as const }] : []),
      { key: "c1", def: character({ name: "Deck Character 1" }), owner: P1, zone: "deck" },
      ...(tacticsInDeck ? [{ key: "tB", def: TUTOR_B, owner: P1, zone: "deck" as const }] : []),
      { key: "c2", def: character({ name: "Deck Character 2" }), owner: P1, zone: "deck" },
      { key: "c3", def: character({ name: "Deck Character 3" }), owner: P1, zone: "deck" },
      { key: "c4", def: character({ name: "Deck Character 4" }), owner: P1, zone: "deck" },
      { key: "handTactic", def: tactic({ name: "Tactic In Hand" }), owner: P1, zone: "hand" },
      { key: "discardTactic", def: tactic({ name: "Tactic In Discard" }), owner: P1, zone: "discard" },
      { key: "theirTactic", def: tactic({ name: "Their Deck Tactic" }), owner: P2, zone: "deck" },
      { key: "theirChar", def: character({ name: "Their Deck Character" }), owner: P2, zone: "deck" },
      ...(options.others ?? [])
    ]
  });
  built.engine.state.cards[factionOf(built.engine, P1)].counters = { token: options.tokens };
  return built;
}

const tokensOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].counters.token ?? 0;

function useEncyclopedic(engine: SpoilsEngine): void {
  engine.perform({ type: "activateAbility", playerId: P1, cardId: factionOf(engine, P1), abilityId: ENCYCLOPEDIC, selected: {}, variables: {} });
  resolvePendingResponses(engine);
}

function pickSearch(engine: SpoilsEngine, selected: CardInstanceId[]): void {
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
}

const revealEvents = (engine: SpoilsEngine): { cardIds: string[]; viewerId: string }[] =>
  engine.getLog().flatMap((entry) => {
    const event = entry.event as unknown as { type: string; cardIds: string[]; viewerId: string } | undefined;
    return event?.type === "cardsRevealed" ? [{ cardIds: event.cardIds, viewerId: event.viewerId }] : [];
  });

clause(SOCIETY, "8:ability", "removes 3 tokens from this card and puts a searched-for tactic from my deck into my hand", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  const handBefore = handSize(engine, P1);
  useEncyclopedic(engine);
  assert.equal(tokensOn(engine, factionOf(engine, P1)), 0, "COST: 3 tokens removed from the Society");
  pickSearch(engine, [id("tA")]);
  assert.equal(engine.state.cards[id("tA")].zone, "hand", "the tactic is in my hand");
  assert.equal(handSize(engine, P1), handBefore + 1);
  assert.ok(!engine.state.players[P1].deck.includes(id("tA")), "and out of the deck");
  assert.equal(engine.state.cards[id("tB")].zone, "deck", "the other tactic stays in the deck");
  assert.equal(engine.state.cards[id("c0")].zone, "deck", "no other card moves");
  assert.equal(engine.state.players[P1].deck.length, 6, "7 deck cards minus the tactic");
});

clause(SOCIETY, "8:ability", "either tactic in the deck can be the one found", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  useEncyclopedic(engine);
  pickSearch(engine, [id("tB")]);
  assert.equal(engine.state.cards[id("tB")].zone, "hand");
  assert.equal(engine.state.cards[id("tA")].zone, "deck");
});

clause(SOCIETY, "8:ability", "reveals the tactic it finds (to everyone) as it puts it into my hand", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  useEncyclopedic(engine);
  assert.equal(revealEvents(engine).length, 0, "nothing is revealed until a tactic is picked");
  pickSearch(engine, [id("tA")]);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "exactly one reveal");
  assert.deepEqual(reveals[0].cardIds, [id("tA")], "the tactic found, and only it");
  assert.equal(reveals[0].viewerId, "all", "revealed to both players");
});

clause(SOCIETY, "8:ability", "removes exactly 3 tokens, however many are on the card (5 -> 2)", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 5 });
  useEncyclopedic(engine);
  pickSearch(engine, [id("tA")]);
  assert.equal(tokensOn(engine, factionOf(engine, P1)), 2);
});

clause(SOCIETY, "8:ability", "needs 3 tokens: refused with 2 or 0, and nothing changes", () => {
  for (const tokens of [2, 0]) {
    const { engine } = encyclopedicBoard({ tokens });
    const handBefore = handSize(engine, P1);
    const deckBefore = [...engine.state.players[P1].deck];
    assert.throws(() => useEncyclopedic(engine), /cannot be paid/, `${tokens} tokens`);
    assert.equal(tokensOn(engine, factionOf(engine, P1)), tokens, "tokens are not partly removed");
    assert.equal(handSize(engine, P1), handBefore);
    assert.deepEqual(engine.state.players[P1].deck, deckBefore);
    assert.equal(engine.state.pendingChoice, undefined);
  }
});

clause(SOCIETY, "8:ability", "the 3 tokens must be on THIS card: tokens on other cards don't count and are not removed", () => {
  const other = { key: "tokened", def: character({ name: "Tokened Character" }), owner: P1, counters: { token: 5 } } as CardPlacement;
  // faction holds 2 -> refused even though another card holds 5
  {
    const { engine, id } = encyclopedicBoard({ tokens: 2, others: [other] });
    assert.throws(() => useEncyclopedic(engine), /cannot be paid/);
    assert.equal(tokensOn(engine, id("tokened")), 5);
  }
  // faction holds 3 -> works, and the other card keeps its tokens
  {
    const { engine, id } = encyclopedicBoard({ tokens: 3, others: [other] });
    useEncyclopedic(engine);
    pickSearch(engine, [id("tA")]);
    assert.equal(tokensOn(engine, factionOf(engine, P1)), 0);
    assert.equal(tokensOn(engine, id("tokened")), 5, "the other card's tokens are untouched");
  }
});

clause(SOCIETY, "8:ability", "[O][O]: usable with two Obsession (and with more); the icons are not spent", () => {
  for (const obsession of [2, 3]) {
    const { engine, id } = encyclopedicBoard({ tokens: 3, obsession });
    useEncyclopedic(engine);
    pickSearch(engine, [id("tA")]);
    assert.equal(engine.state.cards[id("tA")].zone, "hand", `${obsession} Obsession`);
    assert.equal(readyCount(engine, P1), obsession, "a threshold is a gate, not a cost: the resources stay ready");
    assert.equal(attachedCount(engine, P1), 0);
  }
});

clause(SOCIETY, "8:ability", "[O][O]: refused with one Obsession, no Obsession, or other icons / Volition instead", () => {
  const cases: Array<[string, CardPlacement[], number]> = [
    ["one Obsession", [...bank("greed", 3, P1)], 1],
    ["no Obsession, other staples", [...bank("greed", 2, P1), ...bank("rage", 2, P1)], 0],
    ["two face-down resources (Volition)", volition(2, P1), 0],
    ["one Obsession + one face-down", volition(1, P1), 1],
    ["nothing at all", [], 0]
  ];
  for (const [label, others, obsession] of cases) {
    const { engine } = encyclopedicBoard({ tokens: 3, obsession, others });
    const handBefore = handSize(engine, P1);
    assert.throws(() => useEncyclopedic(engine), /threshold/i, label);
    assert.equal(tokensOn(engine, factionOf(engine, P1)), 3, `${label}: tokens are not removed`);
    assert.equal(handSize(engine, P1), handBefore, label);
    assert.equal(engine.state.pendingChoice, undefined, label);
  }
});

clause(SOCIETY, "8:ability", "can only find a TACTIC from MY DECK (not a character, nor a tactic in hand / discard / the opponent's deck)", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  useEncyclopedic(engine);
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget");
  for (const key of ["c0", "handTactic", "discardTactic", "theirTactic", "theirChar"]) {
    assert.throws(() => pickSearch(engine, [id(key)]), /Illegal target/, key);
  }
  assert.throws(() => pickSearch(engine, [id("tA"), id("tB")]), /requires/, "a tactic = one card");
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(engine.state.cards[id("handTactic")].zone, "hand");
  assert.equal(engine.state.cards[id("theirTactic")].zone, "deck");
  pickSearch(engine, [id("tA")]);
  assert.equal(engine.state.cards[id("tA")].zone, "hand");
});

clause(SOCIETY, "8:ability", "the search can be failed (picking nothing): the tokens are still removed, nothing is revealed or drawn", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  const handBefore = handSize(engine, P1);
  useEncyclopedic(engine);
  pickSearch(engine, []);
  assert.equal(tokensOn(engine, factionOf(engine, P1)), 0, "the cost was paid regardless");
  assert.equal(handSize(engine, P1), handBefore);
  assert.equal(engine.state.cards[id("tA")].zone, "deck");
  assert.equal(revealEvents(engine).length, 0);
});

clause(SOCIETY, "8:ability", "the searched deck is shuffled afterwards (CR §312.1); the rest of the deck is the same cards", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  const before = engine.state.players[P1].deck.filter((c) => c !== id("tA"));
  useEncyclopedic(engine);
  pickSearch(engine, [id("tA")]);
  const after = engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), [...before].sort(), "same cards");
  assert.notDeepEqual(after, before, "in a new order");
});

clause(SOCIETY, "8:ability", "the opponent's deck is untouched by the search", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3 });
  const theirDeck = [...engine.state.players[P2].deck];
  useEncyclopedic(engine);
  pickSearch(engine, [id("tA")]);
  assert.deepEqual(engine.state.players[P2].deck, theirDeck);
});

clause(SOCIETY, "8:ability", "with no tactic in the deck the cost is still paid and nothing is found", () => {
  const { engine, id } = encyclopedicBoard({ tokens: 3, tacticsInDeck: false });
  const handBefore = handSize(engine, P1);
  useEncyclopedic(engine);
  assert.equal(tokensOn(engine, factionOf(engine, P1)), 0, "COST paid");
  assert.equal(engine.state.pendingChoice, undefined, "no tactic to find, so nothing to pick");
  assert.equal(handSize(engine, P1), handBefore);
  assert.equal(revealEvents(engine).length, 0);
  assert.equal(engine.state.cards[id("handTactic")].zone, "hand");
});

clause(SOCIETY, "8:ability", "a search that finds no tactic still shuffles the deck (CR §312.1: searched decks are shuffled)", () => {
  const { engine } = encyclopedicBoard({ tokens: 3, tacticsInDeck: false });
  const before = [...engine.state.players[P1].deck];
  useEncyclopedic(engine);
  const after = engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the deck was searched, so it is shuffled");
});

clause(SOCIETY, "8:ability", "only its controller can use it", () => {
  const { engine } = encyclopedicBoard({ tokens: 3 });
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  assert.throws(() =>
    engine.perform({ type: "activateAbility", playerId: P2, cardId: factionOf(engine, P1), abilityId: ENCYCLOPEDIC, selected: {}, variables: {} })
  );
  assert.equal(tokensOn(engine, factionOf(engine, P1)), 3);
});

clause(SOCIETY, "8:ability", "failing the search (picking nothing) still shuffles the deck", () => {
  const { engine } = encyclopedicBoard({ tokens: 3 });
  const before = [...engine.state.players[P1].deck];
  useEncyclopedic(engine);
  pickSearch(engine, []);
  const after = engine.state.players[P1].deck;
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "a searched deck is shuffled even when nothing was taken");
});

// =============================================================================
// The Knitting Coalition
// =============================================================================

exempt(KNITTING, "0:rule", "Tournament legality is a format rule outside the game engine (nothing in a played game changes); the engine has no format layer.");

// --- STARTING RESOURCES: "2 Greed."

clause(KNITTING, "1:rule:STARTING RESOURCES", "starts with exactly 2 Greed in play (face-up), and no other starting resources", () => {
  const engine = setup(
    { faction: printing(KNITTING), deck: [RAGE, GREED, ELITISM, GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.deepEqual(namesIn(engine, mine), ["Greed", "Greed"], "two Greed, nothing else");
  for (const id of mine) assert.equal(engine.state.cards[id].faceDown, false, "face-up");
  assert.equal(engine.getThresholds(P1).greed, 2, "they provide two Greed icons");
});

clause(KNITTING, "1:rule:STARTING RESOURCES", "the other staples (and the rest of the Greed) stay out of play", () => {
  const engine = setup(
    { faction: printing(KNITTING), deck: [RAGE, DECEPTION, GREED, GREED, GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const inPlay = namesIn(engine, playCards(engine, P1));
  assert.equal(inPlay.length, 2);
  assert.ok(inPlay.every((n) => n === "Greed"), "inPlay.every((n) => n === \"Greed\")");
  const elsewhere = [...engine.state.players[P1].deck, ...engine.state.players[P1].hand].map((id) => engine.getDefinition(id).name);
  assert.equal(elsewhere.filter((n) => n === "Greed").length, 2, "the other two Greed are still in the deck or hand");
  assert.equal(elsewhere.filter((n) => n === "Rage").length, 1, "the Rage was not taken");
  assert.equal(elsewhere.filter((n) => n === "Deception").length, 1, "the Deception was not taken");
});

clause(KNITTING, "1:rule:STARTING RESOURCES", "the opponent is not affected: they start with their own resources", () => {
  const engine = setup(
    { faction: printing(KNITTING), deck: [GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: [ELITISM, DECEPTION, GREED, GREED, ...repeat(FILLER, 40)] }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"], "their own 2 staples (deck order), not Greed");
});

// --- STARTING DRAW: "3 going first, 4 going second."

const knittingSeat = (): Seat => ({ faction: printing(KNITTING), deck: [GREED, GREED, ...repeat(FILLER, 40)] });

clause(KNITTING, "2:rule:STARTING DRAW", "draws 3 cards going first", () => {
  const engine = setup(knittingSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  assert.equal(handSize(engine, P1), 3);
});

clause(KNITTING, "2:rule:STARTING DRAW", "draws 4 cards going second", () => {
  const engine = setup(knittingSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 });
  assert.equal(handSize(engine, P1), 4);
});

clause(KNITTING, "2:rule:STARTING DRAW", "also applies when the Coalition is the second seat (P2)", () => {
  const goingFirst = setup({ faction: PLAIN_OPP, deck: plainOppDeck() }, knittingSeat(), { first: P2 });
  assert.equal(handSize(goingFirst, P2), 3);
  const goingSecond = setup({ faction: PLAIN_OPP, deck: plainOppDeck() }, knittingSeat(), { first: P1 });
  assert.equal(handSize(goingSecond, P2), 4);
});

// --- HIDDEN INFLUENCE: "Your opponent ignores their faction's STARTING DRAW rule and uses this card's rule instead."

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "an opponent going second draws 4 (the Coalition's going-second number), not their own 8", () => {
  const engine = setup(knittingSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 });
  assert.equal(handSize(engine, P2), 4);
  assert.equal(handSize(engine, P1), 3, "the Coalition's own player still draws 3 going first");
});

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "an opponent going first draws 3 (the Coalition's going-first number), not their own 7", () => {
  const engine = setup(knittingSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 });
  assert.equal(handSize(engine, P2), 3);
  assert.equal(handSize(engine, P1), 4, "the Coalition's own player draws 4 going second");
});

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "works the same when the Coalition is the second seat", () => {
  const first = setup({ faction: PLAIN_OPP, deck: plainOppDeck() }, knittingSeat(), { first: P1 });
  assert.equal(handSize(first, P1), 3, "opponent of the Coalition, going first");
  assert.equal(handSize(first, P2), 4, "the Coalition, going second");
  const second = setup({ faction: PLAIN_OPP, deck: plainOppDeck() }, knittingSeat(), { first: P2 });
  assert.equal(handSize(second, P1), 4, "opponent of the Coalition, going second");
  assert.equal(handSize(second, P2), 3, "the Coalition, going first");
});

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "only the STARTING DRAW is replaced: the opponent still starts with their own starting resources", () => {
  const engine = setup(knittingSeat(), { faction: PLAIN_OPP, deck: [ELITISM, DECEPTION, ...repeat(FILLER, 40)] }, { first: P1 });
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

// A faction whose STARTING DRAW rule also holds a search ("You may search your
// deck for a staple resource that is not any of your starting resources,
// reveal it and put it into your hand. Then draw 7 going first, 8 going second.")
const SEARCHER = factionCard({
  id: "s303-searcher",
  name: "Searcher",
  faction: defaultFactionDefinition({
    startingInfluence: 20,
    setup: {
      startingResources: { count: 2, stapleOnly: true },
      openingHand: { goingFirst: 7, goingSecond: 8 },
      startingDrawSearch: { selector: { controller: "self", zone: "deck", type: "resource", staple: true }, reveal: true },
      mulligan: { count: 1, mode: "replaceAny" }
    },
    turn: {
      restore: { detachResources: true, restoreNonResources: true },
      develop: { choices: [{ type: "draw", count: 1 }, { type: "playResource", count: 1 }] }
    }
  })
});
const searcherDeck = (): CardDefinition[] => [RAGE, RAGE, GREED, ...repeat(FILLER, 40)];

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "(control) without the Coalition a STARTING DRAW search is carried out: reveal + 7 cards + the found staple", () => {
  const engine = setup(
    { faction: SEARCHER, deck: searcherDeck() },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { first: P1 }
  );
  assert.equal(revealEvents(engine).length, 1, "the starting-draw search revealed its card");
  assert.equal(handSize(engine, P1), 7 + 1, "7 drawn + the searched-for staple");
});

clause(KNITTING, "3:rule:HIDDEN INFLUENCE", "the opponent ignores ALL of their STARTING DRAW rule, including a search it contains", () => {
  const engine = setup(
    { faction: SEARCHER, deck: searcherDeck() },
    { faction: printing(KNITTING), deck: [GREED, GREED, ...repeat(FILLER, 40)] },
    { first: P1 }
  );
  assert.equal(revealEvents(engine).length, 0, "the opponent's STARTING DRAW search is ignored (nothing is searched for or revealed)");
  assert.equal(handSize(engine, P1), 3, "they draw the Coalition's 3 going first and nothing else");
});

// --- DEVELOP RULE - PULLING STRINGS: "Your opponent ignores their faction's DEVELOP RULE."

const KNITTING_DEVELOP_CARDS: CardPlacement[] = [
  { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
  { key: "handChar", def: character({ name: "Hand Character" }), owner: P1, zone: "hand" },
  ...topOfDeck("mydeck", P1),
  ...topOfDeck("theirdeck", P2)
];

function pullingStringsBoard(oppFaction: CardDefinition, active: PlayerId = P1) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: oppFaction },
    activePlayerId: active,
    cards: KNITTING_DEVELOP_CARDS
  });
}

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "(control) against an ordinary faction the same player can use their Develop Rule", () => {
  const { engine } = pullingStringsBoard(developFaction());
  const hand = handSize(engine, P1);
  assert.ok(developOffers(engine, P1).length > 0, "the Develop Rule offers something");
  developDraw(engine, P1);
  assert.equal(handSize(engine, P1), hand + 1);
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "the opponent has no Develop Rule: no draw, no resource play", () => {
  const { engine, id } = pullingStringsBoard(printing(KNITTING));
  const hand = handSize(engine, P1);
  const deck = [...engine.state.players[P1].deck];
  assert.deepEqual(engine.getDevelopChoices(P1), [], "no develop choices at all");
  assert.deepEqual(developOffers(engine, P1), [], "the Develop Rule offers nothing");
  assert.throws(() => developDraw(engine, P1), /develop/i);
  assert.throws(() => developResource(engine, P1, id("handRes"), false), /develop/i);
  assert.throws(() => developResource(engine, P1, id("handChar"), true), /develop/i);
  assert.equal(handSize(engine, P1), hand, "nothing was drawn");
  assert.deepEqual(engine.state.players[P1].deck, deck);
  assert.equal(engine.state.cards[id("handRes")].zone, "hand", "no resource was played");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "stays suppressed on every one of the opponent's turns", () => {
  const { engine } = pullingStringsBoard(printing(KNITTING));
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined, "second turn: my turn start raises no Develop Rule prompt");
  assert.deepEqual(developOffers(engine, P1), [], "second turn");
  assert.throws(() => developDraw(engine, P1), /develop/i);
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined, "third turn: my turn start raises no Develop Rule prompt");
  assert.deepEqual(developOffers(engine, P1), [], "third turn");
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "only the DEVELOP RULE is ignored: the opponent's RESTORE RULE still runs on their turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: printing(KNITTING) },
    activePlayerId: P2,
    cards: [
      { key: "mineChar", def: character({ name: "My Depleted Character" }), owner: P1, depleted: true },
      ...spent(P1, 3),
      ...topOfDeck("mydeck", P1)
    ]
  });
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[id("mineChar")].depleted, false, "restored");
  assert.equal(attachedCount(engine, P1), 0, "detached");
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "only the DEVELOP RULE is ignored: the opponent's faction abilities still work", () => {
  const withAbility = factionCard({
    id: "s303-ability-faction",
    name: "Faction With Ability",
    faction: defaultFactionDefinition({
      abilities: [
        {
          id: "pay3-draw",
          type: "activated",
          costs: [{ type: "payResources", amount: 3 }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    })
  });
  const { engine } = buildGame({
    playerA: { faction: withAbility },
    playerB: { faction: printing(KNITTING) },
    cards: [...bank("rage", 3, P1), ...topOfDeck("mydeck", P1)]
  });
  const hand = handSize(engine, P1);
  activateFaction(engine, P1, "pay3-draw");
  assert.equal(handSize(engine, P1), hand + 1);
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "the opponent's cards that depend on the Develop Rule are unaffected otherwise: they can still deploy cards", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: printing(KNITTING) },
    cards: [{ key: "free", def: character({ name: "Free Character", cost: 0 }), owner: P1, zone: "hand" }]
  });
  engine.perform({ type: "playCard", playerId: P1, cardId: id("free"), selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("free")].zone, "play");
});

clause(KNITTING, "4:rule:DEVELOP RULE - PULLING STRINGS", "the Coalition's OWN DEVELOP RULE is this paragraph: its controller has no free draw-or-play-a-resource", () => {
  // The card prints no "draw a card or play a resource" rule for its own player
  // (the only way to draw or play a resource is INFLATIONARY FORCES, Pay 2).
  const { engine, id } = buildGame({
    playerA: { faction: printing(KNITTING) },
    playerB: { faction: developFaction() },
    cards: [
      { key: "handRes", def: resourceCard({ name: "Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      ...topOfDeck("mydeck", P1)
    ]
  });
  const hand = handSize(engine, P1);
  assert.deepEqual(engine.getDevelopChoices(P1), [], "no Develop Rule of its own");
  assert.deepEqual(developOffers(engine, P1), [], "the Develop Rule offers nothing");
  assert.throws(() => developDraw(engine, P1), /develop/i);
  assert.throws(() => developResource(engine, P1, id("handRes"), false), /develop/i);
  assert.equal(handSize(engine, P1), hand);
});

// --- RESTORE RULE

clause(KNITTING, "5:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", () => {
  restoreAtMyTurnStart(printing(KNITTING));
});
clause(KNITTING, "5:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  restoreLeavesOpponentAlone(printing(KNITTING));
});
clause(KNITTING, "5:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  restoreOnlyAtMyTurnStart(printing(KNITTING));
});

// --- INFLATIONARY FORCES - DRAW: "Both players may use this ability. Pay 2. Draw a card."

function knittingOppBoard(mine: number, theirs: number) {
  return buildGame({
    playerA: { faction: printing(KNITTING) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [
      ...bank("rage", mine, P1),
      ...bank("rage", theirs, P2),
      ...topOfDeck("mydeck", P1),
      ...topOfDeck("theirdeck", P2),
      { key: "myHandRes", def: resourceCard({ name: "My Hand Resource", resource: { provides: ["greed"], staple: true } }), owner: P1, zone: "hand" },
      { key: "theirHandRes", def: resourceCard({ name: "Their Hand Resource", resource: { provides: ["rage"], staple: true } }), owner: P2, zone: "hand" },
      { key: "theirHandChar", def: character({ name: "Their Hand Character" }), owner: P2, zone: "hand" }
    ]
  });
}

clause(KNITTING, "6:ability", "its controller pays exactly 2 resources and draws one card", () => {
  drawAbilityPaysAndDraws(printing(KNITTING), "knitting-draw", 2);
});
clause(KNITTING, "6:ability", "its controller is refused when the 2 can't be paid", () => {
  drawAbilityUnaffordable(printing(KNITTING), "knitting-draw", 2);
});
clause(KNITTING, "6:ability", "its controller can use it again the same turn", () => {
  drawAbilityRepeatable(printing(KNITTING), "knitting-draw", 2);
});

clause(KNITTING, "6:ability", "the OPPONENT may use it too: they pay 2 of THEIR resources and THEY draw", () => {
  const { engine, id } = knittingOppBoard(5, 4);
  const theirHand = handSize(engine, P2);
  const myHand = handSize(engine, P1);
  const theirDeck = [...engine.state.players[P2].deck];
  activateFaction(engine, P2, "knitting-draw", P1);
  assert.equal(attachedCount(engine, P2), 2, "the opponent paid 2 of their own resources");
  assert.equal(readyCount(engine, P2), 2);
  assert.equal(attachedCount(engine, P1), 0, "the Coalition's controller paid nothing");
  assert.equal(readyCount(engine, P1), 5);
  assert.equal(handSize(engine, P2), theirHand + 1, "the opponent drew a card");
  assert.equal(engine.state.cards[id("theirdeck0")].zone, "hand", "from the top of THEIR deck");
  assert.deepEqual(engine.state.players[P2].deck, theirDeck.slice(1));
  assert.equal(handSize(engine, P1), myHand, "the Coalition's controller drew nothing");
});

clause(KNITTING, "6:ability", "the opponent is refused when THEY can't pay 2, even though the Coalition's controller has resources", () => {
  const { engine } = knittingOppBoard(6, 1);
  const theirHand = handSize(engine, P2);
  assert.throws(() => activateFaction(engine, P2, "knitting-draw", P1), /cannot be paid/);
  assert.equal(handSize(engine, P2), theirHand);
  assert.equal(attachedCount(engine, P1), 0, "the Coalition's resources can't be used to pay for them");
  assert.equal(attachedCount(engine, P2), 0);
  const none = knittingOppBoard(6, 0);
  assert.throws(() => activateFaction(none.engine, P2, "knitting-draw", P1), /cannot be paid/);
});

clause(KNITTING, "6:ability", "the opponent can use it more than once, as long as they can pay", () => {
  const { engine } = knittingOppBoard(0, 5);
  const theirHand = handSize(engine, P2);
  activateFaction(engine, P2, "knitting-draw", P1);
  activateFaction(engine, P2, "knitting-draw", P1);
  assert.equal(handSize(engine, P2), theirHand + 2);
  assert.equal(attachedCount(engine, P2), 4);
  assert.throws(() => activateFaction(engine, P2, "knitting-draw", P1), /cannot be paid/, "only 1 resource left");
});

clause(KNITTING, "6:ability", "the opponent can use it when they could use any ability, e.g. holding priority in a response window", () => {
  const poke = character({
    id: "s303-poker",
    name: "Poker",
    behavior: { abilities: [{ id: "poke", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 0 }] }] }
  });
  const { engine, id } = buildGame({
    playerA: { faction: printing(KNITTING) },
    playerB: { faction: developFaction() },
    activePlayerId: P1,
    cards: [{ key: "poker", def: poke, owner: P1 }, ...bank("rage", 3, P2), ...topOfDeck("theirdeck", P2)]
  });
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("poker"), abilityId: "poke", selected: {}, variables: {} });
  assert.ok(engine.state.responseWindow, "P1's ability opened a response window");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority");
  const theirHand = handSize(engine, P2);
  engine.perform({ type: "activateAbility", playerId: P2, cardId: factionOf(engine, P1), abilityId: "knitting-draw", selected: {}, variables: {} });
  resolvePendingResponses(engine);
  assert.equal(handSize(engine, P2), theirHand + 1, "the opponent used the Coalition's ability in response");
  assert.equal(attachedCount(engine, P2), 2);
});

// --- INFLATIONARY FORCES - RESOURCE: "Both players may use this ability. Pay 2. Play a resource."

clause(KNITTING, "7:ability", "its controller pays exactly 2 resources and plays a resource card from their hand face-up", () => {
  resourceAbilityPaysAndPlays(printing(KNITTING), "knitting-resource", 2);
});
clause(KNITTING, "7:ability", "its controller plays a non-resource card face-down as a resource", () => {
  resourceAbilityFaceDown(printing(KNITTING), "knitting-resource", 2);
});
clause(KNITTING, "7:ability", "its controller can only pick a card from their own hand", () => {
  resourceAbilityOnlyOwnHand(printing(KNITTING), "knitting-resource", 2);
});
clause(KNITTING, "7:ability", "its controller is refused when the 2 can't be paid", () => {
  resourceAbilityUnaffordable(printing(KNITTING), "knitting-resource", 2);
});
clause(KNITTING, "7:ability", "its controller can use it again the same turn", () => {
  resourceAbilityRepeatable(printing(KNITTING), "knitting-resource", 2);
});
clause(KNITTING, "7:ability", "'Play a resource' is mandatory when its controller has cards in hand: choosing nothing is refused", () => {
  resourceAbilityMandatory(printing(KNITTING), "knitting-resource", 2);
});

clause(KNITTING, "7:ability", "the OPPONENT may use it too: they pay 2 of THEIR resources and play a card from THEIR hand under their control", () => {
  const { engine, id } = knittingOppBoard(5, 4);
  const myHand = handSize(engine, P1);
  const theirHand = handSize(engine, P2);
  activateFaction(engine, P2, "knitting-resource", P1);
  assert.equal(attachedCount(engine, P2), 2, "the opponent paid 2 of their own resources");
  assert.equal(attachedCount(engine, P1), 0, "the Coalition's controller paid nothing");
  pickFromHand(engine, P2, id("theirHandRes"));
  const played = engine.state.cards[id("theirHandRes")];
  assert.equal(played.zone, "play");
  assert.equal(played.faceDown, false);
  assert.equal(played.controllerId, P2, "it enters play under the player who used the ability");
  assert.ok(engine.state.players[P2].play.includes(id("theirHandRes")), "engine.state.players[P2].play.includes(id(\"theirHandRes\"))");
  assert.equal(handSize(engine, P2), theirHand - 1);
  assert.equal(handSize(engine, P1), myHand, "the Coalition's controller's hand is untouched");
  assert.equal(engine.state.cards[id("theirHandChar")].zone, "hand", "only the chosen card was played");
});

clause(KNITTING, "7:ability", "the opponent plays a non-resource face-down, and can't pick from the Coalition controller's hand", () => {
  const { engine, id } = knittingOppBoard(5, 4);
  activateFaction(engine, P2, "knitting-resource", P1);
  assert.throws(
    () =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P2,
        choice: { kind: "chooserSelectsTarget", selected: [id("myHandRes")] }
      } as never),
    /Illegal target/
  );
  pickFromHand(engine, P2, id("theirHandChar"));
  assert.equal(engine.state.cards[id("theirHandChar")].faceDown, true);
  assert.equal(engine.state.cards[id("theirHandChar")].controllerId, P2);
  assert.equal(engine.state.cards[id("myHandRes")].zone, "hand");
  assert.equal(engine.getThresholds(P2).volition, 1);
});

clause(KNITTING, "7:ability", "the opponent is refused when THEY can't pay 2", () => {
  const { engine, id } = knittingOppBoard(6, 1);
  assert.throws(() => activateFaction(engine, P2, "knitting-resource", P1), /cannot be paid/);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.cards[id("theirHandRes")].zone, "hand");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(attachedCount(engine, P2), 0);
});

// =============================================================================
// The Open R&D Faction
// =============================================================================

exempt(RND, "0:rule", "Tournament legality is a format rule outside the game engine (nothing in a played game changes); the engine has no format layer.");

// --- STARTING RESOURCES: "Any 2 staple resources."

clause(RND, "1:rule:STARTING RESOURCES", "starts with 2 staple resources in play (face-up); non-staple resources and other cards are not taken", () => {
  const engine = setup(
    { faction: printing(RND), deck: [ODD, FILLER, RAGE, GREED, ELITISM, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2, "exactly two starting resources");
  for (const id of mine) {
    assert.ok(["Rage", "Greed", "Elitism"].includes(engine.getDefinition(id).name), `${engine.getDefinition(id).name} is a staple`);
    assert.equal(engine.state.cards[id].faceDown, false);
  }
  assert.ok(!namesIn(engine, mine).includes("Odd Resource"), "the non-staple resource is not a staple");
  const total = Object.values(engine.getThresholds(P1)).reduce((sum, n) => sum + (n ?? 0), 0);
  assert.equal(total, 2, "two icons");
});

clause(RND, "1:rule:STARTING RESOURCES", "the two staples may be of the same kind ('any 2', not 'different')", () => {
  const engine = setup(
    { faction: printing(RND), deck: [RAGE, RAGE, GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Rage", "Rage"]);
  assert.equal(engine.getThresholds(P1).rage, 2);
});

clause(RND, "1:rule:STARTING RESOURCES", "with the choose-starting-resources step on, the player picks which 2 staples (two of one kind is legal)", () => {
  const engine = setup(
    { faction: printing(RND), deck: [ODD, RAGE, RAGE, RAGE, GREED, GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "P1 is offered a choice");
  assert.equal(choice.count, 2, "two starting resources");
  assert.equal(choice.candidateCardIds.length, 6, "the six staples in the deck (not the non-staple resource, not the characters)");
  assert.ok(choice.candidateCardIds.every((id) => ["Rage", "Greed"].includes(engine.getDefinition(id).name)), "choice.candidateCardIds.every((id) => [\"Rage\", \"Greed\"].includes(engine.getDefinition(id).name))");
  const greeds = choice.candidateCardIds.filter((id) => engine.getDefinition(id).name === "Greed").slice(0, 2);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: greeds });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Greed", "Greed"], "exactly the picked staples are in play");
  assert.equal(engine.state.cards[greeds[0]].faceDown, false);
  assert.equal(handSize(engine, P1), 8, "then the opening hand is drawn");
});

clause(RND, "1:rule:STARTING RESOURCES", "the choice must be exactly 2 staple resources from my deck (not 1, not 3, not a non-staple)", () => {
  const engine = setup(
    { faction: printing(RND), deck: [ODD, RAGE, RAGE, GREED, GREED, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() },
    { choose: true }
  );
  const [r1, r2, g1] = engine.getStartingResourceChoice(P1)!.candidateCardIds;
  const odd = engine.state.players[P1].deck.find((id) => engine.getDefinition(id).name === "Odd Resource")!;
  const filler = engine.state.players[P1].deck.find((id) => engine.getDefinition(id).name === "Filler")!;
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [r1] }), /exactly 2/);
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [r1, r2, g1] }), /exactly 2/);
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [r1, odd] }), /staple/);
  assert.throws(() => engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: [r1, filler] }), /staple/);
  assert.equal(engine.state.setup.phase, "chooseStartingResources", "still waiting for a legal choice");
  assert.equal(playCards(engine, P1).length, 0);
});

clause(RND, "1:rule:STARTING RESOURCES", "the opponent starts with their own resources", () => {
  const engine = setup(
    { faction: printing(RND), deck: [RAGE, RAGE, ...repeat(FILLER, 40)] },
    { faction: PLAIN_OPP, deck: [ELITISM, DECEPTION, ...repeat(FILLER, 40)] }
  );
  assert.deepEqual(namesIn(engine, playCards(engine, P2)), ["Deception", "Elitism"]);
});

// --- STARTING DRAW: "8 going first, 9 going second."

const rndSeat = (): Seat => ({ faction: printing(RND), deck: [RAGE, RAGE, ...repeat(FILLER, 40)] });

clause(RND, "2:rule:STARTING DRAW", "draws 8 cards going first", () => {
  assert.equal(handSize(setup(rndSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 8);
});
clause(RND, "2:rule:STARTING DRAW", "draws 9 cards going second", () => {
  assert.equal(handSize(setup(rndSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 9);
});
clause(RND, "2:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  assert.equal(handSize(setup(rndSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8);
  assert.equal(handSize(setup(rndSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7);
});

// --- RESTORE RULE

clause(RND, "3:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", () => {
  restoreAtMyTurnStart(printing(RND));
});
clause(RND, "3:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  restoreLeavesOpponentAlone(printing(RND));
});
clause(RND, "3:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  restoreOnlyAtMyTurnStart(printing(RND));
});

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(RND, "4:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", () => {
  developDrawWorks(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", () => {
  developResourceWorks(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition)", () => {
  developFaceDownWorks(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  developFaceUpNonResourceRefused(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "draw OR play a resource: not both", () => {
  developIsOneOrTheOther(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "can be used only once per turn", () => {
  developOncePerTurn(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "can be used only on my own turn", () => {
  developOnlyOnMyTurn(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "is optional and available again every turn", () => {
  developIsOptionalAndRenews(printing(RND));
});
clause(RND, "4:rule:DEVELOP RULE", "puts no token on the faction (no such text)", () => {
  const { engine } = tokenBoardFor(printing(RND));
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.cards[factionOf(engine, P1)].counters.token ?? 0, 0);
});

function tokenBoardFor(faction: CardDefinition) {
  return buildGame({
    playerA: { faction },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2)]
  });
}

// --- DRAW: "Pay 3. Draw a card."
clause(RND, "5:ability", "pays exactly 3 resources and draws one card", () => {
  drawAbilityPaysAndDraws(printing(RND), "rd-draw", 3);
});
clause(RND, "5:ability", "is refused when the 3 can't be paid (2 resources, 3 with 2 already spent, none)", () => {
  drawAbilityUnaffordable(printing(RND), "rd-draw", 3);
});
clause(RND, "5:ability", "can be used again the same turn", () => {
  drawAbilityRepeatable(printing(RND), "rd-draw", 3);
});
clause(RND, "5:ability", "is separate from the Develop Rule", () => {
  drawAbilityIsSeparateFromDevelop(printing(RND), "rd-draw", 3);
});
clause(RND, "5:ability", "only its controller can use it", () => {
  drawAbilityControllerOnly(printing(RND), "rd-draw");
});

// --- RESOURCE: "Pay 4. Play a resource."
clause(RND, "6:ability", "pays exactly 4 resources and plays a resource card from my hand face-up", () => {
  resourceAbilityPaysAndPlays(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "plays a non-resource card face-down as a resource", () => {
  resourceAbilityFaceDown(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "the card must come from my own hand", () => {
  resourceAbilityOnlyOwnHand(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "is refused when the 4 can't be paid", () => {
  resourceAbilityUnaffordable(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "can be used again the same turn", () => {
  resourceAbilityRepeatable(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "'Play a resource' is mandatory when I have cards in hand: choosing nothing is refused", () => {
  resourceAbilityMandatory(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "is separate from the Develop Rule", () => {
  resourceAbilityIsSeparateFromDevelop(printing(RND), "rd-resource", 4);
});
clause(RND, "6:ability", "only its controller can use it", () => {
  resourceAbilityControllerOnly(printing(RND), "rd-resource");
});

// --- RESEARCH & DEVELOPMENT: "Before the game begins, both players create the rules text for an ability. This card has that ability and both players can use it."

clause(RND, "7:rule:RESEARCH & DEVELOPMENT", "the faction card has the ability the players created, and both players can use it", () => {
  // The printed DRAW and RESOURCE are the controller's alone; the created ability
  // is a third one, usable by BOTH players. The players do not type it: they agree on a structured spec from a
  // closed menu (setup option `createdAbility` / `applyCreatedFactionAbility`, Q51B), which the engine builds.
  // TEST CORRECTED (W3a): the original asserted the end state with no way to write the ability; it now
  // supplies one through the new seam, then asserts the same end state plus that both players can use it.
  // (Q51B: the seam takes a menu spec instead of a raw ability; same assertions, same ability: Pay 2, gain 1 influence.)
  const { engine } = buildGame({
    playerA: { faction: printing(RND) },
    playerB: { faction: developFaction() },
    cards: [...bank("rage", 6, P1), ...bank("rage", 6, P2), ...topOfDeck("mydeck", P1), ...topOfDeck("theirdeck", P2)]
  });
  const factionId = factionOf(engine, P1);
  assert.equal(engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === factionId).length, 2, "before anything is created there is only DRAW and RESOURCE");
  engine.applyCreatedFactionAbility({ costs: [{ kind: "pay", amount: 2 }], effect: { kind: "gainInfluence", amount: 1 } });
  const mine = engine.getAvailableActivatedAbilities(P1).filter((a) => a.cardId === factionId);
  assert.ok(mine.length >= 3, `the controller sees DRAW, RESOURCE and the created ability (saw ${mine.map((a) => a.ability.id).join(", ")})`);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  const theirs = engine.getAvailableActivatedAbilities(P2).filter((a) => a.cardId === factionId);
  assert.equal(theirs.length, 1, "the opponent can use exactly the created ability on the Open R&D Faction");
  assert.equal(theirs[0].ability.id, CREATED_ABILITY_ID);
  const before = [engine.state.players[P1].influence, engine.state.players[P2].influence];
  const readyBefore = readyCount(engine, P2);
  engine.perform({ type: "activateAbility", playerId: P2, cardId: factionId, abilityId: CREATED_ABILITY_ID, selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(engine.state.players[P2].influence, before[1] + 1, "the opponent used it: it resolved under them");
  assert.equal(engine.state.players[P1].influence, before[0], "and did nothing for the faction's controller");
  assert.equal(readyBefore - readyCount(engine, P2), 2, "the opponent paid its costs");
});

// =============================================================================
// The Union of Unextraordinary Miners
// =============================================================================

exempt(MINERS, "0:rule", "Tournament legality is a format rule outside the game engine (nothing in a played game changes); the engine has no format layer.");

// --- STARTING RESOURCES: MONEY FOR NOTHING.
// "Before the game begins, choose a number for X that is greater than 0 and less than 11. You start with X staple
// resources and 1 Deception. Your opponent starts with their usual resources plus enough staple resources so that both
// players have the same number of starting resources."

const minersDeck = (): CardDefinition[] => [RAGE, RAGE, RAGE, ELITISM, ELITISM, ELITISM, DECEPTION, ...repeat(FILLER, 40)];
const bigMinersDeck = (): CardDefinition[] => [...repeat(RAGE, 13), DECEPTION, ...repeat(FILLER, 40)];
const STAPLES = ["Rage", "Greed", "Deception", "Elitism", "Obsession"];

function minersGame(x: number, oppDeck: CardDefinition[] = [ODD, ...repeat(RAGE, 14), ...repeat(FILLER, 40)], deck = minersDeck(), opp: CardDefinition = PLAIN_OPP) {
  return setup({ faction: printing(MINERS), deck }, { faction: opp, deck: oppDeck }, { x: { [P1]: x, [P2]: 1 } });
}

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "X = 3: starts with 3 staples and 1 Deception (4 resources, all face-up)", () => {
  const engine = minersGame(3);
  const mine = playCards(engine, P1);
  const names = namesIn(engine, mine);
  assert.equal(mine.length, 4, "X + 1 starting resources");
  assert.equal(names.filter((n) => n === "Deception").length, 1, "exactly 1 Deception");
  assert.equal(names.filter((n) => n === "Rage" || n === "Elitism").length, 3, "and X = 3 other staples");
  for (const id of mine) assert.equal(engine.state.cards[id].faceDown, false);
  assert.equal(engine.getThresholds(P1).deception, 1);
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "X = 1 (the minimum): 1 staple and 1 Deception", () => {
  const engine = minersGame(1);
  const names = namesIn(engine, playCards(engine, P1));
  assert.equal(names.length, 2);
  assert.equal(names.filter((n) => n === "Deception").length, 1);
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "X = 10 (the maximum): 10 staples and 1 Deception", () => {
  const engine = minersGame(10, [ODD, ...repeat(RAGE, 20), ...repeat(FILLER, 40)], bigMinersDeck());
  const names = namesIn(engine, playCards(engine, P1));
  assert.equal(names.length, 11);
  assert.equal(names.filter((n) => n === "Deception").length, 1);
  assert.equal(names.filter((n) => n === "Rage").length, 10);
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "X must be greater than 0 and less than 11: out-of-range values never give fewer than 1 or more than 10 staples", () => {
  for (const x of [0, -4, 11, 99]) {
    const engine = minersGame(x, [ODD, ...repeat(RAGE, 20), ...repeat(FILLER, 40)], bigMinersDeck());
    const count = playCards(engine, P1).length;
    assert.ok(count >= 2 && count <= 11, `X = ${x} gave ${count} starting resources (allowed: 2..11 = X + the Deception, X in 1..10)`);
  }
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "the opponent keeps their usual resources and gets staples until both have the same number (X = 3: 2 usual + 2 more = 4)", () => {
  const engine = minersGame(3);
  const theirs = playCards(engine, P2);
  assert.equal(theirs.length, 4, "same number as the Miners' 4");
  assert.equal(theirs.length, playCards(engine, P1).length);
  const names = namesIn(engine, theirs);
  assert.ok(names.every((n) => STAPLES.includes(n)), "their usual staples plus extra staples (their deck holds a non-staple resource that must not be used)");
  assert.ok(!names.includes("Odd Resource"), "the extras are staple resources only");
  for (const id of theirs) assert.equal(engine.state.cards[id].faceDown, false);
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "works the same from the second seat (the opponent in seat 1 is the one topped up)", () => {
  const engine = setup(
    { faction: PLAIN_OPP, deck: [ODD, ...repeat(RAGE, 14), ...repeat(FILLER, 40)] },
    { faction: printing(MINERS), deck: minersDeck() },
    { first: P1, x: { [P1]: 1, [P2]: 3 } }
  );
  assert.equal(playCards(engine, P2).length, 4, "3 staples + 1 Deception");
  assert.equal(playCards(engine, P1).length, 4, "the opponent matched to 4");
  assert.ok(!namesIn(engine, playCards(engine, P1)).includes("Odd Resource"), "!namesIn(engine, playCards(engine, P1)).includes(\"Odd Resource\")");
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "the opponent is topped up to the Miners' count at X = 10 too (11 each)", () => {
  const engine = minersGame(10, [ODD, ...repeat(RAGE, 20), ...repeat(FILLER, 40)], bigMinersDeck());
  assert.equal(playCards(engine, P1).length, 11);
  assert.equal(playCards(engine, P2).length, 11);
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "the opponent gets no extras when they already start with as many (X = 1: 2 and 2)", () => {
  const engine = minersGame(1);
  assert.equal(playCards(engine, P1).length, 2);
  assert.equal(playCards(engine, P2).length, 2, "their usual 2, no extra");
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "an opponent who already starts with MORE keeps all their usual resources, and the Miners' count is not raised", () => {
  const threeStaples = factionCard({
    id: "s303-three-staples",
    name: "Three Staples",
    faction: defaultFactionDefinition({
      startingInfluence: 20,
      setup: {
        startingResources: { count: 3, stapleOnly: true },
        openingHand: { goingFirst: 7, goingSecond: 8 },
        mulligan: { count: 1, mode: "replaceAny" }
      }
    })
  });
  const engine = minersGame(1, [...repeat(RAGE, 10), ...repeat(FILLER, 40)], minersDeck(), threeStaples);
  assert.equal(playCards(engine, P1).length, 2);
  assert.equal(playCards(engine, P2).length, 3, "their usual three; nothing is taken away");
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "with the choose-starting-resources step on: P1 picks X staples themselves and still gets the Deception; the opponent is topped up", () => {
  const engine = setup(
    { faction: printing(MINERS), deck: minersDeck() },
    { faction: PLAIN_OPP, deck: [...repeat(RAGE, 10), ...repeat(FILLER, 40)] },
    { choose: true, x: { [P1]: 2, [P2]: 1 } }
  );
  assert.equal(engine.state.setup.phase, "chooseStartingResources");
  const choice = engine.getStartingResourceChoice(P1);
  assert.ok(choice, "choice");
  assert.equal(choice.count, 2, "X = 2 staples to pick");
  const elitism = choice.candidateCardIds.filter((id) => engine.getDefinition(id).name === "Elitism").slice(0, 2);
  engine.perform({ type: "chooseStartingResources", playerId: P1, cardIds: elitism });
  assert.deepEqual(namesIn(engine, playCards(engine, P1)), ["Deception", "Elitism", "Elitism"], "the 2 picked + 1 Deception");
  assert.equal(playCards(engine, P2).length, 3, "the opponent is topped up from 2 to 3");
});

clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "the Miners' own STARTING DRAW is unaffected by the starting resources (5 going first)", () => {
  const engine = minersGame(3);
  assert.equal(handSize(engine, P1), 5);
});

// --- STARTING DRAW: "5 going first, 6 going second"

const minersSeat = (): Seat => ({ faction: printing(MINERS), deck: minersDeck() });

clause(MINERS, "3:rule:STARTING DRAW", "draws 5 cards going first", () => {
  assert.equal(handSize(setup(minersSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P1), 5);
});
clause(MINERS, "3:rule:STARTING DRAW", "draws 6 cards going second", () => {
  assert.equal(handSize(setup(minersSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P1), 6);
});
clause(MINERS, "3:rule:STARTING DRAW", "only changes its own player's opening hand (the opponent keeps their own 7 / 8)", () => {
  assert.equal(handSize(setup(minersSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P1 }), P2), 8);
  assert.equal(handSize(setup(minersSeat(), { faction: PLAIN_OPP, deck: plainOppDeck() }, { first: P2 }), P2), 7);
});

// --- RESTORE RULE

clause(MINERS, "4:rule:RESTORE RULE", "at the start of my turn: my depleted cards are restored and every resource is detached from my faction", () => {
  restoreAtMyTurnStart(printing(MINERS));
});
clause(MINERS, "4:rule:RESTORE RULE", "does not restore the opponent's cards or detach the opponent's resources", () => {
  restoreLeavesOpponentAlone(printing(MINERS));
});
clause(MINERS, "4:rule:RESTORE RULE", "does nothing at the start of the opponent's turn", () => {
  restoreOnlyAtMyTurnStart(printing(MINERS));
});

// --- DEVELOP RULE: "At the start of your turn, draw a card or play a resource."

clause(MINERS, "5:rule:DEVELOP RULE", "may draw a card (the top of the deck) as its Develop Rule", () => {
  developDrawWorks(printing(MINERS));
});
clause(MINERS, "5:rule:DEVELOP RULE", "may play a resource card face-up as its Develop Rule", () => {
  const { engine, id } = developBoard(printing(MINERS));
  developResource(engine, P1, id("handRes"), false);
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handRes")].faceDown, false);
  assert.equal(engine.getThresholds(P1).greed, 1);
});
clause(MINERS, "5:rule:DEVELOP RULE", "may play any card face-down as its resource (Volition)", () => {
  developFaceDownWorks(printing(MINERS));
});
clause(MINERS, "5:rule:DEVELOP RULE", "a non-resource card cannot be played face-up as a resource", () => {
  developFaceUpNonResourceRefused(printing(MINERS));
});
clause(MINERS, "5:rule:DEVELOP RULE", "can be used only on my own turn", () => {
  developOnlyOnMyTurn(printing(MINERS));
});
clause(MINERS, "5:rule:DEVELOP RULE", "cannot be skipped (draw or play a resource, not neither) and is available again every turn", () => {
  const { engine } = developBoard(printing(MINERS));
  const hand = handSize(engine, P1);
  endTurn(engine, P1);
  endTurnRaw(engine, P2); // my turn starts for real
  orderUntilDevelop(engine);
  const pending = engine.state.pendingChoice;
  assert.ok(pending?.kind === "chooserSelectsOption", "the Develop Rule's options are open");
  assert.deepEqual(
    pending.options.map((option) => option.label),
    ["Draw 1 card", "Play a resource"],
    "it offers only a draw or a resource play: there is no option to skip it"
  );
  pickDevelopDraw(engine, P1);
  assert.equal(handSize(engine, P1), hand + 1, "the draw was taken");
  developDrawLeft(engine, P1); // (OVERTIME offers it a second time, and that offer cannot be skipped either)
  assert.equal(handSize(engine, P1), hand + 2);
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  orderUntilDevelop(engine); // available again at the start of my next turn
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the Develop Rule's options are open again");
});

// --- "OVERTIME": a second copy of the same rule, so the Develop Rule can be used twice a turn.

function twoDevelops(first: "draw" | "res", second: "draw" | "res"): void {
  const { engine, id } = developBoard(printing(MINERS));
  const hand = handSize(engine, P1);
  const use = (kind: "draw" | "res", resKey: string) => (kind === "draw" ? pickDevelopDraw(engine, P1) : pickDevelopResource(engine, P1, id(resKey), false));
  openDevelop(engine, P1);
  use(first, "handRes");
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the second use is still available");
  use(second, "handRes2");
  const draws = (first === "draw" ? 1 : 0) + (second === "draw" ? 1 : 0);
  const resources = 2 - draws;
  assert.equal(handSize(engine, P1), hand + draws - resources, `${draws} draw(s) and ${resources} resource play(s)`);
  assert.equal(engine.state.pendingChoice, undefined, "but only two uses: a third is not offered");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand", "a third use is not made");
}

clause(MINERS, "6:rule:OVERTIME", "the Develop Rule can be used twice in a turn: draw + draw", () => {
  twoDevelops("draw", "draw");
});
clause(MINERS, "6:rule:OVERTIME", "the Develop Rule can be used twice in a turn: draw + play a resource", () => {
  twoDevelops("draw", "res");
});
clause(MINERS, "6:rule:OVERTIME", "the Develop Rule can be used twice in a turn: play a resource + draw", () => {
  twoDevelops("res", "draw");
});
clause(MINERS, "6:rule:OVERTIME", "the Develop Rule can be used twice in a turn: play a resource + play a resource", () => {
  twoDevelops("res", "res");
});
clause(MINERS, "6:rule:OVERTIME", "the two uses are available again every turn, and the allowance does not carry over", () => {
  const { engine } = developBoard(printing(MINERS));
  developDraw(engine, P1); // one of this turn's two uses
  developDrawLeft(engine, P1); // (the second offer cannot be skipped: it draws)
  endTurn(engine, P1);
  endTurnRaw(engine, P2);
  // next turn: a fresh two uses (not 1 + leftover, not 0)
  orderUntilDevelop(engine);
  pickDevelopDraw(engine, P1);
  assert.equal(engine.state.pendingChoice?.kind, "chooserSelectsOption", "the second use is offered");
  pickDevelopDraw(engine, P1);
  assert.equal(engine.state.pendingChoice, undefined, "and there is no third");
});
clause(MINERS, "6:rule:OVERTIME", "only on my own turn: not on the opponent's", () => {
  developOnlyOnMyTurn(printing(MINERS));
});
clause(MINERS, "6:rule:OVERTIME", "gives the opponent nothing extra: the opponent's own faction still develops once", () => {
  const { engine } = buildGame({
    playerA: { faction: printing(MINERS) },
    playerB: { faction: developFaction() },
    activePlayerId: P2,
    cards: [...topOfDeck("theirdeck", P2), ...topOfDeck("mydeck", P1)]
  });
  developDraw(engine, P2);
  assert.equal(engine.state.pendingChoice, undefined, "the opponent's own faction develops once: nothing more is offered");
});

// --- DRAW: "Pay 4. Draw a card."
clause(MINERS, "7:ability", "pays exactly 4 resources and draws one card", () => {
  drawAbilityPaysAndDraws(printing(MINERS), "miners-draw", 4);
});
clause(MINERS, "7:ability", "is refused when the 4 can't be paid (3 resources, 4 with 2 already spent, none)", () => {
  drawAbilityUnaffordable(printing(MINERS), "miners-draw", 4);
});
clause(MINERS, "7:ability", "can be used again the same turn", () => {
  drawAbilityRepeatable(printing(MINERS), "miners-draw", 4);
});
clause(MINERS, "7:ability", "is separate from the Develop Rule", () => {
  drawAbilityIsSeparateFromDevelop(printing(MINERS), "miners-draw", 4);
});
clause(MINERS, "7:ability", "only its controller can use it", () => {
  drawAbilityControllerOnly(printing(MINERS), "miners-draw");
});

// --- RESOURCE: "Pay 5. Play a resource."
clause(MINERS, "8:ability", "pays exactly 5 resources and plays a resource card from my hand face-up", () => {
  resourceAbilityPaysAndPlays(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "plays a non-resource card face-down as a resource", () => {
  resourceAbilityFaceDown(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "the card must come from my own hand", () => {
  resourceAbilityOnlyOwnHand(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "is refused when the 5 can't be paid", () => {
  resourceAbilityUnaffordable(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "can be used again the same turn", () => {
  resourceAbilityRepeatable(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "'Play a resource' is mandatory when I have cards in hand: choosing nothing is refused", () => {
  resourceAbilityMandatory(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "is separate from the Develop Rule", () => {
  resourceAbilityIsSeparateFromDevelop(printing(MINERS), "miners-resource", 5);
});
clause(MINERS, "8:ability", "only its controller can use it", () => {
  resourceAbilityControllerOnly(printing(MINERS), "miners-resource");
});

// --- RESOURCE abilities: an actual resource card can also be played face-down (cross-cutting; one finding for all four).
clause(SOCIETY, "7:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () => {
  resourceAbilityRealResourceFaceDown(printing(SOCIETY), "society-resource", 3);
});
clause(KNITTING, "7:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () => {
  resourceAbilityRealResourceFaceDown(printing(KNITTING), "knitting-resource", 2);
});
clause(RND, "6:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () => {
  resourceAbilityRealResourceFaceDown(printing(RND), "rd-resource", 4);
});
clause(MINERS, "8:ability", "'Play a resource' lets me choose face-up or face-down for an actual resource card", () => {
  resourceAbilityRealResourceFaceDown(printing(MINERS), "miners-resource", 5);
});

// --- MONEY FOR NOTHING: the opponent's top-up staples are a choice too.
clause(MINERS, ["1:rule:STARTING RESOURCES", "2:rule"], "the opponent chooses which staples they get, including the 'enough staple resources' top-up", () => {
  const engine = setup(
    { faction: printing(MINERS), deck: minersDeck() },
    { faction: PLAIN_OPP, deck: [...repeat(RAGE, 4), ...repeat(GREED, 6), ...repeat(FILLER, 40)] },
    { choose: true, x: { [P1]: 3, [P2]: 1 } }
  );
  // Both players answer every starting-resource decision they are offered; P2 always wants Greed.
  let guard = 0;
  while (engine.state.setup.phase === "chooseStartingResources" && guard++ < 8) {
    const setupState = engine.state.setup as unknown as { order: PlayerId[]; currentIndex: number };
    const pid = setupState.order[setupState.currentIndex];
    const choice = engine.getStartingResourceChoice(pid)!;
    const want = pid === P2 ? "Greed" : "Elitism";
    const cardIds = choice.candidateCardIds.filter((c) => engine.getDefinition(c).name === want).slice(0, choice.count);
    engine.perform({ type: "chooseStartingResources", playerId: pid, cardIds });
  }
  const theirs = namesIn(engine, playCards(engine, P2));
  assert.equal(theirs.length, 4, "usual 2 + 2 more, to match the Miners' 3 staples + Deception");
  assert.deepEqual(theirs, ["Greed", "Greed", "Greed", "Greed"], "every one of their starting staples was their own pick (all Greed)");
});

// =============================================================================
// Gap-closer additions (3c mutation pass)
// =============================================================================

// "Play a resource" is ONE resource: picking two cards from hand is refused (or at most one is played).
function resourceAbilityOnlyOne(faction: CardDefinition, abilityId: string, cost: number): void {
  const { engine, id } = abilityBoard(faction, cost + 1);
  activateFaction(engine, P1, abilityId);
  refused(
    () =>
      engine.perform({
        type: "resolvePendingChoice",
        playerId: P1,
        choice: { kind: "chooserSelectsTarget", selected: [id("handRes"), id("handChar")] }
      } as never),
    "'a resource' means exactly one card",
    /Illegal|count|exactly|too many|at most|select/i
  );
  assert.equal(engine.state.cards[id("handRes")].zone, "hand", "nothing was played by the refused double pick");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand");
  pickFromHand(engine, P1, id("handRes")); // positive control: one card works
  assert.equal(engine.state.cards[id("handRes")].zone, "play");
  assert.equal(engine.state.cards[id("handChar")].zone, "hand", "only one card was played");
}

clause(SOCIETY, "7:ability", "plays only ONE resource: two picked cards are refused", () => {
  resourceAbilityOnlyOne(printing(SOCIETY), "society-resource", 3);
});
clause(KNITTING, "7:ability", "its controller plays only ONE resource: two picked cards are refused", () => {
  resourceAbilityOnlyOne(printing(KNITTING), "knitting-resource", 2);
});
clause(RND, "6:ability", "plays only ONE resource: two picked cards are refused", () => {
  resourceAbilityOnlyOne(printing(RND), "rd-resource", 4);
});
clause(MINERS, "8:ability", "plays only ONE resource: two picked cards are refused", () => {
  resourceAbilityOnlyOne(printing(MINERS), "miners-resource", 5);
});

// STARTING RESOURCES "Any 1 resource, Any 1 card": the resource slot goes looking for a resource card in the deck
// (it is not just "the top two cards").
clause(SOCIETY, "1:rule:STARTING RESOURCES", "the 'resource' pick finds the one resource card even when it is buried under other cards", () => {
  const engine = setup(
    { faction: printing(SOCIETY), deck: [...repeat(FILLER, 25), GREED, ...repeat(FILLER, 15)] },
    { faction: PLAIN_OPP, deck: plainOppDeck() }
  );
  const mine = playCards(engine, P1);
  assert.equal(mine.length, 2);
  const names = namesIn(engine, mine);
  assert.deepEqual(names, ["Filler", "Greed"], "exactly the resource plus one other card");
  const greed = mine.find((c) => engine.getDefinition(c).name === "Greed")!;
  const other = mine.find((c) => engine.getDefinition(c).name === "Filler")!;
  assert.equal(engine.state.cards[greed].faceDown, false);
  assert.equal(engine.state.cards[other].faceDown, true);
});
