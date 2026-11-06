// Clause tests, batch seed-saga-06, part p1 (groups 1-3, missing clauses only).
// Cantankerous Claywork, Clay Node, Cock Block.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  bank,
  bounceTactic,
  character,
  developFaction,
  item,
  killTactic,
  location,
  tactic,
  play,
  resolvePendingResponses,
  activate,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, finishBattle, playRaw } from "./_battle.js";
import { endTurn, factionOf } from "./_turn.js";

const CLAYWORK = "07af8c5a-b554-4536-ad0d-220358909502"; // character gearsmith golem cost 7 "eee" 6/3/5 -- AGGRO; attacks: other chars +1 str +1 life this turn
const NODE = "3832de4f-e332-4efc-884f-60c6fa338e86"; // character gearsmith node cost 2 "eee" 2/3/1 -- ETB search node; LTB destroy other nodes; DISSOLVE pay 2; FLIP UP 1 [E][E][E]
const COCK = "92d24c0c-3c7f-40ee-ad55-f0616b58d1bf"; // tactic gearsmith cost 3 "e" -- only in response to an ability; terminate it; face-down resource; FLIP UP 4 [E] + discard

const E = (n: number, owner: PlayerId = P1, spent = false): CardPlacement[] => {
  const placements = bank("elitism", n, owner);
  return spent ? placements.map(p => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" })) : placements;
};
const R = (n: number, owner: PlayerId = P1, spent = false): CardPlacement[] => {
  const placements = bank("rage", n, owner);
  return spent ? placements.map(p => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" })) : placements;
};
const ready = (engine: SpoilsEngine, player: PlayerId): number => readyResources(engine, player);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const sorted = (xs: readonly string[]): string[] => [...xs].sort();

const rawFlipUp = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const actRaw = (engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, abilityId: string, selected: Record<string, CardInstanceId[]> = {}): void =>
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);

/** Answers every prompt by picking nothing / declining, but orderTriggers with the given order. */
const answerAll = (pc: PendingChoiceLike): unknown => declineAll(pc);

// ============================================================================
// Cantankerous Claywork -- AGGRO; when it attacks, all your other characters +1 strength +1 life this turn
// ============================================================================

function clayworkBoard(o: { resources?: CardPlacement[]; inHand?: boolean; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: () => 0.5,
    cards: [
      { key: "cw", def: printing(CLAYWORK), owner: P1, zone: o.inHand ? "hand" : "play" },
      { key: "mine1", def: character({ name: "Mine One", strength: 2, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 4, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", strength: 3, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "idol", def: item({ name: "My Idol", strength: 2 }), owner: P1, zone: "play" },
      ...fillers("d", 3, P1, "deck"),
      ...fillers("f", 3, P2, "deck"),
      ...(o.resources ?? []),
      ...(o.extra ?? [])
    ]
  });
}

type CwGame = ReturnType<typeof clayworkBoard>;
const stats = (g: CwGame, key: string): [number, number] => [g.engine.getStat(g.id(key), "strength"), g.engine.getStat(g.id(key), "life")];

clause(CLAYWORK, "0:kw:AGGRO", "has the AGGRO keyword and its printed 6 / 3 / 5 gearsmith golem stats", () => {
  const g = clayworkBoard();
  assert.ok(g.engine.getKeywords(g.id("cw")).map(k => String(k).toLowerCase()).includes("aggro"), "g.engine.getKeywords(g.id(\"cw\")).map(k => String(k).toLowerCase()).includes(\"aggro\")");
  assert.equal(g.engine.getStat(g.id("cw"), "strength"), 6);
  assert.equal(g.engine.getStat(g.id("cw"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("cw"), "life"), 5);
  assert.deepEqual(g.engine.getCardTypes(g.id("cw")), ["character"]);
  assert.equal(printing(CLAYWORK).trade, "gearsmith");
  assert.deepEqual(printing(CLAYWORK).subtype, ["golem"]);
});

clause(CLAYWORK, "0:kw:AGGRO", "it can attack the turn it enters play, and an ordinary character deployed the same turn cannot", () => {
  const g = clayworkBoard({ inHand: true, resources: E(7), extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("cw"));
  play(g.engine, P1, g.id("plain"));
  assert.equal(zoneOf(g.engine, g.id("cw")), "play");
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  refused(() => declareAttackBy(g.engine, P1, [g.id("plain")]), "no AGGRO, summoning sick", /./);
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  assert.ok(g.engine.state.battle, "Claywork attacked right away");
});

clause(CLAYWORK, "0:kw:AGGRO", "deploys for exactly its printed cost 7 with [E][E][E]: seven Elitism are all spent; six is one short; 7 Rage lack the threshold; only two [E] among seven is one icon short", () => {
  const ok = clayworkBoard({ inHand: true, resources: E(7) });
  play(ok.engine, P1, ok.id("cw"));
  assert.equal(zoneOf(ok.engine, ok.id("cw")), "play");
  assert.equal(ready(ok.engine, P1), 0, "all seven paid");
  const short = clayworkBoard({ inHand: true, resources: E(6) });
  refused(() => play(short.engine, P1, short.id("cw")), "one resource short", /./);
  assert.equal(zoneOf(short.engine, short.id("cw")), "hand");
  assert.equal(ready(short.engine, P1), 6, "nothing paid");
  const noThreshold = clayworkBoard({ inHand: true, resources: R(7) });
  refused(() => play(noThreshold.engine, P1, noThreshold.id("cw")), "no [E] at all", /./);
  const iconShort = clayworkBoard({ inHand: true, resources: [...E(2), ...R(5)] });
  refused(() => play(iconShort.engine, P1, iconShort.id("cw")), "two [E] of three", /./);
  const spentEnough = clayworkBoard({ inHand: true, resources: [...E(3, P1, true), ...R(7)] });
  play(spentEnough.engine, P1, spentEnough.id("cw"));
  assert.equal(zoneOf(spentEnough.engine, spentEnough.id("cw")), "play", "spent [E] count for the threshold; seven ready Rage pay");
  const spentTwo = clayworkBoard({ inHand: true, resources: [...E(2, P1, true), ...R(7)] });
  refused(() => play(spentTwo.engine, P1, spentTwo.id("cw")), "only two [E] in total", /./);
});

clause(CLAYWORK, "1:rule", "when it attacks, every other character I control gains +1 strength and +1 life; it, the opponent's character and my item are not changed", () => {
  const g = clayworkBoard();
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(g, "mine1"), [3, 4], "2/3 -> 3/4");
  assert.deepEqual(stats(g, "mine2"), [5, 6], "4/5 -> 5/6");
  assert.deepEqual(stats(g, "cw"), [6, 5], "'other' characters only: Claywork itself is unchanged");
  assert.deepEqual(stats(g, "foe1"), [3, 3], "the opponent's character is not 'your'");
  assert.equal(g.engine.getStat(g.id("mine1"), "speed"), 1, "speed unchanged");
  assert.equal(g.engine.getStat(g.id("idol"), "strength"), 2, "an item is not a character: not boosted");
});

clause(CLAYWORK, "1:rule", "the bonus stays for the whole turn (also after the battle) and is gone next turn", () => {
  const g = clayworkBoard();
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined, "the battle is over");
  assert.deepEqual(stats(g, "mine1"), [3, 4], "still boosted after the battle, same turn");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.deepEqual(stats(g, "mine1"), [2, 3], "'this turn' ended");
  assert.deepEqual(stats(g, "mine2"), [4, 5]);
});

clause(CLAYWORK, "1:rule", "other attackers in the same party are 'other characters' too and gain the bonus", () => {
  const g = clayworkBoard();
  declareAttackBy(g.engine, P1, [g.id("cw"), g.id("mine1")]);
  drain(g.engine, answerAll);
  assert.deepEqual(stats(g, "mine1"), [3, 4]);
  assert.deepEqual(stats(g, "mine2"), [5, 6]);
});

clause(CLAYWORK, "1:rule", "it triggers only when THIS card attacks: another character attacking alone gives no bonus", () => {
  const g = clayworkBoard();
  declareAttackBy(g.engine, P1, [g.id("mine1")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.deepEqual(stats(g, "mine1"), [2, 3]);
  assert.deepEqual(stats(g, "mine2"), [4, 5]);
  assert.deepEqual(stats(g, "cw"), [6, 5]);
});

clause(CLAYWORK, "1:rule", "'all your other characters' is the set when it attacks: a character entering later this turn is not boosted", () => {
  const g = clayworkBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 0, strength: 1, life: 1 }), owner: P1, zone: "hand" }] });
  declareAttackBy(g.engine, P1, [g.id("cw")]);
  g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] } as never);
  finishBattle(g.engine);
  assert.deepEqual(stats(g, "mine1"), [3, 4], "control: the trigger did happen");
  play(g.engine, P1, g.id("late"));
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  assert.deepEqual(stats(g, "late"), [1, 1]);
});

