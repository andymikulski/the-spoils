// Clause tests: decade-of-deckadence-02 (Corpse Churner .. Flight Instinct, Decade of Deckadence).
// See docs/TESTING.md and `npm run card-tests -- manifest decade-of-deckadence-02`.
// Expectations come from each card's PRINTED text and the literal stats in the manifest; engine data is
// only used to drive the engine.

import assert from "node:assert/strict";
import {
  activate,
  bank,
  bounceTactic,
  buildGame,
  character,
  developFaction,
  item,
  killTactic,
  location,
  P1,
  P2,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, settleState } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, fight, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, barrenFaction, developResource, endTurn, endTurnRaw, factionOf, readyCount, spentResources } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import { defaultFactionDefinition, factionCard } from "../support/fixtures.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -----------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ obsession: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyCount(engine, player);
const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage ?? 0;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const stat = (engine: SpoilsEngine, id: CardInstanceId, name: "strength" | "speed" | "life" | "structure"): number | undefined =>
  engine.getStat(id, name) as number | undefined;

/** Turn starts when play passes from `from`'s turn to `to`'s: 1 at a two-player table, more where extra seats take turns between. */
const turnStartsBetween = (engine: SpoilsEngine, from: PlayerId, to: PlayerId): number => {
  const order = engine.state.turnOrder;
  return (order.indexOf(to) - order.indexOf(from) + order.length) % order.length || order.length;
};

/** Both factions can develop (draw or play a resource). */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });
/** Both factions have an empty Develop Rule, so real turn starts neither draw nor ask. */
const barrenBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: barrenFaction() }, playerB: { faction: barrenFaction() }, ...extra, cards });

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
const pickTargets = (selected: CardInstanceId[]) => (pc: PendingChoiceLike): unknown =>
  pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc);

/** Answers the open `selectTargets` prompt (an optional pick declared by a trigger) with `ids` for its declaration. */
function pickSel(engine: SpoilsEngine, ids: CardInstanceId[]): void {
  const pc = pending(engine);
  assert.ok(pc && pc.kind === "selectTargets", `expected a selectTargets prompt, found ${pc?.kind ?? "none"}`);
  const decl = (pc.declarations as Array<{ id: string }>)[0].id;
  answerPending(engine, "selectTargets", { selected: { [decl]: ids } });
}

/** One-short / exact deploy checks for a card in hand: exact resources deploy it and pay exactly `cost`; one short and a missing icon are refused. */
function deployChecks(id: string, cost: number, ok: CardPlacement[], oneShort: CardPlacement[], iconShort: CardPlacement[]): void {
  const mk = (resources: CardPlacement[]) => devBoard([{ key: "c", def: printing(id), owner: P1, zone: "hand" }, ...resources], { turn: 2 });
  const a = mk(ok);
  const before = ready(a.engine);
  play(a.engine, P1, a.id("c"));
  assert.equal(a.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(a.engine, a.id("c")), "play", "deploys with exactly enough");
  assert.equal(before - ready(a.engine), cost, `pays exactly ${cost}`);
  const s = mk(oneShort);
  refused(() => play(s.engine, P1, s.id("c")), `one short of cost ${cost}`);
  assert.equal(zoneOf(s.engine, s.id("c")), "hand");
  const t = mk(iconShort);
  refused(() => play(t.engine, P1, t.id("c")), "threshold not met");
  assert.equal(zoneOf(t.engine, t.id("c")), "hand");
}

/** UNIQUE checks for `id` vs a card carrying the same designation. */
function uniqueChecks(id: string): void {
  const mk = (extra: CardPlacement[]) => devBoard([...res({ rage: 5, elitism: 5, obsession: 5, deception: 5 }), ...res({ rage: 5 }, P2), ...extra], { turn: 2 });
  const keepSurvivor = (g: ReturnType<typeof mk>, keep: CardInstanceId) =>
    g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep } } as never);
  // keep the new one: the old one is destroyed
  const b = mk([
    { key: "a", def: printing(id), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("b"));
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [b.id("a"), b.id("b")].sort());
  keepSurvivor(b, b.id("b"));
  assert.equal(zoneOf(b.engine, b.id("b")), "play");
  assert.equal(zoneOf(b.engine, b.id("a")), "discard");
  // keep the old one: the new one is destroyed
  const c = mk([
    { key: "a", def: printing(id), owner: P1, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(c.engine, P1, c.id("b"));
  keepSurvivor(c, c.id("a"));
  assert.equal(zoneOf(c.engine, c.id("a")), "play");
  assert.equal(zoneOf(c.engine, c.id("b")), "discard");
  // the opponent's copy is separate
  const d = mk([
    { key: "a", def: printing(id), owner: P2, zone: "play" },
    { key: "b", def: printing(id), owner: P1, zone: "hand" }
  ]);
  play(d.engine, P1, d.id("b"));
  assert.equal(d.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(d.engine, d.id("a")), "play");
  assert.equal(zoneOf(d.engine, d.id("b")), "play");
}

// =============================================================================
// Corpse Churner -- item (warlord), cost 3, threshold [R][R][R]
// =============================================================================

const CHURNER = "f5249931-cf72-4d8f-86d0-94ef4b54a730";

function churnerBoard(o: { zone?: "play" | "hand"; tokens?: number; controller?: PlayerId; depleted?: boolean } = {}) {
  return barrenBoard([
    { key: "ch", def: printing(CHURNER), owner: P1, zone: o.zone ?? "play", ...(o.controller ? { controller: o.controller } : {}), counters: o.tokens ? { token: o.tokens } : {}, depleted: o.depleted },
    { key: "m1", def: character({ name: "Mine One", strength: 1, life: 3 }), owner: P1, zone: "play" },
    { key: "m2", def: character({ name: "Mine Two", strength: 1, life: 6 }), owner: P1, zone: "play" },
    { key: "o1", def: character({ name: "Their One", strength: 1, life: 3 }), owner: P2, zone: "play" },
    { key: "o2", def: character({ name: "Their Two", strength: 1, life: 9 }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
    { key: "gone", def: character({ name: "Gone", life: 3 }), owner: P1, zone: "discard" },
    ...fillers("pd", 3, P1, "deck"),
    ...fillers("qd", 3, P2, "deck")
  ]);
}

clause(CHURNER, "0:rule", "printed card: an item, cost 3, threshold [R][R][R]; deploys for exactly 3 and is refused one short or with too few [R]", () => {
  const p = printing(CHURNER);
  assert.equal(p.type, "item");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "rrr");
  deployChecks(CHURNER, 3, res({ rage: 3 }), res({ rage: 2 }), res({ rage: 2, greed: 4 }));
});

clause(CHURNER, "0:rule", "at the start of EACH turn (mine and my opponent's) it gets a token", () => {
  const g = churnerBoard();
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
  // At a bigger table the seats between also take turns (each a turn start): count the starts passed.
  const toThem = turnStartsBetween(g.engine, P1, P2);
  const toMe = turnStartsBetween(g.engine, P2, P1);
  endTurn(g.engine, P1); // the opponent's turn starts
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(g.engine, g.id("ch")), toThem, "start of the opponent's turn");
  endTurn(g.engine, P2); // my turn starts
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(g.engine, g.id("ch")), toThem + toMe, "start of my turn");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(tokensOn(g.engine, g.id("ch")), 2 * (toThem + toMe));
});

clause(CHURNER, "0:rule", "exactly one token per turn start, and the other cards get none", () => {
  const g = churnerBoard();
  endTurn(g.engine, P1);
  assert.equal(tokensOn(g.engine, g.id("ch")), turnStartsBetween(g.engine, P1, P2), "one token per turn start, not two");
  for (const k of ["m1", "m2", "o1", "o2", "gear"]) assert.equal(tokensOn(g.engine, g.id(k)), 0, `${k} gets no token`);
});

clause(CHURNER, "0:rule", "a Churner that is not in play gets nothing, and one the opponent controls ticks at each turn start too", () => {
  const inHand = churnerBoard({ zone: "hand" });
  endTurn(inHand.engine, P1);
  endTurn(inHand.engine, P2);
  assert.equal(tokensOn(inHand.engine, inHand.id("ch")), 0, "in hand");
  const theirs = churnerBoard({ controller: P2 });
  endTurn(theirs.engine, P1);
  endTurn(theirs.engine, P2);
  assert.equal(
    tokensOn(theirs.engine, theirs.id("ch")),
    turnStartsBetween(theirs.engine, P1, P2) + turnStartsBetween(theirs.engine, P2, P1),
    "at every turn start, whoever controls it"
  );
});

clause(CHURNER, "0:rule", "the token is added to the tokens already on it, and entering play does not itself give one", () => {
  const g = churnerBoard({ tokens: 3 });
  endTurn(g.engine, P1);
  assert.equal(tokensOn(g.engine, g.id("ch")), 3 + turnStartsBetween(g.engine, P1, P2));
  const d =devBoard([{ key: "ch", def: printing(CHURNER), owner: P1, zone: "hand" }, ...res({ rage: 3 })], { turn: 2 });
  play(d.engine, P1, d.id("ch"));
  assert.equal(zoneOf(d.engine, d.id("ch")), "play");
  assert.equal(tokensOn(d.engine, d.id("ch")), 0, "no token merely for entering play");
});

const hatch = (g: ReturnType<typeof churnerBoard>, victim: string, player: PlayerId = P1) =>
  activate(g.engine, player, g.id("ch"), "down-the-hatch", { selected: { sac: [g.id(victim)] } });

clause(CHURNER, "1:ability:down-the-hatch", "DOWN THE HATCH: destroys a character I control, depletes the Churner and puts a token on it", () => {
  const g = churnerBoard();
  hatch(g, "m1");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "the character is destroyed");
  assert.equal(isDepleted(g.engine, g.id("ch")), true, "the Churner is depleted");
  assert.equal(tokensOn(g.engine, g.id("ch")), 1, "one token");
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  assert.equal(zoneOf(g.engine, g.id("m2")), "play", "my other character is untouched");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
});

clause(CHURNER, "1:ability:down-the-hatch", "the costs are paid when it is activated: character destroyed and Churner depleted while the token is still to come", () => {
  const g = churnerBoard();
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("ch"), abilityId: "down-the-hatch", selected: { sac: [g.id("m1")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("m1")), "discard", "destroyed as a cost");
  assert.equal(isDepleted(g.engine, g.id("ch")), true, "depleted as a cost");
  assert.equal(tokensOn(g.engine, g.id("ch")), 0, "the token comes with the effect, after responses");
  resolvePendingResponses(g.engine);
  assert.equal(tokensOn(g.engine, g.id("ch")), 1);
});

clause(CHURNER, "1:ability:down-the-hatch", "only a character I control can be destroyed: the opponent's character, an item, and a card in the discard pile are refused", () => {
  const g = churnerBoard();
  refused(() => hatch(g, "o1"), "an opponent's character");
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
  refused(() => hatch(g, "gear"), "an item");
  assert.equal(zoneOf(g.engine, g.id("gear")), "play");
  refused(() => hatch(g, "gone"), "a card in the discard pile");
  assert.equal(isDepleted(g.engine, g.id("ch")), false, "nothing was paid by the refused tries");
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
  hatch(g, "m2");
  assert.equal(zoneOf(g.engine, g.id("m2")), "discard", "control: my own character works");
});

clause(CHURNER, "1:ability:down-the-hatch", "a depleted Churner cannot use it (the deplete cost), and it can be used again once restored", () => {
  const g = churnerBoard({ depleted: true });
  refused(() => hatch(g, "m1"), "the Churner is depleted");
  assert.equal(zoneOf(g.engine, g.id("m1")), "play");
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
  const h = churnerBoard();
  hatch(h, "m1");
  refused(() => hatch(h, "m2"), "second use while depleted");
  assert.equal(zoneOf(h.engine, h.id("m2")), "play");
  assert.equal(tokensOn(h.engine, h.id("ch")), 1);
  h.engine.state.cards[h.id("ch")].depleted = false;
  hatch(h, "m2");
  assert.equal(tokensOn(h.engine, h.id("ch")), 2, "usable again after it is restored");
});

clause(CHURNER, "1:ability:down-the-hatch", "with no character of mine in play it cannot be used; the opponent cannot use my Churner", () => {
  const none = barrenBoard([
    { key: "ch", def: printing(CHURNER), owner: P1, zone: "play" },
    { key: "o1", def: character({ name: "Their One" }), owner: P2, zone: "play" }
  ]);
  refused(() => activate(none.engine, P1, none.id("ch"), "down-the-hatch", { selected: { sac: [none.id("o1")] } }), "no character of mine to destroy");
  assert.equal(zoneOf(none.engine, none.id("o1")), "play");
  const g = churnerBoard();
  refused(() => activate(g.engine, P2, g.id("ch"), "down-the-hatch", { selected: { sac: [g.id("o1")] } }), "not their card", /controller|control|own|priority|your/i);
  assert.equal(zoneOf(g.engine, g.id("o1")), "play");
});

const churn = (g: ReturnType<typeof churnerBoard>, victim: CardInstanceId, player: PlayerId = P1) =>
  activate(g.engine, player, g.id("ch"), "churn", { selected: { victim: [victim] } });

clause(CHURNER, "2:ability:churn", "CHURN: X is the number of tokens (3): the picked character takes 3 damage and the Churner is destroyed", () => {
  const g = churnerBoard({ tokens: 3 });
  churn(g, g.id("o2"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(g.engine, g.id("o2")), 3, "exactly X damage");
  assert.equal(zoneOf(g.engine, g.id("o2")), "play", "life 9 survives");
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "the Churner is destroyed");
  for (const k of ["m1", "m2", "o1"]) assert.equal(damageOn(g.engine, g.id(k)), 0, `${k} takes nothing`);
});

clause(CHURNER, "2:ability:churn", "X follows the tokens: 1 token deals 1 damage, 5 tokens deal 5 (and destroy a 3-life character)", () => {
  const one = churnerBoard({ tokens: 1 });
  churn(one, one.id("o2"));
  assert.equal(damageOn(one.engine, one.id("o2")), 1);
  const five = churnerBoard({ tokens: 5 });
  churn(five, five.id("o1"));
  assert.equal(zoneOf(five.engine, five.id("o1")), "discard", "5 damage destroys a 3-life character");
});

clause(CHURNER, "2:ability:churn", "the Churner can pick a character of mine, and the damage goes to that character", () => {
  const g = churnerBoard({ tokens: 2 });
  churn(g, g.id("m2"));
  assert.equal(damageOn(g.engine, g.id("m2")), 2);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
});

clause(CHURNER, "2:ability:churn", "it can pick a faction: the opponent's faction loses X influence, and so can my own", () => {
  const g = churnerBoard({ tokens: 4 });
  const before = influence(g.engine, P2);
  churn(g, factionOf(g.engine, P2));
  assert.equal(before - influence(g.engine, P2), 4);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
  const own = churnerBoard({ tokens: 2 });
  const mine = influence(own.engine, P1);
  churn(own, factionOf(own.engine, P1));
  assert.equal(mine - influence(own.engine, P1), 2, "a faction of mine is a legal pick");
});

clause(CHURNER, "2:ability:churn", "X is fixed by the cost: destroying the Churner does not turn the damage into 0", () => {
  const g = churnerBoard({ tokens: 3 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("ch"), abilityId: "churn", selected: { victim: [g.id("o2")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard", "destroyed as a cost, before any response");
  assert.equal(damageOn(g.engine, g.id("o2")), 0, "the damage comes with the effect");
  resolvePendingResponses(g.engine);
  assert.equal(damageOn(g.engine, g.id("o2")), 3, "still X = 3");
});

clause(CHURNER, "2:ability:churn", "with no tokens X is 0: it can be used, destroys the Churner and deals no damage", () => {
  const g = churnerBoard({ tokens: 0 });
  churn(g, g.id("o2"));
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
  assert.equal(damageOn(g.engine, g.id("o2")), 0);
});

clause(CHURNER, "2:ability:churn", "only a character or a faction can be picked: an item and a card in the discard pile are refused", () => {
  const g = churnerBoard({ tokens: 2 });
  refused(() => churn(g, g.id("gear")), "an item");
  refused(() => churn(g, g.id("gone")), "a discarded character");
  assert.equal(zoneOf(g.engine, g.id("ch")), "play", "nothing was paid by the refused tries");
  assert.equal(damageOn(g.engine, g.id("gear")), 0);
  churn(g, g.id("o1"));
  assert.equal(damageOn(g.engine, g.id("o1")), 2, "control: a character works");
});

clause(CHURNER, "2:ability:churn", "the Churner may be depleted: CHURN has no deplete cost", () => {
  const g = churnerBoard({ tokens: 2, depleted: true });
  churn(g, g.id("o2"));
  assert.equal(damageOn(g.engine, g.id("o2")), 2);
  assert.equal(zoneOf(g.engine, g.id("ch")), "discard");
});

clause(CHURNER, "2:ability:churn", "the opponent cannot use my Churner's CHURN", () => {
  const g = churnerBoard({ tokens: 2 });
  refused(() => churn(g, g.id("m1"), P2), "not their card", /controller|control|own|priority|your/i);
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
});

// =============================================================================
// Deadly Striker -- character (warlord) dragon, cost 4, threshold [R][R], 4 / 3 / 2
// =============================================================================

const STRIKER = "e26eb079-952b-4396-bb5d-79894ac5417e";

function strikerBoard(o: { controller?: PlayerId; p2Influence?: number; extra?: CardPlacement[] } = {}) {
  const g = devBoard(
    [
      { key: "st", def: printing(STRIKER), owner: o.controller ?? P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3 }), owner: o.controller === P2 ? P1 : P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
  if (o.p2Influence !== undefined) g.engine.state.players[P2].influence = o.p2Influence;
  return g;
}

clause(STRIKER, "0:rule", "printed card: a 4/3/2 dragon for cost 4 with [R][R]; one short or one [R] is refused", () => {
  deployChecks(STRIKER, 4, res({ rage: 2, greed: 2 }), res({ rage: 2, greed: 1 }), res({ rage: 1, greed: 3 }));
  const g = strikerBoard();
  assert.equal(stat(g.engine, g.id("st"), "strength"), 4);
  assert.equal(stat(g.engine, g.id("st"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("st"), "life"), 2);
  assert.deepEqual(g.engine.getDefinition(g.id("st")).subtype, ["dragon"]);
});

clause(STRIKER, "0:rule", "when it is destroyed an opponent's faction loses 4 influence, mine does not", () => {
  const g = strikerBoard();
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("st")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("st")), "discard");
  assert.equal(influence(g.engine, P2), 30 - 4, "the opponent loses exactly 4");
  assert.equal(influence(g.engine, P1), 30, "my faction is unaffected");
});

clause(STRIKER, "0:rule", "it triggers on destruction by battle damage as well", () => {
  const g = devBoard(
    [
      { key: "st", def: printing(STRIKER), owner: P1, zone: "play" },
      { key: "big", def: character({ name: "Big", strength: 5, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ],
    { turn: 2, activePlayerId: P2 }
  );
  fight(g.engine, P2, [g.id("big")], { type: "faction", playerId: P1 }, [g.id("st")]);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("st")), "discard");
  assert.equal(influence(g.engine, P2), 26, "the attacker's controller is the Striker's opponent");
  assert.equal(influence(g.engine, P1), 30);
});

clause(STRIKER, "0:rule", "it does not trigger when it leaves play without being destroyed (bounced to hand)", () => {
  const g = strikerBoard();
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("st")] } });
  assert.equal(zoneOf(g.engine, g.id("st")), "hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(influence(g.engine, P2), 30, "no influence loss");
});

clause(STRIKER, "0:rule", "another character being destroyed does not trigger it", () => {
  const g = strikerBoard();
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(influence(g.engine, P2), 30);
  assert.equal(influence(g.engine, P1), 30);
});

clause(STRIKER, "0:rule", "a Striker the opponent controls costs THEM nothing: when it is destroyed my faction loses 4 (its controller's opponent)", () => {
  const h = devBoard(
    [
      { key: "st", def: printing(STRIKER), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 2 }
  );
  play(h.engine, P1, h.id("kill"), { selected: { t: [h.id("st")] } });
  drain(h.engine, declineAll);
  assert.equal(zoneOf(h.engine, h.id("st")), "discard");
  assert.equal(influence(h.engine, P1), 30 - 4, "the Striker's controller is P2, so P1 (their opponent) loses 4");
  assert.equal(influence(h.engine, P2), 30);
});

clause(STRIKER, "0:rule", "influence stops at 0 when the opponent has less than 4", () => {
  const g = strikerBoard({ p2Influence: 3 });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("st")] } });
  drain(g.engine, declineAll);
  assert.equal(influence(g.engine, P2), 0, "3 - 4 stops at 0 (CR 410.4)");
});
// =============================================================================
// Devilfang Thunderhoof -- character (arcanist) thunderhoof/seraphim/dragon, cost 5, threshold [O], 1 / 3 / 4
// =============================================================================

const THUNDER = "e1d91071-20c5-4eac-9dec-5b147de9804e";

