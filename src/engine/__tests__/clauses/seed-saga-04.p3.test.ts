import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  P1,
  P2
} from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow } from "./_battle.js";
import { fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn, developResource, readyCount, spentResources } from "./_turn.js";
import type { SpoilsEngine } from "../../../engine.js";

const FRAMPTLE = "d2ec9099-8296-4009-943d-d4645ba3ec92";
const LEGACY = "05cfbc47-195f-4da5-81d0-f6e7f1da6b15";
const RUINS = "18787e03-08d6-4264-a4b6-a31734b66ac3";
const COURT = "47bfebb7-3e70-4011-b960-9409a7d6dbfe";
const PALACE = "35670758-9d3b-4047-9948-16815d4e9181";

const greedSpent = (owner: typeof P1 | typeof P2, n: number): CardPlacement[] =>
  bank("greed", n, owner).map((p) => ({ ...p, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
const isDepleted = (engine: SpoilsEngine, cardId: string): boolean => Boolean(engine.state.cards[cardId].depleted);
const deckOf = (engine: SpoilsEngine, p: string): string[] => [...engine.state.players[p].deck];
const influenceOf = (engine: SpoilsEngine, p: string): number => engine.state.players[p].influence;

// ---------------------------------------------------------------------------
// Framptle Tromwibbler, Lord of Bling -- character, banker, cost 4 [G][G], mau, 3/3/3
// ---------------------------------------------------------------------------
const framptleBoard = (extra: CardPlacement[] = [], opts: { framptleZone?: "play" | "hand" | "discard"; counters?: Record<string, number>; controller?: typeof P1 | typeof P2; turn?: number; active?: typeof P1 | typeof P2 } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    random: () => 0.5,
    cards: [
      { key: "fr", def: printing(FRAMPTLE), owner: P1, zone: opts.framptleZone ?? "play", controller: opts.controller, counters: opts.counters },
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck"),
      ...extra
    ]
  });
const deployBoard = (resources: CardPlacement[]) =>
  buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "fr", def: printing(FRAMPTLE), owner: P1, zone: "hand" }, ...resources]
  });

clause(FRAMPTLE, "0:unique", "printed as a banker mau character, cost 4, threshold [G][G], 3 strength / 3 speed / 3 life", () => {
  const { engine, id } = framptleBoard();
  assert.deepEqual(engine.getCardTypes(id("fr")), ["character"]);
  assert.equal(engine.getStat(id("fr"), "strength"), 3);
  assert.equal(engine.getStat(id("fr"), "speed"), 3);
  assert.equal(engine.getStat(id("fr"), "life"), 3);
  const def = printing(FRAMPTLE);
  assert.equal(def.trade, "banker");
  assert.deepEqual(def.subtype, ["mau"]);
  assert.equal(def.cost, 4);
  assert.equal(def.threshold, "gg");
});

clause(FRAMPTLE, "0:unique", "deploys for exactly 4 with [G][G]; 3 resources are one short; 4 resources with only one [G] fall short of the threshold", () => {
  const ok = deployBoard(bank("greed", 4, P1));
  play(ok.engine, P1, ok.id("fr"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("fr")), "play");
  assert.equal(readyCount(ok.engine, P1), 0, "all 4 spent");
  const short = deployBoard(bank("greed", 3, P1));
  refused(() => play(short.engine, P1, short.id("fr")), "3 resources is one short of cost 4");
  assert.equal(zoneOf(short.engine, short.id("fr")), "hand");
  const oneIcon = deployBoard([...bank("greed", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("fr")), "only one [G] icon, threshold needs [G][G]");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("fr")), "hand");
  const noGreed = deployBoard(bank("rage", 6, P1));
  refused(() => play(noGreed.engine, P1, noGreed.id("fr")), "no [G] at all");
  const twoIcons = deployBoard([...bank("greed", 2, P1), ...bank("rage", 2, P1)]);
  play(twoIcons.engine, P1, twoIcons.id("fr"));
  drain(twoIcons.engine, declineAll);
  assert.equal(zoneOf(twoIcons.engine, twoIcons.id("fr")), "play", "exactly [G][G] meets the threshold");
});

clause(FRAMPTLE, "0:unique", "controlling a second Framptle makes the controller keep one: keeping the new one destroys the old one", () => {
  const { engine, id } = framptleBoard([{ key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]);
  play(engine, P1, id("fr2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [id("fr"), id("fr2")].sort());
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("fr2") } } as never);
  assert.equal(zoneOf(engine, id("fr2")), "play");
  assert.equal(zoneOf(engine, id("fr")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(FRAMPTLE, "0:unique", "keeping the old Framptle destroys the new one", () => {
  const { engine, id } = framptleBoard([{ key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" }, ...bank("greed", 5, P1)]);
  play(engine, P1, id("fr2"));
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: id("fr") } } as never);
  assert.equal(zoneOf(engine, id("fr")), "play");
  assert.equal(zoneOf(engine, id("fr2")), "discard");
});

clause(FRAMPTLE, "0:unique", "UNIQUE is per controller: the opponent can control their own Framptle at the same time without a survivor choice", () => {
  const { engine, id } = framptleBoard([{ key: "fr2", def: printing(FRAMPTLE), owner: P2, zone: "play" }]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("fr")), "play");
  assert.equal(zoneOf(engine, id("fr2")), "play");
});

clause(FRAMPTLE, "0:unique", "UNIQUE FRAMPTLE is a designation: any other card of designation FRAMPTLE conflicts with it, a card of another designation does not", () => {
  const same = framptleBoard([{ key: "x", def: character({ name: "Imposter", cost: 0, unique: "framptle" } as never), owner: P1, zone: "hand" }]);
  play(same.engine, P1, same.id("x"));
  const pc = pending(same.engine) as unknown as { kind: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor", "a different card with designation FRAMPTLE forces a survivor choice");
  assert.deepEqual([...pc.candidates].sort(), [same.id("fr"), same.id("x")].sort());
  const other = framptleBoard([{ key: "x", def: character({ name: "Imposter", cost: 0, unique: "somethingelse" } as never), owner: P1, zone: "hand" }]);
  play(other.engine, P1, other.id("x"));
  assert.equal(other.engine.state.pendingChoice, undefined, "a card of another designation does not conflict");
  assert.equal(zoneOf(other.engine, other.id("fr")), "play");
  assert.equal(zoneOf(other.engine, other.id("x")), "play");
});

clause(FRAMPTLE, "0:unique", "a Framptle in hand or discard does not conflict with the one in play", () => {
  const { engine, id } = framptleBoard([
    { key: "fr2", def: printing(FRAMPTLE), owner: P1, zone: "hand" },
    { key: "fr3", def: printing(FRAMPTLE), owner: P1, zone: "discard" }
  ]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("fr")), "play");
});

const attackBoard = (framptleZone: "play" | "hand" | "discard") =>
  framptleBoard(
    [
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" }
    ],
    { framptleZone }
  );

clause(FRAMPTLE, "1:rule", "characters cannot attack: my own other character, and Framptle itself, are refused", () => {
  const ctl = attackBoard("discard");
  declareAttackBy(ctl.engine, P1, [ctl.id("mine")]);
  assert.ok(ctl.engine.state.battle, "control: without Framptle in play the attack starts");
  const { engine, id } = attackBoard("play");
  refused(() => declareAttackBy(engine, P1, [id("mine")]), "my character can't attack under Framptle", /attack/i);
  assert.equal(engine.state.battle, undefined);
  refused(() => declareAttackBy(engine, P1, [id("fr")]), "Framptle can't attack either", /attack/i);
  assert.equal(engine.state.battle, undefined);
});

clause(FRAMPTLE, "1:rule", "characters cannot attack: the opponent's characters are refused too (even in their own turn)", () => {
  const ctl = framptleBoard(
    [{ key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" }],
    { framptleZone: "discard", active: P2, turn: 2 }
  );
  declareAttackBy(ctl.engine, P2, [ctl.id("foe")]);
  assert.ok(ctl.engine.state.battle, "control: without Framptle the opponent attack starts");
  const { engine, id } = framptleBoard(
    [{ key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" }],
    { active: P2, turn: 2 }
  );
  refused(() => declareAttackBy(engine, P2, [id("foe")]), "opponent character can't attack under Framptle", /attack/i);
  assert.equal(engine.state.battle, undefined);
});

clause(FRAMPTLE, "1:rule", "the attack ban follows Framptle: a character that arrives after Framptle is also banned, and it ends once Framptle is gone", () => {
  const { engine, id } = framptleBoard([{ key: "late", def: character({ name: "Late", strength: 1, life: 2 }), owner: P1, zone: "hand" }, ...bank("greed", 3, P1)]);
  play(engine, P1, id("late"));
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("late")), "play");
  refused(() => declareAttackBy(engine, P1, [id("late")]), "newly arrived character is banned", /attack/i);
  // Framptle leaves play
  engine.state.cards[id("fr")].counters = { token: 1 };
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "discard", "Framptle destroyed on its second token");
  declareAttackBy(engine, P1, [id("late")]);
  assert.ok(engine.state.battle, "with Framptle gone attacks are allowed again");
});

const restoreBoard = (framptleZone: "play" | "discard") =>
  framptleBoard(
    [
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play", depleted: true },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play", depleted: true },
      { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play", depleted: true },
      { key: "foeGear", def: item({ name: "FoeGear" }), owner: P2, zone: "play", depleted: true }
    ],
    { framptleZone }
  );

clause(FRAMPTLE, "1:rule", "characters cannot be restored: my depleted character stays depleted at the start of my turn while an item is restored", () => {
  const ctl = restoreBoard("discard");
  endTurn(ctl.engine, P1);
  endTurn(ctl.engine, P2);
  assert.equal(isDepleted(ctl.engine, ctl.id("mine")), false, "control: restored without Framptle");
  const { engine, id } = restoreBoard("play");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("mine")), true, "my character is not restored");
  assert.equal(isDepleted(engine, id("gear")), false, "only characters are affected: my item is restored");
});

clause(FRAMPTLE, "1:rule", "characters cannot be restored: the opponent's depleted character stays depleted at the start of their turn, their item is restored", () => {
  const ctl = restoreBoard("discard");
  endTurn(ctl.engine, P1);
  assert.equal(isDepleted(ctl.engine, ctl.id("foe")), false, "control: restored without Framptle");
  const { engine, id } = restoreBoard("play");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("foe")), true, "opponent character is not restored");
  assert.equal(isDepleted(engine, id("foeGear")), false, "opponent item is restored");
});