clause(CLAYWORK, "1:rule", "two Claywork attacking together: each is 'other' for the other (+1/+1 each) and a bystander gets both bonuses", () => {
  const g = clayworkBoard({ extra: [{ key: "cw2", def: printing(CLAYWORK), owner: P1, zone: "play" }] });
  declareAttackBy(g.engine, P1, [g.id("cw"), g.id("cw2")]);
  drain(g.engine, answerAll);
  assert.deepEqual(stats(g, "mine1"), [4, 5], "two triggers: +2/+2");
  assert.deepEqual(stats(g, "cw"), [7, 6], "boosted by the other Claywork only");
  assert.deepEqual(stats(g, "cw2"), [7, 6]);
  assert.deepEqual(stats(g, "foe1"), [3, 3]);
});

clause(CLAYWORK, "1:rule", "does not apply when it attacks on the opponent's behalf: the opponent's Claywork boosts only its controller's characters", () => {
  const g = clayworkBoard({
    active: P2,
    extra: [
      { key: "foecw", def: printing(CLAYWORK), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(g.engine, P2, [g.id("foecw")]);
  assert.deepEqual(stats(g, "foe1"), [4, 4]);
  assert.deepEqual(stats(g, "mine1"), [2, 3], "my characters are not 'their' characters");
  assert.deepEqual(stats(g, "foecw"), [6, 5]);
});

// ============================================================================
// Clay Node -- ETB search node; LTB destroy other nodes; DISSOLVE pay 2; FLIP UP 1 [E][E][E]
// ============================================================================

const NODE_DECOY = (name: string) => character({ name, subtype: ["node"], strength: 1, life: 1 });

function nodeBoard(o: { resources?: CardPlacement[]; inHand?: boolean; active?: PlayerId; extra?: CardPlacement[]; deck?: boolean } = {}) {
  const active = o.active ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    activePlayerId: active,
    turn: active === P1 ? 1 : 2,
    random: () => 0.5,
    cards: [
      { key: "node", def: printing(NODE), owner: P1, zone: o.inHand ? "hand" : "play" },
      { key: "deckNodeA", def: NODE_DECOY("Deck Node A"), owner: P1, zone: "deck" },
      { key: "deckNodeB", def: printing(NODE), owner: P1, zone: "deck" },
      { key: "deckGolem", def: character({ name: "Deck Golem", subtype: ["golem"] }), owner: P1, zone: "deck" },
      { key: "deckItem", def: item({ name: "Deck Item", subtype: ["node"] }), owner: P1, zone: "deck" },
      { key: "foeDeckNode", def: NODE_DECOY("Foe Deck Node"), owner: P2, zone: "deck" },
      { key: "handNode", def: NODE_DECOY("Hand Node"), owner: P1, zone: "hand" },
      { key: "discNode", def: NODE_DECOY("Discarded Node"), owner: P1, zone: "discard" },
      ...fillers("d", 2, P1, "deck"),
      ...fillers("f", 2, P2, "deck"),
      ...(o.resources ?? []),
      ...(o.extra ?? [])
    ]
  });
}
type NodeGame = ReturnType<typeof nodeBoard>;

const pick = (engine: SpoilsEngine, player: PlayerId, ids: CardInstanceId[]): void => {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "selectTargets", selected: { found: ids } } } as never);
  resolvePendingResponses(engine);
};
const searchChoice = (engine: SpoilsEngine) => engine.state.pendingChoice as unknown as { kind: string; playerId: string } | undefined;

clause(NODE, "0:rule", "printed cost 2 / threshold [E][E][E] / stats 2/3/1 gearsmith node: deploys with the cost isolated by spent [E], and is refused one short or one icon short", () => {
  const g = nodeBoard({ inHand: true, resources: [...E(3, P1, true), ...R(2)] });
  assert.equal(g.engine.getStat(g.id("node"), "strength"), 2);
  assert.equal(g.engine.getStat(g.id("node"), "speed"), 3);
  assert.equal(g.engine.getStat(g.id("node"), "life"), 1);
  assert.deepEqual(printing(NODE).subtype, ["node"]);
  assert.equal(printing(NODE).trade, "gearsmith");
  play(g.engine, P1, g.id("node"));
  drain(g.engine, answerAll);
  assert.equal(zoneOf(g.engine, g.id("node")), "play");
  assert.equal(ready(g.engine, P1), 0, "exactly 2 paid");
  const one = nodeBoard({ inHand: true, resources: [...E(3, P1, true), ...R(1)] });
  refused(() => play(one.engine, P1, one.id("node")), "cost 2, only one ready", /./);
  assert.equal(zoneOf(one.engine, one.id("node")), "hand");
  assert.equal(ready(one.engine, P1), 1);
  const icon = nodeBoard({ inHand: true, resources: [...E(2), ...R(2)] });
  refused(() => play(icon.engine, P1, icon.id("node")), "only two [E]", /./);
  const none = nodeBoard({ inHand: true, resources: R(5) });
  refused(() => play(none.engine, P1, none.id("node")), "no [E]", /./);
  const plain = nodeBoard({ inHand: true, resources: E(3) });
  play(plain.engine, P1, plain.id("node"));
  drain(plain.engine, answerAll);
  assert.equal(ready(plain.engine, P1), 1, "three [E] ready: pay 2, one left");
});

