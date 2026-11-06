// Clause tests — batch 2nd-edition-04. See docs/TESTING.md and
// `npm run card-tests -- manifest 2nd-edition-04`. Expectations come from each
// card's PRINTED text and RULES.md / the Comprehensive Rules; engine data is
// only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, finishBattle, fightThrough, playRaw } from "./_battle.js";
import { answerPending, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
type IdOf = (key: string) => CardInstanceId;
const other = (player: Pid): Pid => (player === P1 ? P2 : P1);

/** Resources `player` can still spend (not attached to the faction). */
const ready = (engine: SpoilsEngine, player: Pid = P1): number => engine.getAvailableResourceCount(player);
const handOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] => engine.state.players[player].discard;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string): boolean => (engine.getKeywords(cardId) as string[]).includes(keyword);

/** Resources spent while `fn` runs (before - after). */
function spentBy(engine: SpoilsEngine, player: Pid, fn: () => void): number {
  const before = ready(engine, player);
  fn();
  return before - ready(engine, player);
}

/** Raw `activateAbility` without draining the response window (the harness `activate` drains it). */
function activateRaw(
  engine: SpoilsEngine,
  player: Pid,
  cardId: CardInstanceId,
  abilityId: string,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number> } = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected: opts.selected ?? {}, variables: opts.variables ?? {} } as never);
}

/** A small seeded LCG: reproducible shuffles / random picks. */
function seeded(seed = 12345): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const sameCards = (a: readonly string[], b: readonly string[], message = "same cards") => assert.deepEqual([...a].sort(), [...b].sort(), message);

/** All `cardsRevealed` events in the log. */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const revealedIds = (engine: SpoilsEngine): string[] => revealEvents(engine).flatMap((entry) => (entry.event as unknown as { cardIds?: string[] }).cardIds ?? []);
const loggedEvents = (engine: SpoilsEngine, type: string) => engine.getLog().filter((entry) => entry.event?.type === type);

/** Answers the open `chooserSelectsTarget` with `selected` and lets the game continue. */
const pickCards = (engine: SpoilsEngine, selected: CardInstanceId[]): void => answerPending(engine, "chooserSelectsTarget", { selected });
/** The same answer as a thunk for `refused(...)` (it keeps the choice open when the pick is illegal). */
const tryPick = (engine: SpoilsEngine, player: Pid, selected: CardInstanceId[]) => () => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsTarget", selected } } as never);
  resolvePendingResponses(engine);
};