clause(FRAMPTLE, "1:rule", "Framptle itself, once depleted, cannot be restored", () => {
  const { engine, id } = framptleBoard();
  engine.state.cards[id("fr")].depleted = true;
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "play");
  assert.equal(isDepleted(engine, id("fr")), true);
});

clause(FRAMPTLE, "2:rule", "at the start of my turn a token goes on Framptle; not at the start of the opponent's turn", () => {
  const { engine, id } = framptleBoard();
  assert.equal(tokensOn(engine, id("fr")) ?? 0, 0);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(tokensOn(engine, id("fr")) ?? 0, 0, "no token at the opponent's turn start");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(tokensOn(engine, id("fr")), 1, "one token at my turn start");
  assert.equal(zoneOf(engine, id("fr")), "play", "one token does not destroy it");
});

clause(FRAMPTLE, "2:rule", "only the controller's turn start counts: a Framptle I own but the opponent controls ticks on THEIR turn start only", () => {
  const { engine, id } = framptleBoard([], { controller: P2 });
  endTurn(engine, P1);
  assert.equal(tokensOn(engine, id("fr")), 1, "controller P2's turn start puts a token");
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("fr")), 1, "owner P1's turn start puts nothing");
});

clause(FRAMPTLE, "2:rule", "exactly one token per turn start (not two)", () => {
  const { engine, id } = framptleBoard();
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(tokensOn(engine, id("fr")), 1);
});

clause(FRAMPTLE, "3:rule", "with 1 token already, the next turn-start token makes 2 and destroys it", () => {
  const { engine, id } = framptleBoard([], { counters: { token: 1 } });
  endTurn(engine, P1);
  assert.equal(zoneOf(engine, id("fr")), "play", "still in play at the opponent's turn start");
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "discard", "destroyed at 2 tokens");
});

clause(FRAMPTLE, "3:rule", "it takes two of my turn starts from nothing: stays through the first, destroyed on the second", () => {
  const { engine, id } = framptleBoard();
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "play");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "discard");
});

clause(FRAMPTLE, "3:rule", "starting above 2 tokens (3) it is still destroyed", () => {
  const { engine, id } = framptleBoard([], { counters: { token: 3 } });
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(zoneOf(engine, id("fr")), "discard");
});