clause(NODE, "0:rule", "when it enters play its controller may search the deck: only my own deck's node CHARACTER/cards (subtype node) are pickable, then it is revealed and goes to hand", () => {
  const g = nodeBoard({ inHand: true, resources: E(3) });
  const handBefore = sorted(handOf(g.engine, P1));
  play(g.engine, P1, g.id("node"));
  assert.equal(searchChoice(g.engine)?.kind, "selectTargets");
  assert.equal(searchChoice(g.engine)?.playerId, P1);
  pick(g.engine, P1, [g.id("deckNodeA")]);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "hand");
  assert.deepEqual(sorted(handOf(g.engine, P1)), sorted([...handBefore.filter(x => x !== g.id("node")), g.id("deckNodeA")]));
  assert.equal(zoneOf(g.engine, g.id("deckNodeB")), "deck", "only one card is taken");
  assert.equal(zoneOf(g.engine, g.id("deckGolem")), "deck");
});

clause(NODE, "0:rule", "the search can take a second Clay Node (another printing of the same card) but not a golem, not the opponent's node, and not a node from hand or discard", () => {
  const take = (key: string) => {
    const g = nodeBoard({ inHand: true, resources: E(3) });
    play(g.engine, P1, g.id("node"));
    return { g, run: () => pick(g.engine, P1, [g.id(key)]) };
  };
  const ctl = take("deckNodeB");
  ctl.run();
  assert.equal(zoneOf(ctl.g.engine, ctl.g.id("deckNodeB")), "hand", "control: a Clay Node itself is a node");
  for (const key of ["deckGolem", "foeDeckNode", "handNode", "discNode"]) {
    const t = take(key);
    assert.throws(t.run, new RegExp("."), `${key} is not a legal search result`);
    assert.ok(searchChoice(t.g.engine), "still waiting for a legal pick");
    assert.notEqual(zoneOf(t.g.engine, t.g.id(key)), "hand".concat(key === "handNode" ? "x" : ""), "nothing moved");
  }
});

clause(NODE, "0:rule", "it searches for ONE card: two picks are refused", () => {
  const g = nodeBoard({ inHand: true, resources: E(3) });
  play(g.engine, P1, g.id("node"));
  assert.throws(() => pick(g.engine, P1, [g.id("deckNodeA"), g.id("deckNodeB")]));
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
  assert.equal(zoneOf(g.engine, g.id("deckNodeB")), "deck");
});

clause(NODE, "0:rule", "'you may': declining finds nothing, the hand is unchanged and no node leaves the deck", () => {
  const g = nodeBoard({ inHand: true, resources: E(3) });
  const handBefore = handOf(g.engine, P1).filter(x => x !== g.id("node")).length;
  play(g.engine, P1, g.id("node"));
  pick(g.engine, P1, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, handBefore);
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
  assert.equal(zoneOf(g.engine, g.id("node")), "play");
});

clause(NODE, "0:rule", "searching an item/non-character with the node subtype is allowed ('a node card', not only characters)", () => {
  const g = nodeBoard({ inHand: true, resources: E(3) });
  play(g.engine, P1, g.id("node"));
  pick(g.engine, P1, [g.id("deckItem")]);
  assert.equal(zoneOf(g.engine, g.id("deckItem")), "hand");
});

clause(NODE, "0:rule", "with no node in the deck the search simply finds nothing and play continues", () => {
  const g = nodeBoard({ inHand: true, resources: E(3) });
  for (const key of ["deckNodeA", "deckNodeB", "deckItem"]) g.engine.state.players[P1].deck = g.engine.state.players[P1].deck.filter(x => x !== g.id(key));
  for (const key of ["deckNodeA", "deckNodeB", "deckItem"]) g.engine.state.cards[g.id(key)].zone = "void" as never;
  const handBefore = handOf(g.engine, P1).length;
  play(g.engine, P1, g.id("node"));
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(handOf(g.engine, P1).length, handBefore - 1, "only the node itself left the hand");
  assert.equal(zoneOf(g.engine, g.id("node")), "play");
});

