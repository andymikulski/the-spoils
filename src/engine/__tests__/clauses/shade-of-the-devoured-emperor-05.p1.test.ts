// Clause tests — batch shade-of-the-devoured-emperor-05, part p1 (groups 1-4, missing clauses).
// Expectations come from each card's PRINTED text, RULES.md and the Comprehensive Rules / FAQ;
// engine data (ability ids, target declaration ids, choice kinds) is only used to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  bank,
  character,
  developFaction,
  item,
  play,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import { clause, printing, refused, flipUpNow } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, zoneOf } from "./_board.js";
import { endTurn, spentResources } from "./_turn.js";
import { printedCost, printedStats } from "./_printed.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------------

type Engine = SpoilsEngine;
type Board = { engine: Engine; id: (key: string) => CardInstanceId };

/** A free tactic that sends one chosen card (of `type`, in play) to `to` (ability id `s`, declaration `t`). */
function sendTactic(to: "discard" | "hand" | "deck" | "void" | "destroy" | "remove", type: "character" | "item" = "character"): CardDefinition {
  const effect =
    to === "destroy"
      ? { type: "destroy" as const, target: { type: "selected" as const, id: "t" } }
      : to === "remove"
        ? { type: "removeFromGame" as const, target: { type: "selected" as const, id: "t" } }
        : { type: "moveCard" as const, target: { type: "selected" as const, id: "t" }, to };
  return tactic({
    name: `Send-${to}-${type}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [effect] }]
    }
  });
}

/** A free tactic that deals `amount` damage to one chosen character (ability id `d`, declaration `t`). */
function zapTactic(amount: number): CardDefinition {
  return tactic({
    name: `Zap${amount}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "d", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }]
    }
  });
}

const stat3 = (engine: Engine, cardId: CardInstanceId) => [engine.getStat(cardId, "strength"), engine.getStat(cardId, "life"), engine.getStat(cardId, "speed")];
const ready = (engine: Engine, player: PlayerId = P1) => engine.getAvailableResourceCount(player);
const inHand = (engine: Engine, player: PlayerId) => engine.state.players[player].hand;
const inDeck = (engine: Engine, player: PlayerId) => engine.state.players[player].deck;
const influenceOf = (engine: Engine, player: PlayerId) => engine.state.players[player].influence;

// =====================================================================================
// Testudine Autoframe
// =====================================================================================

const TA = "f83b3af9-a7cb-4945-9632-bdfab77a111a"; // cost 7 · [E][E][E][E] · str 5 / spd 4 / life 3
const JO = "4e071253-4a43-404c-aad5-15aa1e953501"; // Jo Ciendeilio (UNIQUE JO) · str 1 / spd 3 / life 1
const JO_IRON = "0de9e2fd-df8a-45a0-9928-c8bfb77a4a72"; // Jo Ciendeilio, Iron Born (UNIQUE JO, a different name)

const ally = (key: string, over: Partial<CardDefinition> = {}, owner: PlayerId = P1): CardPlacement => ({
  key,
  def: character({ name: key, strength: 2, life: 3, speed: 2, ...over }),
  owner,
  zone: "play"
});

function taBoard(extra: CardPlacement[] = [], o: { ta?: "hand" | "play"; elitism?: number; icon?: "elitism" | "rage"; turn?: number; active?: PlayerId } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "ta", def: printing(TA), owner: P1, zone: o.ta ?? "hand" }, ...bank(o.icon ?? "elitism", o.elitism ?? 7, P1), ...extra]
  });
}

/** Deploys the Autoframe and answers its "you may remove a JO" prompt: `pick` = the JO to remove, or nothing to decline. */
function deployTa(b: Board, pick?: CardInstanceId): void {
  play(b.engine, P1, b.id("ta"));
  const pc = pending(b.engine);
  if (pick) assert.ok(pc, "entering play offers the JO prompt");
  if (pc) {
    assert.equal(pc.kind, "selectTargets");
    assert.equal(pc.playerId, P1, "I choose");
    answerPending(b.engine, "selectTargets", { selected: { jo: pick ? [pick] : [] } });
  }
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("ta")), "play");
}

const myJo = (over: Partial<CardPlacement> = {}): CardPlacement => ({ key: "jo", def: printing(JO), owner: P1, zone: "play", ...over });

// --- 0:unique ----------------------------------------------------------------------

const dupBoard = () => taBoard([{ key: "ta2", def: printing(TA), owner: P1, zone: "hand" }], { ta: "play" });

clause(TA, "0:unique", "controlling a second Testudine Autoframe makes me choose which one to keep: the choice is mine and lists both copies", () => {
  const b = dupBoard();
  play(b.engine, P1, b.id("ta2"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ta"), b.id("ta2")].sort());
});

clause(TA, "0:unique", "keeping the new copy destroys the old one", () => {
  const b = dupBoard();
  play(b.engine, P1, b.id("ta2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ta2") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ta2")), "play");
  assert.equal(zoneOf(b.engine, b.id("ta")), "discard", "the other copy is destroyed");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TA, "0:unique", "keeping the old copy destroys the new one", () => {
  const b = dupBoard();
  play(b.engine, P1, b.id("ta2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ta") } } as never);
  assert.equal(zoneOf(b.engine, b.id("ta")), "play");
  assert.equal(zoneOf(b.engine, b.id("ta2")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TA, "0:unique", "after the UNIQUE choice is made the game goes on: the deploy's response window closes", () => {
  const b = dupBoard();
  play(b.engine, P1, b.id("ta2"));
  b.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "uniqueSurvivor", keep: b.id("ta2") } } as never);
  resolvePendingResponses(b.engine); // must converge
  assert.equal(b.engine.state.responseWindow, undefined);
  endTurn(b.engine, P1);
});

clause(TA, "0:unique", "the restriction is per player: the opponent may control their own Testudine Autoframe", () => {
  const b = taBoard([{ key: "ta2", def: printing(TA), owner: P2, zone: "hand" }, ...bank("elitism", 7, P2)], { ta: "play", turn: 2, active: P2 });
  play(b.engine, P2, b.id("ta2"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no choice, nothing destroyed");
  assert.equal(zoneOf(b.engine, b.id("ta")), "play");
  assert.equal(zoneOf(b.engine, b.id("ta2")), "play");
});

clause(TA, "0:unique", "a different UNIQUE designation (a JO, another unique card) or none is not a duplicate", () => {
  const b = taBoard(
    [myJo(), { key: "other", def: character({ name: "Other", unique: "someone else" } as Partial<CardDefinition>), owner: P1, zone: "play" }, ally("plain")],
    { ta: "play" }
  );
  assert.equal(b.engine.state.pendingChoice, undefined);
  for (const key of ["ta", "jo", "other", "plain"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
});

// --- 1:rule — enters play -------------------------------------------------------------

clause(TA, "1:rule", "deploys for 7 with [E][E][E][E] (refused one short, refused without the [E]) and has the printed 5 / 4 / 3", () => {
  const short = taBoard([], { elitism: 6 });
  refused(() => play(short.engine, P1, short.id("ta")), "6 resources");
  assert.equal(zoneOf(short.engine, short.id("ta")), "hand");
  const noIcons = taBoard([], { icon: "rage", elitism: 7 });
  refused(() => play(noIcons.engine, P1, noIcons.id("ta")), "7 resources without [E]");
  assert.equal(zoneOf(noIcons.engine, noIcons.id("ta")), "hand");
  const threeE = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ta", def: printing(TA), owner: P1, zone: "hand" }, ...bank("elitism", 3, P1), ...bank("rage", 4, P1)]
  });
  refused(() => play(threeE.engine, P1, threeE.id("ta")), "7 resources but only three [E]");
  assert.equal(zoneOf(threeE.engine, threeE.id("ta")), "hand");
  const fourE = buildGame({
    playerA: { faction: developFaction() },
    cards: [{ key: "ta", def: printing(TA), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1), ...bank("rage", 3, P1)]
  });
  deployTa(fourE);
  assert.equal(zoneOf(fourE.engine, fourE.id("ta")), "play", "four [E] and three other resources are enough");
  const exact = taBoard();
  assert.equal(ready(exact.engine), 7);
  deployTa(exact);
  assert.equal(ready(exact.engine), 0, "all 7 spent");
  assert.deepEqual(stat3(exact.engine, exact.id("ta")), [5, 3, 4]);
});

clause(TA, "1:rule", "accepting removes my JO from the game (the out-of-game zone, not the void)", () => {
  const b = taBoard([myJo()]);
  deployTa(b, b.id("jo"));
  assert.equal(zoneOf(b.engine, b.id("jo")), "removed", "removed from the game (not in play, not in the discard, not the void)");
  assert.ok(!b.engine.state.players[P1].play.includes(b.id("jo")), "!b.engine.state.players[P1].play.includes(b.id(\"jo\"))");
});

clause(TA, "1:rule", "the removed JO is set aside: not in play, and not in my hand, deck or discard pile", () => {
  const b = taBoard([myJo()]);
  deployTa(b, b.id("jo"));
  const zone = zoneOf(b.engine, b.id("jo"));
  assert.ok(zone === "void" || zone === "removed", `set aside in the void / out of the game, got ${zone}`);
  for (const p of [P1, P2]) {
    const st = b.engine.state.players[p];
    for (const list of [st.hand, st.deck, st.discard, st.play]) assert.ok(!list.includes(b.id("jo")), "!list.includes(b.id(\"jo\"))");
  }
});

clause(TA, "1:rule", "if I removed a JO: this turn each other character I control gains 1 strength and 1 life (not the Autoframe itself, not the opponent's)", () => {
  const b = taBoard([myJo(), ally("a1", { strength: 2, life: 3, speed: 2 }), ally("a2", { strength: 4, life: 1, speed: 5 }), ally("foe", { strength: 2, life: 3, speed: 2 }, P2)]);
  deployTa(b, b.id("jo"));
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2], "a1: +1 strength, +1 life, speed unchanged");
  assert.deepEqual(stat3(b.engine, b.id("a2")), [5, 2, 5], "a2: +1 strength, +1 life, speed unchanged");
  assert.deepEqual(stat3(b.engine, b.id("ta")), [5, 3, 4], "'each OTHER character': the Autoframe is not boosted");
  assert.deepEqual(stat3(b.engine, b.id("foe")), [2, 3, 2], "only characters I control");
});

clause(TA, "1:rule", "the boost lasts this turn only: it is gone once the turn ends", () => {
  const b = taBoard([myJo(), ally("a1")]);
  deployTa(b, b.id("jo"));
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2]);
  endTurn(b.engine, P1);
  assert.deepEqual(stat3(b.engine, b.id("a1")), [2, 3, 2], "back to printed once my turn is over");
  endTurn(b.engine, P2);
  assert.deepEqual(stat3(b.engine, b.id("a1")), [2, 3, 2], "and it does not come back on my next turn");
});