clause(FRAMPTLE, "3:rule", "a token put on it by something other than its own trigger also destroys it at 2 tokens", () => {
  const adder = item({
    name: "Adder",
    behavior: {
      abilities: [
        {
          id: "add",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = framptleBoard([{ key: "adder", def: adder, owner: P1, zone: "play" }], { counters: { token: 1 } });
  activate(engine, P1, id("adder"), "add", { selected: { t: [id("fr")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("fr")), "discard", "2 tokens: destroy it");
});

clause(FRAMPTLE, "3:rule", "one token placed by something else does not destroy it", () => {
  const adder = item({
    name: "Adder",
    behavior: {
      abilities: [
        {
          id: "add",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "addCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = framptleBoard([{ key: "adder", def: adder, owner: P1, zone: "play" }]);
  activate(engine, P1, id("adder"), "add", { selected: { t: [id("fr")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("fr")), "play");
  assert.equal(tokensOn(engine, id("fr")), 1);
});

// ---------------------------------------------------------------------------
// Gideon's Legacy -- item, banker, cost 2 [G][G]
// ---------------------------------------------------------------------------
const legacyBoard = (extra: CardPlacement[] = [], opts: { inPlay?: boolean; greed?: number; depleted?: boolean; random?: () => number } = {}) =>
  buildGame({
    playerA: { faction: developFaction(), influence: 10 },
    playerB: { faction: developFaction(), influence: 10 },
    random: opts.random ?? (() => 0.5),
    cards: [
      { key: "g", def: printing(LEGACY), owner: P1, zone: opts.inPlay === false ? "hand" : "play", depleted: opts.depleted },
      ...bank("greed", opts.greed ?? 4, P1),
      ...fillers("d1", 5, P1, "deck"),
      ...extra
    ]
  });
const costed = (name: string, cost: number) => character({ name, cost });

clause(LEGACY, "0:ability:seek", "printed as a banker item, cost 2, threshold [G][G]: deploys with exactly 2 incl. [G][G]; one short or one icon short is refused", () => {
  const def = printing(LEGACY);
  assert.equal(def.type, "item");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 2);
  assert.equal(def.threshold, "gg");
  const mk = (res: CardPlacement[]) => buildGame({ playerA: { faction: developFaction() }, random: () => 0.5, cards: [{ key: "g", def: printing(LEGACY), owner: P1, zone: "hand" }, ...res] });
  const ok = mk(bank("greed", 2, P1));
  play(ok.engine, P1, ok.id("g"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("g")), "play");
  assert.equal(readyCount(ok.engine, P1), 0);
  const short = mk([...bank("greed", 1, P1), ...bank("greed", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))]); // threshold [G][G] met by a spent [G]
  refused(() => play(short.engine, P1, short.id("g")), "one ready resource short of cost 2 (threshold met by a spent [G])", /Costs cannot be paid/);
  const oneIcon = mk([...bank("greed", 1, P1), ...bank("rage", 3, P1)]);
  refused(() => play(oneIcon.engine, P1, oneIcon.id("g")), "only one [G]");
  assert.equal(zoneOf(oneIcon.engine, oneIcon.id("g")), "hand");
});

clause(LEGACY, "0:ability:seek", "SEEK: pays 2 resources, depletes the item and draws exactly one card", () => {
  const { engine, id } = legacyBoard([], { greed: 4 });
  const hand = engine.state.players[P1].hand.length;
  const deck = engine.state.players[P1].deck.length;
  const top = engine.state.players[P1].deck[0];
  activate(engine, P1, id("g"), "seek");
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, hand + 1, "exactly one card drawn");
  assert.equal(engine.state.players[P1].deck.length, deck - 1);
  assert.ok(engine.state.players[P1].hand.includes(top), "the top card was drawn");
  assert.equal(readyCount(engine, P1), 2, "paid exactly 2 of 4");
  assert.equal(isDepleted(engine, id("g")), true, "deplete cost");
});

clause(LEGACY, "0:ability:seek", "SEEK is refused with only 1 resource (one short), with exactly 2 it works", () => {
  const short = legacyBoard([], { greed: 1 });
  refused(() => activate(short.engine, P1, short.id("g"), "seek"), "cannot pay 2");
  assert.equal(short.engine.state.players[P1].hand.length, 0);
  assert.equal(isDepleted(short.engine, short.id("g")), false);
  const exact = legacyBoard([], { greed: 2 });
  activate(exact.engine, P1, exact.id("g"), "seek");
  drain(exact.engine, declineAll);
  assert.equal(exact.engine.state.players[P1].hand.length, 1);
  assert.equal(readyCount(exact.engine, P1), 0);
});

clause(LEGACY, "0:ability:seek", "SEEK is refused while the item is depleted (even with resources) and works again once restored", () => {
  const dep = legacyBoard([], { greed: 4, depleted: true });
  refused(() => activate(dep.engine, P1, dep.id("g"), "seek"), "depleted");
  assert.equal(dep.engine.state.players[P1].hand.length, 0);
  assert.equal(readyCount(dep.engine, P1), 4, "nothing was paid");
  const ok = legacyBoard([], { greed: 4, depleted: false });
  activate(ok.engine, P1, ok.id("g"), "seek");
  drain(ok.engine, declineAll);
  assert.equal(ok.engine.state.players[P1].hand.length, 1);
});

clause(LEGACY, "0:ability:seek", "SEEK draws for its controller, not the opponent", () => {
  const { engine, id } = legacyBoard([...fillers("d2", 4, P2, "deck")], { greed: 4 });
  activate(engine, P1, id("g"), "seek");
  drain(engine, declineAll);
  assert.equal(engine.state.players[P2].hand.length, 0);
  assert.equal(engine.state.players[P2].deck.length, 4);
});

const hideBoard = (extra: CardPlacement[], opts: { greed?: number; random?: () => number; depleted?: boolean } = {}) =>
  legacyBoard(
    [
      { key: "oc", def: costed("OppCard", 3), owner: P2, zone: "discard" },
      { key: "oc1", def: costed("OppCard1", 1), owner: P2, zone: "discard" },
      { key: "oc4", def: costed("OppCard4", 4), owner: P2, zone: "discard" },
      ...fillers("d2", 5, P2, "deck"),
      ...extra
    ],
    { greed: opts.greed ?? 0, random: opts.random, depleted: opts.depleted }
  );

clause(LEGACY, "1:ability:hide", "HIDE needs no resources and works while depleted: it destroys this card as the cost", () => {
  const { engine, id } = hideBoard([], { greed: 0, depleted: true });
  activate(engine, P1, id("g"), "hide", { selected: { card: [id("oc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("g")), "discard", "Legacy destroyed");
  assert.equal(zoneOf(engine, id("oc")), "deck", "the picked card left the discard pile");
});

clause(LEGACY, "1:ability:hide", "HIDE: the picked opponent discard card is shuffled into its owner's deck", () => {
  const { engine, id } = hideBoard([]);
  const before = deckOf(engine, P2).length;
  activate(engine, P1, id("g"), "hide", { selected: { card: [id("oc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("oc")), "deck");
  assert.ok(deckOf(engine, P2).includes(id("oc")), "in the owner's deck");
  assert.equal(deckOf(engine, P2).length, before + 1);
  assert.ok(!engine.state.players[P2].discard.includes(id("oc")), "!engine.state.players[P2].discard.includes(id(\"oc\"))");
  assert.equal(zoneOf(engine, id("oc1")), "discard", "the other discard cards stay");
  assert.equal(zoneOf(engine, id("oc4")), "discard");
});

clause(LEGACY, "1:ability:hide", "HIDE shuffles: across random sources the card does not always sit at the bottom (and every other deck card is still there)", () => {
  const positions = new Set<number>();
  for (const r of [0, 0.3, 0.6, 0.99]) {
    const { engine, id } = hideBoard([], { random: () => r });
    const others = deckOf(engine, P2);
    activate(engine, P1, id("g"), "hide", { selected: { card: [id("oc")] } });
    drain(engine, declineAll);
    const after = deckOf(engine, P2);
    assert.deepEqual([...after].sort(), [...others, id("oc")].sort(), "same cards plus the hidden one");
    positions.add(after.indexOf(id("oc")));
  }
  assert.ok(positions.size > 1 || !positions.has(5), "the hidden card is shuffled, not just appended");
});

clause(LEGACY, "1:ability:hide", "HIDE: X is the picked card's numeric cost, and every player other than the picked one gains X influence (cost 3, then 1, then 4)", () => {
  for (const [key, x] of [["oc", 3], ["oc1", 1], ["oc4", 4]] as const) {
    const { engine, id } = hideBoard([]);
    const mine = influenceOf(engine, P1);
    const theirs = influenceOf(engine, P2);
    activate(engine, P1, id("g"), "hide", { selected: { card: [id(key)] } });
    drain(engine, declineAll);
    // E9b (Q42): the picked player (the opponent, whose discard pile holds the card) is excluded; I gain X.
    assert.equal(influenceOf(engine, P1), mine + x, `my faction gains ${x}`);
    assert.equal(influenceOf(engine, P2), theirs, "the picked player's influence is unchanged");
  }
});

clause(LEGACY, "1:ability:hide", "reading 'each other player' relative to the picked player: picking the opponent's discard card gains influence for ME, not the opponent", () => {
  const { engine, id } = hideBoard([]);
  const mine = influenceOf(engine, P1);
  const theirs = influenceOf(engine, P2);
  activate(engine, P1, id("g"), "hide", { selected: { card: [id("oc")] } });
  drain(engine, declineAll);
  assert.equal(influenceOf(engine, P1), mine + 3, "each other player than the picked one (me) gains X");
  assert.equal(influenceOf(engine, P2), theirs, "the picked player gains nothing");
});

clause(LEGACY, "1:ability:hide", "Pick a player: the controller can pick THEMSELVES and a card in their own discard pile (it goes to their deck; the opponent gains X)", () => {
  const { engine, id } = hideBoard([{ key: "mc", def: costed("MyCard", 2), owner: P1, zone: "discard" }]);
  const theirs = influenceOf(engine, P2);
  activate(engine, P1, id("g"), "hide", { selected: { card: [id("mc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("mc")), "deck", "my own discard card shuffled into my deck");
  assert.equal(zoneOf(engine, id("g")), "discard", "Legacy destroyed");
  assert.equal(influenceOf(engine, P2), theirs + 2, "the opponent (other player) gains X = 2");
});

clause(LEGACY, "1:ability:hide", "only cards in a discard pile can be picked: an opponent's card in play, hand or deck is refused (positive control: discard card works)", () => {
  const extra: CardPlacement[] = [
    { key: "inPlay", def: costed("InPlay", 2), owner: P2, zone: "play" },
    { key: "inHand", def: costed("InHand", 2), owner: P2, zone: "hand" },
    { key: "inDeck", def: costed("InDeck", 2), owner: P2, zone: "deck" }
  ];
  for (const k of ["inPlay", "inHand", "inDeck"]) {
    const { engine, id } = hideBoard(extra);
    refused(() => activate(engine, P1, id("g"), "hide", { selected: { card: [id(k)] } }), `${k} is not in a discard pile`);
    assert.equal(zoneOf(engine, id("g")), "play", "the cost was not paid");
  }
  const { engine, id } = hideBoard(extra);
  activate(engine, P1, id("g"), "hide", { selected: { card: [id("oc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("g")), "discard");
});

clause(LEGACY, "1:ability:hide", "'Pick a card in that player's discard pile' is any card type: an item, a tactic and a location can be picked and shuffled into their owner's deck, X being the numeric cost", () => {
  const picks: Array<[string, CardPlacement["def"], number]> = [
    ["it", item({ name: "DiscItem", cost: 2 }), 2],
    ["ta", tactic({ name: "DiscTactic", cost: 3 }), 3],
    ["lo", location({ name: "DiscLoc", cost: 4 }), 4]
  ];
  for (const [key, def, x] of picks) {
    const { engine, id } = hideBoard([{ key, def, owner: P2, zone: "discard" }]);
    const mine = influenceOf(engine, P1);
    activate(engine, P1, id("g"), "hide", { selected: { card: [id(key)] } });
    drain(engine, declineAll);
    assert.equal(zoneOf(engine, id(key)), "deck", `${key} was shuffled into its owner's deck`);
    assert.ok(deckOf(engine, P2).includes(id(key)), `${key} is in the opponent's deck`);
    assert.equal(influenceOf(engine, P1), mine + x, `I gain its numeric cost ${x}`);
  }
});

clause(LEGACY, "1:ability:hide", "HIDE cannot be used without a pick (no card selected is refused and Legacy stays)", () => {
  const { engine, id } = hideBoard([]);
  refused(() => activate(engine, P1, id("g"), "hide", { selected: {} }), "needs a picked card");
  assert.equal(zoneOf(engine, id("g")), "play");
  assert.equal(influenceOf(engine, P2), 10);
});

clause(LEGACY, "1:ability:hide", "only the controller can use HIDE (the opponent cannot activate it)", () => {
  const { engine, id } = hideBoard([]);
  refused(() => activate(engine, P2, id("g"), "hide", { selected: { card: [id("oc")] } }), "not the controller");
  assert.equal(zoneOf(engine, id("g")), "play");
});

// ---------------------------------------------------------------------------
// Hidden Ruins -- tactic, banker, cost 1 [G]
// ---------------------------------------------------------------------------
const ruinsBoard = (extra: CardPlacement[] = [], opts: { ruinsZone?: "hand" | "discard" | "play" | "deck"; ruinsFaceDown?: boolean; greed?: number; turn?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: opts.turn,
    cards: [
      { key: "hr", def: printing(RUINS), owner: P1, zone: opts.ruinsZone ?? "hand", faceDown: opts.ruinsFaceDown },
      ...bank("greed", opts.greed ?? 3, P1),
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck"),
      ...extra
    ]
  });
const faceDownLoc = (key = "loc", owner: typeof P1 | typeof P2 = P1): CardPlacement => ({
  key,
  def: location({ name: `Loc ${key}`, cost: 2, structure: 3 }),
  owner,
  zone: "play",
  faceDown: true
});

clause(RUINS, "0:extraCost", "printed as a banker tactic, cost 1, threshold [G]: plays with exactly [G]+face-down location; refused with no [G]", () => {
  const def = printing(RUINS);
  assert.equal(def.type, "tactic");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 1);
  assert.equal(def.threshold, "g");
  const ok = ruinsBoard([faceDownLoc()], { greed: 1 });
  play(ok.engine, P1, ok.id("hr"), { selected: { loc: [ok.id("loc")] } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("hr")), "discard", "tactic resolved");
  const noIcon = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "hr", def: printing(RUINS), owner: P1, zone: "hand" }, faceDownLoc(), ...bank("rage", 3, P1)]
  });
  refused(() => play(noIcon.engine, P1, noIcon.id("hr"), { selected: { loc: [noIcon.id("loc")] } }), "no [G] icon");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("hr")), "hand");
  const noRes = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "hr", def: printing(RUINS), owner: P1, zone: "hand" }, { ...faceDownLoc(), faceDown: false }, ...spentResources(P1, 3), ...greedSpent(P1, 1)]
  });
  refused(() => play(noRes.engine, P1, noRes.id("hr"), { selected: { loc: [noRes.id("loc")] } }), "cost 1 cannot be paid (all resources spent)");
});

clause(RUINS, "0:extraCost", "the extra cost needs a face-down location I control: no location, a face-up location, or only the opponent's face-down location are all refused", () => {
  const none = ruinsBoard([]);
  refused(() => play(none.engine, P1, none.id("hr")), "no face-down location");
  assert.equal(zoneOf(none.engine, none.id("hr")), "hand");
  const faceUp = ruinsBoard([{ ...faceDownLoc(), faceDown: false }]);
  refused(() => play(faceUp.engine, P1, faceUp.id("hr"), { selected: { loc: [faceUp.id("loc")] } }), "face-up location");
  assert.equal(zoneOf(faceUp.engine, faceUp.id("hr")), "hand");
  const theirs = ruinsBoard([faceDownLoc("loc", P2)]);
  refused(() => play(theirs.engine, P1, theirs.id("hr"), { selected: { loc: [theirs.id("loc")] } }), "opponent's location");
  assert.equal(zoneOf(theirs.engine, theirs.id("hr")), "hand");
  const inHand = ruinsBoard([{ key: "loc", def: location({ name: "HandLoc", cost: 2, structure: 3 }), owner: P1, zone: "hand" }]);
  refused(() => play(inHand.engine, P1, inHand.id("hr"), { selected: { loc: [inHand.id("loc")] } }), "location in hand is not face-down in play");
  const ok = ruinsBoard([faceDownLoc()]);
  play(ok.engine, P1, ok.id("hr"), { selected: { loc: [ok.id("loc")] } });
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("hr")), "discard", "control: a face-down location of mine works");
});

clause(RUINS, "0:extraCost", "the extra cost needs a LOCATION: a face-down character or item is refused", () => {
  const ch = ruinsBoard([{ key: "loc", def: character({ name: "FdChar", cost: 2 }), owner: P1, zone: "play", faceDown: true }]);
  refused(() => play(ch.engine, P1, ch.id("hr"), { selected: { loc: [ch.id("loc")] } }), "face-down character is not a location");
  assert.equal(zoneOf(ch.engine, ch.id("hr")), "hand");
  const it = ruinsBoard([{ key: "loc", def: item({ name: "FdItem", cost: 2 }), owner: P1, zone: "play", faceDown: true }]);
  refused(() => play(it.engine, P1, it.id("hr"), { selected: { loc: [it.id("loc")] } }), "face-down item is not a location");
});

clause(RUINS, "1:rule", "draws exactly one card for its controller, and the tactic is discarded", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()]);
  const hand = engine.state.players[P1].hand.length;
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "tactic left hand, one card drawn");
  assert.equal(engine.state.players[P2].hand.length, 0, "opponent did not draw");
  assert.equal(zoneOf(engine, id("hr")), "discard");
});

const deployLoc = (cardId?: string) => (pc: { kind: string }) =>
  pc.kind === "deployForFree" ? ({ kind: "deployForFree", cardId } as never) : declineAll(pc as never);

clause(RUINS, "1:rule", "you may deploy the location: accepting leaves it face-up in play as a location (not a resource), and I still draw", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()]);
  const hand = engine.state.players[P1].hand.length;
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "deployForFree");
  assert.equal(pc.playerId, P1, "I decide");
  assert.deepEqual(pc.candidates, [id("loc")], "only the revealed location can be deployed");
  drain(engine, deployLoc(id("loc")));
  assert.equal(zoneOf(engine, id("loc")), "play");
  assert.equal(engine.state.cards[id("loc")].faceDown, false, "deployed face-up");
  assert.equal(engine.isResource(id("loc")), false, "no longer a resource");
  assert.deepEqual(engine.getCardTypes(id("loc")), ["location"]);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "Draw a card still happens");
});

clause(RUINS, "0:extraCost", "'Reveal a face-down location': the picked location is revealed (a cardsRevealed event naming exactly it), not the other face-down location", () => {
  const { engine, id } = ruinsBoard([faceDownLoc("loc"), faceDownLoc("loc2")]);
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  drain(engine, deployLoc(undefined));
  const shown = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);
  assert.deepEqual(shown, [id("loc")], "exactly the picked face-down location was revealed");
});

clause(RUINS, "1:rule", "you may deploy the location: declining leaves it face-down and I still draw a card", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()]);
  const hand = engine.state.players[P1].hand.length;
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  assert.equal((pending(engine) as unknown as { kind: string }).kind, "deployForFree", "the deploy is offered");
  drain(engine, deployLoc(undefined));
  assert.equal(engine.state.cards[id("loc")].faceDown, true, "declined: still a face-down resource");
  assert.equal(engine.isResource(id("loc")), true);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1, "still drew a card");
  assert.equal(zoneOf(engine, id("hr")), "discard");
});

clause(RUINS, "1:rule", "only the location named by the extra cost is offered: other face-down locations stay face-down", () => {
  const { engine, id } = ruinsBoard([faceDownLoc("loc"), faceDownLoc("loc2")]);
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  const pc = pending(engine) as unknown as { candidates: string[] };
  assert.deepEqual(pc.candidates, [id("loc")]);
  drain(engine, deployLoc(id("loc")));
  assert.equal(engine.state.cards[id("loc2")].faceDown, true);
});

clause(RUINS, "1:rule", "deploying the location pays its printed cost (2): 'deploy' is not 'deploy for free' (CR 604, 308.1)", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()], { greed: 4 });
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  const after1 = readyCount(engine, P1);
  drain(engine, deployLoc(id("loc")));
  assert.equal(engine.state.cards[id("loc")].faceDown, false);
  // the face-down location stops being a resource (-1), and its cost 2 is paid (-2)
  assert.equal(readyCount(engine, P1), after1 - 1 - 2, "cost 2 was paid for the deploy");
});

clause(RUINS, "1:rule", "deploying the location needs its threshold: a location needing [R] with no [R] cannot be deployed", () => {
  const { engine, id } = ruinsBoard([{ key: "loc", def: location({ name: "NeedsRage", cost: 0, threshold: "r", structure: 3 }), owner: P1, zone: "play", faceDown: true }], { greed: 4 });
  play(engine, P1, id("hr"), { selected: { loc: [id("loc")] } });
  // E3b: driven like Burly Assailment / Manifest. "You may deploy" is offered and the player may decline; accepting a location whose
  // threshold is unmet is refused, and the location stays where it is.
  const pc = pending(engine) as unknown as { kind: string; candidates?: string[] } | undefined;
  if (pc && pc.kind === "deployForFree" && pc.candidates?.includes(id("loc"))) {
    refused(
      () => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "deployForFree", cardId: id("loc") } } as never),
      "no [R]: the location cannot be deployed",
      /threshold/i
    );
  }
  drain(engine, deployLoc(undefined));
  assert.equal(engine.state.cards[id("loc")].faceDown, true);
  assert.equal(engine.isResource(id("loc")), true, "still a face-down resource");
});