clause(NODE, "0:rule", "the search happens only for the Node entering play, not when another card enters play", () => {
  const g = nodeBoard({ resources: E(3), extra: [{ key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("newbie"));
  assert.equal(g.engine.state.pendingChoice, undefined, "no search for a different card");
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
});

clause(NODE, "0:rule", "the opponent's Clay Node entering play searches the OPPONENT's deck, not mine", () => {
  const g = nodeBoard({
    active: P2,
    extra: [
      { key: "foeNode", def: printing(NODE), owner: P2, zone: "hand" },
      { key: "foeDeckA", def: NODE_DECOY("Foe Deck A"), owner: P2, zone: "deck" },
      ...E(3, P2)
    ]
  });
  play(g.engine, P2, g.id("foeNode"));
  assert.equal(searchChoice(g.engine)?.playerId, P2);
  assert.throws(() => pick(g.engine, P2, [g.id("deckNodeA")]), /./, "my deck's node is not theirs to take");
  pick(g.engine, P2, [g.id("foeDeckA")]);
  assert.equal(zoneOf(g.engine, g.id("foeDeckA")), "hand");
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
});

clause(NODE, "0:rule", "the found card is revealed to everyone (once), and only when one is found", () => {
  const revealEvents = (e: SpoilsEngine) => e.getLog().filter(entry => entry.event?.type === "cardsRevealed");
  const g = nodeBoard({ inHand: true, resources: E(3) });
  play(g.engine, P1, g.id("node"));
  pick(g.engine, P1, [g.id("deckNodeA")]);
  const reveals = revealEvents(g.engine);
  assert.equal(reveals.length, 1);
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [g.id("deckNodeA")]);
  assert.equal(event.viewerId, "all");
  const none = nodeBoard({ inHand: true, resources: E(3) });
  play(none.engine, P1, none.id("node"));
  pick(none.engine, P1, []);
  assert.equal(revealEvents(none.engine).length, 0, "nothing found, nothing revealed");
});

clause(NODE, "0:rule", "CR 312.1: the deck search shuffles MY deck afterwards (same cards, new order), whether or not it finds a node, and the opponent's deck is not shuffled", () => {
  const found = nodeBoard({ inHand: true, resources: E(3) });
  const before = [...found.engine.state.players[P1].deck];
  const foeBefore = [...found.engine.state.players[P2].deck];
  play(found.engine, P1, found.id("node"));
  pick(found.engine, P1, [found.id("deckNodeA")]);
  const unshuffled = before.filter(x => x !== found.id("deckNodeA"));
  assert.deepEqual(sorted(found.engine.state.players[P1].deck), sorted(unshuffled), "the same cards remain in the deck");
  assert.notDeepEqual(found.engine.state.players[P1].deck, unshuffled, "a successful search shuffles the deck");
  assert.deepEqual(found.engine.state.players[P2].deck, foeBefore, "the opponent's deck keeps its order");
  const none = nodeBoard({ inHand: true, resources: E(3) });
  for (const key of ["deckNodeA", "deckNodeB", "deckItem"]) none.engine.state.players[P1].deck = none.engine.state.players[P1].deck.filter(x => x !== none.id(key));
  const noneBefore = [...none.engine.state.players[P1].deck];
  play(none.engine, P1, none.id("node"));
  drain(none.engine, declineAll);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.deepEqual(sorted(none.engine.state.players[P1].deck), sorted(noneBefore), "the same cards remain");
  assert.notDeepEqual(none.engine.state.players[P1].deck, noneBefore, "a search that finds nothing still shuffles the deck");
});

// -- leaves play ------------------------------------------------------------

function leaveBoard() {
  return nodeBoard({
    resources: E(4),
    extra: [
      { key: "otherNode", def: NODE_DECOY("Other Node"), owner: P1, zone: "play" },
      { key: "twin", def: printing(NODE), owner: P1, zone: "play" },
      { key: "foeNode", def: NODE_DECOY("Foe Node"), owner: P2, zone: "play" },
      { key: "golem", def: character({ name: "Golem", subtype: ["golem"], life: 5 }), owner: P1, zone: "play" },
      { key: "nodeItem", def: item({ name: "Node Item", subtype: ["node"] }), owner: P1, zone: "play" },
      { key: "killer", def: killTactic({ name: "Killer" }), owner: P1, zone: "hand" },
      { key: "bouncer", def: bounceTactic({ name: "Bouncer" }), owner: P1, zone: "hand" }
    ]
  });
}
const killNode = (g: NodeGame, key = "node"): void => {
  play(g.engine, P1, g.id("killer"), { selected: { t: [g.id(key)] } });
  drain(g.engine, answerAll);
};

clause(NODE, "1:rule", "when it is destroyed, every other node card is destroyed: mine, a second Clay Node and the opponent's, but not a golem", () => {
  const g = leaveBoard();
  killNode(g);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("node")), "discard");
  assert.equal(zoneOf(g.engine, g.id("otherNode")), "discard");
  assert.equal(zoneOf(g.engine, g.id("twin")), "discard", "another copy of Clay Node is an 'other' node (and not excluded by name)");
  assert.equal(zoneOf(g.engine, g.id("foeNode")), "discard", "'all other node cards' includes the opponent's");
  assert.equal(zoneOf(g.engine, g.id("golem")), "play", "a non-node is untouched");
});

clause(NODE, "1:rule", "'node cards' covers any card type with the node subtype: a node item in play is destroyed too", () => {
  const g = leaveBoard();
  killNode(g);
  assert.equal(zoneOf(g.engine, g.id("nodeItem")), "discard");
});

clause(NODE, "1:rule", "leaving play by being returned to hand also destroys the other nodes ('leaves play', not 'is destroyed')", () => {
  const g = leaveBoard();
  play(g.engine, P1, g.id("bouncer"), { selected: { t: [g.id("node")] } });
  drain(g.engine, answerAll);
  assert.equal(zoneOf(g.engine, g.id("node")), "hand");
  assert.equal(zoneOf(g.engine, g.id("otherNode")), "discard");
  assert.equal(zoneOf(g.engine, g.id("twin")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foeNode")), "discard");
  assert.equal(zoneOf(g.engine, g.id("golem")), "play");
});

clause(NODE, "1:rule", "only cards IN PLAY are destroyed: nodes in hand, deck and discard stay where they are", () => {
  const g = leaveBoard();
  killNode(g);
  assert.equal(zoneOf(g.engine, g.id("handNode")), "hand");
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
  assert.equal(zoneOf(g.engine, g.id("discNode")), "discard");
});

clause(NODE, "1:rule", "the opponent's Clay Node leaving play destroys my Clay Node and my other nodes as well (each Clay Node has its own trigger)", () => {
  const h = nodeBoard({
    resources: E(4),
    extra: [
      { key: "foeClay", def: printing(NODE), owner: P2, zone: "play" },
      { key: "otherNode", def: NODE_DECOY("Other Node"), owner: P1, zone: "play" },
      { key: "golem", def: character({ name: "Golem", subtype: ["golem"], life: 5 }), owner: P1, zone: "play" },
      { key: "killer", def: killTactic({ name: "Killer" }), owner: P1, zone: "hand" }
    ]
  });
  play(h.engine, P1, h.id("killer"), { selected: { t: [h.id("foeClay")] } });
  drain(h.engine, answerAll);
  assert.equal(zoneOf(h.engine, h.id("foeClay")), "discard");
  assert.equal(zoneOf(h.engine, h.id("node")), "discard", "my Clay Node is an 'other' node to theirs");
  assert.equal(zoneOf(h.engine, h.id("otherNode")), "discard", "their trigger kills every other node, mine included");
  assert.equal(zoneOf(h.engine, h.id("golem")), "play");
});

clause(NODE, "1:rule", "a non-node leaving play does not trigger it: the Clay Node and other nodes stay", () => {
  const g = leaveBoard();
  play(g.engine, P1, g.id("killer"), { selected: { t: [g.id("golem")] } });
  drain(g.engine, answerAll);
  assert.equal(zoneOf(g.engine, g.id("golem")), "discard");
  assert.equal(zoneOf(g.engine, g.id("node")), "play");
  assert.equal(zoneOf(g.engine, g.id("otherNode")), "play");
  assert.equal(zoneOf(g.engine, g.id("foeNode")), "play");
});

clause(NODE, "1:rule", "a FACE-DOWN node is not a node card: it is not destroyed when another Clay Node leaves play", () => {
  const g = nodeBoard({
    resources: E(2),
    extra: [
      { key: "downNode", def: printing(NODE), owner: P1, zone: "play", faceDown: true },
      { key: "killer", def: killTactic({ name: "Killer" }), owner: P1, zone: "hand" }
    ]
  });
  killNode(g);
  assert.equal(zoneOf(g.engine, g.id("node")), "discard");
  assert.equal(zoneOf(g.engine, g.id("downNode")), "play", "face-down cards have no subtype");
  assert.equal(g.engine.state.cards[g.id("downNode")].faceDown, true);
});

/** Synthetic free tactics that reach a FACE-DOWN card in play (the stock Kill/Bounce only target characters). */
const faceDownTactic = (name: string, effect: "destroy" | "bounce"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "fd",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", faceDown: true }, count: 1 }],
          effects: [effect === "destroy"
            ? { type: "destroy", target: { type: "selected", id: "t" } }
            : { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    } as never
  });

for (const mode of ["destroy", "bounce"] as const) {
  clause(NODE, "1:rule", `a face-down Clay Node leaving play by being ${mode === "destroy" ? "destroyed" : "returned to hand"} does NOT destroy the other nodes (a face-down card has no abilities, CR 411.3)`, () => {
    const g = nodeBoard({
      resources: E(2),
      extra: [
        { key: "downNode", def: printing(NODE), owner: P1, zone: "play", faceDown: true },
        { key: "otherNode", def: NODE_DECOY("Other Node"), owner: P1, zone: "play" },
        { key: "foeNode", def: NODE_DECOY("Foe Node"), owner: P2, zone: "play" },
        { key: "fdt", def: faceDownTactic("FD", mode), owner: P1, zone: "hand" }
      ]
    });
    play(g.engine, P1, g.id("fdt"), { selected: { t: [g.id("downNode")] } });
    drain(g.engine, answerAll);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("downNode")), mode === "destroy" ? "discard" : "hand", "the face-down Clay Node left play");
    assert.equal(zoneOf(g.engine, g.id("otherNode")), "play", "my other node is not destroyed");
    assert.equal(zoneOf(g.engine, g.id("foeNode")), "play", "the opponent's node is not destroyed");
    assert.equal(zoneOf(g.engine, g.id("node")), "play", "the face-up Clay Node is not destroyed");
  });
}