/** Passes priority for whoever holds it until `player` holds it (or the window closes). */
function passUntil(engine: SpoilsEngine, player: Pid): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player && !engine.state.pendingChoice) {
    if (++guard > 50) throw new Error("passUntil did not converge");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

const declareBlock = (engine: SpoilsEngine, player: Pid, blockerIds: CardInstanceId[]) => engine.perform({ type: "declareBlockers", playerId: player, blockerIds });

/** Resolves the battle sending each listed source's whole strength at the mapped target card; other sources take the default first legal target. */
function resolveSending(engine: SpoilsEngine, plan: Record<CardInstanceId, CardInstanceId> = {}): void {
  autoResolveBattle(engine, (source) => {
    const wanted = plan[source.cardId];
    const target = (wanted && source.legalTargets.find((t) => t.type === "card" && t.cardId === wanted)) || source.legalTargets[0];
    if (!target || source.strength <= 0) return [];
    return [{ sourceId: source.cardId, target, amount: source.strength }];
  });
}

/** A tactic that deals `amount` damage to one picked character (decl `t`). */
function damageTactic(amount: number, name = `Smite${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dmg",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic that does nothing (used to open a response window). */
const noopTactic = (name = "Noop", cost = 0): CardDefinition => tactic({ name, cost, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } });

/** A battle board: `p1` and `p2` extra cards; the active player attacks (turn 2). */
function warBoard(p1: CardPlacement[], p2: CardPlacement[], opts: { active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [...p1, ...p2]
  });
}

const fighter = (key: string, owner: Pid, strength: number, life: number, speed = 2): CardPlacement => ({
  key,
  def: character({ name: key, strength, life, speed }),
  owner,
  zone: "play"
});

/**
 * Two games with a "first" and a "last" random source: the deck order of `player` differs between them iff the engine shuffled that deck.
 * `make` builds a board from a random source; `run` drives it.
 */
function deckWasShuffled(
  make: (random: () => number) => { engine: SpoilsEngine; id: IdOf },
  run: (game: { engine: SpoilsEngine; id: IdOf }) => void,
  player: Pid = P1
): boolean {
  const a = make(() => 0);
  const b = make(() => 0.9999999);
  run(a);
  run(b);
  const names = (g: { engine: SpoilsEngine }) => deckOf(g.engine, player).map((c) => g.engine.getDefinition(c).name);
  sameCards(names(a), names(b), "both runs ended with the same cards in the deck");
  return JSON.stringify(names(a)) !== JSON.stringify(names(b));
}

// =============================================================================
// The node cycle: A Series of Tubes, Basic Node, Hub Node
// ETB: "you may search your deck for a node card and reveal it. If you do, put
// it into your hand." DEATH: "if this card is destroyed, destroy all other node
// cards."
// =============================================================================

const nodeChar = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => character({ name, subtype: ["node"], strength: 2, life: 2, speed: 2, ...over });
const nodeItem = (name: string, over: Partial<CardDefinition> = {}): CardDefinition => item({ name, subtype: ["node"], cost: 1, ...over });

interface NodeSpec {
  id: string;
  cost: number;
  strength: number;
  speed: number;
  life: number;
}

const TUBES = "6603117c-3807-4dd2-b834-fa1deb3a9418";
const BASIC_NODE = "874f78fc-7fef-4536-8196-4d6c8bdd566d";
const HUB_NODE = "b535b316-ed94-435f-b6fd-2042dfdc6f49";
const TUBES_SPEC: NodeSpec = { id: TUBES, cost: 5, strength: 5, speed: 3, life: 5 };
const BASIC_SPEC: NodeSpec = { id: BASIC_NODE, cost: 1, strength: 1, speed: 4, life: 1 };
const HUB_SPEC: NodeSpec = { id: HUB_NODE, cost: 3, strength: 2, speed: 3, life: 2 };

function nodeEtbBoard(spec: NodeSpec, opts: { nodesInDeck?: boolean; inPlay?: boolean; random?: () => number; owner?: Pid } = {}) {
  const owner = opts.owner ?? P1;
  const foe = other(owner);
  const nodesInDeck = opts.nodesInDeck !== false;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    random: opts.random ?? seeded(),
    cards: [
      { key: "n", def: printing(spec.id), owner, zone: opts.inPlay ? "play" : "hand" },
      ...(nodesInDeck
        ? [
            { key: "nodeA", def: nodeChar("NodeA"), owner, zone: "deck" as const },
            { key: "nodeI", def: nodeItem("NodeI"), owner, zone: "deck" as const },
            { key: "nodeMulti", def: nodeChar("NodeMulti", { subtype: ["majig", "node"] }), owner, zone: "deck" as const }
          ]
        : []),
      { key: "plain", def: character({ name: "Plain" }), owner, zone: "deck" },
      { key: "nodeLike", def: character({ name: "Nodelike", subtype: ["noder"] }), owner, zone: "deck" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `f${i}`, def: character({ name: `F${i}` }), owner, zone: "deck" as const })),
      { key: "nodeHand", def: nodeChar("NodeHand"), owner, zone: "hand" },
      { key: "nodeDisc", def: nodeChar("NodeDisc"), owner, zone: "discard" },
      { key: "nodeBoard", def: nodeChar("NodeBoard"), owner, zone: "play" },
      { key: "oppNode", def: nodeChar("OppNode"), owner: foe, zone: "deck" },
      { key: "oppFiller", def: character({ name: "OppFiller" }), owner: foe, zone: "deck" },
      { key: "cheapNode", def: nodeChar("CheapNode", { cost: 0 }), owner, zone: "hand" },
      ...bank("elitism", spec.cost, owner)
    ]
  });
}

function nodeOffersSearch(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const before = ready(engine);
  play(engine, P1, id("n"));
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(before - ready(engine), spec.cost, "the printed cost is paid");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the controller may search");
  assert.equal(pending(engine)?.playerId, P1);
  assert.equal(engine.getStat(id("n"), "speed"), spec.speed);
}

function nodeNothingBeforeEnteringPlay(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  playRaw(engine, P1, id("n"));
  assert.equal(zoneOf(engine, id("nodeA")), "deck", "nothing is searched while the card is only being deployed");
  assert.equal(pending(engine), undefined, "no search yet: it is not in play");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("n")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "...it searches once it has entered play");
}

function nodeFindsAndReveals(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  pickCards(engine, [id("nodeA")]);
  assert.equal(zoneOf(engine, id("nodeA")), "hand", "put into your hand, not into play");
  assert.ok(handOf(engine).includes(id("nodeA")), "handOf(engine).includes(id(\"nodeA\"))");
  assert.equal(pending(engine), undefined);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "the found card is revealed once");
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [id("nodeA")]);
  assert.equal(event.viewerId, "all", "revealed to everyone");
}

function nodeFindsAnItem(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  pickCards(engine, [id("nodeI")]);
  assert.equal(zoneOf(engine, id("nodeI")), "hand", "a node ITEM is a 'node card' too");
  assert.deepEqual(revealedIds(engine), [id("nodeI")]);
}

function nodeFindsMultiSubtype(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  pickCards(engine, [id("nodeMulti")]);
  assert.equal(zoneOf(engine, id("nodeMulti")), "hand", "a card with several subtypes, one of them node, is a 'node card'");
}

function nodeSearchRestrictions(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  play(engine, P1, id("n"));
  refused(tryPick(engine, P1, [id("plain")]), "a non-node card in the deck");
  refused(tryPick(engine, P1, [id("nodeLike")]), "a card with a different subtype that merely looks like node");
  refused(tryPick(engine, P1, [id("nodeHand")]), "a node in hand");
  refused(tryPick(engine, P1, [id("nodeDisc")]), "a node in the discard pile");
  refused(tryPick(engine, P1, [id("nodeBoard")]), "a node already in play");
  refused(tryPick(engine, P1, [id("oppNode")]), "a node in the opponent's deck");
  refused(tryPick(engine, P1, [id("nodeA"), id("nodeI")]), "only one card");
  assert.ok(pending(engine), "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("nodeA")), "deck");
  tryPick(engine, P1, [id("nodeA")])();
  assert.equal(zoneOf(engine, id("nodeA")), "hand", "control: a node card from my deck is accepted");
}

function nodeSearchMayDecline(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const handBefore = [...handOf(engine)];
  play(engine, P1, id("n"));
  pickCards(engine, []);
  assert.deepEqual(handOf(engine), handBefore.filter((c) => c !== id("n")), "nothing was taken");
  assert.equal(zoneOf(engine, id("nodeA")), "deck");
  assert.equal(revealEvents(engine).length, 0, "nothing was revealed");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("n")), "play", "the node stays in play either way");
}

function nodeSearchShuffles(spec: NodeSpec) {
  const make = (random: () => number) => nodeEtbBoard(spec, { random });
  assert.equal(
    deckWasShuffled(make, (g) => {
      play(g.engine, P1, g.id("n"));
      pickCards(g.engine, [g.id("nodeA")]);
    }),
    true,
    "shuffled after taking a card (CR 312.1)"
  );
  assert.equal(
    deckWasShuffled(make, (g) => {
      play(g.engine, P1, g.id("n"));
      pickCards(g.engine, []);
    }),
    true,
    "shuffled after declining to take one (CR 312.1)"
  );
}

function nodeSearchLeavesOpponent(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec);
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("n"));
  pickCards(engine, [id("nodeA")]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
}

function nodeSearchFindsNothingShuffles(spec: NodeSpec) {
  const make = (random: () => number) => nodeEtbBoard(spec, { nodesInDeck: false, random });
  assert.equal(
    deckWasShuffled(make, (g) => {
      play(g.engine, P1, g.id("n"));
      drain(g.engine, declineAll);
    }),
    true,
    "searched and found nothing: the deck is shuffled anyway (CR 312.1)"
  );
}

function nodeSearchOnlyOnSelf(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec, { inPlay: true });
  play(engine, P1, id("cheapNode"));
  assert.equal(zoneOf(engine, id("cheapNode")), "play");
  assert.equal(pending(engine), undefined, "another node entering play does not make this card search");
  assert.equal(zoneOf(engine, id("nodeA")), "deck");
}

function nodeSearchOnPutIntoPlay(spec: NodeSpec) {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const g = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    random: seeded(),
    cards: [
      { key: "dead", def: printing(spec.id), owner: P1, zone: "discard" },
      { key: "raise", def: raise, owner: P1, zone: "hand" },
      { key: "nodeA", def: nodeChar("NodeA"), owner: P1, zone: "deck" },
      { key: "f0", def: character({ name: "F0" }), owner: P1, zone: "deck" }
    ]
  });
  play(g.engine, P1, g.id("raise"), { selected: { t: [g.id("dead")] } });
  assert.equal(zoneOf(g.engine, g.id("dead")), "play");
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget", "'enters play' includes being put into play: the search is offered");
  pickCards(g.engine, [g.id("nodeA")]);
  assert.equal(zoneOf(g.engine, g.id("nodeA")), "hand");
}

function nodeSecondPlayerSearch(spec: NodeSpec) {
  const { engine, id } = nodeEtbBoard(spec, { owner: P2 });
  play(engine, P2, id("n"));
  assert.equal(pending(engine)?.playerId, P2, "the node's controller chooses");
  pickCards(engine, [id("nodeA")]);
  assert.ok(handOf(engine, P2).includes(id("nodeA")), "THEIR hand receives the card");
  assert.equal(zoneOf(engine, id("oppNode")), "deck", "the other player's deck is untouched");
}

function nodeCardItself(spec: NodeSpec, enough: number, missing: { elitism: number; rage?: number }) {
  const mk = (elitism: number, rage: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      cards: [{ key: "n", def: printing(spec.id), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)]
    });
  // threshold met by already-spent [E], but one ready resource short of the cost
  const short = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "n", def: printing(spec.id), owner: P1, zone: "hand" }, ...bank("elitism", enough, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", spec.cost - 1, P1)]
  });
  refused(() => playRaw(short.engine, P1, short.id("n")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const wrong = mk(missing.elitism, missing.rage ?? spec.cost + 2);
  refused(() => playRaw(wrong.engine, P1, wrong.id("n")), "short of the [E] threshold", /Threshold requirements are not met/);
  const ok = mk(enough, spec.cost - enough);
  play(ok.engine, P1, ok.id("n"));
  assert.equal(zoneOf(ok.engine, ok.id("n")), "play");
  assert.equal(ready(ok.engine), 0, "exactly the printed cost was spent");
  assert.equal(ok.engine.getStat(ok.id("n"), "strength"), spec.strength);
  assert.equal(ok.engine.getStat(ok.id("n"), "speed"), spec.speed);
  assert.equal(ok.engine.getStat(ok.id("n"), "life"), spec.life);
  assert.deepEqual(ok.engine.getSubtypes(ok.id("n")), ["node"]);
}

// --- destroy all other node cards

function nodeWipeBoard(spec: NodeSpec) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "mineItem", def: nodeItem("MineItem"), owner: P1, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther" }), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "theirItem", def: nodeItem("TheirItem"), owner: P2, zone: "play" },
      { key: "theirOther", def: character({ name: "TheirOther" }), owner: P2, zone: "play" },
      { key: "theirThing", def: item({ name: "TheirThing", subtype: ["tool"] }), owner: P2, zone: "play" },
      { key: "theirPlace", def: location({ name: "TheirPlace", subtype: ["node"] }), owner: P2, zone: "play" },
      { key: "multi", def: nodeChar("Multi", { subtype: ["majig", "node"] }), owner: P2, zone: "play" },
      { key: "nodeHand", def: nodeChar("NodeHand"), owner: P1, zone: "hand" },
      { key: "nodeDeck", def: nodeChar("NodeDeck"), owner: P1, zone: "deck" },
      { key: "nodeDisc", def: nodeChar("NodeDisc"), owner: P1, zone: "discard" },
      { key: "oppNodeHand", def: nodeChar("OppNodeHand"), owner: P2, zone: "hand" },
      { key: "oppNodeDeck", def: nodeChar("OppNodeDeck"), owner: P2, zone: "deck" },
      { key: "oppNodeDisc", def: nodeChar("OppNodeDisc"), owner: P2, zone: "discard" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      {
        key: "exile",
        def: tactic({ name: "Exile", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] } }),
        owner: P1,
        zone: "hand"
      }
    ]
  });
}

const killNode = (engine: SpoilsEngine, id: IdOf): void => {
  play(engine, P1, id("kill"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
};

function nodeWipesEveryOther(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("n")), "discard");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem", "multi"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key} is a node card: destroyed`);
  for (const key of ["mineOther", "theirOther", "theirThing"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} is not a node: untouched`);
}

function nodeWipesNodeLocation(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("theirPlace")), "discard", "'all other node cards': a node location is a node card too");
}

function nodeWipeGoesToOwnersDiscard(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  killNode(engine, id);
  assert.ok(discardOf(engine, P1).includes(id("mineNode")), "my destroyed node is in MY discard pile");
  assert.ok(discardOf(engine, P2).includes(id("theirNode")), "their destroyed node is in THEIR discard pile");
  assert.ok(discardOf(engine, P2).includes(id("theirItem")), "discardOf(engine, P2).includes(id(\"theirItem\"))");
  assert.ok(!discardOf(engine, P1).includes(id("theirNode")), "!discardOf(engine, P1).includes(id(\"theirNode\"))");
}

function nodeWipeIgnoresOtherZones(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("nodeHand")), "hand");
  assert.equal(zoneOf(engine, id("nodeDeck")), "deck");
  assert.equal(zoneOf(engine, id("nodeDisc")), "discard");
  assert.equal(zoneOf(engine, id("oppNodeHand")), "hand");
  assert.equal(zoneOf(engine, id("oppNodeDeck")), "deck");
  assert.equal(zoneOf(engine, id("oppNodeDisc")), "discard");
}

function nodeNoWipeWhenBounced(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("bounce"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "hand");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "play", `${key}: only 'destroyed' triggers it`);
}

function nodeNoWipeWhenRemoved(spec: NodeSpec) {
  const { engine, id } = nodeWipeBoard(spec);
  play(engine, P1, id("exile"), { selected: { t: [id("n")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("n")), "removed");
  for (const key of ["mineNode", "mineItem", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "play", key);
}

function nodeWipesWhenKilledInBattle(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "theirItem", def: nodeItem("TheirItem"), owner: P2, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther" }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Brute", strength: 12, life: 30, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fightThrough(engine, P1, [id("n")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("n")), "discard", "killed in the battle");
  for (const key of ["mineNode", "theirNode", "theirItem"]) assert.equal(zoneOf(engine, id(key)), "discard", `${key}`);
  assert.equal(zoneOf(engine, id("mineOther")), "play");
  assert.equal(zoneOf(engine, id("blk")), "play");
}

function nodeSurvivingBattleDoesNotWipe(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 0, life: 9, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  fightThrough(engine, P1, [id("n")], { type: "faction", playerId: P2 }, [id("weak")]);
  assert.equal(zoneOf(engine, id("n")), "play", "it survived the battle");
  assert.equal(zoneOf(engine, id("mineNode")), "play", "no destruction, no wipe");
  assert.equal(zoneOf(engine, id("theirNode")), "play");
}

function nodeWipeIgnoresFaceDown(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "hidden", def: nodeChar("Hidden"), owner: P2, zone: "play", faceDown: true },
      { key: "visible", def: nodeChar("Visible"), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("visible")), "discard", "control: a face-up node is destroyed");
  assert.equal(zoneOf(engine, id("hidden")), "play", "a face-down card is a resource with no subtype: it is not a 'node card'");
}

function nodeWipeAlone(spec: NodeSpec) {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "n", def: printing(spec.id), owner: P1, zone: "play" }, { key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "bystander", def: character({ name: "Bystander" }), owner: P2, zone: "play" }]
  });
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("n")), "discard");
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.equal(pending(engine), undefined);
}

function nodeWipeChain(spec: NodeSpec) {
  // Destroying this node also destroys a second printed node (Basic Node), whose own
  // "destroy all other node cards" then runs: the result is the same, nothing else dies.
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "n", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "basic", def: printing(spec.id === BASIC_NODE ? HUB_NODE : BASIC_NODE), owner: P2, zone: "play" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "mineOther", def: character({ name: "MineOther" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  killNode(engine, id);
  assert.equal(zoneOf(engine, id("n")), "discard");
  assert.equal(zoneOf(engine, id("basic")), "discard", "another printed node is destroyed by the wipe");
  assert.equal(zoneOf(engine, id("mineNode")), "discard");
  assert.equal(zoneOf(engine, id("mineOther")), "play");
  assert.equal(pending(engine), undefined, "the chain leaves nothing open");
}

// --- A Series of Tubes (UNIQUE)

function tubesPairBoard() {
  return buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "t1", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "t2", def: printing(TUBES), owner: P1, zone: "hand" },
      { key: "bystander", def: nodeChar("Bystander"), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" },
      ...bank("elitism", 5, P1)
    ]
  });
}

for (const keep of ["t1", "t2"] as const) {
  clause(TUBES, "0:unique", `a second copy: its controller is asked which to keep (keeping ${keep === "t1" ? "the old" : "the new"} one); the other copy is destroyed`, () => {
    const { engine, id } = tubesPairBoard();
    play(engine, P1, id("t2"));
    const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates?: string[] };
    assert.equal(pc.kind, "uniqueSurvivor", "a 'keep one' choice is open");
    assert.equal(pc.playerId, P1, "its controller chooses");
    assert.deepEqual([...pc.candidates!].sort(), [id("t1"), id("t2")].sort());
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id(keep) } } as never);
    const destroyed = keep === "t1" ? "t2" : "t1";
    assert.equal(zoneOf(engine, id(destroyed)), "discard", "the copy that was not kept is destroyed");
    assert.ok(engine.state.players[P1].play.filter((c) => engine.getDefinition(c).unique === "series of tubes").length <= 1, "never two copies in play");
  });
}

clause(TUBES, "0:unique", "the destroyed copy is destroyed like any Tubes: its 'if this card is destroyed' rule then destroys every other node card, including the kept copy", () => {
  const { engine, id } = tubesPairBoard();
  play(engine, P1, id("t2"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("t2") } } as never);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("t1")), "discard", "destroyed by UNIQUE");
  assert.equal(zoneOf(engine, id("bystander")), "discard", "another node card: destroyed by the dying Tubes");
  assert.equal(zoneOf(engine, id("t2")), "discard", "the kept Tubes is a node card too, so the dying copy takes it along");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(TUBES, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = tubesPairBoard();
  play(engine, P1, id("t2"));
  refused(
    () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("bystander") } } as never),
    "a card that is not one of the copies"
  );
  assert.equal(zoneOf(engine, id("bystander")), "play");
  assert.ok(pending(engine), "still waiting for a real answer");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("t1") } } as never);
  assert.equal(zoneOf(engine, id("t2")), "discard", "control: a real copy is accepted");
});

clause(TUBES, "0:unique", "a second copy in hand is no conflict until it enters play", () => {
  const { engine, id } = tubesPairBoard();
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("t1")), "play");
  assert.equal(zoneOf(engine, id("t2")), "hand");
});

clause(TUBES, "0:unique", "UNIQUE is per player: the opponent may control their own copy with no choice and no destruction", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "t1", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "t2", def: printing(TUBES), owner: P2, zone: "hand" },
      ...bank("elitism", 5, P2)
    ]
  });
  play(engine, P2, id("t2"));
  assert.notEqual(pending(engine)?.kind, "uniqueSurvivor", "no 'keep one' choice");
  assert.equal(zoneOf(engine, id("t1")), "play");
  assert.equal(zoneOf(engine, id("t2")), "play");
});

clause(TUBES, "0:unique", "only copies I CONTROL in play count: a copy in my discard pile or face-down in play is no conflict", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "t2", def: printing(TUBES), owner: P1, zone: "hand" },
      { key: "inDiscard", def: printing(TUBES), owner: P1, zone: "discard" },
      { key: "down", def: printing(TUBES), owner: P1, zone: "play", faceDown: true },
      ...bank("elitism", 5, P1)
    ]
  });
  play(engine, P1, id("t2"));
  assert.notEqual(pending(engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(engine, id("t2")), "play");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard");
});

clause(TUBES, "0:unique", "the designation, not the name: a different card with UNIQUE SERIES OF TUBES conflicts too", () => {
  const twin = character({ name: "Pipe Dream", unique: "series of tubes", cost: 0, strength: 1, life: 1, speed: 1 });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "t1", def: printing(TUBES), owner: P1, zone: "play" }, { key: "twin", def: twin, owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("twin"));
  const pc = pending(engine) as unknown as { kind: string; candidates?: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates!].sort(), [id("t1"), id("twin")].sort());
});

// --- 2:rule  All other node characters gain 1 strength and 1 life

function tubesAuraBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "mine", def: nodeChar("MineNode", { strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: nodeChar("TheirNode", { strength: 3, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 2, life: 2, speed: 2, subtype: ["lackey"] }), owner: P1, zone: "play" },
      { key: "multi", def: character({ name: "Multi", strength: 1, life: 1, speed: 1, subtype: ["majig", "node"] }), owner: P2, zone: "play" },
      { key: "nodeThing", def: nodeItem("NodeThing"), owner: P1, zone: "play" },
      ...extra
    ]
  });
}

clause(TUBES, "2:rule", "each of my other node characters gains exactly 1 strength and 1 life (2/2 -> 3/3), and nothing else changes", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  assert.equal(engine.getStat(id("mine"), "life"), 3);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "speed is unchanged");
});

clause(TUBES, "2:rule", "'all other': the opponent's node characters gain +1/+1 too (3/4 -> 4/5)", () => {
  const { engine, id } = tubesAuraBoard();
  assert.deepEqual(stats(engine, id("theirs")), [4, 5, 1]);
});

clause(TUBES, "2:rule", "a character with several subtypes including node also gains it", () => {
  const { engine, id } = tubesAuraBoard();
  assert.deepEqual(stats(engine, id("multi")), [2, 2, 1]);
});

clause(TUBES, "2:rule", "a character that is not a node is unaffected", () => {
  const { engine, id } = tubesAuraBoard();
  assert.deepEqual(stats(engine, id("plain")), [2, 2, 2]);
});

clause(TUBES, "2:rule", "'other': the Series of Tubes itself keeps its printed 5 / 5", () => {
  const { engine, id } = tubesAuraBoard();
  assert.deepEqual(stats(engine, id("t")), [5, 5, 3]);
});

clause(TUBES, "2:rule", "a node ITEM is not a character: the bonus does not make it one", () => {
  const { engine, id } = tubesAuraBoard();
  assert.equal(engine.getCardTypes(id("nodeThing")).includes("character"), false);
});

clause(TUBES, "2:rule", "a face-down card is only a resource, not a node character: it is not a character and gains nothing", () => {
  const { engine, id } = tubesAuraBoard([{ key: "hidden", def: nodeChar("Hidden", { strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getCardTypes(id("hidden")).includes("character"), false);
});

clause(TUBES, "2:rule", "a face-down card has no subtype (CR 411.1), so it is not a 'node' for anything", () => {
  const { engine, id } = tubesAuraBoard([{ key: "hidden", def: nodeChar("Hidden", { strength: 2, life: 2 }), owner: P1, zone: "play", faceDown: true }]);
  assert.equal(engine.getSubtypes(id("hidden")).includes("node"), false, "no subtype while face down");
});

clause(TUBES, "2:rule", "a node character in my hand, deck or discard pile gains nothing (the bonus is for characters in play)", () => {
  const { engine, id } = tubesAuraBoard([
    { key: "inHand", def: nodeChar("InHand", { strength: 2, life: 2 }), owner: P1, zone: "hand" },
    { key: "inDeck", def: nodeChar("InDeck", { strength: 2, life: 2 }), owner: P1, zone: "deck" },
    { key: "inDiscard", def: nodeChar("InDiscard", { strength: 2, life: 2 }), owner: P1, zone: "discard" }
  ]);
  for (const key of ["inHand", "inDeck", "inDiscard"]) assert.deepEqual(stats(engine, id(key)).slice(0, 2), [2, 2], key);
});

clause(TUBES, "2:rule", "the bonus is per Tubes and not cumulative with itself: one Tubes gives +1, an opposing Tubes gives another +1 (each also boosts the other Tubes)", () => {
  const { engine, id } = tubesAuraBoard([{ key: "t2", def: printing(TUBES), owner: P2, zone: "play" }]);
  assert.equal(engine.getStat(id("mine"), "strength"), 4, "2 + 1 + 1");
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(engine.getStat(id("t"), "strength"), 6, "my Tubes is an 'other node character' for their Tubes");
  assert.equal(engine.getStat(id("t2"), "life"), 6);
});

clause(TUBES, "2:rule", "the bonus ends when the Tubes leaves play", () => {
  const { engine, id } = tubesAuraBoard([{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  assert.equal(engine.getStat(id("mine"), "strength"), 3);
  play(engine, P1, id("bounce"), { selected: { t: [id("t")] } });
  assert.equal(zoneOf(engine, id("t")), "hand");
  assert.deepEqual(stats(engine, id("mine")), [2, 2, 2]);
  assert.deepEqual(stats(engine, id("theirs")), [3, 4, 1]);
});

clause(TUBES, "2:rule", "a Tubes in hand gives nothing", () => {
  const { engine, id } = buildGame({
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "hand" },
      { key: "mine", def: nodeChar("MineNode"), owner: P1, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "life"), 2);
});

clause(TUBES, "2:rule", "the bonus is real in battle: a node that took 2 damage survives with +1 life (2 life -> 3), and dies without (control)", () => {
  const run = (withTubes: boolean) => {
    const { engine, id } = warBoard(
      [
        ...(withTubes ? [{ key: "t", def: printing(TUBES), owner: P1, zone: "play" } as CardPlacement] : []),
        { key: "mine", def: nodeChar("MineNode", { strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" }
      ],
      [fighter("blk", P2, 2, 20, 2)]
    );
    fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, [id("blk")]);
    return { engine, id };
  };
  const control = run(false);
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: 2 damage kills a 2-life node");
  const boosted = run(true);
  assert.equal(zoneOf(boosted.engine, boosted.id("mine")), "play", "with +1 life 2 damage does not");
});

clause(TUBES, "2:rule", "the bonus is real in battle: a node deals its boosted strength (1 + 1 = 2)", () => {
  const { engine, id } = warBoard(
    [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "mine", def: nodeChar("MineNode", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ],
    [fighter("blk", P2, 1, 20, 2)]
  );
  fight(engine, P1, [id("mine")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(damageOn(engine, id("blk")), 2);
});

// --- 3:rule  ETB search (A Series of Tubes)

clause(TUBES, "3:rule", "enters play for 5 and its controller may search for a node card", () => nodeOffersSearch(TUBES_SPEC));
clause(TUBES, "3:rule", "nothing is searched until the Tubes has entered play", () => nodeNothingBeforeEnteringPlay(TUBES_SPEC));
clause(TUBES, "3:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(TUBES_SPEC));
clause(TUBES, "3:rule", "a node item can be found too", () => nodeFindsAnItem(TUBES_SPEC));
clause(TUBES, "3:rule", "a card with several subtypes including node can be found", () => nodeFindsMultiSubtype(TUBES_SPEC));
clause(TUBES, "3:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(TUBES_SPEC));
clause(TUBES, "3:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(TUBES_SPEC));
clause(TUBES, "3:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(TUBES_SPEC));
clause(TUBES, "3:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(TUBES_SPEC));
clause(TUBES, "3:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(TUBES_SPEC));
clause(TUBES, "3:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(TUBES_SPEC));
clause(TUBES, "3:rule", "'enters play' includes being put into play by an effect", () => nodeSearchOnPutIntoPlay(TUBES_SPEC));
clause(TUBES, "3:rule", "the second player's Tubes searches THEIR deck and the card goes to THEIR hand", () => nodeSecondPlayerSearch(TUBES_SPEC));
clause(TUBES, "3:rule", "the card itself: cost 5 with [E][E][E][E], printed 5 / 3 / 5", () => nodeCardItself(TUBES_SPEC, 4, { elitism: 3 }));

// --- 4:rule  destroyed: destroy all other node cards (A Series of Tubes)

clause(TUBES, "4:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(TUBES_SPEC));
clause(TUBES, "4:rule", "a node location is a node card too and is destroyed", () => nodeWipesNodeLocation(TUBES_SPEC));
clause(TUBES, "4:rule", "each destroyed node goes to its OWNER's discard pile", () => nodeWipeGoesToOwnersDiscard(TUBES_SPEC));
clause(TUBES, "4:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(TUBES_SPEC));
clause(TUBES, "4:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(TUBES_SPEC));
clause(TUBES, "4:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(TUBES_SPEC));
clause(TUBES, "4:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(TUBES_SPEC));
clause(TUBES, "4:rule", "surviving a battle it destroys nothing", () => nodeSurvivingBattleDoesNotWipe(TUBES_SPEC));
clause(TUBES, "4:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(TUBES_SPEC));
clause(TUBES, "4:rule", "another node's own wipe runs in the same destruction without anything else dying", () => nodeWipeChain(TUBES_SPEC));
clause(TUBES, "4:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(TUBES_SPEC));

// --- 1:ability:redirect  (A Series of Tubes)

function redirectBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "n", def: nodeChar("MineNode", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "m", def: nodeChar("MineNode2", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "f", def: nodeChar("FoeNode", { strength: 1, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: nodeItem("NodeThing"), owner: P1, zone: "play" },
      { key: "smite1", def: damageTactic(1), owner: P1, zone: "hand" },
      { key: "smite2", def: damageTactic(2), owner: P1, zone: "hand" },
      { key: "smite3", def: damageTactic(3), owner: P1, zone: "hand" },
      { key: "smite1b", def: damageTactic(1, "Smite1b"), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}

const redirectRaw = (engine: SpoilsEngine, id: IdOf, targetKey: string, player: Pid = P1) =>
  activateRaw(engine, player, id("t"), "redirect", { selected: { c: [id(targetKey)] } });
const useRedirect = (engine: SpoilsEngine, id: IdOf, targetKey: string): void => {
  redirectRaw(engine, id, targetKey);
  resolvePendingResponses(engine);
};
const smite = (engine: SpoilsEngine, id: IdOf, tacticKey: string, targetKey: string): void => play(engine, P1, id(tacticKey), { selected: { t: [id(targetKey)] } });

clause(TUBES, "1:ability:redirect", "control: without REDIRECT a 3-damage hit lands entirely on the node", () => {
  const { engine, id } = redirectBoard();
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id("n")), 3);
  assert.equal(damageOn(engine, id("t")), 0);
});

clause(TUBES, "1:ability:redirect", "the NEXT 1 damage to the picked node is inflicted to the Tubes instead: of a 3-damage hit, 1 goes to the Tubes and 2 stay on the node", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id("n")), 2, "3 - 1 redirected");
  assert.equal(damageOn(engine, id("t")), 1, "the Tubes took the 1");
});

clause(TUBES, "1:ability:redirect", "a 1-damage hit is entirely redirected: the node takes nothing and stays in play even at 1 life", () => {
  const { engine, id } = redirectBoard([{ key: "frail", def: nodeChar("Frail", { strength: 1, life: 1, speed: 2 }), owner: P1, zone: "play" }]);
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id("n")), 0);
  assert.equal(damageOn(engine, id("t")), 1);
  useRedirect(engine, id, "frail");
  smite(engine, id, "smite1b", "frail");
  assert.equal(damageOn(engine, id("frail")), 0, "the frail node took nothing");
  assert.equal(zoneOf(engine, id("frail")), "play", "a redirected hit kills nothing");
  assert.equal(damageOn(engine, id("t")), 2);
});

clause(TUBES, "1:ability:redirect", "it is 'the next 1 damage' only: once used, a later hit lands on the node in full", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  smite(engine, id, "smite2", "n");
  assert.equal(damageOn(engine, id("n")), 2, "the second hit is not redirected");
  assert.equal(damageOn(engine, id("t")), 1, "the Tubes still has only the first 1");
});

clause(TUBES, "1:ability:redirect", "only the picked character: damage to another node is not redirected, and the shield stays for the picked one", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite2", "m");
  assert.equal(damageOn(engine, id("m")), 2, "the other node takes its full damage");
  assert.equal(damageOn(engine, id("t")), 0);
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id("n")), 0, "the shield on the picked node was still there");
  assert.equal(damageOn(engine, id("t")), 1);
});

clause(TUBES, "1:ability:redirect", "two uses on the same node protect against 2 damage in total (3 damage: 1 + 1 redirected, 1 left on the node)", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  useRedirect(engine, id, "n");
  smite(engine, id, "smite3", "n");
  assert.equal(damageOn(engine, id("t")), 2);
  assert.equal(damageOn(engine, id("n")), 1);
});

clause(TUBES, "1:ability:redirect", "two uses on two different nodes each shield their own node", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  useRedirect(engine, id, "m");
  smite(engine, id, "smite2", "n");
  smite(engine, id, "smite3", "m");
  assert.equal(damageOn(engine, id("n")), 1);
  assert.equal(damageOn(engine, id("m")), 2);
  assert.equal(damageOn(engine, id("t")), 2);
});

clause(TUBES, "1:ability:redirect", "it works on the OPPONENT's node character too ('a node character'): the damage lands on my Tubes", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "f");
  smite(engine, id, "smite2", "f");
  assert.equal(damageOn(engine, id("f")), 1);
  assert.equal(damageOn(engine, id("t")), 1);
});

clause(TUBES, "1:ability:redirect", "the Tubes may pick itself (it is a node character); nothing is doubled or lost", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "t");
  smite(engine, id, "smite3", "t");
  assert.equal(damageOn(engine, id("t")), 3, "the damage to the Tubes is inflicted to the Tubes");
});

clause(TUBES, "1:ability:redirect", "the shield holds for the rest of the turn it was set up: a hit later in the same turn is still redirected", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  smite(engine, id, "smite2", "m");
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id("n")), 0);
  assert.equal(damageOn(engine, id("t")), 1);
});

clause(TUBES, "1:ability:redirect", "'This turn': an unused shield is gone next turn (a hit a turn later lands on the node in full)", () => {
  const { engine, id } = redirectBoard();
  useRedirect(engine, id, "n");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id("n")), 1, "the redirect only lasted for the turn it was used");
  assert.equal(damageOn(engine, id("t")), 0, "nothing was redirected to the Tubes");
});

clause(TUBES, "1:ability:redirect", "only a NODE character can be picked: a non-node character, a node item, a faction, a face-down card and a node in hand are refused", () => {
  const { engine, id } = redirectBoard([
    { key: "hidden", def: nodeChar("Hidden"), owner: P1, zone: "play", faceDown: true },
    { key: "inHand", def: nodeChar("InHand"), owner: P1, zone: "hand" },
    { key: "inDiscard", def: nodeChar("InDiscard"), owner: P1, zone: "discard" }
  ]);
  refused(() => redirectRaw(engine, id, "plain"), "a non-node character");
  refused(() => redirectRaw(engine, id, "thing"), "a node item is not a character");
  refused(() => activateRaw(engine, P1, id("t"), "redirect", { selected: { c: [factionOf(engine, P2)] } }), "a faction");
  refused(() => redirectRaw(engine, id, "hidden"), "a face-down card is not a character");
  refused(() => redirectRaw(engine, id, "inHand"), "a node character in hand is not in play");
  refused(() => redirectRaw(engine, id, "inDiscard"), "a node character in the discard pile is not in play");
  redirectRaw(engine, id, "n");
  assert.ok(engine.state.responseWindow, "control: a node character is accepted");
});

clause(TUBES, "1:ability:redirect", "exactly one node character must be picked", () => {
  const { engine, id } = redirectBoard();
  refused(() => activateRaw(engine, P1, id("t"), "redirect", { selected: { c: [] } }), "no pick");
  refused(() => activateRaw(engine, P1, id("t"), "redirect", { selected: { c: [id("n"), id("m")] } }), "two picks");
  refused(() => activateRaw(engine, P1, id("t"), "redirect", {}), "no selection at all");
  activateRaw(engine, P1, id("t"), "redirect", { selected: { c: [id("n")] } });
  assert.ok(engine.state.responseWindow, "control: exactly one pick is accepted");
});

clause(TUBES, "1:ability:redirect", "it costs nothing: no resources are paid and the Tubes does not deplete (usable even when depleted)", () => {
  const { engine, id } = redirectBoard([...bank("elitism", 3, P1)]);
  engine.state.cards[id("t")].depleted = true;
  const before = ready(engine);
  useRedirect(engine, id, "n");
  assert.equal(ready(engine), before, "no resources paid");
  assert.equal(engine.state.cards[id("t")].depleted, true, "it was already depleted and that did not matter");
  smite(engine, id, "smite1", "n");
  assert.equal(damageOn(engine, id("t")), 1);
  const fresh = redirectBoard();
  useRedirect(fresh.engine, fresh.id, "n");
  assert.equal(fresh.engine.state.cards[fresh.id("t")].depleted, false, "using it does not deplete the Tubes");
});

clause(TUBES, "1:ability:redirect", "only its controller can use it", () => {
  const { engine, id } = redirectBoard();
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  refused(() => redirectRaw(engine, id, "f", P2), "the opponent of the Tubes' controller", /control|own|activate|not.*yours?/i);
});

clause(TUBES, "1:ability:redirect", "it works against battle damage: a node blocking a 3-strength attacker takes 2, the Tubes 1", () => {
  const { engine, id } = warBoard(
    [
      { key: "t", def: printing(TUBES), owner: P1, zone: "play" },
      { key: "n", def: nodeChar("MineNode", { strength: 1, life: 3, speed: 2 }), owner: P1, zone: "play" }
    ],
    [fighter("atk", P2, 3, 20, 2)],
    { active: P2 }
  );
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlock(engine, P1, [id("n")]);
  passUntil(engine, P1);
  redirectRaw(engine, id, "n");
  resolvePendingResponses(engine);
  resolveSending(engine, { [id("atk")]: id("n") });
  assert.equal(damageOn(engine, id("n")), 2, "the node took 3 - 1 = 2 (its life is 3 + 1 from the Tubes, so it survives)");
  assert.equal(damageOn(engine, id("t")), 1);
});

clause(TUBES, "1:ability:redirect", "the Tubes really takes the damage: if that is lethal it is destroyed and its destroy-all-nodes rule fires", () => {
  const { engine, id } = redirectBoard();
  engine.state.cards[id("t")].damage = 4;
  useRedirect(engine, id, "n");
  smite(engine, id, "smite1", "n");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("t")), "discard", "5 damage on a 5-life Tubes");
  assert.equal(zoneOf(engine, id("n")), "discard", "every other node card is destroyed");
  assert.equal(zoneOf(engine, id("m")), "discard");
  assert.equal(zoneOf(engine, id("f")), "discard");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

// --- Basic Node

clause(BASIC_NODE, "0:rule", "enters play for 1 and its controller may search for a node card", () => nodeOffersSearch(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "nothing is searched until the Basic Node has entered play", () => nodeNothingBeforeEnteringPlay(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "a node item can be found too", () => nodeFindsAnItem(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "a card with several subtypes including node can be found", () => nodeFindsMultiSubtype(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "'enters play' includes being put into play by an effect", () => nodeSearchOnPutIntoPlay(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the second player's Basic Node searches THEIR deck and the card goes to THEIR hand", () => nodeSecondPlayerSearch(BASIC_SPEC));
clause(BASIC_NODE, "0:rule", "the card itself: cost 1 with [E], printed 1 / 4 / 1", () => nodeCardItself(BASIC_SPEC, 1, { elitism: 0 }));
clause(BASIC_NODE, "1:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "a node location is a node card too and is destroyed", () => nodeWipesNodeLocation(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "each destroyed node goes to its OWNER's discard pile", () => nodeWipeGoesToOwnersDiscard(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "surviving a battle it destroys nothing", () => nodeSurvivingBattleDoesNotWipe(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "another node's own wipe runs in the same destruction without anything else dying", () => nodeWipeChain(BASIC_SPEC));
clause(BASIC_NODE, "1:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(BASIC_SPEC));

// --- Hub Node

clause(HUB_NODE, "0:rule", "enters play for 3 and its controller may search for a node card", () => nodeOffersSearch(HUB_SPEC));
clause(HUB_NODE, "0:rule", "nothing is searched until the Hub Node has entered play", () => nodeNothingBeforeEnteringPlay(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the chosen node card is put into your hand and revealed to everyone", () => nodeFindsAndReveals(HUB_SPEC));
clause(HUB_NODE, "0:rule", "a node item can be found too", () => nodeFindsAnItem(HUB_SPEC));
clause(HUB_NODE, "0:rule", "a card with several subtypes including node can be found", () => nodeFindsMultiSubtype(HUB_SPEC));
clause(HUB_NODE, "0:rule", "only a node card from your deck, and only one", () => nodeSearchRestrictions(HUB_SPEC));
clause(HUB_NODE, "0:rule", "'may': the search can be declined, with nothing taken or revealed", () => nodeSearchMayDecline(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the deck is shuffled afterwards, whether a card was taken or not", () => nodeSearchShuffles(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the opponent's deck and hand are untouched", () => nodeSearchLeavesOpponent(HUB_SPEC));
clause(HUB_NODE, "0:rule", "a search that finds no node card still shuffles the deck (CR 312.1)", () => nodeSearchFindsNothingShuffles(HUB_SPEC));
clause(HUB_NODE, "0:rule", "it searches only when THIS card enters play", () => nodeSearchOnlyOnSelf(HUB_SPEC));
clause(HUB_NODE, "0:rule", "'enters play' includes being put into play by an effect", () => nodeSearchOnPutIntoPlay(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the second player's Hub Node searches THEIR deck and the card goes to THEIR hand", () => nodeSecondPlayerSearch(HUB_SPEC));
clause(HUB_NODE, "0:rule", "the card itself: cost 3 with [E][E], printed 2 / 3 / 2 when alone", () => nodeCardItself(HUB_SPEC, 2, { elitism: 1 }));
clause(HUB_NODE, "1:rule", "destroyed, it destroys every other node card in play (both players', characters and items); non-nodes stay", () => nodeWipesEveryOther(HUB_SPEC));
clause(HUB_NODE, "1:rule", "a node location is a node card too and is destroyed", () => nodeWipesNodeLocation(HUB_SPEC));
clause(HUB_NODE, "1:rule", "each destroyed node goes to its OWNER's discard pile", () => nodeWipeGoesToOwnersDiscard(HUB_SPEC));
clause(HUB_NODE, "1:rule", "node cards in hand, deck and discard pile are not affected", () => nodeWipeIgnoresOtherZones(HUB_SPEC));
clause(HUB_NODE, "1:rule", "bounced to hand (not destroyed) it destroys nothing", () => nodeNoWipeWhenBounced(HUB_SPEC));
clause(HUB_NODE, "1:rule", "removed from the game (not destroyed) it destroys nothing", () => nodeNoWipeWhenRemoved(HUB_SPEC));
clause(HUB_NODE, "1:rule", "killed in battle it destroys all other node cards", () => nodeWipesWhenKilledInBattle(HUB_SPEC));
clause(HUB_NODE, "1:rule", "surviving a battle it destroys nothing", () => nodeSurvivingBattleDoesNotWipe(HUB_SPEC));
clause(HUB_NODE, "1:rule", "destroyed with no other node in play it just dies", () => nodeWipeAlone(HUB_SPEC));
clause(HUB_NODE, "1:rule", "another node's own wipe runs in the same destruction without anything else dying", () => nodeWipeChain(HUB_SPEC));
clause(HUB_NODE, "1:rule", "a face-down card is not a 'node card' and is not destroyed", () => nodeWipeIgnoresFaceDown(HUB_SPEC));

// --- Hub Node 2:rule  gains 1 strength and 1 life for each other node card in play

function hubBoard(extra: CardPlacement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "hub", def: printing(HUB_NODE), owner: P1, zone: "play" }, ...extra]
  });
}
const hubStats = (engine: SpoilsEngine, id: IdOf) => stats(engine, id("hub"));

clause(HUB_NODE, "2:rule", "alone it has its printed 2 / 2 / speed 3", () => {
  const { engine, id } = hubBoard();
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "with one other node of mine in play: +1 strength, +1 life (3 / 3), speed unchanged", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A"), owner: P1, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "one more for each other node: three others give +3 / +3", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
    { key: "b", def: nodeChar("B"), owner: P1, zone: "play" },
    { key: "c", def: nodeChar("C"), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(hubStats(engine, id), [5, 5, 3]);
});

clause(HUB_NODE, "2:rule", "the opponent's node cards count too ('each other node card in play')", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A"), owner: P2, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "node cards that are not characters count too (a node item and a node location)", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeItem("A"), owner: P1, zone: "play" },
    { key: "b", def: nodeItem("B"), owner: P2, zone: "play" },
    { key: "c", def: location({ name: "C", subtype: ["node"] }), owner: P2, zone: "play" }
  ]);
  assert.deepEqual(hubStats(engine, id), [5, 5, 3]);
});

clause(HUB_NODE, "2:rule", "a card with several subtypes including node counts", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A", { subtype: ["majig", "node"] }), owner: P1, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "cards that are not nodes do not count", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: character({ name: "A", subtype: ["lackey"] }), owner: P1, zone: "play" },
    { key: "b", def: item({ name: "B", subtype: ["tool"] }), owner: P2, zone: "play" },
    { key: "c", def: location({ name: "C", subtype: [] }), owner: P1, zone: "play" }
  ]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "node cards in hand, deck and discard pile do not count (only 'in play')", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "hand" },
    { key: "b", def: nodeChar("B"), owner: P1, zone: "deck" },
    { key: "c", def: nodeChar("C"), owner: P1, zone: "discard" },
    { key: "d", def: nodeChar("D"), owner: P2, zone: "hand" }
  ]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "a face-down node card is a resource, not a node card: it is not counted", () => {
  const { engine, id } = hubBoard([{ key: "hidden", def: nodeChar("Hidden"), owner: P2, zone: "play", faceDown: true }]);
  assert.deepEqual(hubStats(engine, id), [2, 2, 3]);
});

clause(HUB_NODE, "2:rule", "it does not count itself: two Hub Nodes each count the other (+1 each)", () => {
  const { engine, id } = hubBoard([{ key: "hub2", def: printing(HUB_NODE), owner: P2, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
  assert.deepEqual(stats(engine, id("hub2")), [3, 3, 3]);
});

clause(HUB_NODE, "2:rule", "it is live: when a counted node leaves play the bonus shrinks, and grows when one enters", () => {
  const { engine, id } = hubBoard([
    { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
    { key: "b", def: nodeChar("B"), owner: P2, zone: "play" },
    { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
    { key: "late", def: nodeChar("Late", { cost: 0 }), owner: P1, zone: "hand" }
  ]);
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
  play(engine, P1, id("bounce"), { selected: { t: [id("b")] } });
  assert.deepEqual(hubStats(engine, id), [3, 3, 3]);
  play(engine, P1, id("late"));
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
});

clause(HUB_NODE, "2:rule", "it only changes the Hub Node itself: another node's stats are untouched by it", () => {
  const { engine, id } = hubBoard([{ key: "a", def: nodeChar("A", { strength: 2, life: 2 }), owner: P1, zone: "play" }]);
  assert.equal(engine.getStat(id("a"), "strength"), 2, "a plain node next to the Hub Node gets no bonus");
  assert.equal(engine.getStat(id("a"), "life"), 2);
});

clause(HUB_NODE, "2:rule", "with an A Series of Tubes in play the Hub Node gets the Tubes' +1/+1 AND counts the Tubes (2 + 1 + 1 = 4)", () => {
  const { engine, id } = hubBoard([{ key: "tubes", def: printing(TUBES), owner: P1, zone: "play" }]);
  assert.deepEqual(hubStats(engine, id), [4, 4, 3]);
});

clause(HUB_NODE, "2:rule", "the bonus is real in battle: a Hub Node with two other nodes (4 / 4) survives 3 damage that would kill the printed 2-life card, and deals 4", () => {
  const { engine, id } = warBoard(
    [
      { key: "hub", def: printing(HUB_NODE), owner: P1, zone: "play" },
      { key: "a", def: nodeChar("A"), owner: P1, zone: "play" },
      { key: "b", def: nodeChar("B"), owner: P2, zone: "play" }
    ],
    [fighter("blk", P2, 3, 30, 2)]
  );
  fight(engine, P1, [id("hub")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(zoneOf(engine, id("hub")), "play");
  assert.equal(damageOn(engine, id("hub")), 3);
  assert.equal(damageOn(engine, id("blk")), 4, "its strength is 2 + 2 = 4");
});

// =============================================================================
// Invent
// COST: Choose a number for X. Pay X+X. EFFECT: Search your deck for X-1 cards.
// Put them into your hand.
// Tactic, gearsmith, cost 0, threshold [E][E][E].
// =============================================================================

const INVENT = "d981ff5f-4b6f-4bf5-aec0-6a05479215eb";

function inventBoard(opts: { elitism?: number; rage?: number; deck?: number; random?: () => number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "iv", def: printing(INVENT), owner: P1, zone: "hand" },
      ...fillers("d", opts.deck ?? 6, P1, "deck"),
      { key: "dItem", def: item({ name: "DItem" }), owner: P1, zone: "deck" },
      { key: "dTactic", def: tactic({ name: "DTactic", cost: 1 }), owner: P1, zone: "deck" },
      { key: "dLocation", def: location({ name: "DLocation" }), owner: P1, zone: "deck" },
      ...fillers("o", 4, P2, "deck"),
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const [x, cards] of [
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 3]
] as const) {
  clause(INVENT, "0:ability", `X=${x}: pays ${2 * x} (X+X), searches for ${cards} card(s) and puts ${cards === 0 ? "none" : "them"} into my hand`, () => {
    const { engine, id } = inventBoard();
    const picks = ["d1", "dItem", "d4"].slice(0, cards).map(id);
    const deckBefore = [...deckOf(engine)];
    const handBefore = handOf(engine).length;
    const spent = spentBy(engine, P1, () => play(engine, P1, id("iv"), { variables: { x } }));
    assert.equal(spent, 2 * x, "pays X+X (its own printed cost is 0)");
    if (cards > 0) {
      assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
      assert.equal(pending(engine)?.playerId, P1);
      pickCards(engine, picks);
    } else {
      drain(engine, declineAll);
    }
    assert.equal(pending(engine), undefined);
    for (const cardId of picks) assert.equal(zoneOf(engine, cardId), "hand", "found cards go to my hand");
    assert.equal(handOf(engine).length, handBefore - 1 + cards, "the tactic left; exactly X-1 cards arrived");
    assert.equal(deckOf(engine).length, deckBefore.length - cards);
    assert.equal(zoneOf(engine, id("iv")), "discard");
  });
}

clause(INVENT, "0:ability", "the cost (X+X) is paid when the tactic is played, before the opponent can respond, and nothing is searched yet", () => {
  const { engine, id } = inventBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("iv"), { variables: { x: 3 } });
  assert.equal(before - ready(engine), 6, "6 resources are paid up front");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  assert.equal(pending(engine), undefined, "the search happens on resolution, not while the cost is paid");
  assert.equal(attachedCount(engine, P1), 6);
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now the search is offered");
});

clause(INVENT, "0:ability", "X=0 is legal and free: it can be played with just [E][E][E] and no other resource, and nothing is spent", () => {
  const { engine, id } = inventBoard({ elitism: 3 });
  playRaw(engine, P1, id("iv"), { variables: { x: 0 } });
  assert.ok(engine.state.responseWindow, "the play was accepted");
  assert.equal(ready(engine), 3, "X+X = 0: nothing was spent");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(INVENT, "0:ability", "X=0 (a legal number): searching for X-1 = -1 cards means no cards (CR 410.4), so the tactic resolves completely and leaves no prompt that cannot be answered", () => {
  const { engine, id } = inventBoard();
  const deckBefore = [...deckOf(engine)];
  const handBefore = handOf(engine).length;
  play(engine, P1, id("iv"), { variables: { x: 0 } });
  if (pending(engine)) pickCards(engine, []);
  assert.equal(pending(engine), undefined, "nothing is left to answer");
  assert.equal(zoneOf(engine, id("iv")), "discard", "the tactic finished and went to the discard pile");
  assert.equal(handOf(engine).length, handBefore - 1, "no card was found");
  sameCards(deckOf(engine), deckBefore);
});

clause(INVENT, "0:ability", "the cards found may be of any type (character, item, tactic, location)", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 5 } });
  pickCards(engine, [id("dItem"), id("dTactic"), id("dLocation"), id("d0")]);
  for (const key of ["dItem", "dTactic", "dLocation", "d0"]) assert.equal(zoneOf(engine, id(key)), "hand", key);
});

clause(INVENT, "0:ability", "'search your deck for X-1 cards' (no criteria) must find all X-1 cards: finding fewer is refused (CR 312.2: only a search with specific criteria may fail)", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 3 } });
  refused(tryPick(engine, P1, [id("d0")]), "one card is fewer than X-1 = 2");
  refused(tryPick(engine, P1, []), "no card at all");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(engine, [id("d0"), id("d1")]);
  assert.equal(zoneOf(engine, id("d0")), "hand", "control: exactly X-1 cards are accepted");
});

clause(INVENT, "0:ability", "no more than X-1 cards: X=3 with three cards picked is refused, and so is the same card twice", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 3 } });
  refused(tryPick(engine, P1, [id("d0"), id("d1"), id("d2")]), "three cards for X-1 = 2");
  refused(tryPick(engine, P1, [id("d0"), id("d0")]), "the same card twice");
  pickCards(engine, [id("d0"), id("d1")]);
  assert.equal(zoneOf(engine, id("d1")), "hand", "control: two distinct cards are accepted");
  assert.equal(zoneOf(engine, id("d2")), "deck");
});

clause(INVENT, "0:ability", "only cards from MY DECK: my hand, my discard pile and the opponent's deck are refused", () => {
  const { engine, id } = inventBoard();
  play(engine, P1, id("iv"), { variables: { x: 2 } });
  refused(tryPick(engine, P1, [id("inHand")]), "my hand");
  refused(tryPick(engine, P1, [id("inDiscard")]), "my discard pile");
  refused(tryPick(engine, P1, [id("o0")]), "the opponent's deck");
  pickCards(engine, [id("d0")]);
  assert.equal(zoneOf(engine, id("d0")), "hand", "control: a card from my deck is accepted");
});

clause(INVENT, "0:ability", "the controller searches (not the opponent), and the opponent's deck and hand are untouched", () => {
  const { engine, id } = inventBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("iv"), { variables: { x: 2 } });
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [id("d0")]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
});

clause(INVENT, "0:ability", "a deck with fewer than X-1 cards: I find all of them", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "iv", def: printing(INVENT), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...bank("elitism", 12, P1)
    ]
  });
  play(engine, P1, id("iv"), { variables: { x: 6 } });
  pickCards(engine, [id("d0"), id("d1")]);
  assert.equal(deckOf(engine).length, 0);
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(zoneOf(engine, id("d1")), "hand");
});

clause(INVENT, "0:ability", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const make = (random: () => number) => inventBoard({ random });
  assert.equal(
    deckWasShuffled(make, (g) => {
      play(g.engine, P1, g.id("iv"), { variables: { x: 2 } });
      pickCards(g.engine, [g.id("d0")]);
    }),
    true,
    "shuffled after the search"
  );
});

clause(INVENT, "0:ability", "the opponent's deck is not shuffled", () => {
  const make = (random: () => number) => inventBoard({ random });
  assert.equal(
    deckWasShuffled(
      make,
      (g) => {
        play(g.engine, P1, g.id("iv"), { variables: { x: 2 } });
        pickCards(g.engine, [g.id("d0")]);
      },
      P2
    ),
    false,
    "their deck keeps its order"
  );
});

clause(INVENT, "0:ability", "X cannot be negative", () => {
  const { engine, id } = inventBoard();
  refused(() => playRaw(engine, P1, id("iv"), { variables: { x: -1 } }), "X = -1");
  assert.equal(zoneOf(engine, id("iv")), "hand");
  assert.equal(ready(engine), 12);
});

clause(INVENT, "0:ability", "X must be a whole number (CR 410.2): X = 1.5 is refused", () => {
  const { engine, id } = inventBoard();
  refused(() => playRaw(engine, P1, id("iv"), { variables: { x: 1.5 } }), "X = 1.5");
  assert.equal(zoneOf(engine, id("iv")), "hand");
  assert.equal(ready(engine), 12, "nothing was paid");
});

clause(INVENT, "0:ability", "is refused when X+X exceeds my resources (X=3 with 5, X=2 with 3) and accepted with exactly enough", () => {
  const five = inventBoard({ elitism: 5 });
  refused(() => playRaw(five.engine, P1, five.id("iv"), { variables: { x: 3 } }), "needs 6, has 5");
  assert.equal(zoneOf(five.engine, five.id("iv")), "hand");
  const exact = inventBoard({ elitism: 6 });
  play(exact.engine, P1, exact.id("iv"), { variables: { x: 3 } });
  pickCards(exact.engine, [exact.id("d0"), exact.id("d1")]);
  assert.equal(ready(exact.engine), 0, "exactly 6 spent");
  const three = inventBoard({ elitism: 3 });
  refused(() => playRaw(three.engine, P1, three.id("iv"), { variables: { x: 2 } }), "X=2 needs 4, has 3");
  play(three.engine, P1, three.id("iv"), { variables: { x: 1 } });
  assert.equal(ready(three.engine), 1, "X=1 with three resources pays 2");
});

clause(INVENT, "0:ability", "is refused without [E][E][E] even with plenty of other resources (the icons are a gate, not a cost)", () => {
  const twoE = inventBoard({ elitism: 2, rage: 10 });
  refused(() => playRaw(twoE.engine, P1, twoE.id("iv"), { variables: { x: 0 } }), "only two [E], X=0");
  refused(() => playRaw(twoE.engine, P1, twoE.id("iv"), { variables: { x: 2 } }), "only two [E], X=2");
  const threeE = inventBoard({ elitism: 3, rage: 10 });
  play(threeE.engine, P1, threeE.id("iv"), { variables: { x: 2 } });
  pickCards(threeE.engine, [threeE.id("d0")]);
  assert.equal(ready(threeE.engine), 13 - 4, "4 paid, the three [E] stay as icons");
});

clause(INVENT, "0:ability", "it is a tactic with cost 0: it can be played on the opponent's turn in response to their action", () => {
  const { engine, id } = inventBoard({ active: P2, extra: [{ key: "p2noop", def: noopTactic("Their Noop"), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("iv"), { variables: { x: 2 } });
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [id("d0")]);
  assert.equal(zoneOf(engine, id("d0")), "hand");
  assert.equal(zoneOf(engine, id("iv")), "discard");
});

clause(INVENT, "0:ability", "a deck of exactly X-1 cards: they all come to my hand and the deck is empty", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "iv", def: printing(INVENT), owner: P1, zone: "hand" },
      { key: "d0", def: character({ name: "D0" }), owner: P1, zone: "deck" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      ...bank("elitism", 8, P1)
    ]
  });
  play(engine, P1, id("iv"), { variables: { x: 3 } });
  pickCards(engine, [id("d0"), id("d1")]);
  assert.equal(deckOf(engine).length, 0);
  assert.equal(handOf(engine).length, 2);
});

// =============================================================================
// Jo Ciendeilio
// UNIQUE JO. RESEARCH -- COST: Deplete this card. -- EFFECT: Reduce the next
// numeric cost you pay this turn by 3.
// Character (inventor), gearsmith, cost 5, threshold [E][E][E][E], 1 / 3 / 1.
// =============================================================================

const JO = "c3b21f68-4574-4d53-8840-fcbd1775bfbb";

/** A character whose ability costs "pay N" (ability `payN`), and one with a free ability (`free`). */
const payerChar = (amount: number): CardDefinition =>
  character({
    name: `Payer ${amount}`,
    strength: 1,
    life: 3,
    behavior: { abilities: [{ id: "payN", type: "activated", costs: [{ type: "payResources", amount }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
const drawerChar = (): CardDefinition =>
  character({ name: "Drawer", strength: 1, life: 3, behavior: { abilities: [{ id: "free", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
/** A character with a printed cost and an extra "pay N" cost. */
const extraPayChar = (cost: number, extra: number): CardDefinition =>
  character({ name: `Extra ${cost}+${extra}`, cost, behavior: { onPlay: { costs: [{ type: "payResources", amount: extra }], effects: [] } } });
const costly = (name: string, cost: number): CardDefinition => character({ name, cost, strength: 1, life: 2, speed: 1 });

function joBoard(opts: { elitism?: number; rage?: number; joZone?: "play" | "hand"; attackEligible?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "jo", def: printing(JO), owner: P1, zone: opts.joZone ?? "play", attackEligible: opts.attackEligible },
      { key: "c1", def: costly("C1", 1), owner: P1, zone: "hand" },
      { key: "c2", def: costly("C2", 2), owner: P1, zone: "hand" },
      { key: "c3", def: costly("C3", 3), owner: P1, zone: "hand" },
      { key: "c4", def: costly("C4", 4), owner: P1, zone: "hand" },
      { key: "c5", def: costly("C5", 5), owner: P1, zone: "hand" },
      { key: "c5b", def: costly("C5b", 5), owner: P1, zone: "hand" },
      { key: "c6", def: costly("C6", 6), owner: P1, zone: "hand" },
      { key: "t6", def: tactic({ name: "T6", cost: 6, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "payer", def: payerChar(4), owner: P1, zone: "play" },
      { key: "drawer", def: drawerChar(), owner: P1, zone: "play" },
      { key: "oppTactic", def: noopTactic("OppTactic", 3), owner: P2, zone: "hand" },
      ...fillers("a", 6, P1, "deck"),
      ...fillers("b", 3, P2, "deck"),
      ...bank("elitism", opts.elitism ?? 16, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("rage", 5, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const research = (engine: SpoilsEngine, id: IdOf): void => activate(engine, P1, id("jo"), "research");

clause(JO, "0:unique", "playing a second copy makes me choose which one to keep; keeping the new one destroys the old one", () => {
  const { engine, id } = joBoard({ extra: [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }] });
  play(engine, P1, id("jo2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [id("jo"), id("jo2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("jo2") });
  assert.equal(zoneOf(engine, id("jo2")), "play");
  assert.equal(zoneOf(engine, id("jo")), "discard", "the other copy is destroyed");
  assert.equal(pending(engine), undefined);
});

clause(JO, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = joBoard({ extra: [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }] });
  play(engine, P1, id("jo2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("jo") });
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("jo2")), "discard");
});

clause(JO, "0:unique", "the 'keep' answer must name one of the copies", () => {
  const { engine, id } = joBoard({ extra: [{ key: "jo2", def: printing(JO), owner: P1, zone: "hand" }] });
  play(engine, P1, id("jo2"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("drawer") } } as never), "a card that is not a copy");
  assert.ok(pending(engine), "still waiting for a real answer");
  answerPending(engine, "uniqueSurvivor", { keep: id("jo") });
  assert.equal(zoneOf(engine, id("jo2")), "discard", "control: a real copy is accepted");
});

clause(JO, "0:unique", "a card of a different name with the same designation JO counts (UNIQUE is about the designation, not the name)", () => {
  const otherJo = character({ name: "Some Other Jo", unique: "jo", cost: 0, strength: 1, life: 1, speed: 1 });
  const { engine, id } = joBoard({ extra: [{ key: "other", def: otherJo, owner: P1, zone: "hand" }] });
  play(engine, P1, id("other"));
  const pc = pending(engine) as unknown as { kind: string; candidates: string[] };
  assert.ok(pc, "UNIQUE JO covers every card with that designation");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.deepEqual([...pc.candidates].sort(), [id("jo"), id("other")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("jo") });
  assert.equal(zoneOf(engine, id("other")), "discard");
});

clause(JO, "0:unique", "the restriction is per player: my opponent can control their own copy without any choice", () => {
  const { engine, id } = joBoard({ extra: [{ key: "oppJo", def: printing(JO), owner: P2, zone: "play" }] });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("oppJo")), "play");
});

clause(JO, "0:unique", "an opponent playing their own copy while I control one: no choice, both stay", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [{ key: "mine", def: printing(JO), owner: P1, zone: "play" }, { key: "theirs", def: printing(JO), owner: P2, zone: "hand" }, ...bank("elitism", 5, P2)]
  });
  play(engine, P2, id("theirs"));
  assert.notEqual(pending(engine)?.kind, "uniqueSurvivor");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(JO, "0:unique", "only copies I CONTROL in play count: a copy in my hand, discard pile or face-down in play does not stop me playing another", () => {
  const { engine, id } = joBoard({
    joZone: "hand",
    extra: [
      { key: "handJo", def: printing(JO), owner: P1, zone: "hand" },
      { key: "discardJo", def: printing(JO), owner: P1, zone: "discard" },
      { key: "downJo", def: printing(JO), owner: P1, zone: "play", faceDown: true }
    ]
  });
  play(engine, P1, id("jo"));
  assert.equal(pending(engine), undefined, "no other copy is in play face-up under my control");
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("handJo")), "hand");
});

clause(JO, "0:unique", "'control', not 'own': a copy I own but my opponent controls does not count against me", () => {
  const { engine, id } = joBoard({ joZone: "hand", extra: [{ key: "stolen", def: printing(JO), owner: P1, zone: "play", controller: P2 }] });
  assert.equal(engine.state.cards[id("stolen")].controllerId, P2);
  play(engine, P1, id("jo"));
  assert.equal(pending(engine), undefined, "I do not control the other copy");
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(zoneOf(engine, id("stolen")), "play");
});

clause(JO, "1:ability:research", "depletes this card, spends nothing, and asks for no choice (the reduction is exactly 3, no 'up to')", () => {
  const { engine, id } = joBoard();
  const resources = ready(engine);
  research(engine, id);
  assert.equal(engine.state.cards[id("jo")].depleted, true, "COST: Deplete this card");
  assert.equal(ready(engine), resources, "no resources are spent");
  assert.equal(attachedCount(engine, P1), 0);
  assert.equal(pending(engine), undefined, "the controller isn't asked how much to reduce: it is 3");
});

for (const [key, printed, paid] of [
  ["c6", 6, 3],
  ["c5", 5, 2],
  ["c4", 4, 1],
  ["c3", 3, 0],
  ["c2", 2, 0],
  ["c1", 1, 0]
] as const) {
  clause(JO, "1:ability:research", `the next numeric cost I pay is reduced by 3: a cost-${printed} character pays ${paid}`, () => {
    const { engine, id } = joBoard();
    research(engine, id);
    assert.equal(spentBy(engine, P1, () => play(engine, P1, id(key))), paid);
    assert.equal(zoneOf(engine, id(key)), "play");
  });
}

clause(JO, "1:ability:research", "a numeric cost below 3 is reduced only to 0, never below (CR 406.6): no resource is refunded or created", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  const before = ready(engine);
  play(engine, P1, id("c2"));
  assert.equal(ready(engine), before, "a free card costs nothing and leaves the resources alone");
});

clause(JO, "1:ability:research", "...and a tactic of cost 6 pays 3", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("t6"))), 3);
  assert.equal(zoneOf(engine, id("t6")), "discard");
});

clause(JO, "1:ability:research", "only the NEXT numeric cost: the cost after it is paid in full", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5b"))), 5);
});

clause(JO, "1:ability:research", "the reduction is not in force before RESEARCH resolves: while it waits for responses the next cost is still full", () => {
  const { engine, id } = joBoard();
  activateRaw(engine, P1, id("jo"), "research");
  assert.equal(engine.getCardPlayability(P1, id("c5")).numericCost, 5, "the EFFECT has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(engine.getCardPlayability(P1, id("c5")).numericCost, 2);
});

clause(JO, "1:ability:research", "the next numeric cost can be an ability's 'pay N' (CR 406.5): an ability that costs 'pay 4' costs 1, then the next one is full price", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("payer"), "payN")), 1);
  assert.equal(spentBy(engine, P1, () => activate(engine, P1, id("payer"), "payN")), 4);
});

clause(JO, "1:ability:research", "...so a card played AFTER such an ability gets no reduction (the ability used it)", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  activate(engine, P1, id("payer"), "payN");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "the reduction covers the whole numeric cost of the next card, including a 'pay' extra cost (CR 406.3): cost 2 + pay 5 = 7, reduced to 4", () => {
  const { engine, id } = joBoard({ extra: [{ key: "ec", def: extraPayChar(2, 5), owner: P1, zone: "hand" }] });
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("ec"))), 4);
});

clause(JO, "1:ability:research", "the reduction covers Invent's 'pay X+X' extra cost (CR 406.3): X=2 (pay 4) costs 1", () => {
  const { engine, id } = joBoard({ extra: [{ key: "invent", def: printing(INVENT), owner: P1, zone: "hand" }] });
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("invent"), { variables: { x: 2 } })), 4 - 3);
});

clause(JO, "1:ability:research", "'this turn': an unused reduction is gone in the next turn", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "the threshold is not reduced: a discounted card that needs [R][R] is still refused without them", () => {
  const needsRage = character({ name: "NeedsRage", cost: 5, threshold: "rr" as never });
  const { engine, id } = joBoard({ extra: [{ key: "nr", def: needsRage, owner: P1, zone: "hand" }] });
  research(engine, id);
  refused(() => playRaw(engine, P1, id("nr")), "no [R] icons");
  assert.equal(zoneOf(engine, id("nr")), "hand");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2, "the refused attempt did not use the reduction");
});

clause(JO, "1:ability:research", "only for me: while my reduction is waiting, my opponent's tactic costs them full price and my reduction stays", () => {
  const { engine, id } = joBoard();
  research(engine, id);
  activateRaw(engine, P1, id("drawer"), "free");
  const theirs = spentBy(engine, P2, () => playRaw(engine, P2, id("oppTactic")));
  assert.equal(theirs, 3, "my opponent pays the full 3");
  resolvePendingResponses(engine);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2, "my reduction is still waiting for me");
});

clause(JO, "1:ability:research", "cannot be used while depleted (the cost is depleting it); nothing is reduced by the refused attempt", () => {
  const { engine, id } = joBoard();
  engine.state.cards[id("jo")].depleted = true;
  refused(() => research(engine, id), "Jo is depleted");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 5);
});

clause(JO, "1:ability:research", "can be used the turn Jo enters play, and again after Jo restores next turn", () => {
  const { engine, id } = joBoard({ attackEligible: false });
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5"))), 2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("jo")].depleted, false);
  research(engine, id);
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("c5b"))), 2);
});

clause(JO, "1:ability:research", "only its controller can use it", () => {
  const { engine, id } = joBoard();
  refused(() => activateRaw(engine, P2, id("jo"), "research"), "the opponent", /control|own|activate|yours?/i);
  assert.equal(engine.state.cards[id("jo")].depleted, false);
  research(engine, id);
  assert.equal(engine.state.cards[id("jo")].depleted, true, "control: the controller can");
});

clause(JO, "1:ability:research", "deploys for exactly 5 with [E][E][E][E] (refused one short or with three [E]) and has its printed 1 strength / 1 life / 3 speed, subtype inventor", () => {
  const only = (elitism: number, rage: number) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "jo", def: printing(JO), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)] });
  const short = only(4, 0);
  refused(() => playRaw(short.engine, P1, short.id("jo")), "4 resources");
  const threeE = only(3, 8);
  refused(() => playRaw(threeE.engine, P1, threeE.id("jo")), "three [E]");
  const { engine, id } = only(4, 1);
  play(engine, P1, id("jo"));
  assert.equal(zoneOf(engine, id("jo")), "play");
  assert.equal(ready(engine), 0, "exactly 5 spent");
  assert.deepEqual(stats(engine, id("jo")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("jo")), ["inventor"]);
});

// =============================================================================
// Acuminous Gigantitect
// GRAND DESIGN -- COST: Pay 2. Discard a card. Deplete this card. -- EFFECT:
// Reduce the next numeric cost you pay this turn by 6.
// Character (inventor), gearsmith, cost 5, threshold [E][E], 3 / 3 / 3.
// =============================================================================

const GIGANTITECT = "a1fc2149-53c3-4544-b967-440a1952947a";

function gigBoard(opts: { resources?: number; handCards?: number; depleted?: boolean; gig2?: boolean; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "gig", def: printing(GIGANTITECT), owner: P1, zone: "play", depleted: opts.depleted },
      ...(opts.gig2 ? [{ key: "gig2", def: printing(GIGANTITECT), owner: P1, zone: "play" as const }] : []),
      ...fillers("h", opts.handCards ?? 4, P1, "hand"),
      ...fillers("d", 6, P1, "deck"),
      { key: "c14", def: costly("Cost Fourteen", 14), owner: P1, zone: "hand" },
      { key: "c10", def: costly("Cost Ten", 10), owner: P1, zone: "hand" },
      { key: "c8", def: costly("Cost Eight", 8), owner: P1, zone: "hand" },
      { key: "c7", def: costly("Cost Seven", 7), owner: P1, zone: "hand" },
      { key: "c6", def: costly("Cost Six", 6), owner: P1, zone: "hand" },
      { key: "c3", def: costly("Cost Three", 3), owner: P1, zone: "hand" },
      { key: "c0", def: costly("Cost Zero", 0), owner: P1, zone: "hand" },
      { key: "t7", def: tactic({ name: "Cost Seven Tactic", cost: 7, behavior: { abilities: [{ id: "noop", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      { key: "payer5", def: payerChar(5), owner: P1, zone: "play" },
      { key: "payer8", def: payerChar(8), owner: P1, zone: "play" },
      { key: "foeC", def: costly("Their Cost Eight", 8), owner: P2, zone: "hand" },
      ...fillers("f", 4, P2, "deck"),
      ...bank("rage", opts.resources ?? 30, P1),
      ...bank("rage", 12, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** Uses GRAND DESIGN, discarding `discardKey`. */
const grandDesign = (engine: SpoilsEngine, id: IdOf, gigKey = "gig", discardKey = "h0"): void =>
  activate(engine, P1, id(gigKey), "grand", { selected: { d: [id(discardKey)] } });

/** The resources a play of `cardKey` costs (before - after), including the response-window drain. */
const costOfPlaying = (engine: SpoilsEngine, id: IdOf, cardKey: string, opts: { selected?: Record<string, CardInstanceId[]> } = {}): number =>
  spentBy(engine, P1, () => play(engine, P1, id(cardKey), opts));

clause(GIGANTITECT, "0:ability:grand", "COST is paid when it is used: 2 resources, the chosen card discarded and the Gigantitect depleted, before the opponent can respond", () => {
  const { engine, id } = gigBoard();
  const before = ready(engine);
  activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } });
  assert.equal(before - ready(engine), 2, "pay 2");
  assert.equal(zoneOf(engine, id("h0")), "discard", "the card is discarded");
  assert.ok(discardOf(engine).includes(id("h0")), "discardOf(engine).includes(id(\"h0\"))");
  assert.equal(engine.state.cards[id("gig")].depleted, true, "deplete this card");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 8, "the reduction is the EFFECT: it isn't in force while the ability waits for responses");
  resolvePendingResponses(engine);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2, "once it has resolved the next cost is reduced by 6");
});

clause(GIGANTITECT, "0:ability:grand", "EFFECT: the next card I deploy costs 6 less: a cost-8 character costs exactly 2 resources", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
  assert.equal(zoneOf(engine, id("c8")), "play");
});

clause(GIGANTITECT, "0:ability:grand", "...exactly 6 less, not more or less: costs 14 -> 8, 10 -> 4, 7 -> 1, 6 -> 0", () => {
  for (const [key, paid] of [
    ["c14", 8],
    ["c10", 4],
    ["c7", 1],
    ["c6", 0]
  ] as const) {
    const { engine, id } = gigBoard();
    grandDesign(engine, id);
    assert.equal(costOfPlaying(engine, id, key), paid, key);
  }
});

clause(GIGANTITECT, "0:ability:grand", "a cost lower than 6 is reduced only to 0 (CR 406.6): cost 3 and cost 0 cost nothing", () => {
  for (const key of ["c3", "c0"]) {
    const { engine, id } = gigBoard();
    grandDesign(engine, id);
    assert.equal(costOfPlaying(engine, id, key), 0, key);
    assert.equal(zoneOf(engine, id(key)), "play");
  }
});

clause(GIGANTITECT, "0:ability:grand", "it works for any card type: a cost-7 tactic costs 1", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "t7"), 1);
  assert.equal(zoneOf(engine, id("t7")), "discard", "the tactic resolved");
});

clause(GIGANTITECT, "0:ability:grand", "'the NEXT numeric cost': only one cost is reduced; the card after it costs full price", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
  assert.equal(costOfPlaying(engine, id, "c7"), 7, "the reduction was used up");
  assert.equal(engine.getCardPlayability(P1, id("c6")).numericCost, 6);
});

clause(GIGANTITECT, "0:ability:grand", "an ability's 'pay N' is a numeric cost too (CR 406.5): the next ability cost is reduced (Pay 8 costs 2, Pay 5 costs nothing)", () => {
  const eight = gigBoard();
  grandDesign(eight.engine, eight.id);
  assert.equal(spentBy(eight.engine, P1, () => activate(eight.engine, P1, eight.id("payer8"), "payN")), 2, "Pay 8 reduced by 6");
  const five = gigBoard();
  grandDesign(five.engine, five.id);
  assert.equal(spentBy(five.engine, P1, () => activate(five.engine, P1, five.id("payer5"), "payN")), 0, "Pay 5 reduced to 0");
});

clause(GIGANTITECT, "0:ability:grand", "...and that uses the reduction up: the card deployed afterwards costs full price", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  activate(engine, P1, id("payer8"), "payN");
  assert.equal(costOfPlaying(engine, id, "c7"), 7);
});

clause(GIGANTITECT, "0:ability:grand", "it applies to the whole numeric cost including 'pay' extra costs (CR 406.3): cost 5 + extra 'pay 3' = 8, reduced to 2", () => {
  const { engine, id } = gigBoard({ extra: [{ key: "ec", def: extraPayChar(5, 3), owner: P1, zone: "hand" }] });
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "ec"), 2);
});

clause(GIGANTITECT, "0:ability:grand", "only YOUR cost: the opponent's next numeric cost is not reduced", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(engine.getCardPlayability(P2, id("foeC")).numericCost, 8, "their card still costs 8 while I hold a reduction");
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2, "(control) mine is reduced");
});

clause(GIGANTITECT, "0:ability:grand", "'this turn': an unused reduction is gone on the next turn", () => {
  const { engine, id } = gigBoard();
  grandDesign(engine, id);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 8, "the unused reduction did not carry over");
  assert.equal(costOfPlaying(engine, id, "c8"), 8);
});

clause(GIGANTITECT, "0:ability:grand", "two uses: the second Grand Design's own 'pay 2' is the NEXT numeric cost (made free by the first reduction), so the card after it gets only the second reduction (14 -> 8) and the one after pays full price", () => {
  const { engine, id } = gigBoard({ gig2: true });
  grandDesign(engine, id, "gig", "h0");
  const before = ready(engine);
  activate(engine, P1, id("gig2"), "grand", { selected: { d: [id("h1")] } });
  assert.equal(before - ready(engine), 0, "pay 2 is reduced by 6 to 0 (and uses the first reduction up)");
  assert.equal(engine.state.cards[id("gig2")].depleted, true);
  assert.equal(zoneOf(engine, id("h1")), "discard", "its other costs were still paid");
  assert.equal(costOfPlaying(engine, id, "c14"), 8, "only the second reduction is left");
  assert.equal(costOfPlaying(engine, id, "c7"), 7, "...and it is used up");
});

clause(GIGANTITECT, "0:ability:grand", "the discard must be a card in my hand: cards in play, discard pile, deck or the opponent's hand are refused, nothing is paid", () => {
  const { engine, id } = gigBoard({ extra: [{ key: "old", def: character({ name: "Old" }), owner: P1, zone: "discard" }, { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" }] });
  const before = ready(engine);
  const attempt = (cardId: CardInstanceId) => () => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [cardId] } });
  refused(attempt(id("payer5")), "a card in play");
  refused(attempt(id("old")), "a card in the discard pile");
  refused(attempt(id("d0")), "a card in the deck");
  refused(attempt(id("theirHand")), "the opponent's hand");
  refused(attempt(id("gig")), "the Gigantitect itself");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(engine.state.cards[id("gig")].depleted, false);
  attempt(id("h1"))();
  assert.equal(zoneOf(engine, id("h1")), "discard", "control: a hand card is accepted");
});

clause(GIGANTITECT, "0:ability:grand", "any card in hand can be discarded (even a costly character or tactic), exactly one", () => {
  const { engine, id } = gigBoard();
  refused(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [] } }), "none");
  refused(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0"), id("h1")] } }), "two");
  refused(() => activateRaw(engine, P1, id("gig"), "grand", {}), "no selection");
  grandDesign(engine, id, "gig", "t7");
  assert.equal(zoneOf(engine, id("t7")), "discard");
});

clause(GIGANTITECT, "0:ability:grand", "with an empty hand it can't be used", () => {
  const { engine, id } = gigBoard({ handCards: 0 });
  for (const key of ["c14", "c10", "c8", "c7", "c6", "c3", "c0", "t7"]) engine.state.cards[id(key)].zone = "discard";
  engine.state.players[P1].hand.length = 0;
  refused(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [] } }), "no card to discard");
  assert.equal(engine.state.cards[id("gig")].depleted, false);
});

clause(GIGANTITECT, "0:ability:grand", "is refused one resource short of the pay-2 cost: nothing is discarded or depleted", () => {
  const { engine, id } = gigBoard({ resources: 1 });
  refused(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } }), "1 resource");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(engine.state.cards[id("gig")].depleted, false);
  assert.equal(ready(engine), 1);
  const exact = gigBoard({ resources: 2 });
  grandDesign(exact.engine, exact.id);
  assert.equal(exact.engine.state.cards[exact.id("gig")].depleted, true, "exactly 2 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(GIGANTITECT, "0:ability:grand", "needs no resource icons: two resources of any kind pay for it", () => {
  const { engine, id } = gigBoard({ resources: 0, extra: bank("deception", 2, P1) });
  grandDesign(engine, id);
  assert.equal(engine.state.cards[id("gig")].depleted, true);
});

clause(GIGANTITECT, "0:ability:grand", "a depleted Gigantitect can't use it (refused, nothing paid); next turn it is restored and can", () => {
  const { engine, id } = gigBoard({ depleted: true });
  const before = ready(engine);
  refused(() => activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } }), "already depleted");
  assert.equal(ready(engine), before);
  assert.equal(zoneOf(engine, id("h0")), "hand");
  endTurn(engine, P1);
  endTurn(engine, P2);
  grandDesign(engine, id);
  assert.equal(engine.state.cards[id("gig")].depleted, true);
});

clause(GIGANTITECT, "0:ability:grand", "only its controller may use it", () => {
  const { engine, id } = gigBoard();
  refused(() => activateRaw(engine, P2, id("gig"), "grand", { selected: { d: [id("foeC")] } }), "the opponent", /control|own|activate|yours?|hand/i);
  assert.equal(engine.state.cards[id("gig")].depleted, false);
});

clause(GIGANTITECT, "0:ability:grand", "it can be used the turn the Gigantitect enters play (abilities have no summoning sickness)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gig", def: printing(GIGANTITECT), owner: P1, zone: "hand" },
      ...fillers("h", 2, P1, "hand"),
      { key: "c8", def: costly("Cost Eight", 8), owner: P1, zone: "hand" },
      ...bank("elitism", 2, P1),
      ...bank("rage", 14, P1)
    ]
  });
  play(engine, P1, id("gig"));
  assert.equal(zoneOf(engine, id("gig")), "play");
  grandDesign(engine, id);
  assert.equal(costOfPlaying(engine, id, "c8"), 2);
});

clause(GIGANTITECT, "0:ability:grand", "the reduction is the controller's even if the Gigantitect is destroyed in response (the ability resolves as paid)", () => {
  const { engine, id } = gigBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("gig"), "grand", { selected: { d: [id("h0")] } });
  playRaw(engine, P2, id("kill"), { selected: { t: [id("gig")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gig")), "discard", "destroyed in response");
  assert.equal(engine.getCardPlayability(P1, id("c8")).numericCost, 2, "CR 502.4: the ability still takes effect");
});

clause(GIGANTITECT, "0:ability:grand", "the card itself deploys for exactly 5 with [E][E] (refused one short or with one [E]) and has its printed 3 / 3 / 3, subtype inventor", () => {
  const only = (elitism: number, rage: number) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "gig", def: printing(GIGANTITECT), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)] });
  const short = only(2, 2);
  refused(() => playRaw(short.engine, P1, short.id("gig")), "4 resources");
  const oneE = only(1, 8);
  refused(() => playRaw(oneE.engine, P1, oneE.id("gig")), "one [E]");
  const { engine, id } = only(2, 3);
  play(engine, P1, id("gig"));
  assert.equal(zoneOf(engine, id("gig")), "play");
  assert.equal(ready(engine), 0, "exactly 5 spent");
  assert.deepEqual(stats(engine, id("gig")), [3, 3, 3]);
  assert.deepEqual(engine.getSubtypes(id("gig")), ["inventor"]);
});

// =============================================================================
// Hidden Sandwich
// ATTACH TO CHARACTER. You may play this card whenever you could play a tactic.
// If the attached character is destroyed, destroy this card instead. Reduce the
// amount of damage inflicted to the character this turn to 0.
// Item (gear), gearsmith, cost 3, threshold [E][E].
// =============================================================================

const SANDWICH = "0254473b-3a7a-418f-b541-74a3a57d2978";

function sandwichBoard(opts: { elitism?: number; rage?: number; extra?: CardPlacement[]; attached?: boolean; active?: Pid; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active,
    cards: [
      { key: "sw", def: printing(SANDWICH), owner: P1, zone: opts.attached ? "play" : "hand", attachedToKey: opts.attached ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeKill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" },
      { key: "myKill", def: killTactic({ name: "MyKill" }), owner: P1, zone: "hand" },
      { key: "zap1", def: damageTactic(1), owner: P1, zone: "hand" },
      { key: "zap2", def: damageTactic(2), owner: P1, zone: "hand" },
      { key: "zap3", def: damageTactic(3), owner: P1, zone: "hand" },
      { key: "zap9", def: damageTactic(9), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...bank("rage", opts.rage ?? 0, P1),
      ...bank("rage", 4, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const attachSandwich = (engine: SpoilsEngine, id: IdOf, hostKey: string, cardKey = "sw"): void => play(engine, P1, id(cardKey), { selected: { attachTo: [id(hostKey)] } });
const sandwichRaw = (engine: SpoilsEngine, id: IdOf, hostKey: string, player: Pid = P1, cardKey = "sw"): void =>
  engine.perform({ type: "playCard", playerId: player, cardId: id(cardKey), selected: { attachTo: [id(hostKey)] }, variables: {} } as never);

clause(SANDWICH, "0:attach", "played on my turn: pays 3 and enters play attached to the character I pick (under my control)", () => {
  const { engine, id } = sandwichBoard();
  const spent = spentBy(engine, P1, () => attachSandwich(engine, id, "host"));
  assert.equal(spent, 3, "the printed cost of 3");
  assert.equal(zoneOf(engine, id("sw")), "play");
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("sw")].controllerId, P1);
  assert.equal(engine.state.cards[id("other")].attachedTo, undefined);
});

clause(SANDWICH, "0:attach", "the ATTACH TO cost is a pick made when it is played: it enters play attached only once it has resolved", () => {
  const { engine, id } = sandwichBoard();
  sandwichRaw(engine, id, "host");
  assert.notEqual(zoneOf(engine, id("sw")), "play", "waiting on the stack for responses");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("sw")), "play");
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"));
});

clause(SANDWICH, "0:attach", "can be attached to an opponent's character, too (any character)", () => {
  const { engine, id } = sandwichBoard();
  attachSandwich(engine, id, "foe");
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("foe"));
  assert.equal(engine.state.cards[id("sw")].controllerId, P1, "I still control the Sandwich");
});

clause(SANDWICH, "0:attach", "must be attached to a CHARACTER: an item, a location, a faction, a face-down resource, and a character in hand or discard are refused", () => {
  const { engine, id } = sandwichBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...volition(1, P1).map((p) => ({ ...p, key: "downResource" }))
    ]
  });
  const attempt = (hostId: CardInstanceId) => () => playRaw(engine, P1, id("sw"), { selected: { attachTo: [hostId] } });
  refused(attempt(id("thing")), "item");
  refused(attempt(id("place")), "location");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("downResource")), "face-down card");
  refused(attempt(id("inHand")), "hand");
  refused(attempt(id("inDiscard")), "discard pile");
  refused(() => playRaw(engine, P1, id("sw"), { selected: {} }), "a host must be picked");
  refused(() => playRaw(engine, P1, id("sw"), { selected: { attachTo: [id("host"), id("other")] } }), "only one host");
  assert.equal(zoneOf(engine, id("sw")), "hand");
  attempt(id("host"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(SANDWICH, "0:attach", "with no character in play it cannot be played", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "sw", def: printing(SANDWICH), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]
  });
  refused(() => playRaw(engine, P1, id("sw"), { selected: {} }), "no character to attach to");
  assert.equal(zoneOf(engine, id("sw")), "hand");
});

clause(SANDWICH, "0:attach", "when the host leaves play by other means than destruction, the Sandwich leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("sw")), "hand", "leaves play the same way (CR 301.4a)");
  assert.equal(engine.state.cards[id("sw")].attachedTo, undefined);
});

clause(SANDWICH, "0:attach", "is refused one resource short of its cost of 3, and without [E][E] even with plenty of other resources", () => {
  const attempt = (elitism: number, rage: number) => {
    const board = sandwichBoard({ elitism, rage });
    return { ...board, run: () => playRaw(board.engine, P1, board.id("sw"), { selected: { attachTo: [board.id("host")] } }) };
  };
  const short = attempt(2, 0);
  refused(short.run, "2 resources");
  assert.equal(zoneOf(short.engine, short.id("sw")), "hand");
  const oneE = attempt(1, 6);
  refused(oneE.run, "only one [E]");
  const exact = attempt(2, 1);
  exact.run();
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("sw")), "play", "[E][E] and exactly 3 resources is enough");
  assert.equal(ready(exact.engine), 0);
});

clause(SANDWICH, "0:attach", "has the printed type: an item with the gear subtype", () => {
  const { engine, id } = sandwichBoard();
  assert.deepEqual(engine.getCardTypes(id("sw")), ["item"]);
  assert.deepEqual(engine.getSubtypes(id("sw")), ["gear"]);
});

clause(SANDWICH, "0:attach", "several Sandwiches can sit on the same character", () => {
  const { engine, id } = sandwichBoard({ attached: true, extra: [{ key: "sw2", def: printing(SANDWICH), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("sw2")].attachedTo, id("host"));
});

// 1:rule — play whenever you could play a tactic

/** P2 (the active player) plays `FoeKill` on `host`; the Sandwich is played in response by P1. Leaves the kill unresolved until the window drains. */
function sandwichInResponse(engine: SpoilsEngine, id: IdOf, target = "host"): void {
  playRaw(engine, P2, id("foeKill"), { selected: { t: [id(target)] } });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond");
  sandwichRaw(engine, id, target);
}

clause(SANDWICH, "1:rule", "has the TACTICAL keyword (it can be deployed whenever a tactic could be)", () => {
  const { engine, id } = sandwichBoard();
  assert.ok(hasKeyword(engine, id("sw"), "tactical"), "hasKeyword(engine, id(\"sw\"), \"tactical\")");
});

clause(SANDWICH, "1:rule", "can be played on my OPPONENT's turn in response to their tactic: it resolves first and saves the character from that very tactic", () => {
  const { engine, id } = sandwichBoard({ active: P2 });
  const spent = spentBy(engine, P1, () => {
    sandwichInResponse(engine, id);
    resolvePendingResponses(engine);
  });
  assert.equal(spent, 3);
  assert.equal(zoneOf(engine, id("host")), "play", "the character survived the kill");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
  assert.equal(zoneOf(engine, id("foeKill")), "discard");
});

clause(SANDWICH, "1:rule", "can be played in a battle response window (my character is being attacked): attach it, and the lethal battle damage hits the Sandwich instead", () => {
  const { engine, id } = sandwichBoard({ active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 9, life: 9, speed: 3 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "the defender may act before blockers");
  sandwichRaw(engine, id, "host");
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("sw")].attachedTo, id("host"), "played during the battle");
  declareBlock(engine, P1, [id("host")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("host")), "play", "the blocker survived 9 battle damage");
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(damageOn(engine, id("host")), 0, "the damage is reduced to 0");
});

clause(SANDWICH, "1:rule", "control: an ordinary ATTACH TO CHARACTER item cannot be played on the opponent's turn in response", () => {
  const plain = item({ name: "PlainAttach", cost: 0, attachTo: "character" });
  const { engine, id } = sandwichBoard({ active: P2, extra: [{ key: "plain", def: plain, owner: P1, zone: "hand" }] });
  playRaw(engine, P2, id("foeKill"), { selected: { t: [id("host")] } });
  refused(() => sandwichRaw(engine, id, "host", P1, "plain"), "a non-tactical item needs my own turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  sandwichRaw(engine, id, "host");
  assert.ok(engine.state.responseWindow, "control: the Sandwich itself can be played in the same window");
});

clause(SANDWICH, "1:rule", "'whenever you could play a tactic': on the opponent's turn with no response window open it is refused, like a tactic", () => {
  const { engine, id } = sandwichBoard({ active: P2 });
  assert.equal(engine.state.responseWindow, undefined);
  refused(() => sandwichRaw(engine, id, "host"), "the opponent's turn, nothing to respond to", /Only the active player may deploy/);
  refused(() => playRaw(engine, P1, id("zap1"), { selected: { t: [id("foe")] } }), "control: a tactic is refused there too", /Only the active player may deploy/);
  assert.equal(zoneOf(engine, id("sw")), "hand");
});

// 2:rule — the replacement

clause(SANDWICH, "2:rule", "a destroy effect on the attached character destroys the Sandwich instead: the character stays in play", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "the character was not destroyed");
  assert.equal(zoneOf(engine, id("sw")), "discard", "this card was destroyed instead");
  assert.ok(discardOf(engine).includes(id("sw")), "discardOf(engine).includes(id(\"sw\"))");
  assert.equal(damageOn(engine, id("host")), 0);
  assert.equal(zoneOf(engine, id("other")), "play");
});

clause(SANDWICH, "2:rule", "the character does not go to the discard pile and loses nothing else: it is still the same card in play, undepleted", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.ok(!discardOf(engine).includes(id("host")), "!discardOf(engine).includes(id(\"host\"))");
  assert.equal(engine.state.cards[id("host")].depleted, false);
  assert.equal(engine.state.cards[id("host")].faceDown, false);
  assert.equal(engine.state.cards[id("host")].controllerId, P1);
});

clause(SANDWICH, "2:rule", "lethal damage that would destroy the character destroys the Sandwich instead, and the damage the character had is reduced to 0", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("zap3"), { selected: { t: [id("host")] } });
  assert.equal(damageOn(engine, id("host")), 3, "non-lethal damage stays (life 4)");
  assert.equal(zoneOf(engine, id("sw")), "play", "the Sandwich is not used for non-lethal damage");
  play(engine, P1, id("zap1"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "4 damage on a life-4 character would destroy it");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
  assert.equal(damageOn(engine, id("host")), 0, "the amount of damage inflicted to the character this turn is reduced to 0");
});

clause(SANDWICH, "2:rule", "massive damage (9 on a life-4 character) is also replaced, and the damage is cleared", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(damageOn(engine, id("host")), 0);
  assert.equal(zoneOf(engine, id("sw")), "discard");
});

clause(SANDWICH, "2:rule", "it works once: with the Sandwich gone, the next destruction kills the character", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard", "no Sandwich left");
});

clause(SANDWICH, "2:rule", "damage inflicted AFTER the replacement is ordinary damage: 2 more damage on the saved character stays on it", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(damageOn(engine, id("host")), 0);
  play(engine, P1, id("zap2"), { selected: { t: [id("host")] } });
  assert.equal(damageOn(engine, id("host")), 2, "the Sandwich is gone: nothing keeps reducing damage");
  assert.equal(zoneOf(engine, id("host")), "play");
});

clause(SANDWICH, "2:rule", "only the ATTACHED character is protected: other characters die normally", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("other")] } });
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "play", "the Sandwich was not used");
  play(engine, P1, id("zap9"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "two Sandwiches on one character: each destruction uses up only one of them", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1, extra: [{ key: "sw2", def: printing(SANDWICH), owner: P1, zone: "play", attachedToKey: "host" }] });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play");
  const used = [id("sw"), id("sw2")].filter((c) => zoneOf(engine, c) === "discard");
  assert.equal(used.length, 1, "exactly one Sandwich was destroyed");
  play(engine, P1, id("zap9"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "play", "the second Sandwich saves it again");
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(zoneOf(engine, id("sw2")), "discard");
});

clause(SANDWICH, "2:rule", "a Sandwich on my OPPONENT's character protects that character from my destroy effect (the card says the attached character, whoever it belongs to)", () => {
  const { engine, id } = sandwichBoard({ turn: 1 });
  attachSandwich(engine, id, "foe");
  play(engine, P1, id("myKill"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(zoneOf(engine, id("sw")), "discard");
});

clause(SANDWICH, "2:rule", "damage that does not destroy is kept: 2 damage on a life-4 character stays 2", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("zap2"), { selected: { t: [id("host")] } });
  assert.equal(damageOn(engine, id("host")), 2);
  assert.equal(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "the replaced destruction really does not happen: the character's own 'if this card is destroyed' rule does not fire (a Basic Node keeps every other node card)", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "node", def: printing(BASIC_NODE), owner: P1, zone: "play" },
      { key: "sw", def: printing(SANDWICH), owner: P1, zone: "play", attachedToKey: "node" },
      { key: "mineNode", def: nodeChar("MineNode"), owner: P1, zone: "play" },
      { key: "theirNode", def: nodeChar("TheirNode"), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("node")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("node")), "play");
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(zoneOf(engine, id("mineNode")), "play", "nothing was destroyed, so no wipe");
  assert.equal(zoneOf(engine, id("theirNode")), "play");
});

clause(SANDWICH, "2:rule", "destroying the Sandwich itself does nothing to its host", () => {
  const killItem = tactic({
    name: "KillItem",
    cost: 0,
    behavior: { abilities: [{ id: "ki", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = sandwichBoard({ attached: true, turn: 1, extra: [{ key: "ki", def: killItem, owner: P1, zone: "hand" }] });
  play(engine, P1, id("ki"), { selected: { t: [id("sw")] } });
  assert.equal(zoneOf(engine, id("sw")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(damageOn(engine, id("host")), 0);
});

clause(SANDWICH, "2:rule", "it does not stop other ways to leave play: a host removed from the game is gone, and the Sandwich does not stay in play", () => {
  const exile = tactic({
    name: "Exile",
    cost: 0,
    behavior: { abilities: [{ id: "x", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
  const { engine, id } = sandwichBoard({ attached: true, turn: 1, extra: [{ key: "exile", def: exile, owner: P1, zone: "hand" }] });
  play(engine, P1, id("exile"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "removed");
  assert.notEqual(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "it does not stop a bounce: the character returns to hand and the Sandwich does not stay in play", () => {
  const { engine, id } = sandwichBoard({ attached: true, turn: 1 });
  play(engine, P1, id("bounce"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.notEqual(zoneOf(engine, id("sw")), "play");
});

clause(SANDWICH, "2:rule", "a replacement on an ATTACHED card still applies when the host is destroyed as part of an extra cost (CR 506.2a): the Sandwich is destroyed instead and the host survives", () => {
  const altar = item({
    name: "Sacrificial Altar",
    behavior: {
      abilities: [
        {
          id: "sacrifice",
          type: "activated",
          targets: [{ id: "s", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "s" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = sandwichBoard({ attached: true, turn: 1, extra: [{ key: "altar", def: altar, owner: P1, zone: "play" }, ...fillers("a", 2, P1, "deck")] });
  const handBefore = handOf(engine).length;
  activate(engine, P1, id("altar"), "sacrifice", { selected: { s: [id("host")] } });
  assert.equal(handOf(engine).length, handBefore + 1, "the cost was paid, so the effect happened");
  assert.equal(zoneOf(engine, id("host")), "play", "the attached card's replacement still applies (CR 506.2a)");
  assert.equal(zoneOf(engine, id("sw")), "discard", "the Sandwich was destroyed instead");
});

clause(SANDWICH, "2:rule", "off in hand: a character with no Sandwich attached is destroyed as normal", () => {
  const { engine, id } = sandwichBoard({ turn: 1 });
  play(engine, P1, id("myKill"), { selected: { t: [id("host")] } });
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("sw")), "hand");
});

// =============================================================================
// Contriving Engineer
// When this card enters play, you may search your deck for a card named Elitism
// and reveal it. If you do, put it into play. Attach it to your faction.
// Character (inventor), gearsmith, cost 4, threshold [E], 2 / 3 / 1.
// =============================================================================

const ENGINEER = "663dde1e-80bf-4ec0-bffb-e916af39944a";
/** The staple resource card named "Elitism" (any printing will do). */
const ELITISM = "b4ddcf43-e508-4a11-9953-697acdcaf116";

const stapleRes = (prefix: string, n: number, owner: Pid, icon: "rage" | "greed" | "deception" | "elitism" | "obsession" = "greed"): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({
    key: `${prefix}${i}`,
    def: resourceCard({ name: `Res ${prefix}${i}`, trade: "universal", resource: { provides: [icon], staple: true } }),
    owner,
    zone: "play" as const
  }));

function engineerBoard(opts: { zone?: "hand" | "play"; elitismInDeck?: number; elitismResources?: number; rage?: number; random?: () => number; owner?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    random: opts.random ?? seeded(),
    cards: [
      { key: "eng", def: printing(ENGINEER), owner, zone: opts.zone ?? "hand" },
      { key: "ally", def: character({ name: "Ally", cost: 1 }), owner, zone: "hand" },
      ...fillers("d", 6, owner, "deck"),
      ...Array.from({ length: opts.elitismInDeck ?? 2 }, (_, i) => ({ key: `el${i}`, def: printing(ELITISM), owner, zone: "deck" as const })),
      { key: "crest", def: item({ name: "Crest of Elitism" }), owner, zone: "deck" },
      { key: "essence", def: item({ name: "Essence of Elitism" }), owner, zone: "deck" },
      { key: "elHand", def: printing(ELITISM), owner, zone: "hand" },
      { key: "elDisc", def: printing(ELITISM), owner, zone: "discard" },
      { key: "foeEl", def: printing(ELITISM), owner: foe, zone: "deck" },
      ...fillers("f", 3, foe, "deck"),
      ...stapleRes("e", opts.elitismResources ?? 1, owner, "elitism"),
      ...stapleRes("r", opts.rage ?? 6, owner, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

const deckNames = (engine: SpoilsEngine, player: Pid): string[] => deckOf(engine, player).map((c) => engine.getDefinition(c).name);
const elitismIcons = (engine: SpoilsEngine, player: Pid): number => engine.getThresholds(player).elitism ?? 0;

clause(ENGINEER, "0:rule", "pays 4 to deploy; accepting the search puts the chosen Elitism into play, attached to my faction", () => {
  const { engine, id } = engineerBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("eng"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("el0")), "deck", "nothing is searched while it is only being deployed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("eng")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the controller is asked which Elitism");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [id("el1")]);
  assert.equal(zoneOf(engine, id("el1")), "play", "the chosen Elitism is in play");
  assert.equal(engine.state.cards[id("el1")].attachedTo, factionOf(engine, P1), "attached to my faction");
  assert.equal(engine.state.cards[id("el1")].controllerId, P1);
  assert.equal(engine.state.cards[id("el1")].faceDown, false, "a face-up resource");
  assert.equal(zoneOf(engine, id("el0")), "deck", "only the one chosen");
  assert.equal(pending(engine), undefined);
});

clause(ENGINEER, "0:rule", "'reveal it': the Elitism that was found is revealed to everyone, and nothing else is", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  pickCards(engine, [id("el0")]);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1);
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [id("el0")]);
  assert.equal(event.viewerId, "all");
});

clause(ENGINEER, "0:rule", "the Elitism arrives as a resource: it provides [E] (one more icon) but, being attached, it is already spent (no extra resource to pay with)", () => {
  const { engine, id } = engineerBoard({ elitismResources: 1 });
  play(engine, P1, id("eng"));
  const readyBefore = ready(engine);
  const iconsBefore = elitismIcons(engine, P1);
  pickCards(engine, [id("el0")]);
  assert.equal(engine.isResource(id("el0")), true);
  assert.equal(elitismIcons(engine, P1), iconsBefore + 1, "one more [E] icon");
  assert.equal(ready(engine), readyBefore, "it is attached to the faction, so it can't pay for anything this turn");
});

clause(ENGINEER, "0:rule", "...and it detaches like any spent resource at my next turn's restore: then it is an available resource", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  pickCards(engine, [id("el0")]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.cards[id("el0")].attachedTo, undefined, "detached by the restore rule");
  assert.equal(engine.getAvailableResourceIds(P1).includes(id("el0")), true);
});

clause(ENGINEER, "0:rule", "'you may': declining the search puts nothing into play, and the Elitism cards stay in the deck", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  pickCards(engine, []);
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(zoneOf(engine, id("el1")), "deck");
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("eng")), "play", "the Engineer is in play either way");
  assert.equal(revealEvents(engine).length, 0, "nothing was revealed");
});

clause(ENGINEER, "0:rule", "CR 312.2: with a specific search you may fail even if a valid card is there (the same as declining)", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 1 });
  play(engine, P1, id("eng"));
  pickCards(engine, []);
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(engine.state.players[P1].play.some((c) => engine.getDefinition(c).name === "Elitism" && engine.state.cards[c].attachedTo !== undefined), false);
});

clause(ENGINEER, "0:rule", "'a card named Elitism': exactly one is fetched, even when several are in the deck (two can't be chosen)", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 3 });
  play(engine, P1, id("eng"));
  refused(tryPick(engine, P1, [id("el0"), id("el1")]), "two cards");
  assert.ok(pending(engine), "the prompt is still open");
  pickCards(engine, [id("el2")]);
  assert.equal(zoneOf(engine, id("el2")), "play");
  assert.equal(zoneOf(engine, id("el0")), "deck");
  assert.equal(zoneOf(engine, id("el1")), "deck");
});

clause(ENGINEER, "0:rule", "only cards NAMED \"Elitism\" can be fetched: Crest of Elitism, Essence of Elitism and other deck cards are refused", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  refused(tryPick(engine, P1, [id("crest")]), "Crest of Elitism");
  refused(tryPick(engine, P1, [id("essence")]), "Essence of Elitism");
  refused(tryPick(engine, P1, [id("d0")]), "an ordinary deck card");
  assert.equal(zoneOf(engine, id("crest")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pickCards(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play", "control: a card named Elitism is accepted");
});

clause(ENGINEER, "0:rule", "it searches MY deck: an Elitism in my hand or discard pile, or in the opponent's deck, can't be fetched", () => {
  const { engine, id } = engineerBoard();
  play(engine, P1, id("eng"));
  refused(tryPick(engine, P1, [id("elHand")]), "in my hand");
  refused(tryPick(engine, P1, [id("elDisc")]), "in my discard pile");
  refused(tryPick(engine, P1, [id("foeEl")]), "in the opponent's deck");
  assert.equal(zoneOf(engine, id("foeEl")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pickCards(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
});

clause(ENGINEER, "0:rule", "the opponent's deck is untouched: it keeps its cards and its order", () => {
  const { engine, id } = engineerBoard();
  const before = [...deckOf(engine, P2)];
  play(engine, P1, id("eng"));
  pickCards(engine, [id("el0")]);
  assert.deepEqual(deckOf(engine, P2), before);
});

clause(ENGINEER, "0:rule", "with no Elitism in my deck nothing can be fetched and the game is not left waiting", () => {
  const { engine, id } = engineerBoard({ elitismInDeck: 0 });
  play(engine, P1, id("eng"));
  if (pending(engine)) pickCards(engine, []);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(zoneOf(engine, id("eng")), "play");
  assert.equal(elitismIcons(engine, P1), 1, "no new [E] icon");
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards when a card was found", () => {
  assert.equal(
    deckWasShuffled(
      (random) => engineerBoard({ random }),
      (g) => {
        play(g.engine, P1, g.id("eng"));
        pickCards(g.engine, [g.id("el0")]);
      }
    ),
    true
  );
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards even when I search and choose to find nothing", () => {
  assert.equal(
    deckWasShuffled(
      (random) => engineerBoard({ random }),
      (g) => {
        play(g.engine, P1, g.id("eng"));
        pickCards(g.engine, []);
      }
    ),
    true,
    "the deck was searched, so it is shuffled whether or not a card was taken"
  );
});

clause(ENGINEER, "0:rule", "CR 312.1: the deck is shuffled afterwards even when there is no Elitism in it", () => {
  assert.equal(
    deckWasShuffled(
      (random) => engineerBoard({ random, elitismInDeck: 0 }),
      (g) => {
        play(g.engine, P1, g.id("eng"));
        if (pending(g.engine)) pickCards(g.engine, []);
      }
    ),
    true,
    "a search with no match still shuffles"
  );
});

clause(ENGINEER, "0:rule", "'enters play' includes being put into play by an effect: an Engineer raised from the discard pile searches too", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: {
      abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = engineerBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(ENGINEER), owner: P1, zone: "discard" }] });
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search prompt appears");
  pickCards(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(engine.state.cards[id("el0")].attachedTo, factionOf(engine, P1));
});

clause(ENGINEER, "0:rule", "it triggers for ITSELF entering play only: another card entering play while the Engineer is out starts no search", () => {
  const { engine, id } = engineerBoard({ zone: "play" });
  play(engine, P1, id("ally"));
  assert.equal(pending(engine), undefined, "no search prompt");
  assert.equal(zoneOf(engine, id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "an Engineer that starts on the table (never entered play) searches for nothing", () => {
  const { engine, id } = engineerBoard({ zone: "play" });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("el0")), "deck");
});

clause(ENGINEER, "0:rule", "it works for the second player's Engineer too: THEIR deck is searched and THEIR faction gets the Elitism", () => {
  const { engine, id } = engineerBoard({ owner: P2 });
  play(engine, P2, id("eng"));
  assert.equal(pending(engine)?.playerId, P2, "the Engineer's controller chooses");
  pickCards(engine, [id("el0")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(engine.state.cards[id("el0")].attachedTo, factionOf(engine, P2));
  assert.equal(engine.state.cards[id("el0")].controllerId, P2);
});

clause(ENGINEER, "0:rule", "two Engineers fetch an Elitism each (each enters play with its own search)", () => {
  const { engine, id } = engineerBoard({ rage: 8, extra: [{ key: "eng2", def: printing(ENGINEER), owner: P1, zone: "hand" }] });
  play(engine, P1, id("eng"));
  pickCards(engine, [id("el0")]);
  play(engine, P1, id("eng2"));
  pickCards(engine, [id("el1")]);
  assert.equal(zoneOf(engine, id("el0")), "play");
  assert.equal(zoneOf(engine, id("el1")), "play");
  assert.equal(elitismIcons(engine, P1), 3);
});

clause(ENGINEER, "0:rule", "is refused one resource short of its cost of 4, and without [E]; its printed stats are 2 / 3 / 1", () => {
  const short = engineerBoard({ elitismResources: 1, rage: 2 });
  assert.equal(ready(short.engine), 3);
  refused(() => playRaw(short.engine, P1, short.id("eng")), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("eng")), "hand");
  const noThreshold = engineerBoard({ elitismResources: 0, rage: 8 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("eng")), "no [E]");
  const exact = engineerBoard({ elitismResources: 1, rage: 3 });
  play(exact.engine, P1, exact.id("eng"));
  assert.equal(zoneOf(exact.engine, exact.id("eng")), "play", "[E] and exactly 4 resources is enough");
  assert.deepEqual(stats(exact.engine, exact.id("eng")), [2, 1, 3]);
  assert.deepEqual(exact.engine.getSubtypes(exact.id("eng")), ["inventor"]);
});

// =============================================================================
// Discommodiousness
// Your opponent reveals their hand. Shuffle all tactics revealed this way into
// their deck. Your opponent draws X cards, where X is the number of tactics
// shuffled into their deck. Draw a card.
// Tactic, gearsmith, cost 2, threshold [E][E].
// =============================================================================

const DISCOMMODIOUS = "02d85379-a5cb-40ae-bbd4-dd6337f680a1";

function discBoard(opts: { oppTactics?: number; oppOthers?: number; oppDeck?: number; myDeck?: number; elitism?: number; rage?: number; random?: () => number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "disc", def: printing(DISCOMMODIOUS), owner: P1, zone: "hand" },
      { key: "myTac", def: tactic({ name: "My Hand Tactic", cost: 1 }), owner: P1, zone: "hand" },
      ...Array.from({ length: opts.oppTactics ?? 2 }, (_, i) => ({ key: `ot${i}`, def: tactic({ name: `Their Tactic ${i}`, cost: 1 }), owner: P2, zone: "hand" as const })),
      ...Array.from({ length: opts.oppOthers ?? 3 }, (_, i) => ({
        key: `oc${i}`,
        def: i === 0 ? character({ name: "Their Character" }) : i === 1 ? item({ name: "Their Item" }) : i === 2 ? location({ name: "Their Place" }) : resourceCard({ name: `Their Staple ${i}` }),
        owner: P2,
        zone: "hand" as const
      })),
      ...fillers("d", opts.myDeck ?? 5, P1, "deck"),
      ...fillers("f", opts.oppDeck ?? 6, P2, "deck"),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...stapleRes("e", opts.elitism ?? 2, P1, "elitism"),
      ...stapleRes("r", opts.rage ?? 2, P1, "rage"),
      ...stapleRes("p2e", 4, P2, "elitism"),
      ...(opts.extra ?? [])
    ]
  });
}

clause(DISCOMMODIOUS, "0:rule", "pays 2; every tactic in the opponent's hand is shuffled into their deck; their other cards stay in hand", () => {
  const { engine, id } = discBoard({ oppDeck: 8 });
  const before = ready(engine);
  playRaw(engine, P1, id("disc"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  assert.equal(zoneOf(engine, id("ot0")), "hand", "nothing happens while the opponent may respond");
  resolvePendingResponses(engine);
  for (const key of ["oc0", "oc1", "oc2"]) assert.equal(zoneOf(engine, id(key)), "hand", `${key} (not a tactic) stays in hand`);
  const movedToDeck = loggedEvents(engine, "cardMoved")
    .map((entry) => entry.event as unknown as { cardId: string; from: string; to: string })
    .filter((event) => event.from === "hand" && event.to === "deck")
    .map((event) => event.cardId);
  sameCards(movedToDeck, [id("ot0"), id("ot1")], "exactly their two tactics were moved from hand into the deck");
  assert.equal(zoneOf(engine, id("disc")), "discard", "the tactic is spent");
});

clause(DISCOMMODIOUS, "0:rule", "...and they draw X = the number of tactics shuffled: with 2 tactics their hand ends the same size, their deck the same size", () => {
  const { engine, id } = discBoard();
  const theirHand = handOf(engine, P2).length;
  const theirDeck = deckOf(engine, P2).length;
  play(engine, P1, id("disc"));
  assert.equal(handOf(engine, P2).length, theirHand, "-2 tactics shuffled away, +2 drawn");
  assert.equal(deckOf(engine, P2).length, theirDeck, "+2 shuffled in, -2 drawn");
});

for (const tactics of [1, 3, 4]) {
  clause(DISCOMMODIOUS, "0:rule", `X varies with the hand: with ${tactics} tactic(s) in their hand they shuffle ${tactics} and draw ${tactics}`, () => {
    const { engine, id } = discBoard({ oppTactics: tactics });
    const theirHand = handOf(engine, P2).length;
    const theirDeck = deckOf(engine, P2).length;
    const nonTactics = ["oc0", "oc1", "oc2"].map(id);
    play(engine, P1, id("disc"));
    assert.equal(handOf(engine, P2).length, theirHand);
    assert.equal(deckOf(engine, P2).length, theirDeck);
    for (const card of nonTactics) assert.equal(zoneOf(engine, card), "hand", "non-tactics never left the hand");
  });
}

clause(DISCOMMODIOUS, "0:rule", "the draw comes AFTER the shuffle: with an empty deck the opponent draws the tactics they just shuffled in (they all come back)", () => {
  const { engine, id } = discBoard({ oppDeck: 0, oppTactics: 2 });
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, id("ot0")), "hand");
  assert.equal(zoneOf(engine, id("ot1")), "hand");
  assert.equal(deckOf(engine, P2).length, 0);
});

clause(DISCOMMODIOUS, "0:rule", "with one card in their deck and 2 tactics: the 2 tactics are shuffled with it and exactly 2 cards are drawn, leaving 1 in the deck", () => {
  const { engine } = (() => {
    const g = discBoard({ oppDeck: 1, oppTactics: 2 });
    play(g.engine, P1, g.id("disc"));
    return g;
  })();
  assert.equal(deckOf(engine, P2).length, 1);
  assert.equal(handOf(engine, P2).length, 2 + 3, "3 non-tactics plus the 2 cards drawn");
});

clause(DISCOMMODIOUS, "0:rule", "the shuffled tactics really do go into the deck and are shuffled (the deck order follows the random source)", () => {
  const rotating = discBoard({ oppDeck: 8, random: () => 0 });
  const identity = discBoard({ oppDeck: 8, random: () => 0.9999999 });
  for (const g of [rotating, identity]) play(g.engine, P1, g.id("disc"));
  const names = (g: typeof rotating) => deckOf(g.engine, P2).map((c) => g.engine.getDefinition(c).name);
  const everything = (g: typeof rotating) => [...names(g), ...handOf(g.engine, P2).map((c) => g.engine.getDefinition(c).name)].sort();
  assert.deepEqual(everything(rotating), everything(identity), "the same cards between their deck and hand");
  assert.notDeepEqual(names(rotating), names(identity), "...with a deck order that depends on the random source");
});

clause(DISCOMMODIOUS, "0:rule", "I draw exactly one card (my top card), my own tactic stays in hand and my deck is not shuffled", () => {
  const { engine, id } = discBoard();
  const [first, second] = deckOf(engine).slice(0, 2);
  const mine = handOf(engine).length;
  const myDeckOrder = [...deckOf(engine)];
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, first), "hand", "my top card was drawn");
  assert.equal(zoneOf(engine, second), "deck");
  assert.equal(handOf(engine).length, mine - 1 + 1, "Discommodiousness left the hand, one card drawn");
  assert.equal(zoneOf(engine, id("myTac")), "hand", "my own tactic is not shuffled away");
  assert.deepEqual(deckOf(engine), myDeckOrder.slice(1), "my deck lost only its top card");
});

clause(DISCOMMODIOUS, "0:rule", "'your opponent reveals their hand': their whole hand is revealed to everyone (tactics and the other cards)", () => {
  const { engine, id } = discBoard();
  const theirHand = [...handOf(engine, P2)];
  play(engine, P1, id("disc"));
  const shown = revealedIds(engine);
  assert.ok(revealEvents(engine).length >= 1, "a reveal happened");
  for (const card of theirHand) assert.equal(shown.includes(card), true, `${engine.getDefinition(card).name} was revealed`);
  assert.ok(revealEvents(engine).every((entry) => (entry.event as unknown as { viewerId: string }).viewerId === "all"), "revealed to everyone");
});

clause(DISCOMMODIOUS, "0:rule", "only the opponent's hand is revealed: none of MY cards appear in the reveal", () => {
  const { engine, id } = discBoard();
  play(engine, P1, id("disc"));
  const shown = revealedIds(engine);
  assert.equal(shown.includes(id("myTac")), false);
  assert.equal(shown.includes(id("mine")), false);
});

clause(DISCOMMODIOUS, "0:rule", "with no tactic in their hand nothing is shuffled and they draw nothing, but I still draw a card", () => {
  const { engine, id } = discBoard({ oppTactics: 0 });
  const theirHand = [...handOf(engine, P2)];
  const theirDeck = [...deckOf(engine, P2)];
  const top = deckOf(engine)[0];
  play(engine, P1, id("disc"));
  assert.deepEqual(handOf(engine, P2), theirHand, "their hand is unchanged");
  assert.equal(deckOf(engine, P2).length, theirDeck.length, "their deck has the same cards");
  assert.equal(zoneOf(engine, top), "hand", "I drew a card");
});

clause(DISCOMMODIOUS, "0:rule", "with no tactic revealed no cards are shuffled into their deck, so the deck is not shuffled (CR 313.2)", () => {
  assert.equal(
    deckWasShuffled(
      (random) => discBoard({ oppTactics: 0, oppDeck: 8, random }),
      (g) => play(g.engine, P1, g.id("disc")),
      P2
    ),
    false,
    "their deck order must not depend on the random source"
  );
});

clause(DISCOMMODIOUS, "0:rule", "with an empty hand there is nothing to reveal or shuffle; I draw one card and the game goes on", () => {
  const { engine, id } = discBoard({ oppTactics: 0, oppOthers: 0 });
  assert.equal(handOf(engine, P2).length, 0);
  const top = deckOf(engine)[0];
  play(engine, P1, id("disc"));
  assert.equal(handOf(engine, P2).length, 0);
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(pending(engine), undefined);
});

clause(DISCOMMODIOUS, "0:rule", "a hand of only tactics: all of them go away and the same number come back", () => {
  const { engine, id } = discBoard({ oppTactics: 3, oppOthers: 0 });
  play(engine, P1, id("disc"));
  assert.equal(handOf(engine, P2).length, 3);
  assert.equal(deckOf(engine, P2).length, 6);
});

clause(DISCOMMODIOUS, "0:rule", "the shuffle is of THEIR deck: my cards never move to my deck, and nothing of mine goes to theirs", () => {
  const { engine, id } = discBoard();
  play(engine, P1, id("disc"));
  assert.equal(zoneOf(engine, id("myTac")), "hand");
  assert.equal(deckOf(engine, P2).some((c) => engine.state.cards[c].ownerId === P1), false);
});

clause(DISCOMMODIOUS, "0:rule", "it can be played on the opponent's turn, in response to their action (tactic timing), and then I am the one who draws", () => {
  const { engine, id } = discBoard({ active: P2, extra: [{ key: "p2noop", def: noopTactic("Their Noop"), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  const theirDeck = deckOf(engine, P2).length;
  const top = deckOf(engine)[0];
  playRaw(engine, P1, id("disc"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("disc")), "discard");
  assert.equal(deckOf(engine, P2).length, theirDeck, "their tactics went back and the same number were drawn");
  assert.equal(zoneOf(engine, top), "hand", "I drew a card");
});

clause(DISCOMMODIOUS, "0:rule", "is refused one resource short of its cost of 2, and without [E][E]", () => {
  const short = discBoard({ elitism: 2, rage: 0 });
  short.engine.state.cards[short.id("e1")].attachedTo = factionOf(short.engine, P1);
  assert.equal(ready(short.engine), 1);
  refused(() => playRaw(short.engine, P1, short.id("disc")), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("disc")), "hand");
  const noThreshold = discBoard({ elitism: 1, rage: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("disc")), "only one [E]");
  const exact = discBoard({ elitism: 2, rage: 0 });
  play(exact.engine, P1, exact.id("disc"));
  assert.equal(zoneOf(exact.engine, exact.id("disc")), "discard", "[E][E] and exactly 2 resources");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Elite Team Registration
// Search your deck for up to 2 Gearsmith characters with different names and
// reveal them. Put them into your hand.
// Tactic, gearsmith, cost 4, threshold [E][E][E].
// =============================================================================

const REGISTRATION = "6a573a82-ebd4-45a2-91b2-fc2029132b6b";

const gearsmithChar = (name: string, extra: Partial<CardDefinition> = {}): CardDefinition => character({ name, trade: "gearsmith", strength: 2, life: 2, ...extra });

function registrationBoard(opts: { elitism?: number; rage?: number; random?: () => number; active?: Pid; deckExtra?: CardPlacement[]; noGearsmiths?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? seeded(),
    cards: [
      { key: "reg", def: printing(REGISTRATION), owner: P1, zone: "hand" },
      ...fillers("d", 5, P1, "deck"),
      ...(opts.noGearsmiths
        ? []
        : [
            { key: "gA", def: gearsmithChar("Gear Alpha"), owner: P1, zone: "deck" as const },
            { key: "gB", def: gearsmithChar("Gear Beta"), owner: P1, zone: "deck" as const },
            { key: "gC", def: gearsmithChar("Gear Gamma"), owner: P1, zone: "deck" as const },
            { key: "twin1", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" as const },
            { key: "twin2", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" as const }
          ]),
      { key: "banker", def: character({ name: "Banker Guy", trade: "banker" }), owner: P1, zone: "deck" },
      { key: "universal", def: character({ name: "Universal Guy", trade: "universal" }), owner: P1, zone: "deck" },
      { key: "gearItem", def: item({ name: "Gearsmith Item", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "gearTac", def: tactic({ name: "Gearsmith Tactic", trade: "gearsmith", cost: 1 }), owner: P1, zone: "deck" },
      { key: "gHand", def: gearsmithChar("Gear In Hand"), owner: P1, zone: "hand" },
      { key: "gDisc", def: gearsmithChar("Gear In Discard"), owner: P1, zone: "discard" },
      { key: "foeG", def: gearsmithChar("Their Gearsmith"), owner: P2, zone: "deck" },
      ...fillers("f", 3, P2, "deck"),
      ...(opts.deckExtra ?? []),
      ...stapleRes("e", opts.elitism ?? 3, P1, "elitism"),
      ...stapleRes("r", opts.rage ?? 1, P1, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

/** Plays the tactic and answers the search with `keys`. */
function registrationSearch(engine: SpoilsEngine, id: IdOf, keys: string[]): void {
  play(engine, P1, id("reg"));
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the controller is asked what to find");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, keys.map(id));
}

clause(REGISTRATION, "0:rule", "pays 4; the two chosen Gearsmith characters (different names) go from the deck into my hand", () => {
  const { engine, id } = registrationBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("reg"));
  assert.equal(before - ready(engine), 4, "the printed cost of 4 is paid");
  assert.equal(zoneOf(engine, id("gA")), "deck", "nothing is searched while the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickCards(engine, [id("gA"), id("gB")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
  assert.equal(zoneOf(engine, id("gB")), "hand");
  assert.ok(handOf(engine).includes(id("gA")), "handOf(engine).includes(id(\"gA\"))");
  assert.equal(zoneOf(engine, id("gC")), "deck", "a third Gearsmith stays in the deck");
  assert.equal(zoneOf(engine, id("reg")), "discard", "the tactic is spent");
  assert.equal(pending(engine), undefined);
});

clause(REGISTRATION, "0:rule", "'reveal them': the found cards are revealed to everyone (and only they are)", () => {
  const { engine, id } = registrationBoard();
  registrationSearch(engine, id, ["gA", "gB"]);
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1);
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  sameCards(event.cardIds, [id("gA"), id("gB")]);
  assert.equal(event.viewerId, "all");
});

clause(REGISTRATION, "0:rule", "'up to 2': finding just one is fine", () => {
  const { engine, id } = registrationBoard();
  const handBefore = handOf(engine).length;
  registrationSearch(engine, id, ["gB"]);
  assert.equal(zoneOf(engine, id("gB")), "hand");
  assert.equal(zoneOf(engine, id("gA")), "deck");
  assert.equal(handOf(engine).length, handBefore - 1 + 1);
  assert.deepEqual(revealedIds(engine), [id("gB")]);
});

clause(REGISTRATION, "0:rule", "'up to 2' includes none: I may fail the search even though valid cards are there (CR 312.2)", () => {
  const { engine, id } = registrationBoard();
  const handBefore = handOf(engine).length;
  registrationSearch(engine, id, []);
  assert.equal(zoneOf(engine, id("gA")), "deck");
  assert.equal(handOf(engine).length, handBefore - 1);
  assert.equal(zoneOf(engine, id("reg")), "discard");
  assert.equal(pending(engine), undefined);
  assert.equal(revealEvents(engine).length, 0, "nothing revealed");
});

clause(REGISTRATION, "0:rule", "never more than 2: three Gearsmith characters are refused", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  refused(tryPick(engine, P1, [id("gA"), id("gB"), id("gC")]), "three cards");
  assert.ok(pending(engine), "the search is still open");
  assert.equal(zoneOf(engine, id("gA")), "deck");
  pickCards(engine, [id("gA"), id("gC")]);
  assert.equal(zoneOf(engine, id("gC")), "hand", "control: two are accepted");
});

clause(REGISTRATION, "0:rule", "'with different names': two copies of the same Gearsmith character are refused; one copy alone is fine", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  refused(tryPick(engine, P1, [id("twin1"), id("twin2")]), "same name twice");
  assert.equal(zoneOf(engine, id("twin1")), "deck");
  assert.equal(zoneOf(engine, id("twin2")), "deck");
  pickCards(engine, [id("twin1"), id("gA")]);
  assert.equal(zoneOf(engine, id("twin1")), "hand", "control: one Twin plus a differently named card");
  assert.equal(zoneOf(engine, id("twin2")), "deck");
});

clause(REGISTRATION, "0:rule", "when the only Gearsmith characters left are copies of one name, just one can be taken", () => {
  const { engine, id } = registrationBoard({ noGearsmiths: true, deckExtra: [{ key: "twin1", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" }, { key: "twin2", def: gearsmithChar("Gear Twin"), owner: P1, zone: "deck" }] });
  play(engine, P1, id("reg"));
  refused(tryPick(engine, P1, [id("twin1"), id("twin2")]), "two copies of one name");
  pickCards(engine, [id("twin2")]);
  assert.equal(zoneOf(engine, id("twin2")), "hand");
  assert.equal(zoneOf(engine, id("twin1")), "deck");
});

clause(REGISTRATION, "0:rule", "only GEARSMITH characters: a Banker character, a Universal character, a Gearsmith item and a Gearsmith tactic are refused", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  refused(tryPick(engine, P1, [id("banker")]), "a Banker character");
  refused(tryPick(engine, P1, [id("universal")]), "a Universal character");
  refused(tryPick(engine, P1, [id("gearItem")]), "a Gearsmith item");
  refused(tryPick(engine, P1, [id("gearTac")]), "a Gearsmith tactic");
  refused(tryPick(engine, P1, [id("d0")]), "an ordinary card");
  refused(tryPick(engine, P1, [id("gA"), id("banker")]), "one valid and one invalid");
  assert.equal(zoneOf(engine, id("banker")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pickCards(engine, [id("gA")]);
  assert.equal(zoneOf(engine, id("gA")), "hand", "control: a Gearsmith character is accepted");
});

clause(REGISTRATION, "0:rule", "it searches MY deck: Gearsmith characters in my hand or discard pile, or in the opponent's deck, can't be taken", () => {
  const { engine, id } = registrationBoard();
  play(engine, P1, id("reg"));
  refused(tryPick(engine, P1, [id("gHand")]), "in my hand");
  refused(tryPick(engine, P1, [id("gDisc")]), "in my discard pile");
  refused(tryPick(engine, P1, [id("foeG")]), "in the opponent's deck");
  assert.equal(zoneOf(engine, id("foeG")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pickCards(engine, [id("gA")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
});

clause(REGISTRATION, "0:rule", "the opponent's deck is untouched", () => {
  const { engine, id } = registrationBoard();
  const before = [...deckOf(engine, P2)];
  registrationSearch(engine, id, ["gA", "gB"]);
  assert.deepEqual(deckOf(engine, P2), before);
});

clause(REGISTRATION, "0:rule", "with no Gearsmith character in my deck nothing can be found and the tactic still resolves (no stuck prompt)", () => {
  const { engine, id } = registrationBoard({ noGearsmiths: true });
  play(engine, P1, id("reg"));
  if (pending(engine)) pickCards(engine, []);
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(zoneOf(engine, id("reg")), "discard");
});

clause(REGISTRATION, "0:rule", "the cards that were found leave the deck: the deck is smaller by the number found", () => {
  const { engine, id } = registrationBoard();
  const before = deckOf(engine).length;
  registrationSearch(engine, id, ["gA", "gB"]);
  assert.equal(deckOf(engine).length, before - 2);
  assert.equal(deckOf(engine).includes(id("gA")), false);
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards when cards were found", () => {
  assert.equal(
    deckWasShuffled(
      (random) => registrationBoard({ random }),
      (g) => registrationSearch(g.engine, g.id, ["gA", "gB"])
    ),
    true,
    "the order follows the random source: the deck was shuffled"
  );
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards even when I choose to find nothing", () => {
  assert.equal(
    deckWasShuffled(
      (random) => registrationBoard({ random }),
      (g) => registrationSearch(g.engine, g.id, [])
    ),
    true,
    "the deck was searched, so it is shuffled"
  );
});

clause(REGISTRATION, "0:rule", "CR 312.1: the deck is shuffled afterwards even when there is no Gearsmith character to find", () => {
  assert.equal(
    deckWasShuffled(
      (random) => registrationBoard({ random, noGearsmiths: true }),
      (g) => {
        play(g.engine, P1, g.id("reg"));
        if (pending(g.engine)) pickCards(g.engine, []);
      }
    ),
    true,
    "a search with no match still shuffles"
  );
});

clause(REGISTRATION, "0:rule", "it can be played on the opponent's turn in response to their action (tactic timing)", () => {
  const { engine, id } = registrationBoard({ active: P2, extra: [{ key: "p2noop", def: noopTactic("Their Noop"), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("reg"));
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [id("gA"), id("gB")]);
  assert.equal(zoneOf(engine, id("gA")), "hand");
});

clause(REGISTRATION, "0:rule", "is refused one resource short of its cost of 4, and without [E][E][E]", () => {
  const short = registrationBoard({ elitism: 3, rage: 0 });
  assert.equal(ready(short.engine), 3);
  refused(() => playRaw(short.engine, P1, short.id("reg")), "3 resources");
  assert.equal(zoneOf(short.engine, short.id("reg")), "hand");
  const noThreshold = registrationBoard({ elitism: 2, rage: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("reg")), "only two [E]");
  const exact = registrationBoard({ elitism: 3, rage: 1 });
  registrationSearch(exact.engine, exact.id, []);
  assert.equal(zoneOf(exact.engine, exact.id("reg")), "discard", "[E][E][E] and exactly 4 resources");
  assert.equal(ready(exact.engine), 0);
});

// =============================================================================
// Epiphany Ball
// SUDDEN INSIGHT -- COST: Deplete this card. -- EFFECT: Search your deck for a
// card. Put it into your hand. Your opponent takes control of this card.
// Item, gearsmith, cost 3, threshold [E][E].
// =============================================================================

const BALL = "601204ef-80f0-4bc6-85f3-9282aa9a4c5a";

function ballBoard(opts: { depleted?: boolean; deckSize?: number; emptyDeck?: boolean; random?: () => number; active?: Pid; owner?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const foe = other(owner);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? owner,
    random: opts.random ?? seeded(),
    cards: [
      { key: "ball", def: printing(BALL), owner, zone: "play", depleted: opts.depleted },
      ...(opts.emptyDeck
        ? []
        : [
            { key: "want", def: character({ name: "Wanted Character", cost: 4 }), owner, zone: "deck" as const },
            { key: "wantTac", def: tactic({ name: "Wanted Tactic", cost: 1 }), owner, zone: "deck" as const },
            { key: "wantItem", def: item({ name: "Wanted Item" }), owner, zone: "deck" as const },
            { key: "wantRes", def: resourceCard({ name: "Wanted Staple" }), owner, zone: "deck" as const },
            ...fillers("d", opts.deckSize ?? 5, owner, "deck")
          ]),
      { key: "foeWant", def: character({ name: "Their Wanted" }), owner: foe, zone: "deck" },
      ...fillers("f", 4, foe, "deck"),
      { key: "inHand", def: character({ name: "In Hand" }), owner, zone: "hand" },
      { key: "inDisc", def: character({ name: "In Discard" }), owner, zone: "discard" },
      { key: "theirHand", def: character({ name: "Their Hand" }), owner: foe, zone: "hand" },
      { key: "mine", def: character({ name: "Mine" }), owner, zone: "play" },
      ...stapleRes("r", 4, owner, "rage"),
      ...stapleRes("p2r", 4, foe, "rage"),
      ...(opts.extra ?? [])
    ]
  });
}

const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): Pid => engine.state.cards[cardId].controllerId as Pid;

const smashItemTactic = (): CardDefinition =>
  tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "sm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

clause(BALL, "0:ability:insight", "COST: deplete this card is paid when it is used (before the opponent can respond); the search happens when it resolves", () => {
  const { engine, id } = ballBoard();
  activateRaw(engine, P1, id("ball"), "insight");
  assert.equal(engine.state.cards[id("ball")].depleted, true, "deplete this card");
  assert.equal(controllerOf(engine, id("ball")), P1, "control has not changed yet");
  assert.equal(pending(engine), undefined, "no search yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now I search");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [deckOf(engine)[0]]);
});

clause(BALL, "0:ability:insight", "EFFECT: I search my deck for a card and put it into my hand; then my opponent takes control of the Ball", () => {
  const { engine, id } = ballBoard();
  const handBefore = handOf(engine).length;
  const deckBefore = deckOf(engine).length;
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(handOf(engine).length, handBefore + 1);
  assert.equal(deckOf(engine).length, deckBefore - 1);
  assert.equal(controllerOf(engine, id("ball")), P2, "the opponent now controls it");
  assert.equal(engine.state.cards[id("ball")].ownerId, P1, "ownership never changes (CR 407.8)");
  assert.equal(zoneOf(engine, id("ball")), "play");
  assert.equal(engine.state.players[P2].play.includes(id("ball")), true);
  assert.equal(engine.state.players[P1].play.includes(id("ball")), false);
  assert.equal(pending(engine), undefined);
});

clause(BALL, "0:ability:insight", "'a card': any type can be fetched (character, tactic, item, resource)", () => {
  for (const key of ["want", "wantTac", "wantItem", "wantRes"]) {
    const { engine, id } = ballBoard();
    activate(engine, P1, id("ball"), "insight");
    pickCards(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(BALL, "0:ability:insight", "exactly one card: two are refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  refused(tryPick(engine, P1, [id("want"), id("wantTac")]), "two cards");
  assert.ok(pending(engine), "the search is still open");
  assert.equal(zoneOf(engine, id("want")), "deck");
  pickCards(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(zoneOf(engine, id("wantTac")), "deck");
});

clause(BALL, "0:ability:insight", "'search your deck for a card' must find one when the deck has cards (CR 312.2): finding nothing is refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  refused(tryPick(engine, P1, []), "no card chosen");
  assert.ok(pending(engine), "still waiting for a real choice");
  assert.equal(controllerOf(engine, id("ball")), P1);
  pickCards(engine, [id("want")]);
  assert.equal(controllerOf(engine, id("ball")), P2, "control passes only after the search completes");
});

clause(BALL, "0:ability:insight", "it searches MY deck: cards in my hand or discard pile, the opponent's deck, hand and cards in play are refused", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  for (const key of ["inHand", "inDisc", "foeWant", "theirHand", "mine"]) refused(tryPick(engine, P1, [id(key)]), key);
  assert.equal(zoneOf(engine, id("foeWant")), "deck");
  assert.ok(pending(engine), "pending(engine)");
  pickCards(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
});

clause(BALL, "0:ability:insight", "the found card is not revealed (the card prints no reveal): nothing is shown to the opponent", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  assert.equal(revealEvents(engine).length, 0);
});

clause(BALL, "0:ability:insight", "the opponent's deck and hand are untouched", () => {
  const { engine, id } = ballBoard();
  const theirDeck = [...deckOf(engine, P2)];
  const theirHand = [...handOf(engine, P2)];
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  assert.deepEqual(deckOf(engine, P2), theirDeck);
  assert.deepEqual(handOf(engine, P2), theirHand);
});

clause(BALL, "0:ability:insight", "CR 312.1: my deck is shuffled afterwards", () => {
  assert.equal(
    deckWasShuffled(
      (random) => ballBoard({ random }),
      (g) => {
        activate(g.engine, P1, g.id("ball"), "insight");
        pickCards(g.engine, [g.id("want")]);
      }
    ),
    true,
    "the searched deck was shuffled"
  );
});

clause(BALL, "0:ability:insight", "with an empty deck there is nothing to find, but the opponent still takes control of the Ball", () => {
  const { engine, id } = ballBoard({ emptyDeck: true });
  assert.equal(deckOf(engine).length, 0);
  activate(engine, P1, id("ball"), "insight");
  if (pending(engine)) pickCards(engine, []);
  assert.equal(pending(engine), undefined);
  assert.equal(controllerOf(engine, id("ball")), P2, "control passes regardless");
  assert.equal(engine.state.result, undefined);
});

clause(BALL, "0:ability:insight", "a depleted Ball can't be used: refused, nothing searched", () => {
  const { engine, id } = ballBoard({ depleted: true });
  refused(() => activateRaw(engine, P1, id("ball"), "insight"), "already depleted");
  assert.equal(pending(engine), undefined);
  assert.equal(controllerOf(engine, id("ball")), P1);
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("ball") && a.ability.id === "insight"), false);
});

clause(BALL, "0:ability:insight", "no resources are needed: it works with none at all", () => {
  const { engine, id } = ballBoard();
  for (const key of ["r0", "r1", "r2", "r3"]) engine.state.cards[id(key)].attachedTo = factionOf(engine, P1);
  assert.equal(ready(engine), 0);
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
});

clause(BALL, "0:ability:insight", "only its controller may use it", () => {
  const { engine, id } = ballBoard();
  refused(() => activateRaw(engine, P2, id("ball"), "insight"), "the opponent", /control|own|activate|yours?/i);
  assert.equal(engine.state.cards[id("ball")].depleted, false);
  assert.equal(controllerOf(engine, id("ball")), P1);
});

clause(BALL, "0:ability:insight", "once the opponent controls it I can't use it any more (it isn't mine, even once restored)", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  refused(() => activateRaw(engine, P1, id("ball"), "insight"), "still depleted and no longer mine");
  engine.state.cards[id("ball")].depleted = false;
  refused(() => activateRaw(engine, P1, id("ball"), "insight"), "not my card to use any more", /control|own|activate|yours?|not/i);
});

clause(BALL, "0:ability:insight", "it comes back and forth: on their turn the Ball is restored under their control; they can use it, and I take control of it again", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.state.cards[id("ball")].depleted, false, "restored at the start of their turn (they control it)");
  activate(engine, P2, id("ball"), "insight");
  assert.equal(pending(engine)?.playerId, P2, "THEY search THEIR deck");
  pickCards(engine, [id("foeWant")]);
  assert.equal(zoneOf(engine, id("foeWant")), "hand");
  assert.ok(handOf(engine, P2).includes(id("foeWant")), "handOf(engine, P2).includes(id(\"foeWant\"))");
  assert.equal(controllerOf(engine, id("ball")), P1, "their opponent (me) takes control of it");
  assert.equal(engine.state.cards[id("ball")].ownerId, P1);
});

clause(BALL, "0:ability:insight", "back with me, it is restored again on my turn and usable once more", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  endTurn(engine, P1);
  activate(engine, P2, id("ball"), "insight");
  pickCards(engine, [id("foeWant")]);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(controllerOf(engine, id("ball")), P1);
  assert.equal(engine.state.cards[id("ball")].depleted, false);
  activate(engine, P1, id("ball"), "insight");
  assert.equal(pending(engine)?.playerId, P1);
  pickCards(engine, [id("wantTac")]);
  assert.equal(zoneOf(engine, id("wantTac")), "hand");
  assert.equal(controllerOf(engine, id("ball")), P2);
});

clause(BALL, "0:ability:insight", "only the Ball changes hands: my other permanents and my faction stay mine", () => {
  const { engine, id } = ballBoard();
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  assert.equal(controllerOf(engine, id("mine")), P1);
  assert.equal(controllerOf(engine, factionOf(engine, P1)), P1);
});

clause(BALL, "0:ability:insight", "when the Ball is destroyed under their control it goes to ITS OWNER's discard pile (mine)", () => {
  const { engine, id } = ballBoard({ extra: [{ key: "smash", def: smashItemTactic(), owner: P2, zone: "hand" }] });
  activate(engine, P1, id("ball"), "insight");
  pickCards(engine, [id("want")]);
  endTurn(engine, P1);
  play(engine, P2, id("smash"), { selected: { t: [id("ball")] } });
  assert.equal(zoneOf(engine, id("ball")), "discard");
  assert.equal(discardOf(engine, P1).includes(id("ball")), true, "its owner's discard pile");
  assert.equal(discardOf(engine, P2).includes(id("ball")), false);
});

clause(BALL, "0:ability:insight", "the effect resolves as paid if the Ball is destroyed in response: I still search and a card in the discard pile is not given to the opponent", () => {
  const { engine, id } = ballBoard({ extra: [{ key: "kill", def: smashItemTactic(), owner: P2, zone: "hand" }] });
  activateRaw(engine, P1, id("ball"), "insight");
  playRaw(engine, P2, id("kill"), { selected: { t: [id("ball")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ball")), "discard", "destroyed in response");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search still happens (CR 502.4)");
  pickCards(engine, [id("want")]);
  assert.equal(zoneOf(engine, id("want")), "hand");
  assert.equal(zoneOf(engine, id("ball")), "discard", "a card in the discard pile is not given to the opponent");
});

clause(BALL, "0:ability:insight", "the Ball deploys for exactly 3 with [E][E] (refused one short or with one [E]) as an item", () => {
  const only = (elitism: number, rage: number) =>
    buildGame({ playerA: { faction: developFaction() }, cards: [{ key: "ball", def: printing(BALL), owner: P1, zone: "hand" }, ...bank("elitism", elitism, P1), ...bank("rage", rage, P1)] });
  const short = only(2, 0);
  refused(() => playRaw(short.engine, P1, short.id("ball")), "2 resources");
  const oneE = only(1, 6);
  refused(() => playRaw(oneE.engine, P1, oneE.id("ball")), "one [E]");
  const { engine, id } = only(2, 1);
  play(engine, P1, id("ball"));
  assert.equal(zoneOf(engine, id("ball")), "play");
  assert.equal(ready(engine), 0, "exactly 3 spent");
  assert.deepEqual(engine.getCardTypes(id("ball")), ["item"]);
});

// =============================================================================
// Exploding Sock Puppet!
// Your opponent cannot respond to this card.
// COST: Play this only in response to a character's ability.
// EFFECT: Terminate the ability. Destroy the character.
// Tactic, gearsmith, cost 2, threshold [E].
// =============================================================================

const PUPPET = "300ab3d1-3214-4fa5-9000-d657e6e7816d";
const DOORMAN = "72439f0b-d9fe-4ea9-b701-e2f535669484";

/** A character with two abilities: ZAP (pay 1: 2 damage to a character) and PEEK (draw a card). */
const abilityGuy = (name: string): CardDefinition =>
  character({
    name,
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", costs: [{ type: "payResources", amount: 1 }], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }] },
        { id: "peek", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }
      ]
    }
  });
const GUY = abilityGuy("Ability Guy");
const OTHER_GUY = abilityGuy("Other Guy");
const IDOL = item({
  name: "Pulse Idol",
  behavior: { abilities: [{ id: "pulse", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
});
const SHRINE = location({
  name: "Quake Shrine",
  structure: 4,
  behavior: { abilities: [{ id: "quake", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
});
const ABILITY_FACTION = factionCard({
  id: "p204-ability-faction",
  name: "Faction With Ability",
  faction: defaultFactionDefinition({
    startingInfluence: 30,
    abilities: [{ id: "fdraw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
  })
});

function puppetBoard(opts: { active?: Pid; elitism?: number; rage?: number; foeFaction?: CardDefinition; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: opts.foeFaction ?? developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "pup", def: printing(PUPPET), owner: P1, zone: "hand" },
      { key: "myTac", def: noopTactic("My Noop"), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 8 }), owner: P1, zone: "play" },
      { key: "myGuy", def: abilityGuy("My Ability Guy"), owner: P1, zone: "play" },
      { key: "guy", def: GUY, owner: P2, zone: "play" },
      { key: "guy2", def: GUY, owner: P2, zone: "play" },
      { key: "other", def: OTHER_GUY, owner: P2, zone: "play" },
      { key: "idol", def: IDOL, owner: P2, zone: "play" },
      { key: "shrine", def: SHRINE, owner: P2, zone: "play" },
      { key: "p2tac", def: noopTactic("Their Noop"), owner: P2, zone: "hand" },
      { key: "p2char", def: character({ name: "Their Newcomer", cost: 0 }), owner: P2, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("f", 4, P2, "deck"),
      ...stapleRes("e", opts.elitism ?? 1, P1, "elitism"),
      ...stapleRes("r", opts.rage ?? 3, P1, "rage"),
      ...stapleRes("p2g", 8, P2, "greed"),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 activates `abilityId` of its card `cardKey` (zap at my character by default) and holds the response window open for P1. */
function foeUses(engine: SpoilsEngine, id: IdOf, cardKey: string, abilityId: string): void {
  const needsTarget = abilityId !== "peek" && abilityId !== "fdraw";
  activateRaw(engine, P2, id(cardKey), abilityId, needsTarget ? { selected: { t: [id("mine")] } } : {});
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the ability");
}

clause(PUPPET, "0:rule", "control: a response to the opponent's ability by an ordinary tactic can itself be answered by the opponent", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("myTac"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority and may answer an ordinary tactic");
  playRaw(engine, P2, id("p2tac"));
  assert.equal(zoneOf(engine, id("p2tac")), "deploying", "...and does");
});

clause(PUPPET, "0:rule", "the opponent gets no response window: it resolves on its own, and they can respond with neither a tactic nor an ability", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  refused(() => playRaw(engine, P2, id("p2tac")), "no tactic in response", /priority|respond|window|cannot/i);
  refused(() => activateRaw(engine, P2, id("other"), "peek"), "no ability in response", /priority|respond|window|cannot/i);
  refused(() => activateRaw(engine, P2, id("idol"), "pulse", { selected: { t: [id("mine")] } }), "no ability of an item either", /priority|respond|window|cannot/i);
  assert.equal(zoneOf(engine, id("p2tac")), "hand");
});

clause(PUPPET, "1:ability", "in response to a character's ability: pays 2, the ability is terminated (no effect), and that character is destroyed (into its owner's discard pile)", () => {
  const { engine, id } = puppetBoard();
  const before = ready(engine);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("mine")), 0, "the ability had no effect");
  assert.equal(zoneOf(engine, id("guy")), "discard", "the character is destroyed");
  assert.ok(discardOf(engine, P2).includes(id("guy")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("pup")), "discard", "the tactic is spent");
  assert.equal(engine.state.responseWindow, undefined);
});

clause(PUPPET, "1:ability", "control: without the Puppet the same ability does its damage and the character survives", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("mine")), 2);
  assert.equal(zoneOf(engine, id("guy")), "play");
});

clause(PUPPET, "1:ability", "only THE character whose ability it was is destroyed: the opponent's other characters (even copies) and mine are untouched", () => {
  const { engine, id } = puppetBoard();
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  for (const key of ["guy2", "other"]) assert.equal(zoneOf(engine, id(key)), "play", key);
  for (const key of ["mine", "myGuy"]) assert.equal(zoneOf(engine, id(key)), "play", key);
});

clause(PUPPET, "1:ability", "the stopped ability's costs stay paid: the opponent's resource is not refunded", () => {
  const { engine, id } = puppetBoard();
  const before = ready(engine, P2);
  foeUses(engine, id, "guy", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(before - ready(engine, P2), 1);
});

clause(PUPPET, "1:ability", "it stops a drawing ability too, and the character is still destroyed", () => {
  const { engine, id } = puppetBoard();
  const theirHand = handOf(engine, P2).length;
  foeUses(engine, id, "guy", "peek");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P2).length, theirHand, "no card drawn");
  assert.equal(zoneOf(engine, id("guy")), "discard");
});

clause(PUPPET, "1:ability", "the character's own destroy-triggers fire as for any destruction (it is destroyed, not removed)", () => {
  const dies = character({
    name: "Dies Loudly",
    strength: 1,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] },
        { id: "last", type: "triggered", event: "cardDestroyed", condition: { type: "sourceIsEventCard" }, effects: [{ type: "modifyInfluence", player: "opponent", amount: -3 }] }
      ]
    }
  });
  const { engine, id } = puppetBoard({ extra: [{ key: "dies", def: dies, owner: P2, zone: "play" }] });
  const before = engine.state.players[P1].influence;
  foeUses(engine, id, "dies", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("dies")), "discard");
  assert.equal(engine.state.players[P1].influence, before - 3, "its 'when this is destroyed' trigger ran: it was destroyed");
});

clause(PUPPET, "1:ability", "'in response to a CHARACTER's ability': refused for an item's ability and for a location's ability", () => {
  for (const [key, ability] of [
    ["idol", "pulse"],
    ["shrine", "quake"]
  ] as const) {
    const { engine, id } = puppetBoard();
    foeUses(engine, id, key, ability);
    const before = ready(engine);
    refused(() => playRaw(engine, P1, id("pup")), `${key}'s ability is not a character's`);
    assert.equal(zoneOf(engine, id("pup")), "hand");
    assert.equal(ready(engine), before, "nothing was paid");
    assert.equal(zoneOf(engine, id(key)), "play", "and the source was not destroyed");
  }
});

clause(PUPPET, "1:ability", "...refused for a faction's ability", () => {
  const { engine, id } = puppetBoard({ foeFaction: ABILITY_FACTION });
  const foeFaction = factionOf(engine, P2);
  activateRaw(engine, P2, foeFaction, "fdraw");
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(engine, P1, id("pup")), "a faction's ability is not a character's");
  assert.equal(zoneOf(engine, id("pup")), "hand");
  assert.equal(zoneOf(engine, foeFaction), "play");
});

clause(PUPPET, "1:ability", "...refused when it is not a response to an ability at all: in response to a tactic, to a character being played, or with nothing to respond to", () => {
  const tac = puppetBoard();
  playRaw(tac.engine, P2, tac.id("p2tac"));
  refused(() => playRaw(tac.engine, P1, tac.id("pup")), "a tactic: its own response condition (an ability) is unmet", /cannot be deployed right now/);
  const chr = puppetBoard();
  playRaw(chr.engine, P2, chr.id("p2char"));
  refused(() => playRaw(chr.engine, P1, chr.id("pup")), "a character being played: its own response condition (an ability) is unmet", /cannot be deployed right now/);
  assert.equal(chr.engine.state.cards[chr.id("p2char")].zone, "deploying");
  const idle = puppetBoard({ active: P1 });
  refused(() => playRaw(idle.engine, P1, idle.id("pup")), "nothing to respond to");
  assert.equal(zoneOf(idle.engine, idle.id("pup")), "hand");
  const ok = puppetBoard();
  foeUses(ok.engine, ok.id, "guy", "zap");
  playRaw(ok.engine, P1, ok.id("pup"));
  assert.equal(ok.engine.state.cards[ok.id("pup")].zone === "hand", false, "control: in response to a character's ability it can be played");
});

clause(PUPPET, "1:ability", "I can't use it against my own ability", () => {
  const { engine, id } = puppetBoard({ active: P1 });
  activateRaw(engine, P1, id("myGuy"), "zap", { selected: { t: [id("mine")] } });
  refused(() => playRaw(engine, P1, id("pup")), "responding to my own ability", /priority/);
  assert.equal(zoneOf(engine, id("myGuy")), "play");
});

clause(PUPPET, "1:ability", "it works on my own turn too, against an ability they used in response to my action", () => {
  const { engine, id } = puppetBoard({ active: P1 });
  playRaw(engine, P1, id("myTac"));
  foeUses(engine, id, "other", "zap");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("mine")), 0);
  assert.equal(zoneOf(engine, id("other")), "discard");
  assert.equal(zoneOf(engine, id("myTac")), "discard", "my own tactic still resolved afterwards");
});

clause(PUPPET, "1:ability", "if the character already destroyed itself as the ability's cost, the ability is still terminated and nothing breaks (Snooty Doorman's DENIED!)", () => {
  const { engine, id } = puppetBoard({
    active: P1,
    extra: [
      { key: "door", def: printing(DOORMAN), owner: P2, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  playRaw(engine, P1, id("mine2"));
  activateRaw(engine, P2, id("door"), "denied");
  assert.equal(zoneOf(engine, id("door")), "discard", "control: their Doorman is already destroyed as a cost");
  playRaw(engine, P1, id("pup"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine2")), "play", "DENIED! was terminated, so my character entered play");
  assert.equal(zoneOf(engine, id("door")), "discard");
  assert.equal(zoneOf(engine, id("pup")), "discard");
  assert.equal(engine.state.responseWindow, undefined);
  assert.equal(pending(engine), undefined);
});

clause(PUPPET, "1:ability", "is refused one resource short of its cost of 2, and without [E]", () => {
  const short = puppetBoard({ elitism: 1, rage: 0 });
  foeUses(short.engine, short.id, "guy", "zap");
  refused(() => playRaw(short.engine, P1, short.id("pup")), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("pup")), "hand");
  assert.equal(zoneOf(short.engine, short.id("guy")), "play");
  const noThreshold = puppetBoard({ elitism: 0, rage: 6 });
  foeUses(noThreshold.engine, noThreshold.id, "guy", "zap");
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("pup")), "no [E]");
  const exact = puppetBoard({ elitism: 1, rage: 1 });
  foeUses(exact.engine, exact.id, "guy", "zap");
  playRaw(exact.engine, P1, exact.id("pup"));
  resolvePendingResponses(exact.engine);
  assert.equal(zoneOf(exact.engine, exact.id("pup")), "discard", "[E] and exactly 2 resources works");
  assert.equal(zoneOf(exact.engine, exact.id("guy")), "discard");
  assert.equal(ready(exact.engine), 0);
});

// --- shared deploy checks (cost / threshold / printed stats) -------------------

type Icon = "rage" | "greed" | "deception" | "elitism" | "obsession";

/**
 * A card with printed cost `cost` and threshold `count` x `icon`: deployed for exactly `cost` resources when the threshold is met, refused one
 * resource short, refused with plenty of resources but the wrong icon, refused one icon short; the icons are a gate (never spent); printed stats and subtype.
 */
function deployChecks(printingId: string, spec: { cost: number; icon: Icon; count: number; stats?: number[]; subtypes?: string[]; types?: string[]; selected?: (id: IdOf) => Record<string, CardInstanceId[]>; extra?: CardPlacement[] }): void {
  const wrong: Icon = spec.icon === "greed" ? "rage" : "greed";
  const board = (main: number, others: number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      cards: [{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...(spec.extra ?? []), ...bank(spec.icon, main, P1), ...bank(wrong, others, P1)]
    });
  const need = Math.max(spec.cost, spec.count);
  const exact = board(need, 0);
  assert.equal(exact.engine.getCardPlayability(P1, exact.id("card")).playable, true, "playable with exactly enough resources and icons");
  const before = ready(exact.engine);
  play(exact.engine, P1, exact.id("card"), { selected: spec.selected?.(exact.id) ?? {} });
  drain(exact.engine, declineAll);
  assert.equal(zoneOf(exact.engine, exact.id("card")), "play");
  assert.equal(before - ready(exact.engine), spec.cost, `the printed cost of ${spec.cost} is paid`);
  if (spec.stats) assert.deepEqual(stats(exact.engine, exact.id("card")), spec.stats, "printed strength / life / speed");
  if (spec.subtypes) assert.deepEqual(exact.engine.getSubtypes(exact.id("card")), spec.subtypes);
  if (spec.types) assert.deepEqual(exact.engine.getCardTypes(exact.id("card")), spec.types);

  const short = board(need - 1, 0);
  assert.equal(short.engine.getCardPlayability(P1, short.id("card")).playable, false, "one resource short: not playable");
  refused(() => playRaw(short.engine, P1, short.id("card"), { selected: spec.selected?.(short.id) ?? {} }), "one resource short of the cost / threshold");
  assert.equal(zoneOf(short.engine, short.id("card")), "hand");
  assert.equal(ready(short.engine), need - 1, "nothing was paid");

  const wrongIcons = board(0, spec.cost + spec.count + 4);
  assert.equal(wrongIcons.engine.getCardPlayability(P1, wrongIcons.id("card")).thresholdMet, false, "no matching icons: the threshold is not met");
  refused(() => playRaw(wrongIcons.engine, P1, wrongIcons.id("card"), { selected: spec.selected?.(wrongIcons.id) ?? {} }), "plenty of resources of the wrong icon");
  assert.equal(zoneOf(wrongIcons.engine, wrongIcons.id("card")), "hand");

  const iconShort = board(spec.count - 1, spec.cost + spec.count + 4);
  assert.equal(iconShort.engine.getCardPlayability(P1, iconShort.id("card")).thresholdMet, false, "one icon short of the threshold");
  refused(() => playRaw(iconShort.engine, P1, iconShort.id("card"), { selected: spec.selected?.(iconShort.id) ?? {} }), "one icon short, with plenty of other resources");

  const gate = board(spec.count + spec.cost, 0);
  play(gate.engine, P1, gate.id("card"), { selected: spec.selected?.(gate.id) ?? {} });
  drain(gate.engine, declineAll);
  assert.equal(ready(gate.engine), spec.count, "only the numeric cost is spent; the threshold icons are a gate");
}

// =============================================================================
// Guardforce Morphmajig
// This card can attack even if it has not been in play under your control since
// the start of the turn. -- If you play a card, put a token on this card.
// (Playing a resource doesn't count.) -- If your opponent plays a card, remove a
// token from this card. (Playing a resource doesn't count.) -- This card gains 1
// strength and 1 life for each token on it.
// Character (guardforce, majig), cost 5, threshold [E][E], 3 / 3 / 3.
// =============================================================================

const GM = "0b06764e-d38c-4c62-bb15-7a71e79e1e2c";

function gmBoard(opts: { gm?: "play" | "hand"; tokens?: number; active?: Pid; eligible?: boolean; elitism?: number; damage?: number; depleted?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "gm", def: printing(GM), owner: P1, zone: opts.gm ?? "play", counters: opts.tokens ? { token: opts.tokens } : {}, attackEligible: opts.eligible, damage: opts.damage, depleted: opts.depleted },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "I1" }), owner: P1, zone: "hand" },
      { key: "l1", def: location({ name: "L1" }), owner: P1, zone: "hand" },
      { key: "t1", def: noopTactic("T1"), owner: P1, zone: "hand" },
      { key: "t2", def: noopTactic("T2"), owner: P1, zone: "hand" },
      { key: "r1", def: resourceCard({ name: "R1" }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "hand" },
      { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "hand" },
      { key: "oi1", def: item({ name: "OI1" }), owner: P2, zone: "hand" },
      { key: "ol1", def: location({ name: "OL1" }), owner: P2, zone: "hand" },
      { key: "ot1", def: noopTactic("OT1"), owner: P2, zone: "hand" },
      { key: "ot2", def: noopTactic("OT2"), owner: P2, zone: "hand" },
      { key: "or1", def: resourceCard({ name: "OR1" }), owner: P2, zone: "hand" },
      { key: "od1", def: character({ name: "OD1" }), owner: P2, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      ...bank("elitism", opts.elitism ?? 6, P1),
      ...(opts.extra ?? [])
    ]
  });
}

const attackRaw = (engine: SpoilsEngine, player: Pid, attackerIds: CardInstanceId[]): void =>
  engine.perform({ type: "declareAttack", playerId: player, attackerIds, target: { type: "faction", playerId: other(player) } });

// 0:rule — attack even if not in play since the start of the turn

clause(GM, "0:rule", "has the AGGRO keyword and an ordinary character does not", () => {
  const { engine, id } = gmBoard();
  assert.ok(hasKeyword(engine, id("gm"), "aggro"), "hasKeyword(engine, id(\"gm\"), \"aggro\")");
  assert.equal(hasKeyword(engine, id("mine"), "aggro"), false, "control: an ordinary character has no aggro");
});

clause(GM, "0:rule", "can attack even though it has not been in play under your control since the start of the turn (an ordinary character in the same position cannot)", () => {
  const { engine, id } = gmBoard({ eligible: false, extra: [{ key: "newbie", def: character({ name: "Newbie" }), owner: P1, zone: "play", attackEligible: false }] });
  refused(() => attackRaw(engine, P1, [id("newbie")]), "control: a character that has not been in play since the start of the turn cannot attack");
  assert.equal(battleOf(engine), undefined, "the refused attack started no battle");
  declareAttackBy(engine, P1, [id("gm")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("gm")], "the Morphmajig attacks");
  assert.equal(engine.state.cards[id("gm")].depleted, true, "declaring an attack depletes it as usual");
});

clause(GM, "0:rule", "deployed from your hand this turn, it can attack at once; another character deployed the same turn cannot", () => {
  const { engine, id } = gmBoard({ gm: "hand" });
  play(engine, P1, id("gm"));
  play(engine, P1, id("c1"));
  assert.equal(zoneOf(engine, id("gm")), "play");
  assert.equal(zoneOf(engine, id("c1")), "play");
  refused(() => attackRaw(engine, P1, [id("c1")]), "control: a character deployed this turn cannot attack");
  declareAttackBy(engine, P1, [id("gm")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("gm")]);
});

clause(GM, "0:rule", "can attack together with other eligible characters in one party", () => {
  const { engine, id } = gmBoard({ eligible: false });
  declareAttackBy(engine, P1, [id("gm"), id("mine")]);
  assert.deepEqual([...(battleOf(engine)?.attackingParty ?? [])].sort(), [id("gm"), id("mine")].sort());
});

clause(GM, "0:rule", "the haste only waives the 'since the start of the turn' requirement: a depleted Morphmajig still cannot attack", () => {
  const { engine, id } = gmBoard({ eligible: false, depleted: true });
  refused(() => attackRaw(engine, P1, [id("gm")]), "depleted characters cannot attack");
  assert.equal(battleOf(engine), undefined);
});

clause(GM, "0:rule", "the haste is only for the Morphmajig itself: it does not let another character in the party skip the requirement", () => {
  const { engine, id } = gmBoard({ eligible: false, extra: [{ key: "newbie", def: character({ name: "Newbie" }), owner: P1, zone: "play", attackEligible: false }] });
  refused(() => attackRaw(engine, P1, [id("gm"), id("newbie")]), "the new character cannot join the attack", /did not start the turn in play/);
  assert.equal(battleOf(engine), undefined);
});

clause(GM, "0:rule", "put into play by an effect this turn it can still attack", () => {
  const raise = tactic({
    name: "Raise",
    cost: 0,
    behavior: { abilities: [{ id: "raise", type: "activated", targets: [{ id: "t", selector: { controller: "self", zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const { engine, id } = gmBoard({ extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }, { key: "dead", def: printing(GM), owner: P1, zone: "discard" }] });
  play(engine, P1, id("raise"), { selected: { t: [id("dead")] } });
  assert.equal(zoneOf(engine, id("dead")), "play");
  declareAttackBy(engine, P1, [id("dead")]);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("dead")]);
});

// 1:rule — If you play a card, put a token on this card.

for (const [key, label] of [
  ["c1", "a character"],
  ["i1", "an item"],
  ["l1", "a location"],
  ["t1", "a tactic"]
] as const) {
  clause(GM, "1:rule", `playing ${label} puts exactly one token on the Morphmajig`, () => {
    const { engine, id } = gmBoard();
    assert.equal(tokensOn(engine, id("gm")), 0);
    play(engine, P1, id(key));
    assert.equal(zoneOf(engine, id(key)), key === "t1" ? "discard" : "play", "the card was really played");
    assert.equal(tokensOn(engine, id("gm")), 1);
  });
}

clause(GM, "1:rule", "every card you play adds another token: three plays make three tokens", () => {
  const { engine, id } = gmBoard();
  play(engine, P1, id("c1"));
  play(engine, P1, id("i1"));
  play(engine, P1, id("t1"));
  assert.equal(tokensOn(engine, id("gm")), 3);
});

clause(GM, "1:rule", "the token is put on as the card is played, before the opponent responds", () => {
  const { engine, id } = gmBoard();
  playRaw(engine, P1, id("c1"));
  assert.notEqual(zoneOf(engine, id("c1")), "hand", "the card is being played");
  assert.equal(tokensOn(engine, id("gm")), 1, "already one token while the opponent may still respond");
});

clause(GM, "1:rule", "playing a resource does not count: neither a face-up resource nor a face-down card gives a token", () => {
  const face = gmBoard();
  developResource(face.engine, P1, face.id("r1"), false);
  assert.equal(zoneOf(face.engine, face.id("r1")), "play");
  assert.equal(tokensOn(face.engine, face.id("gm")), 0, "a face-up resource is not 'a card played'");
  const down = gmBoard();
  developResource(down.engine, P1, down.id("d1"), true);
  assert.equal(down.engine.state.cards[down.id("d1")].faceDown, true);
  assert.equal(tokensOn(down.engine, down.id("gm")), 0, "a face-down resource is not 'a card played'");
});

clause(GM, "1:rule", "using an ability is not playing a card: no token", () => {
  const ping = item({ name: "Ping", behavior: { abilities: [{ id: "ping", type: "activated", effects: [] }] } });
  const { engine, id } = gmBoard({ extra: [{ key: "ping", def: ping, owner: P1, zone: "play" }] });
  activate(engine, P1, id("ping"), "ping");
  assert.equal(tokensOn(engine, id("gm")), 0);
  play(engine, P1, id("c1"));
  assert.equal(tokensOn(engine, id("gm")), 1, "control: playing a card still gives a token");
});

clause(GM, "1:rule", "a card put into play by an effect is not 'played': no token", () => {
  const dropper = item({
    name: "Dropper",
    behavior: {
      abilities: [{ id: "drop", type: "activated", targets: [{ id: "h", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }] }]
    }
  });
  const { engine, id } = gmBoard({ extra: [{ key: "dropper", def: dropper, owner: P1, zone: "play" }] });
  activate(engine, P1, id("dropper"), "drop", { selected: { h: [id("c1")] } });
  assert.equal(zoneOf(engine, id("c1")), "play", "the character was put into play");
  assert.equal(tokensOn(engine, id("gm")), 0, "put into play is not played");
});

clause(GM, "1:rule", "when the Morphmajig itself is played it is not in play yet, so it gets no token and has its printed stats", () => {
  const { engine, id } = gmBoard({ gm: "hand" });
  play(engine, P1, id("gm"));
  assert.equal(zoneOf(engine, id("gm")), "play");
  assert.equal(tokensOn(engine, id("gm")), 0);
  assert.deepEqual(stats(engine, id("gm")), [3, 3, 3]);
  play(engine, P1, id("c1"));
  assert.equal(tokensOn(engine, id("gm")), 1, "control: the next card played gives a token");
});

clause(GM, "1:rule", "a Morphmajig still in your hand collects no tokens", () => {
  const { engine, id } = gmBoard({ gm: "hand" });
  play(engine, P1, id("c1"));
  play(engine, P1, id("t1"));
  assert.equal(tokensOn(engine, id("gm")), 0);
});

clause(GM, "1:rule", "each Morphmajig you control gets its own token", () => {
  const { engine, id } = gmBoard({ extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play" }] });
  play(engine, P1, id("c1"));
  drain(engine, declineAll);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("gm")), 1);
  assert.equal(tokensOn(engine, id("gm2")), 1);
});

clause(GM, "1:rule", "'you' is the controller: a Morphmajig you control but the opponent owns gets the token when you play a card", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "gm", def: printing(GM), owner: P2, controller: P1, zone: "play" },
      { key: "c1", def: character({ name: "C1" }), owner: P1, zone: "hand" },
      { key: "oc1", def: character({ name: "OC1" }), owner: P2, zone: "hand" }
    ]
  });
  play(engine, P1, id("c1"));
  assert.equal(tokensOn(engine, id("gm")), 1, "its controller played a card");
});

clause(GM, "1:rule", "the opponent's own Morphmajig gains a token when ITS controller plays a card, and yours does not", () => {
  const { engine, id } = gmBoard({ active: P2, extra: [{ key: "ogm", def: printing(GM), owner: P2, zone: "play" }] });
  play(engine, P2, id("oc1"));
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("ogm")), 1, "the opponent's Morphmajig gets a token from the opponent's play");
  assert.equal(tokensOn(engine, id("gm")), 0, "mine got no token (the opponent's play does not add one to mine)");
});

clause(GM, "1:rule", "a card you play in response during the opponent's turn gives a token as well", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 2 });
  playRaw(engine, P2, id("oc1"));
  assert.equal(tokensOn(engine, id("gm")), 1, "the opponent's play removed one");
  playRaw(engine, P1, id("t1"));
  assert.equal(tokensOn(engine, id("gm")), 2, "my response put one back");
});

// 2:rule — If your opponent plays a card, remove a token from this card.

for (const [key, label] of [
  ["oc1", "a character"],
  ["oi1", "an item"],
  ["ol1", "a location"],
  ["ot1", "a tactic"]
] as const) {
  clause(GM, "2:rule", `the opponent playing ${label} removes exactly one token`, () => {
    const { engine, id } = gmBoard({ active: P2, tokens: 3 });
    play(engine, P2, id(key));
    assert.equal(zoneOf(engine, id(key)), key === "ot1" ? "discard" : "play", "the card was really played");
    assert.equal(tokensOn(engine, id("gm")), 2);
  });
}

clause(GM, "2:rule", "each card the opponent plays removes another token", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 3 });
  play(engine, P2, id("oc1"));
  play(engine, P2, id("ot1"));
  play(engine, P2, id("oi1"));
  assert.equal(tokensOn(engine, id("gm")), 0);
});

clause(GM, "2:rule", "with no tokens there is nothing to remove: the count stays at 0 and never goes negative", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 0 });
  play(engine, P2, id("oc1"));
  assert.equal(tokensOn(engine, id("gm")), 0);
  assert.deepEqual(stats(engine, id("gm")), [3, 3, 3]);
});

clause(GM, "2:rule", "the opponent playing a resource does not remove a token (face-up and face-down)", () => {
  const face = gmBoard({ active: P2, tokens: 2 });
  developResource(face.engine, P2, face.id("or1"), false);
  assert.equal(zoneOf(face.engine, face.id("or1")), "play");
  assert.equal(tokensOn(face.engine, face.id("gm")), 2, "a face-up resource is not 'a card played'");
  const down = gmBoard({ active: P2, tokens: 2 });
  developResource(down.engine, P2, down.id("od1"), true);
  assert.equal(down.engine.state.cards[down.id("od1")].faceDown, true);
  assert.equal(tokensOn(down.engine, down.id("gm")), 2, "a face-down resource is not 'a card played'");
});

clause(GM, "2:rule", "playing a card yourself does not remove a token (you gain one)", () => {
  const { engine, id } = gmBoard({ tokens: 2 });
  play(engine, P1, id("c1"));
  assert.equal(tokensOn(engine, id("gm")), 3);
});

clause(GM, "2:rule", "a tactic the opponent plays in response during your turn removes a token", () => {
  const { engine, id } = gmBoard({ tokens: 2 });
  playRaw(engine, P1, id("c1"));
  assert.equal(tokensOn(engine, id("gm")), 3, "my play added one");
  playRaw(engine, P2, id("ot1"));
  assert.equal(tokensOn(engine, id("gm")), 2, "the opponent's response removed one");
  resolvePendingResponses(engine);
  assert.equal(tokensOn(engine, id("gm")), 2);
});

clause(GM, "2:rule", "things the opponent merely does without playing a card (ability, putting a card into play) remove nothing", () => {
  const ping = item({
    name: "OppPing",
    behavior: {
      abilities: [
        { id: "ping", type: "activated", effects: [] },
        { id: "drop", type: "activated", targets: [{ id: "h", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "h" }, controller: "controller" }] }
      ]
    }
  });
  const { engine, id } = gmBoard({ active: P2, tokens: 2, extra: [{ key: "oping", def: ping, owner: P2, zone: "play" }] });
  activate(engine, P2, id("oping"), "ping");
  assert.equal(tokensOn(engine, id("gm")), 2, "an ability is not a card played");
  activate(engine, P2, id("oping"), "drop", { selected: { h: [id("oc1")] } });
  assert.equal(zoneOf(engine, id("oc1")), "play");
  assert.equal(tokensOn(engine, id("gm")), 2, "put into play is not played");
});

clause(GM, "2:rule", "every Morphmajig you control loses a token when the opponent plays a card", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 2, extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play", counters: { token: 1 } }] });
  play(engine, P2, id("oc1"));
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("gm")), 1);
  assert.equal(tokensOn(engine, id("gm2")), 0);
});

clause(GM, "2:rule", "the opponent's own Morphmajig is not hurt by the opponent's plays (only mine is)", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 2, extra: [{ key: "ogm", def: printing(GM), owner: P2, zone: "play", counters: { token: 2 } }] });
  play(engine, P2, id("oc1"));
  drain(engine, declineAll);
  assert.equal(tokensOn(engine, id("gm")), 1, "mine loses one");
  assert.equal(tokensOn(engine, id("ogm")), 3, "theirs gains one");
});

// 3:rule — This card gains 1 strength and 1 life for each token on it.

for (const n of [0, 1, 2, 5]) {
  clause(GM, "3:rule", `with ${n} token(s) it is ${3 + n}/${3 + n}/3: +${n} strength and +${n} life, speed unchanged`, () => {
    const { engine, id } = gmBoard({ tokens: n });
    assert.deepEqual(stats(engine, id("gm")), [3 + n, 3 + n, 3]);
  });
}

clause(GM, "3:rule", "only tokens count: other kinds of counters add nothing", () => {
  const { engine, id } = gmBoard({ extra: [{ key: "gm2", def: printing(GM), owner: P1, zone: "play", counters: { charge: 3, token: 1 } }] });
  assert.deepEqual(stats(engine, id("gm2")), [4, 4, 3], "one token, three charge counters: +1/+1 only");
});

clause(GM, "3:rule", "only the Morphmajig's own tokens count: another character's tokens give it nothing, and the Morphmajig's tokens buff nobody else", () => {
  const { engine, id } = gmBoard({ tokens: 2, extra: [{ key: "tok", def: character({ name: "Tok", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play", counters: { token: 3 } }] });
  assert.deepEqual(stats(engine, id("tok")), [2, 2, 2], "a plain character with tokens is unchanged");
  assert.deepEqual(stats(engine, id("mine")), [1, 6, 1], "my other character is unchanged");
  assert.deepEqual(stats(engine, id("foe")), [1, 6, 1], "the opponent's character is unchanged");
  assert.deepEqual(stats(engine, id("gm")), [5, 5, 3]);
});

clause(GM, "3:rule", "the bonus follows the token count as tokens come and go: +1/+1 for a card you play, -1/-1 for a card the opponent plays", () => {
  const up = gmBoard({ tokens: 1 });
  assert.deepEqual(stats(up.engine, up.id("gm")), [4, 4, 3]);
  play(up.engine, P1, up.id("c1"));
  assert.deepEqual(stats(up.engine, up.id("gm")), [5, 5, 3], "a played card: +1/+1");
  const down = gmBoard({ active: P2, tokens: 2 });
  assert.deepEqual(stats(down.engine, down.id("gm")), [5, 5, 3]);
  play(down.engine, P2, down.id("oc1"));
  assert.deepEqual(stats(down.engine, down.id("gm")), [4, 4, 3], "an opponent's played card: -1/-1");
});

clause(GM, "3:rule", "the life bonus is real life: a token lets it survive damage that would kill it without one", () => {
  const kill = gmBoard({ extra: [{ key: "zap", def: damageTactic(4, "Zap4"), owner: P1, zone: "hand" }] });
  play(kill.engine, P1, kill.id("zap"), { selected: { t: [kill.id("gm")] } });
  assert.equal(tokensOn(kill.engine, kill.id("gm")), 0, "the token it got from playing the Zap vanished when it left play (CR 409.2)");
  assert.equal(zoneOf(kill.engine, kill.id("gm")), "discard", "control: 4 damage kills the 4-life Morphmajig (3 life + the token from playing Zap)");
  const live = gmBoard({ tokens: 1, extra: [{ key: "zap", def: damageTactic(4, "Zap4"), owner: P1, zone: "hand" }] });
  play(live.engine, P1, live.id("zap"), { selected: { t: [live.id("gm")] } });
  assert.equal(tokensOn(live.engine, live.id("gm")), 2);
  assert.equal(zoneOf(live.engine, live.id("gm")), "play", "with one more token it has 5 life and survives 4 damage");
  assert.equal(damageOn(live.engine, live.id("gm")), 4);
});

clause(GM, "3:rule", "the strength bonus is real in battle: with 2 tokens (5 strength) it deals 5 damage to the faction", () => {
  const { engine, id } = gmBoard({ tokens: 2 });
  const before = engine.state.players[P2].influence;
  fightThrough(engine, P1, [id("gm")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - engine.state.players[P2].influence, 5);
});

clause(GM, "3:rule", "losing the last token drops the life bonus and a Morphmajig carrying enough damage is destroyed", () => {
  const { engine, id } = gmBoard({ active: P2, tokens: 1, damage: 3 });
  assert.equal(zoneOf(engine, id("gm")), "play", "4 life with 3 damage: alive");
  play(engine, P2, id("oc1"));
  assert.equal(tokensOn(engine, id("gm")), 0);
  assert.equal(zoneOf(engine, id("gm")), "discard", "3 life with 3 damage: destroyed");
});

clause(GM, "3:rule", "tokens do not survive leaving play (CR 409.2): a Morphmajig that was bounced and is played again has no tokens", () => {
  const { engine, id } = gmBoard({ tokens: 2, extra: [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bounce"), { selected: { t: [id("gm")] } });
  assert.equal(zoneOf(engine, id("gm")), "hand");
  play(engine, P1, id("gm"));
  assert.equal(zoneOf(engine, id("gm")), "play");
  assert.equal(tokensOn(engine, id("gm")), 0, "its old tokens are gone");
  assert.deepEqual(stats(engine, id("gm")), [3, 3, 3]);
});

clause(GM, "0:rule", "the card itself: costs exactly 5 with [E][E], printed 3 / 3 / 3, subtypes guardforce and majig", () =>
  deployChecks(GM, { cost: 5, icon: "elitism", count: 2, stats: [3, 3, 3], subtypes: ["guardforce", "majig"], types: ["character"] })
);

// =============================================================================
// LeoKaiser
// GO MEGA-NEKO-KAISER! -- COST: Deplete a card named PantherKaiser you control.
// Deplete a card named TigerKaiser you control. EFFECT: This turn, this card
// gains 8 strength, 8 life, and 2 speed and while it is the only member of an
// attacking party, only parties with at least 3 members can block it.
// Character (kaiser), gearsmith, cost 4, threshold [E][E][E], 3 / 3 / 3.
// =============================================================================

const LEO = "8324f58c-8777-43c0-9250-bc2643afcb00";
const PANTHER = "eb3eb01d-cb76-4159-a269-b9d1bbe3b973";
const TIGER = "ec420c2e-7624-4682-9309-da550903f6ad";

function leoBoard(opts: { leoDepleted?: boolean; panther?: boolean; tiger?: boolean; resources?: number; extra?: CardPlacement[]; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play", depleted: opts.leoDepleted },
      ...(opts.panther === false ? [] : [{ key: "pk", def: printing(PANTHER), owner: P1, zone: "play" as const }]),
      ...(opts.tiger === false ? [] : [{ key: "tk", def: printing(TIGER), owner: P1, zone: "play" as const }]),
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "B3", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "b4", def: character({ name: "B4", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", opts.resources ?? 5, P1),
      ...(opts.extra ?? [])
    ]
  });
}
type LeoBoard = ReturnType<typeof leoBoard>;

const megaSel = (id: IdOf): Record<string, CardInstanceId[]> => ({ pk: [id("pk")], tk: [id("tk")] });
const megaRaw = (b: LeoBoard, selected = megaSel(b.id)): void => activateRaw(b.engine, P1, b.id("leo"), "mega", { selected });
const mega = (b: LeoBoard, selected = megaSel(b.id)): void => activate(b.engine, P1, b.id("leo"), "mega", { selected });
const blockWith = (b: LeoBoard, keys: string[]) => () => declareBlock(b.engine, P2, keys.map(b.id));

clause(LEO, "0:ability:mega", "the cost is depleting PantherKaiser and TigerKaiser, paid on activation; Leo is not depleted and no resource is paid", () => {
  const b = leoBoard();
  const before = ready(b.engine);
  megaRaw(b);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true, "PantherKaiser depleted as a cost");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, true, "TigerKaiser depleted as a cost");
  assert.equal(b.engine.state.cards[b.id("leo")].depleted, false, "Leo himself is not depleted");
  assert.equal(b.engine.state.cards[b.id("ally")].depleted, false, "nothing else is depleted");
  assert.equal(ready(b.engine), before, "no resources are paid");
  assert.deepEqual(stats(b.engine, b.id("leo")), [3, 3, 3], "the effect has not resolved yet");
});

clause(LEO, "0:ability:mega", "this turn Leo gains exactly 8 strength, 8 life and 2 speed", () => {
  const b = leoBoard();
  mega(b);
  assert.deepEqual(stats(b.engine, b.id("leo")), [11, 11, 5]);
  assert.deepEqual(stats(b.engine, b.id("pk")), [1, 3, 2], "PantherKaiser is unchanged");
  assert.deepEqual(stats(b.engine, b.id("ally")), [1, 3, 1], "nobody else is changed");
});

clause(LEO, "0:ability:mega", "the boost ends with the turn", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  assert.deepEqual(stats(b.engine, b.id("leo")), [3, 3, 3]);
});

clause(LEO, "0:ability:mega", "needs a PantherKaiser: refused with only TigerKaiser, and nothing is depleted", () => {
  const b = leoBoard({ panther: false, extra: [{ key: "pk", def: character({ name: "Panther" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no PantherKaiser");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false, "no partial payment");
});

clause(LEO, "0:ability:mega", "needs a TigerKaiser: refused with only PantherKaiser, and nothing is depleted", () => {
  const b = leoBoard({ tiger: false, extra: [{ key: "tk", def: character({ name: "Tiger" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no TigerKaiser");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false, "no partial payment");
});

clause(LEO, "0:ability:mega", "is refused with neither Kaiser, and works once both are in play", () => {
  const b = leoBoard({ panther: false, tiger: false, extra: [{ key: "pk", def: character({ name: "P" }), owner: P1, zone: "play" }, { key: "tk", def: character({ name: "T" }), owner: P1, zone: "play" }] });
  refused(() => megaRaw(b), "no Kaiser at all");
  const ok = leoBoard();
  mega(ok);
  assert.deepEqual(stats(ok.engine, ok.id("leo")), [11, 11, 5]);
});

clause(LEO, "0:ability:mega", "the Kaisers must be yours: an opponent's PantherKaiser / TigerKaiser cannot pay the cost", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play" },
      { key: "pk", def: printing(PANTHER), owner: P2, zone: "play" },
      { key: "tk", def: printing(TIGER), owner: P2, zone: "play" }
    ]
  });
  refused(() => activateRaw(b.engine, P1, b.id("leo"), "mega", { selected: { pk: [b.id("pk")], tk: [b.id("tk")] } }), "the opponent's Kaisers");
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a Kaiser you CONTROL counts even if the opponent owns it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    cards: [
      { key: "leo", def: printing(LEO), owner: P1, zone: "play" },
      { key: "pk", def: printing(PANTHER), owner: P2, controller: P1, zone: "play" },
      { key: "tk", def: printing(TIGER), owner: P1, zone: "play" }
    ]
  });
  activateRaw(b.engine, P1, b.id("leo"), "mega", { selected: { pk: [b.id("pk")], tk: [b.id("tk")] } });
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, true);
});

clause(LEO, "0:ability:mega", "an already-depleted PantherKaiser or TigerKaiser cannot be depleted again: refused, nothing else depleted", () => {
  for (const dep of ["pk", "tk"] as const) {
    const b = leoBoard();
    b.engine.state.cards[b.id(dep)].depleted = true;
    refused(() => megaRaw(b), `${dep} is already depleted`);
    const otherKey = dep === "pk" ? "tk" : "pk";
    assert.equal(b.engine.state.cards[b.id(otherKey)].depleted, false, "no partial payment");
    assert.deepEqual(stats(b.engine, b.id("leo")), [3, 3, 3]);
  }
});

clause(LEO, "0:ability:mega", "the names must match exactly: look-alike names do not pay the cost", () => {
  for (const [pName, tName] of [["PantherKaiser2", "TigerKaiser"], ["PantherKaiser", "Tiger Kaiser"], ["Panther", "TigerKaiser"], ["PantherKaiser", "TigerKaiser Jr"]]) {
    const b = leoBoard({
      panther: false,
      tiger: false,
      extra: [
        { key: "pk", def: character({ name: pName, subtype: ["kaiser"] }), owner: P1, zone: "play" },
        { key: "tk", def: character({ name: tName, subtype: ["kaiser"] }), owner: P1, zone: "play" }
      ]
    });
    refused(() => megaRaw(b), `${pName} / ${tName}`);
  }
  const ok = leoBoard({
    panther: false,
    tiger: false,
    extra: [
      { key: "pk", def: character({ name: "PantherKaiser" }), owner: P1, zone: "play" },
      { key: "tk", def: character({ name: "TigerKaiser" }), owner: P1, zone: "play" }
    ]
  });
  megaRaw(ok);
  assert.equal(ok.engine.state.cards[ok.id("pk")].depleted, true, "control: any cards with the right names work, the subtype is not needed");
});

clause(LEO, "0:ability:mega", "the cost names cards, not characters: an item named PantherKaiser can be depleted for it", () => {
  const b = leoBoard({ panther: false, extra: [{ key: "pk", def: item({ name: "PantherKaiser" }), owner: P1, zone: "play" }] });
  megaRaw(b);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, true);
});

clause(LEO, "0:ability:mega", "a face-down card has no name (CR 411.1): a face-down 'PantherKaiser' cannot be depleted for the cost", () => {
  const b = leoBoard({ panther: false, extra: [{ key: "pk", def: printing(PANTHER), owner: P1, zone: "play", faceDown: true }] });
  refused(() => megaRaw(b), "a face-down card has no name");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
});

clause(LEO, "0:ability:mega", "with two PantherKaisers you choose which one to deplete; the other stays ready", () => {
  const b = leoBoard({ extra: [{ key: "pk2", def: printing(PANTHER), owner: P1, zone: "play" }] });
  megaRaw(b, { pk: [b.id("pk2")], tk: [b.id("tk")] });
  assert.equal(b.engine.state.cards[b.id("pk2")].depleted, true);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a card that is not named PantherKaiser cannot be picked for the PantherKaiser slot (nor TigerKaiser for the Tiger slot)", () => {
  const b = leoBoard();
  refused(() => megaRaw(b, { pk: [b.id("ally")], tk: [b.id("tk")] }), "Ally is not a PantherKaiser");
  refused(() => megaRaw(b, { pk: [b.id("tk")], tk: [b.id("tk")] }), "TigerKaiser in the Panther slot");
  refused(() => megaRaw(b, { pk: [b.id("pk")], tk: [b.id("pk")] }), "PantherKaiser in the Tiger slot");
  assert.equal(b.engine.state.cards[b.id("tk")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "usable while Leo himself is depleted (the cost does not need him ready)", () => {
  const b = leoBoard({ leoDepleted: true });
  mega(b);
  assert.deepEqual(stats(b.engine, b.id("leo")), [11, 11, 5]);
  assert.equal(b.engine.state.cards[b.id("leo")].depleted, true);
});

clause(LEO, "0:ability:mega", "cannot be used twice in a turn: both Kaisers are depleted afterwards", () => {
  const b = leoBoard();
  mega(b);
  refused(() => megaRaw(b), "both Kaisers are depleted");
  assert.deepEqual(stats(b.engine, b.id("leo")), [11, 11, 5], "bonus applied once");
});

clause(LEO, "0:ability:mega", "usable again on a later turn, once the Kaisers have been restored", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false, "restored at the start of my turn");
  mega(b);
  assert.deepEqual(stats(b.engine, b.id("leo")), [11, 11, 5]);
});

clause(LEO, "0:ability:mega", "only Leo's controller can use it", () => {
  const b = leoBoard();
  refused(() => activateRaw(b.engine, P2, b.id("leo"), "mega", { selected: megaSel(b.id) }), "the opponent", /control|own|activate|yours?/i);
  assert.equal(b.engine.state.cards[b.id("pk")].depleted, false);
});

clause(LEO, "0:ability:mega", "a lone Leo cannot be blocked by a party of 1 or 2, but a party of 3 (or 4) can block him", () => {
  for (const [keys, ok] of [
    [["b1"], false],
    [["b1", "b2"], false],
    [["b1", "b2", "b3"], true],
    [["b1", "b2", "b3", "b4"], true]
  ] as const) {
    const b = leoBoard();
    mega(b);
    declareAttackBy(b.engine, P1, [b.id("leo")]);
    if (ok) {
      blockWith(b, [...keys])();
      assert.equal(battleOf(b.engine)?.blockingParty.length, keys.length, `${keys.length} blockers are allowed`);
    } else {
      refused(blockWith(b, [...keys]), `a party of ${keys.length} cannot block a lone Leo`);
    }
  }
});

clause(LEO, "0:ability:mega", "a lone Leo can still be left unblocked, and attacking is unaffected", () => {
  const b = leoBoard();
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, [])();
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.players[P2].influence, 30 - 11, "Leo's 11 strength hit the faction");
});

clause(LEO, "0:ability:mega", "control: without the ability a single blocker can block Leo", () => {
  const b = leoBoard();
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "with another member in the attacking party Leo is not the only member: a single blocker may block", () => {
  const b = leoBoard();
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo"), b.id("ally")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "used in the attack's response window (after attacking alone) it still restricts the blocking party", () => {
  const b = leoBoard();
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("leo")], target: { type: "faction", playerId: P2 } });
  activate(b.engine, P1, b.id("leo"), "mega", { selected: megaSel(b.id) });
  assert.equal(battleOf(b.engine)?.phase, "blocking");
  refused(blockWith(b, ["b1", "b2"]), "a party of 2");
  blockWith(b, ["b1", "b2", "b3"])();
  assert.equal(battleOf(b.engine)?.blockingParty.length, 3);
});

clause(LEO, "0:ability:mega", "the blocking restriction lasts this turn only: next turn a single blocker can block a lone Leo", () => {
  const b = leoBoard();
  mega(b);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["b1"])();
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("b1")]);
});

clause(LEO, "0:ability:mega", "the speed is real: a 5-speed Leo strikes before a 4-speed blocker", () => {
  const fast = character({ name: "Fast", strength: 20, life: 3, speed: 4 });
  const b = leoBoard({ extra: [{ key: "f1", def: fast, owner: P2, zone: "play" }, { key: "f2", def: fast, owner: P2, zone: "play" }, { key: "f3", def: fast, owner: P2, zone: "play" }] });
  mega(b);
  declareAttackBy(b.engine, P1, [b.id("leo")]);
  blockWith(b, ["f1", "f2", "f3"])();
  autoResolveBattle(b.engine, (source) => {
    const target = source.legalTargets[0];
    return target && source.strength > 0 ? [{ sourceId: source.cardId, target, amount: source.strength }] : [];
  });
  assert.equal(zoneOf(b.engine, b.id("f1")), "discard", "Leo (speed 5) killed the first blocker before it could strike");
});

clause(LEO, "0:ability:mega", "the card itself: costs 4 with [E][E][E], printed 3 / 3 / 3, subtype kaiser", () =>
  deployChecks(LEO, { cost: 4, icon: "elitism", count: 3, stats: [3, 3, 3], subtypes: ["kaiser"], types: ["character"] })
);

// =============================================================================
// Micromajig Shipping Container
// If this card is destroyed, put 5 Micromajig tokens into play under your
// control. -- (Treat Micromajig tokens as Gearsmith character cards with 1
// strength, 1 life, 3 speed, and the "majig" subtype. If a Micromajig token
// leaves play, it disappears.)
// Character (machine), gearsmith, cost 6, threshold [E][E], 4 / 5 / 3.
// =============================================================================

const MSC = "0d11a1d5-315e-49ad-ba92-6469206e8c64";

/** A free tactic that sends one chosen character in play to `to` (id `s`, declaration `t`). */
function sendTactic(to: "hand" | "deck" | "void" | "remove" | "destroy"): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({ name: `Send-${to}`, cost: 0, behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [effect] }] } });
}

/** A free tactic that destroys any one card in play, face-down cards included (id `d`, declaration `t`). */
const destroyAnyTactic = (): CardDefinition =>
  tactic({ name: "DestroyAny", cost: 0, behavior: { abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });

/** The Micromajig tokens `player` controls in play. */
function micromajigs(engine: SpoilsEngine, player: Pid = P1): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);
}

/** A token that left play is out of the game: in no hand, deck, discard pile or play area. */
function assertTokenGone(engine: SpoilsEngine, cardId: CardInstanceId, label: string): void {
  const card = engine.state.cards[cardId];
  assert.ok(card === undefined || card.zone === "removed", `${label}: the token is out of the game (zone ${card?.zone})`);
  for (const player of [P1, P2] as const) {
    assert.equal(discardOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s discard pile`);
    assert.equal(handOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s hand`);
    assert.equal(deckOf(engine, player).includes(cardId), false, `${label}: not in ${player}'s deck`);
    assert.equal(engine.state.players[player].play.includes(cardId), false, `${label}: not in ${player}'s play area`);
  }
}