clause(TA, "1:rule", "the boost covers the characters I control when it resolves: one deployed afterwards this turn is not boosted", () => {
  const late = { key: "late", def: character({ name: "Late", cost: 0, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "hand" as const };
  const b = taBoard([myJo(), ally("a1"), late]);
  deployTa(b, b.id("jo"));
  play(b.engine, P1, b.id("late"));
  assert.equal(zoneOf(b.engine, b.id("late")), "play");
  assert.deepEqual(stat3(b.engine, b.id("late")), [2, 3, 2]);
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2]);
});

clause(TA, "1:rule", "declining ('you may'): the JO stays in play and nobody gains anything", () => {
  const b = taBoard([myJo(), ally("a1")]);
  deployTa(b);
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.deepEqual(stat3(b.engine, b.id("a1")), [2, 3, 2], "'if you do' is false");
  assert.deepEqual(stat3(b.engine, b.id("jo")), [1, 1, 3]);
});

clause(TA, "1:rule", "with no JO to remove nothing happens and the other characters gain nothing", () => {
  const b = taBoard([ally("a1")]);
  deployTa(b);
  assert.deepEqual(stat3(b.engine, b.id("a1")), [2, 3, 2]);
});

clause(TA, "1:rule", "only a UNIQUE JO I control can be picked: not the opponent's JO, a JO in hand or discard, a face-down JO, or another character", () => {
  const b = taBoard([
    myJo(),
    { key: "foeJo", def: printing(JO_IRON), owner: P2, zone: "play" },
    { key: "handJo", def: printing(JO), owner: P1, zone: "hand" },
    { key: "discJo", def: printing(JO), owner: P1, zone: "discard" },
    { key: "fdJo", def: printing(JO), owner: P1, zone: "play", faceDown: true },
    ally("a1")
  ]);
  play(b.engine, P1, b.id("ta"));
  assert.equal(pending(b.engine)?.kind, "selectTargets");
  for (const key of ["foeJo", "handJo", "discJo", "fdJo", "a1", "ta"]) {
    refused(() => answerPending(b.engine, "selectTargets", { selected: { jo: [b.id(key)] } }), `${key} is not a JO I control in play`);
    assert.equal(pending(b.engine)?.kind, "selectTargets", `${key}: the prompt is still open`);
  }
  answerPending(b.engine, "selectTargets", { selected: { jo: [b.id("jo")] } });
  assert.notEqual(zoneOf(b.engine, b.id("jo")), "play", "the picked JO left play");
  assert.equal(zoneOf(b.engine, b.id("foeJo")), "play", "the opponent's JO was never touched");
  assert.equal(zoneOf(b.engine, b.id("handJo")), "hand");
});

clause(TA, "1:rule", "any card with the JO designation works whatever its name (Jo Ciendeilio, Iron Born)", () => {
  const b = taBoard([myJo({ key: "ironJo", def: printing(JO_IRON) }), ally("a1")]);
  deployTa(b, b.id("ironJo"));
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2]);
});

clause(TA, "1:rule", "a JO I control but do not own can be picked", () => {
  const b = taBoard([myJo({ owner: P2, controller: P1 }), ally("a1")]);
  deployTa(b, b.id("jo"));
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2]);
  assert.notEqual(zoneOf(b.engine, b.id("jo")), "play");
});

clause(TA, "1:rule", "'when this card enters play' covers every way in: put into play by an effect it offers the same choice", () => {
  const summon = tactic({
    name: "Summon",
    cost: 0,
    behavior: {
      abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "hand", type: "character" }, count: 1 }], effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }] }]
    }
  });
  const b = taBoard([myJo(), ally("a1"), { key: "summon", def: summon, owner: P1, zone: "hand" }], { elitism: 0 });
  play(b.engine, P1, b.id("summon"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("ta")), "play");
  assert.equal(pending(b.engine)?.kind, "selectTargets");
  answerPending(b.engine, "selectTargets", { selected: { jo: [b.id("jo")] } });
  assert.notEqual(zoneOf(b.engine, b.id("jo")), "play");
  assert.deepEqual(stat3(b.engine, b.id("a1")), [3, 4, 2]);
});

// --- 2:rule — everyone can attack ------------------------------------------------------

const fresh = (key: string, owner: PlayerId = P1, controller?: PlayerId): CardPlacement => ({
  key,
  def: character({ name: key, strength: 2, life: 2, speed: 2 }),
  owner,
  controller,
  zone: "play",
  attackEligible: false
});

clause(TA, "2:rule", "a character that has not been in play under my control since the start of the turn can attack while the Autoframe is in play (and not without it)", () => {
  const withTa = taBoard([fresh("fresh")], { ta: "play" });
  declareAttackBy(withTa.engine, P1, [withTa.id("fresh")]);
  assert.ok(battleOf(withTa.engine), "the attack was declared");
  const without = taBoard([fresh("fresh")], { ta: "hand" });
  refused(() => declareAttackBy(without.engine, P1, [without.id("fresh")]), "a fresh character cannot attack without the Autoframe (it can with it, above)", /AGGRO/);
  assert.equal(battleOf(without.engine), undefined);
});

