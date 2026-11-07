// Clause tests, batch ungodly-mess-07, part p2 (groups 4-9, the clauses not yet covered).
// Cards: Gory Trick Box, Gosche's Spynarium, Lost on Floor 3, Moment of Annihilation, Noxious Gambler, Omahkapi'si Pi'kssii.
import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, tactic } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackOpenWindow } from "./_battle.js";
import { pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { endTurn, factionOf } from "./_turn.js";

type Pid = typeof P1 | typeof P2;

/** `n` deception resources of `owner` that are already spent (attached to the faction): they count for thresholds but cannot pay. */
const spentD = (n: number, owner: Pid = P1): CardPlacement[] =>
  bank("deception", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const COSTS = (n: number) => new RegExp(`costs ${n} resources`);
const THRESH = /threshold/i;
const stat = (e: SpoilsEngine, c: CardInstanceId, s: "strength" | "life" | "speed") => e.getStat(c, s);
const dev = { playerA: { faction: developFaction() }, playerB: { faction: developFaction() } };
const deckOf = (e: SpoilsEngine, p: Pid) => e.state.players[p].deck.slice();
const deckCards = (prefix: string, n: number, owner: Pid): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix}${i}` }), owner, zone: "deck" as const }));
const discardCards = (prefix: string, n: number, owner: Pid, mk: (i: number) => CardDefinition = (i) => character({ name: `${prefix}${i}` })): CardPlacement[] =>
  Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, def: mk(i), owner, zone: "discard" as const }));
const answerWith = (e: SpoilsEngine, p: Pid, choice: Record<string, unknown>) => {
  e.perform({ type: "resolvePendingChoice", playerId: p, choice } as never);
  resolvePendingResponses(e);
};
const pick = (e: SpoilsEngine, ids: CardInstanceId[], p: Pid = P1) => {
  const pc = pending(e) as unknown as { kind: string; playerId: string };
  assert.ok(pc, "a pick is pending");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, p);
  answerWith(e, p, { kind: "chooserSelectsTarget", selected: ids });
};

// =============================================================================
// Gory Trick Box
// =============================================================================
const BOX = "8d619f6d-498c-4343-a86b-4e01cef5ca34"; // ATTACH TO CHARACTER -- The attached character gains 2 strength and loses 2 speed.

const destroyItem = () =>
  tactic({
    name: "Smash Item",
    cost: 0,
    behavior: { abilities: [{ id: "k", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }] }
  });

function boxBoard(extra: CardPlacement[] = []) {
  return buildGame({
    ...dev,
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 3, speed: 5, life: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", strength: 3, speed: 5, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 4, speed: 6, life: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "box", def: printing(BOX), owner: P1, zone: "hand" },
      { key: "smash", def: destroyItem(), owner: P1, zone: "hand" },
      ...extra
    ]
  });
}
const attachBox = (b: ReturnType<typeof boxBoard>, host: string) => play(b.engine, P1, b.id("box"), { selected: { attachTo: [b.id(host)] } });

clause(BOX, "0:attach", "printed as a rogue item, subtype gear (cost 2, [D][D] checked below)", () => {
  const b = boxBoard();
  const d = b.engine.getDefinition(b.id("box"));
  assert.equal(d.type, "item");
  assert.equal(d.trade, "rogue");
  assert.deepEqual(d.subtype, ["gear"]);
});

clause(BOX, "0:attach", "costs exactly 2: two ready [D] deploy it attached to my character and are all spent", () => {
  const b = boxBoard(bank("deception", 2, P1));
  attachBox(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("box")), "play");
  assert.equal(b.engine.state.cards[b.id("box")].attachedTo, b.id("mine"));
  assert.equal(readyResources(b.engine, P1), 0, "exactly 2 paid");
  assert.equal(b.engine.state.cards[b.id("mine2")].attachedTo, undefined);
});

clause(BOX, "0:attach", "one short of the cost is refused even though the [D][D] threshold is met by a spent [D]", () => {
  const short = boxBoard([...spentD(1), ...bank("deception", 1, P1)]);
  refused(() => attachBox(short, "mine"), "1 ready resource for cost 2", COSTS(2));
  assert.equal(zoneOf(short.engine, short.id("box")), "hand");
  const ok = boxBoard([...spentD(1), ...bank("deception", 2, P1)]);
  attachBox(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("box")), "play", "control: two ready [D] pay for it");
});

clause(BOX, "0:attach", "needs [D][D]: one [D] plus plenty of other resources is one icon short; the opponent's [D] do not count", () => {
  const short = boxBoard([...bank("deception", 1, P1), ...bank("rage", 3, P1), ...bank("deception", 3, P2)]);
  refused(() => attachBox(short, "mine"), "one [D] only", THRESH);
  assert.equal(zoneOf(short.engine, short.id("box")), "hand");
  const ok = boxBoard([...bank("deception", 2, P1), ...bank("rage", 3, P1)]);
  attachBox(ok, "mine");
  assert.equal(zoneOf(ok.engine, ok.id("box")), "play", "control: two [D]");
});

clause(BOX, "0:attach", "ATTACH TO CHARACTER names no controller: it attaches to the opponent's character too, and I keep control of the item", () => {
  const b = boxBoard(bank("deception", 2, P1));
  attachBox(b, "foe");
  assert.equal(b.engine.state.cards[b.id("box")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("box")].controllerId, P1);
});

clause(BOX, "0:attach", "a host that is not a character in play is refused: item, location, faction, face-down card, character in hand or discard; none picked; two picked", () => {
  const b = boxBoard([...bank("deception", 4, P1), { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true }]);
  const attempt = (...hosts: string[]) => () => play(b.engine, P1, b.id("box"), { selected: { attachTo: hosts } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "their faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource");
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  refused(attempt(), "no host");
  refused(attempt(b.id("mine"), b.id("mine2")), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("box")), "hand");
  assert.equal(readyResources(b.engine, P1), 4, "nothing was paid");
  attempt(b.id("mine"))();
  assert.equal(zoneOf(b.engine, b.id("box")), "play", "control: a character works");
});

clause(BOX, "1:rule", "the attached character gains exactly 2 strength and loses exactly 2 speed; life and other characters are untouched", () => {
  const b = boxBoard(bank("deception", 2, P1));
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed"), stat(b.engine, b.id("mine"), "life")], [3, 5, 3]);
  attachBox(b, "mine");
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed"), stat(b.engine, b.id("mine"), "life")], [5, 3, 3]);
  assert.deepEqual([stat(b.engine, b.id("mine2"), "strength"), stat(b.engine, b.id("mine2"), "speed"), stat(b.engine, b.id("mine2"), "life")], [3, 5, 3], "other characters unchanged");
  assert.deepEqual([stat(b.engine, b.id("foe"), "strength"), stat(b.engine, b.id("foe"), "speed")], [4, 6]);
});

clause(BOX, "1:rule", "an attached opponent's character gains the 2 strength and loses the 2 speed (the item's controller does not matter)", () => {
  const b = boxBoard(bank("deception", 2, P1));
  attachBox(b, "foe");
  assert.deepEqual([stat(b.engine, b.id("foe"), "strength"), stat(b.engine, b.id("foe"), "speed"), stat(b.engine, b.id("foe"), "life")], [6, 4, 2]);
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed")], [3, 5]);
});

clause(BOX, "1:rule", "two Gory Trick Boxes on one character stack: +4 strength, -4 speed", () => {
  const c = buildGame({
    ...dev,
    cards: [
      { key: "mine", def: character({ name: "Mine", strength: 3, speed: 5, life: 3 }), owner: P1, zone: "play" },
      { key: "boxA", def: printing(BOX), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "boxB", def: printing(BOX), owner: P1, zone: "play", attachedToKey: "mine" }
    ]
  });
  assert.deepEqual([stat(c.engine, c.id("mine"), "strength"), stat(c.engine, c.id("mine"), "speed")], [7, 1]);
});

clause(BOX, "1:rule", "speed can't go below 0: a 1-speed host with the box has 0 speed and still gains the 2 strength", () => {
  const c = buildGame({
    ...dev,
    cards: [
      { key: "slow", def: character({ name: "Slow", strength: 1, speed: 1, life: 3 }), owner: P1, zone: "play" },
      { key: "boxA", def: printing(BOX), owner: P1, zone: "play", attachedToKey: "slow" }
    ]
  });
  assert.equal(stat(c.engine, c.id("slow"), "speed"), 0);
  assert.equal(stat(c.engine, c.id("slow"), "strength"), 3);
});

clause(BOX, "1:rule", "only while the item is in play: in hand it changes nothing, and once it is destroyed the host's stats return", () => {
  const b = boxBoard(bank("deception", 2, P1));
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed")], [3, 5], "in hand: no effect");
  attachBox(b, "mine");
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed")], [5, 3]);
  play(b.engine, P1, b.id("smash"), { selected: { t: [b.id("box")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("box")), "discard");
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed")], [3, 5], "back to printed");
});

clause(BOX, "1:rule", "the bonus is not temporary: it is still there after the turn ends (as long as the item stays)", () => {
  const b = boxBoard([...bank("deception", 2, P1), ...deckCards("a", 3, P1), ...deckCards("b", 3, P2)]);
  attachBox(b, "mine");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.deepEqual([stat(b.engine, b.id("mine"), "strength"), stat(b.engine, b.id("mine"), "speed")], [5, 3]);
});

// =============================================================================
// Gosche's Spynarium
// =============================================================================
const SPY = "7ff88674-b7ec-46d9-bf53-c38d83e641a9";
// When a character you control with a token on it leaves play, you may pick a character. If you do, that character gains COVERT this turn.
// EXPERIMENT -- COST: Deplete this card. Pay 2. Pick a character you control. -- EFFECT: Put a token on that character.

const bounce = () =>
  tactic({
    name: "Bounce",
    cost: 0,
    behavior: { abilities: [{ id: "b", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });

const HIDDEN: CardPlacement = { key: "hidden", def: character({ name: "Hidden" }), owner: P1, zone: "play", faceDown: true };
function spyBoard(extra: CardPlacement[] = [], opts: { spy?: "play" | "hand"; spyController?: Pid } = {}) {
  return buildGame({
    ...dev,
    cards: [
      { key: "spy", def: printing(SPY), owner: P1, zone: opts.spy ?? "play", ...(opts.spyController ? { controller: opts.spyController } : {}) },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounce(), owner: P1, zone: "hand" },
      ...deckCards("a", 4, P1),
      ...deckCards("b", 4, P2),
      ...extra
    ]
  });
}
const covert = (e: SpoilsEngine, c: CardInstanceId) => e.getKeywords(c).includes("covert");
const exp = (b: ReturnType<typeof spyBoard>, selected: Record<string, CardInstanceId[]>) => activate(b.engine, P1, b.id("spy"), "seed", { selected });

clause(SPY, "0:rule", "printed as a rogue location with 2 structure (cost 2, [D] checked below)", () => {
  const b = spyBoard();
  const d = b.engine.getDefinition(b.id("spy"));
  assert.equal(d.type, "location");
  assert.equal(d.trade, "rogue");
  assert.equal(stat(b.engine, b.id("spy"), "structure" as never), 2);
});

clause(SPY, "0:rule", "costs exactly 2: two ready resources deploy it and are all spent", () => {
  const b = spyBoard(bank("deception", 2, P1), { spy: "hand" });
  play(b.engine, P1, b.id("spy"));
  assert.equal(zoneOf(b.engine, b.id("spy")), "play");
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(SPY, "0:rule", "one short of the cost is refused even with the [D] threshold met by a spent [D]", () => {
  const short = spyBoard([...spentD(1), ...bank("rage", 1, P1)], { spy: "hand" });
  refused(() => play(short.engine, P1, short.id("spy")), "1 ready resource for cost 2", COSTS(2));
  assert.equal(zoneOf(short.engine, short.id("spy")), "hand");
  const ok = spyBoard([...spentD(1), ...bank("rage", 2, P1)], { spy: "hand" });
  play(ok.engine, P1, ok.id("spy"));
  assert.equal(zoneOf(ok.engine, ok.id("spy")), "play", "control");
});

clause(SPY, "0:rule", "needs [D]: five resources with no [D] are refused; the opponent's [D] do not count", () => {
  const short = spyBoard([...bank("rage", 5, P1), ...bank("deception", 3, P2)], { spy: "hand" });
  refused(() => play(short.engine, P1, short.id("spy")), "no [D]", THRESH);
  assert.equal(zoneOf(short.engine, short.id("spy")), "hand");
  const ok = spyBoard([...bank("rage", 1, P1), ...bank("deception", 1, P1)], { spy: "hand" });
  play(ok.engine, P1, ok.id("spy"));
  assert.equal(zoneOf(ok.engine, ok.id("spy")), "play", "control: one [D] is enough");
});

// --- the harvest trigger ---
clause(SPY, "0:rule", "a character I control with a token on it that is destroyed lets me pick any character: it gains COVERT this turn", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  assert.equal(covert(b.engine, b.id("mine")), false, "not before the pick");
  pick(b.engine, [b.id("mine")]);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(covert(b.engine, b.id("mine")), true, "the picked character gains COVERT");
  assert.equal(covert(b.engine, b.id("mine2")), false);
  assert.equal(covert(b.engine, b.id("foe")), false);
});

clause(SPY, "0:rule", "the picked character may be the opponent's", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  pick(b.engine, [b.id("foe")]);
  assert.equal(covert(b.engine, b.id("foe")), true);
  assert.equal(covert(b.engine, b.id("mine")), false);
});

clause(SPY, "0:rule", "'may': declining the pick gives COVERT to nobody and nothing stays pending", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  pick(b.engine, []);
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const k of ["mine", "mine2", "foe"]) assert.equal(covert(b.engine, b.id(k)), false, k);
});

clause(SPY, "0:rule", "the character that left play can't be the one picked, and only a character (not an item or face-down card) can be", () => {
  const b = spyBoard([HIDDEN, { key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  refused(() => answerWith(b.engine, P1, { kind: "chooserSelectsTarget", selected: [b.id("thing")] }), "an item");
  refused(() => answerWith(b.engine, P1, { kind: "chooserSelectsTarget", selected: [b.id("hidden")] }), "a face-down card");
  refused(() => answerWith(b.engine, P1, { kind: "chooserSelectsTarget", selected: [b.id("tok")] }), "the dead character");
  pick(b.engine, [b.id("mine2")]);
  assert.equal(covert(b.engine, b.id("mine2")), true, "control: a character in play is accepted");
});

clause(SPY, "0:rule", "leaving play any way counts: a token character bounced to my hand also lets me pick", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 3 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("tok")] } });
  assert.equal(zoneOf(b.engine, b.id("tok")), "hand");
  pick(b.engine, [b.id("mine")]);
  assert.equal(covert(b.engine, b.id("mine")), true);
});

clause(SPY, "0:rule", "a character without a token leaving play does not trigger it", () => {
  const b = spyBoard();
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(covert(b.engine, b.id("mine2")), false);
});

clause(SPY, "0:rule", "a counter that isn't a token doesn't count", () => {
  const b = spyBoard([{ key: "oth", def: character({ name: "Oth", life: 1 }), owner: P1, zone: "play", counters: { stamp: 2 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("oth")] } });
  assert.equal(zoneOf(b.engine, b.id("oth")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SPY, "0:rule", "only characters I control: the opponent's token character leaving play does not trigger it", () => {
  const b = spyBoard([{ key: "ftok", def: character({ name: "FTok", life: 1 }), owner: P2, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ftok")] } });
  assert.equal(zoneOf(b.engine, b.id("ftok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(covert(b.engine, b.id("mine")), false);
});

clause(SPY, "0:rule", "control, not ownership: a token character I own but the opponent controls does not trigger it", () => {
  const b = spyBoard([{ key: "stolen", def: character({ name: "Stolen", life: 1 }), owner: P1, zone: "play", controller: P2, counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("stolen")] } });
  assert.equal(zoneOf(b.engine, b.id("stolen")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(SPY, "0:rule", "a token character I took from the opponent does trigger it, and I am the one who picks", () => {
  const b = spyBoard([{ key: "taken", def: character({ name: "Taken", life: 1 }), owner: P2, zone: "play", controller: P1, counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("taken")] } });
  pick(b.engine, [b.id("mine")]);
  assert.equal(covert(b.engine, b.id("mine")), true);
});

clause(SPY, "0:rule", "it belongs to the Spynarium's controller: the opponent's Spynarium reacts to the opponent's token characters, not to mine", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }], { spyController: P2 });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined, "my token character is not the opponent's");
});

clause(SPY, "0:rule", "each token character that leaves play triggers it separately (two leaving = two picks)", () => {
  const b = spyBoard([
    { key: "t1", def: character({ name: "T1", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "t2", def: character({ name: "T2", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } },
    { key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" }
  ]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("t1")] } });
  pick(b.engine, [b.id("mine")]);
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("t2")] } });
  pick(b.engine, [b.id("mine2")]);
  assert.equal(covert(b.engine, b.id("mine")), true);
  assert.equal(covert(b.engine, b.id("mine2")), true);
});

clause(SPY, "0:rule", "COVERT lasts only this turn: gone after the turn ends", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }]);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  pick(b.engine, [b.id("mine")]);
  assert.equal(covert(b.engine, b.id("mine")), true);
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(covert(b.engine, b.id("mine")), false, "expired");
});

clause(SPY, "0:rule", "only while the Spynarium is in play: a token character leaving play with no Spynarium does nothing", () => {
  const b = spyBoard([{ key: "tok", def: character({ name: "Tok", life: 1 }), owner: P1, zone: "play", counters: { token: 1 } }], { spy: "hand" });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("tok")] } });
  assert.equal(zoneOf(b.engine, b.id("tok")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

// --- EXPERIMENT ---
clause(SPY, "1:ability:seed", "deplete this card, pay exactly 2, put exactly one token on the picked character I control", () => {
  const b = spyBoard(bank("rage", 3, P1));
  const before = readyResources(b.engine, P1);
  exp(b, { c: [b.id("mine")] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("spy")].depleted, true, "deplete this card");
  assert.equal(before - readyResources(b.engine, P1), 2, "exactly 2 paid");
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
  assert.equal(tokensOn(b.engine, b.id("mine2")), 0);
  assert.equal(tokensOn(b.engine, b.id("foe")), 0);
});

clause(SPY, "1:ability:seed", "exactly 2 resources is enough (all spent)", () => {
  const b = spyBoard(bank("rage", 2, P1));
  exp(b, { c: [b.id("mine")] });
  assert.equal(readyResources(b.engine, P1), 0);
  assert.equal(tokensOn(b.engine, b.id("mine")), 1);
});

clause(SPY, "1:ability:seed", "one resource is refused and nothing is depleted or placed", () => {
  const b = spyBoard(bank("rage", 1, P1));
  refused(() => exp(b, { c: [b.id("mine")] }), "pay 2 with 1 ready");
  assert.equal(b.engine.state.cards[b.id("spy")].depleted, false);
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
});

clause(SPY, "1:ability:seed", "can't be used while depleted (and the pay-2 is not spent)", () => {
  const b = spyBoard(bank("rage", 4, P1));
  b.engine.state.cards[b.id("spy")].depleted = true;
  const before = readyResources(b.engine, P1);
  refused(() => exp(b, { c: [b.id("mine")] }), "depleted");
  assert.equal(readyResources(b.engine, P1), before);
  assert.equal(tokensOn(b.engine, b.id("mine")), 0);
});

clause(SPY, "1:ability:seed", "the pick must be a character I control: the opponent's character, an item, a face-down card, the location and no pick are refused", () => {
  const b = spyBoard([...bank("rage", 6, P1), HIDDEN]);
  refused(() => exp(b, { c: [b.id("foe")] }), "opponent's character");
  refused(() => exp(b, { c: [b.id("thing")] }), "an item");
  refused(() => exp(b, { c: [b.id("hidden")] }), "a face-down card");
  refused(() => exp(b, { c: [b.id("spy")] }), "the location itself");
  refused(() => exp(b, { c: [] }), "no pick");
  refused(() => exp(b, { c: [b.id("mine"), b.id("mine2")] }), "two picks");
  assert.equal(b.engine.state.cards[b.id("spy")].depleted, false);
  assert.equal(readyResources(b.engine, P1), 7, "nothing paid (6 banks + the face-down resource)");
  exp(b, { c: [b.id("mine2")] });
  assert.equal(tokensOn(b.engine, b.id("mine2")), 1, "control");
});

clause(SPY, "1:ability:seed", "a character I own but the opponent controls can't be picked; one I took from the opponent can", () => {
  const b = spyBoard([
    ...bank("rage", 4, P1),
    { key: "stolen", def: character({ name: "Stolen" }), owner: P1, zone: "play", controller: P2 },
    { key: "taken", def: character({ name: "Taken" }), owner: P2, zone: "play", controller: P1 }
  ]);
  refused(() => exp(b, { c: [b.id("stolen")] }), "controlled by the opponent");
  exp(b, { c: [b.id("taken")] });
  assert.equal(tokensOn(b.engine, b.id("taken")), 1);
});

clause(SPY, "1:ability:seed", "tokens add up: a second use (after restoring) puts a second token on the same character", () => {
  const b = spyBoard(bank("rage", 4, P1));
  exp(b, { c: [b.id("mine")] });
  b.engine.state.cards[b.id("spy")].depleted = false;
  exp(b, { c: [b.id("mine")] });
  assert.equal(tokensOn(b.engine, b.id("mine")), 2);
});

clause(SPY, "1:ability:seed", "only the controller can use it: the opponent can't", () => {
  const b = spyBoard(bank("rage", 4, P2));
  b.engine.state.activePlayerId = P2;
  refused(() => activate(b.engine, P2, b.id("spy"), "seed", { selected: { c: [b.id("foe")] } }), "not their location");
  assert.equal(tokensOn(b.engine, b.id("foe")), 0);
});

clause(SPY, "1:ability:seed", "the token it places is what later triggers the harvest rule (EXPERIMENT then destroy = COVERT pick)", () => {
  const b = spyBoard(bank("rage", 2, P1));
  exp(b, { c: [b.id("mine")] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  pick(b.engine, [b.id("mine2")]);
  assert.equal(covert(b.engine, b.id("mine2")), true);
});

// =============================================================================
// Lost on Floor 3 (stub: the end-of-turn declaration machinery does not exist)
// =============================================================================
const LOF = "62ddcc7c-6229-43a5-b656-2c1fd2593b05";
// EXTRA COST: Play only on your turn, after you have declared the end of your turn. (...in response to your opponent paying a cost at end of your turn.)
// Terminate your end of turn declaration. Detach a resource from your faction.  FLIP UP: 2 [D][D][D]

function lofBoard(extra: CardPlacement[] = [], opts: { turn?: number; active?: Pid; zone?: "hand" | "play"; faceDown?: boolean } = {}) {
  return buildGame({
    ...dev,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "lof", def: printing(LOF), owner: P1, zone: opts.zone ?? "hand", ...(opts.faceDown ? { faceDown: true } : {}) },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...extra
    ]
  });
}

/** A free tactic for the opponent to answer the end-of-turn announcement with. */
const ping = (name = "Ping") => tactic({ name, cost: 0, behavior: { abilities: [{ id: "p", type: "activated", effects: [] }] } });
const attachedToFaction = (e: SpoilsEngine, p: Pid) => Object.values(e.state.cards).filter((c) => c.attachedTo === factionOf(e, p)).length;
const playNow = (e: SpoilsEngine, p: Pid, cardId: CardInstanceId) =>
  e.perform({ type: "playCard", playerId: p, cardId, selected: {}, variables: {} } as never);
/** P1 announces the end of the turn and P2 answers it with `ping`: P1 now has priority, responding to P2's card. */
const announceAndPing = (b: ReturnType<typeof lofBoard>) => {
  b.engine.perform({ type: "endTurn", playerId: P1 });
  playNow(b.engine, P2, b.id("ping"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "P1 may respond to P2's card");
};
/** Answers LoF's "detach a resource from your faction" with the first resource attached to P1's faction. */
const detachFirst = (e: SpoilsEngine) => (pc: { kind: string; [key: string]: unknown }) =>
  pc.kind === "chooserSelectsTarget"
    ? { kind: "chooserSelectsTarget", selected: Object.values(e.state.cards).filter((c) => c.attachedTo === factionOf(e, P1)).slice(0, 1).map((c) => c.id) }
    : declineAll(pc);
const PING = (): CardPlacement => ({ key: "ping", def: ping(), owner: P2, zone: "hand" });
const lofReady = (extra: CardPlacement[] = []) => lofBoard([...spentD(3), ...bank("deception", 2, P1), PING(), ...extra], { turn: 2, active: P1 });

clause(LOF, "0:extraCost", "printed as a rogue tactic, cost 2, [D][D][D]: deploying takes exactly 2 and three [D]", () => {
  const b = lofBoard();
  const d = b.engine.getDefinition(b.id("lof"));
  assert.equal(d.type, "tactic");
  assert.equal(d.trade, "rogue");
  const short = lofBoard([...spentD(3), ...bank("deception", 1, P1), PING()], { turn: 2, active: P1 });
  announceAndPing(short);
  assert.equal(short.engine.getCardPlayability(P1, short.id("lof")).playable, false, "cost 2 with one ready resource");
  const thr = lofBoard([...bank("deception", 2, P1), ...bank("rage", 3, P1), PING()], { turn: 2, active: P1 });
  announceAndPing(thr);
  assert.equal(thr.engine.getCardPlayability(P1, thr.id("lof")).playable, false, "only two [D]");
  const ok = lofReady();
  announceAndPing(ok);
  assert.equal(ok.engine.getCardPlayability(P1, ok.id("lof")).numericCost, 2, "printed cost 2");
  assert.equal(ok.engine.getCardPlayability(P1, ok.id("lof")).playable, true, "control: two ready resources and three [D]");
});

clause(LOF, "0:extraCost", "can't be played in my main phase, before I declare the end of my turn", () => {
  const b = lofReady();
  assert.equal(b.engine.getCardPlayability(P1, b.id("lof")).playable, false);
  refused(() => play(b.engine, P1, b.id("lof")), "my main phase is before declaring the end of the turn");
  assert.equal(zoneOf(b.engine, b.id("lof")), "hand");
});

clause(LOF, "0:extraCost", "can be played on my turn after I declared its end, in response to the opponent's card played then", () => {
  const b = lofReady();
  announceAndPing(b);
  assert.equal(b.engine.getCardPlayability(P1, b.id("lof")).playable, true);
  playNow(b.engine, P1, b.id("lof"));
  assert.equal(zoneOf(b.engine, b.id("lof")), "deploying", "on the stack above P2's card");
});

clause(LOF, "0:extraCost", "after declaring the end of my turn I can't play it unprompted: only the opponent responds to the announcement", () => {
  const b = lofReady();
  b.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority");
  refused(() => playNow(b.engine, P1, b.id("lof")), "no card of the opponent's to respond to", /priority/i);
});

clause(LOF, "0:extraCost", "only on MY turn: the opponent can't play their copy while answering my end-of-turn announcement", () => {
  const b = buildGame({
    ...dev,
    turn: 2,
    activePlayerId: P1,
    cards: [{ key: "lof", def: printing(LOF), owner: P2, zone: "hand" }, ...spentD(3, P2), ...bank("deception", 2, P2)]
  });
  b.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2);
  assert.equal(b.engine.getCardPlayability(P2, b.id("lof")).playable, false);
  refused(() => playNow(b.engine, P2, b.id("lof")), "it is P1's turn that is ending");
});

clause(LOF, "1:rule", "terminates my end-of-turn declaration: once the chain finishes my turn goes on, and I can end it later", () => {
  const b = lofReady();
  const turn = b.engine.state.turn;
  announceAndPing(b);
  playNow(b.engine, P1, b.id("lof"));
  resolvePendingResponses(b.engine);
  drain(b.engine, detachFirst(b.engine));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.responseWindow, undefined, "the chain finished");
  assert.equal(zoneOf(b.engine, b.id("ping")), "discard", "P2's card still resolved");
  assert.equal(b.engine.state.turn, turn, "the turn did not end");
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.getEndTurnBlock(P1), undefined, "I may announce the end of the turn again");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2, "the second announcement ends the turn");
});

clause(LOF, "1:rule", "control: without it, the turn ends once the opponent's response resolves", () => {
  const b = lofReady();
  const turn = b.engine.state.turn;
  announceAndPing(b);
  resolvePendingResponses(b.engine);
  const order = b.engine.state.turnOrder;
  const seatsToP2 = (order.indexOf(P2) - order.indexOf(P1) + order.length) % order.length; // 1 at the two-player table
  assert.equal(b.engine.state.turn, turn + seatsToP2);
  assert.equal(b.engine.state.activePlayerId, P2);
});

clause(LOF, "1:rule", "detaches a resource from my faction (net: it costs me 1 of the 2 I paid)", () => {
  const b = lofReady();
  const before = attachedToFaction(b.engine, P1);
  announceAndPing(b);
  playNow(b.engine, P1, b.id("lof"));
  resolvePendingResponses(b.engine);
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string } | undefined;
  assert.equal(pc?.kind, "chooserSelectsTarget", "I pick the resource to detach");
  assert.equal(pc?.playerId, P1);
  const spent = Object.values(b.engine.state.cards).find((c) => c.attachedTo === factionOf(b.engine, P1))!;
  answerWith(b.engine, P1, { kind: "chooserSelectsTarget", selected: [spent.id] });
  assert.equal(b.engine.state.cards[spent.id].attachedTo, undefined, "the picked resource is detached");
  assert.equal(attachedToFaction(b.engine, P1), before + 2 - 1, "2 paid, 1 detached");
});

const flipLof = (b: ReturnType<typeof lofBoard>, player: Pid = P1) => {
  flipUpNow(b.engine, { type: "flipUp", playerId: player, cardId: b.id("lof"), selected: {}, variables: {} });
  resolvePendingResponses(b.engine);
  drain(b.engine, detachFirst(b.engine));
};
const lofDown = (extra: CardPlacement[], opts: Parameters<typeof lofBoard>[1] = {}) =>
  lofBoard([...extra, PING()], { turn: 2, active: P1, ...opts, zone: "play", faceDown: true });

clause(LOF, "2:flipUp", "FLIP UP costs exactly 2: flipping it up with [D][D][D] and spare resources spends 2 and turns it face up (to the discard pile)", () => {
  const b = lofDown(bank("deception", 4, P1));
  announceAndPing(b);
  const before = readyResources(b.engine, P1);
  flipLof(b);
  assert.equal(zoneOf(b.engine, b.id("lof")), "discard");
  assert.equal(before - readyResources(b.engine, P1), 2 + 1 - 1, "2 paid, plus the face-down card itself stops being a resource, minus the 1 detached");
});

clause(LOF, "2:flipUp", "FLIP UP needs [D][D][D]: two [D] and plenty of other resources is refused and nothing is paid", () => {
  const short = lofDown([...bank("deception", 2, P1), ...bank("rage", 4, P1)]);
  announceAndPing(short);
  const before = readyResources(short.engine, P1);
  refused(() => flipLof(short), "only two [D]", THRESH);
  assert.equal(short.engine.state.cards[short.id("lof")].faceDown, true);
  assert.equal(readyResources(short.engine, P1), before);
  const ok = lofDown(bank("deception", 3, P1));
  announceAndPing(ok);
  flipLof(ok);
  assert.equal(zoneOf(ok.engine, ok.id("lof")), "discard", "control: three [D]");
});

clause(LOF, "2:flipUp", "one resource short of the cost 2 is refused even with the threshold met by spent [D]", () => {
  // The face-down card is itself a ready Volition resource (CR 507.4b: it may pay for its own FLIP UP), so one other ready resource is the least that works.
  const short = lofDown(spentD(3));
  announceAndPing(short);
  refused(() => flipLof(short), "only the face-down card itself is ready", /FLIP UP costs/);
  assert.equal(short.engine.state.cards[short.id("lof")].faceDown, true);
  const ok = lofDown([...spentD(3), ...bank("deception", 1, P1)]);
  announceAndPing(ok);
  flipLof(ok);
  assert.equal(zoneOf(ok.engine, ok.id("lof")), "discard", "control: one other ready resource + the card itself pays 2");
});

clause(LOF, "2:flipUp", "FLIP UP keeps the EXTRA COST timing: refused in my main phase and in the opponent's turn, open after I declare the end of my turn", () => {
  const main = lofDown(bank("deception", 4, P1));
  refused(() => flipLof(main), "my main phase, before declaring the end of the turn");
  assert.equal(main.engine.state.cards[main.id("lof")].faceDown, true);
  const theirs = lofDown(bank("deception", 4, P1), { active: P2 });
  declareAttackOpenWindow(theirs.engine, P2, [theirs.id("atk")]);
  refused(() => flipLof(theirs), "the opponent's turn");
  assert.equal(theirs.engine.state.cards[theirs.id("lof")].faceDown, true);
  const ok = lofDown(bank("deception", 4, P1));
  announceAndPing(ok);
  flipLof(ok);
  assert.equal(zoneOf(ok.engine, ok.id("lof")), "discard", "control: after declaring the end of my turn");
});

clause(LOF, "2:flipUp", "only my face-down copy: the opponent can't flip it up", () => {
  const b = lofDown([...bank("deception", 4, P1), ...bank("deception", 4, P2)]);
  announceAndPing(b);
  refused(() => flipLof(b, P2), "not their card");
  assert.equal(b.engine.state.cards[b.id("lof")].faceDown, true);
});

// =============================================================================
// Moment of Annihilation
// =============================================================================
const MOA = "c35705f0-9e26-4e6d-a682-0ff4d029166f";
// EXTRA COST: You may remove up to 3 non-character cards in an opponent's discard pile from the game. If you do, reduce this card's numeric cost by the number of cards removed. Pick a character.
// If the character has 4 life or less, destroy it.

const lifeBoost = (n: number) =>
  item({
    name: `Life Charm ${n}`,
    attachTo: "character",
    behavior: { abilities: [{ id: "lc", type: "continuous", modifiers: [{ type: "createModifier", target: "attachedTo", stat: "life", operation: "add", value: n, duration: { type: "whileSourceInPlay" } }] }] }
  } as never);

function moaBoard(resources: CardPlacement[], extra: CardPlacement[] = []) {
  return buildGame({
    ...dev,
    cards: [
      { key: "moa", def: printing(MOA), owner: P1, zone: "hand" },
      { key: "frail", def: character({ name: "Frail", life: 3 }), owner: P2, zone: "play" },
      { key: "four", def: character({ name: "Four", life: 4 }), owner: P2, zone: "play" },
      { key: "five", def: character({ name: "Five", life: 5 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", life: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", life: 1 }), owner: P2, zone: "play", faceDown: true },
      { key: "gone", def: character({ name: "Gone", life: 1 }), owner: P2, zone: "discard" },
      { key: "j0", def: item({ name: "Junk 0" }), owner: P2, zone: "discard" },
      { key: "j1", def: location({ name: "Junk 1" }), owner: P2, zone: "discard" },
      { key: "j2", def: tactic({ name: "Junk 2" }), owner: P2, zone: "discard" },
      { key: "j3", def: item({ name: "Junk 3" }), owner: P2, zone: "discard" },
      { key: "own", def: item({ name: "Own Junk" }), owner: P1, zone: "discard" },
      ...resources,
      ...extra
    ]
  });
}
const castMoa = (b: ReturnType<typeof moaBoard>, rm: string[], c: string) => play(b.engine, P1, b.id("moa"), { selected: { rm: rm.map((k) => b.id(k)), c: [b.id(c)] } });

clause(MOA, "0:extraCost", "printed as a rogue tactic: costs 5 with no cards removed (4 ready is refused, 5 works and spends all five)", () => {
  const probe = moaBoard([]);
  assert.equal(probe.engine.getDefinition(probe.id("moa")).type, "tactic");
  assert.equal(probe.engine.getDefinition(probe.id("moa")).trade, "rogue");
  const short = moaBoard(bank("deception", 4, P1));
  refused(() => castMoa(short, [], "frail"), "4 ready for cost 5", COSTS(5));
  assert.equal(zoneOf(short.engine, short.id("moa")), "hand");
  assert.equal(zoneOf(short.engine, short.id("frail")), "play");
  const ok = moaBoard(bank("deception", 5, P1));
  castMoa(ok, [], "frail");
  assert.equal(zoneOf(ok.engine, ok.id("moa")), "discard");
  assert.equal(readyResources(ok.engine, P1), 0, "all five paid");
});

clause(MOA, "0:extraCost", "needs [D][D]: one [D] with four other resources is refused, two [D] with three others works", () => {
  const short = moaBoard([...bank("deception", 1, P1), ...bank("rage", 4, P1)]);
  refused(() => castMoa(short, [], "frail"), "one [D]", THRESH);
  assert.equal(zoneOf(short.engine, short.id("moa")), "hand");
  const ok = moaBoard([...bank("deception", 2, P1), ...bank("rage", 3, P1)]);
  castMoa(ok, [], "frail");
  assert.equal(zoneOf(ok.engine, ok.id("moa")), "discard");
});

clause(MOA, "0:extraCost", "the threshold stays [D][D] when cost is reduced: with 3 cards removed (cost 2) one [D] and one other resource is still refused", () => {
  const short = moaBoard([...bank("deception", 1, P1), ...bank("rage", 1, P1)]);
  refused(() => castMoa(short, ["j0", "j1", "j2"], "frail"), "cost 2 but one [D]", THRESH);
  assert.equal(zoneOf(short.engine, short.id("j0")), "discard", "nothing removed when refused");
  const ok = moaBoard(bank("deception", 2, P1));
  castMoa(ok, ["j0", "j1", "j2"], "frail");
  assert.equal(zoneOf(ok.engine, ok.id("moa")), "discard");
});

for (const k of [1, 2, 3]) {
  const names = ["j0", "j1", "j2"].slice(0, k);
  clause(MOA, "0:extraCost", `removing ${k} non-character card${k > 1 ? "s" : ""} from the opponent's discard reduces the cost by ${k} (to ${5 - k}) and takes them out of the game`, () => {
    const b = moaBoard(bank("deception", 6, P1));
    castMoa(b, names, "frail");
    assert.equal(b.engine.state.pendingChoice, undefined);
    assert.equal(readyResources(b.engine, P1), 6 - (5 - k), `pays exactly ${5 - k} of 6`);
    for (const n of names) assert.equal(zoneOf(b.engine, b.id(n)), "removed", `${n} removed from the game`);
    for (const n of ["j0", "j1", "j2"].slice(k)) assert.equal(zoneOf(b.engine, b.id(n)), "discard", `${n} untouched`);
    assert.equal(zoneOf(b.engine, b.id("frail")), "discard");
  });
  clause(MOA, "0:extraCost", `removing ${k} card${k > 1 ? "s" : ""}: one resource short of the reduced cost ${5 - k} is refused and removes nothing`, () => {
    const b = moaBoard([...bank("deception", 4 - k, P1), ...(k === 3 ? spentD(1) : [])]);
    refused(() => castMoa(b, names, "frail"), `one short of ${5 - k}`, COSTS(5 - k));
    for (const n of names) assert.equal(zoneOf(b.engine, b.id(n)), "discard", `${n} not removed`);
    assert.equal(zoneOf(b.engine, b.id("moa")), "hand");
    assert.equal(zoneOf(b.engine, b.id("frail")), "play");
  });
}

