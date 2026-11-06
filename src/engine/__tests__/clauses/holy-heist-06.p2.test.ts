// Clause tests — batch holy-heist-06, part p2 (groups 6-12, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-06 --groups 6-12 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  bank,
  character,
  developFaction,
  item,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow, holdCostChoices } from "./_clause.js";
import { answerPending, declareBlockers, pending, readyResources, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { endTurn } from "./_turn.js";
import type { CardPlacement } from "../support/fixtures.js";
import type { CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

/** Two-player board with the generic Develop-capable factions. */
function duo(cards: CardPlacement[], opts: { turn?: number; active?: PlayerId; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random,
    cards
  });
}

const WIN = () => 0.1;
const LOSE = () => 0.9;

/** Raw `activateAbility` WITHOUT draining the response window. */
function rawActivate(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}
/** `activateAbility`, then the response window is drained. */
function use(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {}
): void {
  rawActivate(engine, player, cardId, abilityId, selected);
  resolvePendingResponses(engine);
}
function rawFlipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {}, variables: {} });
  resolvePendingResponses(engine);
}
const coinFlips = (engine: SpoilsEngine) =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => (entry.event as unknown as { won: boolean }).won);
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): [number, number, number] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

// =====================================================================================
// Flashy Bangs — item (rogue), cost 1, threshold [D][D]
// BURST -- COST: Pick a blocking character. Destroy this card. -- EFFECT: Remove the character from the battle.
// Deplete it. -- FLIP UP: 1 [D][D]
// =====================================================================================

const BANGS = "5c78097b-5ba3-4417-96af-a465cd276977";

/** P1 (active) holds Flashy Bangs and attacks with `atk`; P2 has two would-be blockers and an idle character. Blockers declared. */
function bangsBattle() {
  const g = duo([
    { key: "fb", def: printing(BANGS), owner: P1, zone: "play" },
    { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
    { key: "blk2", def: character({ name: "Blk2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
    { key: "idle", def: character({ name: "Idle", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
  ]);
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("blk"), g.id("blk2")]);
  return g;
}

clause(BANGS, "0:ability:flashy-bangs-burst", "BURST removes the picked blocker from the battle and depletes it; the other blocker stays in the battle undepleted", () => {
  const { engine, id } = bangsBattle();
  assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), true, "setup: blk is blocking");
  assert.equal(engine.state.cards[id("blk")].depleted, false, "setup: blk is ready");
  use(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk")] });
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), false, "removed from the battle");
  assert.equal(engine.state.cards[id("blk")].depleted, true, "depleted");
  assert.equal(zoneOf(engine, id("blk")), "play", "still in play: removed from the battle, not from the game");
  assert.equal(engine.state.battle?.blockingParty.includes(id("blk2")), true, "the other blocker is untouched");
  assert.equal(engine.state.cards[id("blk2")].depleted, false);
  assert.equal(engine.state.cards[id("idle")].depleted, false);
});

clause(BANGS, "0:ability:flashy-bangs-burst", "COST: this card is destroyed and nothing else is paid", () => {
  const { engine, id } = bangsBattle();
  const before = readyResources(engine, P1);
  rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk")] });
  assert.equal(zoneOf(engine, id("fb")), "discard", "destroyed as a cost, before the ability resolves");
  assert.equal(engine.state.cards[id("blk")].depleted, false, "the effect has not resolved yet");
  resolvePendingResponses(engine);
  assert.equal(readyResources(engine, P1), before, "no resources paid");
  assert.equal(engine.state.cards[id("blk")].depleted, true);
});

clause(BANGS, "0:ability:flashy-bangs-burst", "the removed blocker no longer fights: the attacker takes damage only from the remaining blocker, and the removed blocker takes none", () => {
  const burst = bangsBattle();
  use(burst.engine, P1, burst.id("fb"), "flashy-bangs-burst", { b: [burst.id("blk")] });
  finishBattle(burst.engine);
  assert.equal(burst.engine.state.cards[burst.id("atk")].damage, 1, "only blk2's 1 strength lands");
  assert.equal(burst.engine.state.cards[burst.id("blk")].damage, 0, "the removed blocker takes no damage");
  assert.equal(burst.engine.state.cards[burst.id("blk2")].damage, 2, "control: the remaining blocker is hit");
  const control = bangsBattle();
  finishBattle(control.engine);
  assert.equal(control.engine.state.cards[control.id("atk")].damage, 2, "control: with no Burst both blockers hit");
});

clause(BANGS, "0:ability:flashy-bangs-burst", "the picked character must be a blocking character: the attacker and a character outside the battle are refused", () => {
  const { engine, id } = bangsBattle();
  refused(() => rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("atk")] }), "the attacker is not a blocker");
  assert.equal(zoneOf(engine, id("fb")), "play", "nothing was paid");
  refused(() => rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("idle")] }), "a character not in the battle");
  assert.equal(zoneOf(engine, id("fb")), "play", "nothing was paid");
  rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk2")] });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("blk2")].depleted, true, "control: a blocker can be picked (either one)");
  assert.equal(engine.state.cards[id("blk")].depleted, false);
});

clause(BANGS, "0:ability:flashy-bangs-burst", "it cannot be used with no battle (no blocking character exists)", () => {
  const { engine, id } = duo([
    { key: "fb", def: printing(BANGS), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk" }), owner: P2, zone: "play" }
  ]);
  refused(() => rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk")] }), "no battle in progress");
  assert.equal(zoneOf(engine, id("fb")), "play");
  assert.equal(engine.state.cards[id("blk")].depleted, false);
});

clause(BANGS, "0:ability:flashy-bangs-burst", "any blocking character can be picked, including one its controller owns: P1's Flashy Bangs on P1's own blocker in P2's attack", () => {
  const { engine, id } = duo(
    [
      { key: "fb", def: printing(BANGS), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P1, zone: "play" }
    ],
    { active: P2 }
  );
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("blk")]);
  engine.perform({ type: "passPriority", playerId: P2 });
  rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk")] });
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("blk")].depleted, true);
  assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), false);
  assert.equal(zoneOf(engine, id("fb")), "discard");
});

clause(BANGS, "0:ability:flashy-bangs-burst", "a face-down Flashy Bangs (a resource) has no BURST to use", () => {
  const { engine, id } = duo([
    { key: "fb", def: printing(BANGS), owner: P1, zone: "play", faceDown: true },
    { key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 3 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
  ]);
  declareAttackBy(engine, P1, [id("atk")]);
  declareBlockers(engine, P2, [id("blk")]);
  refused(() => rawActivate(engine, P1, id("fb"), "flashy-bangs-burst", { b: [id("blk")] }), "face-down cards have no abilities");
  assert.equal(engine.state.battle?.blockingParty.includes(id("blk")), true);
  assert.equal(engine.state.cards[id("fb")].faceDown, true);
});

/** A face-down Flashy Bangs among `d` Deception and `r` Rage resources (+ `spentD` spent Deception). */
function bangsFlip(o: { d?: number; r?: number; active?: PlayerId; spentAll?: boolean } = {}) {
  const attach = (p: CardPlacement): CardPlacement => (o.spentAll ? { ...p, attachedToKey: "__factionA" } : p);
  return duo(
    [
      attach({ key: "fb", def: printing(BANGS), owner: P1, zone: "play", faceDown: true }),
      ...bank("deception", o.d ?? 0, P1).map(attach),
      ...bank("rage", o.r ?? 0, P1).map(attach),
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }
    ],
    { active: o.active ?? P1 }
  );
}

clause(BANGS, "1:flipUp", "a face-down Flashy Bangs flips up for 1 with [D][D] into a face-up item in play, no longer a resource", () => {
  const { engine, id } = bangsFlip({ d: 2, r: 4 });
  assert.equal(readyResources(engine, P1), 7, "setup: the face-down card plus six resources");
  rawFlipUp(engine, P1, id("fb"));
  assert.equal(pending(engine), undefined);
  const card = engine.state.cards[id("fb")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, false);
  assert.deepEqual(engine.getCardTypes(id("fb")), ["item"]);
  assert.equal(engine.isResource(id("fb")), false);
  assert.equal(card.controllerId, P1);
});

clause(BANGS, "1:flipUp", "pays exactly 1: of 6 other resources one is spent and five stay ready (the flipped card itself leaves the pool)", () => {
  const { engine, id } = bangsFlip({ d: 2, r: 4 });
  rawFlipUp(engine, P1, id("fb"));
  assert.equal(engine.state.cards[id("fb")].faceDown, false);
  assert.equal(readyResources(engine, P1), 5, "7 - 1 paid - the flipped card");
});