function mscBoard(opts: { owner?: Pid; controller?: Pid; faceDown?: boolean; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "msc", def: printing(MSC), owner: opts.owner ?? P1, controller: opts.controller, zone: "play", faceDown: opts.faceDown },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" },
      { key: "destroyAny", def: destroyAnyTactic(), owner: P1, zone: "hand" },
      { key: "zap1", def: damageTactic(1, "Zap1"), owner: P1, zone: "hand" },
      { key: "zap4", def: damageTactic(4, "Zap4"), owner: P1, zone: "hand" },
      { key: "zap5", def: damageTactic(5, "Zap5"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 6, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...fillers("fill", 4, P1, "deck"),
      ...fillers("ofill", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ]
  });
}
type MscBoard = ReturnType<typeof mscBoard>;

/** Destroys the Shipping Container with the free Kill tactic. */
const killMsc = (b: MscBoard, key = "msc", tacticKey = "kill"): void => {
  play(b.engine, P1, b.id(tacticKey), { selected: { t: [b.id(key)] } });
  drain(b.engine, declineAll);
};
const mscTokens = (b: MscBoard): CardInstanceId[] => {
  killMsc(b);
  return micromajigs(b.engine, P1);
};

clause(MSC, "0:rule", "destroyed, it puts exactly 5 Micromajig tokens into play under its controller's control (none for the opponent)", () => {
  const b = mscBoard();
  killMsc(b);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard");
  assert.equal(micromajigs(b.engine, P1).length, 5, "five tokens for me");
  assert.equal(micromajigs(b.engine, P2).length, 0, "none for the opponent");
  for (const t of micromajigs(b.engine, P1)) {
    assert.equal(b.engine.state.cards[t].zone, "play");
    assert.equal(b.engine.state.cards[t].ownerId, P1, "the owner of a card token is the player who controlled the effect (CR 409.3b)");
    assert.equal(b.engine.state.cards[t].depleted, false);
  }
});

