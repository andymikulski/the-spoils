// Batch ungodly-mess-07, part p1 (groups 1-3: Ezekial Cutpurse, Feckless Chronicler, God's Blessing of Transfiguration).
// Every test is written from the PRINTED text of the printing under test.

import assert from "node:assert/strict";
import type { CardDefinition, CardInstanceId, SpoilsEngine } from "../../../engine.js";
import { buildGame, activate, bank, character, developFaction, item, killTactic, location, P1, P2, play, resolvePendingResponses, tactic } from "../per-card/_harness.js";
import type { CardPlacement } from "../support/fixtures.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle } from "./_battle.js";
import { declareBlockers, fillers, pending, tokensOn, zoneOf } from "./_board.js";
import { endTurn } from "./_turn.js";

type Pid = typeof P1 | typeof P2;

const controllerOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].controllerId;
const attachedToOf = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].attachedTo;
const isDepleted = (engine: SpoilsEngine, c: CardInstanceId) => engine.state.cards[c].depleted === true;
const stat = (engine: SpoilsEngine, c: CardInstanceId, s: "strength" | "life" | "speed") => engine.getStat(c, s);
const triple = (engine: SpoilsEngine, c: CardInstanceId) => [stat(engine, c, "strength"), stat(engine, c, "life"), stat(engine, c, "speed")];

/** `n` deception resources of `owner` that are already spent (attached to the faction): they count for thresholds but cannot pay. */
const spentD = (n: number, owner: Pid = P1): CardPlacement[] =>
  bank("deception", n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

const WIN = () => 0.1;
const LOSE = () => 0.9;

const coinFlips = (engine: SpoilsEngine): boolean[] =>
  engine
    .getLog()
    .filter((entry) => entry.event?.type === "coinFlipped")
    .map((entry) => (entry.event as unknown as { won: boolean }).won);

// =================================================================================
// Ezekial Cutpurse -- rogue thief character, cost 3, [D][D][D], 3 str / 3 spd / 3 life
// UNIQUE; my characters of numeric cost <= 2 get +1 strength; >= 4 get +1 speed; YOINK!
// =================================================================================

const EZ = "bb310adf-2e87-42f3-b752-b5025edc8605";

const gearDef = (name: string): CardDefinition =>
  item({
    name,
    subtype: ["gear"],
    attachTo: "character",
    behavior: { abilities: [{ id: "boost", type: "continuous", modifiers: [{ target: "attachedTo", stat: "strength", operation: "add", value: 2 }] }] }
  } as Partial<CardDefinition>);

const plain = (name: string, cost: number | undefined) => character({ name, cost, strength: 2, life: 5, speed: 2 });

function ezBoard(opts: { zone?: "play" | "hand"; controller?: Pid; depleted?: boolean; extra?: CardPlacement[]; resources?: CardPlacement[] } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "ez", def: printing(EZ), owner: P1, zone: opts.zone ?? "play", controller: opts.controller, depleted: opts.depleted },
      { key: "c0", def: plain("C0", 0), owner: P1, zone: "play" },
      { key: "c1", def: plain("C1", 1), owner: P1, zone: "play" },
      { key: "c2", def: plain("C2", 2), owner: P1, zone: "play" },
      { key: "c3", def: plain("C3", 3), owner: P1, zone: "play" },
      { key: "c4", def: plain("C4", 4), owner: P1, zone: "play" },
      { key: "c5", def: plain("C5", 5), owner: P1, zone: "play" },
      { key: "cn", def: plain("CNone", undefined), owner: P1, zone: "play" },
      { key: "o1", def: plain("O1", 1), owner: P2, zone: "play" },
      { key: "o4", def: plain("O4", 4), owner: P2, zone: "play" },
      { key: "st1", def: plain("Stolen1", 1), owner: P2, zone: "play", controller: P1 },
      { key: "st4", def: plain("Stolen4", 4), owner: P2, zone: "play", controller: P1 },
      { key: "gv1", def: plain("Given1", 1), owner: P1, zone: "play", controller: P2 },
      { key: "gv4", def: plain("Given4", 4), owner: P1, zone: "play", controller: P2 },
      ...(opts.resources ?? []),
      ...(opts.extra ?? [])
    ]
  });
}

// --- cost, threshold, type, stats -------------------------------------------------

clause(EZ, "0:unique", "printed as a rogue thief character: cost 3, [D][D][D], 3 strength / 3 speed / 3 life (his own cost 3 gives him neither bonus)", () => {
  const { engine, id } = ezBoard();
  assert.deepEqual(engine.getCardTypes(id("ez")), ["character"]);
  assert.deepEqual(printing(EZ).subtype, ["thief"]);
  assert.equal(printing(EZ).trade, "rogue");
  assert.deepEqual(triple(engine, id("ez")), [3, 3, 3]);
});

clause(EZ, "0:unique", "deploying costs exactly 3: three [D] is enough and spends all three", () => {
  const { engine, id } = ezBoard({ zone: "hand", resources: bank("deception", 3, P1) });
  assert.equal(engine.getAvailableResourceCount(P1), 3);
  play(engine, P1, id("ez"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("ez")), "play");
  assert.equal(engine.getAvailableResourceCount(P1), 0, "exactly 3 paid");
});

clause(EZ, "0:unique", "one short of the cost is refused even though the threshold is met by spent [D]; with three ready resources it works", () => {
  const short = ezBoard({ zone: "hand", resources: [...spentD(3), ...bank("rage", 2, P1)] });
  assert.equal(short.engine.getAvailableResourceCount(P1), 2, "setup: three [D] icons are spent, two resources are ready");
  refused(() => play(short.engine, P1, short.id("ez")), "cost 3 with only 2 ready resources", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(short.engine, short.id("ez")), "hand");
  const ok = ezBoard({ zone: "hand", resources: [...spentD(3), ...bank("rage", 3, P1)] });
  play(ok.engine, P1, ok.id("ez"));
  assert.equal(zoneOf(ok.engine, ok.id("ez")), "play", "control: 3 ready resources pay the cost");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0);
});