const greedResource = () => resourceCard({ name: "GreedRes", resource: { provides: ["greed"], staple: true } });
const rageResource = () => resourceCard({ name: "RageRes", resource: { provides: ["rage"], staple: true } });
const putter = (zone: "hand") =>
  item({
    name: "Putter",
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone, controller: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
const recycleBoard = (extra: CardPlacement[], greed = 4) =>
  ruinsBoard([{ key: "put", def: putter("hand"), owner: P1, zone: "play" }, ...extra], { ruinsZone: "discard", greed });
const accept = (pay: boolean) => (pc: { kind: string }) => (pc.kind === "mayPay" ? ({ kind: "mayPay", pay } as never) : declineAll(pc as never));

clause(RUINS, "2:rule", "from the discard pile: when a greed resource enters play under my control, I may pay 2 to put it into play face-down as a resource", () => {
  const { engine, id } = recycleBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], 4);
  const before = readyCount(engine, P1);
  activate(engine, P1, id("put"), "put", { selected: { t: [id("gr")] } });
  drain(engine, accept(true));
  assert.equal(zoneOf(engine, id("hr")), "play");
  assert.equal(engine.state.cards[id("hr")].faceDown, true, "face-down");
  assert.equal(engine.state.cards[id("hr")].controllerId, P1, "under my control");
  assert.equal(engine.isResource(id("hr")), true, "as a resource");
  assert.equal(readyCount(engine, P1), before + 1 + 1 - 2, "+greed resource, +face-down Ruins, -2 paid");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(RUINS, "2:rule", "declining the payment leaves it in the discard pile and costs nothing", () => {
  const { engine, id } = recycleBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], 4);
  const before = readyCount(engine, P1);
  activate(engine, P1, id("put"), "put", { selected: { t: [id("gr")] } });
  drain(engine, accept(false));
  assert.equal(zoneOf(engine, id("hr")), "discard");
  assert.equal(readyCount(engine, P1), before + 1, "only the new greed resource");
});