clause(MOA, "0:extraCost", "'up to 3': removing 4 is refused", () => {
  const b = moaBoard(bank("deception", 6, P1));
  refused(() => castMoa(b, ["j0", "j1", "j2", "j3"], "frail"), "four cards");
  assert.equal(zoneOf(b.engine, b.id("moa")), "hand");
  assert.equal(zoneOf(b.engine, b.id("j3")), "discard");
});

clause(MOA, "0:extraCost", "only non-character cards of an opponent's discard pile: a character there, my own discard card, and a card in play are all refused", () => {
  const b = moaBoard(bank("deception", 6, P1));
  refused(() => castMoa(b, ["gone"], "frail"), "a character in their discard pile");
  refused(() => castMoa(b, ["own"], "frail"), "my own discard pile");
  refused(() => castMoa(b, ["thing"], "frail"), "an item in play");
  refused(() => castMoa(b, ["j0", "gone"], "frail"), "mixed with a character");
  assert.equal(zoneOf(b.engine, b.id("moa")), "hand");
  assert.equal(zoneOf(b.engine, b.id("j0")), "discard");
  assert.equal(zoneOf(b.engine, b.id("own")), "discard");
  castMoa(b, ["j0"], "frail");
  assert.equal(zoneOf(b.engine, b.id("j0")), "removed", "control: a legal card works");
});

