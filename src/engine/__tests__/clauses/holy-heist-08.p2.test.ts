// Clause tests — batch holy-heist-08, part p2 (groups 5-10: Infectious Pustulio, Keep Pushing,
// Leaping Sarume, Lingamite Descendant, Overly Eager Exemplar, Phantasmagoric Tollbooth).
// Expectations come from the PRINTED text and RULES.md; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  play,
  resolvePendingResponses,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle, playRaw } from "./_battle.js";
import { declareBlockers, pending, readyResources, zoneOf } from "./_board.js";

type Placement = Parameters<typeof buildGame>[0] extends infer O ? (O extends { cards?: infer C } ? (C extends readonly (infer E)[] ? E : never) : never) : never;
type Pc = { kind: string; playerId: string; [k: string]: unknown };

const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
/** A faction takes damage as lost influence; every board that checks this starts both players at 20. */
const START = 20;
const factionDamage = (engine: SpoilsEngine, p: PlayerId): number => START - (engine.state.players[p].influence as number);
const resourcesOf = (engine: SpoilsEngine, p: PlayerId): CardInstanceId[] =>
  Object.values(engine.state.cards)
    .filter((c) => c.controllerId === p && c.zone === "play" && engine.getDefinition(c.id).type === "resource")
    .map((c) => c.id);
/** `n` resources of `icon` for `owner`, already attached to (spent on) their faction. */
const spent = (icon: "rage" | "greed", n: number, owner: PlayerId): Placement[] =>
  bank(icon, n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
/** Resolves a pending `mayPay` with `pay`. */
function answerMayPay(engine: SpoilsEngine, pay: boolean) {
  const pc = pending(engine) as unknown as Pc;
  assert.equal(pc?.kind, "mayPay", "a 'you may pay' choice is open");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "mayPay", pay } } as never);
  resolvePendingResponses(engine);
}

// =====================================================================================
// Infectious Pustulio — tactic (mutation), cost 3, threshold [R][R]
// ATTACH TO CHARACTER -- EXTRA COST: Deploy this only not during a battle. -- When the attached character is
// blocked, inflict 1 damage to each member of the blocking party.
// =====================================================================================

const PUST = "d8bbaab9-b156-48c4-abb7-967d8fdfb82b";

function pustBoard(extra: Placement[] = [], o: { rage?: number; active?: PlayerId; pust?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pu", def: printing(PUST), owner: o.pust ?? P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 8, speed: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...bank("rage", o.rage ?? 3, o.pust ?? P1),
      ...extra
    ],
    activePlayerId: o.active ?? P1,
    turn: 2
  });
}
const attached = (engine: SpoilsEngine, cardId: CardInstanceId) => (engine.state.cards[cardId] as unknown as { attachedTo?: string }).attachedTo;

clause(PUST, "0:attach", "it can be played onto a character: it enters play attached to that character (not into the discard pile), cost 3 paid", () => {
  const { engine, id } = pustBoard();
  const before = readyResources(engine, P1);
  play(engine, P1, id("pu"), { selected: { attachTo: [id("atk")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("pu")), "play", "put into play instead of its owner's discard pile");
  assert.equal(attached(engine, id("pu")), id("atk"), "attached to that character");
  assert.equal(before - readyResources(engine, P1), 3, "printed cost 3 paid");
});

clause(PUST, "0:attach", "the host may be any character, including an opponent's", () => {
  const { engine, id } = pustBoard();
  play(engine, P1, id("pu"), { selected: { attachTo: [id("foe")] } });
  assert.equal(zoneOf(engine, id("pu")), "play");
  assert.equal(attached(engine, id("pu")), id("foe"));
});

clause(PUST, "0:attach", "a non-character host (an item, a faction) is refused", () => {
  const { engine, id } = pustBoard();
  refused(() => play(engine, P1, id("pu"), { selected: { attachTo: [id("gear")] } }), "an item is not a character");
  refused(() => play(engine, P1, id("pu"), { selected: { attachTo: [engine.state.players[P2].factionId as CardInstanceId] } }), "a faction is not a character");
  assert.equal(zoneOf(engine, id("pu")), "hand");
  play(engine, P1, id("pu"), { selected: { attachTo: [id("atk")] } });
  assert.equal(zoneOf(engine, id("pu")), "play", "control: a character host works");
});

clause(PUST, "0:attach", "it cannot be played without picking a host", () => {
  const { engine, id } = pustBoard();
  refused(() => play(engine, P1, id("pu"), {}), "no host picked");
  assert.equal(zoneOf(engine, id("pu")), "hand");
});

clause(PUST, "0:attach", "when the host leaves play the attached card goes to its owner's discard pile (CR 507.2c)", () => {
  const { engine, id } = pustBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }]);
  play(engine, P1, id("pu"), { selected: { attachTo: [id("atk")] } });
  play(engine, P1, id("kill"), { selected: { t: [id("atk")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("atk")), "discard");
  assert.equal(zoneOf(engine, id("pu")), "discard", "attached card follows its host out of play");
});

clause(PUST, "1:extraCost", "it can be deployed when no battle is going on", () => {
  const { engine, id } = pustBoard();
  assert.equal(engine.state.battle, undefined);
  play(engine, P1, id("pu"), { selected: { attachTo: [id("atk")] } });
  assert.equal(zoneOf(engine, id("pu")), "play");
});

clause(PUST, "1:extraCost", "it cannot be deployed during a battle (the opponent attacks and P1 responds in the window; an ordinary tactic can)", () => {
  const a = pustBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }], { active: P2 });
  declareAttackOpenWindow(a.engine, P2, [a.id("foe")]);
  assert.ok(a.engine.state.battle, "a battle is under way");
  refused(() => play(a.engine, P1, a.id("pu"), { selected: { attachTo: [a.id("atk")] } }), "during a battle", /cannot be deployed/);
  assert.equal(zoneOf(a.engine, a.id("pu")), "hand");
  play(a.engine, P1, a.id("kill"), { selected: { t: [a.id("foe")] } });
  assert.equal(zoneOf(a.engine, a.id("kill")), "discard", "control: a different tactic IS deployable in this very window, so the battle is what refuses Pustulio");
});

clause(PUST, "1:extraCost", "once the battle is over it can be deployed again", () => {
  const { engine, id } = pustBoard();
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, []);
  assert.equal(engine.state.battle, undefined);
  play(engine, P1, id("pu"), { selected: { attachTo: [id("foe")] } });
  assert.equal(zoneOf(engine, id("pu")), "play");
});