clause(EZ, "0:unique", "needs [D][D][D]: two [D] plus plenty of other resources is one icon short and refused; the opponent's [D] do not count", () => {
  const two = ezBoard({ zone: "hand", resources: [...bank("deception", 2, P1), ...bank("rage", 4, P1)] });
  refused(() => play(two.engine, P1, two.id("ez")), "only two [D] icons", /threshold|icon/i);
  assert.equal(zoneOf(two.engine, two.id("ez")), "hand");
  assert.equal(two.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
  const oppD = ezBoard({ zone: "hand", resources: [...bank("deception", 2, P1), ...bank("rage", 4, P1), ...bank("deception", 3, P2)] });
  refused(() => play(oppD.engine, P1, oppD.id("ez")), "the opponent's [D] do not count", /threshold|icon/i);
  const ok = ezBoard({ zone: "hand", resources: [...bank("deception", 3, P1), ...bank("rage", 4, P1)] });
  play(ok.engine, P1, ok.id("ez"));
  assert.equal(zoneOf(ok.engine, ok.id("ez")), "play", "control: three [D] work");
});

// --- UNIQUE -------------------------------------------------------------------------

clause(EZ, "0:unique", "controlling a second Ezekial makes me choose which one to keep (the controller chooses); the other is destroyed", () => {
  const b = ezBoard({ resources: bank("deception", 3, P1), extra: [{ key: "ez2", def: printing(EZ), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ez2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ez"), b.id("ez2")].sort());
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ez2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ez")), "discard", "the copy that was not kept is destroyed");
  assert.equal(zoneOf(b.engine, b.id("ez2")), "play");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(EZ, "0:unique", "choosing the old copy keeps it and destroys the new one", () => {
  const b = ezBoard({ resources: bank("deception", 3, P1), extra: [{ key: "ez2", def: printing(EZ), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("ez2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ez") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ez2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("ez")), "play");
});

clause(EZ, "0:unique", "the restriction is per player: the opponent may control their own Ezekial, with no choice and no destruction", () => {
  const b = ezBoard({ extra: [{ key: "ez2", def: printing(EZ), owner: P2, zone: "play" }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ez")), "play");
  assert.equal(zoneOf(b.engine, b.id("ez2")), "play");
});

clause(EZ, "0:unique", "control, not ownership, counts: an Ezekial I own but the opponent controls does not clash with mine", () => {
  const b = ezBoard({ extra: [{ key: "ez2", def: printing(EZ), owner: P1, zone: "play", controller: P2 }] });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ez")), "play");
  assert.equal(zoneOf(b.engine, b.id("ez2")), "play");
});

// --- Characters you control with numeric cost 2 or less gain 1 strength ------------

clause(EZ, "1:rule", "my characters of numeric cost 0, 1 and 2 (and with no cost number, numeric cost 0) gain exactly 1 strength; cost 3, 4 and 5 do not; nothing else changes", () => {
  const { engine, id } = ezBoard();
  for (const k of ["c0", "c1", "c2", "cn"]) assert.deepEqual(triple(engine, id(k)), [3, 5, 2], `${k}: +1 strength only`);
  for (const k of ["c3", "c4", "c5"].slice(0, 1)) assert.deepEqual(triple(engine, id(k)), [2, 5, 2], `${k}: cost 3 is above 2`);
  assert.equal(stat(engine, id("c4"), "strength"), 2, "cost 4: no strength");
  assert.equal(stat(engine, id("c5"), "strength"), 2, "cost 5: no strength");
});

clause(EZ, "1:rule", "only characters I CONTROL: the opponent's cheap characters do not gain it; a cheap character I took from the opponent does; one I own but the opponent controls does not", () => {
  const { engine, id } = ezBoard();
  assert.equal(stat(engine, id("o1"), "strength"), 2, "the opponent's cost-1 character");
  assert.equal(stat(engine, id("st1"), "strength"), 3, "owned by the opponent, controlled by me");
  assert.equal(stat(engine, id("gv1"), "strength"), 2, "owned by me, controlled by the opponent");
});

clause(EZ, "1:rule", "the bonus is a static rule of Ezekial in play: absent while he is in hand, present on his deploy, gone when he is destroyed", () => {
  const inHand = ezBoard({ zone: "hand", resources: bank("deception", 3, P1) });
  assert.equal(stat(inHand.engine, inHand.id("c1"), "strength"), 2, "he is in my hand: no bonus");
  play(inHand.engine, P1, inHand.id("ez"));
  assert.equal(stat(inHand.engine, inHand.id("c1"), "strength"), 3, "on");
  const gone = ezBoard({ extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(stat(gone.engine, gone.id("c1"), "strength"), 3);
  play(gone.engine, P1, gone.id("k"), { selected: { t: [gone.id("ez")] } });
  resolvePendingResponses(gone.engine);
  assert.equal(zoneOf(gone.engine, gone.id("ez")), "discard");
  assert.equal(stat(gone.engine, gone.id("c1"), "strength"), 2, "off after he left play");
  assert.equal(stat(gone.engine, gone.id("c0"), "strength"), 2);
});

clause(EZ, "1:rule", "a depleted Ezekial still gives it; the bonus belongs to his CONTROLLER (an Ezekial the opponent controls buffs the opponent's cheap characters, not mine)", () => {
  const dep = ezBoard({ depleted: true });
  assert.equal(stat(dep.engine, dep.id("c1"), "strength"), 3);
  const theirs = ezBoard({ controller: P2 });
  assert.equal(stat(theirs.engine, theirs.id("c1"), "strength"), 2, "mine: no bonus");
  assert.equal(stat(theirs.engine, theirs.id("o1"), "strength"), 3, "the opponent's cheap character");
  assert.equal(stat(theirs.engine, theirs.id("gv1"), "strength"), 3, "controlled by the opponent");
});

// --- Characters you control with numeric cost 4 or more gain 1 speed ---------------

clause(EZ, "2:rule", "my characters of numeric cost 4 and 5 gain exactly 1 speed; cost 0-3 and costless do not; nothing else changes", () => {
  const { engine, id } = ezBoard();
  assert.deepEqual(triple(engine, id("c4")), [2, 5, 3]);
  assert.deepEqual(triple(engine, id("c5")), [2, 5, 3]);
  for (const k of ["c0", "c1", "c2", "c3", "cn"]) assert.equal(stat(engine, id(k), "speed"), 2, `${k}: no speed`);
  assert.deepEqual(triple(engine, id("c3")), [2, 5, 2]);
});

clause(EZ, "2:rule", "only characters I control: the opponent's cost-4 character does not; one I took does; one I own but the opponent controls does not", () => {
  const { engine, id } = ezBoard();
  assert.equal(stat(engine, id("o4"), "speed"), 2);
  assert.equal(stat(engine, id("st4"), "speed"), 3);
  assert.equal(stat(engine, id("gv4"), "speed"), 2);
});

clause(EZ, "2:rule", "the speed bonus is a static rule: off while he is in hand, on in play, off after he is destroyed; a depleted Ezekial still gives it", () => {
  const inHand = ezBoard({ zone: "hand", resources: bank("deception", 3, P1) });
  assert.equal(stat(inHand.engine, inHand.id("c4"), "speed"), 2);
  play(inHand.engine, P1, inHand.id("ez"));
  assert.equal(stat(inHand.engine, inHand.id("c4"), "speed"), 3);
  const gone = ezBoard({ depleted: true, extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(stat(gone.engine, gone.id("c4"), "speed"), 3, "depleted: still on");
  play(gone.engine, P1, gone.id("k"), { selected: { t: [gone.id("ez")] } });
  resolvePendingResponses(gone.engine);
  assert.equal(stat(gone.engine, gone.id("c4"), "speed"), 2, "off after he left play");
  assert.equal(stat(gone.engine, gone.id("c5"), "speed"), 2);
});

clause(EZ, "2:rule", "the opponent's Ezekial buffs the speed of the opponent's cost-4 characters only", () => {
  const theirs = ezBoard({ controller: P2 });
  assert.equal(stat(theirs.engine, theirs.id("c4"), "speed"), 2);
  assert.equal(stat(theirs.engine, theirs.id("o4"), "speed"), 3);
  assert.equal(stat(theirs.engine, theirs.id("gv4"), "speed"), 3);
});

// --- YOINK! ---------------------------------------------------------------------------

function yBoard(opts: { active?: Pid; extra?: CardPlacement[]; depleted?: boolean; ezController?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    cards: [
      { key: "ez", def: printing(EZ), owner: P1, zone: "play", depleted: opts.depleted, controller: opts.ezController },
      { key: "myChar", def: plain("MyChar", 3), owner: P1, zone: "play" },
      { key: "myChar2", def: plain("MyChar2", 3), owner: P1, zone: "play" },
      { key: "oppChar", def: plain("OppChar", 3), owner: P2, zone: "play" },
      { key: "oppChar2", def: plain("OppChar2", 3), owner: P2, zone: "play" },
      { key: "gearOpp", def: gearDef("OppGear"), owner: P2, zone: "play", attachedToKey: "oppChar" },
      { key: "gearMine", def: gearDef("MyGear"), owner: P1, zone: "play", attachedToKey: "myChar" },
      { key: "notGear", def: item({ name: "NotGear" }), owner: P2, zone: "play" },
      { key: "gearHand", def: gearDef("HandGear"), owner: P2, zone: "hand" },
      { key: "gearDisc", def: gearDef("DiscGear"), owner: P2, zone: "discard" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "handChar", def: plain("HandChar", 3), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

type YGame = ReturnType<typeof yBoard>;
const yoink = (g: YGame, gear: string, host: string, player: Pid = P1) =>
  activate(g.engine, player, g.id("ez"), "yoink", { selected: { g: [g.id(gear)], c: [g.id(host)] } });

clause(EZ, "3:ability:yoink", "the cost destroys Ezekial; the effect makes me controller of an opponent's gear card and attaches it to the character I picked (my own); the old host loses the bonus", () => {
  const g = yBoard();
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P2);
  assert.equal(stat(g.engine, g.id("oppChar"), "strength"), 4, "setup: the gear gives its host +2");
  yoink(g, "gearOpp", "myChar2");
  assert.equal(pending(g.engine), undefined);
  assert.equal(zoneOf(g.engine, g.id("ez")), "discard", "COST: destroy this card");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1, "I took control");
  assert.equal(zoneOf(g.engine, g.id("gearOpp")), "play");
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("myChar2"), "attached to the picked character");
  assert.equal(stat(g.engine, g.id("myChar2"), "strength"), 4, "the gear boosts its new host");
  assert.equal(stat(g.engine, g.id("oppChar"), "strength"), 2, "the old host lost it");
  assert.equal(attachedToOf(g.engine, g.id("gearMine")), g.id("myChar"), "my other gear stays put");
  assert.equal(controllerOf(g.engine, g.id("notGear")), P2, "a non-gear item is untouched");
});

clause(EZ, "3:ability:yoink", "the picked character may be any character, even an opponent's: the gear goes there but stays under MY control", () => {
  const g = yBoard();
  yoink(g, "gearOpp", "oppChar2");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("oppChar2"));
  assert.equal(stat(g.engine, g.id("oppChar2"), "strength"), 4);
  assert.equal(stat(g.engine, g.id("oppChar"), "strength"), 2);
});

clause(EZ, "3:ability:yoink", "a gear card I already control can be picked and moved to another of my characters", () => {
  const g = yBoard();
  yoink(g, "gearMine", "myChar2");
  assert.equal(controllerOf(g.engine, g.id("gearMine")), P1);
  assert.equal(attachedToOf(g.engine, g.id("gearMine")), g.id("myChar2"));
  assert.equal(stat(g.engine, g.id("myChar"), "strength"), 2, "the old host is back to printed strength");
  assert.equal(stat(g.engine, g.id("myChar2"), "strength"), 4);
});

clause(EZ, "3:ability:yoink", "the cost is paid when it is used (Ezekial is already destroyed while the ability waits) and control moves only on resolution", () => {
  const g = yBoard();
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("ez"), abilityId: "yoink", selected: { g: [g.id("gearOpp")], c: [g.id("myChar")] }, variables: {} } as never);
  assert.equal(zoneOf(g.engine, g.id("ez")), "discard", "destroyed as a cost before the effect resolves");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P2, "the effect has not resolved yet");
  resolvePendingResponses(g.engine);
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("myChar"));
});

clause(EZ, "3:ability:yoink", "control is permanent: it is still mine after the turns pass, and the gear's owner is unchanged", () => {
  const g = yBoard();
  yoink(g, "gearOpp", "myChar");
  endTurn(g.engine, P1);
  endTurn(g.engine, P2);
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("myChar"));
  assert.equal(g.engine.state.cards[g.id("gearOpp")].ownerId, P2, "ownership never changed");
});

clause(EZ, "3:ability:yoink", "the first pick must be a gear card in play: a non-gear item, a location, a gear in hand or in the discard pile, a character and two gear cards are refused", () => {
  const g = yBoard();
  const tryG = (gear: string) => () => yoink(g, gear, "myChar");
  refused(tryG("notGear"), "an item without the gear subtype", /gear|target|select|invalid|legal/i);
  refused(tryG("place"), "a location", /gear|target|select|invalid|legal/i);
  refused(tryG("gearHand"), "a gear card in a hand: pick means a card in play", /gear|target|select|invalid|legal/i);
  refused(tryG("gearDisc"), "a gear card in a discard pile", /gear|target|select|invalid|legal/i);
  refused(tryG("oppChar"), "a character is not a gear card", /gear|target|select|invalid|legal/i);
  refused(() => activate(g.engine, P1, g.id("ez"), "yoink", { selected: { g: [g.id("gearOpp"), g.id("gearMine")], c: [g.id("myChar")] } }), "two gear cards: pick a gear card", /gear|target|select|invalid|legal|count/i);
  refused(() => activate(g.engine, P1, g.id("ez"), "yoink", { selected: { c: [g.id("myChar")] } }), "the gear pick cannot be skipped", /gear|target|select|invalid|legal|count/i);
  assert.equal(zoneOf(g.engine, g.id("ez")), "play", "nothing was paid by the refused attempts");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P2);
  yoink(g, "gearOpp", "myChar");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1, "control: a real gear card in play works");
});

clause(EZ, "3:ability:yoink", "the second pick must be a character in play: an item, a location, a gear card, a character in hand, a faction and two characters are refused", () => {
  const g = yBoard();
  const tryC = (c: CardInstanceId[]) => () => activate(g.engine, P1, g.id("ez"), "yoink", { selected: { g: [g.id("gearOpp")], c } });
  refused(tryC([g.id("notGear")]), "an item is not a character", /character|target|select|invalid|legal/i);
  refused(tryC([g.id("place")]), "a location is not a character", /character|target|select|invalid|legal/i);
  refused(tryC([g.id("gearMine")]), "a gear card is not a character", /character|target|select|invalid|legal/i);
  refused(tryC([g.id("handChar")]), "a character in hand is not in play", /character|target|select|invalid|legal/i);
  refused(tryC([g.engine.state.players[P2].factionId!]), "a faction cannot be picked as a character", /character|target|select|invalid|legal/i);
  refused(tryC([g.id("myChar"), g.id("myChar2")]), "pick a character: exactly one", /character|target|select|invalid|legal|count/i);
  refused(tryC([]), "the character pick cannot be skipped", /character|target|select|invalid|legal|count/i);
  assert.equal(zoneOf(g.engine, g.id("ez")), "play", "nothing was paid by the refused attempts");
});

clause(EZ, "3:ability:yoink", "Ezekial is destroyed as the FIRST part of the cost, so he cannot be the character picked afterwards", () => {
  const g = yBoard();
  refused(() => activate(g.engine, P1, g.id("ez"), "yoink", { selected: { g: [g.id("gearOpp")], c: [g.id("ez")] } }), "Ezekial is already destroyed when the character is picked", /character|target|select|invalid|legal|destroy/i);
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P2, "no control change");
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("oppChar"), "the gear stays on its host");
});

clause(EZ, "3:ability:yoink", "no deplete or resource cost: a depleted Ezekial can still Yoink", () => {
  const g = yBoard({ depleted: true });
  yoink(g, "gearOpp", "myChar");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
  assert.equal(zoneOf(g.engine, g.id("ez")), "discard");
});

clause(EZ, "3:ability:yoink", "only the controller can use it: the opponent is refused (positive control: the controller can)", () => {
  const g = yBoard();
  refused(() => yoink(g, "gearOpp", "myChar", P2), "the opponent does not control Ezekial", /control|priority|player|not|abilit/i);
  assert.equal(zoneOf(g.engine, g.id("ez")), "play");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P2);
  yoink(g, "gearOpp", "myChar");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
});

clause(EZ, "3:ability:yoink", "it works for the player who controls Ezekial even when the opponent owns him (control, not ownership)", () => {
  const g = yBoard({ ezController: P2, active: P2 });
  yoink(g, "gearMine", "oppChar2", P2);
  assert.equal(controllerOf(g.engine, g.id("gearMine")), P2, "the controller took my gear");
  assert.equal(attachedToOf(g.engine, g.id("gearMine")), g.id("oppChar2"));
  assert.equal(zoneOf(g.engine, g.id("ez")), "discard", "Ezekial went to his owner's discard pile");
});

clause(EZ, "3:ability:yoink", "it can be used in response on the opponent's turn: in the attack declaration window I take control of their gear", () => {
  const g = yBoard({ active: P2, extra: [{ key: "foe", def: plain("Foe", 3), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  g.engine.perform({ type: "activateAbility", playerId: P1, cardId: g.id("ez"), abilityId: "yoink", selected: { g: [g.id("gearOpp")], c: [g.id("myChar")] }, variables: {} } as never);
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("ez")), "discard");
  assert.equal(controllerOf(g.engine, g.id("gearOpp")), P1);
  assert.equal(attachedToOf(g.engine, g.id("gearOpp")), g.id("myChar"));
});

// =================================================================================
// Feckless Chronicler -- rogue performer character, cost 4, [D], 2 str / 3 spd / 2 life
// =================================================================================

const CHRON = "123ecdbd-dd93-4aff-a8b2-5841bd9af29e";

const vText = (name: string) => character({ name, strength: 2, life: 5, speed: 1, text: "[V][V]: Draw a card." });
const rText = (name: string) => character({ name, strength: 2, life: 5, speed: 1, text: "[R]: Deal 1 damage." });

function chBoard(opts: { random?: () => number; resources?: CardPlacement[]; ch?: Partial<CardPlacement>; extra?: CardPlacement[]; zone?: "play" | "hand"; active?: Pid } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? WIN,
    cards: [
      { key: "ch", def: printing(CHRON), owner: P1, zone: opts.zone ?? "play", ...opts.ch },
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "bv", def: vText("V Blocker"), owner: P2, zone: "play" },
      { key: "bv2", def: character({ name: "V and R Blocker", strength: 2, life: 5, speed: 1, text: "[R]: Deal 1. [V]: Draw." }), owner: P2, zone: "play" },
      { key: "br", def: rText("R Blocker"), owner: P2, zone: "play" },
      { key: "bn", def: character({ name: "Plain Blocker", strength: 2, life: 5, speed: 1, text: "" }), owner: P2, zone: "play" },
      ...(opts.resources ?? []),
      ...(opts.extra ?? [])
    ]
  });
}
type CGame = ReturnType<typeof chBoard>;

// --- cost, threshold, type, stats -------------------------------------------------

clause(CHRON, "0:rule", "printed as a rogue performer character: cost 4, [D], 2 strength / 3 speed / 2 life", () => {
  const g = chBoard();
  assert.deepEqual(g.engine.getCardTypes(g.id("ch")), ["character"]);
  assert.deepEqual(printing(CHRON).subtype, ["performer"]);
  assert.equal(printing(CHRON).trade, "rogue");
  assert.deepEqual(triple(g.engine, g.id("ch")), [2, 2, 3]);
});

clause(CHRON, "0:rule", "deploying costs exactly 4: [D] plus three other resources is enough and spends all four", () => {
  const g = chBoard({ zone: "hand", resources: [...bank("deception", 1, P1), ...bank("rage", 3, P1)] });
  assert.equal(g.engine.getAvailableResourceCount(P1), 4);
  play(g.engine, P1, g.id("ch"));
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "exactly 4 paid");
});

clause(CHRON, "0:rule", "one resource short is refused even with the threshold met (the [D] is spent); and without any [D] it is refused too", () => {
  const short = chBoard({ zone: "hand", resources: [...spentD(1), ...bank("rage", 3, P1)] });
  refused(() => play(short.engine, P1, short.id("ch")), "cost 4 with only 3 ready resources", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(short.engine, short.id("ch")), "hand");
  const ok = chBoard({ zone: "hand", resources: [...spentD(1), ...bank("rage", 4, P1)] });
  play(ok.engine, P1, ok.id("ch"));
  assert.equal(zoneOf(ok.engine, ok.id("ch")), "play", "control: four ready resources and a spent [D]");
  const noD = chBoard({ zone: "hand", resources: bank("rage", 6, P1) });
  refused(() => play(noD.engine, P1, noD.id("ch")), "no [D] icon at all", /threshold|icon/i);
  const oppD = chBoard({ zone: "hand", resources: [...bank("rage", 6, P1), ...bank("deception", 2, P2)] });
  refused(() => play(oppD.engine, P1, oppD.id("ch")), "the opponent's [D] do not count", /threshold|icon/i);
  assert.equal(zoneOf(noD.engine, noD.id("ch")), "hand");
  assert.equal(noD.engine.getAvailableResourceCount(P1), 6, "nothing was paid");
});

// --- cannot be blocked by characters with a [V] icon in its rules text -------------

const attackBy = (g: CGame, attackers: string[]) => declareAttackBy(g.engine, P1, attackers.map((k) => g.id(k)));
const blockAll = (g: CGame, blockers: string[]) => declareBlockers(g.engine, P2, blockers.map((k) => g.id(k)));

clause(CHRON, "0:rule", "a blocker with [V] in its rules text may not block this card; a blocker with [R] only or no text may (positive controls)", () => {
  const g = chBoard();
  const influence = g.engine.state.players[P2].influence;
  attackBy(g, ["ch"]);
  refused(() => blockAll(g, ["bv"]), "[V] in its rules text", /block/i);
  refused(() => blockAll(g, ["bv2"]), "[V] among other icons in its rules text", /block/i);
  blockAll(g, ["br"]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.players[P2].influence, influence, "control: the [R] blocker blocked, so the faction took no damage");
  assert.equal(g.engine.state.cards[g.id("br")].damage ?? 0, 2, "control: Chronicler's 2 strength hit the [R] blocker");
});

clause(CHRON, "0:rule", "a blocker with no rules text at all may block it", () => {
  const g = chBoard();
  attackBy(g, ["ch"]);
  blockAll(g, ["bn"]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("bn")].damage ?? 0, 2);
});

clause(CHRON, "0:rule", "unblocked, it hits the faction for its 2 strength", () => {
  const g = chBoard();
  const before = g.engine.state.players[P2].influence;
  attackBy(g, ["ch"]);
  blockAll(g, []);
  finishBattle(g.engine);
  assert.equal(before - g.engine.state.players[P2].influence, 2);
});

clause(CHRON, "0:rule", "the restriction is about THIS card only: the same [V] character can block my other attacker", () => {
  const g = chBoard();
  attackBy(g, ["ally"]);
  blockAll(g, ["bv"]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("bv")].damage ?? 0, 2, "the [V] character blocked Ally");
});

clause(CHRON, "0:rule", "in a party with another attacker the [V] character still cannot block (the party contains this card), alone or alongside a legal blocker", () => {
  const g = chBoard();
  attackBy(g, ["ch", "ally"]);
  refused(() => blockAll(g, ["bv"]), "[V] blocker against a party containing Chronicler", /block/i);
  refused(() => blockAll(g, ["bn", "bv"]), "a [V] blocker among legal blockers", /block/i);
  blockAll(g, ["bn"]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.battle, undefined);
});

clause(CHRON, "0:rule", "it only limits who blocks it: it can itself block an attacking [V] character", () => {
  const g = chBoard({ active: P2, extra: [{ key: "atk", def: vText("V Attacker"), owner: P2, zone: "play" }] });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("ch")]);
  finishBattle(g.engine);
  assert.equal(g.engine.state.cards[g.id("atk")].damage ?? 0, 2, "Chronicler blocked and hit the [V] attacker");
});