clause(MOA, "0:extraCost", "'you may': removing none is allowed and costs the full 5", () => {
  const b = moaBoard(bank("deception", 5, P1));
  castMoa(b, [], "frail");
  for (const n of ["j0", "j1", "j2", "j3"]) assert.equal(zoneOf(b.engine, b.id(n)), "discard");
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard");
});

clause(MOA, "0:extraCost", "pick a character: an item, a location, the factions, a face-down card, a card in a discard pile or no pick are refused", () => {
  const b = moaBoard(bank("deception", 6, P1));
  for (const [k, why] of [["thing", "an item"], ["place", "a location"], ["hidden", "a face-down card"], ["gone", "a character in the discard pile"], ["moa", "the tactic itself"]] as const)
    refused(() => castMoa(b, [], k), why);
  refused(() => play(b.engine, P1, b.id("moa"), { selected: { rm: [], c: [factionOf(b.engine, P2)] } }), "the opponent's faction");
  refused(() => play(b.engine, P1, b.id("moa"), { selected: { rm: [], c: [] } }), "no character");
  assert.equal(zoneOf(b.engine, b.id("moa")), "hand");
  assert.equal(readyResources(b.engine, P1), 6, "nothing paid");
});

clause(MOA, "0:extraCost", "any character can be picked, mine included", () => {
  const b = moaBoard(bank("deception", 5, P1));
  castMoa(b, [], "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "my own 2-life character is destroyed");
});

clause(MOA, "1:rule", "a character with 4 life or less is destroyed: 3 life and exactly 4 life; others stay", () => {
  for (const k of ["frail", "four"]) {
    const b = moaBoard(bank("deception", 5, P1));
    castMoa(b, [], k);
    assert.equal(zoneOf(b.engine, b.id(k)), "discard", k);
    for (const other of ["frail", "four", "five", "mine"].filter((x) => x !== k)) assert.equal(zoneOf(b.engine, b.id(other)), "play", `${other} unaffected`);
  }
});

clause(MOA, "1:rule", "a character with 5 life is not destroyed (the tactic is still spent)", () => {
  const b = moaBoard(bank("deception", 5, P1));
  castMoa(b, [], "five");
  assert.equal(zoneOf(b.engine, b.id("five")), "play");
  assert.equal(zoneOf(b.engine, b.id("moa")), "discard");
  assert.equal(readyResources(b.engine, P1), 0);
});

clause(MOA, "1:rule", "the number is its life: a 6-life character with 3 damage survives (it has 6 life, not 3 left)", () => {
  const b = moaBoard(bank("deception", 5, P1), [{ key: "hurt", def: character({ name: "Hurt", life: 6 }), owner: P2, zone: "play", damage: 3 }]);
  castMoa(b, [], "hurt");
  assert.equal(zoneOf(b.engine, b.id("hurt")), "play");
});

clause(MOA, "1:rule", "current life counts: a 3-life character boosted to 5 life survives, one boosted to 4 life dies", () => {
  for (const [boost, dies] of [[2, false], [1, true]] as const) {
    const b = moaBoard(bank("deception", 5, P1), [
      { key: "boosted", def: character({ name: "Boosted", life: 3 }), owner: P2, zone: "play" },
      { key: "charm", def: lifeBoost(boost), owner: P2, zone: "play", attachedToKey: "boosted" }
    ]);
    assert.equal(stat(b.engine, b.id("boosted"), "life"), 3 + boost);
    castMoa(b, [], "boosted");
    assert.equal(zoneOf(b.engine, b.id("boosted")), dies ? "discard" : "play", `life ${3 + boost}`);
  }
});

// =============================================================================
// Noxious Gambler
// =============================================================================
const NG = "8897b622-be9d-46d0-bed9-288e6abcea49";
// When this card is restored, you may look at the top card of your deck. If you do, you may put that card on the bottom of your deck.

const restoreTactic = () =>
  tactic({
    name: "Restore It",
    cost: 0,
    behavior: { abilities: [{ id: "r", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "restore", target: { type: "selected", id: "t" } }] }] }
  });