clause(RUINS, "2:rule", "with no ready resources besides the entering greed one (only 1, need 2) it cannot be paid and stays in the discard pile", () => {
  const { engine, id } = recycleBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], 0);
  const pre = readyCount(engine, P1);
  assert.equal(pre, 0);
  activate(engine, P1, id("put"), "put", { selected: { t: [id("gr")] } });
  const pc = pending(engine) as unknown as { kind: string } | undefined;
  if (pc && pc.kind === "mayPay") {
    drain(engine, accept(true));
  }
  assert.equal(zoneOf(engine, id("hr")), "discard", "with no resources to pay 2 (only the entering one) it stays in the discard pile");
});

clause(RUINS, "2:rule", "with exactly 2 ready resources before the greed one enters it pays and ends with the Ruins face-down", () => {
  const { engine, id } = recycleBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], 2);
  activate(engine, P1, id("put"), "put", { selected: { t: [id("gr")] } });
  drain(engine, accept(true));
  assert.equal(zoneOf(engine, id("hr")), "play");
  assert.equal(engine.state.cards[id("hr")].faceDown, true);
});

clause(RUINS, "2:rule", "a non-greed card entering play does not trigger it (no prompt, stays in the discard pile)", () => {
  const { engine, id } = recycleBoard([{ key: "rr", def: rageResource(), owner: P1, zone: "hand" }], 4);
  activate(engine, P1, id("put"), "put", { selected: { t: [id("rr")] } });
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rr")), "play", "the rage resource entered play");
  assert.equal(zoneOf(engine, id("hr")), "discard");
});