// --- gains 1 strength and 1 life for each token on it ------------------------------

clause(CHRON, "1:rule", "with 0, 1 and 3 tokens its strength and life are 2+n each and its speed stays 3", () => {
  for (const [n, expected] of [[0, [2, 2, 3]], [1, [3, 3, 3]], [3, [5, 5, 3]]] as Array<[number, number[]]>) {
    const g = chBoard({ ch: { counters: n ? { token: n } : undefined } });
    assert.deepEqual(triple(g.engine, g.id("ch")), expected, `${n} token(s)`);
  }
});

clause(CHRON, "1:rule", "only TOKENS count: other counters on it, and tokens on other characters, do nothing", () => {
  const g = chBoard({ ch: { counters: { shield: 2 } as never }, extra: [] });
  assert.deepEqual(triple(g.engine, g.id("ch")), [2, 2, 3], "a non-token counter");
  const h = chBoard({ ch: { counters: { token: 1 } } });
  h.engine.state.cards[h.id("ally")].counters = { token: 4 };
  assert.deepEqual(triple(h.engine, h.id("ch")), [3, 3, 3], "only its own token");
  assert.deepEqual(triple(h.engine, h.id("ally")), [2, 5, 2], "tokens on Ally do not grow Ally");
});

// --- [D][D][D]: when depleted, flip a coin; if you win, put a token on this card ----