function ngBoard(extra: CardPlacement[] = [], opts: { depleted?: boolean; owner?: Pid } = {}) {
  return buildGame({
    ...dev,
    cards: [
      { key: "ng", def: printing(NG), owner: opts.owner ?? P1, zone: "play", depleted: opts.depleted ?? true },
      { key: "other", def: character({ name: "Other" }), owner: P1, zone: "play", depleted: true },
      { key: "restore", def: restoreTactic(), owner: P1, zone: "hand" },
      ...deckCards("a", 4, P1),
      ...deckCards("b", 4, P2),
      ...extra
    ]
  });
}
const doRestore = (b: ReturnType<typeof ngBoard>, target: string) => {
  b.engine.perform({ type: "playCard", playerId: P1, cardId: b.id("restore"), selected: { t: [b.id(target)] } } as never);
  resolvePendingResponses(b.engine);
};

clause(NG, "0:rule", "printed as a rogue gambler character: 2 strength / 4 speed / 3 life, cost 4, [D]", () => {
  const b = ngBoard();
  const d = b.engine.getDefinition(b.id("ng"));
  assert.equal(d.type, "character");
  assert.equal(d.trade, "rogue");
  assert.deepEqual(d.subtype, ["gambler"]);
  assert.deepEqual([stat(b.engine, b.id("ng"), "strength"), stat(b.engine, b.id("ng"), "speed"), stat(b.engine, b.id("ng"), "life")], [2, 4, 3]);
});