clause(PUST, "1:extraCost", "the printed cost 3 and [R][R] threshold are required", () => {
  const poor = pustBoard([], { rage: 2 });
  refused(() => play(poor.engine, P1, poor.id("pu"), { selected: { attachTo: [poor.id("atk")] } }), "only 2 resources for cost 3");
  assert.equal(zoneOf(poor.engine, poor.id("pu")), "hand");
  const off = pustBoard([...bank("greed", 3, P1)], { rage: 1 });
  refused(() => play(off.engine, P1, off.id("pu"), { selected: { attachTo: [off.id("atk")] } }), "one [R] is short of [R][R]", /threshold/i);
  assert.equal(zoneOf(off.engine, off.id("pu")), "hand");
});

function blockedBoard(o: { host?: "atk" | "foe"; blockers?: number } = {}) {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P1, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 8, speed: 3 }), owner: P1, zone: "play" },
      { key: "pu", def: printing(PUST), owner: P1, zone: "play", attachedToKey: o.host ?? "atk" },
      { key: "b1", def: character({ name: "B1", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "b3", def: character({ name: "B3", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 0, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ],
    turn: 2
  });
  return b;
}

clause(PUST, "2:rule", "when the attached attacker is blocked by a party of two, each member takes 1 damage (non-blockers and the attacker take none)", () => {
  const { engine, id } = blockedBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, [id("b1"), id("b2")]);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("b1")), 1);
  assert.equal(damageOf(engine, id("b2")), 1);
  assert.equal(damageOf(engine, id("idle")), 0, "an opposing character that did not block");
  assert.equal(damageOf(engine, id("atk")), 0);
});

clause(PUST, "2:rule", "a single blocker takes exactly 1 damage", () => {
  const { engine, id } = blockedBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, [id("b1")]);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("b1")), 1);
  assert.equal(damageOf(engine, id("b2")), 0);
});

clause(PUST, "2:rule", "it does not fire when the attached character is not blocked", () => {
  const { engine, id } = blockedBoard();
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, []);
  resolvePendingResponses(engine);
  for (const k of ["b1", "b2", "b3", "idle"]) assert.equal(damageOf(engine, id(k)), 0, k);
});

clause(PUST, "2:rule", "it does not fire when a different attacker is blocked", () => {
  const { engine, id } = blockedBoard();
  declareAttackBy(engine, P1, [id("atk2")]);
  declareBlockers(engine, P2, [id("b1")]);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("b1")), 0);
});

clause(PUST, "2:rule", "when the host attacks in a party and is blocked, the blocking party takes 1 each (once)", () => {
  const { engine, id } = blockedBoard();
  declareAttackBy(engine, P1, [id("atk"), id("atk2")]);
  declareBlockers(engine, P2, [id("b1"), id("b2")]);
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("b1")), 1);
  assert.equal(damageOf(engine, id("b2")), 1);
  assert.equal(damageOf(engine, id("b3")), 0);
});

clause(PUST, "2:rule", "it works on an opponent's host: the attached character's being blocked hurts the blockers", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 8, speed: 3 }), owner: P2, zone: "play" },
      { key: "pu", def: printing(PUST), owner: P1, zone: "play", attachedToKey: "foe" },
      { key: "m1", def: character({ name: "M1", strength: 0, life: 5, speed: 1 }), owner: P1, zone: "play" }
    ],
    activePlayerId: P2,
    turn: 2
  });
  declareAttackBy(b.engine, P2, [b.id("foe")]);
  declareBlockers(b.engine, P1, [b.id("m1")]);
  resolvePendingResponses(b.engine);
  assert.equal(damageOf(b.engine, b.id("m1")), 1);
});

// =====================================================================================
// Keep Pushing — tactic, cost 1, threshold [R][R][R][R][R]
// EXTRA COST: Deploy this only not during a battle. Destroy a resource you control. Pick a character with 3
// strength or less. -- Restore that character. Draw a card.
// =====================================================================================

const PUSH = "742847e8-f11d-4f8c-9fba-e5e891d6f308";

function pushBoard(extra: Placement[] = [], o: { rage?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "kp", def: printing(PUSH), owner: P1, zone: "hand" },
      { key: "small", def: character({ name: "Small", strength: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "edge", def: character({ name: "Edge", strength: 3 }), owner: P1, zone: "play", depleted: true },
      { key: "zero", def: character({ name: "Zero", strength: 0 }), owner: P1, zone: "play", depleted: true },
      { key: "big", def: character({ name: "Big", strength: 4 }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe", strength: 3 }), owner: P2, zone: "play", depleted: true },
      { key: "foebig", def: character({ name: "FoeBig", strength: 5 }), owner: P2, zone: "play", depleted: true },
      { key: "bystander", def: character({ name: "Bystander", strength: 1 }), owner: P1, zone: "play", depleted: true },
      { key: "d1", def: character({ name: "D1" }), owner: P1, zone: "deck" },
      { key: "d2", def: character({ name: "D2" }), owner: P1, zone: "deck" },
      { key: "e1", def: character({ name: "E1" }), owner: P2, zone: "deck" },
      ...bank("rage", o.rage ?? 6, P1),
      ...extra
    ],
    activePlayerId: o.active ?? P1,
    turn: 1
  });
}
const pushPlay = (b: ReturnType<typeof pushBoard>, target: string, res?: CardInstanceId) =>
  play(b.engine, P1, b.id("kp"), { selected: { res: [res ?? resourcesOf(b.engine, P1)[0]], c: [b.id(target)] } });

clause(PUSH, "0:extraCost", "the resource is destroyed (to the discard pile) and the printed cost 1 is paid as well", () => {
  const b = pushBoard();
  const res = resourcesOf(b.engine, P1);
  assert.equal(res.length, 6);
  const readyBefore = readyResources(b.engine, P1);
  pushPlay(b, "small", res[5]);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, res[5]), "discard", "the picked resource is destroyed");
  assert.equal(resourcesOf(b.engine, P1).length, 5);
  assert.equal(readyBefore - readyResources(b.engine, P1), 2, "1 paid for the cost + 1 resource destroyed");
  assert.equal(zoneOf(b.engine, b.id("kp")), "discard", "the tactic is spent");
});

clause(PUSH, "0:extraCost", "the resource must be one you control: an opponent's resource is refused", () => {
  const b = pushBoard([...bank("rage", 1, P2)]);
  const theirs = resourcesOf(b.engine, P2)[0];
  refused(() => pushPlay(b, "small", theirs), "an opponent's resource");
  assert.equal(zoneOf(b.engine, theirs), "play");
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
  pushPlay(b, "small");
  assert.equal(zoneOf(b.engine, b.id("kp")), "discard", "control: own resource works");
});

clause(PUSH, "0:extraCost", "a destroyed resource must actually be picked (a non-resource card is refused)", () => {
  const b = pushBoard();
  refused(() => pushPlay(b, "small", b.id("bystander")), "a character is not a resource");
  assert.equal(zoneOf(b.engine, b.id("bystander")), "play");
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
});