clause(MSC, "0:rule", "destroyed by non-battle damage it puts the 5 tokens into play", () => {
  const b = mscBoard();
  play(b.engine, P1, b.id("zap5"), { selected: { t: [b.id("msc")] } });
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "5 damage destroys the 5-life container");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "destroyed by battle damage (as a blocker) it puts the 5 tokens into play", () => {
  const b = mscBoard({ active: P2 });
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  declareBlock(b.engine, P1, [b.id("msc")]);
  finishBattle(b.engine);
  resolvePendingResponses(b.engine);
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "6 battle damage destroys the container");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "destroyed as the cost of one of my own abilities, it still puts the 5 tokens into play", () => {
  const sac = item({
    name: "Sac",
    behavior: { abilities: [{ id: "sac", type: "activated", targets: [{ id: "s", selector: { controller: "self", type: "character" }, count: 1 }], costs: [{ type: "destroy", target: { type: "selected", id: "s" } }], effects: [] }] }
  });
  const b = mscBoard({ extra: [{ key: "sac", def: sac, owner: P1, zone: "play" }] });
  activate(b.engine, P1, b.id("sac"), "sac", { selected: { s: [b.id("msc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard");
  assert.equal(micromajigs(b.engine, P1).length, 5);
});

clause(MSC, "0:rule", "'under your control': a container I control but the opponent owns puts the tokens under MY control", () => {
  const b = mscBoard({ owner: P2, controller: P1 });
  killMsc(b);
  assert.equal(micromajigs(b.engine, P1).length, 5, "tokens go to the controller");
  assert.equal(micromajigs(b.engine, P2).length, 0);
  for (const t of micromajigs(b.engine, P1)) assert.equal(b.engine.state.cards[t].ownerId, P1, "owned by whoever controlled the effect");
});

clause(MSC, "0:rule", "the opponent's container, destroyed, puts the tokens under the opponent's control", () => {
  const b = mscBoard({ owner: P2 });
  killMsc(b);
  assert.equal(micromajigs(b.engine, P2).length, 5);
  assert.equal(micromajigs(b.engine, P1).length, 0);
});

clause(MSC, "0:rule", "two destroyed containers make ten tokens", () => {
  const b = mscBoard({ extra: [{ key: "msc2", def: printing(MSC), owner: P1, zone: "play" }] });
  killMsc(b, "msc", "kill");
  assert.equal(micromajigs(b.engine, P1).length, 5);
  killMsc(b, "msc2", "kill2");
  assert.equal(micromajigs(b.engine, P1).length, 10);
});

clause(MSC, "0:rule", "a container that merely leaves play (returned to hand, removed from the game, put in the deck or void) was not destroyed: no tokens", () => {
  for (const [key, zone] of [["sendHand", "hand"], ["sendRemove", "removed"], ["sendDeck", "deck"], ["sendVoid", "void"]] as const) {
    const b = mscBoard();
    play(b.engine, P1, b.id(key), { selected: { t: [b.id("msc")] } });
    drain(b.engine, declineAll);
    assert.equal(zoneOf(b.engine, b.id("msc")), zone, `the container went to ${zone}`);
    assert.equal(micromajigs(b.engine, P1).length, 0, `${key}: no tokens`);
  }
});

clause(MSC, "0:rule", "a face-down container is only a resource: destroying it makes no tokens", () => {
  const b = mscBoard({ faceDown: true });
  assert.equal(b.engine.state.cards[b.id("msc")].faceDown, true);
  play(b.engine, P1, b.id("destroyAny"), { selected: { t: [b.id("msc")] } });
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("msc")), "discard", "the face-down card was destroyed");
  assert.equal(micromajigs(b.engine, P1).length, 0, "a face-down card has no rules text (CR 411.1)");
});

clause(MSC, "0:rule", "the tokens only appear when the container is destroyed: nothing before, and a damaged-but-alive container makes none", () => {
  const b = mscBoard();
  assert.equal(micromajigs(b.engine, P1).length, 0);
  play(b.engine, P1, b.id("zap4"), { selected: { t: [b.id("msc")] } });
  assert.equal(zoneOf(b.engine, b.id("msc")), "play", "4 damage does not destroy a 5-life container");
  assert.equal(micromajigs(b.engine, P1).length, 0);
});

clause(MSC, "0:rule", "the card itself: costs 6 with [E][E], printed 4 / 5 / 3, subtype machine", () =>
  deployChecks(MSC, { cost: 6, icon: "elitism", count: 2, stats: [4, 5, 3], subtypes: ["machine"], types: ["character"] })
);

clause(MSC, "1:rule", "the tokens are character cards named Micromajig with exactly 1 strength, 1 life and 3 speed", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) {
    const def = b.engine.getDefinition(t);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character", "a character card");
    assert.deepEqual(b.engine.getCardTypes(t), ["character"]);
    assert.deepEqual(stats(b.engine, t), [1, 1, 3], "1 strength, 1 life, 3 speed");
    assert.equal(b.engine.state.cards[t].damage, 0);
  }
});