// -- DISSOLVE ---------------------------------------------------------------

clause(NODE, "2:ability:dissolve", "DISSOLVE: pays 2 and flips the Clay Node face-down under its owner's control: still in play, a resource, no longer a character", () => {
  const g = nodeBoard({ resources: R(3) });
  assert.equal(ready(g.engine, P1), 3);
  activate(g.engine, P1, g.id("node"), "dissolve");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const c = g.engine.state.cards[g.id("node")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.equal(g.engine.isResource(g.id("node")), true);
  assert.equal(ready(g.engine, P1), 2, "3 - 2 paid + 1 for the new face-down resource");
});

clause(NODE, "2:ability:dissolve", "DISSOLVE costs exactly 2: one resource is refused with nothing paid, two is enough", () => {
  const one = nodeBoard({ resources: R(1) });
  refused(() => activate(one.engine, P1, one.id("node"), "dissolve"), "only one resource", /./);
  assert.equal(one.engine.state.cards[one.id("node")].faceDown ?? false, false);
  assert.equal(ready(one.engine, P1), 1);
  const two = nodeBoard({ resources: R(2) });
  activate(two.engine, P1, two.id("node"), "dissolve");
  assert.equal(two.engine.state.cards[two.id("node")].faceDown, true);
  assert.equal(ready(two.engine, P1), 1, "2 paid, 1 new face-down resource");
});

clause(NODE, "2:ability:dissolve", "DISSOLVE needs no threshold: Rage pays for it", () => {
  const g = nodeBoard({ resources: R(2) });
  activate(g.engine, P1, g.id("node"), "dissolve");
  assert.equal(g.engine.state.cards[g.id("node")].faceDown, true);
});

clause(NODE, "2:ability:dissolve", "the face-down card returns under its OWNER's control even when the opponent controlled it", () => {
  const g = nodeBoard({
    active: P2,
    resources: R(3, P2),
    extra: []
  });
  g.engine.state.cards[g.id("node")].controllerId = P2;
  activate(g.engine, P2, g.id("node"), "dissolve");
  const c = g.engine.state.cards[g.id("node")];
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1, "under its owner's control");
});

clause(NODE, "2:ability:dissolve", "flipping it face-down is leaving play (CR 411.3): the other nodes are destroyed, but the new face-down resource searches nothing", () => {
  const g = nodeBoard({
    resources: R(3),
    extra: [{ key: "otherNode", def: NODE_DECOY("Other Node"), owner: P1, zone: "play" }, { key: "golem", def: character({ name: "Golem", subtype: ["golem"] }), owner: P1, zone: "play" }]
  });
  const handBefore = handOf(g.engine, P1).length;
  activate(g.engine, P1, g.id("node"), "dissolve");
  assert.equal(g.engine.state.pendingChoice, undefined, "no search for a face-down card");
  assert.equal(zoneOf(g.engine, g.id("otherNode")), "discard", "the Clay Node left play as a face-up node");
  assert.equal(zoneOf(g.engine, g.id("golem")), "play");
  assert.equal(handOf(g.engine, P1).length, handBefore);
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "deck");
});

clause(NODE, "2:ability:dissolve", "a face-down (dissolved) Clay Node has no abilities left: DISSOLVE is not usable again", () => {
  const g = nodeBoard({ resources: R(5) });
  activate(g.engine, P1, g.id("node"), "dissolve");
  refused(() => activate(g.engine, P1, g.id("node"), "dissolve"), "face-down cards have no abilities", /./);
});

// -- FLIP UP ----------------------------------------------------------------

function flipBoard(o: { node?: Partial<CardPlacement>; resources?: CardPlacement[]; active?: PlayerId } = {}) {
  return nodeBoard({
    active: o.active,
    resources: o.resources,
    extra: []
  });
}

/** Puts the Clay Node face-down in play as a resource (via the real board placement). */
function downNodeBoard(resources: CardPlacement[], o: { spent?: boolean; active?: PlayerId } = {}) {
  const g = nodeBoard({ active: o.active, resources });
  const c = g.engine.state.cards[g.id("node")];
  c.faceDown = true;
  if (o.spent) c.attachedTo = factionOf(g.engine, P1);
  return g;
}

clause(NODE, "3:flipUp", "a face-down Clay Node flips up for 1 with [E][E][E] (three other [E]): a face-up character in play again", () => {
  const g = downNodeBoard(E(3));
  rawFlipUp(g.engine, P1, g.id("node"));
  drain(g.engine, answerAll);
  const c = g.engine.state.cards[g.id("node")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("node")), ["character"]);
  assert.equal(g.engine.isResource(g.id("node")), false);
  assert.equal(c.controllerId, P1);
});

clause(NODE, "3:flipUp", "FLIP UP pays 1, not its deploy cost 2: with three ready [E] the node leaves the pool and at most one resource is spent", () => {
  const g = downNodeBoard(E(3));
  assert.equal(ready(g.engine, P1), 4);
  rawFlipUp(g.engine, P1, g.id("node"));
  drain(g.engine, answerAll);
  assert.equal(g.engine.state.cards[g.id("node")].faceDown, false);
  const after = ready(g.engine, P1);
  assert.ok(after === 3 || after === 2, `paid exactly 1 (itself or another), ready ${after}`);
});