/** Thunderhoof in hand with `mine` resources (cost 5 means five are spent); the opponent has `theirs`. */
function thunderHandBoard(mine: Icons, theirs: Icons = {}, extra: CardPlacement[] = []) {
  return devBoard(
    [
      { key: "th", def: printing(THUNDER), owner: P1, zone: "hand" },
      { key: "oc", def: character({ name: "Other Char", cost: 0 }), owner: P1, zone: "hand" },
      ...res(mine),
      ...res(theirs, P2),
      ...extra
    ],
    { turn: 2 }
  );
}

clause(THUNDER, "0:unique", "has UNIQUE THUNDERHOOF: a second Thunderhoof under my control makes me choose one to keep (either)", () => {
  uniqueChecks(THUNDER);
});

clause(THUNDER, "0:unique", "the designation is THUNDERHOOF: another card with UNIQUE THUNDERHOOF counts, a different designation does not", () => {
  const same = devBoard([
    { key: "old", def: character({ name: "Other Thunder", unique: "thunderhoof" }), owner: P1, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(same.engine, P1, same.id("new"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor");
  const diff = devBoard([
    { key: "old", def: character({ name: "Other Unique", unique: "somethingelse" }), owner: P1, zone: "play" },
    { key: "new", def: printing(THUNDER), owner: P1, zone: "hand" },
    ...res({ obsession: 1, rage: 5 })
  ]);
  play(diff.engine, P1, diff.id("new"));
  assert.equal(diff.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(diff.engine, diff.id("old")), "play");
  assert.equal(zoneOf(diff.engine, diff.id("new")), "play");
});

clause(THUNDER, "0:unique", "printed card: 1/3/4 for cost 5 with [O]; four resources or no [O] are refused", () => {
  deployChecks(THUNDER, 5, res({ obsession: 1, rage: 4 }), res({ obsession: 1, rage: 3 }), res({ rage: 5 }));
  const g = thunderHandBoard({ obsession: 1, rage: 4 });
  play(g.engine, P1, g.id("th"));
  assert.equal(stat(g.engine, g.id("th"), "strength"), 1 + 1, "1 base + 1 token");
  assert.equal(stat(g.engine, g.id("th"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("th"), "life"), 4);
  assert.deepEqual([...g.engine.getDefinition(g.id("th")).subtype].sort(), ["dragon", "seraphim", "thunderhoof"]);
});

clause(THUNDER, "1:rule", "when it enters play it gets one token per [O] I control: 1, 3 and 5 [O]", () => {
  for (const [obsession, rage] of [[1, 4], [3, 2], [5, 0]] as const) {
    const g = thunderHandBoard({ obsession, rage });
    play(g.engine, P1, g.id("th"));
    assert.equal(zoneOf(g.engine, g.id("th")), "play");
    assert.equal(tokensOn(g.engine, g.id("th")), obsession, `${obsession} [O]`);
  }
});

clause(THUNDER, "1:rule", "only MY [O] count: the opponent's [O] resources and face-down Volition resources do not", () => {
  const g = thunderHandBoard({ obsession: 1, rage: 4 }, { obsession: 3 });
  play(g.engine, P1, g.id("th"));
  assert.equal(tokensOn(g.engine, g.id("th")), 1, "the opponent's three [O] do not count");
  const v = devBoard([{ key: "th", def: printing(THUNDER), owner: P1, zone: "hand" }, ...res({ obsession: 1, rage: 2 }), ...volition(2)], { turn: 2 });
  play(v.engine, P1, v.id("th"));
  assert.equal(zoneOf(v.engine, v.id("th")), "play");
  assert.equal(tokensOn(v.engine, v.id("th")), 1, "Volition is not [O]");
});

clause(THUNDER, "1:rule", "the trigger is for Thunderhoof itself entering play: another character entering later gives it no tokens", () => {
  const g = devBoard(
    [
      { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
      { key: "oc", def: character({ name: "Other Char", cost: 0 }), owner: P1, zone: "hand" },
      ...res({ obsession: 3 })
    ],
    { turn: 2 }
  );
  play(g.engine, P1, g.id("oc"));
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(g.engine, g.id("th")), 0);
});

clause(THUNDER, "2:rule", "gains 1 strength per token: 0, 1 and 4 tokens give 1, 2 and 5; speed and life are unchanged", () => {
  for (const tokens of [0, 1, 4]) {
    const g = devBoard([{ key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} }]);
    assert.equal(stat(g.engine, g.id("th"), "strength"), 1 + tokens, `${tokens} tokens`);
    assert.equal(stat(g.engine, g.id("th"), "speed"), 3);
    assert.equal(stat(g.engine, g.id("th"), "life"), 4);
  }
});

clause(THUNDER, "2:rule", "only tokens on THIS card count, and only this card gains strength", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "mate", def: character({ name: "Mate", strength: 2, life: 3 }), owner: P1, zone: "play", counters: { token: 3 } },
    { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" }
  ]);
  assert.equal(stat(g.engine, g.id("th"), "strength"), 1);
  assert.equal(stat(g.engine, g.id("mate"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("foe"), "strength"), 2);
});

clause(THUNDER, "2:rule", "the strength is real in battle: with 2 tokens it deals 3 damage to a blocker, with none only 1", () => {
  const board = (tokens: number) =>
    devBoard(
      [
        { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: tokens ? { token: tokens } : {} },
        { key: "foe", def: character({ name: "Foe", strength: 0, life: 3 }), owner: P2, zone: "play" }
      ],
      { turn: 2 }
    );
  const strong = board(2);
  fight(strong.engine, P1, [strong.id("th")], { type: "faction", playerId: P2 }, [strong.id("foe")]);
  assert.equal(zoneOf(strong.engine, strong.id("foe")), "discard", "3 damage kills the 3-life blocker");
  const weak = board(0);
  fight(weak.engine, P1, [weak.id("th")], { type: "faction", playerId: P2 }, [weak.id("foe")]);
  assert.equal(zoneOf(weak.engine, weak.id("foe")), "play");
  assert.equal(damageOn(weak.engine, weak.id("foe")), 1);
});

function disruptBoard(o: { tokens?: number; res?: Icons; oppHand?: number; myHand?: number } = {}) {
  return devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play", counters: o.tokens === 0 ? {} : { token: o.tokens ?? 3 } },
    ...fillers("oh", o.oppHand ?? 3, P2, "hand"),
    ...fillers("mh", o.myHand ?? 1, P1, "hand"),
    ...res(o.res ?? { rage: 4 })
  ]);
}
const disrupt = (g: ReturnType<typeof disruptBoard>): void => activate(g.engine, P1, g.id("th"), "thunderhoof-disrupt");

clause(THUNDER, "3:ability:thunderhoof-disrupt", "the OPPONENT chooses which card to discard; exactly that one goes to their discard pile", () => {
  const g = disruptBoard();
  disrupt(g);
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the opponent chooses what they discard");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("oh1")), "discard");
  assert.equal(zoneOf(g.engine, g.id("oh0")), "hand");
  assert.equal(zoneOf(g.engine, g.id("oh2")), "hand");
  assert.equal(handOf(g.engine, P2).length, 2, "exactly one card");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "my own hand cannot be discarded by it, and discarding none or two is refused", () => {
  const g = disruptBoard();
  disrupt(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mh0")] }), "my card is not theirs to discard");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "discarding nothing");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh0"), g.id("oh1")] }), "discarding two");
  assert.equal(zoneOf(g.engine, g.id("mh0")), "hand");
  assert.equal(handOf(g.engine, P2).length, 3, "nothing was discarded by the refused answers");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("oh2")] });
  assert.equal(handOf(g.engine, P2).length, 2);
  assert.equal(handOf(g.engine, P1).length, 1);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "COST: pays exactly 2 resources and removes exactly one token, before the opponent answers", () => {
  const g = disruptBoard({ res: { rage: 4 } });
  const before = ready(g.engine);
  disrupt(g);
  assert.equal(pending(g.engine)?.kind, "chooserSelectsTarget");
  assert.equal(before - ready(g.engine), 2, "two resources spent");
  assert.equal(tokensOn(g.engine, g.id("th")), 2, "one token removed");
  assert.equal(stat(g.engine, g.id("th"), "strength"), 3, "and the strength bonus drops with it");
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "cannot be used without a token, with fewer than 2 ready resources, or by the opponent", () => {
  const noToken = disruptBoard({ tokens: 0 });
  refused(() => disrupt(noToken), "no token to remove");
  assert.equal(handOf(noToken.engine, P2).length, 3);
  assert.equal(ready(noToken.engine), 4, "nothing was paid");
  const one = disruptBoard({ res: { rage: 1 } });
  refused(() => disrupt(one), "one resource");
  assert.equal(tokensOn(one.engine, one.id("th")), 3, "no token was removed");
  const two = disruptBoard({ res: { rage: 2 } });
  disrupt(two);
  drain(two.engine, pickTargets([two.id("oh0")]));
  assert.equal(zoneOf(two.engine, two.id("oh0")), "discard", "control: two resources is enough");
  const g = disruptBoard();
  refused(() => activate(g.engine, P2, g.id("th"), "thunderhoof-disrupt"), "not their card", /controller|control|own|priority|your/i);
  assert.equal(tokensOn(g.engine, g.id("th")), 3);
});

clause(THUNDER, "3:ability:thunderhoof-disrupt", "tokens on other cards cannot pay it; an opponent with an empty hand discards nothing but the cost is still paid", () => {
  const g = devBoard([
    { key: "th", def: printing(THUNDER), owner: P1, zone: "play" },
    { key: "mate", def: character({ name: "Mate" }), owner: P1, zone: "play", counters: { token: 3 } },
    ...fillers("oh", 2, P2, "hand"),
    ...res({ rage: 4 })
  ]);
  refused(() => activate(g.engine, P1, g.id("th"), "thunderhoof-disrupt"), "Thunderhoof has no tokens");
  assert.equal(tokensOn(g.engine, g.id("mate")), 3);
  const empty = disruptBoard({ oppHand: 0 });
  disrupt(empty);
  assert.equal(empty.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(empty.engine, empty.id("th")), 2);
  assert.equal(ready(empty.engine), 2);
});

// =============================================================================
// Drill Garrison -- location (warlord), cost 3, threshold [R], structure 5, UNIQUE DRILL GARRISON
// =============================================================================

const DG = "ecf19d3f-857f-4a62-8c29-dd293164c495";

function dgBoard(o: { rage?: number; greed?: number; spent?: number; zone?: "play" | "hand" | "discard"; controller?: PlayerId; p2Rage?: number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    random: () => 0.5,
    cards: [
      { key: "dg", def: printing(DG), owner: P1, zone: o.zone ?? "play", ...(o.controller ? { controller: o.controller } : {}) },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", life: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "gone", def: character({ name: "Gone", life: 5 }), owner: P2, zone: "discard" },
      ...bank("rage", o.rage ?? 0, P1),
      ...bank("greed", o.greed ?? 0, P1),
      ...spentResources(P1, o.spent ?? 0),
      ...bank("rage", o.p2Rage ?? 0, P2),
      ...fillers("pd", 4, P1, "deck"),
      ...fillers("qd", 4, P2, "deck")
    ]
  });
}
type DgBoard = ReturnType<typeof dgBoard>;
const startOfP1 = (b: DgBoard) => endTurn(b.engine, P2);