const attackAlone = (g: CGame) => {
  attackBy(g, ["ch"]);
  blockAll(g, []);
  finishBattle(g.engine);
};

clause(CHRON, "2:rule@ddd", "with [D][D][D], when it is depleted (by attacking) the coin is flipped; on a win it gets a token, which grows it to 3 strength and 3 life", () => {
  const g = chBoard({ random: WIN, resources: bank("deception", 3, P1) });
  attackBy(g, ["ch"]);
  assert.equal(isDepleted(g.engine, g.id("ch")), true, "attacking depleted it");
  assert.equal(pending(g.engine), undefined);
  assert.deepEqual(coinFlips(g.engine), [true], "one coin flip, won");
  assert.equal(tokensOn(g.engine, g.id("ch")), 1);
  assert.deepEqual(triple(g.engine, g.id("ch")), [3, 3, 3]);
});

clause(CHRON, "2:rule@ddd", "on a lost flip there is exactly one flip and no token", () => {
  const g = chBoard({ random: LOSE, resources: bank("deception", 3, P1) });
  attackBy(g, ["ch"]);
  assert.deepEqual(coinFlips(g.engine), [false]);
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
  assert.deepEqual(triple(g.engine, g.id("ch")), [2, 2, 3]);
});

clause(CHRON, "2:rule@ddd", "a win adds ONE token on top of the ones already there", () => {
  const g = chBoard({ random: WIN, resources: bank("deception", 3, P1), ch: { counters: { token: 2 } } });
  attackBy(g, ["ch"]);
  assert.equal(tokensOn(g.engine, g.id("ch")), 3);
  assert.deepEqual(triple(g.engine, g.id("ch")), [5, 5, 3]);
});

