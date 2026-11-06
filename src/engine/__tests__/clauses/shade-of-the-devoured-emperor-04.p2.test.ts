// Clause tests — batch shade-of-the-devoured-emperor-04, part p2 (groups 7-11, missing clauses).
// See docs/TESTING.md. Expectations come from each card's PRINTED text
// (Shade of the Devoured Emperor) and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import { buildGame, activate, bank, character, developFaction, item, location, play, resolvePendingResponses, tactic, P1, P2 } from "../per-card/_harness.js";
import { clause, clauseMismatch, declineAll, drain, printing, refused } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fightThrough, finishBattle } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Pid = typeof P1 | typeof P2;
type IdOf = (key: string) => CardInstanceId;
type Game = { engine: SpoilsEngine; id: IdOf };

const ready = (engine: SpoilsEngine, p: Pid = P1) => engine.getAvailableResourceCount(p);
const live = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]?.zone === "play";
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId]?.damage ?? 0;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted === true;
const hostOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].attachedTo;
const stats = (engine: SpoilsEngine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const decks = (): CardPlacement[] => [...fillers("d", 4, P1, "deck"), ...fillers("e", 4, P2, "deck")];

/** The Micromajig tokens `p` controls in play. */
const majigsOf = (engine: SpoilsEngine, p: Pid): CardInstanceId[] =>
  Object.entries(engine.state.cards)
    .filter(([key, c]) => c.isToken && c.zone === "play" && c.controllerId === p && engine.getDefinition(key).name === "Micromajig")
    .map(([key]) => key);

/** A Micromajig token as CR 409.3c describes it: a Gearsmith character, 1/1/3, subtype majig. */
const micro = (): CardDefinition => character({ name: "Micromajig", subtype: ["majig"], strength: 1, life: 1, speed: 3 });
const markTokens = (g: Game, keys: string[]) => {
  for (const k of keys) g.engine.state.cards[g.id(k)].isToken = true;
};

/** An item whose "zap" ability inflicts `amount` damage to one chosen character in play. */
const zapper = (amount: number, name = "Zapper"): CardDefinition =>
  item({
    name,
    cost: 0,
    behavior: {
      abilities: [
        { id: "zap", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }
      ]
    }
  });
/** An item whose "wreck" ability destroys one chosen card of `type` in play. */
const wrecker = (type: "item" | "location", name = "Wrecker"): CardDefinition =>
  item({
    name,
    cost: 0,
    behavior: {
      abilities: [{ id: "wreck", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
/** A free tactic that returns one chosen character in play to its owner's hand. */
const bounce = (): CardDefinition =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        { id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }
      ]
    }
  });
/** An item with a "Pay 3" ability (a numeric cost, CR 406.5) that does nothing but restore itself. */
const pumper = (): CardDefinition =>
  item({ name: "Pumper", cost: 0, behavior: { abilities: [{ id: "pump", type: "activated", costs: [{ type: "payResources", amount: 3 }], effects: [{ type: "restore", target: "source" }] }] } });

/** Plays `key` as `p` and returns how many resources it cost. */
function paid(engine: SpoilsEngine, id: IdOf, key: string, p: Pid = P1): number {
  const before = ready(engine, p);
  play(engine, p, id(key));
  assert.equal(zoneOf(engine, id(key)), "play", `${key} was deployed`);
  return before - ready(engine, p);
}

// =================================================================================
// Micromajig Recycling Station — location, cost 3, [E][E], structure 3
// At the start of your turn, you may choose a number for X and destroy X Micromajig tokens you control.
// If you do, reduce the next numeric cost you pay this turn by X+1.
// =================================================================================

const MRS = "5e70e380-c62f-44a8-9b2c-abccb8f508ef";

/** P2 is mid-turn; `endTurn(P2)` starts P1's turn, where the Station's trigger fires. P1 has `mine` tokens m0.., P2 `theirs` tokens o0.. */
function mrsBoard(o: { mine?: number; theirs?: number; extra?: CardPlacement[] } = {}): Game {
  const mine = o.mine ?? 3;
  const theirs = o.theirs ?? 1;
  const g = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mrs", def: printing(MRS), owner: P1, zone: "play" },
      ...Array.from({ length: mine }, (_, i) => ({ key: `m${i}`, def: micro(), owner: P1, zone: "play" as const })),
      ...Array.from({ length: theirs }, (_, i) => ({ key: `o${i}`, def: micro(), owner: P2, zone: "play" as const })),
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "improved", def: character({ name: "Improved Micromajig", subtype: ["majig"], strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "big", def: item({ name: "Big Five", cost: 5 }), owner: P1, zone: "hand" },
      { key: "big2", def: item({ name: "Big Five Again", cost: 5 }), owner: P1, zone: "hand" },
      { key: "small", def: item({ name: "Small Two", cost: 2 }), owner: P1, zone: "hand" },
      { key: "theirBig", def: item({ name: "Their Five", cost: 5 }), owner: P2, zone: "hand" },
      ...bank("elitism", 12, P1),
      ...bank("elitism", 12, P2),
      ...decks(),
      ...(o.extra ?? [])
    ]
  });
  markTokens(g, [...Array.from({ length: mine }, (_, i) => `m${i}`), ...Array.from({ length: theirs }, (_, i) => `o${i}`)]);
  return g;
}

/** Starts P1's turn and answers the Station's prompts: choose X, then pick the tokens to destroy. */
function recycle(g: Game, x: number, picks: string[]): void {
  const { engine, id } = g;
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "it is my turn");
  const pc = pending(engine)!;
  assert.equal(pc?.kind, "chooseNumber", "asked for X at the start of my turn");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooseNumber", { value: x });
  if (pending(engine)) answerPending(engine, "chooserSelectsTarget", { selected: picks.map(id) });
  assert.equal(engine.state.pendingChoice, undefined, "nothing left to answer");
}

clause(MRS, "0:rule", "X=2 of 3 tokens: exactly the 2 picked tokens are destroyed (not the third, not the opponent's, not other characters) and the next cost is reduced by 3", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 2, ["m0", "m2"]);
  assert.equal(live(engine, id("m0")), false, "picked token destroyed");
  assert.equal(live(engine, id("m2")), false, "picked token destroyed");
  assert.equal(live(engine, id("m1")), true, "the unpicked token stays");
  assert.equal(live(engine, id("o0")), true, "the opponent's token stays");
  assert.equal(live(engine, id("bystander")), true);
  assert.equal(live(engine, id("improved")), true);
  assert.equal(majigsOf(engine, P1).length, 1);
  assert.equal(paid(engine, id, "big"), 2, "cost 5 reduced by X+1 = 3");
});

clause(MRS, "0:rule", "X=1: one token destroyed and the next cost is reduced by 2 (cost 5 becomes 3)", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 1, ["m1"]);
  assert.equal(live(engine, id("m1")), false);
  assert.equal(majigsOf(engine, P1).length, 2);
  assert.equal(paid(engine, id, "big"), 3);
});

clause(MRS, "0:rule", "X=3 (every token I control): all three destroyed, the opponent's survives, and the next cost is reduced by 4 (cost 5 becomes 1)", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 3, ["m0", "m1", "m2"]);
  assert.equal(majigsOf(engine, P1).length, 0);
  assert.equal(majigsOf(engine, P2).length, 1, "the opponent's token is not mine to destroy");
  assert.equal(paid(engine, id, "big"), 1);
});

clause(MRS, "0:rule", "X=0: nothing is destroyed and the next cost is reduced by X+1 = 1 (cost 5 becomes 4)", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 0, []);
  assert.equal(majigsOf(engine, P1).length, 3, "no token destroyed");
  assert.equal(paid(engine, id, "big"), 4);
});

clause(MRS, "0:rule", "the reduction cannot take a cost below 0 (CR 406.6): cost 2 with a reduction of 4 is free, and that cost used the reduction up", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 3, ["m0", "m1", "m2"]);
  assert.equal(paid(engine, id, "small"), 0);
  assert.equal(paid(engine, id, "big"), 5, "the free item was the next numeric cost; the reduction is gone");
});