clause(NODE, "3:flipUp", "flipping it up does not make other nodes in play leave: a face-down resource leaving play fires nothing (CR 411.3)", () => {
  const g = nodeBoard({
    resources: E(3),
    extra: [{ key: "otherNode", def: NODE_DECOY("Other Node"), owner: P1, zone: "play" }]
  });
  g.engine.state.cards[g.id("node")].faceDown = true;
  rawFlipUp(g.engine, P1, g.id("node"));
  resolvePendingResponses(g.engine);
  drain(g.engine, answerAll);
  assert.equal(g.engine.state.cards[g.id("node")].faceDown, false);
  assert.equal(zoneOf(g.engine, g.id("otherNode")), "play");
});

clause(NODE, "3:flipUp", "the node may pay for its own FLIP UP: itself as the only ready resource plus three spent [E]", () => {
  const g = downNodeBoard(E(3, P1, true));
  assert.equal(ready(g.engine, P1), 1, "the face-down node is the only ready resource");
  rawFlipUp(g.engine, P1, g.id("node"));
  drain(g.engine, answerAll);
  assert.equal(g.engine.state.cards[g.id("node")].faceDown, false);
});

clause(NODE, "3:flipUp", "the threshold [E][E][E] is needed: two [E] and Rage is one icon short, and the node's own icon does not count", () => {
  const two = downNodeBoard([...E(2), ...R(3)]);
  refused(() => rawFlipUp(two.engine, P1, two.id("node")), "only two [E]", /./);
  assert.equal(two.engine.state.cards[two.id("node")].faceDown, true);
  assert.equal(ready(two.engine, P1), 6, "nothing paid");
  const rage = downNodeBoard(R(5));
  refused(() => rawFlipUp(rage.engine, P1, rage.id("node")), "no [E]", /./);
  const oppE = downNodeBoard([...E(3, P2), ...E(2)]);
  refused(() => rawFlipUp(oppE.engine, P1, oppE.id("node")), "the opponent's [E] do not count", /./);
  const three = downNodeBoard([...E(2), ...E(1, P1, true)]);
  rawFlipUp(three.engine, P1, three.id("node"));
  drain(three.engine, answerAll);
  assert.equal(three.engine.state.cards[three.id("node")].faceDown, false, "control: three [E], one of them spent");
});

clause(NODE, "3:flipUp", "FLIP UP costs exactly 1: with the node and all three [E] spent it is refused, and one ready Rage is spent for it", () => {
  const dry = downNodeBoard(E(3, P1, true), { spent: true });
  assert.equal(ready(dry.engine, P1), 0, "nothing is ready");
  refused(() => rawFlipUp(dry.engine, P1, dry.id("node")), "the cost 1 cannot be paid with nothing ready", /./);
  assert.equal(dry.engine.state.cards[dry.id("node")].faceDown, true);
  const one = downNodeBoard([...E(3, P1, true), ...R(1)], { spent: true });
  assert.equal(ready(one.engine, P1), 1);
  rawFlipUp(one.engine, P1, one.id("node"));
  drain(one.engine, answerAll);
  assert.equal(one.engine.state.cards[one.id("node")].faceDown, false, "one ready resource pays the cost");
  assert.equal(ready(one.engine, P1), 0, "exactly 1 was paid");
});

clause(NODE, "3:flipUp", "FLIP UP does not change when a character may be deployed: refused on the opponent's turn", () => {
  const g = downNodeBoard(E(4), { active: P2 });
  refused(() => rawFlipUp(g.engine, P1, g.id("node")), "a character on the opponent's turn", /./);
  assert.equal(g.engine.state.cards[g.id("node")].faceDown, true);
  assert.equal(ready(g.engine, P1), 5, "nothing paid");
});

clause(NODE, "3:flipUp", "flipping it up is entering play, so the search trigger runs again", () => {
  const g = downNodeBoard(E(4));
  rawFlipUp(g.engine, P1, g.id("node"));
  resolvePendingResponses(g.engine);
  assert.equal(searchChoice(g.engine)?.kind, "selectTargets", "a search is offered");
  assert.equal(searchChoice(g.engine)?.playerId, P1);
  pick(g.engine, P1, [g.id("deckNodeA")]);
  assert.equal(zoneOf(g.engine, g.id("deckNodeA")), "hand");
});

// ============================================================================
// Cock Block -- deploy only in response to an ability; terminate it; face-down resource; FLIP UP 4 [E] + discard
// ============================================================================