clause(MSC, "1:rule", "the tokens are GEARSMITH character cards", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) assert.equal(b.engine.getDefinition(t).trade, "gearsmith");
});

clause(MSC, "1:rule", "the tokens carry the majig subtype", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  assert.equal(tokens.length, 5);
  for (const t of tokens) assert.deepEqual(b.engine.getSubtypes(t), ["majig"]);
});

clause(MSC, "1:rule", "a token leaving play any way (destroyed, returned to hand, put into the deck, put into the void, removed) disappears: never in a hand, deck or discard pile", () => {
  const b = mscBoard();
  const tokens = mscTokens(b);
  const handBefore = [...handOf(b.engine)];
  const deckBefore = [...deckOf(b.engine)];
  const discardBefore = [...discardOf(b.engine)];
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  sends.forEach(([key, label], i) => {
    play(b.engine, P1, b.id(key), { selected: { t: [tokens[i]] } });
    drain(b.engine, declineAll);
    assertTokenGone(b.engine, tokens[i], label);
  });
  assert.equal(micromajigs(b.engine, P1).length, 0, "all five tokens are gone");
  assert.deepEqual(handOf(b.engine).filter((c) => !handBefore.includes(c)), [], "no token card entered the hand");
  assert.deepEqual(deckOf(b.engine).filter((c) => !deckBefore.includes(c)), [], "no token card entered the deck");
  const sendKeys = new Set(sends.map(([k]) => b.id(k)));
  assert.deepEqual(discardOf(b.engine).filter((c) => !discardBefore.includes(c) && !sendKeys.has(c)), [], "no token card entered the discard pile");
});