clause(TA, "2:rule", "it covers a character I took control of this turn and the Autoframe itself on the turn it is deployed", () => {
  const stolen = taBoard([fresh("stolen", P2, P1)], { ta: "play" });
  declareAttackBy(stolen.engine, P1, [stolen.id("stolen")]);
  assert.ok(battleOf(stolen.engine), "battleOf(stolen.engine)");
  const self = taBoard();
  deployTa(self);
  declareAttackBy(self.engine, P1, [self.id("ta")]);
  assert.ok(battleOf(self.engine), "the Autoframe attacks the turn it enters");
});

clause(TA, "2:rule", "a character deployed from my hand this turn, after the Autoframe, can attack", () => {
  const b = taBoard([{ key: "late", def: character({ name: "Late", cost: 0, strength: 2, life: 2, speed: 2 }), owner: P1, zone: "hand" }], { ta: "play" });
  play(b.engine, P1, b.id("late"));
  declareAttackBy(b.engine, P1, [b.id("late")]);
  assert.ok(battleOf(b.engine), "battleOf(b.engine)");
});

clause(TA, "2:rule", "'characters you control' only: the opponent's fresh characters still cannot attack on their turn", () => {
  const b = taBoard([fresh("foeFresh", P2), ally("foeOld", {}, P2)], { ta: "play", turn: 2, active: P2 });
  refused(() => declareAttackBy(b.engine, P2, [b.id("foeFresh")]), "the opponent's fresh character is not covered (control: their old character attacks below)", /AGGRO/);
  assert.equal(battleOf(b.engine), undefined);
  declareAttackBy(b.engine, P2, [b.id("foeOld")]);
  assert.ok(battleOf(b.engine), "control: their eligible character attacks");
});

clause(TA, "2:rule", "the rule is gone once the Autoframe has left play, and stays gone", () => {
  const b = taBoard([fresh("fresh"), { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }], { ta: "play" });
  assert.ok(b.engine.getKeywords(b.id("fresh")).includes("aggro"), "on while it is in play");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("ta")), "discard");
  assert.ok(!b.engine.getKeywords(b.id("fresh")).includes("aggro"), "!b.engine.getKeywords(b.id(\"fresh\")).includes(\"aggro\")");
  refused(() => declareAttackBy(b.engine, P1, [b.id("fresh")]), "the aura is gone", /AGGRO/);
  refused(() => declareAttackBy(b.engine, P1, [b.id("fresh")]), "and still gone", /AGGRO/);
  assert.equal(battleOf(b.engine), undefined);
});

// --- 3:rule — leaves play ----------------------------------------------------------------

type LeaveKind = "destroy" | "hand" | "deck" | "remove" | "void" | "discard";
/** The Autoframe removes my JO, then leaves play by `how`: the JO must come back into play under my control. */
function leavesReturnsJo(how: LeaveKind): void {
  const b = taBoard([myJo({ damage: 0 }), ally("a1"), { key: "send", def: sendTactic(how), owner: P1, zone: "hand" }]);
  deployTa(b, b.id("jo"));
  assert.notEqual(zoneOf(b.engine, b.id("jo")), "play", "the JO is gone while the Autoframe is in play");
  play(b.engine, P1, b.id("send"), { selected: { t: [b.id("ta")] } });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.notEqual(zoneOf(b.engine, b.id("ta")), "play", "the Autoframe left play");
  assert.equal(zoneOf(b.engine, b.id("jo")), "play", "the JO is back in play");
  assert.equal(b.engine.state.cards[b.id("jo")].controllerId, P1, "under my control");
  assert.equal(b.engine.state.players[P1].play.filter((c) => c === b.id("jo")).length, 1, "exactly once");
  assert.equal(b.engine.state.cards[b.id("jo")].faceDown, false);
  assert.deepEqual(stat3(b.engine, b.id("jo")), [1, 1, 3]);
}

clause(TA, "3:rule", "when it is destroyed the removed JO is put into play under my control", () => leavesReturnsJo("destroy"));
clause(TA, "3:rule", "when it is returned to its owner's hand the removed JO comes back", () => leavesReturnsJo("hand"));
clause(TA, "3:rule", "when it is put into a deck the removed JO comes back", () => leavesReturnsJo("deck"));
clause(TA, "3:rule", "when it is removed from the game the removed JO comes back", () => leavesReturnsJo("remove"));
clause(TA, "3:rule", "when it is put into the void the removed JO comes back", () => leavesReturnsJo("void"));
clause(TA, "3:rule", "when it is put into the discard pile (not destroyed) the removed JO comes back", () => leavesReturnsJo("discard"));

clause(TA, "3:rule", "a JO I controlled but did not own comes back under my control (the Autoframe's controller), still owned by its owner", () => {
  const b = taBoard([myJo({ owner: P2, controller: P1 }), { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }]);
  deployTa(b, b.id("jo"));
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(b.engine.state.cards[b.id("jo")].controllerId, P1);
  assert.equal(b.engine.state.cards[b.id("jo")].ownerId, P2);
});

clause(TA, "3:rule", "'under your control' is whoever controls the Autoframe when it leaves: if the opponent took it, the JO comes back under THEIR control", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: { abilities: [{ id: "s", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }] }] }
  });
  const b = taBoard([myJo(), { key: "steal", def: steal, owner: P2, zone: "hand" }, { key: "kill", def: sendTactic("destroy"), owner: P2, zone: "hand" }]);
  deployTa(b, b.id("jo"));
  endTurn(b.engine, P1);
  play(b.engine, P2, b.id("steal"), { selected: { t: [b.id("ta")] } });
  assert.equal(b.engine.state.cards[b.id("ta")].controllerId, P2, "the opponent took the Autoframe");
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("ta")), "discard");
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(b.engine.state.cards[b.id("jo")].controllerId, P2, "'you' is the Autoframe's controller when it leaves play");
  assert.equal(b.engine.state.cards[b.id("jo")].ownerId, P1);
});

clause(TA, "3:rule", "the returned JO is a fresh card: no damage, not depleted", () => {
  const b = taBoard([myJo({ damage: 0, depleted: true }), { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }]);
  deployTa(b, b.id("jo"));
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(b.engine.state.cards[b.id("jo")].depleted, false);
  assert.equal(b.engine.state.cards[b.id("jo")].damage ?? 0, 0);
});