const ZAPPER = character({
  name: "Zapper",
  strength: 1,
  life: 6,
  speed: 2,
  behavior: {
    abilities: [
      {
        id: "zap",
        type: "activated",
        costs: [{ type: "payResources", amount: 1 }],
        targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
        effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
      },
      { id: "peek", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }
    ]
  }
});
const FOE_IDOL = item({
  name: "Foe Idol",
  behavior: { abilities: [{ id: "pulse", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
});
const FOE_SHRINE = location({
  name: "Foe Shrine",
  structure: 4,
  behavior: { abilities: [{ id: "quake", type: "activated", costs: [], targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] }
});

const ABILITY_FACTION = factionCard({
  id: "seed-saga-06-ability-faction",
  name: "Faction With Ability",
  faction: defaultFactionDefinition({
    startingInfluence: 30,
    abilities: [{ id: "fdraw", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }]
  })
});

function cockBoard(o: { foeFaction?: CardDefinition; resources?: CardPlacement[]; active?: PlayerId; extra?: CardPlacement[]; cockZone?: "hand" | "play" } = {}) {
  const down = o.cockZone === "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: o.foeFaction ?? developFaction() },
    turn: 2,
    activePlayerId: o.active ?? P2,
    random: () => 0.5,
    cards: [
      { key: "cb", def: printing(COCK), owner: P1, zone: down ? "play" : "hand", ...(down ? { faceDown: true } : {}) },
      { key: "mine", def: character({ name: "Mine", life: 8 }), owner: P1, zone: "play" },
      { key: "zapper", def: ZAPPER, owner: P2, zone: "play" },
      { key: "zapper2", def: ZAPPER, owner: P2, zone: "play" },
      { key: "idol", def: FOE_IDOL, owner: P2, zone: "play" },
      { key: "shrine", def: FOE_SHRINE, owner: P2, zone: "play" },
      { key: "myTac", def: killTactic({ name: "My Zapper Tac", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foeTac", def: killTactic({ name: "Foe Tac", cost: 0 }), owner: P2, zone: "hand" },
      { key: "foeChar", def: character({ name: "Foe Newcomer", cost: 0 }), owner: P2, zone: "hand" },
      { key: "h1", def: character({ name: "Hand One" }), owner: P1, zone: "hand" },
      { key: "h2", def: character({ name: "Hand Two" }), owner: P1, zone: "hand" },
      ...fillers("d", 4, P1, "deck"),
      ...fillers("f", 4, P2, "deck"),
      ...(o.resources ?? E(4)),
      ...R(8, P2),
      ...(o.extra ?? [])
    ]
  });
}
type CockGame = ReturnType<typeof cockBoard>;

/** The opponent uses `abilityId` of `cardKey` and holds the response window open for me. */
function foeUses(g: CockGame, cardKey: string, abilityId: string): void {
  const needsTarget = abilityId === "zap" || abilityId === "pulse" || abilityId === "quake";
  actRaw(g.engine, P2, g.id(cardKey), abilityId, needsTarget ? { t: [g.id("mine")] } : {});
  assert.equal(g.engine.state.responseWindow?.priorityPlayerId, P1, "I may respond to the ability");
}

clause(COCK, "0:extraCost", "the printed tactic has no subtype and is a gearsmith tactic", () => {
  assert.deepEqual(printing(COCK).subtype, [], "Cock Block prints no subtype");
  assert.equal(printing(COCK).type, "tactic");
  assert.equal(printing(COCK).trade, "gearsmith");
});

clause(COCK, "0:extraCost", "printed cost 3 / threshold [E] tactic: played in response to an ability with exactly three resources (one [E]); two is one short, no [E] lacks the threshold", () => {
  assert.equal(printing(COCK).trade, "gearsmith");
  assert.equal(printing(COCK).type, "tactic");
  const ok = cockBoard({ resources: [...E(1), ...R(2)] });
  foeUses(ok, "zapper", "zap");
  const before = ready(ok.engine, P1);
  playRaw(ok.engine, P1, ok.id("cb"));
  assert.equal(before - ready(ok.engine, P1), 3, "three resources were paid");
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("cb")), "play");
  const short = cockBoard({ resources: [...E(1), ...R(1)] });
  foeUses(short, "zapper", "zap");
  refused(() => playRaw(short.engine, P1, short.id("cb")), "cost 3, only 2 resources", /./);
  assert.equal(zoneOf(short.engine, short.id("cb")), "hand");
  assert.equal(ready(short.engine, P1), 2, "nothing paid");
  const noE = cockBoard({ resources: R(5) });
  foeUses(noE, "zapper", "zap");
  refused(() => playRaw(noE.engine, P1, noE.id("cb")), "no [E]", /./);
  assert.equal(zoneOf(noE.engine, noE.id("cb")), "hand");
  const spentE = cockBoard({ resources: [...E(1, P1, true), ...R(3)] });
  foeUses(spentE, "zapper", "zap");
  playRaw(spentE.engine, P1, spentE.id("cb"));
  resolvePendingResponses(spentE.engine);
  assert.equal(zoneOf(spentE.engine, spentE.id("cb")), "play", "a spent [E] counts for the threshold, three Rage pay");
});

clause(COCK, "0:extraCost", "it can only be deployed in response to an ability: refused when nothing is happening, in response to a tactic, and in response to a character", () => {
  const idle = cockBoard({ active: P1 });
  const before = ready(idle.engine, P1);
  refused(() => playRaw(idle.engine, P1, idle.id("cb")), "nothing to respond to", /./);
  assert.equal(zoneOf(idle.engine, idle.id("cb")), "hand");
  assert.equal(ready(idle.engine, P1), before, "nothing paid");
  const toTactic = cockBoard();
  playRaw(toTactic.engine, P2, toTactic.id("foeTac"), { selected: { t: [toTactic.id("mine")] } });
  assert.equal(toTactic.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(toTactic.engine, P1, toTactic.id("cb")), "a tactic is not an ability", /./);
  assert.equal(zoneOf(toTactic.engine, toTactic.id("cb")), "hand");
  const toChar = cockBoard();
  playRaw(toChar.engine, P2, toChar.id("foeChar"));
  assert.equal(toChar.engine.state.responseWindow?.priorityPlayerId, P1);
  refused(() => playRaw(toChar.engine, P1, toChar.id("cb")), "a character is not an ability", /./);
  assert.equal(zoneOf(toChar.engine, toChar.id("cb")), "hand");
  const ctl = cockBoard();
  foeUses(ctl, "zapper", "zap");
  playRaw(ctl.engine, P1, ctl.id("cb"));
  resolvePendingResponses(ctl.engine);
  assert.equal(zoneOf(ctl.engine, ctl.id("cb")), "play", "control: the same board with an ability is fine");
});

clause(COCK, "0:extraCost", "'in response to an ability' covers items, locations and factions, not only characters", () => {
  for (const [key, abilityId] of [["idol", "pulse"], ["shrine", "quake"]] as const) {
    const g = cockBoard();
    foeUses(g, key, abilityId);
    playRaw(g.engine, P1, g.id("cb"));
    resolvePendingResponses(g.engine);
    assert.equal(zoneOf(g.engine, g.id("cb")), "play", key);
    assert.equal(damageOf(g.engine, g.id("mine")), 0, `${key}'s ability was terminated`);
  }
  const f = cockBoard({ foeFaction: ABILITY_FACTION });
  const foeHand = handOf(f.engine, P2).length;
  actRaw(f.engine, P2, factionOf(f.engine, P2), "fdraw");
  assert.equal(f.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(f.engine, P1, f.id("cb"));
  resolvePendingResponses(f.engine);
  assert.equal(zoneOf(f.engine, f.id("cb")), "play", "answers a faction's ability");
  assert.equal(handOf(f.engine, P2).length, foeHand, "the faction's draw was terminated");
});

clause(COCK, "0:extraCost", "I cannot respond to my own ability with it (CR 607.1)", () => {
  const g = cockBoard({ active: P1, extra: [{ key: "myZapper", def: ZAPPER, owner: P1, zone: "play" }] });
  actRaw(g.engine, P1, g.id("myZapper"), "peek");
  refused(() => playRaw(g.engine, P1, g.id("cb")), "can't respond to my own action", /./);
  assert.equal(zoneOf(g.engine, g.id("cb")), "hand");
});

clause(COCK, "1:rule", "terminates the ability it answers: the opponent's zap deals no damage, though its cost stays paid", () => {
  const g = cockBoard();
  const foeReady = ready(g.engine, P2);
  foeUses(g, "zapper", "zap");
  playRaw(g.engine, P1, g.id("cb"));
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "terminated: no damage");
  assert.equal(ready(g.engine, P2), foeReady - 1, "the ability's cost was already paid");
});

clause(COCK, "1:rule", "control: without it the same zap does 2 damage", () => {
  const g = cockBoard();
  foeUses(g, "zapper", "zap");
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 2);
});

clause(COCK, "1:rule", "it ends up in play under its owner's control as a face-down resource, NOT in the discard pile", () => {
  const g = cockBoard();
  const discardBefore = [...g.engine.state.players[P1].discard];
  const before = ready(g.engine, P1);
  foeUses(g, "zapper", "zap");
  playRaw(g.engine, P1, g.id("cb"));
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("cb")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.ownerId, P1);
  assert.equal(c.controllerId, P1);
  assert.equal(g.engine.isResource(g.id("cb")), true);
  assert.deepEqual(g.engine.state.players[P1].discard, discardBefore, "not in the discard pile");
  assert.equal(ready(g.engine, P1), before - 3 + 1, "paid 3, gained one face-down resource");
});

clause(COCK, "1:rule", "only the answered ability is terminated: a second ability used by the opponent afterwards still resolves", () => {
  const g = cockBoard();
  foeUses(g, "zapper", "zap");
  playRaw(g.engine, P1, g.id("cb"));
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 0);
  activate(g.engine, P2, g.id("zapper"), "zap", { selected: { t: [g.id("mine")] } });
  assert.equal(damageOf(g.engine, g.id("mine")), 2, "the same card's ability can be used again and works");
  activate(g.engine, P2, g.id("zapper2"), "zap", { selected: { t: [g.id("mine")] } });
  assert.equal(damageOf(g.engine, g.id("mine")), 4);
});