clause(CHRON, "2:rule@ddd", "needs [D][D][D]: with only two [D] (plus other resources) being depleted flips no coin and gives no token", () => {
  const g = chBoard({ random: WIN, resources: [...bank("deception", 2, P1), ...bank("rage", 4, P1)] });
  attackBy(g, ["ch"]);
  assert.equal(isDepleted(g.engine, g.id("ch")), true);
  assert.deepEqual(coinFlips(g.engine), [], "no flip without the threshold");
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
  const opp = chBoard({ random: WIN, resources: [...bank("deception", 2, P1), ...bank("deception", 3, P2)] });
  attackBy(opp, ["ch"]);
  assert.deepEqual(coinFlips(opp.engine), [], "the opponent's [D] do not count");
});

clause(CHRON, "2:rule@ddd", "spent [D] resources still count toward the threshold", () => {
  const g = chBoard({ random: WIN, resources: spentD(3) });
  attackBy(g, ["ch"]);
  assert.deepEqual(coinFlips(g.engine), [true]);
  assert.equal(tokensOn(g.engine, g.id("ch")), 1);
});

clause(CHRON, "2:rule@ddd", "it is about THIS card being depleted: another of my characters depleting does not flip a coin", () => {
  const g = chBoard({ random: WIN, resources: bank("deception", 3, P1) });
  attackBy(g, ["ally"]);
  assert.equal(isDepleted(g.engine, g.id("ally")), true);
  assert.equal(isDepleted(g.engine, g.id("ch")), false);
  assert.deepEqual(coinFlips(g.engine), []);
  assert.equal(tokensOn(g.engine, g.id("ch")), 0);
});

clause(CHRON, "2:rule@ddd", "any depletion counts, not only attacking: depleted by another card's effect it flips too", () => {
  const wringer = item({
    name: "Wringer",
    behavior: {
      abilities: [{ id: "wring", type: "activated", targets: [{ id: "t", selector: { type: "character" }, count: 1 }], effects: [{ type: "deplete", target: { type: "selected", id: "t" } }] }]
    }
  } as Partial<CardDefinition>);
  const g = chBoard({ random: WIN, resources: bank("deception", 3, P1), extra: [{ key: "w", def: wringer, owner: P1, zone: "play" }] });
  activate(g.engine, P1, g.id("w"), "wring", { selected: { t: [g.id("ch")] } });
  assert.equal(isDepleted(g.engine, g.id("ch")), true);
  assert.deepEqual(coinFlips(g.engine), [true]);
  assert.equal(tokensOn(g.engine, g.id("ch")), 1);
});

clause(CHRON, "2:rule@ddd", "the controller is the flipper: it works on the opponent's turn for me too, when my Chronicler blocks and survives (battle survivors are depleted)", () => {
  const g = chBoard({
    active: P2,
    random: WIN,
    resources: bank("deception", 3, P1),
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 5, speed: 1, text: "" }), owner: P2, zone: "play" }]
  });
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("ch")]);
  finishBattle(g.engine);
  assert.equal(isDepleted(g.engine, g.id("ch")), true, "the surviving blocker is depleted");
  assert.deepEqual(coinFlips(g.engine), [true]);
  assert.equal(tokensOn(g.engine, g.id("ch")), 1);
});

// --- FLIP UP: 2 [D] -------------------------------------------------------------------

const flipUp = (g: CGame, player: Pid = P1) => flipUpNow(g.engine, { type: "flipUp", playerId: player, cardId: g.id("ch"), selected: {}, variables: {} });
const faceDown = (resources: CardPlacement[], over: Partial<CardPlacement> = {}, active: Pid = P1) =>
  chBoard({ ch: { faceDown: true, ...over }, resources, active });