clause(TA, "3:rule", "if it removed no JO, leaving play puts no JO into play: a JO in the void or the discard stays where it is", () => {
  const b = taBoard([
    { key: "voidJo", def: printing(JO), owner: P1, zone: "void" },
    { key: "discJo", def: printing(JO_IRON), owner: P1, zone: "discard" },
    { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }
  ]);
  deployTa(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("ta")), "discard");
  assert.equal(zoneOf(b.engine, b.id("voidJo")), "void");
  assert.equal(zoneOf(b.engine, b.id("discJo")), "discard");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TA, "3:rule", "declining the removal keeps my JO in play, and it is not duplicated or disturbed when the Autoframe leaves", () => {
  const b = taBoard([myJo(), { key: "kill", def: sendTactic("destroy"), owner: P1, zone: "hand" }]);
  deployTa(b);
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(b.engine.state.players[P1].play.filter((c) => b.engine.state.cards[c].definitionId === b.engine.state.cards[b.id("jo")].definitionId).length, 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(TA, "3:rule", "only a JO removed 'by this card': a later stint of the Autoframe that removed nothing does not bring the old JO back again", () => {
  const b = taBoard(
    [
      myJo(),
      { key: "send", def: sendTactic("hand"), owner: P1, zone: "hand" },
      { key: "killJo", def: sendTactic("destroy"), owner: P1, zone: "hand" },
      { key: "killTa", def: sendTactic("destroy"), owner: P1, zone: "hand" }
    ],
    { elitism: 14 }
  );
  deployTa(b, b.id("jo")); // removes the JO
  play(b.engine, P1, b.id("send"), { selected: { t: [b.id("ta")] } }); // bounce: the JO returns
  assert.equal(zoneOf(b.engine, b.id("jo")), "play");
  assert.equal(zoneOf(b.engine, b.id("ta")), "hand");
  play(b.engine, P1, b.id("killJo"), { selected: { t: [b.id("jo")] } }); // the JO later dies
  assert.equal(zoneOf(b.engine, b.id("jo")), "discard");
  deployTa(b); // a new Autoframe object: no JO in play, nothing removed
  play(b.engine, P1, b.id("killTa"), { selected: { t: [b.id("ta")] } });
  assert.equal(zoneOf(b.engine, b.id("ta")), "discard");
  assert.equal(zoneOf(b.engine, b.id("jo")), "discard", "that JO was not removed by this stint of the card");
});

// =====================================================================================
// Thabbashite Armorer
// =====================================================================================

const ARM = "18d50b0d-08aa-4c7a-a37f-bacfd8585be0"; // cost 4 · [E] · str 2 / spd 3 / life 2

function armBoard(o: { vol?: number; rage?: number; spentVol?: number; influence?: number; arm?: "play" | "hand"; extra?: CardPlacement[] } = {}): Board {
  const spent = volition(o.spentVol ?? 0, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }));
  return buildGame({
    playerA: { faction: developFaction(), influence: o.influence },
    playerB: { faction: developFaction() },
    cards: [{ key: "arm", def: printing(ARM), owner: P1, zone: o.arm ?? "play" }, ...volition(o.vol ?? 0, P1), ...bank("rage", o.rage ?? 0, P1), ...spent, ...(o.extra ?? [])]
  });
}
const forThabbash = (b: Board) => activate(b.engine, P1, b.id("arm"), "ta-forthabbash");
const tameshigiri = (b: Board) => activate(b.engine, P1, b.id("arm"), "ta-tameshigiri");
const ARM_PRINTED = [2, 2, 3]; // strength, life, speed

// --- FOR THABBASH -----------------------------------------------------------------------

clause(ARM, "0:ability:ta-forthabbash", "pays 2 and this card gains 1 strength and 1 life this turn (speed unchanged)", () => {
  const b = armBoard({ vol: 3, rage: 4 });
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED);
  assert.equal(ready(b.engine), 7);
  forThabbash(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [3, 3, 3]);
  assert.equal(ready(b.engine), 5, "exactly 2 resources were paid");
});

clause(ARM, "0:ability:ta-forthabbash", "needs [V][V][V]: two face-down cards among plenty of other resources is refused, three is accepted", () => {
  const two = armBoard({ vol: 2, rage: 5 });
  refused(() => forThabbash(two), "only two Volition");
  assert.equal(ready(two.engine), 7, "nothing was paid");
  assert.deepEqual(stat3(two.engine, two.id("arm")), ARM_PRINTED);
  const three = armBoard({ vol: 3, rage: 4 });
  forThabbash(three);
  assert.deepEqual(stat3(three.engine, three.id("arm")), [3, 3, 3], "control: three Volition");
});

clause(ARM, "0:ability:ta-forthabbash", "pay 2 must be affordable: with only one ready resource left it is refused", () => {
  const poor = armBoard({ vol: 1, spentVol: 2 });
  refused(() => forThabbash(poor), "one ready resource is not 2");
  assert.deepEqual(stat3(poor.engine, poor.id("arm")), ARM_PRINTED);
  const ok = armBoard({ vol: 2, spentVol: 1 });
  forThabbash(ok);
  assert.deepEqual(stat3(ok.engine, ok.id("arm")), [3, 3, 3], "control: two ready resources");
});

clause(ARM, "0:ability:ta-forthabbash", "two uses stack (+2 / +2), and a third needs two more resources", () => {
  const b = armBoard({ vol: 5 });
  forThabbash(b);
  forThabbash(b);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [4, 4, 3]);
  assert.equal(ready(b.engine), 1);
  refused(() => forThabbash(b), "one ready resource left");
  assert.deepEqual(stat3(b.engine, b.id("arm")), [4, 4, 3]);
});

clause(ARM, "0:ability:ta-forthabbash", "only this card gains the stats: my other characters and the opponent's are unaffected", () => {
  const b = armBoard({ vol: 3, extra: [ally("mine"), ally("foe", {}, P2)] });
  forThabbash(b);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [3, 3, 3]);
  assert.deepEqual(stat3(b.engine, b.id("mine")), [2, 3, 2]);
  assert.deepEqual(stat3(b.engine, b.id("foe")), [2, 3, 2]);
});

clause(ARM, "0:ability:ta-forthabbash", "the gain lasts this turn only", () => {
  const b = armBoard({ vol: 3 });
  forThabbash(b);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [3, 3, 3]);
  endTurn(b.engine, P1);
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED);
  endTurn(b.engine, P2);
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED, "and not back on my next turn");
});

clause(ARM, "0:ability:ta-forthabbash", "only its controller can use it, and only while it is in play", () => {
  const theirs = armBoard({ vol: 3, extra: bank("rage", 4, P2) });
  refused(() => activate(theirs.engine, P2, theirs.id("arm"), "ta-forthabbash"), "the opponent cannot use my Armorer");
  assert.deepEqual(stat3(theirs.engine, theirs.id("arm")), ARM_PRINTED);
  const hand = armBoard({ vol: 3, arm: "hand" });
  refused(() => forThabbash(hand), "from the hand");
  assert.equal(ready(hand.engine), 3);
});

// --- TAMESHIGIRI -------------------------------------------------------------------------

clause(ARM, "1:ability:ta-tameshigiri", "pays 2 resources and 2 influence; this card gains 2 strength and 2 life this turn (speed unchanged)", () => {
  const b = armBoard({ vol: 6, rage: 2, influence: 10 });
  tameshigiri(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [4, 4, 3]);
  assert.equal(ready(b.engine), 6, "exactly 2 resources were paid");
  assert.equal(influenceOf(b.engine, P1), 8, "my faction lost exactly 2 influence");
});

clause(ARM, "1:ability:ta-tameshigiri", "the opponent's faction does not lose influence", () => {
  const b = armBoard({ vol: 6, influence: 10 });
  const before = influenceOf(b.engine, P2);
  tameshigiri(b);
  assert.equal(influenceOf(b.engine, P2), before);
});

clause(ARM, "1:ability:ta-tameshigiri", "needs six Volition: five face-down cards among other resources is refused (nothing paid), six is accepted", () => {
  const five = armBoard({ vol: 5, rage: 3, influence: 10 });
  refused(() => tameshigiri(five), "only five Volition");
  assert.equal(ready(five.engine), 8);
  assert.equal(influenceOf(five.engine, P1), 10);
  assert.deepEqual(stat3(five.engine, five.id("arm")), ARM_PRINTED);
  const six = armBoard({ vol: 6, rage: 2, influence: 10 });
  tameshigiri(six);
  assert.deepEqual(stat3(six.engine, six.id("arm")), [4, 4, 3], "control: six Volition");
});

clause(ARM, "1:ability:ta-tameshigiri", "the influence cost must be affordable: with 1 influence it is refused and nothing is paid", () => {
  const b = armBoard({ vol: 6, rage: 2, influence: 1 });
  refused(() => tameshigiri(b), "1 influence cannot pay 2");
  assert.equal(influenceOf(b.engine, P1), 1);
  assert.equal(ready(b.engine), 8, "no resources were paid either");
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED);
});

clause(ARM, "1:ability:ta-tameshigiri", "'lose 2 influence' with exactly 2 influence can be paid, to 0, and a faction at 0 influence loses the game (RULES.md §11); with 3 influence it just goes to 1", () => {
  const exact = armBoard({ vol: 6, rage: 2, influence: 2 });
  tameshigiri(exact);
  assert.equal(influenceOf(exact.engine, P1), 0, "the 2 influence was paid, down to 0");
  assert.equal(ready(exact.engine), 6, "the 2 resources were paid too");
  assert.equal(exact.engine.state.winner, P2, "my faction is at 0 influence, so I lose and the opponent wins");
  const spare = armBoard({ vol: 6, rage: 2, influence: 3 });
  tameshigiri(spare);
  assert.equal(influenceOf(spare.engine, P1), 1);
  assert.equal(spare.engine.state.winner, undefined, "control: 1 influence left, the game goes on");
});