clause(MRS, "0:rule", "only the NEXT numeric cost is reduced: the first cost-5 item pays 3, the second pays the full 5", () => {
  const g = mrsBoard();
  const { engine, id } = g;
  recycle(g, 1, ["m0"]);
  assert.equal(paid(engine, id, "big"), 3);
  assert.equal(paid(engine, id, "big2"), 5);
});

clause(MRS, "0:rule", "a 'pay N' on an ability is a numeric cost too (CR 406.5): a Pay 3 ability costs 1 after X=1, the next use costs 3", () => {
  const g = mrsBoard({ extra: [{ key: "pumper", def: pumper(), owner: P1, zone: "play" }] });
  const { engine, id } = g;
  recycle(g, 1, ["m0"]);
  const before = ready(engine);
  activate(engine, P1, id("pumper"), "pump");
  assert.equal(before - ready(engine), 1, "3 reduced by 2");
  const mid = ready(engine);
  activate(engine, P1, id("pumper"), "pump");
  assert.equal(mid - ready(engine), 3, "the reduction was used up");
});

clause(MRS, "0:rule", "X is a number from 0 up to the Micromajig tokens I control (the opponent's are not counted); below 0, above that, or fractional is refused", () => {
  const ok = mrsBoard({ theirs: 2 });
  endTurn(ok.engine, P2);
  const pc = pending(ok.engine)!;
  assert.equal(pc.kind, "chooseNumber");
  assert.equal(pc.min, 0);
  assert.equal(pc.max, 3, "3 tokens of mine; the opponent's 2 do not count");
  answerPending(ok.engine, "chooseNumber", { value: 3 });
  assert.equal(pending(ok.engine)?.kind, "chooserSelectsTarget", "X=3 accepted (positive control)");
  for (const bad of [4, -1, 1.5]) {
    const g = mrsBoard({ theirs: 2 });
    endTurn(g.engine, P2);
    refused(() => answerPending(g.engine, "chooseNumber", { value: bad }), `X=${bad}`);
    assert.equal(g.engine.state.cards[g.id("m0")].zone, "play", "nothing destroyed by a refused X");
  }
});

clause(MRS, "0:rule", "only my Micromajig tokens may be destroyed: not the opponent's token, not another character, not a majig with a different name; exactly X must be picked", () => {
  const good = mrsBoard();
  endTurn(good.engine, P2);
  answerPending(good.engine, "chooseNumber", { value: 2 });
  answerPending(good.engine, "chooserSelectsTarget", { selected: [good.id("m0"), good.id("m1")] });
  assert.equal(majigsOf(good.engine, P1).length, 1, "a legal pick works (positive control)");
  const badPicks: Array<[string, string[]]> = [
    ["the opponent's token", ["o0", "m0"]],
    ["a plain character", ["bystander", "m0"]],
    ["'Improved Micromajig' (a non-token majig)", ["improved", "m0"]],
    ["too many (3 for X=2)", ["m0", "m1", "m2"]],
    ["too few (1 for X=2)", ["m0"]]
  ];
  for (const [why, keys] of badPicks) {
    const g = mrsBoard();
    endTurn(g.engine, P2);
    answerPending(g.engine, "chooseNumber", { value: 2 });
    refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: keys.map(g.id) }), why);
    assert.equal(majigsOf(g.engine, P1).length, 3, `${why}: nothing was destroyed`);
    assert.equal(live(g.engine, g.id("o0")), true);
  }
});

clause(MRS, "0:rule", "a non-token card that happens to be named Micromajig is not a 'Micromajig token': it is not counted in X and cannot be picked", () => {
  const g = mrsBoard({ extra: [{ key: "fake", def: micro(), owner: P1, zone: "play" }] });
  const { engine, id } = g;
  endTurn(engine, P2);
  const pc = pending(engine)!;
  assert.equal(pc.max, 3, "only the 3 real tokens count");
  answerPending(engine, "chooseNumber", { value: 1 });
  refused(() => answerPending(engine, "chooserSelectsTarget", { selected: [id("fake")] }), "a non-token card");
  assert.equal(live(engine, id("fake")), true);
});

clause(MRS, "0:rule", "it triggers at the start of EACH of my turns and not at the start of the opponent's turn", () => {
  const g = mrsBoard();
  const { engine } = g;
  recycle(g, 0, []);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the opponent's turn has begun");
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked at the start of the opponent's turn");
  assert.equal(majigsOf(engine, P1).length, 3);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(pending(engine)?.kind, "chooseNumber", "asked again at the start of my next turn");
});

clause(MRS, "0:rule", "'your turn' is its controller's turn: a Station controlled by the opponent does not trigger at the start of my turn, but does at theirs", () => {
  const g = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mrs", def: printing(MRS), owner: P2, zone: "play" },
      { key: "o0", def: micro(), owner: P2, zone: "play" },
      { key: "m0", def: micro(), owner: P1, zone: "play" },
      ...bank("elitism", 6, P1),
      ...bank("elitism", 6, P2),
      ...decks()
    ]
  });
  markTokens(g, ["o0", "m0"]);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(g.engine.state.pendingChoice, undefined, "the opponent's Station is silent on my turn");
  assert.equal(live(g.engine, g.id("m0")), true);
  endTurn(g.engine, P1);
  const pc = pending(g.engine)!;
  assert.equal(pc?.kind, "chooseNumber", "it triggers on its controller's own turn");
  assert.equal(pc.playerId, P2);
  assert.equal(pc.max, 1, "counting only the controller's tokens");
});