clause(NG, "0:rule", "deploys for exactly 4: four ready resources work and are spent; one short is refused even with the [D] met by a spent one", () => {
  const ok = ngBoard(bank("deception", 4, P1), { depleted: false });
  ok.engine.state.cards[ok.id("ng")].zone = "hand";
  play(ok.engine, P1, ok.id("ng"));
  assert.equal(zoneOf(ok.engine, ok.id("ng")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
  const short = ngBoard([...spentD(1), ...bank("rage", 3, P1)], { depleted: false });
  short.engine.state.cards[short.id("ng")].zone = "hand";
  refused(() => play(short.engine, P1, short.id("ng")), "3 ready for cost 4", COSTS(4));
});

clause(NG, "0:rule", "needs [D]: four resources with no [D] are refused", () => {
  const short = ngBoard(bank("rage", 4, P1), { depleted: false });
  short.engine.state.cards[short.id("ng")].zone = "hand";
  refused(() => play(short.engine, P1, short.id("ng")), "no [D]", THRESH);
  assert.equal(zoneOf(short.engine, short.id("ng")), "hand");
  const ok = ngBoard([...bank("rage", 3, P1), ...bank("deception", 1, P1)], { depleted: false });
  ok.engine.state.cards[ok.id("ng")].zone = "hand";
  play(ok.engine, P1, ok.id("ng"));
  assert.equal(zoneOf(ok.engine, ok.id("ng")), "play", "control: one [D]");
});

clause(NG, "0:rule", "restored by an effect: I look at exactly the top card of my own deck, and keeping it leaves the deck unchanged", () => {
  const b = ngBoard();
  const before = deckOf(b.engine, P1);
  const oppBefore = deckOf(b.engine, P2);
  doRestore(b, "ng");
  assert.equal(b.engine.state.cards[b.id("ng")].depleted, false, "restored");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[]; to: string };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1, "its controller looks");
  assert.deepEqual(pc.cardIds, [before[0]], "exactly the top card");
  answerWith(b.engine, P1, { kind: "reorderDeck", order: [before[0]], bottom: [] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), before);
  assert.deepEqual(deckOf(b.engine, P2), oppBefore);
});