clause(BANGS, "1:flipUp", "with only the two [D] resources it is exactly enough: the card pays toward its own cost and nothing is left over", () => {
  const { engine, id } = bangsFlip({ d: 2 });
  rawFlipUp(engine, P1, id("fb"));
  assert.equal(engine.state.cards[id("fb")].faceDown, false);
  assert.equal(readyResources(engine, P1), 1, "3 - 1 paid - the flipped card");
});

clause(BANGS, "1:flipUp", "needs [D][D]: one Deception among many other resources is refused, and nothing is paid", () => {
  const { engine, id } = bangsFlip({ d: 1, r: 5 });
  refused(() => rawFlipUp(engine, P1, id("fb")), "only one [D]");
  assert.equal(engine.state.cards[id("fb")].faceDown, true, "still face-down");
  assert.equal(readyResources(engine, P1), 7, "nothing was paid");
});

clause(BANGS, "1:flipUp", "plenty of non-Deception resources is not the threshold", () => {
  const { engine, id } = bangsFlip({ r: 6 });
  refused(() => rawFlipUp(engine, P1, id("fb")), "no [D] among the resources");
  assert.equal(engine.state.cards[id("fb")].faceDown, true);
  assert.equal(readyResources(engine, P1), 7);
});

clause(BANGS, "1:flipUp", "the opponent's [D] resources do not count toward the threshold", () => {
  const g = duo([
    { key: "fb", def: printing(BANGS), owner: P1, zone: "play", faceDown: true },
    ...bank("deception", 1, P1),
    ...bank("rage", 3, P1),
    ...bank("deception", 4, P2)
  ]);
  refused(() => rawFlipUp(g.engine, P1, g.id("fb")), "one own [D], four of the opponent's");
  assert.equal(g.engine.state.cards[g.id("fb")].faceDown, true);
});

clause(BANGS, "1:flipUp", "the cost of 1 cannot be paid when every resource is already spent: refused, still face-down", () => {
  const { engine, id } = bangsFlip({ d: 2, spentAll: true });
  refused(() => rawFlipUp(engine, P1, id("fb")), "no ready resource to pay 1");
  assert.equal(engine.state.cards[id("fb")].faceDown, true);
});

clause(BANGS, "1:flipUp", "FLIP UP does not change when an item can be deployed: refused on the opponent's turn", () => {
  const { engine, id } = bangsFlip({ d: 2, r: 2, active: P2 });
  refused(() => rawFlipUp(engine, P1, id("fb")), "an item on the opponent's turn");
  assert.equal(engine.state.cards[id("fb")].faceDown, true);
  assert.equal(readyResources(engine, P1), 5, "nothing was paid");
});

clause(BANGS, "1:flipUp", "a non-tactic (an item) cannot be flipped up inside the opponent's response window", () => {
  const { engine, id } = bangsFlip({ d: 2, r: 2, active: P2 });
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  refused(() => rawFlipUp(engine, P1, id("fb")), "an item cannot be played in a response window");
  assert.equal(engine.state.cards[id("fb")].faceDown, true);
  assert.equal(readyResources(engine, P1), 5, "nothing was paid");
});

// =====================================================================================
// Fwing Snipe — character (rogue, beast), cost 3, threshold [D][D], 1 strength / 4 speed / 1 life
// TACTICAL -- When this card enters play, you may pick a character. If you do, the character gains 1 speed this
// turn. Flip a coin. If you win, the character also gains 1 strength this turn.
// =====================================================================================

const FWING = "60944019-3b31-486d-8016-0da9a4f68221";

/** P1 holds Fwing Snipe in hand (`d` Deception, `r` Rage resources); `c` is P1's 2/4/3 character, `foe` is P2's 2/4/3 character. */
function fwingBoard(o: { d?: number; r?: number; active?: PlayerId; random?: () => number; fwing?: "hand" | "play" } = {}) {
  return duo(
    [
      { key: "fw", def: printing(FWING), owner: P1, zone: o.fwing ?? "hand" },
      { key: "c", def: character({ name: "C", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
      ...bank("deception", o.d ?? 3, P1),
      ...bank("rage", o.r ?? 0, P1)
    ],
    { active: o.active ?? P1, random: o.random }
  );
}
type FwingGame = ReturnType<typeof fwingBoard>;
/** Deploy Fwing Snipe; answer its optional pick with `pick` (or decline with undefined). */
function deployFwing(g: FwingGame, pick: string | undefined, player: PlayerId = P1): void {
  play(g.engine, player, g.id("fw"));
  drain(g.engine, (pc) =>
    pc.kind === "selectTargets"
      ? { kind: "selectTargets", selected: { c: pick ? [g.id(pick)] : [] } }
      : declineAll(pc)
  );
  assert.equal(pending(g.engine), undefined);
}

clause(FWING, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const g = fwingBoard({ fwing: "play" });
  assert.ok(g.engine.getKeywords(g.id("fw")).includes("tactical"), "g.engine.getKeywords(g.id(\"fw\")).includes(\"tactical\")");
  assert.equal(g.engine.getKeywords(g.id("c")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(FWING, "0:kw:TACTICAL", "it can be deployed from hand in the opponent's attack window, for its printed cost 3", () => {
  const g = fwingBoard({ d: 3, active: P2 });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  assert.equal(readyResources(g.engine, P1), 3);
  play(g.engine, P1, g.id("fw"));
  drain(g.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { c: [] } } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("fw")), "play", "deployed on the opponent's turn");
  assert.equal(readyResources(g.engine, P1), 0, "cost 3 paid");
});

clause(FWING, "0:kw:TACTICAL", "an ordinary character cannot be deployed in that window, nor can the TACTICAL one outside a window on the opponent's turn", () => {
  const g = duo(
    [
      { key: "fw", def: printing(FWING), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("deception", 3, P1)
    ],
    { active: P2 }
  );
  refused(() => play(g.engine, P1, g.id("fw")), "no response window open on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("fw")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => play(g.engine, P1, g.id("plain")), "a non-tactical character can't be deployed on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("plain")), "hand");
  play(g.engine, P1, g.id("fw"));
  drain(g.engine, (pc) => (pc.kind === "selectTargets" ? { kind: "selectTargets", selected: { c: [] } } : declineAll(pc)));
  assert.equal(zoneOf(g.engine, g.id("fw")), "play", "control: the TACTICAL character can");
});

clause(FWING, "0:kw:TACTICAL", "TACTICAL changes timing only: the [D][D] threshold and the cost of 3 still apply", () => {
  const noThreshold = fwingBoard({ d: 0, r: 3, active: P2 });
  declareAttackOpenWindow(noThreshold.engine, P2, [noThreshold.id("foe")]);
  refused(() => play(noThreshold.engine, P1, noThreshold.id("fw")), "no [D] at all", /threshold/i);
  assert.equal(zoneOf(noThreshold.engine, noThreshold.id("fw")), "hand");
  const oneD = fwingBoard({ d: 1, r: 2, active: P2 });
  declareAttackOpenWindow(oneD.engine, P2, [oneD.id("foe")]);
  refused(() => play(oneD.engine, P1, oneD.id("fw")), "only one [D] of the needed two", /threshold/i);
  const short = fwingBoard({ d: 2, active: P2 });
  declareAttackOpenWindow(short.engine, P2, [short.id("foe")]);
  refused(() => play(short.engine, P1, short.id("fw")), "two resources for a cost of 3");
  assert.equal(zoneOf(short.engine, short.id("fw")), "hand");
});

clause(FWING, "0:kw:TACTICAL", "in the main phase it deploys at its printed cost 3 as a 1 strength / 4 speed / 1 life character; one resource short is refused", () => {
  const g = fwingBoard({ d: 3 });
  deployFwing(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("fw")), "play");
  assert.deepEqual(stats(g.engine, g.id("fw")), [1, 1, 4]);
  assert.equal(readyResources(g.engine, P1), 0);
  const short = fwingBoard({ d: 2 });
  refused(() => play(short.engine, P1, short.id("fw")), "cost 3 with two resources");
  assert.equal(zoneOf(short.engine, short.id("fw")), "hand");
});

clause(FWING, "1:rule", "you may pick a character: the picked character gains 1 speed this turn, and the coin win also gives it 1 strength", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, "c");
  assert.deepEqual(stats(g.engine, g.id("c")), [3, 4, 4], "2/4/3 becomes strength +1 (won), speed +1, life unchanged");
});

clause(FWING, "1:rule", "a lost coin: the picked character still gains 1 speed but not the strength", () => {
  const g = fwingBoard({ random: LOSE });
  deployFwing(g, "c");
  assert.deepEqual(stats(g.engine, g.id("c")), [2, 4, 4], "speed +1 only");
});

clause(FWING, "1:rule", "only the picked character is affected: another own character and the opponent's keep their stats", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, "c");
  assert.deepEqual(stats(g.engine, g.id("other")), [2, 4, 3]);
  assert.deepEqual(stats(g.engine, g.id("foe")), [2, 4, 3]);
  assert.deepEqual(stats(g.engine, g.id("fw")), [1, 1, 4], "Fwing Snipe itself is not affected when it picks another");
});

clause(FWING, "1:rule", "the picked character may be an opponent's character", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, "foe");
  assert.deepEqual(stats(g.engine, g.id("foe")), [3, 4, 4]);
  assert.deepEqual(stats(g.engine, g.id("c")), [2, 4, 3]);
});