clause(PUSH, "0:extraCost", "characters with 3 strength or less can be picked (0, 2, 3; either player's)", () => {
  for (const k of ["zero", "small", "edge", "foe"]) {
    const b = pushBoard();
    pushPlay(b, k);
    assert.equal(pending(b.engine), undefined, k);
    assert.equal(b.engine.state.cards[b.id(k)].depleted, false, `${k} restored`);
  }
});

clause(PUSH, "0:extraCost", "characters with more than 3 strength (yours or theirs) are refused", () => {
  const b = pushBoard();
  refused(() => pushPlay(b, "big"), "4 strength, own");
  refused(() => pushPlay(b, "foebig"), "5 strength, opponent's");
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
  assert.equal(resourcesOf(b.engine, P1).length, 6, "nothing was destroyed");
  pushPlay(b, "edge");
  assert.equal(zoneOf(b.engine, b.id("kp")), "discard", "control: 3 strength works");
});

clause(PUSH, "0:extraCost", "strength is the current strength: a printed-2 character pumped to 4 is refused", () => {
  const b = pushBoard([
    { key: "pumped", def: character({ name: "Pumped", strength: 2, behavior: { abilities: [{ id: "bulk", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: 2 }] }] } as never }), owner: P1, zone: "play", depleted: true },
    { key: "shrunk", def: character({ name: "Shrunk", strength: 5, behavior: { abilities: [{ id: "weak", type: "continuous", modifiers: [{ target: "source", stat: "strength", operation: "add", value: -2 }] }] } as never }), owner: P1, zone: "play", depleted: true }
  ]);
  assert.equal(b.engine.getStat(b.id("pumped"), "strength"), 4, "setup: printed 2, current 4");
  assert.equal(b.engine.getStat(b.id("shrunk"), "strength"), 3, "setup: printed 5, current 3");
  refused(() => pushPlay(b, "pumped"), "current strength 4");
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
  pushPlay(b, "shrunk");
  assert.equal(b.engine.state.cards[b.id("shrunk")].depleted, false, "current strength 3 is legal");
});

clause(PUSH, "0:extraCost", "it cannot be deployed during a battle (the opponent attacks; an ordinary tactic is deployable in that window)", () => {
  const b = pushBoard([
    { key: "atk", def: character({ name: "Atk", strength: 1, life: 8, speed: 3 }), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ], { active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  refused(() => pushPlay(b, "small"), "during a battle", /cannot be deployed/);
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
  assert.equal(resourcesOf(b.engine, P1).length, 6, "nothing destroyed");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("atk")] } });
  assert.equal(zoneOf(b.engine, b.id("kill")), "discard", "control: another tactic is deployable in this window");
});

clause(PUSH, "0:extraCost", "the printed cost 1 is required: with every resource already spent it is refused (threshold alone is not enough)", () => {
  const s = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "kp", def: printing(PUSH), owner: P1, zone: "hand" },
      { key: "small", def: character({ name: "Small", strength: 2 }), owner: P1, zone: "play", depleted: true },
      ...spent("rage", 5, P1)
    ]
  });
  assert.equal(readyResources(s.engine, P1), 0);
  refused(() => play(s.engine, P1, s.id("kp"), { selected: { res: [resourcesOf(s.engine, P1)[0]], c: [s.id("small")] } }), "no resource left to pay 1");
  assert.equal(zoneOf(s.engine, s.id("kp")), "hand");
});

clause(PUSH, "0:extraCost", "the [R][R][R][R][R] threshold is required: four [R] plus other icons is refused", () => {
  const b = pushBoard([...bank("greed", 3, P1)], { rage: 4 });
  refused(() => pushPlay(b, "small"), "only four [R]", /threshold/i);
  assert.equal(zoneOf(b.engine, b.id("kp")), "hand");
  const ok = pushBoard([], { rage: 5 });
  pushPlay(ok, "small");
  assert.equal(zoneOf(ok.engine, ok.id("kp")), "discard", "control: five [R] works");
});

clause(PUSH, "1:rule", "the picked character is restored (readied) and others are left alone", () => {
  const b = pushBoard();
  pushPlay(b, "small");
  assert.equal(b.engine.state.cards[b.id("small")].depleted, false, "restored");
  for (const k of ["edge", "zero", "big", "foe", "bystander"]) assert.equal(b.engine.state.cards[b.id(k)].depleted, true, `${k} still depleted`);
});

clause(PUSH, "1:rule", "an opponent's depleted character can be restored", () => {
  const b = pushBoard();
  pushPlay(b, "foe");
  assert.equal(b.engine.state.cards[b.id("foe")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("small")].depleted, true);
});

clause(PUSH, "1:rule", "you draw a card (the top of your deck, exactly one; the opponent draws none)", () => {
  const b = pushBoard();
  const top = b.engine.state.players[P1].deck[0];
  const handBefore = b.engine.state.players[P1].hand.length;
  const deckBefore = b.engine.state.players[P1].deck.length;
  const oppHand = b.engine.state.players[P2].hand.length;
  pushPlay(b, "small");
  // kp left the hand (-1), one card drawn (+1)
  assert.equal(b.engine.state.players[P1].hand.length, handBefore - 1 + 1);
  assert.equal(b.engine.state.players[P1].deck.length, deckBefore - 1);
  assert.equal(zoneOf(b.engine, top), "hand", "the top card is the one drawn");
  assert.equal(b.engine.state.players[P2].hand.length, oppHand);
});

// =====================================================================================
// Leaping Sarume — character (dragon), cost 4, threshold [R][R][R], 3 str / 3 spd / 2 life
// TACTICAL -- EXTRA COST: Deploy this only not during a battle. -- When this card enters play, inflict 1 damage
// to all characters. -- [R]x6: When this card enters play, inflict 1 damage to all your opponent's characters.
// =====================================================================================

const SARU = "3a90b12f-8ecf-42eb-b67b-9b1c5abf0ddf";

function saruBoard(extra: Placement[] = [], o: { rage?: number; active?: PlayerId; turn?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: START },
    playerB: { faction: developFaction(), influence: START },
    cards: [
      { key: "sa", def: printing(SARU), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", life: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear", structure: 5 } as never), owner: P2, zone: "play" },
      ...bank("rage", o.rage ?? 4, P1),
      ...extra
    ],
    activePlayerId: o.active ?? P1,
    turn: o.turn ?? 1
  });
}

clause(SARU, "0:kw:TACTICAL", "the card has TACTICAL (a plain character does not)", () => {
  const { engine, id } = saruBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }]);
  assert.ok(engine.getKeywords(id("sa")).includes("tactical"), "engine.getKeywords(id(\"sa\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false);
});

/** P2 (active) plays a tactic that stays on the stack, so P1 is inside a response window with no battle. */
function saruWindow(o: { rage?: number } = {}) {
  const b = saruBoard([{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }, { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }], { active: P2, turn: 2, rage: o.rage });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("theirs")] } });
  return b;
}