clause(NG, "0:rule", "'you may put that card on the bottom': choosing so moves just that card to the bottom, the rest keep their order", () => {
  const b = ngBoard();
  const before = deckOf(b.engine, P1);
  doRestore(b, "ng");
  answerWith(b.engine, P1, { kind: "reorderDeck", order: [], bottom: [before[0]] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), [...before.slice(1), before[0]]);
  assert.equal(zoneOf(b.engine, before[0]), "deck");
});

clause(NG, "0:rule", "a single-card deck: the look is harmless and the deck stays one card", () => {
  const b = buildGame({
    ...dev,
    cards: [
      { key: "ng", def: printing(NG), owner: P1, zone: "play", depleted: true },
      { key: "restore", def: restoreTactic(), owner: P1, zone: "hand" },
      ...deckCards("a", 1, P1)
    ]
  });
  const before = deckOf(b.engine, P1);
  doRestore(b, "ng");
  if (pending(b.engine)) answerWith(b.engine, P1, { kind: "reorderDeck", order: [], bottom: [before[0]] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(b.engine, P1), before);
});

clause(NG, "0:rule", "an empty deck: restoring does not soft-lock or ask anything", () => {
  const b = buildGame({
    ...dev,
    cards: [
      { key: "ng", def: printing(NG), owner: P1, zone: "play", depleted: true },
      { key: "restore", def: restoreTactic(), owner: P1, zone: "hand" }
    ]
  });
  doRestore(b, "ng");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ng")].depleted, false);
});

clause(NG, "0:rule", "only when THIS card is restored: another restored character does not trigger it", () => {
  const b = ngBoard();
  doRestore(b, "other");
  assert.equal(b.engine.state.cards[b.id("other")].depleted, false, "the other character was restored");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("ng")].depleted, true);
});