clause(FWING, "1:rule", "Fwing Snipe is in play when its trigger resolves, so it may pick itself (+1 speed, and +1 strength on a win)", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, "fw");
  assert.deepEqual(stats(g.engine, g.id("fw")), [2, 1, 5]);
});

clause(FWING, "1:rule", "it is a character pick: an item or a card in hand cannot be picked", () => {
  const g = duo([
    { key: "fw", def: printing(FWING), owner: P1, zone: "hand" },
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "inhand", def: character({ name: "InHand", speed: 3 }), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "C", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
    ...bank("deception", 3, P1)
  ]);
  play(g.engine, P1, g.id("fw"));
  const pc = pending(g.engine) as unknown as { kind: string; targets?: unknown; candidates?: unknown };
  assert.equal(pc.kind, "selectTargets");
  refused(
    () => answerPending(g.engine, "selectTargets", { selected: { c: [g.id("thing")] } }),
    "an item is not a character"
  );
  refused(
    () => answerPending(g.engine, "selectTargets", { selected: { c: [g.id("inhand")] } }),
    "a character in hand is not in play"
  );
  answerPending(g.engine, "selectTargets", { selected: { c: [g.id("c")] } });
  drain(g.engine, declineAll);
  assert.equal(g.engine.getStat(g.id("c"), "speed"), 4, "control: a character in play can be picked");
});

clause(FWING, "1:rule", "'may': declining the pick gives nobody any speed or strength", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("fw")), "play");
  for (const key of ["c", "other", "foe"]) assert.deepEqual(stats(g.engine, g.id(key)), [2, 4, 3], key);
  assert.deepEqual(stats(g.engine, g.id("fw")), [1, 1, 4], "not even Fwing Snipe itself");
});

clause(FWING, "1:rule", "the coin is a real coin flip (a coinFlipped event, one per entering) when a character is picked", () => {
  const won = fwingBoard({ random: WIN });
  deployFwing(won, "c");
  assert.deepEqual(coinFlips(won.engine), [true], "one coin flip, won");
  const lost = fwingBoard({ random: LOSE });
  deployFwing(lost, "c");
  assert.deepEqual(coinFlips(lost.engine), [false], "one coin flip, lost");
});

clause(FWING, "1:rule", "the coin is flipped even when the pick is declined (only the pick is optional, 'Flip a coin' is a separate sentence)", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, undefined);
  assert.deepEqual(coinFlips(g.engine), [true]);
});

clause(FWING, "1:rule", "the gains last 'this turn': both are gone on the next turn", () => {
  const g = fwingBoard({ random: WIN });
  deployFwing(g, "c");
  assert.deepEqual(stats(g.engine, g.id("c")), [3, 4, 4]);
  endTurn(g.engine, P1);
  assert.deepEqual(stats(g.engine, g.id("c")), [2, 4, 3], "back to printed values in the opponent's turn");
  endTurn(g.engine, P2);
  assert.deepEqual(stats(g.engine, g.id("c")), [2, 4, 3], "and still on the following turn");
});

clause(FWING, "1:rule", "the trigger is only 'when this card enters play': another character entering does not prompt or change anything, nor does a Fwing Snipe placed in play", () => {
  const g = duo([
    { key: "fw", def: printing(FWING), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain", cost: 0, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "C", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" }
  ]);
  assert.equal(pending(g.engine), undefined, "no trigger for a card that was simply in play");
  play(g.engine, P1, g.id("plain"));
  assert.equal(pending(g.engine), undefined, "no prompt when a different card enters");
  assert.deepEqual(stats(g.engine, g.id("c")), [2, 4, 3]);
  assert.deepEqual(stats(g.engine, g.id("plain")), [1, 1, 1]);
});

// =====================================================================================
// Gnarling Lupine — character (rogue, beast), cost 5, threshold [D], 2 strength / 3 speed / 2 life
// REND -- COST: Use this ability only once each turn. Destroy a face-down resource you control.
// -- EFFECT: This turn, this card gains 3 strength, 3 life and 1 speed.
// =====================================================================================

const GNARLING = "b05d2a5d-9ffc-471a-a1df-47ceacfded10";

const fdResource = (key: string, owner: PlayerId): CardPlacement => ({
  key,
  def: resourceCard({ name: `Res ${key}` }),
  owner,
  zone: "play",
  faceDown: true
});

function gnarlingBoard(o: { own?: number; opp?: number; random?: () => number; extra?: CardPlacement[] } = {}) {
  const own = Array.from({ length: o.own ?? 2 }, (_, i) => fdResource(`r${i}`, P1));
  const opp = Array.from({ length: o.opp ?? 0 }, (_, i) => fdResource(`o${i}`, P2));
  return duo(
    [
      { key: "gl", def: printing(GNARLING), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 2, life: 2, speed: 3 }), owner: P1, zone: "play" },
      ...own,
      ...opp,
      ...(o.extra ?? [])
    ],
    { random: o.random }
  );
}
const survivingOwn = (g: ReturnType<typeof gnarlingBoard>, n: number) =>
  Array.from({ length: n }, (_, i) => `r${i}`).filter((k) => zoneOf(g.engine, g.id(k)) === "play");

clause(GNARLING, "0:ability:gnarling-rend", "COST: destroys exactly one face-down resource of its controller", () => {
  const g = gnarlingBoard({ own: 3 });
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.equal(pending(g.engine), undefined);
  assert.equal(survivingOwn(g, 3).length, 2, "one of the three face-down resources was destroyed");
  assert.equal(g.engine.state.players[P1].discard.length, 1, "it went to the discard pile");
});

clause(GNARLING, "0:ability:gnarling-rend", "EFFECT: this card gains 3 strength, 3 life and 1 speed this turn (2/2/3 becomes 5/5/4); only itself", () => {
  const g = gnarlingBoard();
  assert.deepEqual(stats(g.engine, g.id("gl")), [2, 2, 3], "setup: printed 2 strength / 2 life / 3 speed");
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.deepEqual(stats(g.engine, g.id("gl")), [5, 5, 4]);
  assert.deepEqual(stats(g.engine, g.id("mate")), [2, 2, 3], "another character is unaffected");
});

clause(GNARLING, "0:ability:gnarling-rend", "the gains last 'this turn' only", () => {
  const g = gnarlingBoard();
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  endTurn(g.engine, P1);
  assert.deepEqual(stats(g.engine, g.id("gl")), [2, 2, 3], "back to printed stats on the next turn");
});

clause(GNARLING, "0:ability:gnarling-rend", "nothing else is paid: the destroyed resource is the only resource lost", () => {
  const g = gnarlingBoard({ own: 2, extra: bank("deception", 3, P1) });
  assert.equal(readyResources(g.engine, P1), 5);
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.equal(readyResources(g.engine, P1), 4, "5 - the one destroyed face-down resource");
});

clause(GNARLING, "0:ability:gnarling-rend", "can be used only once each turn: a second use is refused (nothing destroyed, no further gain), but it is available again next turn", () => {
  const g = gnarlingBoard({ own: 4 });
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.equal(survivingOwn(g, 4).length, 3);
  refused(() => rawActivate(g.engine, P1, g.id("gl"), "gnarling-rend"), "already used this turn");
  assert.equal(survivingOwn(g, 4).length, 3, "nothing more destroyed");
  assert.deepEqual(stats(g.engine, g.id("gl")), [5, 5, 4], "no second +3/+3/+1");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.equal(survivingOwn(g, 4).length, 2, "control: usable again on P1's next turn");
  assert.deepEqual(stats(g.engine, g.id("gl")), [5, 5, 4]);
});