clause(COCK, "1:rule", "terminates only the ability it answers: an earlier action lower in the chain still resolves", () => {
  const g = cockBoard({ active: P1, extra: [{ key: "myNoop", def: killTactic({ name: "My Kill", cost: 0 }), owner: P1, zone: "hand" }] });
  playRaw(g.engine, P1, g.id("myNoop"), { selected: { t: [g.id("zapper2")] } });
  actRaw(g.engine, P2, g.id("zapper"), "zap", { t: [g.id("mine")] });
  playRaw(g.engine, P1, g.id("cb"));
  resolvePendingResponses(g.engine);
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "the zap was terminated");
  assert.equal(zoneOf(g.engine, g.id("zapper2")), "discard", "my own tactic resolved as normal");
});

clause(COCK, "1:rule", "a Cock Block that answers a draw ability stops the draw", () => {
  const g = cockBoard();
  const handBefore = handOf(g.engine, P2).length;
  foeUses(g, "zapper", "peek");
  playRaw(g.engine, P1, g.id("cb"));
  resolvePendingResponses(g.engine);
  assert.equal(handOf(g.engine, P2).length, handBefore, "nothing drawn");
  assert.equal(zoneOf(g.engine, g.id("cb")), "play");
});

// -- FLIP UP: 4 [E] and discard a card ------------------------------------

clause(COCK, "2:flipUp", "a face-down Cock Block flips up for 4 with [E], discarding a card of my choice, and terminates the ability it answers", () => {
  const g = cockBoard({ cockZone: "play", resources: [...E(1), ...R(4)] });
  foeUses(g, "zapper", "zap");
  const handBefore = handOf(g.engine, P1);
  rawFlipUp(g.engine, P1, g.id("cb"));
  const pc = pending(g.engine);
  assert.equal(pc?.kind, "chooserSelectsTarget", "a discard is asked for");
  assert.equal(pc?.playerId, P1);
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h2")] });
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("h2")), "discard", "the chosen card is discarded");
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand", "only one card is discarded");
  assert.equal(handOf(g.engine, P1).length, handBefore.length - 1);
  assert.equal(damageOf(g.engine, g.id("mine")), 0, "the zap was terminated");
});

clause(COCK, "2:flipUp", "FLIP UP costs exactly 4: three other resources plus the Cock Block paying itself is enough, and with only the Block + two others it is refused", () => {
  const ok = cockBoard({ cockZone: "play", resources: [...E(1), ...R(2)] });
  foeUses(ok, "zapper", "zap");
  rawFlipUp(ok.engine, P1, ok.id("cb"));
  answerPending(ok.engine, "chooserSelectsTarget", { selected: [ok.id("h1")] });
  resolvePendingResponses(ok.engine);
  assert.equal(zoneOf(ok.engine, ok.id("h1")), "discard", "3 other resources + itself = 4");
  const short = cockBoard({ cockZone: "play", resources: [...E(1), ...R(1)] });
  foeUses(short, "zapper", "zap");
  refused(() => rawFlipUp(short.engine, P1, short.id("cb")), "2 others + itself = 3 < 4", /./);
  assert.equal(short.engine.state.cards[short.id("cb")].faceDown, true);
  assert.equal(zoneOf(short.engine, short.id("h1")), "hand", "nothing discarded");
  assert.equal(ready(short.engine, P1), 3, "nothing paid");
});

clause(COCK, "2:flipUp", "the threshold [E] must be met by another resource: four Rage is one icon short, the Block's own Volition is not [E]", () => {
  const g = cockBoard({ cockZone: "play", resources: R(6) });
  foeUses(g, "zapper", "zap");
  refused(() => rawFlipUp(g.engine, P1, g.id("cb")), "no [E]", /./);
  assert.equal(g.engine.state.cards[g.id("cb")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand");
  assert.equal(ready(g.engine, P1), 7, "nothing paid");
  const spent = cockBoard({ cockZone: "play", resources: [...E(1, P1, true), ...R(4)] });
  foeUses(spent, "zapper", "zap");
  rawFlipUp(spent.engine, P1, spent.id("cb"));
  answerPending(spent.engine, "chooserSelectsTarget", { selected: [spent.id("h1")] });
  resolvePendingResponses(spent.engine);
  assert.equal(zoneOf(spent.engine, spent.id("h1")), "discard", "control: a spent [E] satisfies the threshold");
});

clause(COCK, "2:flipUp", "'and discard a card' is a cost: with an empty hand the FLIP UP is refused and nothing is paid", () => {
  const g = cockBoard({ cockZone: "play", resources: [...E(1), ...R(4)] });
  for (const key of ["h1", "h2", "myTac"]) g.engine.state.cards[g.id(key)].zone = "void" as never;
  g.engine.state.players[P1].hand = [];
  foeUses(g, "zapper", "zap");
  refused(() => rawFlipUp(g.engine, P1, g.id("cb")), "nothing to discard", /./);
  assert.equal(g.engine.state.cards[g.id("cb")].faceDown, true);
  assert.equal(ready(g.engine, P1), 6, "nothing paid");
});

clause(COCK, "2:flipUp", "FLIP UP is still the tactic: it answers an ability only, so on my own idle turn it is refused and nothing is paid or discarded", () => {
  const g = cockBoard({ active: P1, cockZone: "play", resources: [...E(1), ...R(4)] });
  refused(() => rawFlipUp(g.engine, P1, g.id("cb")), "no ability to respond to", /./);
  assert.equal(g.engine.state.cards[g.id("cb")].faceDown, true);
  assert.equal(zoneOf(g.engine, g.id("h1")), "hand");
  assert.equal(ready(g.engine, P1), 6);
});

clause(COCK, "2:flipUp", "after a FLIP UP the Block is put into play face-down as a resource again, not in the discard pile", () => {
  const g = cockBoard({ cockZone: "play", resources: [...E(1), ...R(4)] });
  foeUses(g, "zapper", "zap");
  rawFlipUp(g.engine, P1, g.id("cb"));
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("h1")] });
  resolvePendingResponses(g.engine);
  const c = g.engine.state.cards[g.id("cb")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, true);
  assert.equal(c.controllerId, P1);
  assert.ok(!g.engine.state.players[P1].discard.includes(g.id("cb")), "!g.engine.state.players[P1].discard.includes(g.id(\"cb\"))");
});