clause(SARU, "0:kw:TACTICAL", "it can be deployed on the opponent's turn inside a response window (no battle), at its printed cost 4", () => {
  const b = saruWindow();
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("sa"));
  assert.equal(zoneOf(b.engine, b.id("sa")), "play");
  assert.equal(before - readyResources(b.engine, P1), 4, "cost 4 paid");
});

clause(SARU, "0:kw:TACTICAL", "an ordinary character cannot be deployed in that window, nor can the TACTICAL one on the opponent's turn with no window", () => {
  const b = saruWindow();
  refused(() => play(b.engine, P1, b.id("plain")), "a non-tactical character in the opponent's window");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  const none = saruBoard([], { active: P2, turn: 2 });
  refused(() => play(none.engine, P1, none.id("sa")), "no window open on the opponent's turn");
  assert.equal(zoneOf(none.engine, none.id("sa")), "hand");
});

clause(SARU, "0:kw:TACTICAL", "TACTICAL does not waive the [R][R][R] threshold", () => {
  const w = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "sa", def: printing(SARU), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 2, P1),
      ...bank("greed", 4, P1)
    ],
    activePlayerId: P2,
    turn: 2
  });
  playRaw(w.engine, P2, w.id("kill"), { selected: { t: [w.id("theirs")] } });
  refused(() => play(w.engine, P1, w.id("sa")), "two [R] is short of [R][R][R]", /threshold/i);
  assert.equal(zoneOf(w.engine, w.id("sa")), "hand");
});

clause(SARU, "1:extraCost", "it can be deployed in your main phase when no battle is going on, cost 4 paid", () => {
  const { engine, id } = saruBoard();
  const before = readyResources(engine, P1);
  play(engine, P1, id("sa"));
  assert.equal(zoneOf(engine, id("sa")), "play");
  assert.equal(before - readyResources(engine, P1), 4);
});

clause(SARU, "1:extraCost", "it cannot be deployed during a battle even though it is TACTICAL (an ordinary tactic can in that window)", () => {
  const b = saruBoard([
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 8, speed: 3 }), owner: P2, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
  ], { active: P2, turn: 2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("foe")]);
  assert.ok(b.engine.state.battle, "b.engine.state.battle");
  refused(() => play(b.engine, P1, b.id("sa")), "during a battle", /cannot be deployed/);
  assert.equal(zoneOf(b.engine, b.id("sa")), "hand");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("kill")), "discard", "control: a tactic IS deployable in this window");
});

clause(SARU, "1:extraCost", "the printed cost 4 is required (three resources is refused)", () => {
  const { engine, id } = saruBoard([], { rage: 3 });
  refused(() => play(engine, P1, id("sa")), "three resources for cost 4");
  assert.equal(zoneOf(engine, id("sa")), "hand");
});

clause(SARU, "2:rule", "entering play inflicts 1 damage to ALL characters: yours, theirs, and Leaping Sarume itself", () => {
  const { engine, id } = saruBoard();
  play(engine, P1, id("sa"));
  drain(engine, declineAll);
  assert.equal(damageOf(engine, id("mine")), 1, "your character");
  assert.equal(damageOf(engine, id("theirs")), 1, "an opposing character");
  assert.equal(damageOf(engine, id("weak")), 1);
  assert.equal(damageOf(engine, id("sa")), 1, "itself, a character in play when the trigger resolves");
});

clause(SARU, "2:rule", "only characters are hurt: an item and the factions take no damage", () => {
  const { engine, id } = saruBoard();
  play(engine, P1, id("sa"));
  drain(engine, declineAll);
  assert.equal(damageOf(engine, id("gear")), 0);
  assert.equal(factionDamage(engine, P1), 0);
  assert.equal(factionDamage(engine, P2), 0);
});

clause(SARU, "2:rule", "damage is real: a 1-life character is destroyed", () => {
  const { engine, id } = saruBoard([{ key: "frail", def: character({ name: "Frail", life: 1 }), owner: P2, zone: "play" }]);
  play(engine, P1, id("sa"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("frail")), "discard");
  assert.equal(zoneOf(engine, id("theirs")), "play");
});

clause(SARU, "2:rule", "it fires only when THIS card enters play: another character entering later deals no damage", () => {
  // Leaping Sarume is already in play (placed, not entered); a different character is deployed.
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "sa", def: printing(SARU), owner: P1, zone: "play" },
      { key: "pl", def: character({ name: "Pl", cost: 0 }), owner: P1, zone: "hand" },
      { key: "theirs", def: character({ name: "Theirs", life: 5 }), owner: P2, zone: "play" },
      ...bank("rage", 6, P1)
    ]
  });
  play(b.engine, P1, b.id("pl"));
  drain(b.engine, declineAll);
  assert.equal(zoneOf(b.engine, b.id("pl")), "play");
  assert.equal(pending(b.engine), undefined);
  assert.equal(damageOf(b.engine, b.id("theirs")), 0);
  assert.equal(damageOf(b.engine, b.id("sa")), 0);
  assert.equal(damageOf(b.engine, b.id("pl")), 0);
});

clause(SARU, "3:rule@rrrrrr", "with six [R] it also inflicts 1 more damage to all your opponent's characters (total 2 to theirs, 1 to yours and to itself)", () => {
  const { engine, id } = saruBoard([], { rage: 6 });
  play(engine, P1, id("sa"));
  drain(engine, declineAll);
  assert.equal(damageOf(engine, id("theirs")), 2, "all-characters damage + opponent damage");
  assert.equal(zoneOf(engine, id("weak")), "discard", "a 2-life opposing character dies to the two instances");
  assert.equal(damageOf(engine, id("mine")), 1, "yours: only the all-characters damage");
  assert.equal(damageOf(engine, id("sa")), 1, "itself: only the all-characters damage");
  assert.equal(damageOf(engine, id("gear")), 0, "an item is not a character");
});

clause(SARU, "3:rule@rrrrrr", "with five [R] (and other icons) the extra damage does not happen", () => {
  const { engine, id } = saruBoard([...bank("greed", 3, P1)], { rage: 5 });
  play(engine, P1, id("sa"));
  drain(engine, declineAll);
  assert.equal(damageOf(engine, id("theirs")), 1);
  assert.equal(zoneOf(engine, id("weak")), "play");
  assert.equal(damageOf(engine, id("mine")), 1);
});

// =====================================================================================
// Lingamite Descendant — character (soldier), cost 3, threshold [R], 2 str / 4 spd / 1 life
// When battle damage is inflicted to this card while it's attacking, reduce the amount to 0.
// =====================================================================================

const LING = "15670fc7-d664-47a4-8b52-6d4945e48efc";