clause(GNARLING, "0:ability:gnarling-rend", "it needs a face-down resource you control: with none (even if the opponent has some) it is refused and nothing changes", () => {
  const none = gnarlingBoard({ own: 0, opp: 3 });
  refused(() => rawActivate(none.engine, P1, none.id("gl"), "gnarling-rend"), "no face-down resource of its own");
  assert.deepEqual(stats(none.engine, none.id("gl")), [2, 2, 3]);
  for (const k of ["o0", "o1", "o2"]) assert.equal(zoneOf(none.engine, none.id(k)), "play", `${k} untouched`);
  const one = gnarlingBoard({ own: 1, opp: 0 });
  use(one.engine, P1, one.id("gl"), "gnarling-rend");
  assert.deepEqual(stats(one.engine, one.id("gl")), [5, 5, 4], "control: one own face-down resource is enough");
  assert.equal(zoneOf(one.engine, one.id("r0")), "discard");
});

clause(GNARLING, "0:ability:gnarling-rend", "the opponent's face-down resources are never the one destroyed, whatever the dice say", () => {
  for (const roll of [0, 0.34, 0.67, 0.99]) {
    const g = gnarlingBoard({ own: 1, opp: 3, random: () => roll });
    use(g.engine, P1, g.id("gl"), "gnarling-rend");
    assert.equal(zoneOf(g.engine, g.id("r0")), "discard", `own resource destroyed (roll ${roll})`);
    for (const k of ["o0", "o1", "o2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", `${k} untouched (roll ${roll})`);
  }
});

clause(GNARLING, "0:ability:gnarling-rend", "only face-down resources are destroyed: a face-up item and the other characters stay in play", () => {
  for (const roll of [0, 0.5, 0.99]) {
    const g = gnarlingBoard({
      own: 1,
      random: () => roll,
      extra: [
        { key: "up", def: item({ name: "Up" }), owner: P1, zone: "play" },
        { key: "upRes", def: resourceCard({ name: "UpRes" }), owner: P1, zone: "play", faceDown: false }
      ]
    });
    use(g.engine, P1, g.id("gl"), "gnarling-rend");
    assert.equal(zoneOf(g.engine, g.id("up")), "play", `face-up item untouched (roll ${roll})`);
    assert.equal(zoneOf(g.engine, g.id("upRes")), "play", `face-up resource card untouched (roll ${roll})`);
    assert.equal(zoneOf(g.engine, g.id("mate")), "play");
    assert.equal(zoneOf(g.engine, g.id("gl")), "play");
    assert.equal(zoneOf(g.engine, g.id("r0")), "discard");
  }
  const onlyUp = gnarlingBoard({ own: 0, extra: [{ key: "up", def: item({ name: "Up" }), owner: P1, zone: "play" }] });
  refused(() => rawActivate(onlyUp.engine, P1, onlyUp.id("gl"), "gnarling-rend"), "a face-up item is not a face-down resource");
  assert.equal(zoneOf(onlyUp.engine, onlyUp.id("up")), "play");
});

clause(GNARLING, "0:ability:gnarling-rend", "the controller decides which face-down resource is destroyed (the cost is not random)", () => holdCostChoices(() => {
  const g = gnarlingBoard({ own: 3 });
  rawActivate(g.engine, P1, g.id("gl"), "gnarling-rend");
  const pc = pending(g.engine);
  assert.ok(pc, "the controller is asked which of the three face-down resources to destroy");
  assert.equal(pc.playerId, P1);
}));

clause(GNARLING, "0:ability:gnarling-rend", "a depleted Lupine can still use REND (the cost is not depleting)", () => {
  const g = gnarlingBoard();
  g.engine.state.cards[g.id("gl")].depleted = true;
  use(g.engine, P1, g.id("gl"), "gnarling-rend");
  assert.deepEqual(stats(g.engine, g.id("gl")), [5, 5, 4]);
});

// =====================================================================================
// Impeccable Triggerman — character (rogue, assassin), cost 4, threshold [D][D][D], 2 strength / 3 speed / 1 life
// This card enters play depleted.
// ASSASSINATE -- COST: Deplete this card. Pick a depleted character. -- EFFECT: If the character has 4 life or less, destroy it.
// RELOAD -- COST: Pay 3. -- EFFECT: Restore this card. This turn, it cannot attack.
// =====================================================================================

const TRIGGERMAN = "adf72007-3003-45a5-91ab-432b2502a403";

function tmBoard(o: { tm?: "hand" | "play"; tmDepleted?: boolean; res?: number; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "tm", def: printing(TRIGGERMAN), owner: P1, zone: o.tm ?? "play", depleted: o.tmDepleted ?? false },
      ...bank("deception", o.res ?? 0, P1),
      ...(o.extra ?? [])
    ],
    { active: o.active }
  );
}
const target = (key: string, life: number, owner: PlayerId = P2, depleted = true, damage = 0): CardPlacement => ({
  key,
  def: character({ name: key, strength: 1, life, speed: 1 }),
  owner,
  zone: "play",
  depleted,
  damage
});

clause(TRIGGERMAN, "0:rule", "it enters play depleted when deployed (paying its cost 4 with [D][D][D])", () => {
  const g = tmBoard({ tm: "hand", res: 4 });
  play(g.engine, P1, g.id("tm"));
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("tm")), "play");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, true);
  assert.equal(readyResources(g.engine, P1), 0, "cost 4 paid");
  assert.deepEqual(stats(g.engine, g.id("tm")), [2, 1, 3]);
});