clause(NG, "0:rule", "the opponent's Gambler: its controller (the opponent) looks at THEIR deck, not mine", () => {
  const b = ngBoard([], { owner: P2 });
  const mine = deckOf(b.engine, P1);
  const theirs = deckOf(b.engine, P2);
  doRestore(b, "ng");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[] };
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P2);
  assert.deepEqual(pc.cardIds, [theirs[0]]);
  answerWith(b.engine, P2, { kind: "reorderDeck", order: [theirs[0]], bottom: [] });
  assert.deepEqual(deckOf(b.engine, P1), mine);
});

clause(NG, "0:rule", "restoring a Gambler that is not depleted does not trigger it (nothing is restored)", () => {
  const b = ngBoard([], { depleted: false });
  doRestore(b, "ng");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(NG, "0:rule", "the normal turn-start restoration of a depleted Gambler counts as 'restored': at my next turn start I look at my top card", () => {
  const b = ngBoard();
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(b.engine.state.cards[b.id("ng")].depleted, false, "restored at turn start");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; cardIds: string[] } | undefined;
  assert.ok(pc, "a look is offered");
  assert.equal(pc.kind, "reorderDeck");
  assert.equal(pc.playerId, P1);
  assert.equal(pc.cardIds.length, 1);
});

// =============================================================================
// Omahkapi'si Pi'kssii
// =============================================================================
const OM = "7a1759c9-392a-4655-94c7-8d9893904130";
// TACTICAL, UNIQUE OMAHKAPI'SI
// While there are at least 10 cards in an opponent's discard pile, that player cannot pick this card.
// FLEX -- COST: Pay 2. Pick a card in an opponent's discard pile. -- EFFECT: Remove that card from the game. If you do, this card gains 2 strength this turn.

function omBoard(extra: CardPlacement[] = [], opts: { op?: "play" | "hand"; turn?: number; active?: Pid; controller?: Pid } = {}) {
  return buildGame({
    ...dev,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "op", def: printing(OM), owner: opts.controller ?? P1, zone: opts.op ?? "play" },
      { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", life: 3 }), owner: P2, zone: "play" },
      { key: "kill1", def: killTactic({ name: "Kill P1" }), owner: P1, zone: "hand" },
      { key: "kill2", def: killTactic({ name: "Kill P2" }), owner: P2, zone: "hand" },
      ...deckCards("a", 4, P1),
      ...deckCards("b", 4, P2),
      ...extra
    ]
  });
}
const oppKill = (b: ReturnType<typeof omBoard>) => () => play(b.engine, P2, b.id("kill2"), { selected: { t: [b.id("op")] } });
const strOf = (b: ReturnType<typeof omBoard>) => stat(b.engine, b.id("op"), "strength");

clause(OM, "0:kw:TACTICAL", "has the TACTICAL keyword (a plain character does not)", () => {
  const b = omBoard();
  assert.ok(b.engine.getKeywords(b.id("op")).includes("tactical"), "b.engine.getKeywords(b.id(\"op\")).includes(\"tactical\")");
  assert.equal(b.engine.getKeywords(b.id("mine")).includes("tactical"), false);
});