function lingBoard(extra: Placement[] = []) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ld", def: printing(LING), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "ping", def: tactic({ name: "Ping", cost: 0, behavior: { abilities: [{ id: "p", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 1 }] }] } as never }), owner: P2, zone: "hand" },
      ...extra
    ],
    turn: 2
  });
}

clause(LING, "0:rule", "battle damage to it while it attacks (blocked by a 5-strength creature) is reduced to 0: no damage, it survives", () => {
  const { engine, id } = lingBoard();
  fightThrough(engine, P1, [id("ld")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(damageOf(engine, id("ld")), 0);
  assert.equal(zoneOf(engine, id("ld")), "play");
});

clause(LING, "0:rule", "it still deals its own battle damage while attacking (the reduction is only to damage inflicted TO it)", () => {
  const { engine, id } = lingBoard();
  fightThrough(engine, P1, [id("ld")], { type: "faction", playerId: P2 }, [id("blk")]);
  assert.equal(damageOf(engine, id("blk")), 2, "2 strength dealt to the blocker");
});

clause(LING, "0:rule", "battle damage to it while it is BLOCKING is not reduced (it is not attacking)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ld", def: printing(LING), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ],
    activePlayerId: P2,
    turn: 2
  });
  fightThrough(b.engine, P2, [b.id("atk")], { type: "faction", playerId: P1 }, [b.id("ld")]);
  assert.equal(zoneOf(b.engine, b.id("ld")), "discard", "1 life takes 5 as a blocker and dies");
});

clause(LING, "0:rule", "other members of the attacking party are not protected: of 5 damage, 2 assigned to it is voided and 3 assigned to its ally lands", () => {
  const { engine, id } = lingBoard();
  fightThrough(engine, P1, [id("ld"), id("mate")], { type: "faction", playerId: P2 }, [id("blk")], (source) => {
    const s = source as unknown as { cardId: string; strength: number };
    if (s.cardId !== id("blk")) {
      const legal = (source as unknown as { legalTargets: string[] }).legalTargets;
      return (legal.length > 0 && s.strength > 0 ? [{ sourceId: s.cardId, target: legal[0], amount: s.strength }] : []) as never;
    }
    return [
      { sourceId: s.cardId, target: { type: "card", cardId: id("ld") }, amount: 2 },
      { sourceId: s.cardId, target: { type: "card", cardId: id("mate") }, amount: 3 }
    ] as never;
  });
  assert.equal(damageOf(engine, id("ld")), 0, "Lingamite: reduced to 0");
  assert.equal(damageOf(engine, id("mate")), 3, "its ally takes the damage in full");
});

clause(LING, "0:rule", "only battle damage is reduced: a 1-damage effect during the battle still hurts (and kills) it", () => {
  const { engine, id } = lingBoard();
  declareAttackOpenWindow(engine, P1, [id("ld")]);
  play(engine, P2, id("ping"), { selected: { t: [id("ld")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("ld")), "discard", "1 non-battle damage destroys the 1-life attacker");
});

clause(LING, "0:rule", "when it is not attacking, damage from effects is normal as well", () => {
  const { engine, id } = lingBoard();
  declareAttackOpenWindow(engine, P1, [id("mate")]);
  play(engine, P2, id("ping"), { selected: { t: [id("ld")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("ld")), "discard");
});

clause(LING, "0:rule", "the reduction is gone once the card leaves play (a copy elsewhere is not protected by the card in the discard pile)", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ld", def: printing(LING), owner: P1, zone: "play" },
      { key: "ld2", def: printing(LING), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ],
    turn: 2
  });
  fightThrough(b.engine, P1, [b.id("ld"), b.id("ld2")], { type: "faction", playerId: P2 }, [b.id("blk")]);
  assert.equal(damageOf(b.engine, b.id("ld")), 0);
  assert.equal(damageOf(b.engine, b.id("ld2")), 0);
});

// =====================================================================================
// Overly Eager Exemplar — character (soldier), cost 5, threshold [R][R], 3 str / 3 spd / 3 life
// FOR MY BROTHERS! -- COST: Pay 1. Destroy this card. -- EFFECT: Search your deck for a "soldier" card and reveal
// it. If you do, put it into your hand.
// =====================================================================================

const OEE = "5f7c48c3-2413-4f85-87f3-8c9ed04046ec";

function oeeBoard(extra: Placement[] = [], o: { rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "oee", def: printing(OEE), owner: P1, zone: "play" },
      { key: "sol", def: character({ name: "Sol", subtype: ["soldier"] }), owner: P1, zone: "deck" },
      { key: "sol2", def: character({ name: "Sol2", subtype: ["soldier", "scout"] }), owner: P1, zone: "deck" },
      { key: "sol3", def: tactic({ name: "Sol3", subtype: ["soldier"] }), owner: P1, zone: "deck" },
      { key: "mage", def: character({ name: "Mage", subtype: ["mage"] }), owner: P1, zone: "deck" },
      { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "deck" },
      { key: "osol", def: character({ name: "OSol", subtype: ["soldier"] }), owner: P2, zone: "deck" },
      { key: "hsol", def: character({ name: "HSol", subtype: ["soldier"] }), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 2, P1),
      ...extra
    ],
    random: () => 0
  });
}
const deckOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].deck];
const handOf = (engine: SpoilsEngine, p: PlayerId) => [...engine.state.players[p].hand];
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
const pickFrom = (engine: SpoilsEngine, pick: string[] | undefined) =>
  drain(engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: pick ?? [] } : declineAll(pc)));

clause(OEE, "0:ability:for-my-brothers", "printed card: deploys for exactly 5 with [R][R] (4, or one [R] among 6, is refused) and is a 3/3/3 soldier", () => {
  const deployBoard = (rage: number, greed = 0) => buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [{ key: "oee", def: printing(OEE), owner: P1, zone: "hand" }, ...bank("rage", rage, P1), ...bank("greed", greed, P1)]
  });
  const oneRage = deployBoard(1, 5);
  refused(() => play(oneRage.engine, P1, oneRage.id("oee")), "threshold [R][R] with one [R]", /threshold/i);
  assert.equal(zoneOf(oneRage.engine, oneRage.id("oee")), "hand");
  const short = deployBoard(4);
  refused(() => play(short.engine, P1, short.id("oee")), "one short of cost 5", /cost|afford|pay|resource/i);
  assert.equal(zoneOf(short.engine, short.id("oee")), "hand", "still in hand");
  assert.equal(readyResources(short.engine, P1), 4, "nothing paid");
  const ok = deployBoard(5);
  play(ok.engine, P1, ok.id("oee"));
  assert.equal(zoneOf(ok.engine, ok.id("oee")), "play", "control: exactly 5 deploys it");
  assert.equal(readyResources(ok.engine, P1), 0, "all 5 paid");
  assert.deepEqual(["strength", "speed", "life"].map((stat) => ok.engine.getStat(ok.id("oee"), stat as "strength")), [3, 3, 3]);
  assert.ok(ok.engine.getDefinition(ok.id("oee")).subtype?.includes("soldier"), "a soldier");
});