clause(ARM, "1:ability:ta-tameshigiri", "pay 2 must be affordable: with one ready resource it is refused and no influence is lost", () => {
  const b = armBoard({ vol: 1, spentVol: 5, influence: 10 });
  refused(() => tameshigiri(b), "one ready resource is not 2");
  assert.equal(influenceOf(b.engine, P1), 10);
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED);
  const ok = armBoard({ vol: 2, spentVol: 4, influence: 10 });
  tameshigiri(ok);
  assert.equal(influenceOf(ok.engine, P1), 8, "control: two ready resources");
});

clause(ARM, "1:ability:ta-tameshigiri", "stacks with FOR THABBASH (+3 / +3 in total) and the gain lasts this turn only", () => {
  const b = armBoard({ vol: 8, influence: 10 });
  forThabbash(b);
  tameshigiri(b);
  assert.deepEqual(stat3(b.engine, b.id("arm")), [5, 5, 3]);
  assert.equal(ready(b.engine), 4);
  assert.equal(influenceOf(b.engine, P1), 8);
  endTurn(b.engine, P1);
  assert.deepEqual(stat3(b.engine, b.id("arm")), ARM_PRINTED);
});

clause(ARM, "1:ability:ta-tameshigiri", "only this card gains the stats and only its controller can use it", () => {
  const b = armBoard({ vol: 6, influence: 10, extra: [ally("mine"), ...bank("rage", 6, P2)] });
  refused(() => activate(b.engine, P2, b.id("arm"), "ta-tameshigiri"), "the opponent cannot use my Armorer");
  assert.equal(influenceOf(b.engine, P1), 10);
  tameshigiri(b);
  assert.deepEqual(stat3(b.engine, b.id("mine")), [2, 3, 2]);
});

// =====================================================================================
// Backdoor Brigand
// =====================================================================================

const BB = "766149f5-0021-41ca-bbc5-4dbf8484de40"; // cost 3 · [D] · str 2 / spd 4 / life 3

const attached = (engine: Engine, player: PlayerId) =>
  engine.state.players[player].play.filter((c) => engine.isResource(c) && engine.state.cards[c].attachedTo === engine.state.players[player].factionId).length;

function bbBoard(o: { dec?: number; spent?: number; bb?: Partial<CardPlacement>; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "bb", def: printing(BB), owner: P1, zone: "play", ...o.bb }, ...bank("deception", o.dec ?? 4, P1), ...spentResources(P1, o.spent ?? 0), ...(o.extra ?? [])]
  });
}
const exitBb = (b: Board) => activate(b.engine, P1, b.id("bb"), "bb-exit");
const exitBbRaw = (b: Board) => b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("bb"), abilityId: "bb-exit", selected: {}, variables: {} } as never);
const flipUp = (engine: Engine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}) =>
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
const foeChar = (key: string, over: Partial<CardDefinition> = {}): CardPlacement => ({ key, def: character({ name: key, strength: 2, life: 5, speed: 2, ...over }), owner: P2, zone: "play" });

clause(BB, "0:ability:bb-exit", "pays 1 and flips this card face-down: it stays in play as a face-down resource", () => {
  const b = bbBoard();
  exitBb(b);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  assert.equal(b.engine.isResource(b.id("bb")), true, "a face-down card is a resource");
  assert.equal(attached(b.engine, P1), 1, "exactly 1 resource was paid");
  assert.equal(b.engine.state.cards[b.id("bb")].controllerId, P1);
});

clause(BB, "0:ability:bb-exit", "pay 1 must be affordable: with every resource already spent it is refused and the Brigand stays face-up", () => {
  const b = bbBoard({ dec: 0, spent: 3 });
  refused(() => exitBb(b), "no ready resources");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  const one = bbBoard({ dec: 1, spent: 3 });
  exitBb(one);
  assert.equal(one.engine.state.cards[one.id("bb")].faceDown, true, "control: one ready resource");
});

clause(BB, "0:ability:bb-exit", "refused once it has assigned battle damage this turn (attacking), allowed again the next turn", () => {
  const b = bbBoard({ dec: 4 });
  const foeInfluence = influenceOf(b.engine, P2);
  declareAttackBy(b.engine, P1, [b.id("bb")]);
  declareBlockers(b.engine, P2, []);
  finishBattle(b.engine);
  assert.ok(influenceOf(b.engine, P2) < foeInfluence, "it dealt battle damage");
  refused(() => exitBb(b), "it has assigned damage this turn");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  assert.equal(attached(b.engine, P1), 0, "nothing was paid by the refusal");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  exitBb(b);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true, "'this turn' has passed");
});

clause(BB, "0:ability:bb-exit", "refused once it has assigned damage as a BLOCKER this turn", () => {
  const board = () =>
    bbBoard({ dec: 4, turn: 2, active: P2, extra: [foeChar("atk", { strength: 2, life: 5, speed: 2 }), { key: "bounce", def: sendTactic("hand"), owner: P2, zone: "hand" }] });
  const b = board();
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  declareBlockers(b.engine, P1, [b.id("bb")]);
  finishBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play", "the Brigand survived the block");
  assert.ok((b.engine.state.cards[b.id("atk")].damage ?? 0) > 0, "and damaged the attacker");
  playRaw(b.engine, P2, b.id("bounce"), { selected: { t: [b.id("atk")] } }); // gives me a response window
  refused(() => exitBbRaw(b), "it assigned damage while blocking");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  // control: the same window without the block
  const c = board();
  playRaw(c.engine, P2, c.id("bounce"), { selected: { t: [c.id("atk")] } });
  exitBbRaw(c);
  resolvePendingResponses(c.engine);
  assert.equal(c.engine.state.cards[c.id("bb")].faceDown, true);
});

clause(BB, "0:ability:bb-exit", "damage it TOOK (but did not assign) does not stop it", () => {
  const b = bbBoard({ dec: 4, extra: [{ key: "zap", def: zapTactic(1), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id("bb")] } });
  assert.equal(b.engine.state.cards[b.id("bb")].damage, 1, "the Brigand is damaged");
  exitBb(b);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
});

clause(BB, "0:ability:bb-exit", "used in response to its own attack it leaves the battle before assigning damage: the battle ends and nothing is dealt", () => {
  const b = bbBoard({ dec: 4 });
  const foeInfluence = influenceOf(b.engine, P2);
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("bb")], target: { type: "faction", playerId: P2 } } as never);
  exitBb(b);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  assert.equal(influenceOf(b.engine, P2), foeInfluence, "no damage was dealt");
  assert.equal(battleOf(b.engine), undefined, "an emptied attacking party ends the battle (CR 302.15)");
  endTurn(b.engine, P1); // the game can go on
});