clause(RUINS, "2:rule", "a greed resource entering under the OPPONENT's control does not trigger it (their own item puts it into play on their turn)", () => {
  const oppPutter = { key: "oput", def: putter("hand"), owner: P2, zone: "play" as const };
  const { engine, id } = ruinsBoard(
    [oppPutter, { key: "gr", def: greedResource(), owner: P2, zone: "hand" }, ...bank("greed", 3, P2)],
    { ruinsZone: "discard", greed: 4, turn: 2 }
  );
  engine.state.activePlayerId = P2;
  activate(engine, P2, id("oput"), "put", { selected: { t: [id("gr")] } });
  assert.equal(engine.state.cards[id("gr")].zone, "play");
  assert.ok(pending(engine)?.kind !== "mayPay", "no prompt for me");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hr")), "discard");
});

clause(RUINS, "2:rule", "a greed resource owned by the opponent that enters play under MY control does trigger it", () => {
  const steal = item({
    name: "Thief",
    behavior: {
      abilities: [
        {
          id: "give",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "opponent" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = ruinsBoard(
    [{ key: "thief", def: steal, owner: P1, zone: "play" }, { key: "gr", def: greedResource(), owner: P2, zone: "hand" }],
    { ruinsZone: "discard", greed: 4 }
  );
  activate(engine, P1, id("thief"), "give", { selected: { t: [id("gr")] } });
  assert.equal(engine.state.cards[id("gr")].controllerId, P1, "it entered under my control");
  drain(engine, accept(true));
  assert.equal(zoneOf(engine, id("hr")), "play");
  assert.equal(engine.state.cards[id("hr")].faceDown, true);
});

clause(RUINS, "2:rule", "only while in the discard pile: with the Ruins in my hand or deck, a greed resource entering does nothing to it", () => {
  for (const zone of ["hand", "deck"] as const) {
    const { engine, id } = ruinsBoard(
      [{ key: "put", def: putter("hand"), owner: P1, zone: "play" }, { key: "gr", def: greedResource(), owner: P1, zone: "hand" }],
      { ruinsZone: zone, greed: 4 }
    );
    activate(engine, P1, id("put"), "put", { selected: { t: [id("gr")] } });
    assert.equal(engine.state.pendingChoice, undefined, `no prompt from ${zone}`);
    resolvePendingResponses(engine);
    assert.equal(zoneOf(engine, id("hr")), zone);
  }
});

clause(RUINS, "2:rule", "developing a face-up greed resource card also triggers it, paying exactly 2", () => {
  const { engine, id } = ruinsBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], { ruinsZone: "discard", greed: 3 });
  developResource(engine, P1, id("gr"), false);
  const ready = readyCount(engine, P1);
  drain(engine, accept(true));
  assert.equal(zoneOf(engine, id("hr")), "play", "put into play");
  assert.equal(engine.state.cards[id("hr")].faceDown, true);
  assert.equal(readyCount(engine, P1), ready - 2 + 1, "paid 2, and the face-down Ruins is a new ready resource");
});

clause(RUINS, "2:rule", "developing a greed resource with only 1 other ready resource: the entering one makes exactly 2, enough to pay", () => {
  const { engine, id } = ruinsBoard([{ key: "gr", def: greedResource(), owner: P1, zone: "hand" }], { ruinsZone: "discard", greed: 1 });
  developResource(engine, P1, id("gr"), false);
  drain(engine, accept(true));
  assert.equal(zoneOf(engine, id("hr")), "play");
  assert.equal(readyCount(engine, P1), 1, "paid 2 of 2, plus the new face-down Ruins");
});

clause(RUINS, "2:rule", "developing a rage resource does not trigger it", () => {
  const { engine, id } = ruinsBoard([{ key: "rr", def: rageResource(), owner: P1, zone: "hand" }], { ruinsZone: "discard", greed: 3 });
  developResource(engine, P1, id("rr"), false);
  assert.ok(pending(engine)?.kind !== "mayPay", "pending(engine)?.kind !== \"mayPay\"");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("hr")), "discard");
});

clause(RUINS, "3:flipUp", "FLIP UP costs exactly 1 and needs [G]: a face-down Ruins with one ready [G] resource flips up and runs its effect", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()], { ruinsZone: "play", ruinsFaceDown: true, greed: 1 });
  const hand = engine.state.players[P1].hand.length;
  flipUpNow(engine, { type: "flipUp", playerId: P1, cardId: id("hr"), selected: { loc: [id("loc")] }, variables: {} });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("hr")), "discard", "the tactic resolved and was discarded");
  assert.equal(engine.state.players[P1].hand.length, hand + 1, "it drew a card");
});

const flipBoard = (opts: { icon: "greed" | "rage"; ready: number; locSpent?: boolean }) =>
  buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "hr", def: printing(RUINS), owner: P1, zone: "play", faceDown: true, ...(opts.ready === 0 ? { attachedToKey: "__factionA" } : {}) },
      { ...faceDownLoc(), ...(opts.ready === 0 ? { attachedToKey: "__factionA" } : {}) },
      ...(opts.ready === 0 ? greedSpent(P1, 2) : bank(opts.icon, opts.ready, P1)),
      ...fillers("d1", 3, P1, "deck")
    ]
  });
const flipRaw = (g: ReturnType<typeof flipBoard>) =>
  flipUpNow(g.engine, { type: "flipUp", playerId: P1, cardId: g.id("hr"), selected: { loc: [g.id("loc")] }, variables: {} });

clause(RUINS, "3:flipUp", "FLIP UP needs a [G] icon: rage resources alone are refused, the same board with greed flips up", () => {
  const bad = flipBoard({ icon: "rage", ready: 3 });
  refused(() => flipRaw(bad), "no [G]");
  assert.equal(bad.engine.state.cards[bad.id("hr")].faceDown, true);
  const good = flipBoard({ icon: "greed", ready: 3 });
  flipRaw(good);
  drain(good.engine, declineAll);
  assert.equal(zoneOf(good.engine, good.id("hr")), "discard");
});

clause(RUINS, "3:flipUp", "FLIP UP costs 1: refused when every resource is spent (the [G] is there), the same board with one ready greed flips up", () => {
  const bad = flipBoard({ icon: "greed", ready: 0 });
  refused(() => flipRaw(bad), "cost 1 cannot be paid");
  assert.equal(bad.engine.state.cards[bad.id("hr")].faceDown, true);
  assert.equal(zoneOf(bad.engine, bad.id("hr")), "play");
  const good = flipBoard({ icon: "greed", ready: 1 });
  flipRaw(good);
  drain(good.engine, declineAll);
  assert.equal(zoneOf(good.engine, good.id("hr")), "discard");
});