clause(MSC, "1:rule", "a token dies to 1 damage (it has 1 life) and disappears, not put into the discard pile", () => {
  const b = mscBoard();
  const [token, second] = mscTokens(b);
  const discardBefore = [...discardOf(b.engine)];
  play(b.engine, P1, b.id("zap1"), { selected: { t: [token] } });
  assertTokenGone(b.engine, token, "killed by 1 damage");
  assert.equal(zoneOf(b.engine, second), "play", "the other tokens are untouched");
  assert.deepEqual(discardOf(b.engine).filter((c) => !discardBefore.includes(c)), [b.id("zap1")], "only the tactic itself went to the discard pile");
});

clause(MSC, "1:rule", "a token that blocks and is killed in battle disappears", () => {
  const b = mscBoard();
  killMsc(b);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  const tokens = micromajigs(b.engine, P1);
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  declareBlock(b.engine, P1, [tokens[0]]);
  finishBattle(b.engine);
  assertTokenGone(b.engine, tokens[0], "killed in battle");
});

clause(MSC, "1:rule", "a token is a character: it can block", () => {
  const b = mscBoard();
  killMsc(b);
  endTurn(b.engine, P1);
  const token = micromajigs(b.engine, P1)[0];
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  declareBlock(b.engine, P1, [token]);
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [token]);
});