clause(OM, "0:kw:TACTICAL", "it can be deployed from hand in the opponent's attack window for its printed cost 6 and [D][D][D][D][D]", () => {
  const b = omBoard(bank("deception", 6, P1), { op: "hand", turn: 2, active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  play(b.engine, P1, b.id("op"));
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
  assert.equal(readyResources(b.engine, P1), 0, "cost 6 paid");
});

clause(OM, "0:kw:TACTICAL", "an ordinary character can't be deployed in that window, nor can she be outside one on the opponent's turn", () => {
  const b = omBoard([...bank("deception", 6, P1), { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }], { op: "hand", turn: 2, active: P2 });
  refused(() => play(b.engine, P1, b.id("op")), "no window is open on the opponent's turn");
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => play(b.engine, P1, b.id("plain")), "a non-tactical character", /Only tactics or TACTICAL cards may be deployed as responses/);
  play(b.engine, P1, b.id("op"));
  assert.equal(zoneOf(b.engine, b.id("op")), "play", "control");
});

clause(OM, "0:kw:TACTICAL", "printed as a rogue omahkapi'si/seraphim/dragon, 4 strength / 5 speed / 5 life", () => {
  const b = omBoard();
  const d = b.engine.getDefinition(b.id("op"));
  assert.equal(d.type, "character");
  assert.equal(d.trade, "rogue");
  assert.deepEqual(d.subtype, ["omahkapi'si", "seraphim", "dragon"]);
  assert.deepEqual([strOf(b), stat(b.engine, b.id("op"), "speed"), stat(b.engine, b.id("op"), "life")], [4, 5, 5]);
});

clause(OM, "0:kw:TACTICAL", "deploy cost is exactly 6 (5 ready is refused even with the threshold met by spent [D]) and needs five [D]", () => {
  const short = omBoard([...spentD(5), ...bank("rage", 5, P1)], { op: "hand" });
  refused(() => play(short.engine, P1, short.id("op")), "5 ready for cost 6", COSTS(6));
  const ok = omBoard([...spentD(5), ...bank("rage", 6, P1)], { op: "hand" });
  play(ok.engine, P1, ok.id("op"));
  assert.equal(zoneOf(ok.engine, ok.id("op")), "play");
  assert.equal(readyResources(ok.engine, P1), 0);
  const icon = omBoard([...bank("deception", 4, P1), ...bank("rage", 4, P1)], { op: "hand" });
  refused(() => play(icon.engine, P1, icon.id("op")), "only four [D]", THRESH);
  assert.equal(zoneOf(icon.engine, icon.id("op")), "hand");
});

clause(OM, "0:unique", "a second Omahkapi'si under my control makes me choose which to keep; the other is destroyed", () => {
  const b = omBoard([...bank("deception", 6, P1), { key: "op2", def: printing(OM), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("op2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [b.id("op"), b.id("op2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("op2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("op")), "discard");
  assert.equal(zoneOf(b.engine, b.id("op2")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(OM, "0:unique", "keeping the old copy destroys the new one", () => {
  const b = omBoard([...bank("deception", 6, P1), { key: "op2", def: printing(OM), owner: P1, zone: "hand" }]);
  play(b.engine, P1, b.id("op2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("op") } } as never);
  assert.equal(zoneOf(b.engine, b.id("op2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
});

clause(OM, "0:unique", "per player: the opponent may control their own Omahkapi'si; control (not ownership) counts", () => {
  const b = omBoard([{ key: "op2", def: printing(OM), owner: P2, zone: "play" }, { key: "op3", def: printing(OM), owner: P1, zone: "play", controller: P2 }]);
  void b;
  const c = omBoard([{ key: "op2", def: printing(OM), owner: P2, zone: "play" }]);
  assert.equal(c.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(c.engine, c.id("op")), "play");
  assert.equal(zoneOf(c.engine, c.id("op2")), "play");
  const d = omBoard([{ key: "op3", def: printing(OM), owner: P1, zone: "play", controller: P2 }]);
  assert.equal(d.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(d.engine, d.id("op")), "play");
  assert.equal(zoneOf(d.engine, d.id("op3")), "play");
});

// --- the hide rule ---
const TURN2 = { turn: 2, active: P2 as Pid };

clause(OM, "1:rule", "with 9 cards in an opponent's discard pile the opponent can still pick her; with 10 they can't", () => {
  const nine = omBoard(discardCards("g", 9, P2), TURN2);
  oppKill(nine)();
  assert.equal(zoneOf(nine.engine, nine.id("op")), "discard", "9 cards: she can be picked (and destroyed)");
  const ten = omBoard(discardCards("g", 10, P2), TURN2);
  refused(oppKill(ten), "10 cards in their own discard pile");
  assert.equal(zoneOf(ten.engine, ten.id("op")), "play");
  assert.equal(zoneOf(ten.engine, ten.id("kill2")), "hand");
});

clause(OM, "1:rule", "all card types in the pile count toward 10 (items and tactics, not just characters)", () => {
  const b = omBoard([...discardCards("i", 5, P2, (i) => item({ name: `I${i}` })), ...discardCards("t", 5, P2, (i) => tactic({ name: `T${i}` }))], TURN2);
  refused(oppKill(b), "10 mixed cards");
  assert.equal(zoneOf(b.engine, b.id("op")), "play");
});

clause(OM, "1:rule", "only the pile of 'an opponent' counts: 10 cards in MY discard pile don't protect her", () => {
  const b = omBoard(discardCards("g", 10, P1), TURN2);
  oppKill(b)();
  assert.equal(zoneOf(b.engine, b.id("op")), "discard", "my own discard pile is irrelevant");
});

clause(OM, "1:rule", "'that player' is the one who can't pick: I can still pick my own Omahkapi'si while their pile has 10", () => {
  const b = omBoard(discardCards("g", 10, P2));
  play(b.engine, P1, b.id("kill1"), { selected: { t: [b.id("op")] } });
  assert.equal(zoneOf(b.engine, b.id("op")), "discard");
});

clause(OM, "1:rule", "it is relative to the controller: an Omahkapi'si the opponent controls can't be picked by me when MY discard pile has 10, but can be when only theirs does", () => {
  const mineFull = omBoard(discardCards("g", 10, P1), { controller: P2 });
  mineFull.engine.state.cards[mineFull.id("op")].controllerId = P2;
  refused(() => play(mineFull.engine, P1, mineFull.id("kill1"), { selected: { t: [mineFull.id("op")] } }), "my 10-card pile protects her from me");
  assert.equal(zoneOf(mineFull.engine, mineFull.id("op")), "play");
  const theirFull = omBoard(discardCards("g", 10, P2), { controller: P2 });
  theirFull.engine.state.cards[theirFull.id("op")].controllerId = P2;
  play(theirFull.engine, P1, theirFull.id("kill1"), { selected: { t: [theirFull.id("op")] } });
  assert.equal(zoneOf(theirFull.engine, theirFull.id("op")), "discard");
});

clause(OM, "1:rule", "it switches on and off with the count: dropping from 10 to 9 (FLEX removes one) lets the opponent pick her again", () => {
  const b = omBoard([...discardCards("g", 10, P2), ...bank("rage", 2, P1)], TURN2);
  refused(oppKill(b), "10 cards");
  b.engine.state.activePlayerId = P1;
  activate(b.engine, P1, b.id("op"), "flex", { selected: { c: [b.id("g0")] } });
  assert.equal(zoneOf(b.engine, b.id("g0")), "removed");
  b.engine.state.activePlayerId = P2;
  oppKill(b)();
  assert.equal(zoneOf(b.engine, b.id("op")), "discard", "9 cards: pickable");
});

// --- FLEX ---
const flexBoard = (extra: CardPlacement[] = []) =>
  omBoard(
    [
      ...bank("rage", 5, P1),
      { key: "jc", def: character({ name: "JC" }), owner: P2, zone: "discard" },
      { key: "ji", def: item({ name: "JI" }), owner: P2, zone: "discard" },
      { key: "ownd", def: item({ name: "OwnD" }), owner: P1, zone: "discard" },
      { key: "inplay", def: item({ name: "InPlay" }), owner: P2, zone: "play" },
      { key: "inhand", def: item({ name: "InHand" }), owner: P2, zone: "hand" },
      ...extra
    ]
  );
const flex = (b: ReturnType<typeof omBoard>, k: string) => activate(b.engine, P1, b.id("op"), "flex", { selected: { c: [b.id(k)] } });

clause(OM, "2:ability:flex", "pay exactly 2, remove the picked card in the opponent's discard from the game, and she gains exactly 2 strength this turn", () => {
  const b = flexBoard();
  const before = readyResources(b.engine, P1);
  flex(b, "ji");
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(before - readyResources(b.engine, P1), 2);
  assert.equal(zoneOf(b.engine, b.id("ji")), "removed");
  assert.equal(zoneOf(b.engine, b.id("jc")), "discard", "the other card is untouched");
  assert.equal(strOf(b), 6);
  assert.equal(b.engine.state.cards[b.id("op")].depleted, false, "no deplete in the cost");
});

clause(OM, "2:ability:flex", "any card type can be picked: a character in their discard pile works too", () => {
  const b = flexBoard();
  flex(b, "jc");
  assert.equal(zoneOf(b.engine, b.id("jc")), "removed");
  assert.equal(strOf(b), 6);
});

clause(OM, "2:ability:flex", "exactly 2 resources is enough; one is refused with nothing removed and no strength", () => {
  const ok = omBoard([...bank("rage", 2, P1), { key: "ji", def: item({ name: "JI" }), owner: P2, zone: "discard" }]);
  flex(ok, "ji");
  assert.equal(readyResources(ok.engine, P1), 0);
  assert.equal(strOf(ok), 6);
  const short = omBoard([...bank("rage", 1, P1), { key: "ji", def: item({ name: "JI" }), owner: P2, zone: "discard" }]);
  refused(() => flex(short, "ji"), "pay 2 with 1 ready");
  assert.equal(zoneOf(short.engine, short.id("ji")), "discard");
  assert.equal(strOf(short), 4);
});

clause(OM, "2:ability:flex", "the pick must be in an opponent's discard pile: my own discard card, a card in play and a card in hand are refused", () => {
  const b = flexBoard();
  refused(() => flex(b, "ownd"), "my own discard pile");
  refused(() => flex(b, "inplay"), "in play");
  refused(() => flex(b, "inhand"), "in hand");
  refused(() => activate(b.engine, P1, b.id("op"), "flex", { selected: { c: [] } }), "no pick");
  assert.equal(zoneOf(b.engine, b.id("ownd")), "discard");
  assert.equal(strOf(b), 4);
  assert.equal(readyResources(b.engine, P1), 5, "nothing paid");
});

clause(OM, "2:ability:flex", "uses stack: two activations give +4 strength this turn", () => {
  const b = flexBoard();
  flex(b, "jc");
  flex(b, "ji");
  assert.equal(strOf(b), 8);
  assert.equal(readyResources(b.engine, P1), 1);
});

clause(OM, "2:ability:flex", "the +2 strength lasts only this turn", () => {
  const b = flexBoard();
  flex(b, "ji");
  assert.equal(strOf(b), 6);
  endTurn(b.engine, P1);
  assert.equal(strOf(b), 4, "expired at end of turn");
});

clause(OM, "2:ability:flex", "the strength goes to this card only, not to my other characters", () => {
  const b = flexBoard();
  flex(b, "ji");
  assert.equal(stat(b.engine, b.id("mine"), "strength"), 1, "my other character is untouched");
});

clause(OM, "2:ability:flex", "only the controller can use it: the opponent can't", () => {
  const b = flexBoard();
  b.engine.state.activePlayerId = P2;
  refused(() => activate(b.engine, P2, b.id("op"), "flex", { selected: { c: [b.id("ownd")] } }), "not their card");
  assert.equal(strOf(b), 4);
});