clause(MRS, "0:rule", "the reduction is for 'this turn': unused it is gone next turn, and it never helps the opponent", () => {
  const g = mrsBoard({ extra: [{ key: "wrecker", def: wrecker("location"), owner: P2, zone: "play" }] });
  const { engine, id } = g;
  recycle(g, 1, ["m0"]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(paid(engine, id, "theirBig", P2), 5, "the opponent pays full price");
  activate(engine, P2, id("wrecker"), "wreck", { selected: { t: [id("mrs")] } });
  assert.equal(zoneOf(engine, id("mrs")), "discard", "the Station is gone, so it cannot trigger again");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(paid(engine, id, "big"), 5, "last turn's unused reduction expired");
});

// =================================================================================
// Micromajigmakermachinemajig — item, cost 1, [E][E]
// RELEASE THE MAJIGS! -- COST: Deplete this card. Pick an opponent. That player may put a Micromajig token into play
//   under their control. This turn, all damage inflicted to that token is reduced to 0.
//   EFFECT: Put a Micromajig token into play under your control.
// PREPARE -- COST: Pay 2. -- EFFECT: Restore this card.
// =================================================================================

const MAKER = "67fe9bf8-04c3-4ea0-bbde-0ec94e33b56e";

function makerBoard(o: { turn?: number; active?: Pid; depleted?: boolean; icons?: number; extra?: CardPlacement[] } = {}): Game {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mk", def: printing(MAKER), owner: P1, zone: "play", depleted: o.depleted },
      { key: "zap1", def: zapper(3, "My Zapper"), owner: P1, zone: "play" },
      { key: "zap2", def: zapper(3, "Their Zapper"), owner: P2, zone: "play" },
      { key: "atk", def: character({ name: "Attacker", strength: 3, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", o.icons ?? 6, P1),
      ...bank("elitism", 6, P2),
      ...decks(),
      ...(o.extra ?? [])
    ]
  });
}

/** P1 uses RELEASE THE MAJIGS!; the opponent answers the prompt (accept = put the token into play). */
function release(g: Game, accept: boolean, key = "mk"): void {
  const { engine, id } = g;
  activate(engine, P1, id(key), "mmm-release");
  const pc = pending(engine)!;
  assert.equal(pc?.kind, "chooserSelectsOption", "the opponent is asked");
  assert.equal(pc.playerId, P2, "the opponent (not me) decides");
  answerPending(engine, "chooserSelectsOption", { index: accept ? 1 : 0 });
  assert.equal(engine.state.pendingChoice, undefined);
}
const zapAt = (g: Game, zapperKey: string, owner: Pid, target: CardInstanceId) => activate(g.engine, owner, g.id(zapperKey), "zap", { selected: { t: [target] } });

clause(MAKER, "0:ability:mmm-release", "COST: deplete this card: it is depleted, no resource is spent, and it cannot be used again while depleted", () => {
  const g = makerBoard();
  const { engine, id } = g;
  assert.equal(isDepleted(engine, id("mk")), false);
  const before = ready(engine);
  release(g, false);
  assert.equal(isDepleted(engine, id("mk")), true, "depleted by its own cost");
  assert.equal(ready(engine), before, "no resource was paid");
  assert.equal(zoneOf(engine, id("mk")), "play");
  refused(() => activate(engine, P1, id("mk"), "mmm-release"), "already depleted");
  assert.equal(majigsOf(engine, P1).length, 1, "the refused second use made no second token");
});

clause(MAKER, "0:ability:mmm-release", "the opponent accepts: they get exactly one Micromajig token (a 1/1/3 majig character) under THEIR control, and I get one under mine", () => {
  const g = makerBoard();
  const { engine } = g;
  release(g, true);
  const theirs = majigsOf(engine, P2);
  const mine = majigsOf(engine, P1);
  assert.equal(theirs.length, 1, "the opponent's token");
  assert.equal(mine.length, 1, "my token");
  for (const token of [...theirs, ...mine]) {
    const def = engine.getDefinition(token);
    assert.equal(def.name, "Micromajig");
    assert.equal(def.type, "character");
    assert.ok(def.subtype.includes("majig"), "majig subtype");
    assert.deepEqual(stats(engine, token), [1, 1, 3], "1 strength / 1 life / 3 speed");
  }
  assert.equal(engine.state.cards[theirs[0]].controllerId, P2);
  assert.equal(engine.state.cards[mine[0]].controllerId, P1);
  assert.equal(Object.values(engine.state.cards).filter((c) => c.isToken && c.zone === "play").length, 2, "no other token was made");
});

clause(MAKER, "0:ability:mmm-release", "the opponent declines: they get nothing, I still get my token, and no token of mine is shielded", () => {
  const g = makerBoard();
  const { engine, id } = g;
  release(g, false);
  assert.equal(majigsOf(engine, P2).length, 0, "no token for the opponent");
  const mine = majigsOf(engine, P1);
  assert.equal(mine.length, 1, "my EFFECT still happens");
  assert.equal(engine.state.cards[mine[0]].controllerId, P1);
  zapAt(g, "zap1", P1, mine[0]);
  assert.equal(live(engine, mine[0]), false, "my token takes damage normally (life 1, 3 damage)");
  assert.equal(damageOn(engine, id("bystander")), 0);
});

clause(MAKER, "0:ability:mmm-release",
  "'Pick an opponent. That player may put a Micromajig token...' is part of the COST: the opponent decides and gets their token when the ability is activated, before it goes on the stack; my token is the EFFECT",
  () => {
    const { engine, id } = makerBoard();
    engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mk"), abilityId: "mmm-release", selected: {}, variables: {} } as never);
    assert.equal(isDepleted(engine, id("mk")), true, "deplete is a cost");
    const pc = pending(engine);
    assert.ok(pc, "the opponent is asked immediately (cost), not when the ability resolves");
    assert.equal(pc.playerId, P2);
    engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "chooserSelectsOption", index: 1 } } as never);
    assert.equal(majigsOf(engine, P2).length, 1, "the opponent's token is already in play (paid as part of the cost)");
    assert.equal(majigsOf(engine, P1).length, 0, "my token is the effect: it is not here until the ability resolves");
    resolvePendingResponses(engine);
    assert.equal(majigsOf(engine, P1).length, 1);
    assert.equal(majigsOf(engine, P2).length, 1);
  }
);

clause(MAKER, "0:ability:mmm-release", "this turn all damage to the opponent's token is reduced to 0: a 3-damage zap leaves it undamaged and in play", () => {
  const g = makerBoard();
  const { engine } = g;
  release(g, true);
  const token = majigsOf(engine, P2)[0];
  zapAt(g, "zap1", P1, token);
  assert.equal(live(engine, token), true, "3 damage on a life-1 token would kill it; reduced to 0 it lives");
  assert.equal(damageOn(engine, token), 0);
  zapAt(g, "zap1", P1, token);
  assert.equal(live(engine, token), true, "every damage this turn, not just the first");
  assert.equal(damageOn(engine, token), 0);
});

clause(MAKER, "0:ability:mmm-release", "battle damage to the shielded token is reduced to 0 too, while the token still deals its own 1 damage", () => {
  const g = makerBoard();
  const { engine, id } = g;
  release(g, true);
  const token = majigsOf(engine, P2)[0];
  fightThrough(engine, P1, [id("atk")], { type: "faction", playerId: P2 }, [token]);
  assert.equal(live(engine, token), true, "the 3-strength attacker could not hurt it");
  assert.equal(damageOn(engine, token), 0);
  assert.equal(damageOn(engine, id("atk")), 1, "the token's own strike (1) is not reduced");
  assert.equal(live(engine, id("atk")), true);
});

clause(MAKER, "0:ability:mmm-release", "only THAT token is shielded: my own new token and the opponent's other characters take damage normally", () => {
  const g = makerBoard();
  const { engine, id } = g;
  release(g, true);
  const mine = majigsOf(engine, P1)[0];
  zapAt(g, "zap1", P1, id("bystander"));
  assert.equal(damageOn(engine, id("bystander")), 3, "the opponent's other character is not shielded");
  zapAt(g, "zap1", P1, mine);
  assert.equal(live(engine, mine), false, "my token is not shielded (3 damage on life 1)");
});

clause(MAKER, "0:ability:mmm-release", "the shield lasts only THIS turn: next turn the token takes damage and dies", () => {
  const g = makerBoard();
  const { engine } = g;
  release(g, true);
  const token = majigsOf(engine, P2)[0];
  zapAt(g, "zap1", P1, token);
  assert.equal(live(engine, token), true, "shielded now");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  zapAt(g, "zap2", P2, token);
  assert.equal(live(engine, token), false, "the shield ended with the turn: 3 damage kills the life-1 token");
});

clause(MAKER, "0:ability:mmm-release", "used on the opponent's turn, 'this turn' is that turn: the shield lasts until it ends and is gone on my turn", () => {
  const g = makerBoard({ turn: 2, active: P2, extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }] });
  const { engine, id } = g;
  declareAttackOpenWindow(engine, P2, [id("raider")]);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("mk"), abilityId: "mmm-release", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  const token = majigsOf(engine, P2)[0];
  assert.ok(token, "the opponent's token exists");
  assert.equal(majigsOf(engine, P1).length, 1);
  engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] } as never);
  finishBattle(engine);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  zapAt(g, "zap1", P1, token);
  assert.equal(live(engine, token), false, "the shield ended with the opponent's turn");
});