clause(CHRON, "3:flipUp", "a face-down Chronicler flips up for 2 with [D]: itself plus one [D] resource pays, and it becomes a face-up character with its printed stats", () => {
  const g = faceDown(bank("deception", 1, P1));
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "setup: the face-down card and one [D]");
  flipUp(g);
  resolvePendingResponses(g.engine);
  assert.equal(pending(g.engine), undefined);
  const c = g.engine.state.cards[g.id("ch")];
  assert.equal(c.zone, "play");
  assert.equal(c.faceDown, false);
  assert.deepEqual(g.engine.getCardTypes(g.id("ch")), ["character"]);
  assert.equal(g.engine.isResource(g.id("ch")), false, "no longer a resource");
  assert.deepEqual(triple(g.engine, g.id("ch")), [2, 2, 3]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "both resources were spent");
});

clause(CHRON, "3:flipUp", "pays exactly 2 (not the normal cost of 4): with 4 other resources only 2 are spent", () => {
  const g = faceDown([...bank("deception", 1, P1), ...bank("rage", 3, P1)]);
  assert.equal(g.engine.getAvailableResourceCount(P1), 5);
  flipUp(g);
  resolvePendingResponses(g.engine);
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, false);
  assert.equal(g.engine.getAvailableResourceCount(P1), 2, "5 - 2 paid - the card that left the pool = 2 left");
});

clause(CHRON, "3:flipUp", "is refused when one short: the card plus a spent [D] is only one ready resource, and nothing is paid", () => {
  const g = faceDown(spentD(1));
  assert.equal(g.engine.getAvailableResourceCount(P1), 1);
  refused(() => flipUp(g), "1 ready resource for a FLIP UP cost of 2", /cost|resource|afford|pay/i);
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, true, "still face-down");
  assert.equal(g.engine.getAvailableResourceCount(P1), 1, "nothing was paid");
  const ok = faceDown([...spentD(1), ...bank("rage", 1, P1)]);
  flipUp(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(ok.engine.state.cards[ok.id("ch")].faceDown, false, "control: card + 1 ready resource with a spent [D] is enough");
});

clause(CHRON, "3:flipUp", "needs [D]: Rage resources are not the threshold, and the card's own Volition icon is not [D]; the opponent's [D] do not count", () => {
  const noD = faceDown(bank("rage", 4, P1));
  refused(() => flipUp(noD), "no [D] among the resources", /threshold|icon/i);
  assert.equal(noD.engine.state.cards[noD.id("ch")].faceDown, true);
  assert.equal(noD.engine.getAvailableResourceCount(P1), 5, "nothing was paid");
  const opp = faceDown([...bank("rage", 4, P1), ...bank("deception", 3, P2)]);
  refused(() => flipUp(opp), "the opponent's [D] do not count", /threshold|icon/i);
  assert.equal(opp.engine.state.cards[opp.id("ch")].faceDown, true);
  const one = faceDown([...bank("rage", 3, P1), ...bank("deception", 1, P1)]);
  flipUp(one);
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("ch")].faceDown, false, "control: a single [D] among the resources is enough");
});

clause(CHRON, "3:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn", () => {
  const g = faceDown(bank("deception", 3, P1), {}, P2);
  refused(() => flipUp(g), "a character cannot be played on the opponent's turn", /timing|active player/i);
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 4, "nothing was paid");
});