clause(MSC, "1:rule", "a token put into play this turn cannot attack yet (it was not in play since the start of the turn)", () => {
  const b = mscBoard();
  const [token] = mscTokens(b);
  refused(() => attackRaw(b.engine, P1, [token]), "a token made this turn cannot attack");
  assert.equal(battleOf(b.engine), undefined);
});

// =============================================================================
// Luteoderm Prototype
// ATTACH TO CHARACTER. The attached character gains 1 strength and 1 life. If
// the attached character leaves play, you may search your deck for a card. If
// you do, put it into your hand.
// Item (gear), gearsmith, cost 2, threshold [E].
// =============================================================================

const LUTEODERM = "21a5e1c0-b910-4f53-8ddf-b2fa2c883ff2";

function luteodermBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; hostOwner?: Pid; protoOwner?: Pid; protoDeck?: number; extraCards?: CardPlacement[]; random?: () => number } = {}) {
  const zone = opts.zone ?? "hand";
  const protoOwner = opts.protoOwner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: opts.random ?? seeded(),
    cards: [
      { key: "lp", def: printing(LUTEODERM), owner: protoOwner, zone, attachedToKey: zone === "play" ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 2, life: 2, speed: 2 }), owner: opts.hostOwner ?? P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "faceDown", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
      // The prototype controller's deck: a mix of types, so "a card" really means any card.
      { key: "dChar", def: character({ name: "DChar" }), owner: protoOwner, zone: "deck" },
      { key: "dItem", def: item({ name: "DItem" }), owner: protoOwner, zone: "deck" },
      { key: "dTac", def: tactic({ name: "DTac" }), owner: protoOwner, zone: "deck" },
      { key: "dLoc", def: location({ name: "DLoc" }), owner: protoOwner, zone: "deck" },
      { key: "dRes", def: resourceCard({ name: "DRes" }), owner: protoOwner, zone: "deck" },
      ...Array.from({ length: opts.protoDeck ?? 4 }, (_, i) => ({ key: `d${i}`, def: character({ name: `D${i}` }), owner: protoOwner, zone: "deck" as const })),
      // The other player's deck, hand and discard pile must never be searched.
      ...["oChar", "oItem"].map((key) => ({ key, def: (key === "oItem" ? item : character)({ name: key }), owner: protoOwner === P1 ? P2 : P1, zone: "deck" as const })),
      { key: "inHand", def: character({ name: "InHand" }), owner: protoOwner, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: protoOwner, zone: "discard" },
      { key: "sendDiscard", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
      { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
      { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
      { key: "smashItem", def: smashItemTactic(), owner: P1, zone: "hand" },
      ...(opts.extraCards ?? []),
      ...bank("elitism", opts.elitism ?? 4, P1),
      ...bank("greed", opts.greed ?? 0, P1)
    ]
  });
}
type LuteBoard = ReturnType<typeof luteodermBoard>;

// --- 0:attach

clause(LUTEODERM, "0:attach", "attaches to the character it is played on (yours or the opponent's); pays its cost of 2 and stays under its player's control", () => {
  for (const hostKey of ["host", "foe"] as const) {
    const { engine, id } = luteodermBoard();
    const before = ready(engine);
    play(engine, P1, id("lp"), { selected: { attachTo: [id(hostKey)] } });
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(engine.state.cards[id("lp")].attachedTo, id(hostKey), `attached to ${hostKey}`);
    assert.equal(engine.state.cards[id("lp")].controllerId, P1, "its controller is the player who played it, whoever owns the host");
    assert.equal(before - ready(engine), 2, "the printed cost of 2 is paid");
  }
});

clause(LUTEODERM, "0:attach", "is refused for a host that is not a character (item, location, faction, face-down card) or for no host at all", () => {
  const { engine, id } = luteodermBoard();
  const attempt = (hostId: CardInstanceId) => () => playRaw(engine, P1, id("lp"), { selected: { attachTo: [hostId] } });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(id("faceDown")), "a face-down card is only a resource");
  refused(attempt(factionOf(engine, P2)), "a faction");
  refused(attempt(id("dChar")), "a character in the deck is not in play");
  refused(attempt(id("inHand")), "a character in hand is not in play");
  refused(() => playRaw(engine, P1, id("lp"), { selected: {} }), "no host chosen");
  assert.equal(zoneOf(engine, id("lp")), "hand");
  assert.equal(ready(engine), 4, "nothing was spent by the refused attempts");
  attempt(id("mate"))();
  assert.ok(engine.state.responseWindow, "control: a character host is accepted");
});

clause(LUTEODERM, "0:attach", "is refused one resource short of 2, and without [E] even with plenty of other resources", () => {
  const short = luteodermBoard({ elitism: 1 });
  refused(() => playRaw(short.engine, P1, short.id("lp"), { selected: { attachTo: [short.id("host")] } }), "one resource");
  assert.equal(zoneOf(short.engine, short.id("lp")), "hand");
  const noThreshold = luteodermBoard({ elitism: 0, greed: 6 });
  refused(() => playRaw(noThreshold.engine, P1, noThreshold.id("lp"), { selected: { attachTo: [noThreshold.id("host")] } }), "no [E]");
  const exact = luteodermBoard({ elitism: 2 });
  play(exact.engine, P1, exact.id("lp"), { selected: { attachTo: [exact.id("host")] } });
  assert.equal(zoneOf(exact.engine, exact.id("lp")), "play", "[E] and exactly 2 resources is enough");
  const oneE = luteodermBoard({ elitism: 1, greed: 1 });
  play(oneE.engine, P1, oneE.id("lp"), { selected: { attachTo: [oneE.id("host")] } });
  assert.equal(zoneOf(oneE.engine, oneE.id("lp")), "play", "one [E] plus one other resource is enough");
});

clause(LUTEODERM, "0:attach", "when its host is destroyed the Prototype is destroyed with it, into its owner's discard pile (CR 301.4)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the attached card went with it");
  assert.ok(discardOf(engine, P1).includes(id("lp")), "discardOf(engine, P1).includes(id(\"lp\"))");
  assert.equal(engine.state.cards[id("lp")].attachedTo, undefined);
});

clause(LUTEODERM, "0:attach", "when the host leaves play by other means than destruction, the Prototype leaves play the same way (CR 301.4a): a host returned to hand takes it to its owner's hand", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendHand"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "hand");
  assert.equal(zoneOf(engine, id("lp")), "hand", "leaves play the same way (CR 301.4a)");
});

clause(LUTEODERM, "0:attach", "...and a host removed from the game takes the Prototype out of the game with it", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("sendRemove"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "removed");
  assert.equal(zoneOf(engine, id("lp")), "removed", "leaves play the same way (CR 301.4a)");
});

clause(LUTEODERM, "0:attach", "if the host is gone before the Prototype resolves it goes to its owner's discard pile instead of entering play", () => {
  const opKill = tactic({ name: "OpKill", cost: 0, behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } });
  const { engine, id } = luteodermBoard({ extraCards: [{ key: "opKill", def: opKill, owner: P2, zone: "hand" }] });
  playRaw(engine, P1, id("lp"), { selected: { attachTo: [id("host")] } });
  assert.ok(engine.state.responseWindow, "the Prototype is being deployed; P2 may respond");
  engine.perform({ type: "playCard", playerId: P2, cardId: id("opKill"), selected: { t: [id("host")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("host")), "discard", "the host was destroyed in response");
  assert.equal(zoneOf(engine, id("lp")), "discard", "the Prototype could not attach, so it went to the discard pile");
  assert.ok(discardOf(engine, P1).includes(id("lp")), "discardOf(engine, P1).includes(id(\"lp\"))");
});

// --- 1:rule  The attached character gains 1 strength and 1 life

clause(LUTEODERM, "1:rule", "the attached character gains exactly 1 strength and 1 life (and no speed) — on your own character and on an opponent's", () => {
  for (const hostOwner of [P1, P2] as const) {
    const { engine, id } = luteodermBoard({ zone: "play", hostOwner });
    assert.deepEqual(stats(engine, id("host")), [3, 3, 2], `host owned by ${hostOwner}`);
  }
});

clause(LUTEODERM, "1:rule", "no other character is affected, and the Prototype gives its host nothing before it is attached", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stats(engine, id("mate")), [2, 2, 2], "another of my characters");
  assert.deepEqual(stats(engine, id("foe")), [2, 2, 2], "an opponent's character");
  const bare = luteodermBoard({ zone: "hand" });
  assert.deepEqual(stats(bare.engine, bare.id("host")), [2, 2, 2], "control: unattached host has its printed stats");
  play(bare.engine, P1, bare.id("lp"), { selected: { attachTo: [bare.id("host")] } });
  assert.deepEqual(stats(bare.engine, bare.id("host")), [3, 3, 2], "attaching it gives +1/+1");
  assert.deepEqual(stats(bare.engine, bare.id("mate")), [2, 2, 2]);
});

clause(LUTEODERM, "1:rule", "the extra life is real: a 2-life host survives 2 damage with the Prototype and dies on the 3rd, and dies on the 2nd without it", () => {
  const withProto = luteodermBoard({ zone: "play", extraCards: [{ key: "z2", def: damageTactic(2), owner: P1, zone: "hand" }, { key: "z1", def: damageTactic(1), owner: P1, zone: "hand" }] });
  play(withProto.engine, P1, withProto.id("z2"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "play", "2 damage < 3 life");
  play(withProto.engine, P1, withProto.id("z1"), { selected: { t: [withProto.id("host")] } });
  assert.equal(zoneOf(withProto.engine, withProto.id("host")), "discard", "3 damage >= 3 life");
  const without = luteodermBoard({ zone: "hand", extraCards: [{ key: "z2", def: damageTactic(2), owner: P1, zone: "hand" }] });
  play(without.engine, P1, without.id("z2"), { selected: { t: [without.id("host")] } });
  assert.equal(zoneOf(without.engine, without.id("host")), "discard", "control: 2 damage kills the bare 2-life host");
});

clause(LUTEODERM, "1:rule", "the extra strength is real in battle: the host deals 3 battle damage to the faction", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  engine.state.turn = 2;
  engine.state.cards[id("host")].attackEligibleTurn = 2;
  const before = engine.state.players[P2].influence;
  declareAttackBy(engine, P1, [id("host")]);
  declareBlock(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(engine.state.players[P2].influence, before - 3, "2 printed + 1 = 3 strength");
});

clause(LUTEODERM, "1:rule", "two Prototypes on one host stack (+2 strength, +2 life)", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [4, 4, 2]);
});

clause(LUTEODERM, "1:rule", "the bonus ends when the Prototype leaves play", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  assert.deepEqual(stats(engine, id("host")), [3, 3, 2]);
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play", "the host itself is not harmed");
  assert.deepEqual(stats(engine, id("host")), [2, 2, 2]);
});

// --- 2:rule  If the attached character leaves play, you may search your deck for a card. If you do, put it into your hand.

/** Opens the search by sending the host away, then returns the pending choice. */
function leaveAndSearch(board: LuteBoard, how: "sendDiscard" | "sendHand" | "sendDeck" | "sendVoid" | "sendRemove" = "sendDiscard") {
  play(board.engine, P1, board.id(how), { selected: { t: [board.id("host")] } });
  return pending(board.engine);
}

clause(LUTEODERM, "2:rule", "when the host is destroyed its controller is offered a deck search; the chosen card goes to hand and nothing else moves", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  const oppDeck = [...deckOf(engine, P2)];
  const pc = leaveAndSearch(board)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Prototype's controller searches");
  pickCards(engine, [id("dItem")]);
  assert.equal(zoneOf(engine, id("dItem")), "hand");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c) && c !== id("dItem")), [], "exactly one card was added to the hand");
  assert.equal(handOf(engine).length, handBefore.length - 1 + 1, "(the Send tactic left the hand, the found card joined it)");
  sameCards(deckOf(engine), deckBefore.filter((c) => c !== id("dItem")));
  assert.deepEqual(deckOf(engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(pending(engine), undefined);
});

clause(LUTEODERM, "2:rule", "any card can be found: character, item, tactic, location or resource", () => {
  for (const key of ["dChar", "dItem", "dTac", "dLoc", "dRes"]) {
    const board = luteodermBoard({ zone: "play" });
    leaveAndSearch(board);
    pickCards(board.engine, [board.id(key)]);
    assert.equal(zoneOf(board.engine, board.id(key)), "hand", key);
  }
});

clause(LUTEODERM, "2:rule", "only a card from YOUR deck can be found: the opponent's deck, your hand and your discard pile are refused, and only one card", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine, id } = board;
  leaveAndSearch(board);
  for (const key of ["oChar", "oItem", "inHand", "inDiscard", "mate", "foe", "thing"]) refused(tryPick(engine, P1, [id(key)]), key);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(engine, id("oChar")), "deck");
  assert.equal(zoneOf(engine, id("inDiscard")), "discard");
  refused(tryPick(engine, P1, [id("dChar"), id("dItem")]), "it finds ONE card");
  pickCards(engine, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
});

clause(LUTEODERM, "2:rule", "it is a 'may': I can decline to search — then my hand is unchanged and the deck keeps all its cards", () => {
  const board = luteodermBoard({ zone: "play" });
  const { engine } = board;
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  leaveAndSearch(board);
  pickCards(engine, []);
  assert.deepEqual(handOf(engine), handBefore.filter((c) => c !== board.id("sendDiscard")), "no card was added");
  sameCards(deckOf(engine), deckBefore);
  assert.equal(pending(engine), undefined);
});

clause(LUTEODERM, "2:rule", "if I do search, the searched deck is shuffled afterwards (CR 312.1)", () => {
  assert.equal(
    deckWasShuffled(
      (random) => luteodermBoard({ zone: "play", protoDeck: 8, random }),
      (g) => {
        play(g.engine, P1, g.id("sendDiscard"), { selected: { t: [g.id("host")] } });
        pickCards(g.engine, [g.id("dChar")]);
      }
    ),
    true
  );
});

clause(LUTEODERM, "2:rule", "declining the 'may' means the deck is not searched, so it is not shuffled (CR 312.1 shuffles a deck that is searched)", () => {
  assert.equal(
    deckWasShuffled(
      (random) => luteodermBoard({ zone: "play", protoDeck: 8, random }),
      (g) => {
        play(g.engine, P1, g.id("sendDiscard"), { selected: { t: [g.id("host")] } });
        pickCards(g.engine, []);
      }
    ),
    false,
    "declined: the deck keeps its order"
  );
});

clause(LUTEODERM, "2:rule", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const board = luteodermBoard({ zone: "play" });
  leaveAndSearch(board);
  pickCards(board.engine, [board.id("dTac")]);
  assert.equal(revealEvents(board.engine).length, 0);
});

for (const [how, label] of [
  ["sendDiscard", "destroyed"],
  ["sendHand", "returned to its owner's hand"],
  ["sendDeck", "put into its owner's deck"],
  ["sendVoid", "put into the void"],
  ["sendRemove", "removed from the game"]
] as const) {
  clause(LUTEODERM, "2:rule", `fires however the host leaves play: ${label}`, () => {
    const board = luteodermBoard({ zone: "play" });
    const pc = leaveAndSearch(board, how);
    assert.ok(pc, `a search is offered when the host is ${label}`);
    assert.equal(pc.kind, "chooserSelectsTarget");
    assert.equal(pc.playerId, P1);
    pickCards(board.engine, [board.id("dItem")]);
    assert.equal(zoneOf(board.engine, board.id("dItem")), "hand");
    assert.notEqual(zoneOf(board.engine, board.id("host")), "play");
  });
}

clause(LUTEODERM, "2:rule", "fires when the host dies of damage", () => {
  const board = luteodermBoard({ zone: "play", extraCards: [{ key: "z3", def: damageTactic(3), owner: P1, zone: "hand" }] });
  play(board.engine, P1, board.id("z3"), { selected: { t: [board.id("host")] } });
  assert.equal(zoneOf(board.engine, board.id("host")), "discard");
  assert.equal(pending(board.engine)?.kind, "chooserSelectsTarget");
  assert.equal(pending(board.engine)?.playerId, P1);
});

clause(LUTEODERM, "2:rule", "does not fire when some other character leaves play", () => {
  for (const victim of ["mate", "foe"]) {
    const { engine, id } = luteodermBoard({ zone: "play" });
    play(engine, P1, id("sendDiscard"), { selected: { t: [id(victim)] } });
    assert.equal(zoneOf(engine, id(victim)), "discard");
    assert.equal(pending(engine), undefined, `no search when ${victim} leaves`);
    assert.equal(zoneOf(engine, id("lp")), "play");
    assert.equal(zoneOf(engine, id("dItem")), "deck");
  }
});

clause(LUTEODERM, "2:rule", "does not fire when only the Prototype itself leaves play (the host stays)", () => {
  const { engine, id } = luteodermBoard({ zone: "play" });
  play(engine, P1, id("smashItem"), { selected: { t: [id("lp")] } });
  assert.equal(zoneOf(engine, id("lp")), "discard");
  assert.equal(zoneOf(engine, id("host")), "play");
  assert.equal(pending(engine), undefined, "the attached character did not leave play");
});

clause(LUTEODERM, "2:rule", "'you' is the Prototype's controller: one I attached to an opponent's character searches MY deck when that character leaves", () => {
  const board = luteodermBoard({ zone: "play", hostOwner: P2 });
  const { engine, id } = board;
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P1, "the controller of the Prototype, not the host's owner");
  refused(tryPick(engine, P1, [id("oChar")]), "the host's owner's deck is not searched");
  pickCards(engine, [id("dChar")]);
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.ok(handOf(engine, P1).includes(id("dChar")), "handOf(engine, P1).includes(id(\"dChar\"))");
});

clause(LUTEODERM, "2:rule", "an opponent's Prototype on my character searches THEIR deck, not mine", () => {
  const board = luteodermBoard({ zone: "play", protoOwner: P2, hostOwner: P1 });
  const { engine, id } = board;
  const myDeck = [...deckOf(engine, P1)];
  const pc = leaveAndSearch(board);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Prototype's controller searches");
  refused(tryPick(engine, P2, [id("oChar")]), "my deck (the host owner's) is not theirs to search");
  pickCards(engine, [id("dChar")]);
  assert.ok(handOf(engine, P2).includes(id("dChar")), "handOf(engine, P2).includes(id(\"dChar\"))");
  sameCards(deckOf(engine, P1), myDeck);
});

clause(LUTEODERM, "2:rule", "a Prototype that is not attached to the leaving character stays quiet: another host's Prototype does not search", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "mate" }] });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  assert.ok(pending(engine), "the host's own Prototype fires");
  pickCards(engine, [id("dChar")]);
  assert.equal(pending(engine), undefined, "the other Prototype (on Mate) did not fire");
  assert.equal(zoneOf(engine, id("lp2")), "play");
});

clause(LUTEODERM, "2:rule", "two Prototypes on the same host each search when it leaves play", () => {
  const { engine, id } = luteodermBoard({ zone: "play", extraCards: [{ key: "lp2", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" }] });
  play(engine, P1, id("sendDiscard"), { selected: { t: [id("host")] } });
  let searches = 0;
  drain(engine, (pc) => {
    if (pc.kind === "chooserSelectsTarget") {
      searches++;
      return { kind: "chooserSelectsTarget", selected: [id(searches === 1 ? "dChar" : "dItem")] };
    }
    return declineAll(pc);
  });
  assert.equal(searches, 2, "one search per Prototype");
  assert.equal(zoneOf(engine, id("dChar")), "hand");
  assert.equal(zoneOf(engine, id("dItem")), "hand");
});

clause(LUTEODERM, "2:rule", "with an empty deck nothing is found and nothing breaks", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
      { key: "lp", def: printing(LUTEODERM), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("kill"), { selected: { t: [id("host")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("host")), "discard");
  assert.equal(pending(engine), undefined);
  assert.equal(handOf(engine).length, 0);
});

// =============================================================================
// Micromajig tokens (shared by Avalanche, Maker, Master)
// "(Treat Micromajig tokens as Gearsmith character cards with 1 strength, 1 life,
// 3 speed, and the "majig" subtype. If a Micromajig token leaves play, it
// disappears.)"
// =============================================================================

const allMicromajigs = (engine: SpoilsEngine): CardInstanceId[] => [...micromajigs(engine, P1), ...micromajigs(engine, P2)];

/** Free tactics (and a damage dealer) the Micromajig boards use to make tokens leave play, plus some deck cards for searches. */
function microExtras(): CardPlacement[] {
  return [
    { key: "sendDestroy", def: sendTactic("destroy"), owner: P1, zone: "hand" },
    { key: "sendHand", def: sendTactic("hand"), owner: P1, zone: "hand" },
    { key: "sendDeck", def: sendTactic("deck"), owner: P1, zone: "hand" },
    { key: "sendVoid", def: sendTactic("void"), owner: P1, zone: "hand" },
    { key: "sendRemove", def: sendTactic("remove"), owner: P1, zone: "hand" },
    { key: "zap1", def: damageTactic(1, "Zap1"), owner: P1, zone: "hand" },
    { key: "zap2", def: damageTactic(2, "Zap2"), owner: P1, zone: "hand" },
    { key: "fillA", def: character({ name: "FillA" }), owner: P1, zone: "deck" },
    { key: "fillB", def: character({ name: "FillB" }), owner: P1, zone: "deck" },
    { key: "fillC", def: character({ name: "FillC" }), owner: P1, zone: "deck" },
    { key: "fillD", def: item({ name: "FillD" }), owner: P1, zone: "deck" },
    { key: "fillE", def: tactic({ name: "FillE" }), owner: P1, zone: "deck" },
    { key: "fillF", def: character({ name: "FillF" }), owner: P1, zone: "deck" },
    { key: "oppFill", def: character({ name: "OppFill" }), owner: P2, zone: "deck" }
  ];
}

/** Every token is a character card named Micromajig with exactly 1 strength, 1 life and 3 speed. */
function assertMicromajigBody(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "there is at least one token to look at");
  for (const token of tokens) {
    const def = engine.getDefinition(token);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character", "a character card");
    assert.deepEqual(engine.getCardTypes(token), ["character"]);
    assert.deepEqual(stats(engine, token), [1, 1, 3], "1 strength, 1 life, 3 speed");
    assert.equal(engine.state.cards[token].damage, 0);
    assert.equal(engine.state.cards[token].depleted, false);
    assert.equal(engine.state.cards[token].faceDown, false);
  }
}

/** "Gearsmith character cards": the tokens' trade is Gearsmith. */
function assertTokensAreGearsmith(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.equal(engine.getDefinition(token).trade, "gearsmith");
}

/** The tokens carry the "majig" subtype. */
function assertTokensAreMajigs(engine: SpoilsEngine, tokens: CardInstanceId[]): void {
  assert.ok(tokens.length > 0, "tokens.length > 0");
  for (const token of tokens) assert.deepEqual(engine.getSubtypes(token), ["majig"]);
}

type MicroBoard = { engine: SpoilsEngine; id: IdOf };

/** "If a Micromajig token leaves play, it disappears": however a token leaves play, it never reaches a hand, deck or discard pile. */
function assertTokenLeavesTheGame(board: MicroBoard, tokens: CardInstanceId[]): void {
  const { engine, id } = board;
  const sends: Array<[string, string]> = [
    ["sendDestroy", "destroyed"],
    ["sendHand", "returned to hand"],
    ["sendDeck", "put into the deck"],
    ["sendVoid", "put into the void"],
    ["sendRemove", "removed from the game"]
  ];
  const handBefore = [...handOf(engine)];
  const deckBefore = [...deckOf(engine)];
  const discardBefore = [...discardOf(engine)];
  assert.ok(tokens.length >= sends.length, "one token for each way of leaving play");
  for (const [i, [key, label]] of sends.entries()) {
    const victim = tokens[i];
    play(engine, P1, id(key), { selected: { t: [victim] } });
    drain(engine, declineAll);
    assertTokenGone(engine, victim, label);
  }
  assert.deepEqual(discardOf(engine).filter((c) => !discardBefore.includes(c) && !sends.some(([k]) => id(k) === c)), [], "no token card entered a discard pile");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c)), [], "no token card entered the hand");
  assert.deepEqual(deckOf(engine).filter((c) => !deckBefore.includes(c)), [], "no token card entered the deck");
}

/** A token destroyed by damage: 1 life, so 1 damage kills it, and it disappears (not in the discard pile). */
function assertTokenDiesOfDamage(board: MicroBoard, token: CardInstanceId): void {
  const { engine, id } = board;
  const discardBefore = [...discardOf(engine)];
  play(engine, P1, id("zap1"), { selected: { t: [token] } });
  assertTokenGone(engine, token, "killed by 1 damage");
  assert.deepEqual(discardOf(engine).filter((c) => !discardBefore.includes(c)), [id("zap1")], "only the tactic itself went to the discard pile");
}

/** A freshly made token can block but cannot attack on the turn it entered play (it is a character). */
function assertTokenCanBlockButNotAttack(board: MicroBoard, token: CardInstanceId): void {
  const { engine, id } = board;
  refused(() => attackRaw(engine, P1, [token]), "a token put into play this turn cannot attack");
  assert.equal(battleOf(engine), undefined);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  declareAttackBy(engine, P2, [id("foe")]);
  declareBlock(engine, P1, [token]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [token], "the token blocks");
}

// =============================================================================
// Micromajig Avalanche
// COST: Choose a number for X. Pay X+X. EFFECT: Put X Micromajig tokens into play.
// Tactic, gearsmith, cost 0, threshold [E][E][E][E].
// =============================================================================

const AVALANCHE = "650c9fb9-8190-466f-b142-5d010659eed3";

function avalancheBoard(opts: { elitism?: number; greed?: number; active?: Pid; extra?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "av", def: printing(AVALANCHE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 12, P1),
      ...bank("greed", opts.greed ?? 0, P1),
      ...(opts.extra ?? [])
    ]
  });
}