clause(RUINS, "3:flipUp", "FLIP UP threshold counts a spent [G] but the card's own face-down state gives none: spent [G] plus 1 ready rage pays and flips up", () => {
  const g = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "hr", def: printing(RUINS), owner: P1, zone: "play", faceDown: true },
      faceDownLoc(),
      ...greedSpent(P1, 1),
      ...bank("rage", 2, P1),
      ...fillers("d1", 3, P1, "deck")
    ]
  });
  flipRaw(g);
  drain(g.engine, declineAll);
  assert.equal(zoneOf(g.engine, g.id("hr")), "discard");
});

clause(RUINS, "3:flipUp", "FLIP UP pays only 1 (not the tactic's other costs): with 2 greed ready, 1 stays ready afterwards", () => {
  const { engine, id } = ruinsBoard([faceDownLoc()], { ruinsZone: "play", ruinsFaceDown: true, greed: 2 });
  const before = readyCount(engine, P1);
  flipUpNow(engine, { type: "flipUp", playerId: P1, cardId: id("hr"), selected: { loc: [id("loc")] }, variables: {} });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("hr")), "discard");
  // rule-neutral about which resource pays; Ruins itself stopped being a resource
  assert.ok(readyCount(engine, P1) === before - 1 - 1 || readyCount(engine, P1) === before - 1, `ready after flip: ${readyCount(engine, P1)} (before ${before})`);
});

// ---------------------------------------------------------------------------
// High Court of Demands -- location, banker, cost 3 [G], structure 1
// ---------------------------------------------------------------------------
const courtBoard = (opts: { courtZone?: "hand" | "play" | "discard"; courtOwner?: typeof P1 | typeof P2; active?: typeof P1 | typeof P2; turn?: number; greed?: number } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "court", def: printing(COURT), owner: opts.courtOwner ?? P1, zone: opts.courtZone ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3 }), owner: P2, zone: "play" },
      { key: "myLoc", def: location({ name: "MyLoc", structure: 3 }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 0, opts.courtOwner ?? P1),
      ...fillers("d1", 5, P1, "deck"),
      ...fillers("d2", 5, P2, "deck")
    ]
  });

clause(COURT, "0:rule", "printed as a banker location, cost 3, threshold [G], structure 1; deploys for exactly 3 with [G]; short/icon-short refused", () => {
  const def = printing(COURT);
  assert.equal(def.type, "location");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 3);
  assert.equal(def.threshold, "g");
  assert.equal(def.structure, 1);
  const ok = courtBoard({ courtZone: "hand", greed: 3 });
  assert.equal(ok.engine.getStat(ok.id("court"), "structure"), 1);
  play(ok.engine, P1, ok.id("court"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("court")), "play");
  assert.equal(readyCount(ok.engine, P1), 0);
  const short = courtBoard({ courtZone: "hand", greed: 2 });
  refused(() => play(short.engine, P1, short.id("court")), "one short of 3");
  const noIcon = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "court", def: printing(COURT), owner: P1, zone: "hand" }, ...bank("rage", 5, P1)]
  });
  refused(() => play(noIcon.engine, P1, noIcon.id("court")), "no [G]");
  const spentOne = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "court", def: printing(COURT), owner: P1, zone: "hand" }, ...bank("rage", 3, P1), ...greedSpent(P1, 1), ...fillers("d", 3, P1, "deck")]
  });
  play(spentOne.engine, P1, spentOne.id("court"));
  drain(spentOne.engine, declineAll);
  assert.equal(zoneOf(spentOne.engine, spentOne.id("court")), "play", "a spent [G] still counts toward the threshold");
});

clause(COURT, "0:rule", "when it enters play I draw a card (exactly one, and the opponent does not)", () => {
  const { engine, id } = courtBoard({ courtZone: "hand", greed: 3 });
  const hand = engine.state.players[P1].hand.length;
  const oppHand = engine.state.players[P2].hand.length;
  play(engine, P1, id("court"));
  drain(engine, declineAll);
  assert.equal(engine.state.players[P1].hand.length, hand - 1 + 1);
  assert.equal(engine.state.players[P2].hand.length, oppHand);
});