clause(TRIGGERMAN, "0:rule", "deploying needs the full cost and threshold: three resources, or four Rage, are refused", () => {
  const short = tmBoard({ tm: "hand", res: 3 });
  refused(() => play(short.engine, P1, short.id("tm")), "cost 4 with three resources");
  assert.equal(zoneOf(short.engine, short.id("tm")), "hand");
  const wrong = tmBoard({ tm: "hand", res: 0, extra: bank("rage", 4, P1) });
  refused(() => play(wrong.engine, P1, wrong.id("tm")), "no [D][D][D]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("tm")), "hand");
  const twoD = tmBoard({ tm: "hand", res: 2, extra: bank("rage", 2, P1) });
  refused(() => play(twoD.engine, P1, twoD.id("tm")), "only two [D]", /threshold/i);
});

clause(TRIGGERMAN, "0:rule", "only this card enters depleted: another character deploying beside it enters ready, and Triggerman itself is not re-depleted", () => {
  const g = tmBoard({
    tm: "play",
    extra: [{ key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }]
  });
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false, "setup: a Triggerman placed in play is ready");
  play(g.engine, P1, g.id("plain"));
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  assert.equal(g.engine.state.cards[g.id("plain")].depleted, false, "the other character enters ready");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false, "Triggerman was already in play");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "destroys a depleted character with 4 life, 1 life or less (the opponent's), after depleting itself", () => {
  for (const life of [1, 2, 4]) {
    const g = tmBoard({ extra: [target("v", life)] });
    use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] });
    assert.equal(pending(g.engine), undefined);
    assert.equal(zoneOf(g.engine, g.id("v")), "discard", `life ${life} is destroyed`);
    assert.equal(g.engine.state.cards[g.id("tm")].depleted, true, "COST: Triggerman is depleted");
  }
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "a depleted character with 5 life or more survives (the cost is still paid)", () => {
  for (const life of [5, 6, 9]) {
    const g = tmBoard({ extra: [target("v", life)] });
    use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] });
    assert.equal(zoneOf(g.engine, g.id("v")), "play", `life ${life} survives`);
    assert.equal(g.engine.state.cards[g.id("v")].depleted, true, "and stays depleted");
    assert.equal(g.engine.state.cards[g.id("tm")].depleted, true, "the cost was paid anyway");
  }
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "'has 4 life': damage on the character does not matter, only its life (5 life with 3 damage survives; 4 life with 0 damage dies)", () => {
  const hurt = tmBoard({ extra: [target("v", 5, P2, true, 3)] });
  use(hurt.engine, P1, hurt.id("tm"), "triggerman-assassinate", { v: [hurt.id("v")] });
  assert.equal(zoneOf(hurt.engine, hurt.id("v")), "play", "5 life with 3 damage is not 4 life or less");
  const fresh = tmBoard({ extra: [target("v", 4, P2, true, 0)] });
  use(fresh.engine, P1, fresh.id("tm"), "triggerman-assassinate", { v: [fresh.id("v")] });
  assert.equal(zoneOf(fresh.engine, fresh.id("v")), "discard");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "the life is the current life with modifiers: a Gnarling Lupine (2 life) is destroyed, but 5 after REND it survives", () => {
  const plain = tmBoard({
    extra: [{ key: "gl", def: printing(GNARLING), owner: P2, zone: "play", depleted: true }]
  });
  use(plain.engine, P1, plain.id("tm"), "triggerman-assassinate", { v: [plain.id("gl")] });
  assert.equal(zoneOf(plain.engine, plain.id("gl")), "discard", "control: 2 life");
  const rended = tmBoard({
    extra: [{ key: "gl", def: printing(GNARLING), owner: P1, zone: "play" }, fdResource("r0", P1)]
  });
  use(rended.engine, P1, rended.id("gl"), "gnarling-rend");
  rended.engine.state.cards[rended.id("gl")].depleted = true;
  assert.equal(rended.engine.getStat(rended.id("gl"), "life"), 5);
  use(rended.engine, P1, rended.id("tm"), "triggerman-assassinate", { v: [rended.id("gl")] });
  assert.equal(zoneOf(rended.engine, rended.id("gl")), "play", "5 life is not 4 or less");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "the picked character must be depleted: a ready character is refused and Triggerman stays ready", () => {
  const g = tmBoard({ extra: [target("ready", 1, P2, false), target("v", 1)] });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("ready")] }), "not depleted");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false, "nothing was paid");
  assert.equal(zoneOf(g.engine, g.id("ready")), "play");
  use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard", "control: the depleted one works");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "it must be a character: a depleted item is refused", () => {
  const g = tmBoard({ extra: [{ key: "it", def: item({ name: "It" }), owner: P2, zone: "play", depleted: true }, target("v", 1)] });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("it")] }), "an item is not a character");
  assert.equal(zoneOf(g.engine, g.id("it")), "play");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false);
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "its controller's own depleted characters can be picked and destroyed too", () => {
  const g = tmBoard({ extra: [target("mine", 3, P1)] });
  use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("mine")] });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "Triggerman can pick itself: after the deplete cost it is a depleted character with 1 life, so it is destroyed", () => {
  const g = tmBoard({});
  use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("tm")] });
  assert.equal(zoneOf(g.engine, g.id("tm")), "discard");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "COST: Triggerman must be able to deplete: while depleted (it enters depleted) it is refused", () => {
  const g = tmBoard({ tmDepleted: true, extra: [target("v", 1)] });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] }), "already depleted");
  assert.equal(zoneOf(g.engine, g.id("v")), "play");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "with no depleted character to pick it cannot be used", () => {
  const g = tmBoard({ extra: [target("ready", 1, P2, false)] });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate"), "nothing to pick");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false, "nothing was paid");
});

clause(TRIGGERMAN, "1:ability:triggerman-assassinate", "COST is paid up front: Triggerman is depleted while the ability waits in the response window, the victim not yet destroyed", () => {
  const g = tmBoard({ extra: [target("v", 1)] });
  rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] });
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, true);
  assert.equal(zoneOf(g.engine, g.id("v")), "play", "not resolved yet");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "COST: pay 3 (exactly three resources spent); EFFECT: a depleted Triggerman is restored", () => {
  const g = tmBoard({ tmDepleted: true, res: 5 });
  use(g.engine, P1, g.id("tm"), "triggerman-reload");
  assert.equal(pending(g.engine), undefined);
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false, "restored");
  assert.equal(readyResources(g.engine, P1), 2, "5 - 3");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "is refused with only two resources: nothing is paid and Triggerman stays depleted", () => {
  const g = tmBoard({ tmDepleted: true, res: 2 });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-reload"), "pay 3 with 2 resources");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, true);
  assert.equal(readyResources(g.engine, P1), 2);
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "'This turn, it cannot attack': after Reload Triggerman cannot be declared as an attacker, while another character can", () => {
  const g = tmBoard({
    tmDepleted: true,
    res: 3,
    extra: [{ key: "mate", def: character({ name: "Mate", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" }]
  });
  use(g.engine, P1, g.id("tm"), "triggerman-reload");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false);
  refused(() => declareAttackBy(g.engine, P1, [g.id("tm")]), "Reload forbids attacking this turn");
  assert.equal(g.engine.state.battle, undefined, "no battle began");
  declareAttackBy(g.engine, P1, [g.id("mate")]);
  assert.ok(g.engine.state.battle, "control: another character may attack");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "without Reload a ready Triggerman may attack (control for the restriction)", () => {
  const g = tmBoard({});
  declareAttackBy(g.engine, P1, [g.id("tm")]);
  assert.ok(g.engine.state.battle, "g.engine.state.battle");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "the attack ban ends with the turn: two turns later Triggerman can attack again", () => {
  const g = tmBoard({ tmDepleted: true, res: 3 });
  use(g.engine, P1, g.id("tm"), "triggerman-reload");
  refused(() => declareAttackBy(g.engine, P1, [g.id("tm")]), "banned this turn");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, false);
  declareAttackBy(g.engine, P1, [g.id("tm")]);
  assert.ok(g.engine.state.battle, "attacking on P1's next turn");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "Reload can be paid while Triggerman is already ready: the 3 are still spent and it still cannot attack", () => {
  const g = tmBoard({ res: 4 });
  use(g.engine, P1, g.id("tm"), "triggerman-reload");
  assert.equal(readyResources(g.engine, P1), 1, "3 paid");
  refused(() => declareAttackBy(g.engine, P1, [g.id("tm")]), "cannot attack this turn");
});

clause(TRIGGERMAN, "2:ability:triggerman-reload", "after Reload, ASSASSINATE is available again in the same turn", () => {
  const g = tmBoard({ tmDepleted: true, res: 3, extra: [target("v", 3)] });
  refused(() => rawActivate(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] }), "still depleted");
  use(g.engine, P1, g.id("tm"), "triggerman-reload");
  use(g.engine, P1, g.id("tm"), "triggerman-assassinate", { v: [g.id("v")] });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
  assert.equal(g.engine.state.cards[g.id("tm")].depleted, true);
});

// =====================================================================================
// Inebriated Defenestration — tactic (rogue), cost 5, threshold [D][D][D]
// Put the top 5 cards of an opponent's deck into their discard pile. Draw 2 cards.
// =====================================================================================

const DEFEN = "ebac9b53-26af-491e-b251-a43a908d992f";

function defenBoard(o: { oppDeck?: number; myDeck?: number; res?: number; rage?: number; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "idf", def: printing(DEFEN), owner: P1, zone: "hand" },
      { key: "keep", def: character({ name: "Keep" }), owner: P1, zone: "hand" },
      ...Array.from({ length: o.oppDeck ?? 8 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
      ...Array.from({ length: o.myDeck ?? 6 }, (_, i) => ({ key: `md${i}`, def: character({ name: `MD${i}` }), owner: P1, zone: "deck" as const })),
      { key: "oppHand", def: character({ name: "OppHand" }), owner: P2, zone: "hand" },
      ...bank("deception", o.res ?? 8, P1),
      ...bank("rage", o.rage ?? 0, P1)
    ],
    { active: o.active }
  );
}

clause(DEFEN, "0:rule", "puts exactly the top 5 cards of the opponent's deck into their discard pile; the rest of that deck stays in order", () => {
  const { engine, id } = defenBoard();
  const before = [...engine.state.players[P2].deck];
  assert.equal(before.length, 8);
  play(engine, P1, id("idf"));
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...engine.state.players[P2].discard].sort(), before.slice(0, 5).sort(), "the five top cards are in the opponent's discard");
  assert.deepEqual(engine.state.players[P2].deck, before.slice(5), "the other three stay in the deck, in order");
});

clause(DEFEN, "0:rule", "draws 2 cards for the player: the top two of their own deck go to hand; their deck is not milled", () => {
  const { engine, id } = defenBoard();
  const myDeck = [...engine.state.players[P1].deck];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("idf"));
  const hand = engine.state.players[P1].hand;
  assert.equal(hand.length, handBefore - 1 + 2, "the tactic left the hand, two cards arrived");
  assert.ok(hand.includes(myDeck[0]) && hand.includes(myDeck[1]), "the top two of their own deck");
  assert.deepEqual(engine.state.players[P1].deck, myDeck.slice(2), "the rest of their own deck is untouched and in order");
  assert.equal(engine.state.players[P1].discard.length, 1, "their discard pile holds only the tactic");
  assert.equal(zoneOf(engine, id("idf")), "discard");
});