clause(MAKER, "1:ability:mmm-prepare", "COST: pay 2 (exactly): a depleted Maker is restored, two resources are spent, and no token is made", () => {
  const g = makerBoard({ depleted: true, icons: 5 });
  const { engine, id } = g;
  assert.equal(isDepleted(engine, id("mk")), true);
  activate(engine, P1, id("mk"), "mmm-prepare");
  assert.equal(isDepleted(engine, id("mk")), false, "restored");
  assert.equal(ready(engine), 3, "5 resources, 2 paid");
  assert.equal(majigsOf(engine, P1).length, 0, "PREPARE makes no token");
  assert.equal(majigsOf(engine, P2).length, 0);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAKER, "1:ability:mmm-prepare", "one resource short of the 2 is refused (and costs nothing), exactly 2 is enough", () => {
  const short = makerBoard({ depleted: true, icons: 1 });
  refused(() => activate(short.engine, P1, short.id("mk"), "mmm-prepare"), "only 1 resource");
  assert.equal(isDepleted(short.engine, short.id("mk")), true, "still depleted");
  assert.equal(ready(short.engine), 1, "nothing spent");
  const exact = makerBoard({ depleted: true, icons: 2 });
  activate(exact.engine, P1, exact.id("mk"), "mmm-prepare");
  assert.equal(isDepleted(exact.engine, exact.id("mk")), false);
  assert.equal(ready(exact.engine), 0);
});

clause(MAKER, "1:ability:mmm-prepare", "after PREPARE the Maker can RELEASE THE MAJIGS! again: a second token for me", () => {
  const g = makerBoard({ icons: 4 });
  const { engine, id } = g;
  release(g, false);
  assert.equal(isDepleted(engine, id("mk")), true);
  assert.equal(majigsOf(engine, P1).length, 1);
  activate(engine, P1, id("mk"), "mmm-prepare");
  release(g, false);
  assert.equal(isDepleted(engine, id("mk")), true, "depleted again by the second RELEASE");
  assert.equal(majigsOf(engine, P1).length, 2);
  assert.equal(ready(engine), 2, "only PREPARE's 2 were spent");
});

clause(MAKER, "1:ability:mmm-prepare", "no 'only if depleted' is printed: PREPARE on a ready Maker is allowed, pays 2 and leaves it ready", () => {
  const g = makerBoard({ icons: 4 });
  const { engine, id } = g;
  activate(engine, P1, id("mk"), "mmm-prepare");
  assert.equal(isDepleted(engine, id("mk")), false);
  assert.equal(ready(engine), 2, "2 paid");
});

// =================================================================================
// Pwny Bomb — item (gear), cost 0, [E], ATTACH TO character
// The attached character gains 1 strength and 1 life.
// If a Micromajig token or "horsemajig" character enters play under your control, you may attach this card to it.
// PWNED -- COST: Pick a Micromajig token or "horsemajig" character that this card is attached to. Pick a character. Destroy this card.
//   EFFECT: Inflict 7 damage to the picked characters.
// MOVE -- COST: Pick a character you control. Pay 3. -- EFFECT: Attach this card to the character if you can.
// =================================================================================

const PWNY = "f3c30c8a-69ce-443b-baed-afaed7170725";

const horse = (name = "Horse", over: Partial<CardDefinition> = {}): CardDefinition => character({ name, subtype: ["horsemajig"], strength: 2, life: 11, speed: 2, ...over });

function pwnyBoard(o: { host?: CardDefinition; icons?: number; turn?: number; active?: Pid; bombZone?: "play" | "hand"; extra?: CardPlacement[] } = {}): Game {
  const bombInPlay = (o.bombZone ?? "play") === "play";
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "host", def: o.host ?? horse("Host"), owner: P1, zone: "play" },
      bombInPlay ? { key: "pb", def: printing(PWNY), owner: P1, zone: "play", attachedToKey: "host" } : { key: "pb", def: printing(PWNY), owner: P1, zone: "hand" },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "myRelic", def: item({ name: "My Relic" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 8, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 1, life: 7, speed: 1 }), owner: P2, zone: "play" },
      { key: "relic", def: item({ name: "Relic" }), owner: P2, zone: "play" },
      { key: "shrine", def: location({ name: "Shrine", structure: 20 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "hand" },
      ...bank("elitism", o.icons ?? 6, P1),
      ...bank("elitism", 6, P2),
      ...decks(),
      ...(o.extra ?? [])
    ]
  });
}
const pwned = (g: Game, pick: string | CardInstanceId, rawId = false) => activate(g.engine, P1, g.id("pb"), "pwny-bomb-pwned", { selected: { ch: [rawId ? pick : g.id(pick)] } });
const moveTo = (g: Game, pick: string) => activate(g.engine, P1, g.id("pb"), "pwny-bomb-move", { selected: { mv: [g.id(pick)] } });
/** Creates one real Micromajig token for P1 with the Maker (P2 declines) and returns its id. */
function realToken(g: Game): CardInstanceId {
  // The opponent declines their token; I decline the bomb's own "attach it?" offer for mine (the token is a valid host now).
  activate(g.engine, P1, g.id("mk"), "mmm-release");
  drain(g.engine, (pc) => ({ kind: "chooserSelectsOption", index: 0 }));
  const t = majigsOf(g.engine, P1);
  assert.equal(t.length, 1);
  return t[0];
}
const withMaker = (): CardPlacement[] => [{ key: "mk", def: printing(MAKER), owner: P1, zone: "play" }];

// --- 0:rule  the attached character gains 1 strength and 1 life ----------------

clause(PWNY, "0:rule", "the attached character gains exactly 1 strength and 1 life (2/11 becomes 3/12, speed unchanged); other characters are not affected", () => {
  const { engine, id } = pwnyBoard();
  assert.deepEqual(stats(engine, id("host")), [3, 12, 2]);
  assert.deepEqual(stats(engine, id("ally")), [2, 4, 2], "my other character");
  assert.deepEqual(stats(engine, id("foe")), [2, 8, 2], "the opponent's character");
});

clause(PWNY, "0:rule", "any attached character gets it, not only a majig: a plain character 1/3/1 becomes 2/4/1", () => {
  const { engine, id } = pwnyBoard({ host: character({ name: "Plain", strength: 1, life: 3, speed: 1 }) });
  assert.deepEqual(stats(engine, id("host")), [2, 4, 1]);
});