for (const x of [0, 1, 2, 3, 5]) {
  clause(AVALANCHE, "0:ability", `X=${x}: pays X+X (${2 * x} resources) and puts exactly ${x} Micromajig token(s) into play under my control`, () => {
    const { engine, id } = avalancheBoard();
    const before = ready(engine);
    play(engine, P1, id("av"), { variables: { x } });
    assert.equal(before - ready(engine), 2 * x, `the cost is X+X = ${2 * x}`);
    const tokens = micromajigs(engine, P1);
    assert.equal(tokens.length, x, `${x} token(s) are mine`);
    assert.equal(micromajigs(engine, P2).length, 0, "none for the opponent");
    for (const t of tokens) {
      assert.equal(engine.state.cards[t].ownerId, P1);
      assert.equal(engine.state.cards[t].controllerId, P1);
      assert.equal(zoneOf(engine, t), "play");
    }
    assert.equal(zoneOf(engine, id("av")), "discard", "the tactic ends in my discard pile");
    assert.equal(zoneOf(engine, id("mine")), "play", "my other character is untouched");
  });
}

clause(AVALANCHE, "0:ability", "the cost is paid when the tactic is played, before the opponent can respond; the tokens only appear when it resolves", () => {
  const { engine, id } = avalancheBoard();
  const before = ready(engine);
  playRaw(engine, P1, id("av"), { variables: { x: 3 } });
  assert.equal(before - ready(engine), 6);
  assert.equal(allMicromajigs(engine).length, 0, "no tokens while the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(AVALANCHE, "0:ability", "X is my choice and may be 0: it is playable for no resources at all (but still needs [E][E][E][E])", () => {
  const free = avalancheBoard({ elitism: 4 });
  const before = ready(free.engine);
  play(free.engine, P1, free.id("av"), { variables: { x: 0 } });
  assert.equal(before - ready(free.engine), 0, "X=0 costs nothing");
  assert.equal(zoneOf(free.engine, free.id("av")), "discard", "X=0 is a legal value: the tactic resolves");
  assert.equal(allMicromajigs(free.engine).length, 0);
});

clause(AVALANCHE, "0:ability", "the cost is X+X, not X: 4 resources buy X=2 but not X=3, and an odd count never buys the extra token", () => {
  const four = avalancheBoard({ elitism: 4 });
  refused(() => playRaw(four.engine, P1, four.id("av"), { variables: { x: 3 } }), "X=3 needs 6");
  assert.equal(zoneOf(four.engine, four.id("av")), "hand");
  assert.equal(ready(four.engine), 4, "nothing was spent");
  play(four.engine, P1, four.id("av"), { variables: { x: 2 } });
  assert.equal(micromajigs(four.engine, P1).length, 2, "exactly 4 resources is enough for X=2");
  assert.equal(ready(four.engine), 0);
  const five = avalancheBoard({ elitism: 5 });
  refused(() => playRaw(five.engine, P1, five.id("av"), { variables: { x: 3 } }), "5 resources are one short of the 6 that X=3 costs");
  play(five.engine, P1, five.id("av"), { variables: { x: 2 } });
  assert.equal(ready(five.engine), 1, "X=2 with 5 resources leaves 1");
});

clause(AVALANCHE, "0:ability", "X is a number of at least 0: a negative X is refused", () => {
  const { engine, id } = avalancheBoard();
  refused(() => playRaw(engine, P1, id("av"), { variables: { x: -1 } }), "X = -1");
  assert.equal(zoneOf(engine, id("av")), "hand");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(ready(engine), 12, "nothing was spent");
});

clause(AVALANCHE, "0:ability", "X must be a whole number (CR 410.2): a fractional X such as 1.5 is refused", () => {
  const { engine, id } = avalancheBoard();
  refused(() => playRaw(engine, P1, id("av"), { variables: { x: 1.5 } }), "a fractional X");
  assert.equal(zoneOf(engine, id("av")), "hand");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(ready(engine), 12, "nothing was spent");
});

clause(AVALANCHE, "0:ability", "needs [E][E][E][E]: three [E] with plenty of other resources is refused, four [E] and six others buys X=5", () => {
  const three = avalancheBoard({ elitism: 3, greed: 9 });
  refused(() => playRaw(three.engine, P1, three.id("av"), { variables: { x: 1 } }), "three [E], X=1");
  refused(() => playRaw(three.engine, P1, three.id("av"), { variables: { x: 0 } }), "even X=0 needs the threshold");
  assert.equal(zoneOf(three.engine, three.id("av")), "hand");
  const noE = avalancheBoard({ elitism: 0, greed: 12 });
  refused(() => playRaw(noE.engine, P1, noE.id("av"), { variables: { x: 1 } }), "no [E]");
  const four = avalancheBoard({ elitism: 4, greed: 6 });
  play(four.engine, P1, four.id("av"), { variables: { x: 5 } });
  assert.equal(micromajigs(four.engine, P1).length, 5, "the icons are a gate, not spent: 10 resources pay for X=5");
  assert.equal(ready(four.engine), 0);
});

clause(AVALANCHE, "0:ability", "the 'pay X+X' is a numeric cost that reductions apply to (CR 406.3 / 406.5): after Jo's RESEARCH (reduce the next numeric cost by 3), X=3 costs 3", () => {
  const { engine, id } = avalancheBoard({ extra: [{ key: "jo", def: printing(JO), owner: P1, zone: "play" }] });
  activate(engine, P1, id("jo"), "research");
  assert.equal(spentBy(engine, P1, () => play(engine, P1, id("av"), { variables: { x: 3 } })), 3);
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(AVALANCHE, "0:ability", "tokens are put into play, not deployed: the tactic resolves with no further choice and no card is drawn or discarded", () => {
  const { engine, id } = avalancheBoard();
  const handBefore = handOf(engine).filter((c) => c !== id("av"));
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assert.equal(pending(engine), undefined);
  assert.deepEqual(handOf(engine), handBefore, "my hand lost only the tactic");
});

clause(AVALANCHE, "0:ability", "it can be played on the opponent's turn in response (tactic timing): the tokens are mine", () => {
  const { engine, id } = avalancheBoard({ active: P2, extra: [{ key: "p2noop", def: noopTactic("Their Noop"), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("p2noop"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("av"), { variables: { x: 2 } });
  resolvePendingResponses(engine);
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 0);
});

clause(AVALANCHE, "1:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 3 } });
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "the tokens carry the majig subtype", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 2 } });
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(AVALANCHE, "1:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they disappear: never in a hand, deck or discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 5 } });
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(AVALANCHE, "1:rule", "a token dies to 1 damage and disappears, not put into the discard pile", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 2 } });
  const [token, second] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, second), "play", "the other token is untouched");
});

clause(AVALANCHE, "1:rule", "a token has exactly 1 life: 1 damage kills it; no more and no less is needed (the 4-life Foe survives 1)", () => {
  const { engine, id } = avalancheBoard();
  play(engine, P1, id("av"), { variables: { x: 1 } });
  const [token] = micromajigs(engine, P1);
  play(engine, P1, id("zap1"), { selected: { t: [id("foe")] } });
  assert.equal(zoneOf(engine, id("foe")), "play");
  play(engine, P1, id("zap2"), { selected: { t: [token] } });
  assertTokenGone(engine, token, "2 damage on a 1-life token");
});

clause(AVALANCHE, "1:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = avalancheBoard();
  play(board.engine, P1, board.id("av"), { variables: { x: 1 } });
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// =============================================================================
// Micromajig Maker
// When this card enters play, you may put a Micromajig token into play.
// Character (inventor), gearsmith, cost 2, threshold [E][E], 1 / 3 / 1.
// =============================================================================

const MAKER = "87141428-bb2b-44f8-904f-ae6cf1a2e162";

/** Answers a "you may ..." prompt: accept or decline, whatever shape the engine gives it. */
function answerMay(engine: SpoilsEngine, player: Pid, accept: boolean): void {
  const pc = pending(engine);
  assert.ok(pc, "a 'you may' prompt is open");
  assert.equal(pc.playerId, player, "the prompt goes to the right player");
  if (pc.kind === "mayPay") {
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "mayPay", pay: accept } } as never);
  } else if (pc.kind === "chooserSelectsOption") {
    const options = pc.options as Array<{ label?: string }>;
    const isDecline = (o: { label?: string }) => /decline|no\b|nothing/i.test(o.label ?? "");
    const index = options.findIndex((o) => (accept ? !isDecline(o) : isDecline(o)));
    assert.ok(index >= 0, "the prompt has an accept and a decline option");
    engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "chooserSelectsOption", index } } as never);
  } else {
    assert.fail(`unexpected prompt kind ${pc.kind}`);
  }
  resolvePendingResponses(engine);
}

function makerBoard(opts: { zone?: "hand" | "play" | "discard"; elitism?: number; greed?: number; owner?: Pid; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const revive = tactic({
    name: "Revive",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MAKER), owner, zone: opts.zone ?? "hand" },
      { key: "mm2", def: printing(MAKER), owner, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner, zone: "hand" },
      { key: "revive", def: revive, owner, zone: "hand" },
      ...microExtras(),
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner),
      ...(opts.extra ?? [])
    ]
  });
}

clause(MAKER, "0:rule", "when it enters play I am offered a token: accepting puts exactly one Micromajig token into play under my control", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "a prompt is offered");
  assert.equal(pc.playerId, P1, "to the Maker's controller");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1, "exactly one token");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play", "the Maker itself stays in play");
  assert.equal(pending(engine), undefined);
});

clause(MAKER, "0:rule", "it is a 'may': declining puts no token into play and the Maker still enters play", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(pending(engine), undefined);
});

clause(MAKER, "0:rule", "nothing is offered until the Maker has entered play", () => {
  const { engine, id } = makerBoard();
  playRaw(engine, P1, id("mm"));
  assert.equal(pending(engine), undefined, "still being deployed");
  assert.equal(allMicromajigs(engine).length, 0);
  resolvePendingResponses(engine);
  assert.ok(pending(engine), "now it is in play: the offer appears");
});

clause(MAKER, "0:rule", "the choice is the Maker's controller's: the opponent cannot answer it", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never), "the opponent answering", /choice|player|your|turn|pending/i);
  assert.equal(allMicromajigs(engine).length, 0);
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MAKER, "0:rule", "a Maker controlled by the opponent offers THEM the token, and it enters under their control", () => {
  const { engine, id } = makerBoard({ owner: P2 });
  play(engine, P2, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(micromajigs(engine, P2).length, 1);
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(MAKER, "0:rule", "it triggers off the Maker entering play, not off another card entering play afterwards", () => {
  const { engine, id } = makerBoard({ zone: "play" });
  play(engine, P1, id("plain"));
  assert.equal(pending(engine), undefined, "no prompt when another character enters");
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("plain")), "play");
});

clause(MAKER, "0:rule", "it also triggers when the Maker is put into play by an effect rather than deployed", () => {
  const { engine, id } = makerBoard({ zone: "discard" });
  play(engine, P1, id("revive"), { selected: { t: [id("mm")] } });
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.ok(pending(engine), "'enters play' includes being put into play");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 1);
});

clause(MAKER, "0:rule", "each Maker triggers separately: two Makers make two tokens (one each)", () => {
  const { engine, id } = makerBoard({ elitism: 8 });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  play(engine, P1, id("mm2"));
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(pending(engine), undefined);
});

clause(MAKER, "0:rule", "leaving play does not trigger it", () => {
  const { engine, id } = makerBoard({ zone: "play" });
  play(engine, P1, id("sendDestroy"), { selected: { t: [id("mm")] } });
  assert.equal(zoneOf(engine, id("mm")), "discard");
  assert.equal(pending(engine), undefined);
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(MAKER, "0:rule", "a Maker already on the board does not make tokens at the start of later turns", () => {
  const { engine } = makerBoard({ zone: "play" });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(allMicromajigs(engine).length, 0);
});

clause(MAKER, "0:rule", "deploys for its printed cost of 2 with [E][E] (one resource short or one [E] short is refused) and has its printed 1 / 3 / 1 stats", () => {
  const { engine, id } = makerBoard({ elitism: 2 });
  const before = ready(engine);
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 2, "cost 2");
  assert.deepEqual(stats(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["inventor"]);
  const short = makerBoard({ elitism: 0, extra: [...bank("elitism", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })), ...bank("rage", 1, P1)] });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const oneE = makerBoard({ elitism: 1, greed: 5 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]", /Threshold requirements are not met/);
  const twoE = makerBoard({ elitism: 2, greed: 0 });
  play(twoE.engine, P1, twoE.id("mm"));
  assert.equal(zoneOf(twoE.engine, twoE.id("mm")), "play");
});

clause(MAKER, "1:rule", "the token is a character card named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "the token is a GEARSMITH character card", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "the token carries the majig subtype", () => {
  const { engine, id } = makerBoard();
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(MAKER, "1:rule", "when the token leaves play (destroyed, bounced, decked, voided, removed) it disappears: never in a hand, deck or discard pile", () => {
  for (const key of ["sendDestroy", "sendHand", "sendDeck", "sendVoid", "sendRemove"]) {
    const board = makerBoard();
    play(board.engine, P1, board.id("mm"));
    answerMay(board.engine, P1, true);
    const [token] = micromajigs(board.engine, P1);
    play(board.engine, P1, board.id(key), { selected: { t: [token] } });
    drain(board.engine, declineAll);
    assertTokenGone(board.engine, token, key);
    assert.equal(zoneOf(board.engine, board.id("mm")), "play", "the Maker is not the one that left");
  }
});

clause(MAKER, "1:rule", "the token dies to 1 damage and disappears, not put into the discard pile", () => {
  const board = makerBoard();
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenDiesOfDamage(board, micromajigs(board.engine, P1)[0]);
  assert.equal(zoneOf(board.engine, board.id("mm")), "play", "the Maker (1 life) is untouched");
});

clause(MAKER, "1:rule", "the token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = makerBoard();
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// =============================================================================
// Micromajig Master
// When this card enters play, you may put 2 Micromajig tokens into play. --
// TINY SACRIFICES -- COST: Destroy 3 Micromajig tokens you control. -- EFFECT:
// Search your deck for a card. Put it into your hand.
// Character (manager), gearsmith, cost 3, threshold [E][E], 1 / 3 / 1.
// =============================================================================

const MASTER = "70cbbd8d-52d9-47d2-a6cc-5d6b1994fb18";

/** A free tactic that puts `count` Micromajig tokens into play under `who`'s control (id `m`). */
function makeTokensTactic(count: number, who: "controller" | "opponent", name: string): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", effects: [{ type: "createTokens", controller: who, count, token: { name: "Micromajig", cardType: "character", subtype: ["majig"], strength: 1, life: 1, speed: 3 } }] }] }
  });
}

function masterBoard(opts: { zone?: "hand" | "play"; elitism?: number; greed?: number; owner?: Pid; mine?: number; theirs?: number; extra?: CardPlacement[] } = {}) {
  const owner = opts.owner ?? P1;
  const board = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: owner,
    cards: [
      { key: "mm", def: printing(MASTER), owner, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: owner === P1 ? P2 : P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally" }), owner, zone: "play" },
      { key: "mkMine", def: makeTokensTactic(1, "controller", "MakeMine"), owner, zone: "hand" },
      ...Array.from({ length: opts.mine ?? 0 }, (_, i) => ({ key: `mkM${i}`, def: makeTokensTactic(1, "controller", `MakeMine${i}`), owner, zone: "hand" as const })),
      ...Array.from({ length: opts.theirs ?? 0 }, (_, i) => ({ key: `mkT${i}`, def: makeTokensTactic(1, "opponent", `MakeTheirs${i}`), owner, zone: "hand" as const })),
      ...microExtras(),
      ...(opts.extra ?? []),
      { key: "myHandCard", def: character({ name: "MyHandCard" }), owner, zone: "hand" },
      { key: "myDiscardCard", def: character({ name: "MyDiscardCard" }), owner, zone: "discard" },
      ...bank("elitism", opts.elitism ?? 6, owner),
      ...bank("greed", opts.greed ?? 0, owner)
    ]
  });
  for (let i = 0; i < (opts.mine ?? 0); i++) play(board.engine, owner, board.id(`mkM${i}`));
  for (let i = 0; i < (opts.theirs ?? 0); i++) play(board.engine, owner, board.id(`mkT${i}`));
  return board;
}

clause(MASTER, "0:rule", "when it enters play I am offered 2 tokens: accepting puts exactly two Micromajig tokens into play under my control", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "a prompt is offered");
  assert.equal(pc.playerId, P1, "to the Master's controller");
  answerMay(engine, P1, true);
  assert.equal(micromajigs(engine, P1).length, 2, "exactly two tokens");
  assert.equal(micromajigs(engine, P2).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(pending(engine), undefined);
});

clause(MASTER, "0:rule", "it is a 'may': declining puts no token into play and the Master still enters play", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(allMicromajigs(engine).length, 0);
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(pending(engine), undefined);
});

clause(MASTER, "0:rule", "nothing is offered until the Master has entered play", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  playRaw(engine, P1, id("mm"));
  assert.equal(pending(engine), undefined, "still being deployed");
  assert.equal(allMicromajigs(engine).length, 0);
  resolvePendingResponses(engine);
  assert.ok(pending(engine), "now it is in play: the offer appears");
});

clause(MASTER, "0:rule", "a Master controlled by the opponent offers THEM the tokens, and they enter under their control", () => {
  const { engine, id } = masterBoard({ zone: "hand", owner: P2 });
  play(engine, P2, id("mm"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2);
  answerMay(engine, P2, true);
  assert.equal(micromajigs(engine, P2).length, 2);
  assert.equal(micromajigs(engine, P1).length, 0);
});

clause(MASTER, "0:rule", "it triggers when the Master is put into play by an effect, but not when another card enters play or when the Master leaves play", () => {
  const near = masterBoard({ zone: "play" });
  play(near.engine, P1, near.id("mkMine"));
  assert.equal(pending(near.engine), undefined, "another card entering play (a token) does not trigger the Master");
  assert.equal(micromajigs(near.engine, P1).length, 1, "only the token the tactic made");
  play(near.engine, P1, near.id("sendDestroy"), { selected: { t: [near.id("mm")] } });
  assert.equal(zoneOf(near.engine, near.id("mm")), "discard");
  assert.equal(pending(near.engine), undefined, "leaving play does not trigger it");
  assert.equal(micromajigs(near.engine, P1).length, 1);
});

clause(MASTER, "0:rule", "deploys for its printed cost of 3 with [E][E] (one resource short or one [E] short is refused) and has its printed 1 / 3 / 1 stats", () => {
  const { engine, id } = masterBoard({ zone: "hand", elitism: 3 });
  const before = ready(engine);
  play(engine, P1, id("mm"));
  answerMay(engine, P1, false);
  assert.equal(before - ready(engine), 3, "cost 3");
  assert.deepEqual(stats(engine, id("mm")), [1, 1, 3]);
  assert.deepEqual(engine.getSubtypes(id("mm")), ["manager"]);
  const short = masterBoard({ zone: "hand", elitism: 2 });
  refused(() => playRaw(short.engine, P1, short.id("mm")), "one resource short");
  const oneE = masterBoard({ zone: "hand", elitism: 1, greed: 5 });
  refused(() => playRaw(oneE.engine, P1, oneE.id("mm")), "one [E] is not [E][E]", /Threshold requirements are not met/);
});

// --- TINY SACRIFICES

/** Uses TINY SACRIFICES, destroying the given tokens (leaves the search prompt open). */
function tinySacrifices(engine: SpoilsEngine, id: IdOf, tokens: CardInstanceId[], player: Pid = P1): void {
  activateRaw(engine, player, id("mm"), "tiny", { selected: { toks: tokens } });
  resolvePendingResponses(engine);
}

clause(MASTER, "1:ability:tiny", "destroys exactly 3 of my Micromajig tokens as its cost, then I search my deck and put the chosen card into my hand", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  assert.equal(tokens.length, 3);
  const before = ready(engine);
  const handBefore = [...handOf(engine)];
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertTokenGone(engine, t, "TINY SACRIFICES cost");
  const pc = pending(engine);
  assert.ok(pc, "the search is offered");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I search");
  pickCards(engine, [id("fillD")]);
  assert.equal(zoneOf(engine, id("fillD")), "hand");
  assert.deepEqual(handOf(engine).filter((c) => !handBefore.includes(c)), [id("fillD")], "exactly one card joined my hand");
  assert.equal(ready(engine), before, "no resources are spent");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(engine.state.cards[id("mm")].depleted, false, "the Master is not depleted by its own ability");
});

clause(MASTER, "1:ability:tiny", "the cost is paid when the ability is used, before the opponent can respond; the search happens when it resolves", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  activateRaw(engine, P1, id("mm"), "tiny", { selected: { toks: tokens } });
  for (const t of tokens) assertTokenGone(engine, t, "paid up front");
  assert.equal(pending(engine), undefined, "no search yet");
  assert.ok(engine.state.responseWindow, "the opponent may respond");
  resolvePendingResponses(engine);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "now I search");
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "with more than 3 tokens only the 3 chosen are destroyed; the others stay in play", () => {
  const { engine, id } = masterBoard({ mine: 5 });
  const tokens = micromajigs(engine, P1);
  const chosen = [tokens[1], tokens[3], tokens[4]];
  tinySacrifices(engine, id, chosen);
  for (const t of chosen) assertTokenGone(engine, t, "chosen");
  for (const t of [tokens[0], tokens[2]]) assert.equal(zoneOf(engine, t), "play", "an unchosen token stays");
  assert.equal(micromajigs(engine, P1).length, 2);
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "any search result is possible: a character, an item or a tactic", () => {
  for (const key of ["fillA", "fillD", "fillE"]) {
    const { engine, id } = masterBoard({ mine: 3 });
    tinySacrifices(engine, id, micromajigs(engine, P1));
    pickCards(engine, [id(key)]);
    assert.equal(zoneOf(engine, id(key)), "hand", key);
  }
});

clause(MASTER, "1:ability:tiny", "only a card from MY deck can be found: the opponent's deck, my hand and my discard pile are refused, and only one card", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  for (const key of ["oppFill", "myHandCard", "myDiscardCard", "ally", "foe"]) refused(tryPick(engine, P1, [id(key)]), key);
  refused(tryPick(engine, P1, [id("fillA"), id("fillB")]), "one card");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(engine, [id("fillB")]);
  assert.equal(zoneOf(engine, id("fillB")), "hand");
  assert.equal(zoneOf(engine, id("oppFill")), "deck");
});

clause(MASTER, "1:ability:tiny", "'Search your deck for a card' is not optional (CR 312.2): with cards in the deck I must find one, so taking nothing is refused", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const handBefore = [...handOf(engine)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  refused(tryPick(engine, P1, []), "an unconditional search for a card must find one when the deck has any");
  assert.deepEqual(handOf(engine), handBefore);
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "the search is still open");
});

clause(MASTER, "1:ability:tiny", "the searched deck is shuffled afterwards (CR 312.1); the opponent's deck is not touched", () => {
  const mk = (random: () => number) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      random,
      cards: [
        { key: "mm", def: printing(MASTER), owner: P1, zone: "play" },
        // D5: test corrected because the cost now accepts only real Micromajig TOKENS (isToken); the old fake "tokens" were plain characters named Micromajig.
        ...Array.from({ length: 3 }, (_, i) => ({ key: `mkM${i}`, def: makeTokensTactic(1, "controller", `MakeMine${i}`), owner: P1, zone: "hand" as const })),
        ...microExtras(),
        ...fillers("x", 6, P1, "deck")
      ]
    });
  const withTokens = (g: { engine: SpoilsEngine; id: IdOf }) => {
    for (let i = 0; i < 3; i++) play(g.engine, P1, g.id(`mkM${i}`));
    return micromajigs(g.engine, P1);
  };
  assert.equal(
    deckWasShuffled(mk, (g) => {
      tinySacrifices(g.engine, g.id, withTokens(g));
      pickCards(g.engine, [g.id("fillC")]);
    }),
    true,
    "shuffled after the search"
  );
  const theirs = deckWasShuffled(mk, (g) => {
    tinySacrifices(g.engine, g.id, withTokens(g));
    pickCards(g.engine, [g.id("fillC")]);
  }, P2);
  assert.equal(theirs, false, "the opponent's deck is not shuffled");
});

clause(MASTER, "1:ability:tiny", "no card is revealed: the printed text says search and put into hand, not reveal", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pickCards(engine, [id("fillA")]);
  assert.equal(revealEvents(engine).length, 0);
});

clause(MASTER, "1:ability:tiny", "is refused with only 2 tokens (one short), and nothing is destroyed or searched", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, tokens), "2 tokens < 3");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(pending(engine), undefined);
  refused(() => tinySacrifices(engine, id, []), "no tokens chosen");
  const none = masterBoard({ mine: 0 });
  refused(() => tinySacrifices(none.engine, none.id, []), "no tokens at all");
});

clause(MASTER, "1:ability:tiny", "needs exactly 3 chosen: 2 or 4 chosen tokens are refused even with 4 on the board", () => {
  const { engine, id } = masterBoard({ mine: 4 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, tokens.slice(0, 2)), "two chosen");
  refused(() => tinySacrifices(engine, id, tokens), "four chosen");
  assert.equal(micromajigs(engine, P1).length, 4, "nothing was destroyed by the refused attempts");
  tinySacrifices(engine, id, tokens.slice(0, 3));
  assert.equal(micromajigs(engine, P1).length, 1);
  pickCards(engine, [id("fillA")]);
});

clause(MASTER, "1:ability:tiny", "the same token cannot be chosen three times", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const [t] = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, [t, t, t]), "one token three times");
  assert.equal(micromajigs(engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "only tokens I CONTROL can be destroyed: the opponent's Micromajig tokens are refused", () => {
  const { engine, id } = masterBoard({ mine: 2, theirs: 2 });
  const mine = micromajigs(engine, P1);
  const theirs = micromajigs(engine, P2);
  assert.equal(mine.length, 2);
  assert.equal(theirs.length, 2);
  refused(() => tinySacrifices(engine, id, [...mine, theirs[0]]), "two of mine and one of theirs");
  refused(() => tinySacrifices(engine, id, [mine[0], theirs[0], theirs[1]]), "one of mine and two of theirs");
  assert.equal(micromajigs(engine, P1).length, 2);
  assert.equal(micromajigs(engine, P2).length, 2);
});

clause(MASTER, "1:ability:tiny", "only Micromajig tokens count: other characters (mine or theirs), the Master itself and non-characters are refused", () => {
  const { engine, id } = masterBoard({ mine: 2 });
  const tokens = micromajigs(engine, P1);
  refused(() => tinySacrifices(engine, id, [...tokens, id("ally")]), "my other character");
  refused(() => tinySacrifices(engine, id, [...tokens, id("foe")]), "their character");
  refused(() => tinySacrifices(engine, id, [...tokens, id("mm")]), "the Master itself");
  assert.equal(zoneOf(engine, id("ally")), "play");
  assert.equal(zoneOf(engine, id("mm")), "play");
  assert.equal(micromajigs(engine, P1).length, 2);
});

clause(MASTER, "1:ability:tiny", "a depleted token can still be destroyed for the cost", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.cards[tokens[0]].depleted = true;
  tinySacrifices(engine, id, tokens);
  for (const t of tokens) assertTokenGone(engine, t, "cost");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
});

clause(MASTER, "1:ability:tiny", "can be used again: 6 tokens pay for it twice", () => {
  const { engine, id } = masterBoard({ mine: 6 });
  const tokens = micromajigs(engine, P1);
  tinySacrifices(engine, id, tokens.slice(0, 3));
  pickCards(engine, [id("fillA")]);
  tinySacrifices(engine, id, tokens.slice(3, 6));
  pickCards(engine, [id("fillB")]);
  assert.equal(micromajigs(engine, P1).length, 0);
  assert.equal(zoneOf(engine, id("fillA")), "hand");
  assert.equal(zoneOf(engine, id("fillB")), "hand");
});

clause(MASTER, "1:ability:tiny", "only the Master's controller can use it, and only while it is in play", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const tokens = micromajigs(engine, P1);
  engine.state.activePlayerId = P2;
  engine.state.priorityPlayerId = P2;
  refused(() => tinySacrifices(engine, id, tokens, P2), "the opponent", /control|own|activate|yours?/i);
  assert.equal(micromajigs(engine, P1).length, 3);
  const inHand = masterBoard({ zone: "hand", mine: 3 });
  refused(() => tinySacrifices(inHand.engine, inHand.id, micromajigs(inHand.engine, P1)), "the Master is in hand");
  assert.equal(micromajigs(inHand.engine, P1).length, 3);
});

clause(MASTER, "1:ability:tiny", "a token that is destroyed as the cost disappears (it is not put into my discard pile)", () => {
  const { engine, id } = masterBoard({ mine: 3 });
  const discardBefore = [...discardOf(engine)];
  tinySacrifices(engine, id, micromajigs(engine, P1));
  pickCards(engine, [id("fillA")]);
  assert.deepEqual(discardOf(engine), discardBefore, "no token entered my discard pile");
});

clause(MASTER, "2:rule", "the tokens are character cards named Micromajig with 1 strength, 1 life and 3 speed", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertMicromajigBody(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "the tokens are GEARSMITH character cards", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreGearsmith(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "the tokens carry the majig subtype", () => {
  const { engine, id } = masterBoard({ zone: "hand" });
  play(engine, P1, id("mm"));
  answerMay(engine, P1, true);
  assertTokensAreMajigs(engine, micromajigs(engine, P1));
});

clause(MASTER, "2:rule", "when they leave play (destroyed, bounced, decked, voided, removed) they disappear: never in a hand, deck or discard pile", () => {
  const board = masterBoard({ zone: "hand", mine: 3 });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenLeavesTheGame(board, micromajigs(board.engine, P1));
});

clause(MASTER, "2:rule", "a token dies to 1 damage and disappears, not put into the discard pile", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  const [token, second] = micromajigs(board.engine, P1);
  assertTokenDiesOfDamage(board, token);
  assert.equal(zoneOf(board.engine, second), "play");
});

clause(MASTER, "2:rule", "a token is a character: it can block, but it cannot attack the turn it enters play", () => {
  const board = masterBoard({ zone: "hand" });
  play(board.engine, P1, board.id("mm"));
  answerMay(board.engine, P1, true);
  assertTokenCanBlockButNotAttack(board, micromajigs(board.engine, P1)[0]);
});

// --- added after the mutation check ------------------------------------------

clause(LEO, "0:ability:mega", "each Kaiser must be yours on its own: an opponent's PantherKaiser with my TigerKaiser (and the reverse) cannot pay the cost", () => {
  const panther = leoBoard({ panther: false, extra: [{ key: "pk", def: printing(PANTHER), owner: P2, zone: "play" }] });
  refused(() => megaRaw(panther), "the PantherKaiser is the opponent's");
  assert.equal(panther.engine.state.cards[panther.id("pk")].depleted, false);
  assert.equal(panther.engine.state.cards[panther.id("tk")].depleted, false, "no partial payment");
  const tiger = leoBoard({ tiger: false, extra: [{ key: "tk", def: printing(TIGER), owner: P2, zone: "play" }] });
  refused(() => megaRaw(tiger), "the TigerKaiser is the opponent's");
  assert.equal(tiger.engine.state.cards[tiger.id("tk")].depleted, false);
  assert.equal(tiger.engine.state.cards[tiger.id("pk")].depleted, false, "no partial payment");
  const both = leoBoard();
  megaRaw(both);
  assert.equal(both.engine.state.cards[both.id("pk")].depleted, true, "control: with both Kaisers mine it works");
});

clause(MASTER, "1:ability:tiny", "the tokens are DESTROYED (not merely removed): a 'when a card is destroyed' watcher sees all 3", () => {
  const watcher = item({
    name: "Destruction Watcher",
    behavior: { abilities: [{ id: "watch", type: "triggered", event: "cardDestroyed", effects: [{ type: "modifyInfluence", player: "controller", amount: -1 }] }] }
  });
  const { engine, id } = masterBoard({ mine: 3, extra: [{ key: "watcher", def: watcher, owner: P1, zone: "play" }] });
  const before = engine.state.players[P1].influence;
  tinySacrifices(engine, id, micromajigs(engine, P1));
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [id("fillA")] } : declineAll(pc)));
  assert.equal(engine.state.players[P1].influence, before - 3, "one 'destroyed' event per token");
  assert.equal(zoneOf(engine, id("fillA")), "hand");
});

// @@END@@