clause(DEFEN, "0:rule", "the opponent draws nothing and keeps their hand; the milled cards are not drawn by the opponent", () => {
  const { engine, id } = defenBoard();
  const oppHand = [...engine.state.players[P2].hand];
  play(engine, P1, id("idf"));
  assert.deepEqual(engine.state.players[P2].hand, oppHand);
});

clause(DEFEN, "0:rule", "an opponent's deck of exactly 5 is emptied into their discard pile, and the 2 cards are still drawn", () => {
  const { engine, id } = defenBoard({ oppDeck: 5 });
  const before = [...engine.state.players[P2].deck];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("idf"));
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.deepEqual([...engine.state.players[P2].discard].sort(), [...before].sort());
  assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
});

clause(DEFEN, "0:rule", "an opponent's deck with fewer than 5 cards (3) puts all of them into the discard pile and the draw still happens", () => {
  const { engine, id } = defenBoard({ oppDeck: 3 });
  const before = [...engine.state.players[P2].deck];
  const handBefore = engine.state.players[P1].hand.length;
  play(engine, P1, id("idf"));
  assert.deepEqual([...engine.state.players[P2].discard].sort(), [...before].sort());
  assert.equal(engine.state.players[P2].deck.length, 0);
  assert.equal(engine.state.players[P1].hand.length, handBefore + 1);
});

clause(DEFEN, "0:rule", "a tactic costing 5: five resources are spent (8 leaves 3), four are refused", () => {
  const { engine, id } = defenBoard();
  play(engine, P1, id("idf"));
  assert.equal(readyResources(engine, P1), 3);
  const short = defenBoard({ res: 4 });
  refused(() => play(short.engine, P1, short.id("idf")), "cost 5 with four resources");
  assert.equal(zoneOf(short.engine, short.id("idf")), "hand");
  assert.equal(short.engine.state.players[P2].discard.length, 0, "nothing milled");
});

clause(DEFEN, "0:rule", "needs [D][D][D]: five Rage resources, or only two [D] among five, are refused", () => {
  const wrong = defenBoard({ res: 0, rage: 6 });
  refused(() => play(wrong.engine, P1, wrong.id("idf")), "no [D]", /threshold/i);
  const two = defenBoard({ res: 2, rage: 4 });
  refused(() => play(two.engine, P1, two.id("idf")), "only two [D]", /threshold/i);
  assert.equal(two.engine.state.players[P2].discard.length, 0);
  const three = defenBoard({ res: 3, rage: 2 });
  play(three.engine, P1, three.id("idf"));
  assert.equal(three.engine.state.players[P2].discard.length, 5, "control: exactly [D][D][D] among five works");
});

clause(DEFEN, "0:rule", "as a tactic it can be played in the opponent's attack window", () => {
  const g = duo(
    [
      { key: "idf", def: printing(DEFEN), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...Array.from({ length: 6 }, (_, i) => ({ key: `od${i}`, def: character({ name: `OD${i}` }), owner: P2, zone: "deck" as const })),
      ...Array.from({ length: 3 }, (_, i) => ({ key: `md${i}`, def: character({ name: `MD${i}` }), owner: P1, zone: "deck" as const })),
      ...bank("deception", 5, P1)
    ],
    { active: P2 }
  );
  refused(() => playRaw(g.engine, P1, g.id("idf")), "no window yet on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("idf")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  play(g.engine, P1, g.id("idf"));
  assert.equal(g.engine.state.players[P2].discard.length, 5);
  assert.equal(g.engine.state.players[P1].hand.length, 2);
});

// =====================================================================================
// Low-hanging Clothesline — tactic (rogue), cost 3, threshold [D]
// EXTRA COST: Pick a depleted character. -- If the character has 5 life or more, destroy it.
// =====================================================================================

const LINE = "40b073e3-5e51-45c4-b95e-4a1dfc06f3c1";

function lineBoard(extra: CardPlacement[], o: { res?: number; rage?: number; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "lhc", def: printing(LINE), owner: P1, zone: "hand" },
      ...bank("deception", o.res ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...extra
    ],
    { active: o.active }
  );
}

clause(LINE, "0:extraCost", "the pick is a depleted character: a ready character, an item and a depleted item are all refused, nothing is paid", () => {
  const g = lineBoard([
    target("ready", 6, P2, false),
    { key: "it", def: item({ name: "It" }), owner: P2, zone: "play", depleted: true },
    target("ok", 6)
  ]);
  const before = readyResources(g.engine, P1);
  refused(() => play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("ready")] } }), "not depleted");
  refused(() => play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("it")] } }), "an item");
  assert.equal(zoneOf(g.engine, g.id("lhc")), "hand", "still in hand");
  assert.equal(readyResources(g.engine, P1), before, "nothing paid");
  assert.equal(zoneOf(g.engine, g.id("ready")), "play");
  play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("ok")] } });
  assert.equal(zoneOf(g.engine, g.id("ok")), "discard", "control: the depleted character works");
});

clause(LINE, "0:extraCost", "with no depleted character in play the tactic cannot be played", () => {
  const g = lineBoard([target("ready", 6, P2, false)]);
  refused(() => play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("ready")] } }), "no legal pick");
  refused(() => play(g.engine, P1, g.id("lhc")), "no pick given");
  assert.equal(zoneOf(g.engine, g.id("lhc")), "hand");
  assert.equal(readyResources(g.engine, P1), 4);
});

clause(LINE, "0:extraCost", "the pick is made as an extra cost when the card is played: the card is paid for and the target chosen before anything resolves", () => {
  const g = lineBoard([target("v", 6)]);
  playRaw(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } });
  assert.equal(readyResources(g.engine, P1), 1, "the cost of 3 is already paid");
  assert.equal(zoneOf(g.engine, g.id("v")), "play", "not yet destroyed while the tactic waits for responses");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
});

clause(LINE, "0:extraCost", "either player's depleted character can be picked: the caster's own depleted character too", () => {
  const g = lineBoard([target("mine", 7, P1), target("theirs", 7, P2)]);
  play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "only the picked character is destroyed");
});

clause(LINE, "1:rule", "a depleted character with 5, 6 or more life is destroyed", () => {
  for (const life of [5, 6, 12]) {
    const g = lineBoard([target("v", life), target("other", life)]);
    play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } });
    assert.equal(zoneOf(g.engine, g.id("v")), "discard", `life ${life}`);
    assert.equal(zoneOf(g.engine, g.id("other")), "play", "another depleted character with the same life is not destroyed");
    assert.equal(zoneOf(g.engine, g.id("lhc")), "discard");
  }
});

clause(LINE, "1:rule", "a depleted character with 4 life or less survives, and the tactic is still spent", () => {
  for (const life of [1, 4]) {
    const g = lineBoard([target("v", life)]);
    play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } });
    assert.equal(zoneOf(g.engine, g.id("v")), "play", `life ${life} survives`);
    assert.equal(g.engine.state.cards[g.id("v")].depleted, true);
    assert.equal(zoneOf(g.engine, g.id("lhc")), "discard", "the tactic was used up");
    assert.equal(readyResources(g.engine, P1), 1, "cost paid regardless");
  }
});

clause(LINE, "1:rule", "'has 5 life': damage doesn't matter (5 life with 4 damage is destroyed)", () => {
  const g = lineBoard([target("v", 5, P2, true, 4)]);
  play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
});