clause(OEE, "0:ability:for-my-brothers", "COST: pay 1 and destroy this card; the chosen soldier goes to hand", () => {
  const { engine, id } = oeeBoard();
  const before = readyResources(engine, P1);
  activate(engine, P1, id("oee"), "for-my-brothers");
  const pc = pending(engine) as unknown as Pc;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "you choose");
  assert.equal(zoneOf(engine, id("oee")), "discard", "destroyed as a cost");
  assert.equal(before - readyResources(engine, P1), 1, "Pay 1");
  pickFrom(engine, [id("sol")]);
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("sol")), "hand");
});

clause(OEE, "0:ability:for-my-brothers", "any card with the soldier subtype can be found (a multi-subtype character, a non-character); each ends in your hand", () => {
  for (const k of ["sol", "sol2", "sol3"]) {
    const { engine, id } = oeeBoard();
    activate(engine, P1, id("oee"), "for-my-brothers");
    pickFrom(engine, [id(k)]);
    assert.equal(zoneOf(engine, id(k)), "hand", k);
    assert.equal(handOf(engine, P1).length, 2, `${k}: exactly one card added to the hand`);
  }
});

clause(OEE, "0:ability:for-my-brothers", "a non-soldier card in the deck cannot be taken", () => {
  const { engine, id } = oeeBoard();
  activate(engine, P1, id("oee"), "for-my-brothers");
  refused(() => pickFrom(engine, [id("mage")]), "a mage is not a soldier");
  assert.equal(zoneOf(engine, id("mage")), "deck");
  assert.equal(zoneOf(engine, id("plain")), "deck");
});

clause(OEE, "0:ability:for-my-brothers", "only your own deck is searched: the opponent's soldier and the soldier already in hand are not options", () => {
  const { engine, id } = oeeBoard();
  activate(engine, P1, id("oee"), "for-my-brothers");
  refused(() => pickFrom(engine, [id("osol")]), "the opponent's deck");
  assert.equal(zoneOf(engine, id("osol")), "deck");
  const pc = pending(engine) as unknown as Pc;
  assert.ok(pc, "still waiting for a legal pick");
  pickFrom(engine, [id("sol")]);
  assert.equal(zoneOf(engine, id("sol")), "hand");
  assert.equal(zoneOf(engine, id("osol")), "deck");
});

clause(OEE, "0:ability:for-my-brothers", "the found card is revealed to everyone", () => {
  const { engine, id } = oeeBoard();
  activate(engine, P1, id("oee"), "for-my-brothers");
  pickFrom(engine, [id("sol2")]);
  const reveals = engine.getLog().filter((e) => e.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(ev.cardIds, [id("sol2")]);
  assert.equal(ev.viewerId, "all");
});

clause(OEE, "0:ability:for-my-brothers", "you may fail the search (a specific-criteria search): nothing goes to hand, the cost is still paid", () => {
  const { engine, id } = oeeBoard();
  const handBefore = handOf(engine, P1);
  const before = readyResources(engine, P1);
  activate(engine, P1, id("oee"), "for-my-brothers");
  pickFrom(engine, []);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(handOf(engine, P1), handBefore, "no card found, nothing added");
  assert.equal(zoneOf(engine, id("sol")), "deck");
  assert.equal(zoneOf(engine, id("oee")), "discard", "the cost was paid regardless");
  assert.equal(before - readyResources(engine, P1), 1);
  assert.equal(engine.getLog().filter((e) => e.event?.type === "cardsRevealed").length, 0, "nothing to reveal");
});

clause(OEE, "0:ability:for-my-brothers", "with no soldier in the deck the cost is paid and nothing is found", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "oee", def: printing(OEE), owner: P1, zone: "play" },
      { key: "mage", def: character({ name: "Mage", subtype: ["mage"] }), owner: P1, zone: "deck" },
      ...bank("rage", 2, P1)
    ]
  });
  activate(b.engine, P1, b.id("oee"), "for-my-brothers");
  drain(b.engine, declineAll);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("oee")), "discard");
  assert.equal(zoneOf(b.engine, b.id("mage")), "deck");
  assert.equal(handOf(b.engine, P1).length, 0);
});

clause(OEE, "0:ability:for-my-brothers", "your deck is shuffled afterwards (CR 312.1: a searched deck is shuffled), whether or not a card was found", () => {
  const found = oeeBoard();
  const remaining = deckOf(found.engine, P1).filter((c) => c !== found.id("sol"));
  activate(found.engine, P1, found.id("oee"), "for-my-brothers");
  pickFrom(found.engine, [found.id("sol")]);
  assert.deepEqual(deckOf(found.engine, P1), shuffledWithConstant(remaining, 0), "found: the rest was shuffled");
  const failed = oeeBoard();
  const all = deckOf(failed.engine, P1);
  activate(failed.engine, P1, failed.id("oee"), "for-my-brothers");
  pickFrom(failed.engine, []);
  assert.deepEqual(deckOf(failed.engine, P1), shuffledWithConstant(all, 0), "failed: shuffled too");
});

clause(OEE, "0:ability:for-my-brothers", "the cost can't be paid without a spare resource: refused, and it is not destroyed", () => {
  const { engine, id } = oeeBoard([], { rage: 0 });
  refused(() => activate(engine, P1, id("oee"), "for-my-brothers"), "Pay 1 with no resources");
  assert.equal(zoneOf(engine, id("oee")), "play");
  assert.equal(zoneOf(engine, id("sol")), "deck");
});

clause(OEE, "0:ability:for-my-brothers", "a depleted Exemplar can still be used (no deplete in the cost), and it works on the opponent's character list nowhere else", () => {
  const { engine, id } = oeeBoard();
  engine.state.cards[id("oee")].depleted = true;
  activate(engine, P1, id("oee"), "for-my-brothers");
  pickFrom(engine, [id("sol")]);
  assert.equal(zoneOf(engine, id("sol")), "hand");
  assert.equal(zoneOf(engine, id("oee")), "discard");
});

// =====================================================================================
// Phantasmagoric Tollbooth — location, cost 4, threshold [R][R][R], 6 structure
// UNIQUE TOLLBOOTH -- If a non-token character would enter play under an opponent's control, they may pay 1. If
// they don't, put that character into its owner's discard pile instead. -- [R]x6: When a character an opponent
// owns is put into their discard pile from anywhere, you may pay 1. If you do, pick a faction and inflict 1
// damage to it.
// =====================================================================================

const TOLL = "d70efc6c-9a6e-41ab-92a2-cb97662f172f";