const lifter = (zone: "hand") =>
  item({
    name: "Lifter",
    behavior: {
      abilities: [
        {
          id: "lift",
          type: "activated",
          targets: [{ id: "t", selector: { zone, controller: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

clause(COURT, "0:rule", "the draw also happens when the Court is put into play by an effect, but another card entering play afterwards does not draw", () => {
  const withLift = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [
      { key: "court", def: printing(COURT), owner: P1, zone: "hand" },
      { key: "loc", def: location({ name: "Other", structure: 2 }), owner: P1, zone: "hand" },
      { key: "ch", def: character({ name: "Other Char" }), owner: P1, zone: "hand" },
      { key: "lift", def: lifter("hand"), owner: P1, zone: "play" },
      ...fillers("d1", 8, P1, "deck")
    ]
  });
  const { engine, id } = withLift;
  const hand0 = engine.state.players[P1].hand.length;
  activate(engine, P1, id("lift"), "lift", { selected: { t: [id("court")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(engine.state.players[P1].hand.length, hand0 - 1 + 1, "Court entering by effect: draws one");
  engine.state.cards[id("lift")].depleted = false;
  activate(engine, P1, id("lift"), "lift", { selected: { t: [id("loc")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("loc")), "play");
  assert.equal(engine.state.players[P1].hand.length, hand0 - 1 + 1 - 1, "another location entering with the Court in play: no draw");
  activate(engine, P1, id("lift"), "lift", { selected: { t: [id("ch")] } });
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("ch")), "play");
  assert.equal(engine.state.players[P1].hand.length, hand0 - 1 + 1 - 1 - 1, "a character entering: no draw");
});

clause(COURT, "1:rule", "my opponent cannot attack my faction while the Court is in play", () => {
  const ctl = courtBoard({ courtZone: "discard", active: P2, turn: 2 });
  declareAttackBy(ctl.engine, P2, [ctl.id("foe")]);
  assert.ok(ctl.engine.state.battle, "control: without the Court the opponent can attack my faction");
  const { engine, id } = courtBoard({ active: P2, turn: 2 });
  refused(() => declareAttackBy(engine, P2, [id("foe")]), "faction is protected", /faction|attack/i);
  assert.equal(engine.state.battle, undefined);
});

clause(COURT, "1:rule", "the protection is only for my faction: the opponent can still attack my location", () => {
  const { engine, id } = courtBoard({ active: P2, turn: 2 });
  declareAttackBy(engine, P2, [id("foe")], { type: "card", cardId: id("myLoc") });
  assert.ok(engine.state.battle, "attack on my location is allowed");
});

clause(COURT, "1:rule", "I can still attack the opponent's faction while my own Court is in play", () => {
  const { engine, id } = courtBoard();
  declareAttackBy(engine, P1, [id("mine")]);
  assert.ok(engine.state.battle, "I can attack the opponent's faction");
});

clause(COURT, "1:rule", "the Court protects its controller's faction: with the Court controlled by the opponent, I cannot attack their faction", () => {
  const { engine, id } = courtBoard({ courtOwner: P2 });
  refused(() => declareAttackBy(engine, P1, [id("mine")]), "opponent's faction is protected by their Court", /faction|attack/i);
  assert.equal(engine.state.battle, undefined);
});

clause(COURT, "1:rule", "the protection only applies while the Court is in play: in hand it does nothing", () => {
  const { engine, id } = courtBoard({ courtZone: "hand", active: P2, turn: 2 });
  declareAttackBy(engine, P2, [id("foe")]);
  assert.ok(engine.state.battle, "engine.state.battle");
});

// ---------------------------------------------------------------------------
// Imperial Palace -- location, banker, cost 0 [G], structure 2
// ---------------------------------------------------------------------------
const palaceBoard = (extra: CardPlacement[] = [], opts: { greed?: number; palaceZone?: "play" | "hand" } = {}) =>
  buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "pal", def: printing(PALACE), owner: P1, zone: opts.palaceZone ?? "play" },
      { key: "c", def: character({ name: "C", strength: 2, life: 4 }), owner: P1, zone: "play" },
      { key: "c2", def: character({ name: "C2", strength: 1, life: 2 }), owner: P1, zone: "play" },
      ...bank("greed", opts.greed ?? 3, P1),
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck"),
      ...extra
    ]
  });
const palaceAnswers = (pay: boolean, pick: string[]) => (pc: { kind: string }) => {
  const who = (pc as unknown as { playerId: string }).playerId;
  if (pc.kind === "mayPay") {
    assert.equal(who, P1, "I decide whether to pay");
    return { kind: "mayPay", pay } as never;
  }
  if (pc.kind === "chooserSelectsTarget") {
    assert.equal(who, P1, "I pick the character");
    return { kind: "chooserSelectsTarget", selected: pick } as never;
  }
  return declineAll(pc as never);
};

clause(PALACE, "0:rule", "printed as a banker location, cost 0, threshold [G], structure 2: deploys for nothing with a [G] icon, refused without", () => {
  const def = printing(PALACE);
  assert.equal(def.type, "location");
  assert.equal(def.trade, "banker");
  assert.equal(def.cost, 0);
  assert.equal(def.threshold, "g");
  assert.equal(def.structure, 2);
  const ok = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "pal", def: printing(PALACE), owner: P1, zone: "hand" }, ...greedSpent(P1, 1), ...bank("rage", 2, P1)]
  });
  assert.equal(ok.engine.getStat(ok.id("pal"), "structure"), 2);
  const ready = readyCount(ok.engine, P1);
  play(ok.engine, P1, ok.id("pal"));
  drain(ok.engine, declineAll);
  assert.equal(zoneOf(ok.engine, ok.id("pal")), "play", "a spent [G] meets the threshold at cost 0");
  assert.equal(readyCount(ok.engine, P1), ready, "costs nothing");
  const none = buildGame({
    playerA: { faction: developFaction() },
    random: () => 0.5,
    cards: [{ key: "pal", def: printing(PALACE), owner: P1, zone: "hand" }, ...bank("rage", 4, P1)]
  });
  refused(() => play(none.engine, P1, none.id("pal")), "no [G]");
  assert.equal(zoneOf(none.engine, none.id("pal")), "hand");
});

clause(PALACE, "0:rule", "end of my turn, paying 1: the picked character goes into the void and exactly 1 resource is spent", () => {
  const { engine, id } = palaceBoard();
  const before = readyCount(engine, P1);
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  assert.equal(zoneOf(engine, id("c")), "void");
  assert.equal(zoneOf(engine, id("c2")), "play", "only the picked character is voided");
  assert.equal(readyCount(engine, P1), before - 1, "paid exactly 1");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(PALACE, "0:rule", "I may decline to pay: nothing is voided and nothing is spent", () => {
  const { engine, id } = palaceBoard();
  const before = readyCount(engine, P1);
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(false, [id("c")]));
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(readyCount(engine, P1), before);
});

clause(PALACE, "0:rule", "with no resource to pay 1 the character is not voided", () => {
  const { engine, id } = palaceBoard([], { greed: 0 });
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  assert.equal(zoneOf(engine, id("c")), "play");
});

clause(PALACE, "0:rule", "only a character I control can be picked: the opponent's character and my item are refused", () => {
  const extra: CardPlacement[] = [
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "gear", def: item({ name: "Gear" }), owner: P1, zone: "play" }
  ];
  for (const k of ["foe", "gear"]) {
    const { engine, id } = palaceBoard(extra);
    engine.perform({ type: "endTurn", playerId: P1 });
    try {
      drain(engine, palaceAnswers(true, [id(k)]));
    } catch {
      /* refusal is fine */
    }
    assert.equal(zoneOf(engine, id(k)), "play", `${k} was not voided`);
  }
  const { engine, id } = palaceBoard(extra);
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  assert.equal(zoneOf(engine, id("c")), "void", "control: my character works");
});

clause(PALACE, "0:rule", "a character I control but the opponent owns can be voided", () => {
  const { engine, id } = palaceBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("stolen")]));
  assert.equal(zoneOf(engine, id("stolen")), "void");
});

clause(PALACE, "0:rule", "it triggers at the end of MY turn only: nothing at the end of the opponent's turn", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    random: () => 0.5,
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "pal", def: printing(PALACE), owner: P1, zone: "play" },
      { key: "c", def: character({ name: "C" }), owner: P1, zone: "play" },
      ...bank("greed", 3, P1),
      ...fillers("d1", 6, P1, "deck"),
      ...fillers("d2", 6, P2, "deck")
    ]
  });
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(pending(engine)?.kind === "mayPay", false, "no Palace prompt at the opponent's turn end");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c")), "play");
});

clause(PALACE, "0:rule", "the voided character returns at the start of MY next turn, not at the opponent's turn start", () => {
  const { engine, id } = palaceBoard();
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(zoneOf(engine, id("c")), "void", "still voided during the opponent's turn");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c")), "play", "back at the start of my next turn");
  assert.equal(engine.state.cards[id("c")].controllerId, P1, "under my control");
});

clause(PALACE, "0:rule", "the returning character is a fresh object: its damage is gone", () => {
  const { engine, id } = palaceBoard();
  engine.state.cards[id("c")].damage = 2;
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(engine.state.cards[id("c")].damage ?? 0, 0);
});

clause(PALACE, "0:rule", "it comes back under MY control even when the opponent owns it", () => {
  const { engine, id } = palaceBoard([{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, zone: "play", controller: P1 }]);
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("stolen")]));
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("stolen")), "play");
  assert.equal(engine.state.cards[id("stolen")].controllerId, P1);
});

clause(PALACE, "0:rule", "the return still happens if the Palace left play in the meantime", () => {
  const { engine, id } = palaceBoard();
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  engine.state.cards[id("pal")].zone = "discard";
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c")), "play");
});

clause(PALACE, "0:rule", "the voided character returns exactly once and is not voided again when I decline the next end-of-turn payment", () => {
  const { engine, id } = palaceBoard();
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(true, [id("c")]));
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c")), "play");
  engine.perform({ type: "endTurn", playerId: P1 });
  drain(engine, palaceAnswers(false, []));
  endTurn(engine, P2);
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("c")), "play");
  const copies = Object.values(engine.state.cards).filter((c) => c.ownerId === P1 && c.zone === "play" && engine.getDefinition(c.id).name === "C");
  assert.equal(copies.length, 1, "no duplicate");
});

clause(PALACE, "0:rule", "after paying, the character pick is mandatory: an empty selection is refused and no character is voided", () => {
  const { engine, id } = palaceBoard();
  engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(engine); // the end-of-turn trigger fires when the turn actually ends (CR 610.1a)
  const pc = pending(engine) as unknown as { kind: string };
  assert.equal(pc.kind, "mayPay");
  engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "mayPay", pay: true } } as never);
  const pick = pending(engine) as unknown as { kind: string; playerId: string; candidates?: string[] };
  assert.equal(pick.kind, "chooserSelectsTarget");
  assert.equal(pick.playerId, P1, "I pick");
  refused(() => engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [] } } as never), "must pick a character after paying");
  assert.equal(zoneOf(engine, id("c")), "play");
  assert.equal(zoneOf(engine, id("c2")), "play");
});