clause(LINE, "1:rule", "it is a tactic costing 3 with [D]: two resources, or three Rage, are refused", () => {
  const short = lineBoard([target("v", 6)], { res: 2 });
  refused(() => play(short.engine, P1, short.id("lhc"), { selected: { c: [short.id("v")] } }), "cost 3 with two resources");
  const wrong = lineBoard([target("v", 6)], { res: 0, rage: 3 });
  refused(() => play(wrong.engine, P1, wrong.id("lhc"), { selected: { c: [wrong.id("v")] } }), "no [D]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("lhc")), "hand");
  assert.equal(zoneOf(wrong.engine, wrong.id("v")), "play");
  const exact = lineBoard([target("v", 6)], { res: 1, rage: 2 });
  play(exact.engine, P1, exact.id("lhc"), { selected: { c: [exact.id("v")] } });
  assert.equal(zoneOf(exact.engine, exact.id("v")), "discard", "control: one [D] plus two others is enough");
  assert.equal(readyResources(exact.engine, P1), 0);
});

clause(LINE, "1:rule", "as a tactic it can be played in the opponent's attack window on a depleted character", () => {
  const g = lineBoard([target("v", 6, P1), { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" }], { active: P2 });
  refused(() => play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } }), "no window on the opponent's turn");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  play(g.engine, P1, g.id("lhc"), { selected: { c: [g.id("v")] } });
  assert.equal(zoneOf(g.engine, g.id("v")), "discard");
});

// =====================================================================================
// Loyal Companion — character (rogue, outcast mau), cost 3, threshold [D], 2 strength / 3 speed / 2 life
// TACTICAL
// HELPING PAW: [D] -- COST: Discard this card from your hand. Pick a character that is blocking or being blocked. Pay 4.
//   -- EFFECT: This turn, that character gains 3 strength and 3 life.
// NINE LIVES: [D] -- COST: Use this only if this card is in your discard pile. Pay 5.
//   -- EFFECT: Put this card into play under your control.
// =====================================================================================

const LOYAL = "66f28631-377f-4671-a133-429f9b3dc309";

clause(LOYAL, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const g = duo([
    { key: "lc", def: printing(LOYAL), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }
  ]);
  assert.ok(g.engine.getKeywords(g.id("lc")).includes("tactical"), "g.engine.getKeywords(g.id(\"lc\")).includes(\"tactical\")");
  assert.equal(g.engine.getKeywords(g.id("plain")).includes("tactical"), false);
});

function loyalDeploy(o: { d?: number; r?: number; active?: PlayerId }) {
  return duo(
    [
      { key: "lc", def: printing(LOYAL), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...bank("deception", o.d ?? 3, P1),
      ...bank("rage", o.r ?? 0, P1)
    ],
    { active: o.active }
  );
}

clause(LOYAL, "0:kw:TACTICAL", "it can be deployed from hand in the opponent's attack window for its printed cost 3 as a 2/2/3 character", () => {
  const g = loyalDeploy({ active: P2 });
  refused(() => play(g.engine, P1, g.id("lc")), "no window yet on the opponent's turn");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand");
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  play(g.engine, P1, g.id("lc"));
  assert.equal(zoneOf(g.engine, g.id("lc")), "play");
  assert.equal(readyResources(g.engine, P1), 0);
  assert.deepEqual(stats(g.engine, g.id("lc")), [2, 2, 3]);
});

clause(LOYAL, "0:kw:TACTICAL", "TACTICAL changes timing only: two resources, or three Rage, are refused in the window", () => {
  const short = loyalDeploy({ d: 2, active: P2 });
  declareAttackOpenWindow(short.engine, P2, [short.id("foe")]);
  refused(() => play(short.engine, P1, short.id("lc")), "cost 3 with two resources");
  const wrong = loyalDeploy({ d: 0, r: 3, active: P2 });
  declareAttackOpenWindow(wrong.engine, P2, [wrong.id("foe")]);
  refused(() => play(wrong.engine, P1, wrong.id("lc")), "no [D]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("lc")), "hand");
});

/** P1 attacks with `atk` (str 2 / life 2); P2 blocks with `blk` (str 3 / life 3). P1 holds Loyal Companion (and optionally a second copy). */
function pawBattle(o: { d?: number; r?: number; block?: boolean; second?: boolean; lcOwner?: PlayerId; lcZone?: "hand" | "play" | "discard" } = {}) {
  const lcOwner = o.lcOwner ?? P1;
  const g = duo([
    { key: "lc", def: printing(LOYAL), owner: lcOwner, zone: o.lcZone ?? "hand" },
    ...(o.second ? [{ key: "lc2", def: printing(LOYAL), owner: lcOwner, zone: "hand" as const }] : []),
    { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 3, life: 3, speed: 1 }), owner: P2, zone: "play" },
    { key: "idle", def: character({ name: "Idle", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
    ...bank("deception", o.d ?? 4, lcOwner),
    ...bank("rage", o.r ?? 0, lcOwner)
  ]);
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  if (o.block !== false) declareBlockers(g.engine, P2, [g.id("blk")]);
  else g.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [] });
  return g;
}
const paw = (g: ReturnType<typeof pawBattle>, pick: string, who: PlayerId = P1, key = "lc") =>
  rawActivate(g.engine, who, g.id(key), "loyal-helping-paw", { c: [g.id(pick)], "lc-self": [g.id(key)] });

clause(LOYAL, "1:ability:loyal-helping-paw", "gives the blocked attacker +3 strength and +3 life this turn (2/2/2 becomes 5/5/2); the card is discarded from hand and 4 are paid", () => {
  const g = pawBattle();
  assert.equal(readyResources(g.engine, P1), 4);
  paw(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("lc")), "discard", "discarded from hand as a cost");
  assert.equal(readyResources(g.engine, P1), 0, "pay 4");
  assert.deepEqual(stats(g.engine, g.id("atk")), [5, 5, 2], "speed is not changed");
  assert.deepEqual(stats(g.engine, g.id("blk")), [3, 3, 1], "the blocker is unaffected");
});