clause(BB, "0:ability:bb-exit", "in response to a removal tactic aimed at it, the flip makes the tactic miss (the face-down card is a new card)", () => {
  const b = bbBoard({ dec: 4, turn: 2, active: P2, extra: [{ key: "kill", def: sendTactic("destroy"), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("kill"), { selected: { t: [b.id("bb")] } });
  exitBbRaw(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play", "not destroyed");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
});

clause(BB, "0:ability:bb-exit", "it is flipped face-down under its OWNER's control, even if someone else controlled it", () => {
  const b = bbBoard({ bb: { owner: P2, controller: P1 } });
  assert.equal(b.engine.state.cards[b.id("bb")].controllerId, P1, "I control it");
  exitBb(b);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("bb")].controllerId, P2, "now under its owner's control");
  assert.ok(b.engine.state.players[P2].play.includes(b.id("bb")), "b.engine.state.players[P2].play.includes(b.id(\"bb\"))");
  assert.ok(!b.engine.state.players[P1].play.includes(b.id("bb")), "!b.engine.state.players[P1].play.includes(b.id(\"bb\"))");
});

clause(BB, "1:flipUp", "a face-down Backdoor Brigand is a resource providing Volition", () => {
  const b = bbBoard({ dec: 2, bb: { faceDown: true } });
  assert.equal(b.engine.isResource(b.id("bb")), true);
  assert.equal(ready(b.engine), 3, "two Deception plus the face-down card");
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(BB, "1:flipUp", "FLIP UP 3 [D][D]: flips face-up into play with the printed 2 / 4 / 3; the card pays for itself, so two other resources do the rest", () => {
  const b = bbBoard({ dec: 2, bb: { faceDown: true } });
  flipUp(b.engine, P1, b.id("bb"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("bb")), "play");
  assert.deepEqual(stat3(b.engine, b.id("bb")), [2, 3, 4]);
  assert.equal(b.engine.state.cards[b.id("bb")].controllerId, P1);
  assert.equal(attached(b.engine, P1), 2, "the two Deception resources were spent");
  assert.equal(ready(b.engine), 0, "and the card is no longer a resource");
});

clause(BB, "1:flipUp", "the cost is 3 in total: with plenty of resources only 3 are spent (the card may pay one itself)", () => {
  const b = bbBoard({ dec: 4, bb: { faceDown: true } });
  flipUp(b.engine, P1, b.id("bb"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, false);
  const spent = attached(b.engine, P1);
  assert.ok(spent === 2 || spent === 3, `a cost of 3 in total (the card may pay one itself): 2 or 3 others spent, got ${spent}`);
  assert.equal(ready(b.engine), 4 - spent, "the rest are untouched and the flipped card is no longer a resource");
});

clause(BB, "1:flipUp", "needs [D][D]: one Deception among other resources is refused (still face-down, nothing paid)", () => {
  const b = bbBoard({ dec: 1, spent: 0, bb: { faceDown: true }, extra: bank("rage", 4, P1) });
  assert.equal(ready(b.engine), 6);
  refused(() => flipUp(b.engine, P1, b.id("bb")), "one [D]");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  assert.equal(attached(b.engine, P1), 0);
  const none = bbBoard({ dec: 0, bb: { faceDown: true }, extra: bank("rage", 5, P1) });
  refused(() => flipUp(none.engine, P1, none.id("bb")), "no [D]");
});

clause(BB, "1:flipUp", "the cost of 3 must be affordable: two [D] with one of them already spent is refused", () => {
  const b = bbBoard({ dec: 1, bb: { faceDown: true }, extra: bank("deception", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(b.engine), 2, "one ready Deception and the face-down card");
  refused(() => flipUp(b.engine, P1, b.id("bb")), "only 2 ready resources for a cost of 3");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
});

clause(BB, "1:flipUp", "a character is only deployed on its controller's turn: in the opponent's response window it cannot be flipped up", () => {
  const b = bbBoard({ dec: 4, turn: 2, active: P2, bb: { faceDown: true }, extra: [foeChar("atk")] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  refused(() => flipUp(b.engine, P1, b.id("bb")), "not a tactic, not my turn");
  assert.equal(b.engine.state.cards[b.id("bb")].faceDown, true);
  assert.equal(attached(b.engine, P1), 0);
});

clause(BB, "1:flipUp", "only its controller can flip it up, and only while it is a face-down card in play", () => {
  const theirs = bbBoard({ dec: 4, bb: { faceDown: true }, extra: bank("deception", 4, P2) });
  refused(() => flipUp(theirs.engine, P2, theirs.id("bb")), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("bb")].faceDown, true);
  const hand = bbBoard({ dec: 4, bb: { zone: "hand" } });
  refused(() => flipUp(hand.engine, P1, hand.id("bb")), "from the hand it is not a face-down resource");
  assert.equal(zoneOf(hand.engine, hand.id("bb")), "hand");
});

// =====================================================================================
// Banana Peel
// =====================================================================================

const BP = "386bbf0c-3e4d-4db2-b476-70ce87b7e228"; // item · cost 3 · [D][D] · TACTICAL · FLIP UP 3 [D][D][D]

function bpBoard(o: { dec?: number; rage?: number; peel?: Partial<CardPlacement>; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}): Board {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: o.turn,
    activePlayerId: o.active,
    cards: [{ key: "peel", def: printing(BP), owner: P1, zone: "hand", ...o.peel }, ...bank("deception", o.dec ?? 3, P1), ...bank("rage", o.rage ?? 0, P1), ...(o.extra ?? [])]
  });
}
/** The opponent's turn: P2 is active and has the attacker `atk`; then it declares the attack and leaves the declaration window open for me. */
const foeTurnBoard = (o: { dec?: number; rage?: number; peel?: Partial<CardPlacement>; extra?: CardPlacement[]; atk?: Partial<CardPlacement> } = {}): Board => {
  const b = bpBoard({ dec: o.dec, rage: o.rage, peel: o.peel, turn: 2, active: P2, extra: [{ ...foeChar("atk", { strength: 2, life: 5, speed: 3 }), ...o.atk }, ...(o.extra ?? [])] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  return b;
};
const slipRaw = (b: Board, pick: CardInstanceId, player: PlayerId = P1) =>
  b.engine.perform({ type: "activateAbility", playerId: player, cardId: b.id("peel"), abilityId: "banana-peel-slip", selected: { atk: [pick] }, variables: {} } as never);

/** Answers the "you may pay 1" prompt of the Peel when one is open (returns whether there was one). */
function answerPeelPrompt(b: Board, accept: boolean): boolean {
  const pc = pending(b.engine);
  if (!pc) return false;
  assert.equal(pc.kind, "mayPay", "the only prompt is the optional payment");
  assert.equal(pc.playerId, P1, "I decide");
  answerPending(b.engine, "mayPay", { pay: accept });
  return true;
}

// --- TACTICAL ------------------------------------------------------------------------------

clause(BP, "0:kw:TACTICAL", "has the TACTICAL keyword", () => {
  const b = bpBoard();
  assert.ok(b.engine.getKeywords(b.id("peel")).includes("tactical"), "b.engine.getKeywords(b.id(\"peel\")).includes(\"tactical\")");
});

clause(BP, "0:kw:TACTICAL", "an item can normally only be deployed on my own turn; being TACTICAL, it can be deployed in the opponent's response window", () => {
  const plain = item({ name: "Plain", cost: 0 });
  const b = foeTurnBoard({ dec: 3, rage: 3, extra: [{ key: "plain", def: plain, owner: P1, zone: "hand" }] });
  refused(() => play(b.engine, P1, b.id("plain")), "an ordinary item cannot be deployed on the opponent's turn");
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  play(b.engine, P1, b.id("peel"));
  answerPeelPrompt(b, true);
  assert.equal(zoneOf(b.engine, b.id("peel")), "play", "the Banana Peel is deployed");
});

clause(BP, "0:kw:TACTICAL", "TACTICAL is active while it is a face-down resource: it can be flipped up in the opponent's response window", () => {
  const b = foeTurnBoard({ dec: 3, rage: 3, peel: { zone: "play", faceDown: true } });
  assert.equal(b.engine.isResource(b.id("peel")), true);
  flipUp(b.engine, P1, b.id("peel"));
  resolvePendingResponses(b.engine);
  answerPeelPrompt(b, true);
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("peel")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("peel")), "play");
});

// --- the optional extra cost -----------------------------------------------------------------

clause(BP, "1:ability", "deploys for 3 with [D][D] (refused one short, refused without the [D]); on my own turn there is no extra cost and no prompt", () => {
  const short = bpBoard({ dec: 2 });
  refused(() => play(short.engine, P1, short.id("peel")), "2 resources");
  const noIcon = bpBoard({ dec: 0, rage: 3 });
  refused(() => play(noIcon.engine, P1, noIcon.id("peel")), "3 resources without [D]");
  assert.equal(zoneOf(noIcon.engine, noIcon.id("peel")), "hand");
  const b = bpBoard({ dec: 3, rage: 3 });
  play(b.engine, P1, b.id("peel"));
  assert.equal(b.engine.state.pendingChoice, undefined, "no 'may pay 1' on my own turn");
  assert.equal(zoneOf(b.engine, b.id("peel")), "play");
  assert.equal(attached(b.engine, P1), 3, "exactly 3 spent");
});

clause(BP, "1:ability", "deployed during an opponent's turn and paying the extra 1: it stays in play and 4 resources are spent in total", () => {
  const b = foeTurnBoard({ dec: 3, rage: 3 });
  play(b.engine, P1, b.id("peel"));
  answerPeelPrompt(b, true);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("peel")), "play");
  assert.equal(attached(b.engine, P1), 4, "3 for the card + 1 extra");
});

clause(BP, "1:ability", "deployed during an opponent's turn: the extra 1 is something I MAY pay: I am offered it", () => {
  const b = foeTurnBoard({ dec: 3, rage: 3 });
  play(b.engine, P1, b.id("peel"));
  assert.equal(pending(b.engine)?.kind, "mayPay", "I am offered the extra payment");
  assert.equal(pending(b.engine)?.playerId, P1);
  answerPending(b.engine, "mayPay", { pay: true });
  assert.equal(attached(b.engine, P1), 4);
});

clause(BP, "1:ability", "deployed during an opponent's turn: if I do not pay the 1, it is terminated (goes to its owner's discard) and only the 3 are spent", () => {
  const b = foeTurnBoard({ dec: 3, rage: 3 });
  play(b.engine, P1, b.id("peel"));
  assert.equal(pending(b.engine)?.kind, "mayPay", "I am offered the extra payment");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard", "terminated");
  assert.equal(attached(b.engine, P1), 3, "the 3 were paid, the extra 1 was not");
});

clause(BP, "1:ability", "deployed during an opponent's turn with exactly 3 resources I cannot pay the extra 1, so it can still be played and is terminated", () => {
  const b = foeTurnBoard({ dec: 3, rage: 0 });
  play(b.engine, P1, b.id("peel"));
  answerPeelPrompt(b, false);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard", "terminated for want of the extra 1");
  assert.equal(attached(b.engine, P1), 3);
});

clause(BP, "1:ability", "flipping it up during an opponent's turn is also playing it during that turn: the same optional extra 1 applies", () => {
  const b = foeTurnBoard({ dec: 3, rage: 3, peel: { zone: "play", faceDown: true } });
  flipUp(b.engine, P1, b.id("peel"));
  assert.equal(pending(b.engine)?.kind, "mayPay", "the extra payment is offered");
  answerPending(b.engine, "mayPay", { pay: false });
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard", "terminated when I do not pay");
});

// --- SLIP ----------------------------------------------------------------------------------------

const slipBoard = (o: { extra?: CardPlacement[]; atk?: Partial<CardPlacement> } = {}): Board =>
  foeTurnBoard({ dec: 0, peel: { zone: "play" }, atk: o.atk, extra: [...fillers("dk", 3, P1, "deck"), ...fillers("fk", 2, P2, "deck"), ...(o.extra ?? [])] });

clause(BP, "2:ability:banana-peel-slip", "the cost destroys the Banana Peel at once; then the picked attacker is flipped face-down under its owner's control and I draw a card", () => {
  const b = slipBoard();
  const deckBefore = [...inDeck(b.engine, P1)];
  assert.equal(inHand(b.engine, P1).length, 0);
  slipRaw(b, b.id("atk"));
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard", "COST: destroyed on activation");
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, false, "the flip is the EFFECT: it has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, b.id("atk")), "play");
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, true, "flipped face-down");
  assert.equal(b.engine.state.cards[b.id("atk")].controllerId, P2, "under its owner's control");
  assert.equal(inHand(b.engine, P1).length, 1, "I drew a card");
  assert.ok(deckBefore.includes(inHand(b.engine, P1)[0]), "deckBefore.includes(inHand(b.engine, P1)[0])");
  assert.equal(inDeck(b.engine, P1).length, deckBefore.length - 1);
  assert.equal(inHand(b.engine, P2).length, 0, "the opponent drew nothing");
  assert.equal(inDeck(b.engine, P2).length, 2);
});

clause(BP, "2:ability:banana-peel-slip", "flipping the only attacker removes it from the battle: the battle ends, no damage is dealt and the turn can end", () => {
  const b = slipBoard();
  const myInfluence = influenceOf(b.engine, P1);
  slipRaw(b, b.id("atk"));
  resolvePendingResponses(b.engine);
  assert.equal(influenceOf(b.engine, P1), myInfluence, "no battle damage");
  assert.equal(battleOf(b.engine), undefined, "an emptied attacking party ends the battle (CR 302.15)");
  endTurn(b.engine, P2);
});

clause(BP, "2:ability:banana-peel-slip", "only an ATTACKING character can be picked: not a non-attacking character, one of mine that is defending, an item, a face-down card or a faction", () => {
  const fd = volition(1, P1)[0];
  const b = slipBoard({ extra: [foeChar("idle"), { key: "mine", def: character({ name: "Mine", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" }, { key: "myItem", def: item({ name: "MyItem", cost: 0 }), owner: P1, zone: "play" }, fd] });
  for (const [label, pick] of [
    ["a non-attacking opposing character", b.id("idle")],
    ["my own character (it is defending)", b.id("mine")],
    ["an item", b.id("myItem")],
    ["a face-down card", b.id(fd.key)],
    ["the opponent's faction", b.engine.state.players[P2].factionId!]
  ] as const) {
    refused(() => slipRaw(b, pick), label);
    assert.equal(zoneOf(b.engine, b.id("peel")), "play", `${label}: the refused attempt did not destroy the Banana Peel`);
  }
  assert.equal(b.engine.state.cards[b.id("idle")].faceDown, false);
  slipRaw(b, b.id("atk"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, true, "control: the attacker is accepted");
});

clause(BP, "2:ability:banana-peel-slip", "with no battle there is no attacking character to pick", () => {
  const b = bpBoard({ peel: { zone: "play" }, dec: 0, turn: 2, active: P2, extra: [foeChar("atk")] });
  refused(() => slipRaw(b, b.id("atk")), "nothing is attacking");
  assert.equal(zoneOf(b.engine, b.id("peel")), "play");
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, false);
});

clause(BP, "2:ability:banana-peel-slip", "my own attacking character can be picked too: it is flipped face-down and I draw", () => {
  const b = bpBoard({ peel: { zone: "play" }, dec: 0, extra: [ally("mine"), ...fillers("dk", 3, P1, "deck")] });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("mine")], target: { type: "faction", playerId: P2 } } as never);
  slipRaw(b, b.id("mine"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard");
  assert.equal(b.engine.state.cards[b.id("mine")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("mine")].controllerId, P1);
  assert.equal(inHand(b.engine, P1).length, 1);
});

clause(BP, "2:ability:banana-peel-slip", "an attacker I own but the opponent controls goes face-down under MY control (its owner)", () => {
  const b = slipBoard({ atk: { owner: P1, controller: P2 } });
  assert.equal(b.engine.state.cards[b.id("atk")].controllerId, P2);
  slipRaw(b, b.id("atk"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, true);
  assert.equal(b.engine.state.cards[b.id("atk")].controllerId, P1, "under its owner's control");
});

clause(BP, "2:ability:banana-peel-slip", "in a party of two, flipping one leaves the other attacking: only the other's strength is dealt", () => {
  const b = bpBoard({ peel: { zone: "play" }, dec: 0, turn: 2, active: P2, extra: [foeChar("atk", { strength: 2, life: 5, speed: 3 }), foeChar("atk2", { strength: 3, life: 5, speed: 3 }), ...fillers("dk", 2, P1, "deck")] });
  const myInfluence = influenceOf(b.engine, P1);
  declareAttackOpenWindow(b.engine, P2, [b.id("atk"), b.id("atk2")]);
  slipRaw(b, b.id("atk"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, true);
  declareBlockers(b.engine, P1, []);
  finishBattle(b.engine);
  assert.equal(influenceOf(b.engine, P1), myInfluence - 3, "only the second attacker's 3 strength");
});

clause(BP, "2:ability:banana-peel-slip", "'Draw a card' does not depend on the flip: if the attacker is destroyed in response, the Peel is still gone and I still draw", () => {
  const b = slipBoard({ extra: [{ key: "kill", def: sendTactic("destroy"), owner: P2, zone: "hand" }] });
  slipRaw(b, b.id("atk"));
  b.engine.perform({ type: "playCard", playerId: P2, cardId: b.id("kill"), selected: { t: [b.id("atk")] }, variables: {} } as never);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("atk")), "discard", "destroyed in response");
  assert.equal(zoneOf(b.engine, b.id("peel")), "discard");
  assert.equal(inHand(b.engine, P1).length, 1, "the draw still happened");
});

clause(BP, "2:ability:banana-peel-slip", "it needs no resources, only works from play, and only its controller can use it", () => {
  const hand = foeTurnBoard({ dec: 0, peel: { zone: "hand" } });
  refused(() => slipRaw(hand, hand.id("atk")), "from the hand");
  const down = foeTurnBoard({ dec: 0, peel: { zone: "play", faceDown: true } });
  refused(() => slipRaw(down, down.id("atk")), "face-down it has no abilities");
  const theirs = slipBoard();
  refused(() => slipRaw(theirs, theirs.id("atk"), P2), "the opponent cannot use my Banana Peel");
  assert.equal(zoneOf(theirs.engine, theirs.id("peel")), "play");
  assert.equal(ready(theirs.engine), 0, "control: I have no resources at all");
  slipRaw(theirs, theirs.id("atk"));
  resolvePendingResponses(theirs.engine);
  assert.equal(theirs.engine.state.cards[theirs.id("atk")].faceDown, true);
});

// --- FLIP UP -----------------------------------------------------------------------------------------

clause(BP, "3:flipUp", "a face-down Banana Peel is a resource providing Volition", () => {
  const b = bpBoard({ dec: 3, peel: { zone: "play", faceDown: true } });
  assert.equal(b.engine.isResource(b.id("peel")), true);
  assert.equal(ready(b.engine), 4);
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(BP, "3:flipUp", "FLIP UP 3 [D][D][D] on my turn: flips up into play as an item (not discarded) with a total cost of 3 and no extra payment", () => {
  const b = bpBoard({ dec: 3, rage: 2, peel: { zone: "play", faceDown: true } });
  flipUp(b.engine, P1, b.id("peel"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.pendingChoice, undefined, "my own turn: nothing more to pay");
  assert.equal(b.engine.state.cards[b.id("peel")].faceDown, false);
  assert.equal(zoneOf(b.engine, b.id("peel")), "play");
  assert.deepEqual([...b.engine.getCardTypes(b.id("peel"))], ["item"]);
  const spent = attached(b.engine, P1);
  assert.ok(spent === 2 || spent === 3, `a cost of 3 in total (the card may pay one itself): 2 or 3 others spent, got ${spent}`);
  assert.equal(ready(b.engine), 5 - spent, "the rest are untouched and the flipped card is no longer a resource");
});

clause(BP, "3:flipUp", "needs [D][D][D]: two Deception among other resources is refused (still face-down, nothing paid)", () => {
  const b = bpBoard({ dec: 2, rage: 4, peel: { zone: "play", faceDown: true } });
  refused(() => flipUp(b.engine, P1, b.id("peel")), "only [D][D]");
  assert.equal(b.engine.state.cards[b.id("peel")].faceDown, true);
  assert.equal(attached(b.engine, P1), 0);
});

clause(BP, "3:flipUp", "the cost of 3 must be affordable: [D][D][D] with two of them already spent is refused", () => {
  const b = bpBoard({ dec: 1, peel: { zone: "play", faceDown: true }, extra: bank("deception", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  assert.equal(ready(b.engine), 2, "one ready Deception and the face-down card");
  refused(() => flipUp(b.engine, P1, b.id("peel")), "only 2 ready resources for a cost of 3");
  assert.equal(b.engine.state.cards[b.id("peel")].faceDown, true);
});

clause(BP, "3:flipUp", "only its controller can flip it up, and only while it is a face-down card in play", () => {
  const theirs = bpBoard({ dec: 3, peel: { zone: "play", faceDown: true }, extra: bank("deception", 4, P2) });
  refused(() => flipUp(theirs.engine, P2, theirs.id("peel")), "the opponent cannot flip my card");
  assert.equal(theirs.engine.state.cards[theirs.id("peel")].faceDown, true);
  const hand = bpBoard({ dec: 4 });
  refused(() => flipUp(hand.engine, P1, hand.id("peel")), "from the hand it is not a face-down resource");
  assert.equal(zoneOf(hand.engine, hand.id("peel")), "hand");
});

// =====================================================================================
// T3c7 behavior-mutation pass: printed numbers, designations and pick counts the tests above did not pin
// =====================================================================================

clause(TA, "0:unique", "printed type / trade / subtype / stats: a Gearsmith character, Testudine Seraphim Dragon, 5 strength / 4 speed / 3 life", () => {
  printedStats({ id: TA, type: "character", subtype: ["testudine", "seraphim", "dragon"], strength: 5, speed: 4, life: 3 });
  assert.equal(printing(TA).trade, "gearsmith", "the Autoframe is a Gearsmith card");
});

clause(TA, "0:unique", "the designation is TESTUDINE: a different card with UNIQUE TESTUDINE is a duplicate too", () => {
  const twin = character({ name: "Some Other Testudine", cost: 0, threshold: "", unique: "testudine" } as Partial<CardDefinition>);
  const b = taBoard([{ key: "twin", def: twin, owner: P1, zone: "hand" }], { ta: "play" });
  play(b.engine, P1, b.id("twin"));
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc?.kind, "uniqueSurvivor", "two UNIQUE TESTUDINE cards force a survivor choice");
  assert.deepEqual([...pc.candidates].sort(), [b.id("ta"), b.id("twin")].sort(), "both cards are candidates");
});

clause(ARM, "0:ability:ta-forthabbash", "printed type / trade / subtype / stats / cost 4 / threshold [E]", () => {
  printedStats({ id: ARM, type: "character", subtype: ["craftsman"], strength: 2, speed: 3, life: 2 });
  assert.equal(printing(ARM).trade, "gearsmith", "the Armorer is a Gearsmith card");
  printedCost({ id: ARM, cost: 4, threshold: "e" });
});

clause(BB, "0:ability:bb-exit", "printed type / trade / subtype / stats / cost 3 / threshold [D]", () => {
  printedStats({ id: BB, type: "character", subtype: ["outcast"], strength: 2, speed: 4, life: 3 });
  assert.equal(printing(BB).trade, "rogue", "the Brigand is a Rogue card");
  printedCost({ id: BB, cost: 3, threshold: "d" });
});

clause(BP, "0:kw:TACTICAL", "printed type / trade / subtype / cost 3 / threshold [D][D]: an item with no subtype", () => {
  printedStats({ id: BP, type: "item", subtype: [] });
  assert.equal(printing(BP).trade, "rogue", "the Peel is a Rogue card");
  printedCost({ id: BP, cost: 3, threshold: "dd" });
});

clause(BP, "2:ability:banana-peel-slip", "the attacker pick is mandatory: activating with nobody picked is refused (the Peel stays), picking the attacker works", () => {
  const b = slipBoard();
  refused(
    () => b.engine.perform({ type: "activateAbility", playerId: P1, cardId: b.id("peel"), abilityId: "banana-peel-slip", selected: { atk: [] }, variables: {} } as never),
    "no attacking character picked"
  );
  assert.equal(zoneOf(b.engine, b.id("peel")), "play", "the refused attempt did not destroy the Peel");
  assert.equal(inHand(b.engine, P1).length, 0, "nothing was drawn");
  slipRaw(b, b.id("atk"));
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("atk")].faceDown, true, "control: with the attacker picked it works");
});