clause(CHRON, "3:flipUp", "a non-tactic cannot be flipped up inside the opponent's response window", () => {
  const g = chBoard({
    active: P2,
    ch: { faceDown: true },
    resources: bank("deception", 3, P1),
    extra: [{ key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(g.engine, P2, [g.id("foe")]);
  refused(() => flipUp(g), "a character cannot be played in a response window", /response|window|turn|priority|play/i);
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, true);
  assert.equal(g.engine.getAvailableResourceCount(P1), 4, "nothing was paid");
});

clause(CHRON, "3:flipUp", "only its controller can flip it, and only while it is face-down in play", () => {
  const theirs = faceDown([...bank("deception", 3, P1), ...bank("deception", 3, P2)]);
  refused(() => flipUp(theirs, P2), "the opponent cannot flip my card", /control|player|not/i);
  assert.equal(theirs.engine.state.cards[theirs.id("ch")].faceDown, true);
  const faceUp = chBoard({ resources: bank("deception", 3, P1) });
  refused(() => flipUp(faceUp), "already face-up", /face|flip/i);
  const inHand = chBoard({ zone: "hand", resources: bank("deception", 3, P1) });
  refused(() => flipUp(inHand), "in the hand it is not a face-down resource", /face|flip|play|zone/i);
  assert.equal(zoneOf(inHand.engine, inHand.id("ch")), "hand");
});

clause(CHRON, "3:flipUp", "FLIP UP is an alternative: from the hand it deploys for its normal cost of 4 with [D]", () => {
  const g = chBoard({ zone: "hand", resources: [...bank("deception", 1, P1), ...bank("rage", 4, P1)] });
  play(g.engine, P1, g.id("ch"));
  assert.equal(zoneOf(g.engine, g.id("ch")), "play");
  assert.equal(g.engine.state.cards[g.id("ch")].faceDown, false);
  assert.equal(g.engine.getAvailableResourceCount(P1), 1, "4 of 5 spent");
});

// =================================================================================
// God's Blessing of Transfiguration -- rogue mutation tactic, cost 6, [D][D][D]
// =================================================================================

const BL = "2ec53fa7-6f07-4214-a2c4-d6b671c216f4";

function blBoard(opts: { zone?: "hand" | "play"; attachedTo?: string; resources?: CardPlacement[]; extra?: CardPlacement[]; active?: Pid; random?: () => number } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: opts.active ?? P1,
    random: opts.random ?? WIN,
    cards: [
      { key: "bl", def: printing(BL), owner: P1, zone: opts.zone ?? "hand", attachedToKey: opts.attachedTo },
      { key: "host", def: character({ name: "Host", cost: 3, strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "ally", def: character({ name: "Ally", cost: 3, strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 3, strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", cost: 3, strength: 4, life: 3, speed: 3 }), owner: P2, zone: "play" },
      ...fillers("pd", 5, P2, "deck"),
      ...fillers("md", 5, P1, "deck"),
      ...(opts.resources ?? bank("deception", 6, P1)),
      ...(opts.extra ?? [])
    ]
  });
}
type BGame = ReturnType<typeof blBoard>;

const attach = (g: BGame, host: string) => {
  play(g.engine, P1, g.id("bl"), { selected: { attachTo: [g.id(host)] } });
  drain(g.engine, declineAll);
  assert.equal(pending(g.engine), undefined);
};

clause(BL, "0:unique", "printed as a rogue mutation tactic: cost 6, [D][D][D]; six [D] pays it all", () => {
  const g = blBoard();
  assert.deepEqual(g.engine.getCardTypes(g.id("bl")), ["tactic"]);
  assert.deepEqual(printing(BL).subtype, ["mutation"]);
  assert.equal(printing(BL).trade, "rogue");
  assert.equal(g.engine.getAvailableResourceCount(P1), 6);
  attach(g, "host");
  assert.equal(g.engine.getAvailableResourceCount(P1), 0, "exactly 6 paid");
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
});

clause(BL, "0:unique", "one resource short is refused even with the threshold met by spent [D]; six ready resources work", () => {
  const short = blBoard({ resources: [...spentD(3), ...bank("rage", 5, P1)] });
  refused(() => attach(short, "host"), "cost 6 with only 5 ready resources", /cost|resource|afford|pay/i);
  assert.equal(zoneOf(short.engine, short.id("bl")), "hand");
  assert.equal(short.engine.getAvailableResourceCount(P1), 5, "nothing was paid");
  const ok = blBoard({ resources: [...spentD(3), ...bank("rage", 6, P1)] });
  attach(ok, "host");
  assert.equal(zoneOf(ok.engine, ok.id("bl")), "play", "control");
  assert.equal(ok.engine.getAvailableResourceCount(P1), 0);
});

clause(BL, "0:unique", "needs [D][D][D]: two [D] with plenty of other resources is one icon short, refused; the opponent's [D] do not count", () => {
  const two = blBoard({ resources: [...bank("deception", 2, P1), ...bank("rage", 6, P1)] });
  refused(() => attach(two, "host"), "only two [D] icons", /threshold|icon/i);
  assert.equal(zoneOf(two.engine, two.id("bl")), "hand");
  assert.equal(two.engine.getAvailableResourceCount(P1), 8, "nothing was paid");
  const opp = blBoard({ resources: [...bank("deception", 2, P1), ...bank("rage", 6, P1), ...bank("deception", 3, P2)] });
  refused(() => attach(opp, "host"), "the opponent's [D] do not count", /threshold|icon/i);
  const ok = blBoard({ resources: [...bank("deception", 3, P1), ...bank("rage", 3, P1)] });
  attach(ok, "host");
  assert.equal(zoneOf(ok.engine, ok.id("bl")), "play", "control: three [D] work");
});

clause(BL, "0:unique", "UNIQUE BLESSING: a second Blessing attached while the first is in play makes the controller choose which to keep", () => {
  const g = blBoard({ extra: [{ key: "bl2", def: printing(BL), owner: P1, zone: "hand" }, ...bank("deception", 6, P1).map((p) => ({ ...p, key: `x${p.key}` }))] });
  attach(g, "host");
  play(g.engine, P1, g.id("bl2"), { selected: { attachTo: [g.id("ally")] } });
  const pc = pending(g.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...pc.candidates].sort(), [g.id("bl"), g.id("bl2")].sort());
  g.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: g.id("bl2") } } as never);
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard", "the old Blessing is destroyed");
  assert.equal(zoneOf(g.engine, g.id("bl2")), "play");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(stat(g.engine, g.id("ally"), "strength"), 4, "only one Blessing's effect remains");
});

clause(BL, "0:unique", "the restriction is per player: the opponent may control their own Blessing too", () => {
  const g = blBoard({ extra: [{ key: "bl2", def: printing(BL), owner: P2, zone: "play", attachedToKey: "foe" }] });
  attach(g, "host");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(zoneOf(g.engine, g.id("bl2")), "play");
});

clause(BL, "1:attach", "it attaches to the chosen character and sits in play attached to it", () => {
  const g = blBoard();
  attach(g, "host");
  assert.equal(zoneOf(g.engine, g.id("bl")), "play");
  assert.equal(attachedToOf(g.engine, g.id("bl")), g.id("host"));
  assert.equal(attachedToOf(g.engine, g.id("bl")) === g.id("ally"), false);
});

clause(BL, "1:attach", "ATTACH TO CHARACTER: an item, a location, a faction, a character in hand, a nonexistent pick and no pick are refused; any character (even the opponent's) is allowed", () => {
  const g = blBoard({
    extra: [
      { key: "it", def: item({ name: "It" }), owner: P1, zone: "play" },
      { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
      { key: "hc", def: character({ name: "HandChar" }), owner: P1, zone: "hand" }
    ]
  });
  const tryOn = (target: CardInstanceId[]) => () => play(g.engine, P1, g.id("bl"), { selected: { attachTo: target } });
  refused(tryOn([g.id("it")]), "an item is not a character", /attach|character|target|select|invalid|legal/i);
  refused(tryOn([g.id("loc")]), "a location is not a character", /attach|character|target|select|invalid|legal/i);
  refused(tryOn([g.engine.state.players[P1].factionId!]), "a faction is not a character", /attach|character|target|select|invalid|legal/i);
  refused(tryOn([g.id("hc")]), "a character in hand is not in play", /attach|character|target|select|invalid|legal/i);
  refused(tryOn([]), "a host is required", /attach|character|target|select|invalid|legal|count/i);
  assert.equal(zoneOf(g.engine, g.id("bl")), "hand");
  assert.equal(g.engine.getAvailableResourceCount(P1), 6, "nothing was paid by the refused attempts");
  attach(g, "foe");
  assert.equal(attachedToOf(g.engine, g.id("bl")), g.id("foe"), "control: an opponent's character is a legal host");
});

clause(BL, "2:rule", "the text belongs to the attached character: nothing is granted before the Blessing is played, and it ends when the host leaves play (the Blessing goes to the discard pile)", () => {
  const g = blBoard({ extra: [{ key: "k", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.deepEqual(triple(g.engine, g.id("ally")), [3, 3, 2], "before: printed");
  attach(g, "host");
  assert.deepEqual(triple(g.engine, g.id("ally")), [4, 2, 2], "on");
  play(g.engine, P1, g.id("k"), { selected: { t: [g.id("host")] } });
  resolvePendingResponses(g.engine);
  assert.equal(zoneOf(g.engine, g.id("host")), "discard");
  assert.equal(zoneOf(g.engine, g.id("bl")), "discard", "the Blessing follows its host out of play");
  assert.deepEqual(triple(g.engine, g.id("ally")), [3, 3, 2], "off after the host left");
});

clause(BL, "2:rule", "the granted text is the HOST's: on an opponent's character it is that player's characters that change (the host's controller is 'you')", () => {
  const g = blBoard();
  attach(g, "foe");
  assert.deepEqual(triple(g.engine, g.id("foe")), [3, 3, 1], "the host itself");
  assert.deepEqual(triple(g.engine, g.id("foe2")), [5, 2, 3], "the host's other ally");
  assert.deepEqual(triple(g.engine, g.id("host")), [2, 4, 1], "my characters are untouched");
  assert.deepEqual(triple(g.engine, g.id("ally")), [3, 3, 2]);
});

// --- All your characters gain 1 strength and lose 1 life ---------------------------

clause(BL, "3.0:grant-rule", "ALL my characters (the host too) gain exactly 1 strength and lose exactly 1 life; speed is unchanged; the opponent's characters are not affected", () => {
  const g = blBoard();
  attach(g, "host");
  assert.deepEqual(triple(g.engine, g.id("host")), [3, 3, 1], "the host");
  assert.deepEqual(triple(g.engine, g.id("ally")), [4, 2, 2], "another of my characters");
  assert.deepEqual(triple(g.engine, g.id("foe")), [2, 4, 1], "the opponent's character");
  assert.deepEqual(triple(g.engine, g.id("foe2")), [4, 3, 3]);
});

clause(BL, "3.0:grant-rule", "a character that joins later is affected too, and characters I control but do not own are (controller, not owner)", () => {
  const g = blBoard({
    extra: [
      { key: "late", def: character({ name: "Late", cost: 2, strength: 1, life: 4, speed: 1 }), owner: P1, zone: "hand" },
      { key: "stolen", def: character({ name: "Stolen", cost: 2, strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play", controller: P1 },
      { key: "given", def: character({ name: "Given", cost: 2, strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play", controller: P2 },
      ...bank("rage", 2, P1)
    ]
  });
  attach(g, "host");
  assert.deepEqual(triple(g.engine, g.id("stolen")), [3, 3, 1], "controlled by me");
  assert.deepEqual(triple(g.engine, g.id("given")), [2, 4, 1], "owned by me, controlled by the opponent");
  play(g.engine, P1, g.id("late"));
  assert.deepEqual(triple(g.engine, g.id("late")), [2, 3, 1], "deployed afterwards");
});

clause(BL, "3.0:grant-rule", "losing 1 life takes a 1-life character to 0 life, which destroys it; a 2-life character survives at 1", () => {
  const g = blBoard({
    extra: [
      { key: "frail", def: character({ name: "Frail", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "two", def: character({ name: "Two", cost: 1, strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" }
    ]
  });
  attach(g, "host");
  assert.equal(zoneOf(g.engine, g.id("two")), "play");
  assert.equal(stat(g.engine, g.id("two"), "life"), 1);
  assert.equal(zoneOf(g.engine, g.id("frail")), "discard", "0 life destroys it");
});

// --- When a character you control inflicts battle damage to a faction ---------------

const topOf = (g: BGame, p: Pid) => g.engine.state.players[p].deck[0];
const deckLen = (g: BGame, p: Pid) => g.engine.state.players[p].deck.length;
const discardLen = (g: BGame, p: Pid) => g.engine.state.players[p].discard.length;
const hit = (g: BGame, attackers: string[], blockers: string[] = [], who: Pid = P1) => {
  declareAttackBy(g.engine, who, attackers.map((k) => g.id(k)));
  declareBlockers(g.engine, who === P1 ? P2 : P1, blockers.map((k) => g.id(k)));
  finishBattle(g.engine, undefined, declineAll);
};

clause(BL, "3.1:grant-rule", "an unblocked character I control (here the host) damaging the opponent's faction makes THEM put the top card of their deck into THEIR discard pile", () => {
  const g = blBoard();
  attach(g, "host");
  const top = topOf(g, P2);
  const [deck, disc, myDeck, myDisc] = [deckLen(g, P2), discardLen(g, P2), deckLen(g, P1), discardLen(g, P1)];
  hit(g, ["host"]);
  assert.equal(deckLen(g, P2), deck - 1, "exactly one card left their deck");
  assert.equal(discardLen(g, P2), disc + 1);
  assert.ok(g.engine.state.players[P2].discard.includes(top), "it was the top card");
  assert.equal(zoneOf(g.engine, top), "discard");
  assert.equal(deckLen(g, P1), myDeck, "my deck is untouched");
  assert.equal(discardLen(g, P1), myDisc, "my discard pile is untouched");
});

clause(BL, "3.1:grant-rule", "any character I control, not only the host: another attacker triggers it too", () => {
  const g = blBoard();
  attach(g, "host");
  const top = topOf(g, P2);
  hit(g, ["ally"]);
  assert.equal(deckLen(g, P2), 4);
  assert.ok(g.engine.state.players[P2].discard.includes(top), "g.engine.state.players[P2].discard.includes(top)");
});

clause(BL, "3.1:grant-rule", "no battle damage to a faction, no mill: a blocked attack (damage goes to the blocker) mills nothing", () => {
  const g = blBoard();
  attach(g, "host");
  hit(g, ["host"], ["foe"]);
  assert.equal(deckLen(g, P2), 5);
  assert.equal(discardLen(g, P2), 0);
});

clause(BL, "3.1:grant-rule", "each character that inflicts damage to the faction mills one card: two unblocked attackers mill two", () => {
  const g = blBoard();
  attach(g, "host");
  hit(g, ["host", "ally"]);
  assert.equal(deckLen(g, P2), 3, "two cards milled");
  assert.equal(discardLen(g, P2), 2);
});

clause(BL, "3.1:grant-rule", "an attacker with 0 strength inflicts no damage to the faction, so nothing is milled", () => {
  const dampener = item({
    name: "Dampener",
    behavior: { abilities: [{ id: "damp", type: "continuous", modifiers: [{ selector: { controller: "opponent", type: "character" }, stat: "strength", operation: "add", value: -1 }] }] }
  } as Partial<CardDefinition>);
  const g = blBoard({
    extra: [
      { key: "zero", def: character({ name: "Zero", cost: 1, strength: 0, life: 5, speed: 1 }), owner: P1, zone: "play" },
      { key: "damp", def: dampener, owner: P2, zone: "play" }
    ]
  });
  attach(g, "host");
  assert.equal(stat(g.engine, g.id("zero"), "strength"), 0, "setup: +1 from the Blessing, -1 from the Dampener");
  assert.equal(stat(g.engine, g.id("host"), "strength"), 2, "setup: the host is 2+1-1");
  const inf = g.engine.state.players[P2].influence;
  hit(g, ["zero"]);
  assert.equal(g.engine.state.players[P2].influence, inf, "no damage was dealt");
  assert.equal(deckLen(g, P2), 5, "so nothing was milled");
  assert.equal(discardLen(g, P2), 0);
});

clause(BL, "3.1:grant-rule", "without the Blessing the same unblocked attack mills nothing (positive control)", () => {
  const g = blBoard();
  hit(g, ["host"]);
  assert.equal(deckLen(g, P2), 5);
  assert.equal(discardLen(g, P2), 0);
});

clause(BL, "3.1:grant-rule", "it is only a character I control: the opponent's character damaging MY faction does not mill my deck", () => {
  const g = blBoard({ active: P2, zone: "play", attachedTo: "host" });
  hit(g, ["foe"], [], P2);
  assert.equal(deckLen(g, P1), 5, "my deck is not milled");
  assert.equal(discardLen(g, P1), 0);
});

clause(BL, "3.1:grant-rule", "on an opponent's host, THEIR characters triggering it mill ME (I am the faction's controller): the host's controller is 'you'", () => {
  const g = blBoard({ active: P2, zone: "play", attachedTo: "foe" });
  const top = topOf(g, P1);
  hit(g, ["foe2"], [], P2);
  assert.equal(deckLen(g, P1), 4, "my deck lost one card");
  assert.ok(g.engine.state.players[P1].discard.includes(top), "g.engine.state.players[P1].discard.includes(top)");
  assert.equal(deckLen(g, P2), 5, "their deck is untouched");
});

clause(BL, "3.1:grant-rule", "with an empty deck the faction's controller puts nothing into the discard pile and nothing breaks", () => {
  const g = blBoard();
  attach(g, "host");
  for (const cardId of [...g.engine.state.players[P2].deck]) g.engine.state.players[P2].deck.splice(g.engine.state.players[P2].deck.indexOf(cardId), 1);
  assert.equal(deckLen(g, P2), 0);
  hit(g, ["host"]);
  assert.equal(discardLen(g, P2), 0);
  assert.equal(g.engine.state.battle, undefined);
});

clause(BL, "3.1:grant-rule", "damage to a faction that does not come from a character (a tactic) mills nothing", () => {
  const burn = tactic({
    name: "Burn",
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
  });
  const g = blBoard({ extra: [{ key: "burn", def: burn, owner: P1, zone: "hand" }] });
  attach(g, "host");
  const inf = g.engine.state.players[P2].influence;
  play(g.engine, P1, g.id("burn"));
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.players[P2].influence, inf - 2, "setup: the tactic did damage the faction");
  assert.equal(deckLen(g, P2), 5, "no character inflicted it: no mill");
  assert.equal(discardLen(g, P2), 0);
});

clause(BL, "3.1:grant-rule", "damage from a character's ability (not battle damage) to a faction does not mill", () => {
  const burner = character({
    name: "Burner",
    cost: 1,
    strength: 1,
    life: 3,
    speed: 1,
    behavior: { abilities: [{ id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] }] }
  });
  const g = blBoard({ extra: [{ key: "burner", def: burner, owner: P1, zone: "play" }] });
  attach(g, "host");
  const inf = g.engine.state.players[P2].influence;
  activate(g.engine, P1, g.id("burner"), "burn", {});
  drain(g.engine, declineAll);
  assert.equal(g.engine.state.players[P2].influence, inf - 2, "setup: the ability did damage the faction");
  assert.equal(deckLen(g, P2), 5, "an ability's damage is not battle damage: no mill");
  assert.equal(discardLen(g, P2), 0);
});