clause(PWNY, "0:rule", "it ends when the Pwny Bomb leaves play: the host is back to its printed 2/11", () => {
  const { engine, id } = pwnyBoard({ extra: [{ key: "wrecker", def: wrecker("item"), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(engine, id("host")), [3, 12, 2], "on while attached");
  activate(engine, P1, id("wrecker"), "wreck", { selected: { t: [id("pb")] } });
  assert.equal(zoneOf(engine, id("pb")), "discard");
  assert.deepEqual(stats(engine, id("host")), [2, 11, 2], "off after the bomb left");
  assert.equal(live(engine, id("host")), true);
});

clause(PWNY, "0:rule", "two Pwny Bombs on one character each give +1/+1 (it becomes 4/13)", () => {
  const { engine, id } = pwnyBoard({ extra: [{ key: "pb2", def: printing(PWNY), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(engine, id("host")), [4, 13, 2]);
});

// --- 1:rule  may attach to an entering Micromajig token / horsemajig ------------

const playNewHorse = (g: Game, key = "newHorse") => play(g.engine, P1, g.id(key));
const withNewHorse = (extra: CardPlacement[] = []): CardPlacement[] => [{ key: "newHorse", def: horse("New Horse", { strength: 2, life: 5, speed: 2 }), owner: P1, zone: "hand" }, ...extra];

clause(PWNY, "1:rule", "a horsemajig character entering play under my control: I may attach the bomb to it (accept moves the bomb and its +1/+1 to the newcomer)", () => {
  const g = pwnyBoard({ extra: withNewHorse() });
  const { engine, id } = g;
  assert.equal(hostOf(engine, id("pb")), id("host"));
  playNewHorse(g);
  const pc = pending(engine)!;
  assert.ok(pc, "I am asked whether to attach");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "chooserSelectsOption", { index: 1 });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(hostOf(engine, id("pb")), id("newHorse"), "attached to the horsemajig");
  assert.equal(zoneOf(engine, id("pb")), "play");
  assert.deepEqual(stats(engine, id("newHorse")), [3, 6, 2], "5-life newcomer gets +1/+1");
  assert.deepEqual(stats(engine, id("host")), [2, 11, 2], "the old host lost it");
});

clause(PWNY, "1:rule", "'you may': declining leaves the bomb on its current host", () => {
  const g = pwnyBoard({ extra: withNewHorse() });
  const { engine, id } = g;
  playNewHorse(g);
  assert.ok(pending(engine), "asked (positive control)");
  answerPending(engine, "chooserSelectsOption", { index: 0 });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(hostOf(engine, id("pb")), id("host"));
  assert.deepEqual(stats(engine, id("host")), [3, 12, 2]);
  assert.deepEqual(stats(engine, id("newHorse")), [2, 5, 2]);
});

clause(PWNY, "1:rule",
  "a Micromajig TOKEN (the real 1/1/3 'majig' token the Maker makes) entering play under my control lets me attach the bomb to it; the opponent's token does not",
  () => {
    const g = pwnyBoard({ extra: withMaker() });
    const { engine, id } = g;
    activate(engine, P1, id("mk"), "mmm-release");
    const seen: string[] = [];
    drain(engine, (pc) => {
      seen.push(`${pc.playerId}:${pc.kind}`);
      return { kind: "chooserSelectsOption", index: 1 };
    });
    const mine = majigsOf(engine, P1);
    assert.equal(mine.length, 1);
    assert.equal(majigsOf(engine, P2).length, 1);
    assert.deepEqual(seen, [`${P2}:chooserSelectsOption`, `${P1}:chooserSelectsOption`], "the opponent decides on their token; I am asked once, for MY token only");
    assert.equal(hostOf(engine, id("pb")), mine[0], "the bomb is on my new token");
    assert.deepEqual(stats(engine, mine[0]), [2, 2, 3]);
  }
);

clause(PWNY, "1:rule", "'under your control': a horsemajig entering play under the OPPONENT's control asks nothing and the bomb stays put", () => {
  const g = pwnyBoard({ turn: 2, active: P2, extra: [{ key: "theirHorse", def: horse("Their Horse"), owner: P2, zone: "hand" }] });
  const { engine, id } = g;
  play(engine, P2, id("theirHorse"));
  assert.equal(zoneOf(engine, id("theirHorse")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(hostOf(engine, id("pb")), id("host"));
});

clause(PWNY, "1:rule", "only Micromajig tokens and horsemajigs: a plain character and a non-token majig entering play ask nothing", () => {
  const g = pwnyBoard({
    extra: [
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "hand" },
      { key: "improved", def: character({ name: "Improved Micromajig", subtype: ["majig"], strength: 1, life: 2, speed: 2 }), owner: P1, zone: "hand" }
    ]
  });
  const { engine, id } = g;
  play(engine, P1, id("plain"));
  assert.equal(zoneOf(engine, id("plain")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "plain character: no prompt");
  play(engine, P1, id("improved"));
  assert.equal(zoneOf(engine, id("improved")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "a majig that is not a Micromajig token: no prompt");
  assert.equal(hostOf(engine, id("pb")), id("host"));
});

clause(PWNY, "1:rule", "the bomb has to be in play to attach: one still in my hand does not react to a horsemajig entering", () => {
  const g = pwnyBoard({ bombZone: "hand", extra: withNewHorse() });
  const { engine, id } = g;
  playNewHorse(g);
  assert.equal(zoneOf(engine, id("newHorse")), "play");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("pb")), "hand");
});

// --- 2:ability  PWNED ----------------------------------------------------------

clause(PWNY, "2:ability:pwny-bomb-pwned", "COST: destroy this card (paid at activation, before the damage), then exactly 7 damage to the picked character and nobody else", () => {
  const g = pwnyBoard();
  const { engine, id } = g;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "pwny-bomb-pwned", selected: { ch: [id("foe")] }, variables: {} } as never);
  assert.equal(zoneOf(engine, id("pb")), "discard", "destroyed as a cost");
  assert.equal(damageOn(engine, id("foe")), 0, "no damage yet: that is the effect");
  resolvePendingResponses(engine);
  assert.equal(damageOn(engine, id("foe")), 7, "exactly 7 to the picked character (life 8 survives)");
  assert.equal(live(engine, id("foe")), true);
  assert.equal(damageOn(engine, id("weak")), 0, "the opponent's other character is not hurt");
  assert.equal(damageOn(engine, id("ally")), 0, "nor is my other character");
});

clause(PWNY, "2:ability:pwny-bomb-pwned",
  "the horsemajig/Micromajig the bomb was attached to takes 7 damage too ('Inflict 7 damage to the picked characters'): it is the first pick",
  () => {
    const g = pwnyBoard();
    const { engine, id } = g;
    pwned(g, "foe");
    assert.equal(damageOn(engine, id("foe")), 7, "the second pick takes 7 (works)");
    assert.equal(damageOn(engine, id("host")), 7, "the picked host takes 7 as well");
    assert.equal(live(engine, id("host")), true, "life 11 without the bomb, so it survives 7");
  }
);

clause(PWNY, "2:ability:pwny-bomb-pwned", "a picked character with 7 life or less is destroyed", () => {
  const g = pwnyBoard();
  const { engine, id } = g;
  pwned(g, "weak");
  assert.equal(zoneOf(engine, id("weak")), "discard", "7 damage on life 7");
  assert.equal(zoneOf(engine, id("pb")), "discard");
  assert.equal(live(engine, id("foe")), true);
});

clause(PWNY, "2:ability:pwny-bomb-pwned", "the bomb is destroyed BEFORE the damage, so a horsemajig with 7 base life (8 with the bomb) is killed by its own 7 damage", () => {
  const g = pwnyBoard({ host: horse("Fragile", { life: 7 }) });
  const { engine, id } = g;
  assert.equal(engine.getStat(id("host"), "life"), 8);
  pwned(g, "foe");
  assert.equal(zoneOf(engine, id("host")), "discard", "7 damage on its own life of 7");
  assert.equal(damageOn(engine, id("foe")), 7);
});

clause(PWNY, "2:ability:pwny-bomb-pwned", "the second pick may be any character in play: my own character or the opponent's", () => {
  const mine = pwnyBoard();
  pwned(mine, "ally");
  assert.equal(zoneOf(mine.engine, mine.id("ally")), "discard", "my own character (life 4) takes 7");
  const theirs = pwnyBoard();
  pwned(theirs, "foe");
  assert.equal(damageOn(theirs.engine, theirs.id("foe")), 7);
});

clause(PWNY, "2:ability:pwny-bomb-pwned", "only a character in play can be picked: an item, a location, a character in hand, or nothing at all is refused", () => {
  const ok = pwnyBoard();
  pwned(ok, "foe");
  assert.equal(zoneOf(ok.engine, ok.id("pb")), "discard", "a character works (positive control)");
  for (const key of ["relic", "myRelic", "shrine", "inHand"]) {
    const g = pwnyBoard();
    refused(() => pwned(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("pb")), "play", `${key}: the bomb was not destroyed`);
    assert.equal(damageOn(g.engine, g.id("host")), 0);
  }
  const none = pwnyBoard();
  refused(() => activate(none.engine, P1, none.id("pb"), "pwny-bomb-pwned", { selected: {} }), "no character picked");
  assert.equal(zoneOf(none.engine, none.id("pb")), "play");
});

clause(PWNY, "2:ability:pwny-bomb-pwned", "the host must be a Micromajig token or a horsemajig: a plain character or a non-token majig as host is refused", () => {
  const ok = pwnyBoard();
  pwned(ok, "foe");
  assert.equal(damageOn(ok.engine, ok.id("foe")), 7, "horsemajig host works (positive control)");
  for (const [why, host] of [
    ["plain character", character({ name: "Plain", strength: 1, life: 20, speed: 1 })],
    ["non-token majig", character({ name: "Improved Micromajig", subtype: ["majig"], strength: 1, life: 20, speed: 1 })]
  ] as Array<[string, CardDefinition]>) {
    const g = pwnyBoard({ host });
    refused(() => pwned(g, "foe"), `host is a ${why}`);
    assert.equal(zoneOf(g.engine, g.id("pb")), "play", "the bomb stays");
    assert.equal(damageOn(g.engine, g.id("foe")), 0);
    assert.equal(damageOn(g.engine, g.id("host")), 0);
  }
});

clause(PWNY, "2:ability:pwny-bomb-pwned",
  "a real Micromajig TOKEN (made by the Maker) qualifies as the host: PWNED deals 7 to it (destroying it) and 7 to the picked character",
  () => {
    const g = pwnyBoard({ extra: withMaker() });
    const { engine, id } = g;
    const token = realToken(g);
    activate(engine, P1, id("pb"), "pwny-bomb-move", { selected: { mv: [token] } });
    assert.equal(hostOf(engine, id("pb")), token, "bomb moved onto the real Micromajig token");
    activate(engine, P1, id("pb"), "pwny-bomb-pwned", { selected: { ch: [id("foe")] } });
    assert.equal(zoneOf(engine, id("pb")), "discard");
    assert.equal(live(engine, token), false, "the token took 7 and died");
    assert.equal(damageOn(engine, id("foe")), 7);
  }
);

// Unsure reading: the host picked again as "a character" is ONE picked character, so 7 damage, not 14. It passes today only
// because the host never takes the attached-character damage at all (see p2-6); expect it to need a rules decision after that fix.
clause(PWNY, "2:ability:pwny-bomb-pwned", "picking the same character twice (the host as the second pick) damages that one picked character 7, not 14", () => {
  const g = pwnyBoard({ host: horse("Tank", { life: 30 }) });
  const { engine, id } = g;
  pwned(g, "host");
  assert.equal(zoneOf(engine, id("pb")), "discard");
  assert.equal(damageOn(engine, id("host")), 7, "'7 damage to the picked characters': one character picked, 7 damage");
});

clause(PWNY, "2:ability:pwny-bomb-pwned", "host picked twice, lethal boundary: one picked character takes 7 once. Base life 13 survives with exactly 7 damage (14 would kill it); base life 7 dies (the bomb's +1 life is gone first)", () => {
  const sturdy = pwnyBoard({ host: horse("Sturdy", { life: 13 }) });
  pwned(sturdy, "host");
  assert.equal(zoneOf(sturdy.engine, sturdy.id("pb")), "discard");
  assert.equal(zoneOf(sturdy.engine, sturdy.id("host")), "play", "7 damage, not 14, on life 13");
  assert.equal(damageOn(sturdy.engine, sturdy.id("host")), 7);
  const fragile = pwnyBoard({ host: horse("Fragile", { life: 7 }) });
  pwned(fragile, "host");
  assert.equal(zoneOf(fragile.engine, fragile.id("host")), "discard", "7 damage on base life 7 (the bomb was destroyed as a cost)");
});

// --- 3:ability  MOVE -------------------------------------------------------------

clause(PWNY, "3:ability:pwny-bomb-move", "COST: pay 3 (exactly): the bomb moves to the picked character of mine, stays in play, and its +1/+1 moves with it", () => {
  const g = pwnyBoard();
  const { engine, id } = g;
  moveTo(g, "ally");
  assert.equal(ready(engine), 3, "6 resources, 3 paid");
  assert.equal(hostOf(engine, id("pb")), id("ally"));
  assert.equal(zoneOf(engine, id("pb")), "play");
  assert.deepEqual(stats(engine, id("ally")), [3, 5, 2], "ally 2/4 becomes 3/5");
  assert.deepEqual(stats(engine, id("host")), [2, 11, 2], "the old host lost the bonus");
});

clause(PWNY, "3:ability:pwny-bomb-move", "one resource short (2 of 3) is refused and costs nothing; exactly 3 is enough", () => {
  const short = pwnyBoard({ icons: 2 });
  refused(() => moveTo(short, "ally"), "only 2 resources");
  assert.equal(hostOf(short.engine, short.id("pb")), short.id("host"));
  assert.equal(ready(short.engine), 2);
  const exact = pwnyBoard({ icons: 3 });
  moveTo(exact, "ally");
  assert.equal(hostOf(exact.engine, exact.id("pb")), exact.id("ally"));
  assert.equal(ready(exact.engine), 0);
});

clause(PWNY, "3:ability:pwny-bomb-move", "the pick must be a character I control: the opponent's character, items, locations, a character in hand, or no pick are refused", () => {
  for (const key of ["foe", "myRelic", "relic", "shrine", "inHand"]) {
    const g = pwnyBoard();
    refused(() => moveTo(g, key), `picking ${key}`);
    assert.equal(hostOf(g.engine, g.id("pb")), g.id("host"), `${key}: the bomb did not move`);
    assert.equal(ready(g.engine), 6, `${key}: nothing was paid`);
  }
  const none = pwnyBoard();
  refused(() => activate(none.engine, P1, none.id("pb"), "pwny-bomb-move", { selected: {} }), "no character picked");
  assert.equal(ready(none.engine), 6);
});

clause(PWNY, "3:ability:pwny-bomb-move", "the host it is attached to does not matter: from a plain character it still moves, and PWNED works only once it sits on a majig", () => {
  const g = pwnyBoard({ host: character({ name: "Plain", strength: 1, life: 3, speed: 1 }), extra: [{ key: "horse2", def: horse("Horse Two"), owner: P1, zone: "play" }] });
  const { engine, id } = g;
  refused(() => pwned(g, "foe"), "attached to a plain character");
  moveTo(g, "horse2");
  assert.equal(hostOf(engine, id("pb")), id("horse2"));
  pwned(g, "foe");
  assert.equal(damageOn(engine, id("foe")), 7, "now it can be PWNED");
  assert.equal(zoneOf(engine, id("pb")), "discard");
});

clause(PWNY, "3:ability:pwny-bomb-move", "'if you can': if the picked character is gone by the time it resolves, the bomb stays on its current host (and is not lost)", () => {
  const g = pwnyBoard({ extra: [{ key: "assassin", def: zapper(99, "Assassin"), owner: P2, zone: "play" }] });
  const { engine, id } = g;
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("pb"), abilityId: "pwny-bomb-move", selected: { mv: [id("ally")] }, variables: {} } as never);
  assert.equal(ready(engine), 3, "the 3 were paid as a cost");
  engine.perform({ type: "activateAbility", playerId: P2, cardId: id("assassin"), abilityId: "zap", selected: { t: [id("ally")] }, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "discard", "the picked character was killed in response");
  assert.equal(zoneOf(engine, id("pb")), "play", "the bomb is still in play");
  assert.equal(hostOf(engine, id("pb")), id("host"), "still on its old host");
  assert.deepEqual(stats(engine, id("host")), [3, 12, 2]);
});

// =================================================================================
// R3p347 0ff3nd3r — character, cost 3, [E][E][E], 2 str / 3 spd / 2 life, AGGRO
// This card can attack even if it has not been in play under your control since the start of your turn.
// When this card enters play, you may pay 2. If you do, put a token on it.
// While there is a token on this card, it gains 1 strength and 1 life.
// P3PP3R 61457 -- COST: Remove a token from this card. Use this only once per turn.
//   EFFECT: This turn, this character gains 1 strength and 1 life. Restore it.
// =================================================================================

const OFFENDER = "969e0f4d-8320-4a06-8fb0-2502da819c8e";

function offBoard(o: { icons?: number; inPlay?: boolean; tokens?: number; depleted?: boolean; turn?: number; active?: Pid; extra?: CardPlacement[] } = {}): Game {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "ro", def: printing(OFFENDER), owner: P1, zone: o.inPlay ? "play" : "hand", depleted: o.depleted, ...(o.tokens ? { counters: { token: o.tokens } } : {}) },
      { key: "ally", def: character({ name: "Ally", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 3, speed: 1, cost: 1 }), owner: P1, zone: "hand" },
      { key: "raider", def: character({ name: "Raider", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...bank("elitism", o.icons ?? 12, P1),
      ...bank("elitism", 6, P2),
      ...decks(),
      ...(o.extra ?? [])
    ]
  });
}
/** Deploys R3p347 and answers its "may pay 2" prompt. */
function deployOffender(g: Game, pay: boolean): void {
  play(g.engine, P1, g.id("ro"));
  drain(g.engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("ro")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
}
const pepper = (g: Game) => activate(g.engine, P1, g.id("ro"), "repeat-offender-pepper-blast");

clause(OFFENDER, "0:rule", "AGGRO: it can attack the turn it enters play, which an ordinary character deployed the same turn cannot", () => {
  const g = offBoard();
  const { engine, id } = g;
  deployOffender(g, false);
  play(engine, P1, id("plain"));
  assert.equal(zoneOf(engine, id("plain")), "play");
  refused(() => declareAttackBy(engine, P1, [id("plain")]), "an ordinary character deployed this turn", /attack|eligible|started|turn/i);
  assert.equal(engine.state.battle, undefined);
  declareAttackBy(engine, P1, [id("ro")]);
  assert.ok(engine.state.battle, "R3p347 attacks on the turn it entered");
  assert.ok(engine.getKeywords(id("ro")).includes("aggro"), "engine.getKeywords(id(\"ro\")).includes(\"aggro\")");
});

clause(OFFENDER, "0:rule", "AGGRO belongs to this card only: a character in play from before can attack, and an ordinary newcomer next to it still cannot", () => {
  const g = offBoard();
  const { engine, id } = g;
  deployOffender(g, false);
  assert.equal(engine.getKeywords(id("ally")).includes("aggro"), false);
  assert.equal(engine.getKeywords(id("raider")).includes("aggro"), false);
  play(engine, P1, id("plain"));
  assert.equal(engine.getKeywords(id("plain")).includes("aggro"), false, "no aggro for the newcomer beside it");
});

clause(OFFENDER, "1:rule", "enters play and I pay 2: exactly 2 more resources are spent (cost 3 + 2) and exactly one token is put on it", () => {
  const g = offBoard({ icons: 8 });
  const { engine, id } = g;
  deployOffender(g, true);
  assert.equal(ready(engine), 3, "8 - 3 for the card - 2 for the token");
  assert.equal(tokensOn(engine, id("ro")), 1);
});

clause(OFFENDER, "1:rule", "'you may pay 2': declining spends nothing more and puts no token on it", () => {
  const g = offBoard({ icons: 8 });
  const { engine, id } = g;
  deployOffender(g, false);
  assert.equal(ready(engine), 5, "only the 3 for the card");
  assert.equal(tokensOn(engine, id("ro")), 0);
});

clause(OFFENDER, "1:rule", "it needs 2 more than the deploy cost: with exactly 5 resources I can pay, with 4 (one short) no token", () => {
  const exact = offBoard({ icons: 5 });
  deployOffender(exact, true);
  assert.equal(tokensOn(exact.engine, exact.id("ro")), 1, "exactly 5 is enough");
  assert.equal(ready(exact.engine), 0);
  const short = offBoard({ icons: 4 });
  deployOffender(short, true);
  assert.equal(tokensOn(short.engine, short.id("ro")), 0, "only 1 resource left after the deploy: cannot pay 2");
  assert.equal(ready(short.engine), 1, "and nothing was paid");
});

clause(OFFENDER, "1:rule", "'when THIS card enters play': another card entering play, even a second R3p347, puts no token on the one already in play", () => {
  const g = offBoard({ inPlay: true, extra: [{ key: "ro2", def: printing(OFFENDER), owner: P1, zone: "hand" }] });
  const { engine, id } = g;
  play(engine, P1, id("plain"));
  assert.equal(engine.state.pendingChoice, undefined, "nothing asked for a plain character");
  assert.equal(tokensOn(engine, id("ro")), 0);
  play(engine, P1, id("ro2"));
  drain(engine, (pc) => (pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : declineAll(pc)));
  assert.equal(tokensOn(engine, id("ro")), 0, "the first one is untouched");
  assert.equal(tokensOn(engine, id("ro2")), 1, "the one that entered got its token (positive control)");
});

clause(OFFENDER, "2:rule", "while there is a token it gains 1 strength and 1 life (2/2 becomes 3/3, speed stays 3); with no token it is 2/2/3", () => {
  const none = offBoard({ inPlay: true });
  assert.deepEqual(stats(none.engine, none.id("ro")), [2, 2, 3]);
  const one = offBoard({ inPlay: true, tokens: 1 });
  assert.deepEqual(stats(one.engine, one.id("ro")), [3, 3, 3]);
});

clause(OFFENDER, "2:rule", "the bonus is 1/1 whatever the number of tokens (2 tokens are still 3/3)", () => {
  const two = offBoard({ inPlay: true, tokens: 2 });
  assert.deepEqual(stats(two.engine, two.id("ro")), [3, 3, 3]);
});

clause(OFFENDER, "2:rule", "the token must be on THIS card: another character's token, or another R3p347's, gives it nothing", () => {
  const g = offBoard({ inPlay: true, extra: [{ key: "ro2", def: printing(OFFENDER), owner: P1, zone: "play", counters: { token: 1 } }, { key: "tokened", def: character({ name: "Tokened", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play", counters: { token: 1 } }] });
  const { engine, id } = g;
  assert.deepEqual(stats(engine, id("ro2")), [3, 3, 3], "the one with the token (positive control)");
  assert.deepEqual(stats(engine, id("ro")), [2, 2, 3], "the one without it");
  assert.deepEqual(stats(engine, id("tokened")), [1, 3, 1], "an ordinary character with a token is not affected");
});

clause(OFFENDER, "2:rule", "a token does not survive the card leaving play (CR 409.2): returned to hand it has none, and back in play it is 2/2 with no token", () => {
  const g = offBoard({ inPlay: true, tokens: 1, extra: [{ key: "bounce", def: bounce(), owner: P1, zone: "hand" }] });
  const { engine, id } = g;
  assert.deepEqual(stats(engine, id("ro")), [3, 3, 3]);
  play(engine, P1, id("bounce"), { selected: { t: [id("ro")] } });
  assert.equal(zoneOf(engine, id("ro")), "hand", "returned to hand");
  assert.equal(tokensOn(engine, id("ro")), 0, "its token disappeared when it left play (CR 409.2)");
  deployOffender(g, false);
  assert.equal(tokensOn(engine, id("ro")), 0);
  assert.deepEqual(stats(engine, id("ro")), [2, 2, 3]);
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "COST: remove a token (exactly one of 3); EFFECT: +1/+1 this turn on top of the token bonus (2 base + 1 + 1 = 4/4), and a depleted R3p347 is restored", () => {
  const g = offBoard({ inPlay: true, tokens: 3, depleted: true });
  const { engine, id } = g;
  assert.equal(isDepleted(engine, id("ro")), true);
  assert.deepEqual(stats(engine, id("ro")), [3, 3, 3]);
  pepper(g);
  assert.equal(tokensOn(engine, id("ro")), 2, "exactly one token removed");
  assert.deepEqual(stats(engine, id("ro")), [4, 4, 3], "token bonus still on (tokens left) plus the temporary +1/+1");
  assert.equal(isDepleted(engine, id("ro")), false, "restored");
  assert.equal(zoneOf(engine, id("ro")), "play");
  assert.deepEqual(stats(engine, id("ally")), [1, 3, 1], "other characters are not buffed");
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "with a single token: using it removes that token (its static bonus) and the temporary +1/+1 takes over: still 3/3 this turn, 2/2 next turn", () => {
  const g = offBoard({ inPlay: true, tokens: 1 });
  const { engine, id } = g;
  pepper(g);
  assert.equal(tokensOn(engine, id("ro")), 0);
  assert.deepEqual(stats(engine, id("ro")), [3, 3, 3], "temporary +1/+1 this turn");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.deepEqual(stats(engine, id("ro")), [2, 2, 3], "the temporary bonus ended, and the token is gone");
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "the +1/+1 lasts only THIS turn: with 2 tokens it is 4/4 now and 3/3 (token bonus only) next turn", () => {
  const g = offBoard({ inPlay: true, tokens: 2 });
  const { engine, id } = g;
  pepper(g);
  assert.deepEqual(stats(engine, id("ro")), [4, 4, 3]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("ro")), 1);
  assert.deepEqual(stats(engine, id("ro")), [3, 3, 3]);
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "refused with no token on the card; allowed with one", () => {
  const none = offBoard({ inPlay: true });
  refused(() => pepper(none), "no token to remove");
  assert.deepEqual(stats(none.engine, none.id("ro")), [2, 2, 3], "no buff from the refused use");
  const one = offBoard({ inPlay: true, tokens: 1 });
  pepper(one);
  assert.equal(tokensOn(one.engine, one.id("ro")), 0);
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "'only once per turn': a second use the same turn is refused even with tokens left; it is usable again next turn", () => {
  const g = offBoard({ inPlay: true, tokens: 3 });
  const { engine, id } = g;
  pepper(g);
  assert.equal(tokensOn(engine, id("ro")), 2);
  refused(() => pepper(g), "already used this turn", /only 1 time|each turn|once/i);
  assert.equal(tokensOn(engine, id("ro")), 2, "the refused use removed nothing");
  assert.deepEqual(stats(engine, id("ro")), [4, 4, 3], "and gave nothing");
  endTurn(engine, P1);
  endTurn(engine, P2);
  pepper(g);
  assert.equal(tokensOn(engine, id("ro")), 1, "allowed again on my next turn");
});

clause(OFFENDER, "3:ability:repeat-offender-pepper-blast", "usable in response on the opponent's turn: a depleted R3p347 is restored in time to block, with its extra life", () => {
  const g = offBoard({ inPlay: true, tokens: 1, depleted: true, turn: 2, active: P2 });
  const { engine, id } = g;
  declareAttackOpenWindow(engine, P2, [id("raider")]);
  engine.perform({ type: "activateAbility", playerId: P1, cardId: id("ro"), abilityId: "repeat-offender-pepper-blast", selected: {}, variables: {} } as never);
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("ro")), false, "restored");
  assert.equal(tokensOn(engine, id("ro")), 0);
  declareBlockers(engine, P1, [id("ro")]);
  assert.ok(engine.state.battle, "it blocks");
});

// =================================================================================
// Reluctant Reconciliation — tactic, cost 1, [E]
// COST: Pick a character. EFFECT: Restore that character. This turn, it cannot attack.
// =================================================================================

const RECON = "f1b6d378-94ee-487a-bf78-b529b2131c94";

function rrBoard(o: { icons?: number; rage?: number; turn?: number; active?: Pid } = {}): Game {
  return buildGame({
    turn: o.turn,
    activePlayerId: o.active,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "rr", def: printing(RECON), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "mine2", def: character({ name: "Mine Two", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play", depleted: true },
      { key: "fresh", def: character({ name: "Fresh", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play", depleted: true },
      { key: "raider", def: character({ name: "Raider", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "myRelic", def: item({ name: "My Relic" }), owner: P1, zone: "play" },
      { key: "shrine", def: location({ name: "Shrine", structure: 20 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "In Hand", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "hand" },
      ...bank("elitism", o.icons ?? 3, P1),
      ...(o.rage ? bank("rage", o.rage, P1) : []),
      ...bank("elitism", 3, P2),
      ...decks()
    ]
  });
}
const cast = (g: Game, pick: string) => play(g.engine, P1, g.id("rr"), { selected: { ch: [g.id(pick)] } });

clause(RECON, "0:ability", "cost 1: exactly one resource is paid and the tactic goes to the discard pile after resolving", () => {
  const g = rrBoard();
  const { engine, id } = g;
  cast(g, "mine");
  assert.equal(ready(engine), 2, "3 resources, 1 paid");
  assert.equal(zoneOf(engine, id("rr")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RECON, "0:ability", "refused with no resource, or with 5 resources but none of them [E] (threshold E); the tactic stays in hand", () => {
  const broke = rrBoard({ icons: 0 });
  refused(() => cast(broke, "mine"), "no resources");
  assert.equal(zoneOf(broke.engine, broke.id("rr")), "hand");
  assert.equal(isDepleted(broke.engine, broke.id("mine")), true);
  const wrongIcon = rrBoard({ icons: 0, rage: 5 });
  refused(() => cast(wrongIcon, "mine"), "five [R] resources, no [E]");
  assert.equal(zoneOf(wrongIcon.engine, wrongIcon.id("rr")), "hand");
  assert.equal(isDepleted(wrongIcon.engine, wrongIcon.id("mine")), true);
  const ok = rrBoard({ icons: 1 });
  cast(ok, "mine");
  assert.equal(isDepleted(ok.engine, ok.id("mine")), false, "one [E] is enough (positive control)");
});

clause(RECON, "0:ability", "restores the picked character, mine or the opponent's, and only that one", () => {
  const own = rrBoard();
  cast(own, "mine");
  assert.equal(isDepleted(own.engine, own.id("mine")), false, "my depleted character is restored");
  assert.equal(isDepleted(own.engine, own.id("mine2")), true, "my other depleted character is not");
  assert.equal(isDepleted(own.engine, own.id("foe")), true, "nor the opponent's");
  const theirs = rrBoard();
  cast(theirs, "foe");
  assert.equal(isDepleted(theirs.engine, theirs.id("foe")), false, "the opponent's depleted character is restored");
  assert.equal(isDepleted(theirs.engine, theirs.id("mine")), true);
});

clause(RECON, "0:ability", "a character that is not depleted can be picked too: it stays ready (and still cannot attack this turn)", () => {
  const g = rrBoard();
  const { engine, id } = g;
  cast(g, "fresh");
  assert.equal(isDepleted(engine, id("fresh")), false);
  refused(() => declareAttackBy(engine, P1, [id("fresh")]), "picked this turn", /attack|cannot|can't/i);
  assert.equal(engine.state.battle, undefined);
});

clause(RECON, "0:ability", "'this turn it cannot attack': the restored character is refused as an attacker, while another ready character can attack", () => {
  const g = rrBoard();
  const { engine, id } = g;
  cast(g, "mine");
  assert.equal(isDepleted(engine, id("mine")), false, "it is ready, so only the restriction stops it");
  assert.ok(engine.getRestrictions(id("mine")).includes("cannotAttack"), "engine.getRestrictions(id(\"mine\")).includes(\"cannotAttack\")");
  refused(() => declareAttackBy(engine, P1, [id("mine")]), "restored but cannot attack", /attack|cannot|can't/i);
  assert.equal(engine.state.battle, undefined);
  declareAttackBy(engine, P1, [id("fresh")]);
  assert.ok(engine.state.battle, "a character that was not picked attacks fine (positive control)");
});

clause(RECON, "0:ability", "the restriction ends with the turn: my picked character can attack on my next turn", () => {
  const g = rrBoard();
  const { engine, id } = g;
  cast(g, "mine");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getRestrictions(id("mine")).includes("cannotAttack"), false);
  declareAttackBy(engine, P1, [id("mine")]);
  assert.ok(engine.state.battle, "it attacks again");
});

clause(RECON, "0:ability", "the opponent's picked character can attack on their own turn: 'this turn' ended with mine", () => {
  const g = rrBoard();
  const { engine, id } = g;
  cast(g, "foe");
  assert.ok(engine.getRestrictions(id("foe")).includes("cannotAttack"), "engine.getRestrictions(id(\"foe\")).includes(\"cannotAttack\")");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getRestrictions(id("foe")).includes("cannotAttack"), false);
  declareAttackBy(engine, P2, [id("foe")]);
  assert.ok(engine.state.battle, "it attacks on their turn");
});

clause(RECON, "0:ability", "only a character in play can be picked: an item, a location, a faction, a character in hand, or no pick at all is refused", () => {
  const ok = rrBoard();
  cast(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("rr")), "discard", "a character works (positive control)");
  for (const key of ["myRelic", "shrine", "inHand"]) {
    const g = rrBoard();
    refused(() => cast(g, key), `picking ${key}`);
    assert.equal(zoneOf(g.engine, g.id("rr")), "hand", `${key}: the tactic was not played`);
    assert.equal(ready(g.engine), 3, `${key}: nothing was paid`);
  }
  const faction = rrBoard();
  refused(() => play(faction.engine, P1, faction.id("rr"), { selected: { ch: [factionOf(faction.engine, P2)] } }), "a faction (CR 202.9a)");
  assert.equal(zoneOf(faction.engine, faction.id("rr")), "hand");
  const none = rrBoard();
  refused(() => play(none.engine, P1, none.id("rr"), { selected: {} }), "no character picked");
  assert.equal(zoneOf(none.engine, none.id("rr")), "hand");
});

clause(RECON, "0:ability", "a tactic: it can be played in response during the opponent's turn, restoring my depleted character in time to block; without it that character cannot block", () => {
  const withRr = rrBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(withRr.engine, P2, [withRr.id("raider")]);
  engine_play(withRr);
  resolvePendingResponses(withRr.engine);
  assert.equal(isDepleted(withRr.engine, withRr.id("mine")), false, "restored in the response window");
  declareBlockers(withRr.engine, P1, [withRr.id("mine")]);
  assert.ok(withRr.engine.state.battle, "the restored character blocks (cannot attack does not stop blocking)");
  const without = rrBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(without.engine, P2, [without.id("raider")]);
  resolvePendingResponses(without.engine);
  refused(() => declareBlockers(without.engine, P1, [without.id("mine")]), "depleted characters cannot block");
});

function engine_play(g: Game): void {
  g.engine.perform({ type: "playCard", playerId: P1, cardId: g.id("rr"), selected: { ch: [g.id("mine")] }, variables: {} } as never);
}