interface Plan {
  opt?: number;
  deplete?: CardInstanceId[];
  damage?: CardInstanceId[];
}
/** Answers every prompt of the start-of-turn triggers; returns which prompts appeared (sorted). */
function runStart(b: DgBoard, plan: Plan = {}): string[] {
  const seen: string[] = [];
  drain(b.engine, (pc) => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "chooserSelectsOption") {
      seen.push(`option:${pc.playerId}`);
      return { kind: pc.kind, index: plan.opt ?? 0 };
    }
    if (pc.kind === "chooserSelectsTarget") {
      const fx = JSON.stringify(pc.effects);
      const k = fx.includes('"deplete"') ? "deplete" : fx.includes('"dealDamage"') ? "damage2" : "other";
      seen.push(`${k}:${pc.playerId}`);
      return { kind: pc.kind, selected: (k === "deplete" ? plan.deplete : plan.damage) ?? [] };
    }
    throw new Error(`unexpected prompt ${pc.kind}`);
  });
  return seen.sort();
}
/** Advances the start-of-turn prompts (order / option) until the pick prompt for `want` is pending. */
function dgPickPrompt(b: DgBoard, want: "deplete" | "dealDamage"): void {
  for (let i = 0; i < 10; i++) {
    const pc = pending(b.engine);
    assert.ok(pc, `a prompt is pending while looking for the ${want} pick`);
    if (pc.kind === "orderTriggers") answerPending(b.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
    else if (pc.kind === "chooserSelectsOption") answerPending(b.engine, "chooserSelectsOption", { index: 0 });
    else if (pc.kind === "chooserSelectsTarget") {
      if (JSON.stringify(pc.effects).includes(`"${want}"`)) return;
      answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
    } else throw new Error(`unexpected prompt ${pc.kind}`);
  }
  throw new Error(`no ${want} pick prompt appeared`);
}

clause(DG, "0:unique", "printed card: a warlord location, structure 5, cost 3, threshold [R]; deploys for exactly 3 with one [R]", () => {
  const p = printing(DG);
  assert.equal(p.type, "location");
  assert.equal(p.cost, 3);
  assert.equal(p.threshold, "r");
  const b = dgBoard();
  assert.equal(stat(b.engine, b.id("dg"), "structure"), 5);
  deployChecks(DG, 3, res({ rage: 1, greed: 2 }), res({ rage: 1, greed: 1 }), res({ greed: 3 }));
});

clause(DG, "0:unique", "UNIQUE DRILL GARRISON: a second one makes you keep one (either); the opponent's copy is separate", () => {
  uniqueChecks(DG);
});

clause(DG, "1:rule@rrr", "with [R][R][R] at the start of my turn I may inflict 1 damage to an opponent (accept, then decline)", () => {
  const acc = dgBoard({ rage: 3 });
  startOfP1(acc);
  const pc = pending(acc.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.equal(acc.engine.state.activePlayerId, P1);
  const i0 = influence(acc.engine, P2);
  answerPending(acc.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(acc.engine.state.pendingChoice, undefined);
  assert.equal(influence(acc.engine, P2), i0 - 1, "the opponent's faction takes exactly 1");
  assert.equal(influence(acc.engine, P1), 30, "not my own faction");
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(damageOn(acc.engine, acc.id(k)), 0, `${k} takes nothing`);
  const dec = dgBoard({ rage: 3 });
  startOfP1(dec);
  answerPending(dec.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(dec.engine.state.pendingChoice, undefined);
  assert.equal(influence(dec.engine, P2), 30, "declining inflicts nothing");
  assert.equal(influence(dec.engine, P1), 30);
});

clause(DG, "1:rule@rrr", "needs three [R]: two [R], or three non-[R] resources, do nothing; spent [R] count", () => {
  const few = dgBoard({ rage: 2 });
  startOfP1(few);
  assert.equal(few.engine.state.pendingChoice, undefined, "two [R]");
  const mixed = dgBoard({ rage: 2, greed: 3 });
  startOfP1(mixed);
  assert.equal(mixed.engine.state.pendingChoice, undefined, "two [R] + three [G]");
  const ok = dgBoard({ rage: 3, greed: 2 });
  startOfP1(ok);
  assert.deepEqual(runStart(ok, { opt: 1 }), ["option:p1"], "three [R]; extra non-[R] resources change nothing");
  assert.equal(influence(ok.engine, P2), 29);
  const spent = dgBoard({ spent: 3 });
  startOfP1(spent);
  assert.deepEqual(runStart(spent, { opt: 1 }), ["option:p1"], "spent [R] still meet the threshold");
  assert.equal(influence(spent.engine, P2), 29);
});

clause(DG, "1:rule@rrr", "only at the start of MY turn (not the opponent's), only while in play, and again each of my turns", () => {
  const opp = dgBoard({ rage: 3 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1); // the opponent's turn begins
  assert.equal(opp.engine.state.activePlayerId, P2);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's turn start does nothing");
  assert.equal(influence(opp.engine, P2), 30);
  const hand = dgBoard({ rage: 3, zone: "hand" });
  startOfP1(hand);
  assert.equal(hand.engine.state.pendingChoice, undefined, "in hand");
  const gy = dgBoard({ rage: 3, zone: "discard" });
  startOfP1(gy);
  assert.equal(gy.engine.state.pendingChoice, undefined, "in the discard pile");
  const again = dgBoard({ rage: 3 });
  startOfP1(again);
  answerPending(again.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influence(again.engine, P2), 29);
  endTurn(again.engine, P1);
  assert.equal(again.engine.state.pendingChoice, undefined, "no prompt on the opponent's turn");
  endTurn(again.engine, P2);
  assert.equal(pending(again.engine)?.kind, "chooserSelectsOption", "asks again on my next turn");
  answerPending(again.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influence(again.engine, P2), 28);
});

clause(DG, "1:rule@rrr", "a Garrison controlled by the other player counts THEIR [R] and hits the controller's opponent on THEIR turn", () => {
  const b = dgBoard({ controller: P2, p2Rage: 3 });
  b.engine.state.activePlayerId = P1;
  endTurn(b.engine, P1); // P2's turn
  const pc = pending(b.engine)!;
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "its controller chooses");
  answerPending(b.engine, "chooserSelectsOption", { index: 1 });
  assert.equal(influence(b.engine, P1), 29, "the controller's opponent is hit");
  assert.equal(influence(b.engine, P2), 30);
  const c = dgBoard({ controller: P2, rage: 3 });
  c.engine.state.activePlayerId = P1;
  endTurn(c.engine, P1);
  assert.equal(c.engine.state.pendingChoice, undefined, "the owner's [R] do not count when someone else controls it");
});

clause(DG, "2:rule@rrrrr", "with five [R] I may pick a character (mine or theirs) and deplete it, without damage; the 3-[R] option is still offered", () => {
  const foe = dgBoard({ rage: 5 });
  startOfP1(foe);
  const seen = runStart(foe, { deplete: [foe.id("foe")] });
  assert.deepEqual(seen, ["deplete:p1", "option:p1"], "the 3-[R] option still appears, plus one pick");
  assert.equal(isDepleted(foe.engine, foe.id("foe")), true);
  assert.equal(damageOn(foe.engine, foe.id("foe")), 0, "depleting deals no damage");
  for (const k of ["mine", "mine2", "foe2"]) assert.equal(isDepleted(foe.engine, foe.id(k)), false, `${k} stays ready`);
  const own = dgBoard({ rage: 5 });
  startOfP1(own);
  runStart(own, { deplete: [own.id("mine")] });
  assert.equal(isDepleted(own.engine, own.id("mine")), true);
  assert.equal(isDepleted(own.engine, own.id("foe")), false);
  assert.equal(influence(own.engine, P2), 30, "the 1-damage option was declined");
});

clause(DG, "2:rule@rrrrr", "the pick is optional (declining depletes nothing); only ONE character in play can be picked", () => {
  const dec = dgBoard({ rage: 5 });
  startOfP1(dec);
  runStart(dec, {});
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(isDepleted(dec.engine, dec.id(k)), false, k);
  const probe = (key: string | undefined) => {
    const b = dgBoard({ rage: 5 });
    startOfP1(b);
    dgPickPrompt(b, "deplete");
    const id = key === "faction" ? factionOf(b.engine, P2) : b.id(key!);
    return { b, run: () => answerPending(b.engine, "chooserSelectsTarget", { selected: [id] }) };
  };
  refused(probe("gear").run, "an item is not a character");
  refused(probe("gone").run, "a character in the discard pile is not in play");
  refused(probe("faction").run, "a faction is not a character");
  const two = dgBoard({ rage: 5 });
  startOfP1(two);
  dgPickPrompt(two, "deplete");
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe"), two.id("foe2")] }), "two characters");
  for (const k of ["foe", "foe2"]) assert.equal(isDepleted(two.engine, two.id(k)), false, `${k} not depleted by the refused pick`);
  const ok = probe("foe2");
  ok.run();
  assert.equal(isDepleted(ok.b.engine, ok.b.id("foe2")), true, "control: a character in play");
});

clause(DG, "2:rule@rrrrr", "needs five [R] (four [R] gives no pick prompt, spent [R] count), only on my turn and while in play", () => {
  const four = dgBoard({ rage: 4, greed: 3 });
  startOfP1(four);
  assert.deepEqual(runStart(four), ["option:p1"], "four [R] + three [G]");
  const spent = dgBoard({ rage: 2, spent: 3 });
  startOfP1(spent);
  assert.deepEqual(runStart(spent, { deplete: [spent.id("foe")] }), ["deplete:p1", "option:p1"], "two ready + three spent [R]");
  assert.equal(isDepleted(spent.engine, spent.id("foe")), true);
  const opp = dgBoard({ rage: 5 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's turn");
  const hand = dgBoard({ rage: 5, zone: "hand" });
  startOfP1(hand);
  assert.equal(hand.engine.state.pendingChoice, undefined, "in hand");
});

clause(DG, "3:rule@rrrrrrr", "with seven [R] I may pick a character (mine or theirs) and it takes exactly 2 damage; all three rules are live", () => {
  const foe = dgBoard({ rage: 7 });
  startOfP1(foe);
  const seen = runStart(foe, { damage: [foe.id("foe")] });
  assert.deepEqual(seen, ["damage2:p1", "deplete:p1", "option:p1"], "all three rules are live at 7 [R]");
  assert.equal(damageOn(foe.engine, foe.id("foe")), 2, "exactly 2 damage");
  assert.equal(isDepleted(foe.engine, foe.id("foe")), false, "the 2-damage target is not depleted (that pick was declined)");
  for (const k of ["mine", "mine2", "foe2"]) assert.equal(damageOn(foe.engine, foe.id(k)), 0, k);
  const own = dgBoard({ rage: 7 });
  startOfP1(own);
  runStart(own, { damage: [own.id("mine")] });
  assert.equal(damageOn(own.engine, own.id("mine")), 2);
  assert.equal(damageOn(own.engine, own.id("foe")), 0);
});

clause(DG, "3:rule@rrrrrrr", "2 damage destroys a life-2 character; declining inflicts nothing; one character only; non-characters refused", () => {
  const b = dgBoard({ rage: 7 });
  startOfP1(b);
  runStart(b, { damage: [b.id("foe2")] });
  assert.equal(zoneOf(b.engine, b.id("foe2")), "discard");
  const dec = dgBoard({ rage: 7 });
  startOfP1(dec);
  runStart(dec, {});
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(damageOn(dec.engine, dec.id(k)), 0, k);
  const two = dgBoard({ rage: 7 });
  startOfP1(two);
  dgPickPrompt(two, "dealDamage");
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe"), two.id("foe2")] }), "two characters");
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("gear")] }), "an item");
  refused(() => answerPending(two.engine, "chooserSelectsTarget", { selected: [factionOf(two.engine, P2)] }), "a faction");
  for (const k of ["foe", "foe2", "gear"]) assert.equal(damageOn(two.engine, two.id(k)), 0, `${k} took nothing from the refused picks`);
  answerPending(two.engine, "chooserSelectsTarget", { selected: [two.id("foe")] });
  assert.equal(damageOn(two.engine, two.id("foe")), 2, "control: one character takes 2");
});

clause(DG, "3:rule@rrrrrrr", "needs seven [R] (six does not offer the damage pick), and only at the start of my turn", () => {
  const six = dgBoard({ rage: 6 });
  startOfP1(six);
  assert.deepEqual(runStart(six, { opt: 1, deplete: [six.id("mine")], damage: [six.id("foe")] }), ["deplete:p1", "option:p1"], "six [R]: no damage pick");
  assert.equal(damageOn(six.engine, six.id("foe")), 0);
  const spent = dgBoard({ rage: 3, spent: 4 });
  startOfP1(spent);
  assert.deepEqual(runStart(spent, { damage: [spent.id("foe")] }), ["damage2:p1", "deplete:p1", "option:p1"], "ready + spent [R] reach seven");
  assert.equal(damageOn(spent.engine, spent.id("foe")), 2);
  const opp = dgBoard({ rage: 7 });
  opp.engine.state.activePlayerId = P1;
  endTurn(opp.engine, P1);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's turn");
});

// =============================================================================
// Drygulch -- tactic (rogue), cost 2, threshold [D]
// =============================================================================

const DRY = "1fbda8b0-b45e-4e23-bb6f-06c2c6d74aef";

const spentIcon = (icon: StapleIcon, n: number, owner: PlayerId = P1): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const dryBoard = (o: { pay?: CardPlacement[]; extra?: CardPlacement[]; life?: number; owner?: PlayerId } = {}) =>
  devBoard(
    [
      { key: "dy", def: printing(DRY), owner: P1, zone: "hand" },
      { key: "t", def: character({ name: "Target", strength: 1, life: o.life ?? 1 }), owner: o.owner ?? P2, zone: "play" },
      ...(o.pay ?? [...spentIcon("deception", 1), ...volition(2)]),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
type DryBoard = ReturnType<typeof dryBoard>;
const dryCast = (b: DryBoard, pick = "t"): void => {
  play(b.engine, P1, b.id("dy"), { selected: { c: [b.id(pick)] } });
  drain(b.engine, declineAll);
  assert.equal(b.engine.state.pendingChoice, undefined);
};

clause(DRY, "0:extraCost", "printed card: a rogue tactic, cost 2, threshold [D]: cast with 2 ready + [D]; refused with 1 ready, no [D], or only the opponent's [D]", () => {
  const def = printing(DRY);
  assert.equal(def.type, "tactic");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "d");
  const ok = dryBoard();
  dryCast(ok);
  assert.equal(zoneOf(ok.engine, ok.id("dy")), "discard", "cast and discarded");
  assert.equal(ready(ok.engine), 0, "exactly 2 paid");
  const short = dryBoard({ pay: [...spentIcon("deception", 1), ...volition(1)] });
  refused(() => play(short.engine, P1, short.id("dy"), { selected: { c: [short.id("t")] } }), "1 ready for cost 2");
  assert.equal(zoneOf(short.engine, short.id("dy")), "hand");
  const noD = dryBoard({ pay: volition(4) });
  refused(() => play(noD.engine, P1, noD.id("dy"), { selected: { c: [noD.id("t")] } }), "no [D]");
  const theirs = dryBoard({ pay: [...volition(3), ...spentIcon("deception", 2, P2)] });
  refused(() => play(theirs.engine, P1, theirs.id("dy"), { selected: { c: [theirs.id("t")] } }), "the opponent's [D] does not count");
});

clause(DRY, "0:extraCost", "EXTRA COST: pick a character (mine or the opponent's); picking none is refused and pays nothing", () => {
  const mine = dryBoard({ owner: P1 });
  dryCast(mine);
  assert.equal(zoneOf(mine.engine, mine.id("t")), "void", "my own character can be picked");
  const theirs = dryBoard({ owner: P2 });
  dryCast(theirs);
  assert.equal(zoneOf(theirs.engine, theirs.id("t")), "void", "the opponent's can be picked");
  const none = dryBoard();
  refused(() => play(none.engine, P1, none.id("dy")), "no pick");
  assert.equal(zoneOf(none.engine, none.id("dy")), "hand");
  assert.equal(ready(none.engine), 2, "nothing paid");
});

clause(DRY, "0:extraCost", "only a CHARACTER in play: an item, a character in hand or discard pile, and two picks are refused", () => {
  const b = dryBoard({
    extra: [
      { key: "itm", def: item({ name: "Itm", cost: 0 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", life: 1 }), owner: P2, zone: "hand" },
      { key: "inDis", def: character({ name: "InDis", life: 1 }), owner: P2, zone: "discard" },
      { key: "t2", def: character({ name: "T2", life: 1 }), owner: P2, zone: "play" }
    ]
  });
  for (const k of ["itm", "inHand", "inDis"]) {
    refused(() => play(b.engine, P1, b.id("dy"), { selected: { c: [b.id(k)] } }), `${k} is not a character in play`);
  }
  refused(() => play(b.engine, P1, b.id("dy"), { selected: { c: [b.id("t"), b.id("t2")] } }), "two picks");
  assert.equal(zoneOf(b.engine, b.id("dy")), "hand");
  assert.equal(ready(b.engine), 2, "nothing paid by the refused attempts");
  dryCast(b);
  assert.equal(zoneOf(b.engine, b.id("t")), "void", "control");
  assert.equal(zoneOf(b.engine, b.id("t2")), "play");
});

clause(DRY, "1:rule", "voids the character when its life is equal to or less than the [D] I control; one above stays (X = 1, 2, 3)", () => {
  for (const x of [1, 2, 3]) {
    const eq = dryBoard({ life: x, pay: [...spentIcon("deception", x), ...volition(2)] });
    dryCast(eq);
    assert.equal(zoneOf(eq.engine, eq.id("t")), "void", `life ${x} <= X=${x}`);
    if (x > 1) {
      const below = dryBoard({ life: x - 1, pay: [...spentIcon("deception", x), ...volition(2)] });
      dryCast(below);
      assert.equal(zoneOf(below.engine, below.id("t")), "void", `life ${x - 1} < X=${x}`);
    }
    const over = dryBoard({ life: x + 1, pay: [...spentIcon("deception", x), ...volition(2)] });
    dryCast(over);
    assert.equal(zoneOf(over.engine, over.id("t")), "play", `life ${x + 1} > X=${x} stays`);
    assert.equal(zoneOf(over.engine, over.id("dy")), "discard", "the tactic is still spent");
    assert.equal(ready(over.engine), 0, "and its cost still paid");
  }
});

clause(DRY, "1:rule", "Void is the void zone: the character is in neither player's discard pile, hand, deck or play", () => {
  const b = dryBoard();
  dryCast(b);
  const t = b.id("t");
  for (const p of [P1, P2]) {
    const pl = b.engine.state.players[p];
    for (const z of ["hand", "deck", "discard", "play"] as const) assert.ok(!(pl[z] as CardInstanceId[]).includes(t), `${p} ${z}`);
  }
  assert.equal(zoneOf(b.engine, t), "void");
});

clause(DRY, "1:rule", "X is the number of [D] ICONS I control: a card providing [D][D] counts 2, spent or ready, and the opponent's [D] do not count", () => {
  const dd = item({ name: "DD", cost: 0, resource: { provides: ["deception", "deception"], staple: false } } as never);
  const ddSpent: CardPlacement = { key: "dd", def: dd, owner: P1, zone: "play", attachedToKey: "__factionA" };
  const two = dryBoard({ life: 2, pay: [ddSpent, ...volition(2)] });
  dryCast(two);
  assert.equal(zoneOf(two.engine, two.id("t")), "void", "one card providing [D][D] makes X = 2");
  const three = dryBoard({ life: 3, pay: [ddSpent, ...volition(2)] });
  dryCast(three);
  assert.equal(zoneOf(three.engine, three.id("t")), "play", "X = 2 does not void life 3");
  const readyD = dryBoard({ life: 3, pay: [...bank("deception", 3), ...volition(0)] });
  // three ready [D]: pay 2 of them, the third still counts after payment; X stays 3
  dryCast(readyD);
  assert.equal(zoneOf(readyD.engine, readyD.id("t")), "void", "ready [D] count (X = 3 when cast)");
  const theirs = dryBoard({ life: 2, pay: [...spentIcon("deception", 1), ...volition(2), ...spentIcon("deception", 3, P2)] });
  dryCast(theirs);
  assert.equal(zoneOf(theirs.engine, theirs.id("t")), "play", "the opponent's three [D] do not count");
});

clause(DRY, "1:rule", "only the picked character is affected: other characters stay, and a tactic never touches an item", () => {
  const b = dryBoard({
    life: 1,
    extra: [
      { key: "other", def: character({ name: "Other", life: 1 }), owner: P2, zone: "play" },
      { key: "mate", def: character({ name: "Mate", life: 1 }), owner: P1, zone: "play" }
    ]
  });
  dryCast(b);
  assert.equal(zoneOf(b.engine, b.id("t")), "void");
  assert.equal(zoneOf(b.engine, b.id("other")), "play");
  assert.equal(zoneOf(b.engine, b.id("mate")), "play");
});
// =============================================================================
// Dual Blade Assassin -- character (warlord) mercenary/assassin, cost 2, threshold [R][R], 4 / 3 / 4
// EXTRA COST: Deploy this only if you inflicted damage to an opponent's faction this turn.
// =============================================================================

const DUAL = "ca0987a9-99ab-462e-8d61-cc898b3441dc";

/** A free tactic dealing `amount` damage to `who`'s faction (relative to its controller). */
const burnTactic = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Burn ${who} ${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }] }] }
  });