function tollBoard(extra: Placement[] = [], o: { rage?: number; oppRes?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction(), influence: START },
    playerB: { faction: developFaction(), influence: START },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "intruder", def: character({ name: "Intruder", cost: 0, life: 3 }), owner: P2, zone: "hand" },
      { key: "gear", def: item({ name: "Gear", cost: 0 }), owner: P2, zone: "hand" },
      { key: "own", def: character({ name: "Own", cost: 0 }), owner: P1, zone: "hand" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.oppRes ?? 2, P2),
      ...extra
    ],
    activePlayerId: P2,
    turn: 2
  });
}

clause(TOLL, "0:unique", "controlling a second Tollbooth makes you keep one: choosing one destroys the other", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "pt2", def: printing(TOLL), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("pt2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("pt"), b.id("pt2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("pt2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("pt2")), "play");
  assert.equal(zoneOf(b.engine, b.id("pt")), "discard");
  assert.equal(pending(b.engine), undefined);
});

clause(TOLL, "0:unique", "keeping the old one destroys the new one", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "pt2", def: printing(TOLL), owner: P1, zone: "hand" },
      ...bank("rage", 4, P1)
    ]
  });
  play(b.engine, P1, b.id("pt2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("pt") } } as never);
  assert.equal(zoneOf(b.engine, b.id("pt")), "play");
  assert.equal(zoneOf(b.engine, b.id("pt2")), "discard");
});

clause(TOLL, "0:unique", "UNIQUE is per player: the opponent controlling their own Tollbooth is fine", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "pt2", def: printing(TOLL), owner: P2, zone: "hand" },
      ...bank("rage", 4, P2)
    ],
    activePlayerId: P2,
    turn: 2
  });
  play(b.engine, P2, b.id("pt2"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("pt")), "play");
  assert.equal(zoneOf(b.engine, b.id("pt2")), "play");
});

clause(TOLL, "1:rule", "when the opponent's character would enter play they are asked to pay 1: paying lets it stay and spends exactly 1", () => {
  const b = tollBoard();
  const before = readyResources(b.engine, P2);
  play(b.engine, P2, b.id("intruder"));
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P2, "the opponent (the character's controller) decides, not the Tollbooth's controller");
  answerMayPay(b.engine, true);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("intruder")), "play");
  assert.equal(before - readyResources(b.engine, P2), 1, "paid 1");
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(TOLL, "1:rule", "declining the toll puts the character into its owner's discard pile instead (nothing paid)", () => {
  const b = tollBoard();
  const before = readyResources(b.engine, P2);
  play(b.engine, P2, b.id("intruder"));
  answerMayPay(b.engine, false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("intruder")), "discard");
  assert.ok(b.engine.state.players[P2].discard.includes(b.id("intruder")), "in its owner's discard pile");
  assert.equal(readyResources(b.engine, P2), before, "nothing paid");
});

clause(TOLL, "1:rule", "an opponent who cannot pay (no resources) has the character discarded", () => {
  const b = tollBoard([], { oppRes: 0 });
  play(b.engine, P2, b.id("intruder"));
  if (pending(b.engine)) answerMayPay(b.engine, true);
  assert.equal(zoneOf(b.engine, b.id("intruder")), "discard");
});

clause(TOLL, "1:rule", "it only taxes the opponent: your own characters enter play for free", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "own", def: character({ name: "Own", cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("own"));
  assert.equal(pending(b.engine), undefined, "no toll question");
  assert.equal(zoneOf(b.engine, b.id("own")), "play");
});

clause(TOLL, "1:rule", "only characters are taxed: the opponent's item enters play with no question", () => {
  const b = tollBoard();
  play(b.engine, P2, b.id("gear"));
  assert.equal(pending(b.engine), undefined, "no toll question");
  assert.equal(zoneOf(b.engine, b.id("gear")), "play");
});

clause(TOLL, "1:rule", "tokens are exempt: an opponent's token character enters play with no toll", () => {
  const maker = tactic({
    name: "Maker",
    cost: 0,
    behavior: { abilities: [{ id: "mk", type: "activated", effects: [{ type: "createTokens", controller: "controller", count: 1, token: { name: "Tok", cardType: "character", strength: 0, life: 1, speed: 1 } }] }] } as never
  });
  const b = tollBoard([{ key: "maker", def: maker, owner: P2, zone: "hand" }]);
  play(b.engine, P2, b.id("maker"));
  assert.equal(pending(b.engine), undefined, "no toll question for a token");
  const tokens = Object.values(b.engine.state.cards).filter((c) => c.zone === "play" && c.controllerId === P2 && b.engine.getDefinition(c.id).name === "Tok");
  assert.equal(tokens.length, 1, "the token is in play");
});

function reanimator(from: "self" | "opponent") {
  return tactic({
    name: `Reanimate${from}`,
    cost: 0,
    behavior: { abilities: [{ id: "re", type: "activated", targets: [{ id: "t", selector: { owner: from, zone: "discard", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }] } as never
  });
}

clause(TOLL, "1:rule", "'would enter play' covers effects too: an opponent reanimating their own character is asked for the toll; declining discards it again", () => {
  const b = tollBoard([{ key: "re", def: reanimator("self"), owner: P2, zone: "hand" }, { key: "dead", def: character({ name: "Dead", life: 3 }), owner: P2, zone: "discard" }]);
  play(b.engine, P2, b.id("re"), { selected: { t: [b.id("dead")] } });
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc.playerId, P2);
  answerMayPay(b.engine, false);
  assert.equal(zoneOf(b.engine, b.id("dead")), "discard");
  const paid = tollBoard([{ key: "re", def: reanimator("self"), owner: P2, zone: "hand" }, { key: "dead", def: character({ name: "Dead", life: 3 }), owner: P2, zone: "discard" }]);
  play(paid.engine, P2, paid.id("re"), { selected: { t: [paid.id("dead")] } });
  answerMayPay(paid.engine, true);
  assert.equal(zoneOf(paid.engine, paid.id("dead")), "play");
});

clause(TOLL, "1:rule", "a character owned by YOU that enters play under the opponent's control is tolled, and when refused goes to ITS OWNER's (your) discard pile", () => {
  const b = tollBoard([{ key: "re", def: reanimator("opponent"), owner: P2, zone: "hand" }, { key: "mine", def: character({ name: "MineDead", life: 3 }), owner: P1, zone: "discard" }]);
  play(b.engine, P2, b.id("re"), { selected: { t: [b.id("mine")] } });
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc?.kind, "mayPay", "it would enter under an opponent's control");
  assert.equal(pc.playerId, P2, "the controller-to-be pays");
  answerMayPay(b.engine, false);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.ok(b.engine.state.players[P1].discard.includes(b.id("mine")), "in its owner's discard pile");
  assert.equal(b.engine.state.cards[b.id("mine")].controllerId === P2 && zoneOf(b.engine, b.id("mine")) === "play", false);
});

clause(TOLL, "1:rule", "with the Tollbooth gone the toll no longer applies", () => {
  const b = tollBoard();
  b.engine.state.cards[b.id("pt")].zone = "discard" as never;
  play(b.engine, P2, b.id("intruder"));
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("intruder")), "play");
});