clause(LOYAL, "1:ability:loyal-helping-paw", "a blocking character can be picked (even the opponent's): it gets +3/+3 too", () => {
  const g = pawBattle();
  paw(g, "blk");
  resolvePendingResponses(g.engine);
  assert.deepEqual(stats(g.engine, g.id("blk")), [6, 6, 1]);
  assert.deepEqual(stats(g.engine, g.id("atk")), [2, 2, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "the bonus decides the battle: the boosted attacker survives and kills the blocker, whereas unboosted it dies", () => {
  const boosted = pawBattle();
  paw(boosted, "atk");
  resolvePendingResponses(boosted.engine);
  finishBattle(boosted.engine);
  assert.equal(zoneOf(boosted.engine, boosted.id("atk")), "play", "5 life survives 3 damage");
  assert.equal(zoneOf(boosted.engine, boosted.id("blk")), "discard", "5 strength kills the 3-life blocker");
  const control = pawBattle();
  finishBattle(control.engine);
  assert.equal(zoneOf(control.engine, control.id("atk")), "discard", "control: 2 life dies to 3 strength");
  const boostedBlocker = pawBattle();
  paw(boostedBlocker, "blk");
  resolvePendingResponses(boostedBlocker.engine);
  finishBattle(boostedBlocker.engine);
  assert.equal(zoneOf(boostedBlocker.engine, boostedBlocker.id("blk")), "play", "boosted blocker (6 life) survives");
  assert.equal(zoneOf(boostedBlocker.engine, boostedBlocker.id("atk")), "discard");
});

clause(LOYAL, "1:ability:loyal-helping-paw", "'This turn': the bonus is gone on the next turn", () => {
  const g = pawBattle();
  paw(g, "atk");
  resolvePendingResponses(g.engine);
  finishBattle(g.engine);
  endTurn(g.engine, P1);
  assert.deepEqual(stats(g.engine, g.id("atk")), [2, 2, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "the pick must be in the battle: a character outside it is refused with nothing paid or discarded", () => {
  const g = pawBattle();
  refused(() => paw(g, "idle"), "a character not blocking or being blocked");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand");
  assert.equal(readyResources(g.engine, P1), 4);
  paw(g, "atk");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("lc")), "discard", "control: a battle participant works");
});

clause(LOYAL, "1:ability:loyal-helping-paw", "an attacker that is not blocked is not 'being blocked': refused", () => {
  const g = pawBattle({ block: false });
  refused(() => paw(g, "atk"), "unblocked attacker");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand");
  assert.equal(readyResources(g.engine, P1), 4);
  assert.deepEqual(stats(g.engine, g.id("atk")), [2, 2, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "with no battle at all it cannot be used", () => {
  const g = duo([
    { key: "lc", def: printing(LOYAL), owner: P1, zone: "hand" },
    { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
    ...bank("deception", 4, P1)
  ]);
  refused(() => paw({ engine: g.engine, id: g.id } as never, "c"), "no battle");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand");
});

clause(LOYAL, "1:ability:loyal-helping-paw", "COST: pay 4 is required: three resources are refused with the card staying in hand", () => {
  const g = pawBattle({ d: 3 });
  refused(() => paw(g, "atk"), "pay 4 with three resources");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand");
  assert.equal(readyResources(g.engine, P1), 3);
  assert.deepEqual(stats(g.engine, g.id("atk")), [2, 2, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "threshold [D]: four Rage resources are refused; one [D] among four is enough", () => {
  const wrong = pawBattle({ d: 0, r: 4 });
  refused(() => paw(wrong, "atk"), "no [D]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("lc")), "hand");
  const ok = pawBattle({ d: 1, r: 3 });
  paw(ok, "atk");
  resolvePendingResponses(ok.engine);
  assert.deepEqual(stats(ok.engine, ok.id("atk")), [5, 5, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "it is used from hand only: a Loyal Companion in play (or in the discard pile) has no Helping Paw", () => {
  const inPlay = pawBattle({ lcZone: "play" });
  refused(() => paw(inPlay, "atk"), "in play, not in hand");
  assert.equal(readyResources(inPlay.engine, P1), 4);
  assert.deepEqual(stats(inPlay.engine, inPlay.id("atk")), [2, 2, 2]);
  const inDiscard = pawBattle({ lcZone: "discard" });
  refused(() => paw(inDiscard, "atk"), "in the discard pile");
  assert.equal(readyResources(inDiscard.engine, P1), 4);
  assert.deepEqual(stats(inDiscard.engine, inDiscard.id("atk")), [2, 2, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "the copy being used is the card discarded: a second Loyal Companion in hand stays there", () => {
  const g = pawBattle({ second: true });
  paw(g, "atk", P1, "lc2");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("lc2")), "discard", "the activated copy is discarded");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand", "the other copy is not");
  assert.deepEqual(stats(g.engine, g.id("atk")), [5, 5, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "'Discard this card from your hand' needs no choice: activating without naming a card to discard discards the used copy", () => {
  const g = pawBattle({ second: true });
  rawActivate(g.engine, P1, g.id("lc2"), "loyal-helping-paw", { c: [g.id("atk")] });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("lc2")), "discard", "this card (lc2) is discarded");
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand", "the other copy stays");
  assert.deepEqual(stats(g.engine, g.id("atk")), [5, 5, 2]);
});

clause(LOYAL, "1:ability:loyal-helping-paw", "the discarded card is THIS card: naming the other copy as the card to discard never discards the other copy in its place", () => {
  const g = pawBattle({ second: true });
  let accepted = true;
  try {
    rawActivate(g.engine, P1, g.id("lc2"), "loyal-helping-paw", { c: [g.id("atk")], "lc-self": [g.id("lc")] });
    resolvePendingResponses(g.engine);
  } catch {
    accepted = false;
  }
  assert.equal(zoneOf(g.engine, g.id("lc")), "hand", "the other copy is not discarded for this copy's ability");
  if (accepted) assert.equal(zoneOf(g.engine, g.id("lc2")), "discard", "if accepted, this card is what was discarded");
  else assert.equal(zoneOf(g.engine, g.id("lc2")), "hand", "if refused, nothing was discarded");
});

clause(LOYAL, "1:ability:loyal-helping-paw", "the defender can use it too: P2 holds a Loyal Companion and boosts their own blocker", () => {
  const g = duo([
    { key: "lc", def: printing(LOYAL), owner: P2, zone: "hand" },
    { key: "atk", def: character({ name: "Atk", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
    { key: "blk", def: character({ name: "Blk", strength: 1, life: 1, speed: 1 }), owner: P2, zone: "play" },
    ...bank("deception", 4, P2)
  ]);
  declareAttackBy(g.engine, P1, [g.id("atk")]);
  declareBlockers(g.engine, P2, [g.id("blk")]);
  g.engine.perform({ type: "passPriority", playerId: P1 });
  rawActivate(g.engine, P2, g.id("lc"), "loyal-helping-paw", { c: [g.id("blk")], "lc-self": [g.id("lc")] });
  resolvePendingResponses(g.engine);
  assert.deepEqual(stats(g.engine, g.id("blk")), [4, 4, 1]);
  assert.equal(zoneOf(g.engine, g.id("lc")), "discard");
  assert.equal(readyResources(g.engine, P2), 0);
});

/** Loyal Companion in P1's discard pile with `d` Deception and `r` Rage resources. */
function nineLives(o: { d?: number; r?: number; where?: "discard" | "hand" | "play"; owner?: PlayerId } = {}) {
  return duo([
    { key: "lc", def: printing(LOYAL), owner: o.owner ?? P1, zone: o.where ?? "discard" },
    ...bank("deception", o.d ?? 5, P1),
    ...bank("rage", o.r ?? 0, P1)
  ]);
}

clause(LOYAL, "2:ability:loyal-nine-lives", "from the discard pile, paying 5, it is put into play under its owner's control as a 2/2/3 character", () => {
  const g = nineLives();
  assert.equal(readyResources(g.engine, P1), 5);
  use(g.engine, P1, g.id("lc"), "loyal-nine-lives");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("lc")), "play");
  assert.equal(g.engine.state.cards[g.id("lc")].controllerId, P1, "under your control");
  assert.ok(g.engine.state.players[P1].play.includes(g.id("lc")), "g.engine.state.players[P1].play.includes(g.id(\"lc\"))");
  assert.equal(g.engine.state.players[P1].discard.includes(g.id("lc")), false);
  assert.equal(readyResources(g.engine, P1), 0, "pay 5");
  assert.deepEqual(stats(g.engine, g.id("lc")), [2, 2, 3]);
});

clause(LOYAL, "2:ability:loyal-nine-lives", "pay 5 is required: four resources are refused and it stays in the discard pile", () => {
  const g = nineLives({ d: 4 });
  refused(() => rawActivate(g.engine, P1, g.id("lc"), "loyal-nine-lives"), "pay 5 with four resources");
  assert.equal(zoneOf(g.engine, g.id("lc")), "discard");
  assert.equal(readyResources(g.engine, P1), 4);
});

clause(LOYAL, "2:ability:loyal-nine-lives", "threshold [D]: five Rage are refused, one [D] among five is enough (and exactly 5 are spent)", () => {
  const wrong = nineLives({ d: 0, r: 5 });
  refused(() => rawActivate(wrong.engine, P1, wrong.id("lc"), "loyal-nine-lives"), "no [D]", /threshold/i);
  assert.equal(zoneOf(wrong.engine, wrong.id("lc")), "discard");
  const ok = nineLives({ d: 1, r: 5 });
  use(ok.engine, P1, ok.id("lc"), "loyal-nine-lives");
  assert.equal(zoneOf(ok.engine, ok.id("lc")), "play");
  assert.equal(readyResources(ok.engine, P1), 1, "6 - 5");
});

clause(LOYAL, "2:ability:loyal-nine-lives", "'only if this card is in your discard pile': from hand or from play it is refused and nothing is paid", () => {
  const inHand = nineLives({ where: "hand" });
  refused(() => rawActivate(inHand.engine, P1, inHand.id("lc"), "loyal-nine-lives"), "in hand");
  assert.equal(zoneOf(inHand.engine, inHand.id("lc")), "hand");
  assert.equal(readyResources(inHand.engine, P1), 5);
  const inPlay = nineLives({ where: "play" });
  refused(() => rawActivate(inPlay.engine, P1, inPlay.id("lc"), "loyal-nine-lives"), "already in play");
  assert.equal(readyResources(inPlay.engine, P1), 5);
});

clause(LOYAL, "2:ability:loyal-nine-lives", "it is your own discard pile: P1 cannot revive a Loyal Companion from the opponent's discard pile", () => {
  const g = duo([
    { key: "lc", def: printing(LOYAL), owner: P2, zone: "discard" },
    ...bank("deception", 5, P1)
  ]);
  refused(() => rawActivate(g.engine, P1, g.id("lc"), "loyal-nine-lives"), "not P1's discard pile");
  assert.equal(zoneOf(g.engine, g.id("lc")), "discard");
  assert.equal(g.engine.state.cards[g.id("lc")].controllerId === P1 && zoneOf(g.engine, g.id("lc")) === "play", false);
  assert.equal(readyResources(g.engine, P1), 5);
});

clause(LOYAL, "2:ability:loyal-nine-lives", "the revived card can use Nine Lives again after dying: it is repeatable from the discard pile", () => {
  const g = nineLives({ d: 10 });
  use(g.engine, P1, g.id("lc"), "loyal-nine-lives");
  assert.equal(zoneOf(g.engine, g.id("lc")), "play");
  refused(() => rawActivate(g.engine, P1, g.id("lc"), "loyal-nine-lives"), "now in play, no longer in the discard pile");
  assert.equal(readyResources(g.engine, P1), 5, "only the first activation was paid");
});