/** A free tactic making `who`'s faction LOSE `amount` influence (not damage). */
const drainTactic = (amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name: `Drain ${who} ${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "drain", type: "activated", effects: [{ type: "modifyInfluence", player: who, amount: -amount }] }] }
  });
/** A free tactic dealing `amount` damage to one picked character (decl `t`). */
const smiteTactic = (amount: number): CardDefinition =>
  tactic({
    name: `Smite ${amount}`,
    cost: 0,
    behavior: { abilities: [{ id: "smite", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
  });

function dualBoard(o: { rage?: number; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "dual", def: printing(DUAL), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Attacker", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blocker", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "burn", def: burnTactic(1, "opponent"), owner: P1, zone: "hand" },
      { key: "burnSelf", def: burnTactic(1, "controller"), owner: P1, zone: "hand" },
      { key: "drain", def: drainTactic(2, "opponent"), owner: P1, zone: "hand" },
      { key: "smite", def: smiteTactic(1), owner: P1, zone: "hand" },
      ...res({ rage: o.rage ?? 2 }),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}
type DualBoard = ReturnType<typeof dualBoard>;
const tryDual = (g: DualBoard): void => play(g.engine, P1, g.id("dual"));
const hitFaction = (g: DualBoard): void => fight(g.engine, P1, [g.id("atk")], { type: "faction", playerId: P2 }, []);

clause(DUAL, "0:extraCost", "printed card: a 4/3/4 mercenary assassin for cost 2 with [R][R]; one short or one [R] is refused (even after damaging the faction)", () => {
  const g = dualBoard();
  hitFaction(g);
  const before = ready(g.engine);
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play");
  assert.equal(before - ready(g.engine), 2, "exactly 2 paid");
  assert.equal(stat(g.engine, g.id("dual"), "strength"), 4);
  assert.equal(stat(g.engine, g.id("dual"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("dual"), "life"), 4);
  assert.deepEqual([...g.engine.getDefinition(g.id("dual")).subtype].sort(), ["assassin", "mercenary"]);
  const short = dualBoard({ rage: 1 });
  hitFaction(short);
  refused(() => tryDual(short), "one resource short");
  assert.equal(zoneOf(short.engine, short.id("dual")), "hand");
  const noIcon = dualBoard({ rage: 1, extra: res({ greed: 3 }) });
  hitFaction(noIcon);
  refused(() => tryDual(noIcon), "only one [R]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("dual")), "hand");
});

clause(DUAL, "0:extraCost", "refused when I have inflicted no damage to an opponent's faction this turn, with a positive control after the damage", () => {
  const g = dualBoard();
  refused(() => tryDual(g), "no damage yet this turn");
  assert.equal(zoneOf(g.engine, g.id("dual")), "hand");
  assert.equal(ready(g.engine), 2, "nothing paid by the refused try");
  hitFaction(g);
  assert.ok(influence(g.engine, P2) < 30, "the attack did damage the faction");
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play", "deploys once I have damaged their faction");
});

clause(DUAL, "0:extraCost", "damage from a tactic to the opponent's faction counts as well as combat damage", () => {
  const g = dualBoard();
  refused(() => tryDual(g), "before the tactic");
  play(g.engine, P1, g.id("burn"));
  assert.equal(influence(g.engine, P2), 29);
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play");
});

clause(DUAL, "0:extraCost", "near misses do not count: damage to a character only, damage to my own faction, and influence loss that is not damage", () => {
  const onlyChar = dualBoard();
  play(onlyChar.engine, P1, onlyChar.id("smite"), { selected: { t: [onlyChar.id("blk")] } });
  assert.equal(damageOn(onlyChar.engine, onlyChar.id("blk")), 1, "the opponent's character took damage");
  refused(() => tryDual(onlyChar), "damage to a character is not damage to the faction");
  const ownFaction = dualBoard();
  play(ownFaction.engine, P1, ownFaction.id("burnSelf"));
  assert.equal(influence(ownFaction.engine, P1), 29);
  refused(() => tryDual(ownFaction), "damage to MY faction is not damage to an opponent's");
  const drained = dualBoard();
  play(drained.engine, P1, drained.id("drain"));
  assert.equal(influence(drained.engine, P2), 28, "influence was lost");
  refused(() => tryDual(drained), "losing influence is not being damaged");
  const blocked = dualBoard();
  fight(blocked.engine, P1, [blocked.id("atk")], { type: "faction", playerId: P2 }, [blocked.id("blk")]);
  assert.equal(influence(blocked.engine, P2), 30, "a blocked attack deals nothing to the faction");
  refused(() => tryDual(blocked), "the faction took no damage");
  for (const b of [onlyChar, ownFaction, drained, blocked]) assert.equal(zoneOf(b.engine, b.id("dual")), "hand");
});

clause(DUAL, "0:extraCost", "'this turn': damage dealt on an earlier turn does not count on a later one", () => {
  const g = dualBoard({ rage: 4 });
  hitFaction(g);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  refused(() => tryDual(g), "the damage was last turn");
  assert.equal(zoneOf(g.engine, g.id("dual")), "hand");
  fight(g.engine, P1, [g.id("atk")], { type: "faction", playerId: P2 }, []);
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play", "damage this turn again");
});

clause(DUAL, "0:extraCost", "the damage must be inflicted by ME: the opponent damaging their own faction (in response to my attack) does not count", () => {
  const g = dualBoard({ extra: [{ key: "theirBurn", def: burnTactic(1, "controller"), owner: P2, zone: "hand" }] });
  declareAttackOpenWindow(g.engine, P1, [g.id("atk")]);
  playRaw(g.engine, P2, g.id("theirBurn"));
  resolvePendingResponses(g.engine);
  assert.equal(influence(g.engine, P2), 29, "the opponent hurt their own faction");
  declareBlockers(g.engine, P2, [g.id("blk")]);
  finishBattle(g.engine);
  assert.equal(influence(g.engine, P2), 29, "my blocked attack added nothing");
  refused(() => tryDual(g), "I inflicted no damage to their faction");
  assert.equal(zoneOf(g.engine, g.id("dual")), "hand");
});

// =============================================================================
// Resource namers: Duplicity ([D]/[R]), Entitlement ([E]/[R]), Fanaticism ([G]/[R])
// "When a resource enters play under your control, name <A> icon or <B> icon. X is the named icon.
//  This turn, this card gains "PROVIDES: X"."
// =============================================================================

const DUPLICITY = "d0cbce25-31b1-412a-b257-77d467f053ed";
const ENTITLEMENT = "464bf4f2-32a0-4f92-91b0-6488af0b2f0c";
const FANATICISM = "f74aeb87-5b92-4b66-b413-bafd0a13bc94";

const ALL_ICONS: StapleIcon[] = ["rage", "greed", "deception", "elitism", "obsession"];
type Icon5 = StapleIcon;

function namerBoard(id: string, o: { zone?: "play" | "hand"; extra?: CardPlacement[]; need?: string } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 1,
    cards: [
      { key: "c", def: printing(id), owner: P1, zone: o.zone ?? "play" },
      { key: "r1", def: resourceCard({ name: "Plain One", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "r2", def: resourceCard({ name: "Plain Two", resource: { provides: ["obsession"], staple: true } }), owner: P1, zone: "hand" },
      { key: "oppRes", def: resourceCard({ name: "Their Plain", resource: { provides: ["obsession"], staple: true } }), owner: P2, zone: "hand" },
      { key: "needy", def: character({ name: "Needy", cost: 0, strength: 1, life: 1, threshold: (o.need ?? "r") as never }), owner: P1, zone: "hand" },
      ...fillers("pd", 3, P1, "deck"),
      ...(o.extra ?? [])
    ]
  });
}
type NamerBoard = ReturnType<typeof namerBoard>;
const thresholdOf = (g: NamerBoard, icon: Icon5 | "volition"): number => (g.engine.getThresholds(P1) as unknown as Record<string, number>)[icon] ?? 0;
const playPlain = (g: NamerBoard, key: string, faceDown = false): void => developResource(g.engine, P1, g.id(key), faceDown);

/** Body of the whole-clause tests for one namer: `a`/`b` are the two namable icons. */
const namerPrompt = (id: string, a: Icon5, b: Icon5) => () => {
  const g = namerBoard(id);
  playPlain(g, "r1");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "nameValue", "a naming prompt appears when my resource enters play");
  assert.equal(pc.playerId, P1, "I name the icon");
  assert.deepEqual([...(pc.options as string[])].sort(), [a, b].sort(), "exactly the two printed icons can be named");
  for (const bad of ALL_ICONS.filter((icon) => icon !== a && icon !== b)) {
    refused(() => answerPending(g.engine, "nameValue", { value: bad }), `${bad} is not one of the two printed icons`);
  }
  assert.equal(pending(g.engine)?.kind, "nameValue", "the prompt is still open after the refused names");
  answerPending(g.engine, "nameValue", { value: a });
  assert.equal(g.engine.state.pendingChoice, undefined);
};

const namerGrants = (id: string, a: Icon5, b: Icon5) => () => {
  for (const [named, unnamed] of [[a, b], [b, a]] as const) {
    const g = namerBoard(id);
    const before = { named: thresholdOf(g, named), unnamed: thresholdOf(g, unnamed), obs: thresholdOf(g, "obsession") };
    playPlain(g, "r1");
    answerPending(g.engine, "nameValue", { value: named });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(thresholdOf(g, named) - before.named, 1, `naming ${named}: the card provides exactly one ${named}`);
    assert.equal(thresholdOf(g, unnamed), before.unnamed, `the other icon (${unnamed}) is not provided`);
    assert.equal(thresholdOf(g, "obsession") - before.obs, 1, "the played resource provides its own icon as usual");
  }
};

const namerThreshold = (id: string, a: Icon5, b: Icon5) => () => {
  // the granted icon is real: a character that needs <a> can be deployed after naming <a>, not after naming <b>
  const need = { rage: "r", greed: "g", deception: "d", elitism: "e", obsession: "o" }[a];
  const yes = namerBoard(id, { need });
  refused(() => play(yes.engine, P1, yes.id("needy")), "before naming: no icon of that kind");
  playPlain(yes, "r1");
  answerPending(yes.engine, "nameValue", { value: a });
  play(yes.engine, P1, yes.id("needy"));
  assert.equal(zoneOf(yes.engine, yes.id("needy")), "play", `after naming ${a} the threshold is met`);
  const no = namerBoard(id, { need });
  playPlain(no, "r1");
  answerPending(no.engine, "nameValue", { value: b });
  refused(() => play(no.engine, P1, no.id("needy")), `naming ${b} does not provide ${a}`);
  assert.equal(zoneOf(no.engine, no.id("needy")), "hand");
};

const namerDuration = (id: string, a: Icon5, b: Icon5) => () => {
  const g = namerBoard(id);
  playPlain(g, "r1");
  answerPending(g.engine, "nameValue", { value: b });
  assert.equal(thresholdOf(g, b), 1);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(thresholdOf(g, b), 0, "'this turn': the PROVIDES is gone on the next turn");
  assert.equal(thresholdOf(g, a), 0);
  assert.equal(zoneOf(g.engine, g.id("c")), "play");
  assert.equal(g.engine.state.provideGrants.length, 0);
};

const namerNearMisses = (id: string) => () => {
  // its own entry does not trigger it
  const own = namerBoard(id, { zone: "hand" });
  playPlain(own, "c");
  assert.equal(own.engine.state.pendingChoice, undefined, "no prompt for its own entry");
  assert.equal(own.engine.state.provideGrants.length, 0);
  // an opponent's resource does not trigger it
  const opp = namerBoard(id);
  opp.engine.state.activePlayerId = P2;
  opp.engine.state.priorityPlayerId = P2;
  playOppResource(opp);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the opponent's resource entering does not prompt");
  assert.equal(opp.engine.state.provideGrants.length, 0);
  // a non-resource entering does not trigger it
  const chr = namerBoard(id, { need: "o", extra: res({ obsession: 1 }) });
  play(chr.engine, P1, chr.id("needy"));
  assert.equal(zoneOf(chr.engine, chr.id("needy")), "play");
  assert.equal(chr.engine.state.pendingChoice, undefined, "a character entering is not a resource entering");
  // in hand it does nothing
  const inHand = namerBoard(id, { zone: "hand" });
  playPlain(inHand, "r1");
  assert.equal(inHand.engine.state.pendingChoice, undefined, "in my hand it does not trigger");
};
function playOppResource(g: NamerBoard): void {
  developResource(g.engine, P2, g.id("oppRes"), false);
}

const namerFaceDownAndStacking = (id: string, a: Icon5, b: Icon5) => () => {
  // a face-down resource is a resource (CR 411.1): it enters play under my control and triggers it too
  const fd = namerBoard(id);
  playPlain(fd, "r1", true);
  assert.equal(pending(fd.engine)?.kind, "nameValue", "a face-down resource entering also prompts");
  answerPending(fd.engine, "nameValue", { value: a });
  assert.equal(thresholdOf(fd, a), 1);
  assert.equal(thresholdOf(fd, "volition"), 1, "the face-down card provides Volition as usual");
  // two resources in one turn: the grants stack (naming each time)
  const g = namerBoard(id);
  playPlain(g, "r1");
  answerPending(g.engine, "nameValue", { value: a });
  playPlain(g, "r2");
  assert.equal(pending(g.engine)?.kind, "nameValue", "the second resource prompts again");
  answerPending(g.engine, "nameValue", { value: b });
  assert.equal(thresholdOf(g, a), 1);
  assert.equal(thresholdOf(g, b), 1, "each naming grants one icon of the named kind");
  assert.equal(g.engine.state.provideGrants.length, 2);
};

clause(DUPLICITY, "0:rule", "naming prompt: when my resource enters play I name [D] or [R] (nothing else can be named)", namerPrompt(DUPLICITY, "deception", "rage"));
clause(DUPLICITY, "0:rule", "the card gains PROVIDES of exactly the named icon: one [D] or one [R], never the other", namerGrants(DUPLICITY, "deception", "rage"));
clause(DUPLICITY, "0:rule", "the gained icon really satisfies a threshold (and the other icon does not)", namerThreshold(DUPLICITY, "deception", "rage"));
clause(DUPLICITY, "0:rule", "'this turn': the gained PROVIDES ends with the turn", namerDuration(DUPLICITY, "deception", "rage"));
clause(DUPLICITY, "0:rule", "does not trigger for its own entry, the opponent's resources, a non-resource, or from my hand", namerNearMisses(DUPLICITY));
clause(DUPLICITY, "0:rule", "a face-down resource triggers it too, and several resources in one turn stack the grants", namerFaceDownAndStacking(DUPLICITY, "deception", "rage"));
clause(DUPLICITY, "0:rule", "printed card: a cost-0 rogue resource that provides nothing until it gains PROVIDES", () => {
  const p = printing(DUPLICITY);
  assert.equal(p.type, "resource");
  assert.equal(p.cost, 0);
  assert.equal(p.trade, "rogue");
  const g = namerBoard(DUPLICITY);
  for (const icon of ALL_ICONS) assert.equal(thresholdOf(g, icon), 0, `provides no ${icon} by itself`);
});

clause(ENTITLEMENT, "0:rule", "naming prompt: when my resource enters play I name [E] or [R] (nothing else can be named)", namerPrompt(ENTITLEMENT, "elitism", "rage"));
clause(ENTITLEMENT, "0:rule", "the card gains PROVIDES of exactly the named icon: one [E] or one [R], never the other", namerGrants(ENTITLEMENT, "elitism", "rage"));
clause(ENTITLEMENT, "0:rule", "the gained icon really satisfies a threshold (and the other icon does not)", namerThreshold(ENTITLEMENT, "elitism", "rage"));
clause(ENTITLEMENT, "0:rule", "'this turn': the gained PROVIDES ends with the turn", namerDuration(ENTITLEMENT, "elitism", "rage"));
clause(ENTITLEMENT, "0:rule", "does not trigger for its own entry, the opponent's resources, a non-resource, or from my hand", namerNearMisses(ENTITLEMENT));
clause(ENTITLEMENT, "0:rule", "a face-down resource triggers it too, and several resources in one turn stack the grants", namerFaceDownAndStacking(ENTITLEMENT, "elitism", "rage"));
clause(ENTITLEMENT, "0:rule", "printed card: a cost-0 gearsmith resource that provides nothing until it gains PROVIDES", () => {
  const p = printing(ENTITLEMENT);
  assert.equal(p.type, "resource");
  assert.equal(p.cost, 0);
  assert.equal(p.trade, "gearsmith");
  const g = namerBoard(ENTITLEMENT);
  for (const icon of ALL_ICONS) assert.equal(thresholdOf(g, icon), 0, `provides no ${icon} by itself`);
});

clause(FANATICISM, "0:rule", "naming prompt: when my resource enters play I name [G] or [R] (nothing else can be named)", namerPrompt(FANATICISM, "greed", "rage"));
clause(FANATICISM, "0:rule", "the card gains PROVIDES of exactly the named icon: one [G] or one [R], never the other", namerGrants(FANATICISM, "greed", "rage"));
clause(FANATICISM, "0:rule", "the gained icon really satisfies a threshold (and the other icon does not)", namerThreshold(FANATICISM, "greed", "rage"));
clause(FANATICISM, "0:rule", "'this turn': the gained PROVIDES ends with the turn", namerDuration(FANATICISM, "greed", "rage"));
clause(FANATICISM, "0:rule", "does not trigger for its own entry, the opponent's resources, a non-resource, or from my hand", namerNearMisses(FANATICISM));
clause(FANATICISM, "0:rule", "a face-down resource triggers it too, and several resources in one turn stack the grants", namerFaceDownAndStacking(FANATICISM, "greed", "rage"));
clause(FANATICISM, "0:rule", "printed card: a cost-0 banker resource that provides nothing until it gains PROVIDES", () => {
  const p = printing(FANATICISM);
  assert.equal(p.type, "resource");
  assert.equal(p.cost, 0);
  assert.equal(p.trade, "banker");
  const g = namerBoard(FANATICISM);
  for (const icon of ALL_ICONS) assert.equal(thresholdOf(g, icon), 0, `provides no ${icon} by itself`);
});

// =============================================================================
// Engorged Sarcophyle -- character (rogue) sarcophyle, cost 2, threshold [D], 1 / 3 / 1
// =============================================================================

const ENGORGED = "3ad8995c-8bd2-4e07-9e64-1be39cc38f0d";

function engorgedBoard(o: { controller?: PlayerId; theirChars?: number } = {}) {
  const me = o.controller ?? P1;
  const them = me === P1 ? P2 : P1;
  return devBoard(
    [
      { key: "eng", def: printing(ENGORGED), owner: me, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: me, zone: "play" },
      ...Array.from({ length: o.theirChars ?? 2 }, (_, i) => ({ key: `t${i}`, def: character({ name: `Theirs ${i}`, life: 3 }), owner: them, zone: "play" as const })),
      { key: "theirGear", def: item({ name: "Their Gear" }), owner: them, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 2 }
  );
}
type EngorgedBoard = ReturnType<typeof engorgedBoard>;
/**
 * Kills the Sarcophyle. "Pick an opponent" is a faction pick: at a bigger table the controller is asked which opponent
 * (several candidates), so the original opponent `victim` is named; at a two-player table nothing is asked.
 */
const killEngorged = (g: EngorgedBoard, victim: PlayerId = P2): void => {
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("eng")] } });
  const pc = pending(g.engine);
  if (pc?.kind === "selectTargets") {
    const decl = (pc.declarations as Array<{ id: string }>)[0].id;
    answerPending(g.engine, "selectTargets", { selected: { [decl]: [factionOf(g.engine, victim)] } });
  }
};

clause(ENGORGED, "0:rule", "printed card: a 1/3/1 sarcophyle for cost 2 with [D]; one short or no [D] is refused", () => {
  deployChecks(ENGORGED, 2, res({ deception: 1, rage: 1 }), res({ deception: 1 }), res({ rage: 2 }));
  const g = engorgedBoard();
  assert.equal(stat(g.engine, g.id("eng"), "strength"), 1);
  assert.equal(stat(g.engine, g.id("eng"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("eng"), "life"), 1);
});

clause(ENGORGED, "0:rule", "when destroyed, the opponent (not me) chooses and destroys one character they control", () => {
  const g = engorgedBoard();
  killEngorged(g);
  assert.equal(zoneOf(g.engine, g.id("eng")), "discard");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "the picked opponent chooses which of their characters");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t1")] });
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("t1")), "discard", "the chosen character is destroyed");
  assert.equal(zoneOf(g.engine, g.id("t0")), "play", "exactly one");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "my characters are untouched");
});

clause(ENGORGED, "0:rule", "the opponent can choose any character they control, and only one", () => {
  for (const key of ["t0", "t1"]) {
    const g = engorgedBoard();
    killEngorged(g);
    answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id(key)] });
    assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
  }
  const g = engorgedBoard();
  killEngorged(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0"), g.id("t1")] }), "two characters");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [] }), "none, with characters available");
  assert.equal(zoneOf(g.engine, g.id("t0")), "play");
  assert.equal(zoneOf(g.engine, g.id("t1")), "play");
});

clause(ENGORGED, "0:rule", "they can only destroy a character THEY control: my character and their item are refused", () => {
  const g = engorgedBoard();
  killEngorged(g);
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("mine")] }), "my character is not theirs");
  refused(() => answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("theirGear")] }), "an item is not a character");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirGear")), "play");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0")] });
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard", "control");
});

clause(ENGORGED, "0:rule", "with one character they have no choice, and with none nothing happens", () => {
  const one = engorgedBoard({ theirChars: 1 });
  killEngorged(one);
  drain(one.engine, pickTargets([one.id("t0")]));
  assert.equal(zoneOf(one.engine, one.id("t0")), "discard");
  assert.equal(zoneOf(one.engine, one.id("mine")), "play");
  const none = engorgedBoard({ theirChars: 0 });
  killEngorged(none);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(none.engine, none.id("eng")), "discard");
  assert.equal(zoneOf(none.engine, none.id("mine")), "play");
});

clause(ENGORGED, "0:rule", "it triggers only when destroyed: bouncing it to hand destroys nothing", () => {
  const g = engorgedBoard();
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("eng")] } });
  assert.equal(zoneOf(g.engine, g.id("eng")), "hand");
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const k of ["t0", "t1", "mine"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", k);
});

clause(ENGORGED, "0:rule", "'an opponent' is its controller's opponent: an Engorged Sarcophyle the opponent controls makes ME destroy one of my characters", () => {
  const g = engorgedBoard({ controller: P2 });
  killEngorged(g, P1);
  assert.equal(zoneOf(g.engine, g.id("eng")), "discard");
  const pc = pending(g.engine)!;
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose among my own characters");
  answerPending(g.engine, "chooserSelectsTarget", { selected: [g.id("t0")] });
  assert.equal(zoneOf(g.engine, g.id("t0")), "discard");
  assert.equal(zoneOf(g.engine, g.id("t1")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the opponent's own character is not destroyed");
});

// =============================================================================
// Enlightened Sarcophyle -- character (rogue) sarcophyle/wizard, cost 4, threshold [D][D], 3 / 4 / 2
// =============================================================================

const ENLIGHTENED = "249bf742-f624-4e5b-a236-a5757e64472a";

function enlightenedBoard(o: { controller?: PlayerId; theirInfluence?: number } = {}) {
  const me = o.controller ?? P1;
  const them = me === P1 ? P2 : P1;
  const g = devBoard(
    [
      { key: "en", def: printing(ENLIGHTENED), owner: me, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: me, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", life: 3 }), owner: me, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: them, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: me, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic(), owner: P1, zone: "hand" },
      { key: "kill3", def: killTactic(), owner: P1, zone: "hand" },
      { key: "killGear", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }
    ],
    { turn: 2 }
  );
  if (o.theirInfluence !== undefined) g.engine.state.players[them].influence = o.theirInfluence;
  return g;
}
type EnlightenedBoard = ReturnType<typeof enlightenedBoard>;
const killOne = (g: EnlightenedBoard, key: string, tacticKey = "kill"): void => {
  play(g.engine, P1, g.id(tacticKey), { selected: { t: [g.id(key)] } });
  drain(g.engine, declineAll);
};

clause(ENLIGHTENED, "0:rule", "printed card: a 3/4/2 sarcophyle wizard for cost 4 with [D][D]; one short or one [D] is refused", () => {
  deployChecks(ENLIGHTENED, 4, res({ deception: 2, rage: 2 }), res({ deception: 2, rage: 1 }), res({ deception: 1, rage: 3 }));
  const g = enlightenedBoard();
  assert.equal(stat(g.engine, g.id("en"), "strength"), 3);
  assert.equal(stat(g.engine, g.id("en"), "speed"), 4);
  assert.equal(stat(g.engine, g.id("en"), "life"), 2);
  assert.deepEqual([...g.engine.getDefinition(g.id("en")).subtype].sort(), ["sarcophyle", "wizard"]);
});

clause(ENLIGHTENED, "0:rule", "when a character of mine is destroyed I gain 1 influence and the opponent loses 1", () => {
  const g = enlightenedBoard();
  killOne(g, "mine");
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(influence(g.engine, P1), 31, "+1 for me");
  assert.equal(influence(g.engine, P2), 29, "-1 for the opponent");
});

clause(ENLIGHTENED, "0:rule", "it also triggers for a character the opponent controls being destroyed", () => {
  const g = enlightenedBoard();
  killOne(g, "foe");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(influence(g.engine, P1), 31);
  assert.equal(influence(g.engine, P2), 29);
});

clause(ENLIGHTENED, "0:rule", "it triggers on its own destruction too", () => {
  const g = enlightenedBoard();
  killOne(g, "en");
  assert.equal(zoneOf(g.engine, g.id("en")), "discard");
  assert.equal(influence(g.engine, P1), 31);
  assert.equal(influence(g.engine, P2), 29);
});

clause(ENLIGHTENED, "0:rule", "each destroyed character counts once: three destructions give +3 / -3", () => {
  const g = enlightenedBoard();
  killOne(g, "mine");
  killOne(g, "mine2", "kill2");
  killOne(g, "foe", "kill3");
  assert.equal(influence(g.engine, P1), 33);
  assert.equal(influence(g.engine, P2), 27);
});

clause(ENLIGHTENED, "0:rule", "it does not trigger for a destroyed item, or a character that is only bounced", () => {
  const g = enlightenedBoard();
  play(g.engine, P1, g.id("killGear"), { selected: { t: [g.id("gear")] } });
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("gear")), "discard");
  assert.equal(influence(g.engine, P1), 30, "an item is not a character");
  assert.equal(influence(g.engine, P2), 30);
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "hand");
  assert.equal(influence(g.engine, P1), 30, "a bounced character is not destroyed");
  assert.equal(influence(g.engine, P2), 30);
});

clause(ENLIGHTENED, "0:rule", "it only works while in play: a character destroyed after it has left play gains nothing", () => {
  const g = enlightenedBoard();
  killOne(g, "en");
  assert.equal(influence(g.engine, P1), 31);
  killOne(g, "mine", "kill2");
  assert.equal(influence(g.engine, P1), 31, "no further gain once it is gone");
  assert.equal(influence(g.engine, P2), 29);
});

clause(ENLIGHTENED, "0:rule", "'gain' is mine and 'each opponent' is the opponent: an Enlightened Sarcophyle they control pays out to THEM", () => {
  const g = enlightenedBoard({ controller: P2 });
  killOne(g, "mine");
  assert.equal(influence(g.engine, P2), 31, "its controller (P2) gains 1");
  assert.equal(influence(g.engine, P1), 29, "its controller's opponent loses 1");
});

clause(ENLIGHTENED, "0:rule", "the opponent's influence stops at 0", () => {
  const g = enlightenedBoard({ theirInfluence: 0 });
  killOne(g, "mine");
  assert.equal(influence(g.engine, P2), 0, "0 - 1 stays at 0 (CR 410.4)");
  assert.equal(influence(g.engine, P1), 31);
});

// =============================================================================
// Erotic Assassin -- character (banker) mercenary/assassin, cost 0, threshold [G][G], 3 / 3 / 3
// =============================================================================

const EROTIC = "19f8e276-5d9a-4bf7-94df-ff86a13781d4";

function eroticBoard(o: { turn?: number; active?: PlayerId; greed?: number; depleted?: boolean; extra?: CardPlacement[]; spent?: number } = {}) {
  return devBoard(
    [
      { key: "as", def: printing(EROTIC), owner: P1, zone: "play", depleted: o.depleted ?? false },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      ...res({ greed: o.greed ?? 4 }),
      ...(o.spent ? spentResources(P1, o.spent) : []),
      ...(o.extra ?? [])
    ],
    { turn: o.turn ?? 2, activePlayerId: o.active ?? P1 }
  );
}
type EroticBoard = ReturnType<typeof eroticBoard>;
const useRestore = (g: EroticBoard, player: PlayerId = P1): void => activate(g.engine, player, g.id("as"), "restore");
const restoreTactic = (): CardDefinition =>
  tactic({
    name: "Refresh",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });

clause(EROTIC, "0:rule", "printed card: a 3/3/3 mercenary assassin that costs 0 with [G][G]; one [G] is refused", () => {
  const mk = (greed: number, rage: number) =>
    devBoard([{ key: "as", def: printing(EROTIC), owner: P1, zone: "hand" }, ...res({ greed, rage })], { turn: 2 });
  const ok = mk(2, 0);
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("as"));
  assert.equal(zoneOf(ok.engine, ok.id("as")), "play");
  assert.equal(before - ready(ok.engine), 0, "cost 0: nothing is paid");
  assert.equal(stat(ok.engine, ok.id("as"), "strength"), 3);
  assert.equal(stat(ok.engine, ok.id("as"), "speed"), 3);
  assert.equal(stat(ok.engine, ok.id("as"), "life"), 3);
  assert.deepEqual([...ok.engine.getDefinition(ok.id("as")).subtype].sort(), ["assassin", "mercenary"]);
  const one = mk(1, 5);
  refused(() => play(one.engine, P1, one.id("as")), "one [G] is short of [G][G]");
  assert.equal(zoneOf(one.engine, one.id("as")), "hand");
});

clause(EROTIC, "0:rule", "a depleted Assassin is NOT restored by its controller's Restore Rule, but another depleted character is", () => {
  const g = eroticBoard({ turn: 1, depleted: true, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1, "it is my turn again");
  assert.equal(isDepleted(g.engine, g.id("as")), true, "the Restore Rule did not restore the Assassin");
  assert.equal(isDepleted(g.engine, g.id("tired")), false, "control: an ordinary character is restored");
});

clause(EROTIC, "0:rule", "it stays depleted through several Restore Rules, while the rest of the rule still happens (resources detach)", () => {
  const g = eroticBoard({ turn: 1, depleted: true, greed: 0, spent: 3 });
  assert.equal(attachedCount(g.engine, P1), 3);
  for (let i = 0; i < 2; i++) {
    endTurn(g.engine, P1);
    endTurn(g.engine, P2);
    assert.equal(isDepleted(g.engine, g.id("as")), true, `after Restore Rule number ${i + 1}`);
  }
  assert.equal(attachedCount(g.engine, P1), 0, "the Restore Rule detached the resources");
  assert.equal(ready(g.engine), 3);
});

clause(EROTIC, "0:rule", "only the Restore Rule is blocked: another card's restore effect restores it", () => {
  const g = eroticBoard({ depleted: true, extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("as")] } });
  assert.equal(isDepleted(g.engine, g.id("as")), false);
});

clause(EROTIC, "1:rule", "it can attack once in a turn, and an attack depletes it", () => {
  const g = eroticBoard();
  fight(g.engine, P1, [g.id("as")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 30 - 3, "its 3 strength hit the faction");
  assert.equal(isDepleted(g.engine, g.id("as")), true);
});

clause(EROTIC, "1:rule", "after RESTORE (ready again) a second attack in the same turn is refused; a depleted-less refusal changes nothing", () => {
  const g = eroticBoard();
  fight(g.engine, P1, [g.id("as")], { type: "faction", playerId: P2 }, []);
  useRestore(g);
  assert.equal(isDepleted(g.engine, g.id("as")), false, "ready again");
  refused(() => declareAttackBy(g.engine, P1, [g.id("as")]), "but it already attacked this turn");
  assert.equal(isDepleted(g.engine, g.id("as")), false, "the refused attack depleted nothing");
  assert.equal(g.engine.state.battle, undefined);
});

clause(EROTIC, "1:rule", "restored by another card's effect, the second attack is refused just the same; an ordinary character may attack twice", () => {
  const g = eroticBoard({ extra: [{ key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" }, { key: "refresh2", def: restoreTactic(), owner: P1, zone: "hand" }] });
  fight(g.engine, P1, [g.id("as")], { type: "faction", playerId: P2 }, []);
  play(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("as")] } });
  assert.equal(isDepleted(g.engine, g.id("as")), false);
  refused(() => declareAttackBy(g.engine, P1, [g.id("as")]), "second attack");
  fight(g.engine, P1, [g.id("mate")], { type: "faction", playerId: P2 }, []);
  play(g.engine, P1, g.id("refresh2"), { selected: { t: [g.id("mate")] } });
  declareAttackBy(g.engine, P1, [g.id("mate")]);
  assert.deepEqual(g.engine.state.battle?.attackingParty, [g.id("mate")], "control: the limit is only on the Assassin");
});

clause(EROTIC, "1:rule", "attacking in a party counts as its attack for the turn; the limit resets with the next turn", () => {
  const g = eroticBoard({ greed: 6 });
  fight(g.engine, P1, [g.id("as"), g.id("mate")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 30 - 3 - 1);
  useRestore(g);
  refused(() => declareAttackBy(g.engine, P1, [g.id("as"), g.id("mate")]), "not again in a party");
  refused(() => declareAttackBy(g.engine, P1, [g.id("as")]), "nor alone");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  fight(g.engine, P1, [g.id("as")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 30 - 3 - 1 - 3, "it attacked again on the new turn");
});

clause(EROTIC, "1:rule", "the limit is about attacking, not blocking: it can block twice in a turn with RESTORE between", () => {
  const g = devBoard(
    [
      { key: "as", def: printing(EROTIC), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 3 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  fight(g.engine, P2, [g.id("a1")], { type: "faction", playerId: P1 }, [g.id("as")]);
  assert.equal(isDepleted(g.engine, g.id("as")), true, "the battle depleted it");
  declareAttackOpenWindow(g.engine, P2, [g.id("a2")]);
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("as"), abilityId: "restore", selected: {}, variables: {} } as never);
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("as")]);
  assert.deepEqual(g.engine.state.battle?.blockingParty, [g.id("as")]);
});

clause(EROTIC, "2:ability:restore", "RESTORE pays exactly 2 resources and restores the depleted Assassin (and only it)", () => {
  const g = eroticBoard({ depleted: true, greed: 5, extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  const before = ready(g.engine);
  useRestore(g);
  assert.equal(before - ready(g.engine), 2, "exactly 2 paid");
  assert.equal(attachedCount(g.engine, P1), 2);
  assert.equal(isDepleted(g.engine, g.id("as")), false, "restored");
  assert.equal(isDepleted(g.engine, g.id("tired")), true, "another depleted character stays depleted");
});

clause(EROTIC, "2:ability:restore", "the cost is paid when activated, before responses", () => {
  const g = eroticBoard({ depleted: true, greed: 3 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("as"), abilityId: "restore", selected: {}, variables: {} } as never);
  assert.equal(ready(g.engine), 1, "2 of 3 paid already");
  assert.equal(isDepleted(g.engine, g.id("as")), true, "the restoring comes with the effect");
  resolvePendingResponses(g.engine);
  assert.equal(isDepleted(g.engine, g.id("as")), false);
});

clause(EROTIC, "2:ability:restore", "works with exactly 2 resources; refused with 1, with 0, or when one of two is already spent", () => {
  const two = eroticBoard({ depleted: true, greed: 2 });
  useRestore(two);
  assert.equal(isDepleted(two.engine, two.id("as")), false);
  assert.equal(ready(two.engine), 0);
  const one = eroticBoard({ depleted: true, greed: 1 });
  refused(() => useRestore(one), "1 ready resource");
  assert.equal(isDepleted(one.engine, one.id("as")), true);
  assert.equal(ready(one.engine), 1, "nothing paid");
  const none = eroticBoard({ depleted: true, greed: 0 });
  refused(() => useRestore(none), "no resources");
  assert.equal(isDepleted(none.engine, none.id("as")), true);
  const half = eroticBoard({ depleted: true, greed: 1, spent: 1 });
  refused(() => useRestore(half), "one ready + one spent");
  assert.equal(isDepleted(half.engine, half.id("as")), true);
});

clause(EROTIC, "2:ability:restore", "it can be used again and again (each use pays 2), and on the opponent's turn in time to block", () => {
  const g = eroticBoard({ depleted: true, greed: 6 });
  useRestore(g);
  g.engine.state.cards[g.id("as")].depleted = true;
  useRestore(g);
  assert.equal(isDepleted(g.engine, g.id("as")), false);
  assert.equal(ready(g.engine), 2, "6 - 2 - 2");
  const b = devBoard(
    [
      { key: "as", def: printing(EROTIC), owner: P1, zone: "play", depleted: true },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 2 })
    ],
    { turn: 2, activePlayerId: P2 }
  );
  declareAttackOpenWindow(b.engine, P2, [b.id("a1")]);
  b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("as"), abilityId: "restore", selected: {}, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(isDepleted(b.engine, b.id("as")), false);
  declareBlockers(b.engine, P1, [b.id("as")]);
  assert.deepEqual(b.engine.state.battle?.blockingParty, [b.id("as")]);
});

clause(EROTIC, "2:ability:restore", "the opponent cannot use my Assassin's RESTORE", () => {
  const g = eroticBoard({ depleted: true, extra: res({ greed: 5 }, P2) });
  refused(() => useRestore(g, P2), "not their card", /controller|control|own|priority|your/i);
  assert.equal(isDepleted(g.engine, g.id("as")), true);
  assert.equal(ready(g.engine, P2), 5, "the opponent paid nothing");
});
// =============================================================================
// Escape Artist -- character (rogue) martial artist, TACTICAL, cost 3, threshold [D][D], 3 / 3 / 1
// =============================================================================

const ESCAPE = "8a4d4fdb-4402-468b-9808-4711a2362116";

/**
 * P1 is the active player. P2 holds Escape Artist (and resources to deploy it). P1 holds Drygulch (a tactic whose EXTRA COST picks
 * a character) and a Corpse Churner with tokens (an ability that picks a character or faction as part of its cost).
 * Characters: P1 "mine" (life 1), P2 "theirs" (life 1), P2 "theirs2".
 */
function escapeBoard(o: { eaZone?: "hand" | "play"; p2Res?: Icons } = {}) {
  return devBoard(
    [
      { key: "ea", def: printing(ESCAPE), owner: P2, zone: o.eaZone ?? "hand" },
      { key: "plain", def: character({ name: "Plain Tactical", cost: 0, strength: 1, life: 1, behavior: { keywords: ["tactical"] } }), owner: P2, zone: "hand" },
      { key: "slow", def: character({ name: "Slow Character", cost: 0, strength: 1, life: 1 }), owner: P2, zone: "hand" },
      { key: "dry", def: printing(DRY), owner: P1, zone: "hand" },
      { key: "churner", def: printing(CHURNER), owner: P1, zone: "play", counters: { token: 2 } },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 1, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Theirs", strength: 1, life: 1, speed: 2 }), owner: P2, zone: "play" },
      { key: "theirs2", def: character({ name: "Theirs Two", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...spentIcon("deception", 1),
      ...volition(2),
      ...res(o.p2Res ?? { deception: 2, rage: 1 }, P2)
    ],
    { turn: 2 }
  );
}
type EscapeBoard = ReturnType<typeof escapeBoard>;

/** P1 casts Drygulch on `pick`, then passes priority so P2 holds the window. */
function drygulchOpen(g: EscapeBoard, pick: string): void {
  playRaw(g.engine, P1, g.id("dry"), { selected: { c: [g.id(pick)] } });
}
/** P1 uses CHURN on `pick` (a card id), then passes priority so P2 holds the window. */
function churnOpen(g: EscapeBoard, pick: CardInstanceId): void {
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("churner"), abilityId: "churn", selected: { victim: [pick] }, variables: {} } as never);
}
const respondDeploy = (g: EscapeBoard, key: string): void => {
  playRaw(g.engine, P2, g.id(key));
  resolvePendingResponses(g.engine);
};

clause(ESCAPE, "0:kw:TACTICAL", "TACTICAL: it can be deployed in a response window (a tactic could be), and an ordinary character cannot", () => {
  const g = escapeBoard();
  assert.ok((g.engine.getKeywords(g.id("ea")) as string[]).includes("tactical"), "(g.engine.getKeywords(ea) as string[]).includes(tactical)");
  drygulchOpen(g, "theirs");
  refused(() => playRaw(g.engine, P2, g.id("slow")), "a non-tactical character cannot be deployed in response");
  assert.equal(zoneOf(g.engine, g.id("slow")), "hand");
  playRaw(g.engine, P2, g.id("ea"));
  assert.notEqual(zoneOf(g.engine, g.id("ea")), "hand", "Escape Artist left the hand in response");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ea")), "play");
});

clause(ESCAPE, "0:kw:TACTICAL", "printed card: a 3/3/1 martial artist for cost 3 with [D][D]; one short or one [D] is refused", () => {
  deployChecks(ESCAPE, 3, res({ deception: 2, rage: 1 }), res({ deception: 2 }), res({ deception: 1, rage: 2 }));
  const g = escapeBoard({ eaZone: "play" });
  assert.equal(stat(g.engine, g.id("ea"), "strength"), 3);
  assert.equal(stat(g.engine, g.id("ea"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("ea"), "life"), 1);
  assert.deepEqual(g.engine.getDefinition(g.id("ea")).subtype, ["martial artist"]);
});

clause(ESCAPE, "1:rule", "deployed in response to a tactic whose extra cost picked a character I control: that tactic is terminated (no effect, costs stay paid)", () => {
  const g = escapeBoard();
  const before = ready(g.engine);
  drygulchOpen(g, "theirs");
  assert.equal(ready(g.engine) - before, -2, "Drygulch's cost is paid");
  respondDeploy(g, "ea");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("ea")), "play", "Escape Artist is in play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "play", "the tactic was terminated: my character is NOT voided");
  assert.equal(zoneOf(g.engine, g.id("dry")), "discard", "the terminated tactic goes to the discard pile");
  assert.equal(ready(g.engine), before - 2, "its cost is not refunded");
  assert.equal(g.engine.state.responseWindow, undefined);
});

clause(ESCAPE, "1:rule", "control: without Escape Artist the same Drygulch voids the character", () => {
  const g = escapeBoard();
  drygulchOpen(g, "theirs");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("theirs")), "void");
});

clause(ESCAPE, "1:rule", "an ability that picked a character I control as part of its cost is terminated too (CHURN)", () => {
  const g = escapeBoard();
  churnOpen(g, g.id("theirs2"));
  assert.equal(zoneOf(g.engine, g.id("churner")), "discard", "CHURN's cost destroyed the Churner");
  respondDeploy(g, "ea");
  assert.equal(zoneOf(g.engine, g.id("ea")), "play");
  assert.equal(damageOn(g.engine, g.id("theirs2")), 0, "CHURN was terminated: no damage");
  assert.equal(g.engine.state.pendingChoice, undefined);
  const control = escapeBoard();
  churnOpen(control, control.id("theirs2"));
  resolvePendingResponses(control.engine);
  assert.equal(damageOn(control.engine, control.id("theirs2")), 2, "control: without it CHURN deals X = 2");
});

clause(ESCAPE, "1:rule", "near miss: the pick was a character its controller's opponent controls (not mine) -> nothing is terminated", () => {
  const g = escapeBoard();
  drygulchOpen(g, "mine");
  respondDeploy(g, "ea");
  assert.equal(zoneOf(g.engine, g.id("ea")), "play");
  assert.equal(zoneOf(g.engine, g.id("mine")), "void", "Drygulch picked P1's own character, which Escape Artist's controller does not control");
});

clause(ESCAPE, "1:rule", "near miss: the ability picked a faction, or no character I control -> not terminated", () => {
  const g = escapeBoard();
  churnOpen(g, factionOf(g.engine, P2));
  respondDeploy(g, "ea");
  assert.equal(zoneOf(g.engine, g.id("ea")), "play");
  assert.equal(influence(g.engine, P2), 30 - 2, "CHURN still dealt X = 2 to the faction");
  const mineOnly = escapeBoard();
  churnOpen(mineOnly, mineOnly.id("mine2"));
  respondDeploy(mineOnly, "ea");
  assert.equal(damageOn(mineOnly.engine, mineOnly.id("mine2")), 2, "picked a character of the Churner's controller: not terminated");
});

clause(ESCAPE, "1:rule", "near miss: another tactical character deployed in response does not terminate anything; Escape Artist deployed normally does nothing", () => {
  const g = escapeBoard();
  drygulchOpen(g, "theirs");
  respondDeploy(g, "plain");
  assert.equal(zoneOf(g.engine, g.id("plain")), "play");
  assert.equal(zoneOf(g.engine, g.id("theirs")), "void", "an ordinary tactical character does not terminate the tactic");
  const normal = devBoard(
    [
      { key: "ea", def: printing(ESCAPE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res({ deception: 2, rage: 1 })
    ],
    { turn: 2 }
  );
  play(normal.engine, P1, normal.id("ea"));
  assert.equal(zoneOf(normal.engine, normal.id("ea")), "play");
  assert.equal(normal.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(normal.engine, normal.id("foe")), "play");
});

clause(ESCAPE, "1:rule", "near miss: deployed in response to something that is not a tactic or ability (an attack) -> nothing happens and the game continues", () => {
  const g = escapeBoard();
  declareAttackOpenWindow(g.engine, P1, [g.id("mine2")]);
  respondDeploy(g, "ea");
  assert.equal(zoneOf(g.engine, g.id("ea")), "play");
  assert.ok(g.engine.state.battle, "the attack goes on");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine);
  assert.equal(influence(g.engine, P2), 29);
});

// =============================================================================
// Escort Ally -- character (warlord) soldier, cost 2, threshold [R][R], 2 / 3 / 1
// =============================================================================

const ESCORT = "0007c001-1606-422f-b1a8-cdc4c7afbce9";

function escortBoard(o: { extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "ally", def: printing(ESCORT), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "kill", def: killTactic(), owner: P2, zone: "hand" },
      { key: "kill2", def: killTactic(), owner: P2, zone: "hand" },
      { key: "myKill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "killGear", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P2, zone: "hand" },
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P2 }
  );
}
type EscortBoard = ReturnType<typeof escortBoard>;
const substitute = (g: EscortBoard): void => {
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("ally"), abilityId: "escort-ally-substitute", selected: {}, variables: {} } as never);
};
/** P2 (the active player) casts `kill` on `pick`, passes priority, and P1 holds the window. */
function theirKillOpen(g: EscortBoard, tacticKey: string, pick: string): void {
  playRaw(g.engine, P2, g.id(tacticKey), { selected: { t: [g.id(pick)] } });
}

clause(ESCORT, "0:ability:escort-ally-substitute", "printed card: a 2/3/1 soldier for cost 2 with [R][R]; one short or one [R] is refused", () => {
  deployChecks(ESCORT, 2, res({ rage: 2 }), res({ rage: 1 }), res({ greed: 2 }));
  const g = escortBoard();
  assert.equal(stat(g.engine, g.id("ally"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("ally"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("ally"), "life"), 1);
});

clause(ESCORT, "0:ability:escort-ally-substitute", "the cost destroys Escort Ally when SUBSTITUTE is used (before responses)", () => {
  const g = escortBoard({ active: P1 });
  substitute(g);
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard", "Escort Ally is destroyed as the cost");
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(ESCORT, "0:ability:escort-ally-substitute", "this turn, an opposing tactic that destroys one of my characters cannot destroy it (used in response)", () => {
  const g = escortBoard();
  theirKillOpen(g, "kill", "mine");
  substitute(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "my character survives the opposing tactic");
  assert.equal(zoneOf(g.engine, g.id("ally")), "discard");
  const control = escortBoard();
  theirKillOpen(control, "kill", "mine");
  resolvePendingResponses(control.engine);
  assert.equal(zoneOf(control.engine, control.id("mine")), "discard", "control: without SUBSTITUTE the character dies");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "it protects ALL my characters for the rest of the turn (a second opposing destroy as well), including ones entering later", () => {
  const g = escortBoard({ extra: [{ key: "late", def: character({ name: "Late", cost: 0, life: 2 }), owner: P1, zone: "hand" }] });
  theirKillOpen(g, "kill", "mine");
  substitute(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play");
  theirKillOpen(g, "kill2", "mine2");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play", "a second opposing destroy this turn also fails");
  assert.equal(zoneOf(g.engine, g.id("kill2")), "discard", "the tactic was still played and spent");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "only destruction by my OPPONENTS' cards or abilities is stopped: I can still destroy my own characters", () => {
  const g = escortBoard({ active: P1 });
  substitute(g);
  resolvePendingResponses(g.engine);
  play(g.engine, P1, g.id("myKill"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "my own tactic still destroys my character");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "it protects only characters I control: my items and the opponent's characters can still be destroyed", () => {
  const g = escortBoard({ active: P1 });
  substitute(g);
  resolvePendingResponses(g.engine);
  play(g.engine, P1, g.id("myKill"), { selected: { t: [g.id("foe")] } });
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "the opponent's character is not protected");
  const h = escortBoard();
  playRaw(h.engine, P2, h.id("killGear"), { selected: { t: [h.id("gear")] } });
  substitute(h);
  resolvePendingResponses(h.engine);
  assert.equal(zoneOf(h.engine, h.id("gear")), "discard", "an item of mine is not a character: not protected");
  const opp = escortBoard();
  playRaw(opp.engine, P2, opp.id("kill"), { selected: { t: [opp.id("foe2")] } });
  substitute(opp);
  resolvePendingResponses(opp.engine);
  assert.equal(zoneOf(opp.engine, opp.id("foe2")), "discard", "the opponent can destroy their own characters");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "'this turn': the protection ends with the turn (their kill next turn works)", () => {
  const g = escortBoard({ active: P1 });
  substitute(g);
  resolvePendingResponses(g.engine);
  endTurn(g.engine, P1); // P2's turn
  assert.equal(g.engine.state.activePlayerId, P2);
  play(g.engine, P2, g.id("kill"), { selected: { t: [g.id("mine")] } });
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard", "no protection on their next turn");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "lethal combat damage from an opposing character is destruction by an opponent's card (the literal reading) and is stopped", () => {
  const g = escortBoard({ extra: [{ key: "big", def: character({ name: "Big", strength: 5, life: 5, speed: 2 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("big")]);
  substitute(g);
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("mine")]);
  finishBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "5 damage on a 2-life blocker would normally destroy it");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "the opponent cannot use my Escort Ally's SUBSTITUTE", () => {
  const g = escortBoard();
  refused(() => g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("ally"), abilityId: "escort-ally-substitute", selected: {}, variables: {} } as never), "not their card", /controller|control|own|priority|your/i);
  assert.equal(zoneOf(g.engine, g.id("ally")), "play");
});

// =============================================================================
// Ex Machina Majig -- character (gearsmith) majig, cost 6, threshold [E][E][E], 5 / 3 / 5, UNIQUE EX MACHINA
// =============================================================================

const EXMACHINA = "68566e92-0ec7-480c-883c-aa495036c09d";

function exBoard(o: { zone?: "play" | "hand"; extra?: CardPlacement[]; mana?: Icons } = {}) {
  return devBoard(
    [
      { key: "ex", def: printing(EXMACHINA), owner: P1, zone: o.zone ?? "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 1, life: 1, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "late", def: character({ name: "Late", cost: 0, strength: 1, life: 1 }), owner: P1, zone: "hand" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" },
      { key: "theirKill", def: killTactic(), owner: P2, zone: "hand" },
      ...res(o.mana ?? { elitism: 3, rage: 3 }),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}
type ExBoard = ReturnType<typeof exBoard>;
const microsOf = (g: ExBoard): CardInstanceId[] =>
  Object.values(g.engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === P1 && g.engine.getDefinition(c.id).name === "Micromajig")
    .map((c) => c.id);

clause(EXMACHINA, "0:unique", "UNIQUE EX MACHINA: a second one makes you keep one (either); the opponent's copy is separate", () => {
  uniqueChecks(EXMACHINA);
});

clause(EXMACHINA, "0:unique", "printed card: 5/3/5 majig for cost 6 with [E][E][E]; one short or two [E] is refused", () => {
  deployChecks(EXMACHINA, 6, res({ elitism: 3, rage: 3 }), res({ elitism: 3, rage: 2 }), res({ elitism: 2, rage: 4 }));
  const g = exBoard({ zone: "play" });
  assert.equal(stat(g.engine, g.id("ex"), "strength"), 5);
  assert.equal(stat(g.engine, g.id("ex"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("ex"), "life"), 5);
  assert.deepEqual(g.engine.getDefinition(g.id("ex")).subtype, ["majig"]);
});

clause(EXMACHINA, "1:rule", "when it enters play, all characters I control gain 1 strength and 1 life (itself included), the opponent's do not", () => {
  const g = exBoard();
  play(g.engine, P1, g.id("ex"));
  assert.equal(zoneOf(g.engine, g.id("ex")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(stat(g.engine, g.id("mine"), "strength"), 3);
  assert.equal(stat(g.engine, g.id("mine"), "life"), 4);
  assert.equal(stat(g.engine, g.id("mine2"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("mine2"), "life"), 2);
  assert.equal(stat(g.engine, g.id("ex"), "strength"), 6, "Ex Machina Majig is a character I control");
  assert.equal(stat(g.engine, g.id("ex"), "life"), 6);
  assert.equal(stat(g.engine, g.id("foe"), "strength"), 2, "the opponent's characters are unaffected");
  assert.equal(stat(g.engine, g.id("foe"), "life"), 3);
  assert.equal(stat(g.engine, g.id("mine"), "speed"), 2, "only strength and life");
});

clause(EXMACHINA, "1:rule", "'this turn': the bonus ends at the end of the turn", () => {
  const g = exBoard();
  play(g.engine, P1, g.id("ex"));
  assert.equal(stat(g.engine, g.id("mine"), "strength"), 3);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(stat(g.engine, g.id("mine"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("mine"), "life"), 3);
  assert.equal(stat(g.engine, g.id("ex"), "strength"), 5);
  assert.equal(stat(g.engine, g.id("ex"), "life"), 5);
});

clause(EXMACHINA, "1:rule", "the bonus is not given to a character that enters play later the same turn, and not by other characters entering", () => {
  const g = exBoard();
  play(g.engine, P1, g.id("ex"));
  play(g.engine, P1, g.id("late"));
  assert.equal(stat(g.engine, g.id("late"), "strength"), 1);
  assert.equal(stat(g.engine, g.id("late"), "life"), 1);
  const other = exBoard({ zone: "play" });
  play(other.engine, P1, other.id("late"));
  assert.equal(stat(other.engine, other.id("mine"), "strength"), 2, "another character entering gives no bonus");
  assert.equal(stat(other.engine, other.id("late"), "strength"), 1);
});

clause(EXMACHINA, "1:rule", "the +1 life is real: a character with 3 life and 3 damage survives at 4 life", () => {
  const g = exBoard();
  play(g.engine, P1, g.id("ex"));
  g.engine.state.cards[g.id("mine2")].damage = 1;
  settleState(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play", "life 2 now, 1 damage is not lethal");
});

clause(EXMACHINA, "2:rule", "when it leaves play (destroyed) I may put up to five Micromajig tokens into play: five, three and none", () => {
  for (const n of [5, 3, 0]) {
    const g = exBoard({ zone: "play" });
    play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ex")] } });
    const pc = pending(g.engine)!;
    assert.ok(pc, `a choice is open for n = ${n}`);
    assert.equal(pc.playerId, P1, "I choose");
    answerPending(g.engine, pc.kind, pc.kind === "chooseNumber" ? { value: n } : { index: n });
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id("ex")), "discard");
    assert.equal(microsOf(g).length, n, `${n} Micromajig tokens`);
  }
});

clause(EXMACHINA, "2:rule", "more than five tokens cannot be chosen; the tokens are Micromajig majig characters (1/3/1) I control", () => {
  const g = exBoard({ zone: "play" });
  play(g.engine, P1, g.id("kill"), { selected: { t: [g.id("ex")] } });
  const pc = pending(g.engine)!;
  const key = pc.kind === "chooseNumber" ? "value" : "index";
  refused(() => answerPending(g.engine, pc.kind, { [key]: 6 }), "six is more than five");
  refused(() => answerPending(g.engine, pc.kind, { [key]: -1 }), "a negative number");
  assert.ok(pending(g.engine), "the choice is still open");
  answerPending(g.engine, pc.kind, { [key]: 2 });
  const tokens = microsOf(g);
  assert.equal(tokens.length, 2);
  for (const t of tokens) {
    const def = g.engine.getDefinition(t);
    assert.equal(def.type, "character");
    assert.deepEqual(def.subtype, ["majig"]);
    assert.equal(g.engine.getStat(t, "strength"), 1);
    assert.equal(g.engine.getStat(t, "speed"), 3);
    assert.equal(g.engine.getStat(t, "life"), 1);
    assert.equal(g.engine.state.cards[t].controllerId, P1);
  }
});

clause(EXMACHINA, "2:rule", "it triggers on any way of leaving play (bounced to hand too), and not when another card leaves play", () => {
  const g = exBoard({ zone: "play" });
  play(g.engine, P1, g.id("bounce"), { selected: { t: [g.id("ex")] } });
  const pc = pending(g.engine)!;
  assert.ok(pc, "bouncing it also offers the tokens");
  answerPending(g.engine, pc.kind, pc.kind === "chooseNumber" ? { value: 4 } : { index: 4 });
  assert.equal(zoneOf(g.engine, g.id("ex")), "hand");
  assert.equal(microsOf(g).length, 4);
  const other = exBoard({ zone: "play" });
  play(other.engine, P1, other.id("kill"), { selected: { t: [other.id("mine")] } });
  assert.equal(other.engine.state.pendingChoice, undefined, "another character leaving play offers nothing");
  assert.equal(microsOf(other).length, 0);
});

clause(EXMACHINA, "2:rule", "destroyed by the opponent, the tokens still come to ME (the controller)", () => {
  const g = exBoard({ zone: "play" });
  g.engine.state.activePlayerId = P2;
  g.engine.state.priorityPlayerId = P2;
  play(g.engine, P2, g.id("theirKill"), { selected: { t: [g.id("ex")] } });
  const pc = pending(g.engine)!;
  assert.equal(pc.playerId, P1);
  answerPending(g.engine, pc.kind, pc.kind === "chooseNumber" ? { value: 5 } : { index: 5 });
  assert.equal(microsOf(g).length, 5);
});

// =============================================================================
// Faceless Seer -- character (universal) teller, cost 1, threshold [V], 1 / 3 / 1
// =============================================================================

const SEER = "f19da566-ef4e-484f-ab8e-94399260b3d4";

function seerBoard(o: { rage?: number; need?: string } = {}) {
  return devBoard(
    [
      { key: "seer", def: printing(SEER), owner: P1, zone: "play" },
      { key: "needy", def: character({ name: "Needy", cost: 0, strength: 1, life: 1, threshold: (o.need ?? "vv") as never }), owner: P1, zone: "hand" },
      ...res({ rage: o.rage ?? 2 })
    ],
    { turn: 2 }
  );
}
type SeerBoard = ReturnType<typeof seerBoard>;
const volitionOf = (g: SeerBoard): number => (g.engine.getThresholds(P1) as unknown as Record<string, number>).volition ?? 0;
const imbue = (g: SeerBoard, player: PlayerId = P1): void => activate(g.engine, player, g.id("seer"), "faceless-seer-imbue");

clause(SEER, "0:ability:faceless-seer-imbue", "printed card: a 1/3/1 teller for cost 1 with [V]; deploys with a face-down resource, is refused without one", () => {
  const mk = (cards: CardPlacement[]) => devBoard([{ key: "c", def: printing(SEER), owner: P1, zone: "hand" }, ...cards], { turn: 2 });
  const ok = mk(volition(1));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 1 paid");
  const noVolition = mk(res({ rage: 3 }));
  refused(() => play(noVolition.engine, P1, noVolition.id("c")), "no [V]");
  const none = mk([]);
  refused(() => play(none.engine, P1, none.id("c")), "nothing to pay with");
  const g = seerBoard();
  assert.equal(stat(g.engine, g.id("seer"), "strength"), 1);
  assert.equal(stat(g.engine, g.id("seer"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("seer"), "life"), 1);
  assert.deepEqual(g.engine.getDefinition(g.id("seer")).subtype, ["teller"]);
});

clause(SEER, "0:ability:faceless-seer-imbue", "IMBUE pays exactly 1 resource and this turn the Seer provides [V][V] (before: none)", () => {
  const g = seerBoard({ rage: 3 });
  assert.equal(volitionOf(g), 0);
  const before = ready(g.engine);
  imbue(g);
  assert.equal(before - ready(g.engine), 1, "exactly one resource paid");
  assert.equal(volitionOf(g), 2, "exactly two [V]");
  assert.equal(g.engine.state.pendingChoice, undefined);
});

clause(SEER, "0:ability:faceless-seer-imbue", "the gained [V][V] is real: a threshold [V][V] card can be deployed after IMBUE, not before", () => {
  const g = seerBoard({ need: "vv" });
  refused(() => play(g.engine, P1, g.id("needy")), "no [V] yet");
  imbue(g);
  play(g.engine, P1, g.id("needy"));
  assert.equal(zoneOf(g.engine, g.id("needy")), "play");
  const three = seerBoard({ need: "vvv" });
  imbue(three);
  refused(() => play(three.engine, P1, three.id("needy")), "only two [V], not three");
});

clause(SEER, "0:ability:faceless-seer-imbue", "'this turn': the [V][V] is gone on the next turn", () => {
  const g = seerBoard();
  imbue(g);
  assert.equal(volitionOf(g), 2);
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(volitionOf(g), 0);
  assert.equal(g.engine.state.provideGrants.length, 0);
});

clause(SEER, "0:ability:faceless-seer-imbue", "use only once each turn: a second use is refused (and pays nothing), but it can be used again next turn", () => {
  const g = seerBoard({ rage: 4 });
  imbue(g);
  const after = ready(g.engine);
  refused(() => imbue(g), "second use in the same turn");
  assert.equal(ready(g.engine), after, "the refused use paid nothing");
  assert.equal(volitionOf(g), 2, "not 4");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  imbue(g);
  assert.equal(volitionOf(g), 2, "usable again on a later turn");
});

clause(SEER, "0:ability:faceless-seer-imbue", "needs 1 ready resource: refused with none; the opponent cannot use it", () => {
  const none = seerBoard({ rage: 0 });
  refused(() => imbue(none), "no resource to pay");
  assert.equal(volitionOf(none), 0);
  const g = seerBoard();
  refused(() => imbue(g, P2), "not their card", /controller|control|own|priority|your/i);
  assert.equal(volitionOf(g), 0);
});

// =============================================================================
// Fallen Necromorph -- character (banker) necromorph, cost 4, threshold [G][G], 2 / 3 / 1
// =============================================================================

const NECRO = "0baa3f3e-74ce-4209-9ad9-0d839da80eb9";

function necroBoard(o: { extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "nec", def: printing(NECRO), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "Dead One" }), owner: P1, zone: "discard" },
      { key: "d2", def: item({ name: "Dead Item" }), owner: P1, zone: "discard" },
      { key: "d3", def: tactic({ name: "Dead Tactic", cost: 1 }), owner: P1, zone: "discard" },
      { key: "od", def: character({ name: "Their Dead" }), owner: P2, zone: "discard" },
      { key: "inHand", def: character({ name: "Hand Card" }), owner: P1, zone: "hand" },
      ...res({ greed: 2, rage: 2 }),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}
type NecroBoard = ReturnType<typeof necroBoard>;

clause(NECRO, "0:rule", "printed card: a 2/3/1 necromorph for cost 4 with [G][G]; one short or one [G] is refused", () => {
  deployChecks(NECRO, 4, res({ greed: 2, rage: 2 }), res({ greed: 2, rage: 1 }), res({ greed: 1, rage: 3 }));
  const g = necroBoard();
  play(g.engine, P1, g.id("nec"));
  drain(g.engine, declineAll);
  assert.equal(stat(g.engine, g.id("nec"), "strength"), 2);
  assert.equal(stat(g.engine, g.id("nec"), "speed"), 3);
  assert.equal(stat(g.engine, g.id("nec"), "life"), 1);
  assert.deepEqual(g.engine.getDefinition(g.id("nec")).subtype, ["necromorph"]);
});

clause(NECRO, "0:rule", "when it enters play I may pick a card in my discard pile and put it into my hand (accept: any card type)", () => {
  for (const key of ["d1", "d2", "d3"]) {
    const g = necroBoard();
    play(g.engine, P1, g.id("nec"));
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "selectTargets");
    assert.equal(pc.playerId, P1);
    pickSel(g.engine, [g.id(key)]);
    assert.equal(g.engine.state.pendingChoice, undefined);
    assert.equal(zoneOf(g.engine, g.id(key)), "hand", `${key} is back in my hand`);
    for (const other of ["d1", "d2", "d3"].filter((k) => k !== key)) assert.equal(zoneOf(g.engine, g.id(other)), "discard", `${other} stays in the discard pile`);
    assert.equal(zoneOf(g.engine, g.id("od")), "discard");
    assert.equal(zoneOf(g.engine, g.id("nec")), "play");
  }
});

clause(NECRO, "0:rule", "declining is allowed: nothing moves", () => {
  const g = necroBoard();
  play(g.engine, P1, g.id("nec"));
  pickSel(g.engine, []);
  assert.equal(g.engine.state.pendingChoice, undefined);
  for (const key of ["d1", "d2", "d3"]) assert.equal(zoneOf(g.engine, g.id(key)), "discard", key);
  assert.equal(handOf(g.engine, P1).length, 1, "only the card that was already in hand");
});

clause(NECRO, "0:rule", "only a card in MY discard pile: the opponent's discard pile, my hand and the board are refused; one card only", () => {
  const g = necroBoard({ extra: [{ key: "boardCard", def: character({ name: "On Board" }), owner: P1, zone: "play" }] });
  play(g.engine, P1, g.id("nec"));
  refused(() => pickSel(g.engine, [g.id("od")]), "the opponent's discard pile");
  refused(() => pickSel(g.engine, [g.id("inHand")]), "a card in my hand");
  refused(() => pickSel(g.engine, [g.id("boardCard")]), "a card in play");
  refused(() => pickSel(g.engine, [g.id("d1"), g.id("d2")]), "two cards");
  assert.equal(zoneOf(g.engine, g.id("od")), "discard");
  pickSel(g.engine, [g.id("d2")]);
  assert.equal(zoneOf(g.engine, g.id("d2")), "hand", "control: one card from my discard pile");
});

clause(NECRO, "0:rule", "with an empty discard pile nothing is offered or happens; it only triggers for its own entry", () => {
  const g = devBoard([{ key: "nec", def: printing(NECRO), owner: P1, zone: "hand" }, ...res({ greed: 2, rage: 2 })], { turn: 2 });
  play(g.engine, P1, g.id("nec"));
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("nec")), "play");
  assert.equal(handOf(g.engine, P1).length, 0);
  const inPlay = devBoard(
    [
      { key: "nec", def: printing(NECRO), owner: P1, zone: "play" },
      { key: "later", def: character({ name: "Later", cost: 0 }), owner: P1, zone: "hand" },
      { key: "d1", def: character({ name: "Dead One" }), owner: P1, zone: "discard" }
    ],
    { turn: 2 }
  );
  play(inPlay.engine, P1, inPlay.id("later"));
  assert.equal(inPlay.engine.state.pendingChoice, undefined, "another card entering offers nothing");
  assert.equal(zoneOf(inPlay.engine, inPlay.id("d1")), "discard");
});

// =============================================================================
// Faulty Upgrade -- item (gearsmith), cost 5, threshold [E][E]
// =============================================================================

const UPGRADE = "4549e720-5e6b-4b34-969b-8761a6751ea5";

function upgradeBoard(o: { covertFoe?: boolean; mana?: Icons } = {}) {
  return devBoard(
    [
      { key: "up", def: printing(UPGRADE), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", life: 5, ...(o.covertFoe ? { behavior: { keywords: ["covert"] } } : {}) } as Partial<CardDefinition>), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 5 }), owner: P1, zone: "play" },
      { key: "covertMine", def: character({ name: "Covert Mine", life: 5, behavior: { keywords: ["covert"] } } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      { key: "refresh", def: restoreTactic(), owner: P1, zone: "hand" },
      ...res(o.mana ?? { elitism: 2, rage: 3 })
    ],
    { turn: 2 }
  );
}
type UpgradeBoard = ReturnType<typeof upgradeBoard>;
const playUpgrade = (g: UpgradeBoard, pick: string | undefined): void => {
  play(g.engine, P1, g.id("up"));
  const pc = pending(g.engine);
  assert.ok(pc, "the optional pick is offered");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  pickSel(g.engine, pick === undefined ? [] : [g.id(pick)]);
  assert.equal(g.engine.state.pendingChoice, undefined);
};

clause(UPGRADE, "0:rule", "printed card: an item for cost 5 with [E][E]; one short or one [E] is refused", () => {
  deployChecks(UPGRADE, 5, res({ elitism: 2, rage: 3 }), res({ elitism: 2, rage: 2 }), res({ elitism: 1, rage: 4 }));
  assert.equal(printing(UPGRADE).type, "item");
});

clause(UPGRADE, "0:rule", "when it enters play I may pick a character (mine or the opponent's) and deplete it", () => {
  const foe = upgradeBoard();
  playUpgrade(foe, "foe");
  assert.equal(isDepleted(foe.engine, foe.id("foe")), true, "the opponent's character is depleted");
  assert.equal(zoneOf(foe.engine, foe.id("foe")), "play", "not destroyed");
  assert.equal(isDepleted(foe.engine, foe.id("foe2")), false);
  assert.equal(zoneOf(foe.engine, foe.id("up")), "play", "the item stays in play");
  const mine = upgradeBoard();
  playUpgrade(mine, "mine");
  assert.equal(isDepleted(mine.engine, mine.id("mine")), true, "my own character can be picked");
  assert.equal(isDepleted(mine.engine, mine.id("foe")), false);
});

clause(UPGRADE, "0:rule", "declining the pick does nothing", () => {
  const g = upgradeBoard();
  playUpgrade(g, undefined);
  for (const k of ["foe", "foe2", "mine", "covertMine"]) assert.equal(isDepleted(g.engine, g.id(k)), false, k);
  assert.equal(zoneOf(g.engine, g.id("up")), "play");
});

clause(UPGRADE, "0:rule", "only a character in play can be picked, and only one", () => {
  const g = upgradeBoard();
  play(g.engine, P1, g.id("up"));
  refused(() => pickSel(g.engine, [g.id("gear")]), "an item");
  refused(() => pickSel(g.engine, [factionOf(g.engine, P2)]), "a faction");
  refused(() => pickSel(g.engine, [g.id("foe"), g.id("foe2")]), "two characters");
  pickSel(g.engine, [g.id("foe2")]);
  assert.equal(isDepleted(g.engine, g.id("foe2")), true);
  assert.equal(isDepleted(g.engine, g.id("foe")), false);
});

const upgradeRestoreTurn = (g: UpgradeBoard): void => {
  endTurn(g.engine, P1); // P2's turn: its Restore Rule
  endTurn(g.engine, P2); // P1's turn: my Restore Rule
};

clause(UPGRADE, "1:rule", "the picked character cannot be restored by the Restore Rule (theirs, at the start of their turn), while others are", () => {
  const g = upgradeBoard();
  g.engine.state.cards[g.id("foe2")].depleted = true;
  playUpgrade(g, "foe");
  endTurn(g.engine, P1); // the opponent's turn starts: their Restore Rule
  assert.equal(g.engine.state.activePlayerId, P2);
  assert.equal(isDepleted(g.engine, g.id("foe")), true, "the picked character stays depleted");
  assert.equal(isDepleted(g.engine, g.id("foe2")), false, "control: another depleted character is restored");
  endTurn(g.engine, P2);
  endTurn(g.engine, P1);
  assert.equal(isDepleted(g.engine, g.id("foe")), true, "and stays depleted through later Restore Rules");
});

clause(UPGRADE, "1:rule", "a picked character of mine is not restored by MY Restore Rule either", () => {
  const g = upgradeBoard();
  playUpgrade(g, "mine");
  upgradeRestoreTurn(g);
  assert.equal(g.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(g.engine, g.id("mine")), true);
});

clause(UPGRADE, "1:rule", "only the Restore Rule is blocked: an effect that restores it works", () => {
  const g = upgradeBoard();
  playUpgrade(g, "mine");
  play(g.engine, P1, g.id("refresh"), { selected: { t: [g.id("mine")] } });
  assert.equal(isDepleted(g.engine, g.id("mine")), false);
});

clause(UPGRADE, "1:rule", "if the picked character is COVERT it is destroyed; a non-covert one is not (mine or theirs)", () => {
  const foeCovert = upgradeBoard({ covertFoe: true });
  playUpgrade(foeCovert, "foe");
  assert.equal(zoneOf(foeCovert.engine, foeCovert.id("foe")), "discard", "the covert character is destroyed");
  assert.equal(zoneOf(foeCovert.engine, foeCovert.id("foe2")), "play");
  const mineCovert = upgradeBoard();
  playUpgrade(mineCovert, "covertMine");
  assert.equal(zoneOf(mineCovert.engine, mineCovert.id("covertMine")), "discard", "covert applies to my own character as well");
  const plain = upgradeBoard();
  playUpgrade(plain, "foe");
  assert.equal(zoneOf(plain.engine, plain.id("foe")), "play", "a non-covert character survives");
});

clause(UPGRADE, "1:rule", "declining the pick means no restriction and no destruction: a covert character left alone is neither depleted nor locked", () => {
  const g = upgradeBoard({ covertFoe: true });
  g.engine.state.cards[g.id("foe2")].depleted = true;
  playUpgrade(g, undefined);
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  endTurn(g.engine, P1);
  assert.equal(isDepleted(g.engine, g.id("foe2")), false, "restored as usual");
});

// =============================================================================
// Fiery Doom Device -- item (gearsmith) gear, ATTACH TO CHARACTER, cost 5, threshold [E][E], str 3 / spd 0 / life 0
// =============================================================================

const DOOM = "58acea18-dc3a-441e-b76b-f95ac57137a3";

function doomBoard(o: { zone?: "hand" | "play"; attached?: string; mana?: Icons; extra?: CardPlacement[]; active?: PlayerId } = {}) {
  return devBoard(
    [
      { key: "dev", def: printing(DOOM), owner: P1, zone: o.zone ?? "hand", ...(o.attached ? { attachedToKey: o.attached } : {}) },
      { key: "host", def: character({ name: "Host", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "mate", def: character({ name: "Mate", strength: 1, life: 6, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", strength: 1, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      ...res(o.mana ?? { elitism: 2, rage: 3 }),
      ...(o.extra ?? [])
    ],
    { turn: 2, activePlayerId: o.active ?? P1 }
  );
}
type DoomBoard = ReturnType<typeof doomBoard>;
const equipped = (o: { extra?: CardPlacement[]; active?: PlayerId } = {}): DoomBoard => doomBoard({ zone: "play", attached: "host", mana: {}, ...o });

/** Answers the attack-declaration prompts: the trigger order (first) and the zap pick (`zap`). */
const attackAnswers = (zap: CardInstanceId | undefined) => (pc: PendingChoiceLike): unknown => {
  if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
  if (pc.kind === "selectTargets") {
    const decl = (pc.declarations as Array<{ id: string }>)[0].id;
    return { kind: "selectTargets", selected: { [decl]: zap ? [zap] : [] } };
  }
  return declineAll(pc);
};
function attackWith(g: DoomBoard, attacker: string, zap: string | undefined): void {
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id(attacker)], target: { type: "faction", playerId: P2 } });
  drain(g.engine, attackAnswers(zap ? g.id(zap) : undefined));
  resolvePendingResponses(g.engine);
}

clause(DOOM, "0:attach", "printed card: an item with ATTACH TO CHARACTER, cost 5, threshold [E][E], str 3 / spd 0 / life 0; one short or one [E] is refused", () => {
  const p = printing(DOOM);
  assert.equal(p.type, "item");
  assert.equal(p.cost, 5);
  assert.equal(p.threshold, "ee");
  assert.equal(p.strength, 3);
  assert.equal(p.speed, 0);
  assert.equal(p.life, 0);
  assert.equal((p as unknown as { attachTo?: string }).attachTo, "character");
  const mk = (cards: CardPlacement[]) => doomBoard({ mana: {}, extra: cards });
  const ok = mk(res({ elitism: 2, rage: 3 }));
  const before = ready(ok.engine);
  play(ok.engine, P1, ok.id("dev"), { selected: { attachTo: [ok.id("host")] } });
  assert.equal(zoneOf(ok.engine, ok.id("dev")), "play");
  assert.equal(before - ready(ok.engine), 5, "exactly 5 paid");
  const short = mk(res({ elitism: 2, rage: 2 }));
  refused(() => play(short.engine, P1, short.id("dev"), { selected: { attachTo: [short.id("host")] } }), "one short");
  assert.equal(zoneOf(short.engine, short.id("dev")), "hand");
  const noIcon = mk(res({ elitism: 1, rage: 4 }));
  refused(() => play(noIcon.engine, P1, noIcon.id("dev"), { selected: { attachTo: [noIcon.id("host")] } }), "one [E]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("dev")), "hand");
});

clause(DOOM, "0:attach", "it attaches to the picked character, and is refused for an item or a location; picking none is refused", () => {
  const g = doomBoard({ extra: [] });
  play(g.engine, P1, g.id("dev"), { selected: { attachTo: [g.id("mate")] } });
  assert.equal(g.engine.state.cards[g.id("dev")].attachedTo, g.id("mate"));
  const bad = doomBoard();
  refused(() => play(bad.engine, P1, bad.id("dev"), { selected: { attachTo: [bad.id("gear")] } }), "an item");
  refused(() => play(bad.engine, P1, bad.id("dev"), { selected: { attachTo: [bad.id("place")] } }), "a location");
  refused(() => play(bad.engine, P1, bad.id("dev"), { selected: {} }), "no host picked");
  assert.equal(zoneOf(bad.engine, bad.id("dev")), "hand");
  assert.equal(ready(bad.engine), 5, "nothing was paid by the refused tries");
});

clause(DOOM, "0:attach", "it can be attached to the opponent's character too (ATTACH TO CHARACTER names no controller)", () => {
  const g = doomBoard();
  play(g.engine, P1, g.id("dev"), { selected: { attachTo: [g.id("foe")] } });
  assert.equal(g.engine.state.cards[g.id("dev")].attachedTo, g.id("foe"));
  assert.equal(stat(g.engine, g.id("foe"), "strength"), 4, "the host gets +3 whoever controls it");
});

clause(DOOM, "1:rule", "the attached character gains exactly 3 strength (and only strength); others do not; it ends when the item leaves play", () => {
  const g = equipped();
  assert.equal(stat(g.engine, g.id("host"), "strength"), 4, "1 + 3");
  assert.equal(stat(g.engine, g.id("host"), "speed"), 2);
  assert.equal(stat(g.engine, g.id("host"), "life"), 6);
  assert.equal(stat(g.engine, g.id("mate"), "strength"), 1, "other characters are unaffected");
  assert.equal(stat(g.engine, g.id("foe"), "strength"), 1);
  const bare = doomBoard({ zone: "hand" });
  assert.equal(stat(bare.engine, bare.id("host"), "strength"), 1, "no bonus before it is attached");
  const gone = equipped({ extra: [{ key: "smash", def: tactic({ name: "Smash", cost: 0, behavior: { abilities: [{ id: "smash", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] } }), owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("smash"), { selected: { t: [gone.id("dev")] } });
  assert.equal(zoneOf(gone.engine, gone.id("dev")), "discard");
  assert.equal(stat(gone.engine, gone.id("host"), "strength"), 1, "the bonus is gone with the item");
});

clause(DOOM, "1:rule", "the +3 is real in combat: the host deals 4 damage to a blocker", () => {
  const g = equipped({ extra: [{ key: "wall", def: character({ name: "Wall", strength: 0, life: 4, speed: 1 }), owner: P2, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("host")], target: { type: "faction", playerId: P2 } });
  drain(g.engine, attackAnswers(g.id("foe")));
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P2, [g.id("wall")]);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(zoneOf(g.engine, g.id("wall")), "discard", "4 damage destroys the 4-life blocker");
});

clause(DOOM, "2:rule", "when the attached character attacks, it is restored at the end of the battle (ready again, not depleted)", () => {
  const g = equipped();
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(isDepleted(g.engine, g.id("host")), false, "restored at the end of the battle");
  const control = doomBoard({ zone: "hand" });
  fight(control.engine, P1, [control.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(isDepleted(control.engine, control.id("host")), true, "control: an attacker without the item is depleted");
});

clause(DOOM, "2:rule", "once per turn: a second attack in the same turn is not restored again", () => {
  const g = equipped();
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(isDepleted(g.engine, g.id("host")), false);
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(isDepleted(g.engine, g.id("host")), true, "the second attack this turn is not restored");
});

clause(DOOM, "2:rule", "the once-per-turn limit resets on the next turn, and it does not restore a character that merely blocks or another attacker", () => {
  const g = equipped();
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(isDepleted(g.engine, g.id("host")), false, "restored again on a new turn");
  const other = equipped();
  fight(other.engine, P1, [other.id("mate")], { type: "faction", playerId: P2 }, []);
  assert.equal(isDepleted(other.engine, other.id("mate")), true, "another attacker is not restored");
  assert.equal(other.engine.state.pendingChoice, undefined, "and nothing is asked when a different character attacks");
});

clause(DOOM, "2:rule", "it does not trigger when the attached character blocks", () => {
  const g = equipped({ active: P2, extra: [{ key: "raider", def: character({ name: "Raider", strength: 1, life: 6, speed: 2 }), owner: P2, zone: "play" }] });
  g.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [g.id("raider")], target: { type: "faction", playerId: P1 } });
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P1, [g.id("host")]);
  finishBattle(g.engine);
  assert.equal(isDepleted(g.engine, g.id("host")), true, "a blocker is depleted afterwards: no restore");
  assert.equal(damageOn(g.engine, g.id("raider")), 4, "the +3 strength applies when blocking");
});

clause(DOOM, "3:rule", "when the attached character attacks, I pick a character (mine, theirs, the host itself) and it takes exactly 2 damage", () => {
  for (const pick of ["foe", "mate", "host"]) {
    const g = equipped();
    attackWith(g, "host", pick);
    assert.equal(damageOn(g.engine, g.id(pick)), 2, `${pick} takes 2`);
    for (const other of ["foe", "mate", "foe2"].filter((k) => k !== pick)) assert.equal(damageOn(g.engine, g.id(other)), 0, `${other} takes none`);
  }
  const kill = equipped();
  attackWith(kill, "host", "foe2");
  assert.equal(zoneOf(kill.engine, kill.id("foe2")), "discard", "2 damage destroys the life-2 character");
});

clause(DOOM, "3:rule", "the pick is a single character in play: an item, a location, a faction and two characters are refused", () => {
  const g = equipped();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("host")], target: { type: "faction", playerId: P2 } });
  // answer the trigger order if it is asked first
  for (let i = 0; i < 3 && pending(g.engine)?.kind === "orderTriggers"; i++) {
    answerPending(g.engine, "orderTriggers", { next: (pending(g.engine)!.triggers as unknown[])[0] });
  }
  const pc = pending(g.engine);
  assert.ok(pc, "the pick is mandatory and asked");
  assert.equal(pc.kind, "selectTargets");
  refused(() => pickSel(g.engine, [g.id("gear")]), "an item");
  refused(() => pickSel(g.engine, [g.id("place")]), "a location");
  refused(() => pickSel(g.engine, [factionOf(g.engine, P2)]), "a faction");
  refused(() => pickSel(g.engine, [g.id("foe"), g.id("mate")]), "two characters");
  refused(() => pickSel(g.engine, []), "'pick a character' is not optional");
  pickSel(g.engine, [g.id("foe")]);
  assert.equal(damageOn(g.engine, g.id("foe")), 2, "control");
});

clause(DOOM, "3:rule", "it fires every time the attached character attacks (not once per turn), and not when another character attacks", () => {
  const g = equipped();
  attackWith(g, "host", "foe");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  attackWith(g, "host", "foe");
  assert.equal(damageOn(g.engine, g.id("foe")), 4, "2 damage on each attack");
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  const other = equipped();
  fight(other.engine, P1, [other.id("mate")], { type: "faction", playerId: P2 }, []);
  assert.equal(damageOn(other.engine, other.id("foe")), 0, "no zap when a different character attacks");
});

// =============================================================================
// Finger Explosive -- item (gearsmith), cost 1, threshold [E]
// =============================================================================

const FINGER = "e634a62b-1295-4fbe-8349-1434c067e9d1";

function fingerBoard(o: { rage?: number; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "fe", def: printing(FINGER), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", life: 3 }), owner: P2, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P2, zone: "play" },
      ...res({ rage: o.rage ?? 1 }),
      ...(o.extra ?? [])
    ],
    { turn: 2 }
  );
}
type FingerBoard = ReturnType<typeof fingerBoard>;
const pull = (g: FingerBoard, mine: string, theirs: string, player: PlayerId = P1): void =>
  activate(g.engine, player, g.id("fe"), "finger-explosive-pull", { selected: { mine: [g.id(mine)], theirs: [g.id(theirs)] } });

clause(FINGER, "0:ability:finger-explosive-pull", "printed card: an item for cost 1 with [E]; deploys with one [E], refused with only non-[E] or nothing", () => {
  const mk = (cards: CardPlacement[]) => devBoard([{ key: "c", def: printing(FINGER), owner: P1, zone: "hand" }, ...cards], { turn: 2 });
  const ok = mk(res({ elitism: 1 }));
  play(ok.engine, P1, ok.id("c"));
  assert.equal(zoneOf(ok.engine, ok.id("c")), "play");
  assert.equal(ready(ok.engine), 0, "exactly 1 paid");
  assert.equal(printing(FINGER).type, "item");
  const noIcon = mk(res({ rage: 3 }));
  refused(() => play(noIcon.engine, P1, noIcon.id("c")), "no [E]");
  const none = mk([]);
  refused(() => play(none.engine, P1, none.id("c")), "nothing to pay with");
});

clause(FINGER, "0:ability:finger-explosive-pull", "destroys the picked character I control AND the picked character an opponent controls; the item is destroyed", () => {
  const g = fingerBoard();
  pull(g, "mine", "foe");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
  assert.equal(zoneOf(g.engine, g.id("fe")), "discard", "the Finger Explosive is destroyed");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "play", "bystanders are untouched");
  assert.equal(zoneOf(g.engine, g.id("foe2")), "play");
  assert.equal(zoneOf(g.engine, g.id("gear")), "play");
});

clause(FINGER, "0:ability:finger-explosive-pull", "costs are paid on activation: 1 resource spent and the item destroyed while the two characters are still in play", () => {
  const g = fingerBoard({ rage: 3 });
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("fe"), abilityId: "finger-explosive-pull", selected: { mine: [g.id("mine")], theirs: [g.id("foe")] }, variables: {} } as never);
  assert.equal(ready(g.engine), 2, "exactly 1 resource paid");
  assert.equal(zoneOf(g.engine, g.id("fe")), "discard", "destroyed as a cost");
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "the characters die with the effect");
  assert.equal(zoneOf(g.engine, g.id("foe")), "play");
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "discard");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard");
});

clause(FINGER, "0:ability:finger-explosive-pull", "the picks are checked: two of my characters, two of theirs, an item, or a missing pick are refused and pay nothing", () => {
  const g = fingerBoard();
  refused(() => pull(g, "mine", "mine2"), "both picks are mine");
  refused(() => pull(g, "foe", "foe2"), "both picks are theirs");
  refused(() => pull(g, "foe", "mine"), "the picks are swapped");
  refused(() => pull(g, "gear", "foe"), "an item is not a character I control");
  refused(() => pull(g, "mine", "gear"), "an item is not a character");
  refused(() => activate(g.engine, P1, g.id("fe"), "finger-explosive-pull", { selected: { mine: [g.id("mine")] } }), "only one pick");
  assert.equal(zoneOf(g.engine, g.id("fe")), "play");
  assert.equal(ready(g.engine), 1, "nothing was paid");
  for (const k of ["mine", "mine2", "foe", "foe2"]) assert.equal(zoneOf(g.engine, g.id(k)), "play", k);
  pull(g, "mine2", "foe2");
  assert.equal(zoneOf(g.engine, g.id("mine2")), "discard", "control: one of each");
  assert.equal(zoneOf(g.engine, g.id("foe2")), "discard");
});

clause(FINGER, "0:ability:finger-explosive-pull", "needs 1 ready resource: refused with none; the opponent cannot use it", () => {
  const none = fingerBoard({ rage: 0 });
  refused(() => pull(none, "mine", "foe"), "no resource to pay");
  assert.equal(zoneOf(none.engine, none.id("fe")), "play");
  assert.equal(zoneOf(none.engine, none.id("mine")), "play");
  const g = fingerBoard();
  refused(() => pull(g, "foe", "mine", P2), "not their card", /controller|control|own|priority|your/i);
  assert.equal(zoneOf(g.engine, g.id("fe")), "play");
});

// =============================================================================
// Flight Instinct -- resource (rogue), PROVIDES [D]
// =============================================================================

const FLIGHT = "fb57ff73-6c21-4178-a382-f14ed7dc272c";

/** A faction whose Restore Rule restores nothing and whose Develop Rule offers nothing: the opponent's turn start cannot restore their characters. */
const noRestoreFaction = (): CardDefinition =>
  factionCard({
    faction: defaultFactionDefinition({ turn: { restore: { detachResources: false, restoreNonResources: false }, develop: { choices: [] } } })
  });

function flightBoard(o: { zone?: "play" | "hand"; faceDown?: boolean; extra?: CardPlacement[] } = {}) {
  return buildGame({ playerA: { faction: barrenFaction() }, playerB: { faction: noRestoreFaction() }, turn: 2, cards: flightCards(o) });
}
function flightCards(o: { zone?: "play" | "hand"; faceDown?: boolean; extra?: CardPlacement[] }): CardPlacement[] {
  return [
      { key: "fi", def: printing(FLIGHT), owner: P1, zone: o.zone ?? "play", faceDown: o.faceDown },
      { key: "fast", def: character({ name: "Fast", strength: 1, life: 3, speed: 4 }), owner: P1, zone: "play", depleted: true },
      { key: "faster", def: character({ name: "Faster", strength: 1, life: 3, speed: 6 }), owner: P1, zone: "play", depleted: true },
      { key: "slow", def: character({ name: "Slow", strength: 1, life: 3, speed: 3 }), owner: P1, zone: "play", depleted: true },
      { key: "theirFast", def: character({ name: "Their Fast", strength: 1, life: 3, speed: 4 }), owner: P2, zone: "play", depleted: true },
      { key: "readyFast", def: character({ name: "Ready Fast", strength: 1, life: 3, speed: 4 }), owner: P1, zone: "play" },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" },
      ...(o.extra ?? [])
  ];
}
type FlightBoard = ReturnType<typeof flightBoard>;
const thresholdOfIcon = (g: FlightBoard, icon: string): number => (g.engine.getThresholds(P1) as unknown as Record<string, number>)[icon] ?? 0;
const endMyTurn = (g: FlightBoard): void => endTurnRaw(g.engine, P1);

clause(FLIGHT, "0:provides", "PROVIDES [D]: in play it provides exactly one [D] and nothing else; it is a free resource card (cost 0)", () => {
  const g = flightBoard();
  assert.equal(thresholdOfIcon(g, "deception"), 1);
  for (const icon of ["rage", "greed", "elitism", "obsession", "volition"]) assert.equal(thresholdOfIcon(g, icon), 0, `no ${icon}`);
  const p = printing(FLIGHT);
  assert.equal(p.type, "resource");
  assert.equal(p.cost, 0);
  assert.equal(p.trade, "rogue");
  const hand = flightBoard({ zone: "hand" });
  assert.equal(thresholdOfIcon(hand, "deception"), 0, "in hand it provides nothing");
  assert.equal(ready(g.engine), 1, "it is a payable resource");
});

clause(FLIGHT, "0:provides", "it can be played as a resource and then provides [D] (a [D] card becomes deployable)", () => {
  const g = devBoard(
    [
      { key: "fi", def: printing(FLIGHT), owner: P1, zone: "hand" },
      { key: "needy", def: character({ name: "Needy", cost: 0, threshold: "d" as never }), owner: P1, zone: "hand" }
    ],
    { turn: 1 }
  );
  refused(() => play(g.engine, P1, g.id("needy")), "no [D] yet");
  developResource(g.engine, P1, g.id("fi"), false);
  assert.equal(zoneOf(g.engine, g.id("fi")), "play");
  play(g.engine, P1, g.id("needy"));
  assert.equal(zoneOf(g.engine, g.id("needy")), "play");
});

clause(FLIGHT, "1:rule", "at the end of my turn I may restore a character with speed 4 or more (accept: depleted speed 4 and 6, mine or theirs)", () => {
  for (const key of ["fast", "faster", "theirFast"]) {
    const g = flightBoard();
    endMyTurn(g);
    const pc = pending(g.engine)!;
    assert.equal(pc.kind, "selectTargets", "an optional pick at the end of my turn");
    assert.equal(pc.playerId, P1);
    pickSel(g.engine, [g.id(key)]);
    assert.equal(isDepleted(g.engine, g.id(key)), false, `${key} is restored`);
    for (const other of ["fast", "faster", "theirFast"].filter((k) => k !== key)) assert.equal(isDepleted(g.engine, g.id(other)), true, `${other} stays depleted`);
  }
});

clause(FLIGHT, "1:rule", "the pick is optional: declining restores nothing", () => {
  const g = flightBoard();
  endMyTurn(g);
  pickSel(g.engine, []);
  for (const key of ["fast", "faster", "theirFast"]) assert.equal(isDepleted(g.engine, g.id(key)), true, key);
});

clause(FLIGHT, "1:rule", "speed must be 4 or more: a speed-3 character, an item and a faction cannot be picked; two picks are refused", () => {
  const g = flightBoard();
  endMyTurn(g);
  refused(() => pickSel(g.engine, [g.id("slow")]), "speed 3");
  refused(() => pickSel(g.engine, [g.id("gear")]), "an item");
  refused(() => pickSel(g.engine, [factionOf(g.engine, P1)]), "a faction");
  refused(() => pickSel(g.engine, [g.id("fast"), g.id("faster")]), "two characters");
  assert.equal(isDepleted(g.engine, g.id("slow")), true);
  pickSel(g.engine, [g.id("fast")]);
  assert.equal(isDepleted(g.engine, g.id("fast")), false, "control: speed exactly 4");
});

clause(FLIGHT, "1:rule", "speed counts current speed: a speed-3 character raised to 4 this turn can be picked", () => {
  const boost = tactic({
    name: "Haste",
    cost: 0,
    behavior: { abilities: [{ id: "haste", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "speed", operation: "add", value: 1, duration: { type: "untilEndOfTurn" } }] }] }
  });
  const g = flightBoard({ extra: [{ key: "haste", def: boost, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("haste"), { selected: { t: [g.id("slow")] } });
  assert.equal(stat(g.engine, g.id("slow"), "speed"), 4);
  endMyTurn(g);
  pickSel(g.engine, [g.id("slow")]);
  assert.equal(isDepleted(g.engine, g.id("slow")), false);
});

clause(FLIGHT, "1:rule", "only at the end of MY turn, and only while it is face-up in play", () => {
  const opp = flightBoard();
  opp.engine.state.activePlayerId = P2;
  opp.engine.state.priorityPlayerId = P2;
  endTurnRaw(opp.engine, P2);
  assert.equal(opp.engine.state.pendingChoice, undefined, "the end of the opponent's turn offers nothing");
  const inHand = flightBoard({ zone: "hand" });
  endMyTurn(inHand);
  assert.equal(inHand.engine.state.pendingChoice, undefined, "in hand");
  const down = flightBoard({ faceDown: true });
  endMyTurn(down);
  assert.equal(down.engine.state.pendingChoice, undefined, "face-down it is just a Volition resource");
  assert.equal(isDepleted(down.engine, down.id("fast")), true);
});

clause(FLIGHT, "1:rule", "a character that is already ready is a legal pick (restoring does nothing), and with no speed-4 character nothing is offered", () => {
  const g = flightBoard();
  endMyTurn(g);
  pickSel(g.engine, [g.id("readyFast")]);
  assert.equal(isDepleted(g.engine, g.id("readyFast")), false);
  const none = barrenBoard(
    [
      { key: "fi", def: printing(FLIGHT), owner: P1, zone: "play" },
      { key: "slow", def: character({ name: "Slow", speed: 3 }), owner: P1, zone: "play", depleted: true }
    ],
    { turn: 2 }
  );
  endTurnRaw(none.engine, P1);
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(none.engine, none.id("slow")), true);
});
// =============================================================================
// Additional edge cases (added after the first pass)
// =============================================================================

clause(DUAL, "0:extraCost", "damage inflicted by a character that has since been destroyed still counts (it sits in the discard pile)", () => {
  const g = dualBoard({ rage: 4 });
  hitFaction(g);
  play(g.engine, P1, g.id("smite"), { selected: { t: [g.id("atk")] } });
  g.engine.state.cards[g.id("atk")].damage = 9;
  settleState(g.engine);
  assert.equal(zoneOf(g.engine, g.id("atk")), "discard", "the attacker is gone");
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play");
});

clause(DUAL, "0:extraCost", "damage I inflicted with a Micromajig token that has since left play still counts", () => {
  const maker = tactic({
    name: "Make Token",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "mk",
          type: "activated",
          effects: [{ type: "createTokens", count: 1, controller: "controller", token: { cardType: "character", subtype: ["majig"], strength: 2, life: 1, speed: 3, name: "Micromajig" } }]
        }
      ]
    }
  } as Partial<CardDefinition>);
  const g = dualBoard({ rage: 4, extra: [{ key: "maker", def: maker, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("maker"));
  const token = Object.values(g.engine.state.cards).find((c) => c.zone === "play" && g.engine.getDefinition(c.id).name === "Micromajig");
  assert.ok(token, "the token is in play");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  fight(g.engine, P1, [token.id], { type: "faction", playerId: P2 }, []);
  assert.equal(influence(g.engine, P2), 28, "the token hit the faction");
  play(g.engine, P1, g.id("smite"), { selected: { t: [token.id] } });
  assert.notEqual(g.engine.state.cards[token.id]?.zone, "play", "the token is gone");
  tryDual(g);
  assert.equal(zoneOf(g.engine, g.id("dual")), "play", "damage inflicted by a card that has left play still counts");
});

clause(DUAL, "0:extraCost", "damage from Drill Garrison at the start of my turn counts: Dual Blade Assassin can be deployed afterwards", () => {
  const g = devBoard(
    [
      { key: "dg", def: printing(DG), owner: P1, zone: "play" },
      { key: "dual", def: printing(DUAL), owner: P1, zone: "hand" },
      ...res({ rage: 5 }),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ],
    { turn: 2, activePlayerId: P2 }
  );
  endTurn(g.engine, P2);
  assert.equal(g.engine.state.activePlayerId, P1);
  const answerStart = (option: number) => (pc: PendingChoiceLike): unknown =>
    pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: option } : declineAll(pc);
  drain(g.engine, answerStart(1));
  assert.equal(influence(g.engine, P2), 29, "the Garrison inflicted 1 damage");
  play(g.engine, P1, g.id("dual"));
  assert.equal(zoneOf(g.engine, g.id("dual")), "play");
  // control: declining the damage leaves nothing inflicted this turn
  const dec = devBoard(
    [
      { key: "dg", def: printing(DG), owner: P1, zone: "play" },
      { key: "dual", def: printing(DUAL), owner: P1, zone: "hand" },
      ...res({ rage: 5 }),
      ...fillers("pd", 3, P1, "deck"),
      ...fillers("qd", 3, P2, "deck")
    ],
    { turn: 2, activePlayerId: P2 }
  );
  endTurn(dec.engine, P2);
  drain(dec.engine, answerStart(0));
  assert.equal(influence(dec.engine, P2), 30);
  refused(() => play(dec.engine, P1, dec.id("dual")), "no damage was inflicted this turn");
  assert.equal(zoneOf(dec.engine, dec.id("dual")), "hand");
});

clause(DRY, "1:rule", "'has life': the character's life stat, not its remaining life: a damaged character with life above X stays", () => {
  const g = dryBoard({ life: 4, pay: [...spentIcon("deception", 2), ...volition(2)] });
  g.engine.state.cards[g.id("t")].damage = 3;
  dryCast(g);
  assert.equal(zoneOf(g.engine, g.id("t")), "play", "life 4 is more than 2 [D], even with 3 damage");
  const low = dryBoard({ life: 2, pay: [...spentIcon("deception", 2), ...volition(2)] });
  low.engine.state.cards[low.id("t")].damage = 1;
  dryCast(low);
  assert.equal(zoneOf(low.engine, low.id("t")), "void", "life 2 is 2 or less");
});

clause(DRY, "1:rule", "'has life': a life bonus counts: life 1 raised to 3 this turn is above two [D]", () => {
  const boost = tactic({
    name: "Fortify",
    cost: 0,
    behavior: { abilities: [{ id: "fort", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "createModifier", target: { type: "selected", id: "t" }, stat: "life", operation: "add", value: 2, duration: { type: "untilEndOfTurn" } }] }] }
  });
  const g = dryBoard({ life: 1, pay: [...spentIcon("deception", 2), ...volition(2)], extra: [{ key: "fort", def: boost, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("fort"), { selected: { t: [g.id("t")] } });
  assert.equal(stat(g.engine, g.id("t"), "life"), 3);
  dryCast(g);
  assert.equal(zoneOf(g.engine, g.id("t")), "play", "life 3 > 2");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "'characters you control' is judged when the destruction happens: a character that enters play later this turn is protected too", () => {
  const g = escortBoard({ active: P1, extra: [{ key: "late", def: character({ name: "Late", cost: 0, life: 2 }), owner: P1, zone: "hand" }] });
  substitute(g);
  resolvePendingResponses(g.engine);
  play(g.engine, P1, g.id("late"));
  assert.equal(zoneOf(g.engine, g.id("late")), "play");
  // the opponent's tactic in response to something of mine
  g.engine.state.activePlayerId = P1;
  declareAttackOpenWindow(g.engine, P1, [g.id("mine")]);
  playRaw(g.engine, P2, g.id("kill"), { selected: { t: [g.id("late")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("late")), "play", "the late arrival cannot be destroyed by their tactic this turn");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "'abilities your opponents control': an opposing ability that destroys my character (Finger Explosive) is stopped for it, while their own character still dies", () => {
  const g = escortBoard({
    extra: [
      { key: "fe", def: printing(FINGER), owner: P2, zone: "play" },
      ...res({ rage: 1 }, P2)
    ]
  });
  g.engine.perform({ type: "activateAbility", playerId: P2, cardId: g.id("fe"), abilityId: "finger-explosive-pull", selected: { mine: [g.id("foe")], theirs: [g.id("mine")] }, variables: {} } as never);
  substitute(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "my character is protected from their ability");
  assert.equal(zoneOf(g.engine, g.id("foe")), "discard", "their own character is destroyed by their own ability");
});

clause(ESCORT, "0:ability:escort-ally-substitute", "lethal damage from an opposing tactic's damage effect is stopped as well (the literal 'destroyed by cards they control' reading)", () => {
  const g = escortBoard({ extra: [{ key: "zap", def: smiteTactic(5), owner: P2, zone: "hand" }] });
  playRaw(g.engine, P2, g.id("zap"), { selected: { t: [g.id("mine")] } });
  substitute(g);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("mine")), "play", "5 damage on a 2-life character would destroy it");
});

clause(DOOM, "2:rule", "attacking in a party: the host is restored at the end of the battle, the other attacker is not, and the zap fires once", () => {
  const g = equipped();
  g.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [g.id("host"), g.id("mate")], target: { type: "faction", playerId: P2 } });
  drain(g.engine, attackAnswers(g.id("foe")));
  resolvePendingResponses(g.engine);
  declareBlockers(g.engine, P2, []);
  finishBattle(g.engine, undefined, attackAnswers(undefined));
  assert.equal(isDepleted(g.engine, g.id("host")), false, "the host is restored");
  assert.equal(isDepleted(g.engine, g.id("mate")), true, "the other attacker is depleted as usual");
  assert.equal(damageOn(g.engine, g.id("foe")), 2, "one zap of 2");
});

clause(FLIGHT, "1:rule", "'at the end of your turn': the prompt waits for the end-of-turn response window to close (the opponent can still respond first)", () => {
  const g = flightBoard({ extra: [{ key: "resp", def: tactic({ name: "Quick", cost: 0 }), owner: P2, zone: "hand" }] });
  g.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(g.engine.state.pendingChoice, undefined, "not yet: the turn has only been announced to end");
  assert.equal(g.engine.state.responseWindow?.kind, "endTurn");
  assert.equal(g.engine.state.activePlayerId, P1);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine)?.kind, "selectTargets", "after the window closes the end-of-turn trigger asks");
  assert.equal(pending(g.engine)?.playerId, P1);
  pickSel(g.engine, [g.id("fast")]);
  assert.equal(isDepleted(g.engine, g.id("fast")), false);
});

clause(FLIGHT, "1:rule", "two Flight Instincts: each triggers (two picks) at the end of my turn", () => {
  const g = flightBoard({ extra: [{ key: "fi2", def: printing(FLIGHT), owner: P1, zone: "play" }] });
  endMyTurn(g);
  const answers: CardInstanceId[] = [g.id("fast"), g.id("faster")];
  drain(g.engine, (pc) => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "selectTargets") {
      const decl = (pc.declarations as Array<{ id: string }>)[0].id;
      return { kind: "selectTargets", selected: { [decl]: [answers.shift()!] } };
    }
    return declineAll(pc);
  });
  assert.equal(isDepleted(g.engine, g.id("fast")), false);
  assert.equal(isDepleted(g.engine, g.id("faster")), false);
  assert.equal(isDepleted(g.engine, g.id("theirFast")), true, "the third speed-4 character is untouched");
});

const namerOtherRoute = (id: string, a: Icon5) => () => {
  const putIn = tactic({
    name: "Put Resource",
    cost: 0,
    behavior: { abilities: [{ id: "pr", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "resource" }, count: 1 }], effects: [{ type: "playResource", target: { type: "selected", id: "t" }, faceDown: false, player: "controller" }] }] }
  } as Partial<CardDefinition>);
  const g = namerBoard(id, { extra: [{ key: "putter", def: putIn, owner: P1, zone: "hand" }] });
  play(g.engine, P1, g.id("putter"), { selected: { t: [g.id("r1")] } });
  const pc = pending(g.engine);
  assert.ok(pc, "a resource put into play by an effect also triggers it");
  assert.equal(pc.kind, "nameValue");
  answerPending(g.engine, "nameValue", { value: a });
  assert.equal(thresholdOf(g, a), 1);
};
clause(DUPLICITY, "0:rule", "a resource entering play by a card effect (not the Develop Rule) triggers it too", namerOtherRoute(DUPLICITY, "deception"));
clause(ENTITLEMENT, "0:rule", "a resource entering play by a card effect (not the Develop Rule) triggers it too", namerOtherRoute(ENTITLEMENT, "elitism"));
clause(FANATICISM, "0:rule", "a resource entering play by a card effect (not the Develop Rule) triggers it too", namerOtherRoute(FANATICISM, "greed"));
// =============================================================================
// Printed card data (literal values from the manifest): type, trade, cost, threshold, subtypes, stats
// =============================================================================

interface PrintedData {
  type: string;
  trade: string;
  cost: number;
  threshold?: string;
  subtype?: string[];
  strength?: number;
  speed?: number;
  life?: number;
  structure?: number;
}
const printedData = (id: string, want: PrintedData) => (): void => {
  const p = printing(id);
  assert.equal(p.type, want.type, "type");
  assert.equal(p.trade, want.trade, "trade");
  assert.equal(p.cost, want.cost, "cost");
  if (want.threshold !== undefined) assert.equal(p.threshold, want.threshold, "threshold");
  assert.deepEqual([...(p.subtype ?? [])].sort(), [...(want.subtype ?? [])].sort(), "subtypes");
  assert.equal(p.strength, want.strength, "strength");
  assert.equal(p.speed, want.speed, "speed");
  assert.equal(p.life, want.life, "life");
  assert.equal(p.structure, want.structure, "structure");
};

clause(CHURNER, "0:rule", "printed card data: item, warlord, cost 3, threshold rrr, no stats", printedData(CHURNER, { type: "item", trade: "warlord", cost: 3, threshold: "rrr" }));
clause(STRIKER, "0:rule", "printed card data: warlord dragon character, cost 4, threshold rr, 4 / 3 / 2", printedData(STRIKER, { type: "character", trade: "warlord", cost: 4, threshold: "rr", subtype: ["dragon"], strength: 4, speed: 3, life: 2 }));
clause(THUNDER, "0:unique", "printed card data: arcanist thunderhoof / seraphim / dragon character, cost 5, threshold o, 1 / 3 / 4", printedData(THUNDER, { type: "character", trade: "arcanist", cost: 5, threshold: "o", subtype: ["thunderhoof", "seraphim", "dragon"], strength: 1, speed: 3, life: 4 }));
clause(DG, "0:unique", "printed card data: warlord location, cost 3, threshold r, structure 5", printedData(DG, { type: "location", trade: "warlord", cost: 3, threshold: "r", structure: 5 }));
clause(DRY, "0:extraCost", "printed card data: rogue tactic, cost 2, threshold d", printedData(DRY, { type: "tactic", trade: "rogue", cost: 2, threshold: "d" }));
clause(DUAL, "0:extraCost", "printed card data: warlord mercenary / assassin character, cost 2, threshold rr, 4 / 3 / 4", printedData(DUAL, { type: "character", trade: "warlord", cost: 2, threshold: "rr", subtype: ["mercenary", "assassin"], strength: 4, speed: 3, life: 4 }));
clause(ENGORGED, "0:rule", "printed card data: rogue sarcophyle character, cost 2, threshold d, 1 / 3 / 1", printedData(ENGORGED, { type: "character", trade: "rogue", cost: 2, threshold: "d", subtype: ["sarcophyle"], strength: 1, speed: 3, life: 1 }));
clause(ENLIGHTENED, "0:rule", "printed card data: rogue sarcophyle / wizard character, cost 4, threshold dd, 3 / 4 / 2", printedData(ENLIGHTENED, { type: "character", trade: "rogue", cost: 4, threshold: "dd", subtype: ["sarcophyle", "wizard"], strength: 3, speed: 4, life: 2 }));
clause(EROTIC, "0:rule", "printed card data: banker mercenary / assassin character, cost 0, threshold gg, 3 / 3 / 3", printedData(EROTIC, { type: "character", trade: "banker", cost: 0, threshold: "gg", subtype: ["mercenary", "assassin"], strength: 3, speed: 3, life: 3 }));
clause(ESCAPE, "0:kw:TACTICAL", "printed card data: rogue martial artist character, cost 3, threshold dd, 3 / 3 / 1", printedData(ESCAPE, { type: "character", trade: "rogue", cost: 3, threshold: "dd", subtype: ["martial artist"], strength: 3, speed: 3, life: 1 }));
clause(ESCORT, "0:ability:escort-ally-substitute", "printed card data: warlord soldier character, cost 2, threshold rr, 2 / 3 / 1", printedData(ESCORT, { type: "character", trade: "warlord", cost: 2, threshold: "rr", subtype: ["soldier"], strength: 2, speed: 3, life: 1 }));
clause(EXMACHINA, "0:unique", "printed card data: gearsmith majig character, cost 6, threshold eee, 5 / 3 / 5", printedData(EXMACHINA, { type: "character", trade: "gearsmith", cost: 6, threshold: "eee", subtype: ["majig"], strength: 5, speed: 3, life: 5 }));
clause(SEER, "0:ability:faceless-seer-imbue", "printed card data: universal teller character, cost 1, threshold v, 1 / 3 / 1", printedData(SEER, { type: "character", trade: "universal", cost: 1, threshold: "v", subtype: ["teller"], strength: 1, speed: 3, life: 1 }));
clause(NECRO, "0:rule", "printed card data: banker necromorph character, cost 4, threshold gg, 2 / 3 / 1", printedData(NECRO, { type: "character", trade: "banker", cost: 4, threshold: "gg", subtype: ["necromorph"], strength: 2, speed: 3, life: 1 }));
clause(UPGRADE, "0:rule", "printed card data: gearsmith item, cost 5, threshold ee, no stats", printedData(UPGRADE, { type: "item", trade: "gearsmith", cost: 5, threshold: "ee" }));
clause(DOOM, "0:attach", "printed card data: gearsmith gear item, cost 5, threshold ee, str 3 / spd 0 / life 0", printedData(DOOM, { type: "item", trade: "gearsmith", cost: 5, threshold: "ee", subtype: ["gear"], strength: 3, speed: 0, life: 0 }));
clause(FINGER, "0:ability:finger-explosive-pull", "printed card data: gearsmith item, cost 1, threshold e, no stats", printedData(FINGER, { type: "item", trade: "gearsmith", cost: 1, threshold: "e" }));

clause(SEER, "0:ability:faceless-seer-imbue", "the once-per-turn limit is per Seer: two Faceless Seers can each IMBUE once in the same turn", () => {
  const g = devBoard(
    [
      { key: "seer", def: printing(SEER), owner: P1, zone: "play" },
      { key: "seer2", def: printing(SEER), owner: P1, zone: "play" },
      ...res({ rage: 4 })
    ],
    { turn: 2 }
  );
  activate(g.engine, P1, g.id("seer"), "faceless-seer-imbue");
  activate(g.engine, P1, g.id("seer2"), "faceless-seer-imbue");
  assert.equal((g.engine.getThresholds(P1) as unknown as Record<string, number>).volition, 4, "each Seer provides [V][V]");
  assert.equal(ready(g.engine), 2, "each use paid 1");
  refused(() => activate(g.engine, P1, g.id("seer"), "faceless-seer-imbue"), "the first Seer already used it");
});