clause(TOLL, "2:rule@rrrrrr", "with six [R]: an opponent's character put into their discard pile (destroyed in play) lets you pay 1 to deal 1 damage to a faction of your choice", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "t", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t")] } });
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc.kind, "mayPay");
  assert.equal(pc.playerId, P1, "you decide");
  answerMayPay(b.engine, true);
  const pick = pending(b.engine) as unknown as Pc;
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1);
  const opp = b.engine.state.players[P2].factionId as string;
  drain(b.engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [opp] } : declineAll(p)));
  assert.equal(zoneOf(b.engine, b.id("t")), "discard");
  assert.equal(factionDamage(b.engine, P2), 1, "1 damage to the chosen faction");
  assert.equal(factionDamage(b.engine, P1), 0);
  assert.equal(before - readyResources(b.engine, P1), 1, "Kill costs 0; the toll cost 1");
});

clause(TOLL, "2:rule@rrrrrr", "any faction can be picked, including your own", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "t", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t")] } });
  answerMayPay(b.engine, true);
  const mine = b.engine.state.players[P1].factionId as string;
  drain(b.engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [mine] } : declineAll(p)));
  assert.equal(factionDamage(b.engine, P1), 1);
  assert.equal(factionDamage(b.engine, P2), 0);
});

clause(TOLL, "2:rule@rrrrrr", "declining the payment deals no damage and costs nothing", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "t", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  const before = readyResources(b.engine, P1);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t")] } });
  answerMayPay(b.engine, false);
  assert.equal(pending(b.engine), undefined);
  assert.equal(factionDamage(b.engine, P1), 0);
  assert.equal(factionDamage(b.engine, P2), 0);
  assert.equal(readyResources(b.engine, P1), before);
});

clause(TOLL, "2:rule@rrrrrr", "with only five [R] (and other icons) it does not trigger", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "t", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" }, ...bank("greed", 3, P1)], { rage: 5 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("t")), "discard");
});

clause(TOLL, "2:rule@rrrrrr", "your own character going to your discard pile does not trigger it", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
});

clause(TOLL, "2:rule@rrrrrr", "an opponent's non-character (item) going to the discard pile does not trigger it", () => {
  const killAny = tactic({
    name: "KillAny",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } as never
  });
  const b = tollBoard([{ key: "ka", def: killAny, owner: P1, zone: "hand" }, { key: "g", def: item({ name: "G" }), owner: P2, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("ka"), { selected: { t: [b.id("g")] } });
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("g")), "discard");
});

function discardFromHand(zone: "hand" | "deck") {
  return tactic({
    name: `Mill${zone}`,
    cost: 0,
    behavior: { abilities: [{ id: "m", type: "activated", targets: [{ id: "t", selector: { zone, type: "character", controller: "opponent" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] } as never
  });
}

clause(TOLL, "2:rule@rrrrrr", "'from anywhere': an opponent's character discarded from their hand triggers it", () => {
  const b = tollBoard([{ key: "mill", def: discardFromHand("hand"), owner: P1, zone: "hand" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("mill"), { selected: { t: [b.id("intruder")] } });
  assert.equal(zoneOf(b.engine, b.id("intruder")), "discard");
  answerMayPay(b.engine, true);
  const opp = b.engine.state.players[P2].factionId as string;
  drain(b.engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [opp] } : declineAll(p)));
  assert.equal(factionDamage(b.engine, P2), 1);
});

clause(TOLL, "2:rule@rrrrrr", "'from anywhere': an opponent's character put into the discard pile from their deck triggers it", () => {
  const b = tollBoard([{ key: "mill", def: discardFromHand("deck"), owner: P1, zone: "hand" }, { key: "dk", def: character({ name: "Dk" }), owner: P2, zone: "deck" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("mill"), { selected: { t: [b.id("dk")] } });
  assert.equal(zoneOf(b.engine, b.id("dk")), "discard");
  answerMayPay(b.engine, true);
  const opp = b.engine.state.players[P2].factionId as string;
  drain(b.engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [opp] } : declineAll(p)));
  assert.equal(factionDamage(b.engine, P2), 1);
});

clause(TOLL, "2:rule@rrrrrr", "a character discarded because its controller declined the toll also triggers this (once)", () => {
  const b = tollBoard([], { rage: 7 });
  play(b.engine, P2, b.id("intruder"));
  answerMayPay(b.engine, false);
  const pc = pending(b.engine) as unknown as Pc;
  assert.equal(pc?.kind, "mayPay", "now the Tollbooth's controller may pay");
  assert.equal(pc.playerId, P1);
  answerMayPay(b.engine, true);
  const opp = b.engine.state.players[P2].factionId as string;
  drain(b.engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [opp] } : declineAll(p)));
  assert.equal(factionDamage(b.engine, P2), 1);
  assert.equal(pending(b.engine), undefined);
});

clause(TOLL, "2:rule@rrrrrr", "unaffordable toll: with no resource left you cannot pay 1", () => {
  const b = buildGame({
    playerA: { faction: developFaction(), influence: START },
    playerB: { faction: developFaction(), influence: START },
    cards: [
      { key: "pt", def: printing(TOLL), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "t", def: character({ name: "Target", life: 3 }), owner: P2, zone: "play" },
      ...spent("rage", 6, P1)
    ]
  });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t")] } });
  const pc = pending(b.engine) as unknown as Pc | undefined;
  if (pc) {
    refused(() => answerMayPay(b.engine, true), "no resource to pay with");
  }
  assert.equal(factionDamage(b.engine, P2), 0);
});

clause(TOLL, "2:rule@rrrrrr", "'a character an opponent owns': an opponent-OWNED character under your control going to the discard pile triggers it", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "stolen", def: character({ name: "Stolen", life: 3 }), owner: P2, controller: P1, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("stolen")] } });
  const pc = pending(b.engine) as unknown as Pc | undefined;
  assert.equal(pc?.kind, "mayPay", "it is a character an opponent owns going to their discard pile");
});

clause(TOLL, "2:rule@rrrrrr", "'a character an opponent owns': your own character controlled by the opponent does not trigger it", () => {
  const b = tollBoard([{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }, { key: "lent", def: character({ name: "Lent", life: 3 }), owner: P1, controller: P2, zone: "play" }], { rage: 7 });
  b.engine.state.activePlayerId = P1;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("lent")] } });
  assert.equal(pending(b.engine), undefined, "you own it, so it is not 'a character an opponent owns'");
  assert.equal(zoneOf(b.engine, b.id("lent")), "discard");
});
