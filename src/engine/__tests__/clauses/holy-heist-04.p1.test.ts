// Clause tests — batch holy-heist-04, part p1 (groups 1-9, missing clauses). See docs/TESTING.md and
// `npm run card-tests -- manifest holy-heist-04 --groups 1-9 --missing`. Expectations come from each card's
// PRINTED text and RULES.md / the CR; engine data is only used to drive the engine.

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
  P1,
  P2
} from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, settleState, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, declareBlockers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { CardPlacement, DamageSource } from "../support/fixtures.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";

type Ids = (key: string) => CardInstanceId;

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

const influence = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const tokensNamed = (engine: SpoilsEngine, player: PlayerId, name: string): CardInstanceId[] =>
  engine.state.players[player].play.filter((cardId) => engine.getDefinition(cardId).name === name);
const stat = (engine: SpoilsEngine, cardId: CardInstanceId): [number, number, number] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

/** The FLIP UP action for a face-down card of `player`. */
function flipUp(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected: {} });
  resolvePendingResponses(engine);
}

/** `n` resources of `icon` for `owner`, already attached to (spent on) their faction. */
const spent = (icon: "rage" | "greed" | "deception" | "elitism" | "obsession", n: number, owner: PlayerId): CardPlacement[] =>
  bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

// =====================================================================================
// Spurious Anthropologist — character (banker, advisor), cost 0, threshold [G][G][G], 0 strength / 2 speed / 2 life
// TACTICAL -- When this card blocks, you may pick a character in your discard pile. If you do, add that character
// to the blocking party. If that card or this card would leave play this turn, remove both cards from the game
// instead. -- At the end of a battle, if this card blocked, remove it from the game. -- FLIP UP: 1 [G][G][G]
// =====================================================================================

const SPUR = "b129604c-b993-48ff-8380-9a85297a75c9";

/** P2 (active) attacks P1; P1 has the Anthropologist, a character in its discard pile and a second would-be blocker. */
function spurBoard(extra: CardPlacement[] = [], o: { atkStr?: number; atkLife?: number; spur?: "play" | "hand" } = {}) {
  return duo(
    [
      { key: "spur", def: printing(SPUR), owner: P1, zone: o.spur ?? "play" },
      { key: "atk", def: character({ name: "Atk", strength: o.atkStr ?? 1, life: o.atkLife ?? 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "ally", def: character({ name: "Ally", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "discard" },
      ...extra
    ],
    { active: P2 }
  );
}

clause(SPUR, "0:kw:TACTICAL", "the card has the TACTICAL keyword (a plain character does not)", () => {
  const { engine, id } = spurBoard([{ key: "plain", def: character({ name: "Plain" }), owner: P1, zone: "play" }]);
  assert.ok(engine.getKeywords(id("spur")).includes("tactical"), "engine.getKeywords(id(\"spur\")).includes(\"tactical\")");
  assert.equal(engine.getKeywords(id("plain")).includes("tactical"), false, "control: an ordinary character is not tactical");
});

clause(SPUR, "0:kw:TACTICAL", "it can be deployed from hand whenever a tactic could be (the opponent's attack window) for its printed cost 0", () => {
  const { engine, id } = spurBoard([...bank("greed", 3, P1)], { spur: "hand" });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  const before = readyResources(engine, P1);
  play(engine, P1, id("spur"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("spur")), "play", "deployed on the opponent's turn");
  assert.equal(readyResources(engine, P1), before, "cost 0: nothing paid");
});

clause(SPUR, "0:kw:TACTICAL", "an ordinary character cannot be deployed in that same window, nor can the TACTICAL one outside a window", () => {
  const { engine, id } = spurBoard(
    [...bank("greed", 3, P1), { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }],
    { spur: "hand" }
  );
  refused(() => play(engine, P1, id("spur")), "the opponent's turn with no response window open: no tactic could be played");
  assert.equal(zoneOf(engine, id("spur")), "hand");
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => play(engine, P1, id("plain")), "a non-tactical character can't be deployed on the opponent's turn");
  assert.equal(zoneOf(engine, id("plain")), "hand");
  play(engine, P1, id("spur"));
  assert.equal(zoneOf(engine, id("spur")), "play", "control: the TACTICAL character can");
});

clause(SPUR, "0:kw:TACTICAL", "TACTICAL changes the timing only: the [G][G][G] threshold is still required", () => {
  const short = spurBoard([...bank("greed", 2, P1), ...bank("rage", 3, P1)], { spur: "hand" });
  declareAttackOpenWindow(short.engine, P2, [short.id("atk")]);
  refused(() => play(short.engine, P1, short.id("spur")), "only two [G]", /threshold/i);
  assert.equal(zoneOf(short.engine, short.id("spur")), "hand");
  const ok = spurBoard([...bank("greed", 3, P1)], { spur: "hand" });
  declareAttackOpenWindow(ok.engine, P2, [ok.id("atk")]);
  play(ok.engine, P1, ok.id("spur"));
  assert.equal(zoneOf(ok.engine, ok.id("spur")), "play", "control: three [G]");
});

/** A damage split: every source sends its full strength to `to[sourceId]` (default: its first legal target). */
const aim = (to: Record<string, CardInstanceId> = {}) => (source: DamageSource) => {
  if (source.strength <= 0) return [];
  const target = source.legalTargets.find((t) => t.type === "card" && t.cardId === to[source.cardId]) ?? source.legalTargets[0];
  return [{ sourceId: source.cardId, target, amount: source.strength }];
};

const EXTRAS: CardPlacement[] = [
  { key: "foeDead", def: character({ name: "FoeDead" }), owner: P2, zone: "discard" },
  { key: "mySpell", def: item({ name: "MyItem" }), owner: P1, zone: "discard" },
  { key: "myHand", def: character({ name: "MyHand" }), owner: P1, zone: "hand" },
  { key: "myDeck", def: character({ name: "MyDeck" }), owner: P1, zone: "deck" },
  { key: "myPlay", def: character({ name: "MyPlay" }), owner: P1, zone: "play" }
];

clause(SPUR, "1:rule", "when it blocks, its controller may pick a character in their discard pile, which joins the blocking party under their control", () => {
  const { engine, id } = spurBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  const pc = pending(engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1, "its controller picks");
  assert.equal(zoneOf(engine, id("ally")), "discard", "still in the discard pile while it is being picked");
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...engine.state.battle!.blockingParty].sort(), [id("spur"), id("ally")].sort(), "added to the blocking party");
  assert.equal(zoneOf(engine, id("ally")), "play", "it is in play to fight");
  assert.equal(controllerOf(engine, id("ally")), P1);
});

clause(SPUR, "1:rule", "'you may': declining the pick leaves the discard pile and the blocking party alone", () => {
  const { engine, id } = spurBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  assert.ok(pending(engine), "pending(engine)");
  answerPending(engine, "selectTargets", { selected: { ally: [] } });
  assert.equal(pending(engine), undefined);
  assert.deepEqual([...engine.state.battle!.blockingParty], [id("spur")], "only the Anthropologist blocks");
  assert.equal(zoneOf(engine, id("ally")), "discard", "the character stays in the discard pile");
});

clause(SPUR, "1:rule", "only a CHARACTER in the controller's own DISCARD PILE can be picked", () => {
  const { engine, id } = spurBoard(EXTRAS);
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  assert.ok(pending(engine), "pending(engine)");
  const pick = (key: string) =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { ally: [id(key)] } } } as never);
  refused(() => pick("foeDead"), "a character in the OPPONENT's discard pile");
  refused(() => pick("mySpell"), "a non-character (item) in my discard pile");
  refused(() => pick("myHand"), "a character in my hand");
  refused(() => pick("myDeck"), "a character in my deck");
  refused(() => pick("myPlay"), "a character already in play");
  assert.ok(pending(engine), "the pick is still open after every refusal");
  assert.equal(zoneOf(engine, id("foeDead")), "discard");
  pick("ally");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "play", "control: a character in my discard pile is accepted");
});

clause(SPUR, "1:rule", "it triggers only when THIS card blocks: another blocker alone, or no block at all, offers nothing", () => {
  const other = spurBoard([{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }]);
  declareAttackBy(other.engine, P2, [other.id("atk")]);
  declareBlockers(other.engine, P1, [other.id("other")]);
  assert.equal(pending(other.engine), undefined, "a different blocker: no pick");
  assert.deepEqual([...other.engine.state.battle!.blockingParty], [other.id("other")]);
  assert.equal(zoneOf(other.engine, other.id("ally")), "discard");
  const none = spurBoard();
  declareAttackBy(none.engine, P2, [none.id("atk")]);
  declareBlockers(none.engine, P1, []);
  assert.equal(pending(none.engine), undefined, "nobody blocks: no pick");
  const control = spurBoard([{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }]);
  declareAttackBy(control.engine, P2, [control.id("atk")]);
  declareBlockers(control.engine, P1, [control.id("other"), control.id("spur")]);
  assert.ok(pending(control.engine), "control: when the Anthropologist is one of the blockers it triggers");
});

clause(SPUR, "1:rule", "deployed in the opponent's attack window (TACTICAL), it can block and its trigger offers the pick", () => {
  const { engine, id } = spurBoard([...bank("greed", 3, P1)], { spur: "hand" });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  play(engine, P1, id("spur"));
  assert.equal(zoneOf(engine, id("spur")), "play");
  declareBlockers(engine, P1, [id("spur")]);
  assert.ok(pending(engine), "the trigger offers the pick");
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  assert.deepEqual([...engine.state.battle!.blockingParty].sort(), [id("spur"), id("ally")].sort());
});

clause(SPUR, "1:rule", "the added character fights with the party: its strength is dealt to the attacker and it takes damage as a blocker", () => {
  const { engine, id } = spurBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  finishBattle(engine, aim({ [id("atk")]: id("ally") }));
  assert.equal(damageOn(engine, id("atk")), 3, "the Ally's 3 strength reached the attacker (the Anthropologist adds 0)");
  // The battle is over, so the Anthropologist has been removed from the game (end of battle) and the Ally with it ("remove
  // both cards"): its damage markers are gone with it. The 1 damage the attacker dealt to it is in the log.
  const dealtToAlly = engine
    .getLog()
    .map((entry) => entry.event)
    .filter((event) => event?.type === "damageDealt" && event.targetId === id("ally") && event.sourceId === id("atk"))
    .reduce((sum, event) => sum + ((event as { amount: number }).amount ?? 0), 0);
  assert.equal(dealtToAlly, 1, "the attacker's 1 strength could be assigned to the added character");
});

clause(SPUR, "1:rule", "if the added character would leave play (destroyed in the battle), both cards are removed from the game instead", () => {
  const { engine, id } = spurBoard([], { atkStr: 4 });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  finishBattle(engine, aim({ [id("atk")]: id("ally") }));
  assert.equal(zoneOf(engine, id("ally")), "removed", "the Ally is removed from the game, not put in the discard pile");
  assert.equal(zoneOf(engine, id("spur")), "removed", "so is the Anthropologist");
});

/** The Anthropologist blocks with the Ally; `extra` cards are on the board. Returns the board with the Ally already added (response window still open). */
function spurWithAlly(extra: CardPlacement[], atkStr = 1) {
  const board = spurBoard(extra, { atkStr });
  declareAttackBy(board.engine, P2, [board.id("atk")]);
  declareBlockers(board.engine, P1, [board.id("spur")]);
  board.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { ally: [board.id("ally")] } } } as never);
  return board;
}

clause(SPUR, "1:rule", "if this card would leave play (destroyed in the battle), it is removed from the game instead of being discarded", () => {
  const { engine, id } = spurBoard([], { atkStr: 2 });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  finishBattle(engine, aim({ [id("atk")]: id("spur") }));
  assert.equal(zoneOf(engine, id("spur")), "removed", "the Anthropologist is removed from the game, not put in the discard pile");
});

clause(SPUR, "1:rule", "if this card would leave play (destroyed in the battle), the undamaged added character is removed from the game with it", () => {
  const { engine, id } = spurBoard([], { atkStr: 2 });
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  finishBattle(engine, aim({ [id("atk")]: id("spur") }));
  assert.equal(damageOn(engine, id("ally")), 0, "the Ally took no damage");
  assert.equal(zoneOf(engine, id("ally")), "removed", "the Ally is removed with it (not left in play or put in the discard pile)");
});

clause(SPUR, "1:rule", "an effect that would destroy the added character mid-battle removes that character from the game instead", () => {
  const { engine, id } = spurWithAlly([{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]);
  playRaw(engine, P2, id("kill"), { selected: { t: [id("ally")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "removed", "the destroyed Ally is removed from the game, not discarded");
  assert.ok(!engine.state.players[P1].discard.includes(id("ally")), "!engine.state.players[P1].discard.includes(id(\"ally\"))");
});

clause(SPUR, "1:rule", "an effect that would destroy the added character mid-battle removes the Anthropologist from the game too ('both cards')", () => {
  const { engine, id } = spurWithAlly([{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }]);
  playRaw(engine, P2, id("kill"), { selected: { t: [id("ally")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "removed");
  assert.equal(zoneOf(engine, id("spur")), "removed", "the Anthropologist is removed with the Ally");
});

clause(SPUR, "1:rule", "an effect that would return this card to its owner's hand mid-battle removes it from the game instead", () => {
  const { engine, id } = spurWithAlly([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("spur")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("spur")), "removed", "not returned to hand: removed from the game");
});

clause(SPUR, "1:rule", "an effect that would return this card to its owner's hand mid-battle removes the added character from the game too", () => {
  const { engine, id } = spurWithAlly([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("spur")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "removed", "the Ally is removed with it");
});

clause(SPUR, "1:rule", "an effect that would return the added character to hand mid-battle removes it from the game instead", () => {
  const { engine, id } = spurWithAlly([{ key: "bounce", def: bounceTactic(), owner: P2, zone: "hand" }]);
  playRaw(engine, P2, id("bounce"), { selected: { t: [id("ally")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ally")), "removed", "not returned to hand: removed from the game");
});

clause(SPUR, "2:rule", "at the end of a battle it blocked, the Anthropologist is removed from the game", () => {
  const { engine, id } = spurBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [] } });
  assert.equal(zoneOf(engine, id("spur")), "play", "still there while the battle is on");
  finishBattle(engine, aim({ [id("atk")]: id("spur") }));
  assert.equal(damageOn(engine, id("spur")) <= 1, true);
  assert.equal(zoneOf(engine, id("spur")), "removed", "it survived (1 damage on 2 life) and is removed from the game, not discarded");
  assert.ok(!engine.state.players[P1].discard.includes(id("spur")), "!engine.state.players[P1].discard.includes(id(\"spur\"))");
});

clause(SPUR, "2:rule", "…and the character it added is removed too (this card leaves play), even when nobody was destroyed", () => {
  const { engine, id } = spurBoard();
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("spur")]);
  answerPending(engine, "selectTargets", { selected: { ally: [id("ally")] } });
  finishBattle(engine, aim({ [id("atk")]: id("spur") }));
  assert.equal(zoneOf(engine, id("spur")), "removed");
  assert.equal(zoneOf(engine, id("ally")), "removed", "the surviving Ally goes with it: 'if this card would leave play this turn, remove both cards from the game'");
});

clause(SPUR, "2:rule", "if it did not block, it stays: another blocker's battle, or an unblocked attack, does not remove it", () => {
  const other = spurBoard([{ key: "other", def: character({ name: "Other", life: 6 }), owner: P1, zone: "play" }]);
  declareAttackBy(other.engine, P2, [other.id("atk")]);
  declareBlockers(other.engine, P1, [other.id("other")]);
  finishBattle(other.engine, aim());
  assert.equal(zoneOf(other.engine, other.id("spur")), "play", "another character blocked");
  const none = spurBoard();
  declareAttackBy(none.engine, P2, [none.id("atk")]);
  declareBlockers(none.engine, P1, []);
  finishBattle(none.engine, aim());
  assert.equal(zoneOf(none.engine, none.id("spur")), "play", "no blockers at all");
  assert.equal(zoneOf(none.engine, none.id("ally")), "discard");
});

// --- FLIP UP: 1 [G][G][G] -------------------------------------------------------------

clause(SPUR, "3:flipUp", "a face-down Anthropologist flips up for exactly 1 resource (with [G][G][G]) and becomes a face-up character in play", () => {
  const { engine, id } = duo([{ key: "spur", def: printing(SPUR), owner: P1, zone: "play", faceDown: true }, ...bank("greed", 3, P1)]);
  assert.equal(attachedCount(engine, P1), 0);
  flipUp(engine, P1, id("spur"));
  assert.equal(engine.state.cards[id("spur")].faceDown, false);
  assert.equal(zoneOf(engine, id("spur")), "play");
  assert.equal(engine.getDefinition(id("spur")).type, "character");
  assert.equal(attachedCount(engine, P1), 1, "exactly the FLIP UP cost 1 was paid");
  assert.deepEqual(stat(engine, id("spur")), [0, 2, 2], "printed 0 / 2 / 2");
});

clause(SPUR, "3:flipUp", "FLIP UP needs [G][G][G]: fewer than three Greed icons is refused even with plenty of other resources", () => {
  const { engine, id } = duo([
    { key: "spur", def: printing(SPUR), owner: P1, zone: "play", faceDown: true },
    ...bank("greed", 2, P1),
    ...bank("rage", 4, P1)
  ]);
  refused(() => flipUp(engine, P1, id("spur")), "only two [G] icons", /threshold/i);
  assert.equal(engine.state.cards[id("spur")].faceDown, true);
  assert.equal(attachedCount(engine, P1), 0, "nothing was paid");
});

clause(SPUR, "3:flipUp", "FLIP UP costs 1: with every resource spent (icons still met) it is refused; the card may pay for its own FLIP UP", () => {
  const dry = duo([
    { key: "spur", def: printing(SPUR), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" },
    ...spent("greed", 3, P1)
  ]);
  refused(() => flipUp(dry.engine, P1, dry.id("spur")), "no resource left to pay the 1");
  assert.equal(dry.engine.state.cards[dry.id("spur")].faceDown, true);
  const own = duo([{ key: "spur", def: printing(SPUR), owner: P1, zone: "play", faceDown: true }, ...spent("greed", 3, P1)]);
  flipUp(own.engine, P1, own.id("spur"));
  assert.equal(own.engine.state.cards[own.id("spur")].faceDown, false, "control: its own face-down resource pays the 1 (CR 507.4b)");
});

clause(SPUR, "3:flipUp", "only a face-down card can be flipped up: a face-up Anthropologist in play is refused", () => {
  const { engine, id } = duo([{ key: "spur", def: printing(SPUR), owner: P1, zone: "play" }, ...bank("greed", 3, P1)]);
  refused(() => flipUp(engine, P1, id("spur")), "already face up");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(SPUR, "3:flipUp", "it is TACTICAL, so it can be flipped up in the opponent's attack window", () => {
  const { engine, id } = spurBoard([...bank("greed", 3, P1), { key: "fd", def: printing(SPUR), owner: P1, zone: "play", faceDown: true }], { spur: "hand" });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  flipUp(engine, P1, id("fd"));
  assert.equal(engine.state.cards[id("fd")].faceDown, false);
  assert.equal(zoneOf(engine, id("fd")), "play");
});

// =====================================================================================
// Thabbashite Deacon — character (banker, priest), cost 4, threshold [G], 1 strength / 3 speed / 3 life
// When a card that provides at least [V] enters play under your control, you may pick a faction. If you do, it
// gains 1 influence.
// =====================================================================================

const DEAC = "4c4df8dd-da26-4d4c-b84a-24e2b31b7008";
const stapleGreed = (name = "Greed") => resourceCard({ name, resource: { provides: ["greed"], staple: true } });

function deaconBoard(extra: CardPlacement[] = [], o: { active?: PlayerId; deacon?: "play" | "hand" | "discard" } = {}) {
  return duo([{ key: "deac", def: printing(DEAC), owner: P1, zone: o.deacon ?? "play" }, ...extra], { active: o.active });
}
const pickFaction = (engine: SpoilsEngine, who: PlayerId) =>
  answerPending(engine, "selectTargets", { selected: { f: [engine.state.players[who].factionId!] } });
const faceDownRes: CardPlacement = { key: "res", def: stapleGreed("Fodder"), owner: P1, zone: "hand" };

clause(DEAC, "0:rule", "a face-down card (it provides [V]) entering play under your control lets you pick a faction; picking your own gives it exactly 1 influence", () => {
  const { engine, id } = deaconBoard([faceDownRes]);
  const [mine, theirs] = [influence(engine, P1), influence(engine, P2)];
  developResource(engine, P1, id("res"), true);
  const pc = pending(engine);
  assert.ok(pc, "the Deacon's trigger asks for a pick");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  pickFaction(engine, P1);
  assert.equal(pending(engine), undefined, "one prompt only");
  assert.equal(influence(engine, P1), mine + 1, "my faction gained exactly 1 influence");
  assert.equal(influence(engine, P2), theirs, "the opponent's faction is untouched");
  assert.equal(engine.state.cards[id("res")].faceDown, true);
  assert.equal(zoneOf(engine, id("res")), "play");
});

clause(DEAC, "0:rule", "'pick a faction': the opponent's faction can be picked and it gains the influence instead", () => {
  const { engine, id } = deaconBoard([faceDownRes]);
  const [mine, theirs] = [influence(engine, P1), influence(engine, P2)];
  developResource(engine, P1, id("res"), true);
  pickFaction(engine, P2);
  assert.equal(pending(engine), undefined);
  assert.equal(influence(engine, P2), theirs + 1, "the picked (opponent's) faction gains 1");
  assert.equal(influence(engine, P1), mine, "mine does not");
});

clause(DEAC, "0:rule", "'you may': picking no faction gives nobody influence", () => {
  const { engine, id } = deaconBoard([faceDownRes]);
  const [mine, theirs] = [influence(engine, P1), influence(engine, P2)];
  developResource(engine, P1, id("res"), true);
  assert.ok(pending(engine), "pending(engine)");
  answerPending(engine, "selectTargets", { selected: { f: [] } });
  assert.equal(pending(engine), undefined);
  assert.deepEqual([influence(engine, P1), influence(engine, P2)], [mine, theirs]);
});

clause(DEAC, "0:rule", "any face-down card provides [V]: a character played face-down as a resource triggers it too", () => {
  const { engine, id } = deaconBoard([{ key: "res", def: character({ name: "Fodder", cost: 3 }), owner: P1, zone: "hand" }]);
  const mine = influence(engine, P1);
  developResource(engine, P1, id("res"), true);
  assert.ok(pending(engine), "a face-down character provides [V]");
  pickFaction(engine, P1);
  assert.equal(influence(engine, P1), mine + 1);
});

clause(DEAC, "0:rule", "a card that does not provide [V] entering play gives no prompt: a face-up staple resource, or a deployed character", () => {
  const staple = deaconBoard([faceDownRes]);
  const before = [influence(staple.engine, P1), influence(staple.engine, P2)];
  developResource(staple.engine, P1, staple.id("res"), false);
  assert.equal(zoneOf(staple.engine, staple.id("res")), "play");
  assert.equal(staple.engine.state.cards[staple.id("res")].faceDown, false, "played face-up: it provides [G], not [V]");
  assert.equal(pending(staple.engine), undefined, "a face-up Greed provides only [G]");
  assert.deepEqual([influence(staple.engine, P1), influence(staple.engine, P2)], before);
  const unit = deaconBoard([{ key: "c", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }]);
  play(unit.engine, P1, unit.id("c"));
  assert.equal(zoneOf(unit.engine, unit.id("c")), "play");
  assert.equal(pending(unit.engine), undefined, "a deployed character provides no [V]");
  const control = deaconBoard([faceDownRes]);
  developResource(control.engine, P1, control.id("res"), true);
  assert.ok(pending(control.engine), "control: the same resource played face-down does prompt");
});

clause(DEAC, "0:rule", "only cards entering under YOUR control count: the opponent playing a face-down card gives no prompt", () => {
  const { engine, id } = deaconBoard([{ key: "foeRes", def: stapleGreed("FoeFodder"), owner: P2, zone: "hand" }], { active: P2 });
  const before = [influence(engine, P1), influence(engine, P2)];
  developResource(engine, P2, id("foeRes"), true);
  assert.equal(engine.state.cards[id("foeRes")].faceDown, true);
  assert.equal(zoneOf(engine, id("foeRes")), "play");
  assert.equal(pending(engine), undefined, "no prompt for my Deacon");
  assert.deepEqual([influence(engine, P1), influence(engine, P2)], before);
});

clause(DEAC, "0:rule", "the Deacon must be in play: from hand or from the discard pile it does nothing", () => {
  for (const zone of ["hand", "discard"] as const) {
    const { engine, id } = deaconBoard([faceDownRes], { deacon: zone });
    const before = [influence(engine, P1), influence(engine, P2)];
    developResource(engine, P1, id("res"), true);
    assert.equal(pending(engine), undefined, `Deacon in ${zone}: no prompt`);
    assert.deepEqual([influence(engine, P1), influence(engine, P2)], before);
  }
});

const TECH = "91d07791-dd91-4862-9345-d06bbc73a06b";

clause(DEAC, "0:rule", "a card put into play face-down by an effect (73ch!) provides [V] and enters under my control, so it triggers too", () => {
  const { engine, id } = deaconBoard([
    { key: "tech", def: printing(TECH), owner: P1, zone: "hand" },
    { key: "gear", def: character({ name: "GearGuy", trade: "gearsmith" }), owner: P1, zone: "deck" },
    ...bank("elitism", 4, P1)
  ]);
  const mine = influence(engine, P1);
  play(engine, P1, id("tech"), { selected: { found: [id("gear")] } });
  assert.equal(engine.state.cards[id("gear")].faceDown, true, "the found card is in play face-down");
  assert.equal(zoneOf(engine, id("gear")), "play");
  assert.ok(pending(engine), "a face-down card entered play under my control: the Deacon asks for a pick");
  pickFaction(engine, P1);
  assert.equal(influence(engine, P1), mine + 1);
});

// =====================================================================================
// Unloyal Necromorph — character (banker; necromorph, mercenary), cost 3, threshold [G], 4 strength / 3 speed / 4 life
// If this card would be destroyed, any opponent may pay 2. If they do, that player takes control of this card
// instead and all damage already inflicted to this card this turn is reduced to 0.
// =====================================================================================

const NECRO = "420418bb-f8a7-435a-a0eb-1dec094e3805";
const zap = (amount: number): CardDefinition =>
  killTactic({
    name: `Zap${amount}`,
    behavior: {
      abilities: [
        {
          id: "k",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

function necroBoard(foeResources: number, extra: CardPlacement[] = [], necroDamage = 0, active: PlayerId = P1) {
  return duo([
    { key: "necro", def: printing(NECRO), owner: P1, zone: "play", damage: necroDamage },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...bank("greed", foeResources, P2),
    ...bank("rage", 4, P1),
    ...extra
  ], { active });
}
const killNecro = (engine: SpoilsEngine, id: Ids, who: PlayerId = P1, tactic = "kill") => {
  play(engine, who, id(tactic), { selected: { t: [id("necro")] } });
};

clause(NECRO, "0:rule", "when it would be destroyed the OPPONENT is offered the choice; paying 2 gives them control of it instead of it being destroyed", () => {
  const { engine, id } = necroBoard(3);
  killNecro(engine, id);
  const pc = pending(engine);
  assert.ok(pc, "an opponent choice is offered");
  assert.equal(pc.kind, "replacementChoice");
  assert.equal(pc.playerId, P2, "the opponent decides, not the controller");
  assert.equal(zoneOf(engine, id("necro")), "play", "not destroyed yet");
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("necro")), "play", "the destruction did not happen");
  assert.equal(controllerOf(engine, id("necro")), P2, "the opponent took control");
  assert.ok(engine.state.players[P2].play.includes(id("necro")), "it is among the opponent's cards in play");
  assert.ok(!engine.state.players[P1].play.includes(id("necro")), "and no longer among mine");
  assert.ok(!engine.state.players[P1].discard.includes(id("necro")), "not in my discard pile");
  assert.equal(attachedCount(engine, P2), 2, "the opponent paid exactly 2");
});

clause(NECRO, "0:rule", "'may pay': declining destroys it normally and costs the opponent nothing", () => {
  const { engine, id } = necroBoard(3);
  killNecro(engine, id);
  answerPending(engine, "replacementChoice", { apply: false });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("necro")), "discard");
  assert.ok(engine.state.players[P1].discard.includes(id("necro")), "engine.state.players[P1].discard.includes(id(\"necro\"))");
  assert.equal(controllerOf(engine, id("necro")), P1);
  assert.equal(attachedCount(engine, P2), 0, "nothing was paid");
});

clause(NECRO, "0:rule", "the opponent must be able to pay 2: with 1 resource, or with all resources already spent, it is simply destroyed", () => {
  const one = necroBoard(1);
  killNecro(one.engine, one.id);
  drain(one.engine, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(zoneOf(one.engine, one.id("necro")), "discard", "1 resource is not 2");
  assert.equal(controllerOf(one.engine, one.id("necro")), P1);
  const spentAll = duo([
    { key: "necro", def: printing(NECRO), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...spent("greed", 3, P2)
  ]);
  killNecro(spentAll.engine, spentAll.id);
  drain(spentAll.engine, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(zoneOf(spentAll.engine, spentAll.id("necro")), "discard", "spent resources can't pay");
  const exactly = necroBoard(2);
  killNecro(exactly.engine, exactly.id);
  answerPending(exactly.engine, "replacementChoice", { apply: true });
  assert.equal(controllerOf(exactly.engine, exactly.id("necro")), P2, "control: exactly 2 resources is enough");
});

clause(NECRO, "0:rule", "only an OPPONENT can pay: its own controller with plenty of resources is not offered it when the opponent has none", () => {
  const { engine, id } = necroBoard(0);
  killNecro(engine, id);
  drain(engine, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("necro")), "discard");
  assert.equal(controllerOf(engine, id("necro")), P1, "I could pay 2 (4 Rage) but only opponents may");
});

clause(NECRO, "0:rule", "all damage already inflicted to it this turn is reduced to 0 when the opponent takes control", () => {
  const { engine, id } = necroBoard(3, [], 3);
  assert.equal(damageOn(engine, id("necro")), 3);
  killNecro(engine, id);
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(controllerOf(engine, id("necro")), P2);
  assert.equal(damageOn(engine, id("necro")), 0, "its damage was reduced to 0");
  assert.equal(zoneOf(engine, id("necro")), "play");
});

clause(NECRO, "0:rule", "destroyed by lethal damage (4 on 4 life): taking control also wipes that damage, so it is not destroyed again", () => {
  const { engine, id } = necroBoard(3, [{ key: "zap", def: zap(4), owner: P1, zone: "hand" }]);
  killNecro(engine, id, P1, "zap");
  assert.equal(pending(engine)?.kind, "replacementChoice");
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("necro")), "play", "still in play after the state-based check");
  assert.equal(controllerOf(engine, id("necro")), P2);
  assert.equal(damageOn(engine, id("necro")), 0);
  assert.equal(attachedCount(engine, P2), 2);
});

clause(NECRO, "0:rule", "destroyed by lethal battle damage: the attacking opponent may pay 2 and takes control of it (damage cleared)", () => {
  const { engine, id } = necroBoard(3, [{ key: "atk", def: character({ name: "Atk", strength: 4, life: 6, speed: 2 }), owner: P2, zone: "play" }], 0, P2);
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("necro")]);
  finishBattle(engine, undefined, (pc) => (pc.kind === "replacementChoice" ? { kind: "replacementChoice", apply: true } : declineAll(pc)));
  assert.equal(zoneOf(engine, id("necro")), "play");
  assert.equal(controllerOf(engine, id("necro")), P2, "the opponent took control");
  assert.equal(damageOn(engine, id("necro")), 0);
});

clause(NECRO, "0:rule", "it only replaces being DESTROYED: returned to hand, or another character destroyed, offers nothing", () => {
  const bounce = necroBoard(3, [{ key: "bounce", def: bounceTactic(), owner: P1, zone: "hand" }]);
  play(bounce.engine, P1, bounce.id("bounce"), { selected: { t: [bounce.id("necro")] } });
  assert.equal(pending(bounce.engine), undefined, "bounce is not destruction");
  assert.equal(zoneOf(bounce.engine, bounce.id("necro")), "hand");
  const other = necroBoard(3, [{ key: "other", def: character({ name: "Other" }), owner: P1, zone: "play" }]);
  play(other.engine, P1, other.id("kill"), { selected: { t: [other.id("other")] } });
  assert.equal(pending(other.engine), undefined, "another character's destruction is not replaced");
  assert.equal(zoneOf(other.engine, other.id("other")), "discard");
  assert.equal(zoneOf(other.engine, other.id("necro")), "play");
});

clause(NECRO, "0:rule", "the new controller's opponent (its owner) may pay 2 to take it back when it would be destroyed again", () => {
  const { engine, id } = necroBoard(3, [{ key: "kill2", def: killTactic({ name: "Kill2" }), owner: P1, zone: "hand" }, ...bank("greed", 2, P1)]);
  killNecro(engine, id);
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(controllerOf(engine, id("necro")), P2);
  play(engine, P1, id("kill2"), { selected: { t: [id("necro")] } });
  const pc = pending(engine);
  assert.ok(pc, "its new controller's opponent is now offered the choice");
  assert.equal(pc.kind, "replacementChoice");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "replacementChoice", { apply: true });
  assert.equal(controllerOf(engine, id("necro")), P1, "taken back");
  assert.equal(zoneOf(engine, id("necro")), "play");
});

// =====================================================================================
// 0v3rw0rk3d 31f — character (gearsmith, 31f), cost 3, threshold [E][E], 3 strength / 2 speed / 3 life
// Abilities on locations cannot be used. -- [E][E][E][E][E][E]: Locations opponents control lose 1 structure.
// -- FLIP UP: 2 [E][E]
// =====================================================================================

const ELF = "7dd26a5f-d0dc-4231-b70a-d11b189f28db";

/** A location whose ability "use" draws its controller a card. */
const drawLocation = (name: string, structure = 3): CardDefinition =>
  location({
    name,
    structure,
    behavior: { abilities: [{ id: "use", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
const drawItem = (name: string): CardDefinition =>
  item({ name, behavior: { abilities: [{ id: "use", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
const handSize = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].hand.length;
const deckCards = (prefix: string, owner: PlayerId): CardPlacement[] =>
  Array.from({ length: 4 }, (_, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix} ${i}` }), owner, zone: "deck" as const }));

clause(ELF, "0:rule", "abilities on locations cannot be used: neither mine nor the opponent's, while it is in play", () => {
  const withElf = duo([
    { key: "elf", def: printing(ELF), owner: P1, zone: "play" },
    { key: "mine", def: drawLocation("MyLoc"), owner: P1, zone: "play" },
    { key: "theirs", def: drawLocation("TheirLoc"), owner: P2, zone: "play" },
    ...deckCards("a", P1),
    ...deckCards("b", P2)
  ]);
  const { engine, id } = withElf;
  assert.equal(engine.getAvailableActivatedAbilities(P1).some((a) => a.cardId === id("mine")), false, "my location's ability is not available");
  refused(() => activate(engine, P1, id("mine"), "use"), "my own location while the Elf is in play");
  assert.equal(handSize(engine, P1), 0);
  engine.state.activePlayerId = P2;
  refused(() => activate(engine, P2, id("theirs"), "use"), "the opponent's location while the Elf is in play");
  assert.equal(handSize(engine, P2), 0);
  // control: the very same board without the Elf
  const without = duo([
    { key: "mine", def: drawLocation("MyLoc"), owner: P1, zone: "play" },
    { key: "theirs", def: drawLocation("TheirLoc"), owner: P2, zone: "play" },
    ...deckCards("a", P1),
    ...deckCards("b", P2)
  ]);
  activate(without.engine, P1, without.id("mine"), "use");
  assert.equal(handSize(without.engine, P1), 1, "control: the location ability works without the Elf");
  without.engine.state.activePlayerId = P2;
  activate(without.engine, P2, without.id("theirs"), "use");
  assert.equal(handSize(without.engine, P2), 1, "control: and the opponent's too");
});

clause(ELF, "0:rule", "only LOCATION abilities are blocked: an item's ability is still usable", () => {
  const { engine, id } = duo([
    { key: "elf", def: printing(ELF), owner: P1, zone: "play" },
    { key: "gizmo", def: drawItem("Gizmo"), owner: P1, zone: "play" },
    ...deckCards("a", P1)
  ]);
  activate(engine, P1, id("gizmo"), "use");
  assert.equal(handSize(engine, P1), 1);
});

clause(ELF, "0:rule", "the restriction is static: gone once the Elf leaves play, and it does not apply while the Elf is a face-down resource", () => {
  const down = duo([
    { key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true },
    { key: "mine", def: drawLocation("MyLoc"), owner: P1, zone: "play" },
    ...deckCards("a", P1)
  ]);
  activate(down.engine, P1, down.id("mine"), "use");
  assert.equal(handSize(down.engine, P1), 1, "a face-down Elf has no abilities");
  const { engine, id } = duo([
    { key: "elf", def: printing(ELF), owner: P1, zone: "play" },
    { key: "mine", def: drawLocation("MyLoc"), owner: P1, zone: "play" },
    { key: "kill", def: killTactic(), owner: P1, zone: "hand" },
    ...deckCards("a", P1)
  ]);
  refused(() => activate(engine, P1, id("mine"), "use"), "blocked while the Elf is in play");
  play(engine, P1, id("kill"), { selected: { t: [id("elf")] } });
  assert.equal(zoneOf(engine, id("elf")), "discard");
  const before = handSize(engine, P1);
  activate(engine, P1, id("mine"), "use");
  assert.equal(handSize(engine, P1), before + 1, "usable again after the Elf left play");
});

/** Elf for `elfOwner` with `elitism` Elitism icons; one location each plus a character for the opponent. */
function crushBoard(elitism: number, o: { elfOwner?: PlayerId; extra?: CardPlacement[]; spentIcons?: boolean } = {}) {
  const elfOwner = o.elfOwner ?? P1;
  const foe: PlayerId = elfOwner === P1 ? P2 : P1;
  return duo([
    { key: "elf", def: printing(ELF), owner: elfOwner, zone: "play" },
    { key: "myLoc", def: drawLocation("MyLoc"), owner: elfOwner, zone: "play" },
    { key: "foeLoc", def: drawLocation("FoeLoc"), owner: foe, zone: "play" },
    { key: "foeChar", def: character({ name: "FoeChar", life: 3 }), owner: foe, zone: "play" },
    ...(o.spentIcons ? spent("elitism", elitism, elfOwner) : bank("elitism", elitism, elfOwner)),
    ...(o.extra ?? [])
  ]);
}

clause(ELF, "1:rule@eeeeee", "with six [E] icons, locations opponents control lose 1 structure; my own locations and their characters are untouched", () => {
  const { engine, id } = crushBoard(6, { extra: [{ key: "foeLoc2", def: drawLocation("FoeLoc2", 5), owner: P2, zone: "play" }] });
  assert.equal(engine.getStat(id("foeLoc"), "structure"), 2, "3 - 1");
  assert.equal(engine.getStat(id("foeLoc2"), "structure"), 4, "every opposing location: 5 - 1");
  assert.equal(engine.getStat(id("myLoc"), "structure"), 3, "my own location keeps its structure");
  assert.equal(engine.getStat(id("foeChar"), "life"), 3, "a character is not a location");
});

clause(ELF, "1:rule@eeeeee", "the threshold gates it: five [E] icons (even with a hundred other resources) lose nothing; six spent icons still count", () => {
  const five = crushBoard(5, { extra: bank("rage", 6, P1) });
  assert.equal(five.engine.getStat(five.id("foeLoc"), "structure"), 3, "five [E] is not enough");
  const six = crushBoard(6, { spentIcons: true });
  assert.equal(attachedCount(six.engine, P1), 6, "all six resources are spent");
  assert.equal(six.engine.getStat(six.id("foeLoc"), "structure"), 2, "icons are never spent: still active");
  const foeHasSix = crushBoard(5, { extra: bank("elitism", 6, P2) });
  assert.equal(foeHasSix.engine.getStat(foeHasSix.id("foeLoc"), "structure"), 3, "the opponent's [E] icons are not mine");
});

clause(ELF, "1:rule@eeeeee", "it belongs to the Elf's controller: an opponent's Elf with six [E] shrinks MY locations, not theirs", () => {
  const { engine, id } = crushBoard(6, { elfOwner: P2 });
  assert.equal(engine.getStat(id("foeLoc"), "structure"), 2, "P1's location loses 1 (P2 is the Elf's controller)");
  assert.equal(engine.getStat(id("myLoc"), "structure"), 3, "P2's own location is untouched");
});

clause(ELF, "1:rule@eeeeee", "'control': a location I own but an opponent controls loses 1; one an opponent owns but I control does not", () => {
  const { engine, id } = crushBoard(6, {
    extra: [
      { key: "stolenFromMe", def: drawLocation("Stolen", 4), owner: P1, zone: "play", controller: P2 },
      { key: "stolenByMe", def: drawLocation("TakenByMe", 4), owner: P2, zone: "play", controller: P1 }
    ]
  });
  assert.equal(engine.getStat(id("stolenFromMe"), "structure"), 3, "controlled by the opponent: loses 1");
  assert.equal(engine.getStat(id("stolenByMe"), "structure"), 4, "controlled by me: untouched");
});

clause(ELF, "1:rule@eeeeee", "it ends when the Elf leaves play", () => {
  const { engine, id } = crushBoard(6, { extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("foeLoc"), "structure"), 2);
  play(engine, P1, id("kill"), { selected: { t: [id("elf")] } });
  assert.equal(zoneOf(engine, id("elf")), "discard");
  assert.equal(engine.getStat(id("foeLoc"), "structure"), 3, "back to its printed structure");
});

clause(ELF, "1:rule@eeeeee", "a location with 1 structure loses 1 and is destroyed (0 structure)", () => {
  const { engine, id } = crushBoard(6, { extra: [{ key: "frail", def: drawLocation("Frail", 1), owner: P2, zone: "play" }] });
  assert.equal(engine.getStat(id("frail"), "structure"), 0);
  settleState(engine);
  assert.equal(zoneOf(engine, id("frail")), "discard", "a location at 0 structure is destroyed");
});

clause(ELF, "2:flipUp", "a face-down Elf flips up for exactly 2 resources (with [E][E]) and becomes a face-up 3/2/3 character in play", () => {
  const { engine, id } = duo([{ key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true }, ...bank("elitism", 2, P1), ...bank("rage", 1, P1)]);
  flipUp(engine, P1, id("elf"));
  assert.equal(engine.state.cards[id("elf")].faceDown, false);
  assert.equal(zoneOf(engine, id("elf")), "play");
  assert.equal(engine.getDefinition(id("elf")).type, "character");
  assert.equal(attachedCount(engine, P1), 2, "exactly the FLIP UP cost 2 was paid");
  assert.deepEqual(stat(engine, id("elf")), [3, 3, 2], "printed 3 strength / 3 life / 2 speed");
});

clause(ELF, "2:flipUp", "FLIP UP needs [E][E] (one Elitism icon among plenty of resources is refused) and the cost of 2 (all spent is refused)", () => {
  const oneIcon = duo([{ key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true }, ...bank("elitism", 1, P1), ...bank("rage", 5, P1)]);
  refused(() => flipUp(oneIcon.engine, P1, oneIcon.id("elf")), "only one [E] icon", /threshold/i);
  assert.equal(oneIcon.engine.state.cards[oneIcon.id("elf")].faceDown, true);
  assert.equal(attachedCount(oneIcon.engine, P1), 0);
  const dry = duo([{ key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true, attachedToKey: "__factionA" }, ...spent("elitism", 2, P1)]);
  refused(() => flipUp(dry.engine, P1, dry.id("elf")), "no resource left to pay the 2");
  assert.equal(dry.engine.state.cards[dry.id("elf")].faceDown, true);
  const short = duo([{ key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true }, ...spent("elitism", 2, P1)]);
  refused(() => flipUp(short.engine, P1, short.id("elf")), "only its own face-down resource is left: 1 of the 2");
  assert.equal(short.engine.state.cards[short.id("elf")].faceDown, true);
  const ok = duo([{ key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true }, ...spent("elitism", 2, P1), ...bank("rage", 1, P1)]);
  flipUp(ok.engine, P1, ok.id("elf"));
  assert.equal(ok.engine.state.cards[ok.id("elf")].faceDown, false, "control: its own resource plus one more pays the 2");
});

clause(ELF, "2:flipUp", "a character without TACTICAL cannot be flipped up in the opponent's response window", () => {
  const { engine, id } = duo(
    [
      { key: "elf", def: printing(ELF), owner: P1, zone: "play", faceDown: true },
      { key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" },
      ...bank("elitism", 3, P1)
    ],
    { active: P2 }
  );
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  refused(() => flipUp(engine, P1, id("elf")), "FLIP UP of a non-tactic card in the opponent's window");
  assert.equal(engine.state.cards[id("elf")].faceDown, true);
  assert.equal(attachedCount(engine, P1), 0);
});

// =====================================================================================
// 73ch! — tactic (gearsmith), cost 4, threshold [E][E][E]
// Search your deck for a Gearsmith card and reveal it. If you do, put it into play under your control as a
// face-down resource.
// =====================================================================================

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function techBoard(o: { elitism?: number; rage?: number; deck?: CardPlacement[]; random?: () => number } = {}) {
  return duo(
    [
      { key: "tech", def: printing(TECH), owner: P1, zone: "hand" },
      ...bank("elitism", o.elitism ?? 4, P1),
      ...bank("rage", o.rage ?? 0, P1),
      ...(o.deck ?? [
        { key: "g1", def: character({ name: "GearGuy", trade: "gearsmith" }), owner: P1, zone: "deck" as const },
        { key: "x1", def: character({ name: "Filler One", trade: "banker" }), owner: P1, zone: "deck" as const },
        { key: "x2", def: character({ name: "Filler Two", trade: "universal" }), owner: P1, zone: "deck" as const }
      ])
    ],
    { random: o.random }
  );
}

clause(TECH, "0:rule", "the searched Gearsmith card ends in play under my control as a face-down resource", () => {
  const { engine, id } = techBoard();
  play(engine, P1, id("tech"), { selected: { found: [id("g1")] } });
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("g1")), "play", "put into play");
  assert.equal(engine.state.cards[id("g1")].faceDown, true, "face-down");
  assert.equal(controllerOf(engine, id("g1")), P1, "under my control");
  assert.ok(engine.state.players[P1].play.includes(id("g1")), "engine.state.players[P1].play.includes(id(\"g1\"))");
  assert.ok(!engine.state.players[P1].deck.includes(id("g1")), "no longer in the deck");
  assert.ok(!engine.state.players[P1].hand.includes(id("g1")), "and not in my hand");
  assert.equal(zoneOf(engine, id("tech")), "discard", "the tactic is discarded after resolving");
  assert.equal(readyResources(engine, P1), 1, "the 4 Elitism were spent; the new face-down card is a ready resource");
});

clause(TECH, "0:rule", "the card is revealed (to everyone) when found", () => {
  const { engine, id } = techBoard();
  play(engine, P1, id("tech"), { selected: { found: [id("g1")] } });
  const reveals = engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
  assert.equal(reveals.length, 1, "revealed once");
  const ev = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual([...ev.cardIds], [id("g1")]);
  assert.equal(ev.viewerId, "all", "revealed to everyone");
});

clause(TECH, "0:rule", "'a Gearsmith card': any card type of that trade can be found, other trades cannot, and only from my own deck", () => {
  const { engine, id } = techBoard({
    deck: [
      { key: "gChar", def: character({ name: "GChar", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "gItem", def: item({ name: "GItem", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "gLoc", def: location({ name: "GLoc", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "gTac", def: tactic({ name: "GTac", trade: "gearsmith" }), owner: P1, zone: "deck" },
      { key: "rogue", def: character({ name: "Rogue", trade: "rogue" }), owner: P1, zone: "deck" },
      { key: "banker", def: character({ name: "Banker", trade: "banker" }), owner: P1, zone: "deck" },
      { key: "uni", def: character({ name: "Uni", trade: "universal" }), owner: P1, zone: "deck" },
      { key: "foeG", def: character({ name: "FoeG", trade: "gearsmith" }), owner: P2, zone: "deck" },
      { key: "handG", def: character({ name: "HandG", trade: "gearsmith" }), owner: P1, zone: "hand" },
      { key: "discG", def: character({ name: "DiscG", trade: "gearsmith" }), owner: P1, zone: "discard" }
    ]
  });
  for (const bad of ["rogue", "banker", "uni", "foeG", "handG", "discG"]) {
    refused(() => playRaw(engine, P1, id("tech"), { selected: { found: [id(bad)] } }), `${bad} is not a Gearsmith card in my deck`);
    assert.equal(zoneOf(engine, id("tech")), "hand", `${bad}: the tactic was not played`);
  }
  for (const good of ["gItem", "gLoc", "gTac", "gChar"]) {
    const board = techBoard({
      deck: [
        { key: good, def: { gItem: item, gLoc: location, gTac: tactic, gChar: character }[good]!({ name: good, trade: "gearsmith" }), owner: P1, zone: "deck" },
        { key: "other", def: character({ name: "Other", trade: "rogue" }), owner: P1, zone: "deck" }
      ]
    });
    play(board.engine, P1, board.id("tech"), { selected: { found: [board.id(good)] } });
    assert.equal(zoneOf(board.engine, board.id(good)), "play", `a Gearsmith ${good} can be found`);
    assert.equal(board.engine.state.cards[board.id(good)].faceDown, true, `${good} is face-down`);
    assert.equal(zoneOf(board.engine, board.id("other")), "deck", "the non-Gearsmith card stays in the deck");
  }
});

clause(TECH, "0:rule", "'If you do': finding nothing (declining, or no Gearsmith in the deck) puts nothing into play", () => {
  const decline = techBoard();
  play(decline.engine, P1, decline.id("tech"), { selected: { found: [] } });
  assert.equal(pending(decline.engine), undefined);
  assert.equal(zoneOf(decline.engine, decline.id("g1")), "deck", "the Gearsmith stays in the deck when I choose not to find it");
  assert.equal(readyResources(decline.engine, P1), 0, "no resource appeared");
  assert.equal(zoneOf(decline.engine, decline.id("tech")), "discard", "the tactic was still played");
  const none = techBoard({ deck: [{ key: "x1", def: character({ name: "Filler One", trade: "banker" }), owner: P1, zone: "deck" }] });
  play(none.engine, P1, none.id("tech"), { selected: { found: [] } });
  assert.equal(pending(none.engine), undefined);
  assert.equal(zoneOf(none.engine, none.id("x1")), "deck");
  assert.equal(readyResources(none.engine, P1), 0);
  assert.equal(none.engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed").length, 0, "nothing was revealed");
});

clause(TECH, "0:rule", "searching shuffles the deck afterwards (CR 312.1), with or without a find", () => {
  const found = techBoard({ random: () => 0 });
  const before = [...found.engine.state.players[P1].deck];
  play(found.engine, P1, found.id("tech"), { selected: { found: [found.id("g1")] } });
  const remaining = before.filter((c) => c !== found.id("g1"));
  assert.deepEqual([...found.engine.state.players[P1].deck].sort(), [...remaining].sort(), "the same cards remain");
  assert.deepEqual(found.engine.state.players[P1].deck, shuffledWithConstant(remaining, 0), "and they were shuffled");
  const failed = techBoard({ random: () => 0 });
  const deckBefore = [...failed.engine.state.players[P1].deck];
  play(failed.engine, P1, failed.id("tech"), { selected: { found: [] } });
  assert.deepEqual([...failed.engine.state.players[P1].deck].sort(), [...deckBefore].sort());
  assert.deepEqual(failed.engine.state.players[P1].deck, shuffledWithConstant(deckBefore, 0), "a search that finds nothing still shuffles");
});

clause(TECH, "0:rule", "cost 4 and [E][E][E]: one resource short, or four resources with only two [E], is refused", () => {
  const shortCost = techBoard({ elitism: 3 });
  refused(() => playRaw(shortCost.engine, P1, shortCost.id("tech"), { selected: { found: [shortCost.id("g1")] } }), "3 resources for a cost of 4");
  assert.equal(zoneOf(shortCost.engine, shortCost.id("tech")), "hand");
  const shortThreshold = techBoard({ elitism: 2, rage: 2 });
  refused(
    () => playRaw(shortThreshold.engine, P1, shortThreshold.id("tech"), { selected: { found: [shortThreshold.id("g1")] } }),
    "only two [E]",
    /threshold/i
  );
  assert.equal(zoneOf(shortThreshold.engine, shortThreshold.id("tech")), "hand");
  const ok = techBoard({ elitism: 3, rage: 1 });
  play(ok.engine, P1, ok.id("tech"), { selected: { found: [ok.id("g1")] } });
  assert.equal(zoneOf(ok.engine, ok.id("tech")), "discard", "control: [E][E][E] + 1 other resource");
  assert.equal(attachedCount(ok.engine, P1), 4, "the cost 4 was paid");
});

// =====================================================================================
// A Boy and His Toy — character (gearsmith, inventor), cost 4, threshold [E], 3 strength / 3 speed / 3 life
// When this card enters play, put a Micromajig token into play under your control.
// =====================================================================================

const BOY = "cb769940-1672-4f8a-bb37-9de5487e56e2";
const MICRO = (engine: SpoilsEngine, player: PlayerId) => tokensNamed(engine, player, "Micromajig");

const reanimate = (): CardDefinition =>
  tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "r",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });

clause(BOY, "0:rule", "deploying it puts exactly one Micromajig token (a 1/1/3 'majig' character card) into play under my control", () => {
  const { engine, id } = duo([{ key: "boy", def: printing(BOY), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]);
  assert.equal(MICRO(engine, P1).length, 0);
  play(engine, P1, id("boy"));
  assert.equal(pending(engine), undefined);
  assert.equal(zoneOf(engine, id("boy")), "play");
  const tokens = MICRO(engine, P1);
  assert.equal(tokens.length, 1, "one token");
  assert.equal(MICRO(engine, P2).length, 0, "none for the opponent");
  const token = tokens[0];
  assert.equal(engine.state.cards[token].isToken, true);
  assert.equal(controllerOf(engine, token), P1);
  assert.equal(engine.getDefinition(token).type, "character");
  assert.deepEqual(stat(engine, token), [1, 1, 3], "1 strength, 1 life, 3 speed (CR 409.3c)");
  assert.deepEqual(engine.getDefinition(token).subtype, ["majig"]);
  assert.equal(engine.state.cards[token].faceDown, false);
});

clause(BOY, "0:rule", "the Micromajig token is a Gearsmith character card (CR 409.3c)", () => {
  const { engine, id } = duo([{ key: "boy", def: printing(BOY), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]);
  play(engine, P1, id("boy"));
  const [token] = MICRO(engine, P1);
  assert.ok(token, "there is a token");
  assert.equal(engine.getDefinition(token).trade, "gearsmith");
});

clause(BOY, "0:rule", "it triggers when it enters play by any route, not just deployment (put into play from the discard pile)", () => {
  const { engine, id } = duo([
    { key: "boy", def: printing(BOY), owner: P1, zone: "discard" },
    { key: "re", def: reanimate(), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("re"), { selected: { t: [id("boy")] } });
  assert.equal(zoneOf(engine, id("boy")), "play");
  assert.equal(MICRO(engine, P1).length, 1, "one token for the Boy entering play");
});

clause(BOY, "0:rule", "only when THIS card enters: another character entering, or the token itself, makes no further tokens; each copy makes its own", () => {
  const { engine, id } = duo([
    { key: "boy", def: printing(BOY), owner: P1, zone: "hand" },
    { key: "boy2", def: printing(BOY), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
    ...bank("elitism", 4, P1)
  ]);
  play(engine, P1, id("plain"));
  assert.equal(MICRO(engine, P1).length, 0, "another character entering (with a Boy already in play) makes no token");
  play(engine, P1, id("boy"));
  assert.equal(MICRO(engine, P1).length, 1, "only the entering copy triggers; the token entering did not chain");
});

clause(BOY, "0:rule", "it does nothing while it is not entering play: sitting in hand makes no token", () => {
  const { engine } = duo([{ key: "boy", def: printing(BOY), owner: P1, zone: "hand" }, ...bank("elitism", 4, P1)]);
  assert.equal(MICRO(engine, P1).length, 0);
});

// =====================================================================================
// Abused 31f Conveyer — character (gearsmith; mechanic, 31f), cost 5, threshold [E][E], 3 strength / 3 speed / 3 life
// When this card enters play, you may pick a character. This turn, the picked character gains 3 strength and 3 life.
// =====================================================================================

const CONV = "28ef7fe5-9418-4a10-b0ae-be6a8165e9b8";

function convBoard(extra: CardPlacement[] = []) {
  return duo([
    { key: "conv", def: printing(CONV), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine", strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
    ...bank("elitism", 5, P1),
    ...extra
  ]);
}
const pickBuff = (engine: SpoilsEngine, ids: CardInstanceId[]) => answerPending(engine, "selectTargets", { selected: { buff: ids } });

clause(CONV, "0:rule", "entering play offers a pick; the picked character of mine gains exactly +3 strength and +3 life this turn", () => {
  const { engine, id } = convBoard();
  play(engine, P1, id("conv"));
  const pc = pending(engine);
  assert.ok(pc, "a pick is offered");
  assert.equal(pc.kind, "selectTargets");
  assert.equal(pc.playerId, P1);
  pickBuff(engine, [id("mine")]);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(stat(engine, id("mine")), [5, 5, 2], "2/2 becomes 5/5, speed untouched");
  assert.deepEqual(stat(engine, id("foe")), [1, 4, 1], "nobody else changed");
  assert.deepEqual(stat(engine, id("conv")), [3, 3, 3], "the Conveyer itself keeps its printed 3/3");
});

clause(CONV, "0:rule", "'a character': an opponent's character can be picked, and so can the Conveyer itself", () => {
  const foe = convBoard();
  play(foe.engine, P1, foe.id("conv"));
  pickBuff(foe.engine, [foe.id("foe")]);
  assert.deepEqual(stat(foe.engine, foe.id("foe")), [4, 7, 1], "the opponent's character gains too");
  assert.deepEqual(stat(foe.engine, foe.id("mine")), [2, 2, 2]);
  const self = convBoard();
  play(self.engine, P1, self.id("conv"));
  pickBuff(self.engine, [self.id("conv")]);
  assert.deepEqual(stat(self.engine, self.id("conv")), [6, 6, 3], "itself: 3/3 becomes 6/6");
});

clause(CONV, "0:rule", "'you may': declining the pick changes nothing", () => {
  const { engine, id } = convBoard();
  play(engine, P1, id("conv"));
  pickBuff(engine, []);
  assert.equal(pending(engine), undefined);
  assert.deepEqual(stat(engine, id("mine")), [2, 2, 2]);
  assert.deepEqual(stat(engine, id("foe")), [1, 4, 1]);
  assert.deepEqual(stat(engine, id("conv")), [3, 3, 3]);
});

clause(CONV, "0:rule", "only a character in play can be picked: not an item, location, faction, or a character in hand / discard", () => {
  const { engine, id } = convBoard([
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" },
    { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDisc", def: character({ name: "InDisc" }), owner: P1, zone: "discard" }
  ]);
  play(engine, P1, id("conv"));
  assert.ok(pending(engine), "pending(engine)");
  const pick = (cardId: CardInstanceId) =>
    engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "selectTargets", selected: { buff: [cardId] } } } as never);
  refused(() => pick(id("itm")), "an item");
  refused(() => pick(id("loc")), "a location");
  refused(() => pick(engine.state.players[P1].factionId!), "my faction");
  refused(() => pick(id("inHand")), "a character in my hand");
  refused(() => pick(id("inDisc")), "a character in my discard pile");
  assert.ok(pending(engine), "still waiting for a legal pick");
  pickBuff(engine, [id("mine")]);
  assert.deepEqual(stat(engine, id("mine")), [5, 5, 2], "control: a character in play works");
});

clause(CONV, "0:rule", "'this turn': the bonus is gone when the turn ends", () => {
  const { engine, id } = convBoard();
  play(engine, P1, id("conv"));
  pickBuff(engine, [id("mine")]);
  assert.deepEqual(stat(engine, id("mine")), [5, 5, 2]);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the next turn has started");
  assert.deepEqual(stat(engine, id("mine")), [2, 2, 2], "back to 2/2");
});

clause(CONV, "0:rule", "it triggers only when THIS card enters: with a Conveyer already in play, another character entering offers no pick", () => {
  const { engine, id } = convBoard([
    { key: "conv2", def: printing(CONV), owner: P1, zone: "play" },
    { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  play(engine, P1, id("plain"));
  assert.equal(zoneOf(engine, id("plain")), "play");
  assert.equal(pending(engine), undefined, "the Conveyer in play does not react to another card entering");
  assert.deepEqual(stat(engine, id("mine")), [2, 2, 2]);
  assert.deepEqual(stat(engine, id("conv2")), [3, 3, 3]);
  play(engine, P1, id("conv"));
  assert.ok(pending(engine), "control: the Conveyer itself entering does offer the pick");
});

// =====================================================================================
// Changing Boothmajig — character (gearsmith, majig), cost 2, threshold [E][E], 2 strength / 3 speed / 2 life
// WARDROBE CHANGE -- COST: Deplete this card. Pick a character. Pick a "gear" card you control. -- EFFECT: Attach
// the "gear" card to the character.
// =====================================================================================

const BOOTH = "5c84be16-72c8-4890-9b04-9520ff2d798a";
const gearDef = (name = "Gear", subtype: string[] = ["gear"]) => item({ name, subtype, attachTo: "character" });

function boothBoard(extra: CardPlacement[] = []) {
  return duo([
    { key: "booth", def: printing(BOOTH), owner: P1, zone: "play" },
    { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" },
    { key: "wearer", def: character({ name: "Wearer" }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    { key: "gear", def: gearDef(), owner: P1, zone: "play", attachedToKey: "host" },
    ...extra
  ]);
}
const wardrobe = (engine: SpoilsEngine, id: Ids, wearer: string, gear: string, who: PlayerId = P1) =>
  activate(engine, who, id("booth"), "wardrobe-change", { selected: { wearer: [id(wearer)], gear: [id(gear)] } });

clause(BOOTH, "0:ability:wardrobe-change", "COST + EFFECT: the Boothmajig is depleted and the gear card moves from its old host to the picked character", () => {
  const { engine, id } = boothBoard();
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"), "setup: attached to the old host");
  assert.equal(engine.state.cards[id("booth")].depleted, false);
  wardrobe(engine, id, "wearer", "gear");
  assert.equal(pending(engine), undefined);
  assert.equal(engine.state.cards[id("booth")].depleted, true, "COST: deplete this card");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("wearer"), "attached to the picked character");
  assert.equal(zoneOf(engine, id("gear")), "play");
  assert.equal(controllerOf(engine, id("gear")), P1);
  assert.equal(zoneOf(engine, id("host")), "play", "the old host is untouched");
});

clause(BOOTH, "0:ability:wardrobe-change", "'a character': any character in play can wear it, including an opponent's and the Boothmajig itself", () => {
  const foe = boothBoard();
  wardrobe(foe.engine, foe.id, "foe", "gear");
  assert.equal(foe.engine.state.cards[foe.id("gear")].attachedTo, foe.id("foe"), "the opponent's character");
  assert.equal(controllerOf(foe.engine, foe.id("gear")), P1, "I still control the gear card");
  const self = boothBoard();
  wardrobe(self.engine, self.id, "booth", "gear");
  assert.equal(self.engine.state.cards[self.id("gear")].attachedTo, self.id("booth"), "the Boothmajig itself");
});

clause(BOOTH, "0:ability:wardrobe-change", "the card to attach must be a 'gear' card in play that I control", () => {
  const { engine, id } = boothBoard([
    { key: "trinket", def: gearDef("Trinket", ["trinket"]), owner: P1, zone: "play", attachedToKey: "host" },
    { key: "foeGear", def: gearDef("FoeGear"), owner: P2, zone: "play", attachedToKey: "foe" },
    { key: "handGear", def: gearDef("HandGear"), owner: P1, zone: "hand" },
    { key: "discGear", def: gearDef("DiscGear"), owner: P1, zone: "discard" }
  ]);
  refused(() => wardrobe(engine, id, "wearer", "trinket"), "an item without the gear subtype");
  refused(() => wardrobe(engine, id, "wearer", "foeGear"), "a gear card the opponent controls");
  refused(() => wardrobe(engine, id, "wearer", "handGear"), "a gear card in my hand");
  refused(() => wardrobe(engine, id, "wearer", "discGear"), "a gear card in my discard pile");
  assert.equal(engine.state.cards[id("booth")].depleted, false, "nothing was paid by the refused attempts");
  assert.equal(engine.state.cards[id("trinket")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("foeGear")].attachedTo, id("foe"));
  wardrobe(engine, id, "wearer", "gear");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("wearer"), "control: a gear card I control works");
});

clause(BOOTH, "0:ability:wardrobe-change", "the host must be a character: a location, an item or my faction is refused", () => {
  const { engine, id } = boothBoard([
    { key: "loc", def: location({ name: "Loc" }), owner: P1, zone: "play" },
    { key: "itm", def: item({ name: "Itm" }), owner: P1, zone: "play" }
  ]);
  refused(() => wardrobe(engine, id, "loc", "gear"), "a location as the wearer");
  refused(() => wardrobe(engine, id, "itm", "gear"), "an item as the wearer");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  assert.equal(engine.state.cards[id("booth")].depleted, false);
  wardrobe(engine, id, "wearer", "gear");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("wearer"), "control: a character works");
});

clause(BOOTH, "0:ability:wardrobe-change", "the COST deplete: a depleted Boothmajig cannot use it, so it is once per restore", () => {
  const { engine, id } = boothBoard();
  engine.state.cards[id("booth")].depleted = true;
  refused(() => wardrobe(engine, id, "wearer", "gear"), "the Boothmajig is depleted");
  assert.equal(engine.state.cards[id("gear")].attachedTo, id("host"));
  const fresh = boothBoard();
  wardrobe(fresh.engine, fresh.id, "wearer", "gear");
  refused(() => wardrobe(fresh.engine, fresh.id, "host", "gear"), "a second use the same turn");
  assert.equal(fresh.engine.state.cards[fresh.id("gear")].attachedTo, fresh.id("wearer"), "the second use did nothing");
});

// =====================================================================================
// Cr4ck13 — character (gearsmith, 31f), cost 4, threshold [E][E], 2 strength / 2 speed / 3 life
// When damage is inflicted to this card, put that many Micromajig tokens into play under your control.
// =====================================================================================

const CRAC = "5604d122-d915-448d-9c96-0927c0590781";

function crackBoard(extra: CardPlacement[] = [], o: { controller?: PlayerId; active?: PlayerId } = {}) {
  return duo(
    [
      { key: "cr", def: printing(CRAC), owner: P1, zone: "play", controller: o.controller },
      { key: "mine", def: character({ name: "Mine", life: 6 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 6 }), owner: P2, zone: "play" },
      ...extra
    ],
    { active: o.active }
  );
}
const zapAt = (engine: SpoilsEngine, id: Ids, tactic: string, target: string, who: PlayerId = P1) =>
  play(engine, who, id(tactic), { selected: { t: [id(target)] } });

clause(CRAC, "0:rule", "2 damage inflicted to it puts 2 Micromajig tokens (1/1/3 majig characters) into play under my control", () => {
  const { engine, id } = crackBoard([{ key: "z", def: zap(2), owner: P1, zone: "hand" }]);
  zapAt(engine, id, "z", "cr");
  assert.equal(pending(engine), undefined);
  assert.equal(damageOn(engine, id("cr")), 2);
  const tokens = tokensNamed(engine, P1, "Micromajig");
  assert.equal(tokens.length, 2, "one token per damage");
  assert.equal(tokensNamed(engine, P2, "Micromajig").length, 0);
  for (const token of tokens) {
    assert.equal(engine.state.cards[token].isToken, true);
    assert.equal(engine.getDefinition(token).type, "character");
    assert.deepEqual(stat(engine, token), [1, 1, 3]);
    assert.deepEqual(engine.getDefinition(token).subtype, ["majig"]);
    assert.equal(controllerOf(engine, token), P1);
  }
});

clause(CRAC, "0:rule", "the count is the damage inflicted: 1 damage makes 1 token, 3 damage makes 3", () => {
  for (const amount of [1, 3]) {
    const { engine, id } = crackBoard([{ key: "z", def: zap(amount), owner: P1, zone: "hand" }], { active: P1 });
    zapAt(engine, id, "z", "cr");
    drain(engine, declineAll);
    assert.equal(tokensNamed(engine, P1, "Micromajig").length, amount, `${amount} damage -> ${amount} tokens`);
  }
});

clause(CRAC, "0:rule", "tokens accumulate over separate damage events (1 then 2 makes 3), and a destroyed Cr4ck13 (3 damage on 3 life) still makes them", () => {
  const split = crackBoard([
    { key: "z1", def: zap(1), owner: P1, zone: "hand" },
    { key: "z2", def: zap(2), owner: P1, zone: "hand" }
  ]);
  zapAt(split.engine, split.id, "z1", "cr");
  assert.equal(tokensNamed(split.engine, P1, "Micromajig").length, 1);
  zapAt(split.engine, split.id, "z2", "cr");
  assert.equal(tokensNamed(split.engine, P1, "Micromajig").length, 3, "1 + 2");
  assert.equal(zoneOf(split.engine, split.id("cr")), "discard", "3 damage on 3 life destroyed it");
  const lethal = crackBoard([{ key: "z", def: zap(3), owner: P1, zone: "hand" }]);
  zapAt(lethal.engine, lethal.id, "z", "cr");
  drain(lethal.engine, declineAll);
  assert.equal(zoneOf(lethal.engine, lethal.id("cr")), "discard");
  assert.equal(tokensNamed(lethal.engine, P1, "Micromajig").length, 3, "the tokens still arrive although it died");
});

clause(CRAC, "0:rule", "damage inflicted to OTHER cards makes no tokens (my other character, the opponent's character)", () => {
  const { engine, id } = crackBoard([{ key: "z", def: zap(2), owner: P1, zone: "hand" }, { key: "z2", def: zap(2), owner: P1, zone: "hand" }]);
  zapAt(engine, id, "z", "mine");
  assert.equal(damageOn(engine, id("mine")), 2);
  zapAt(engine, id, "z2", "foe");
  assert.equal(damageOn(engine, id("foe")), 2);
  assert.equal(pending(engine), undefined);
  assert.equal(tokensNamed(engine, P1, "Micromajig").length, 0);
  assert.equal(tokensNamed(engine, P2, "Micromajig").length, 0);
});

clause(CRAC, "0:rule", "battle damage inflicted to it counts: blocking an attacker with 2 strength makes 2 tokens; damage it DEALS makes none", () => {
  const blocked = crackBoard([{ key: "atk", def: character({ name: "Atk", strength: 2, life: 6, speed: 2 }), owner: P2, zone: "play" }], { active: P2 });
  declareAttackBy(blocked.engine, P2, [blocked.id("atk")]);
  declareBlockers(blocked.engine, P1, [blocked.id("cr")]);
  finishBattle(blocked.engine);
  assert.equal(damageOn(blocked.engine, blocked.id("cr")), 2);
  assert.equal(tokensNamed(blocked.engine, P1, "Micromajig").length, 2, "2 battle damage -> 2 tokens");
  const dealt = crackBoard([{ key: "wall", def: character({ name: "Wall", strength: 0, life: 6, speed: 1 }), owner: P2, zone: "play" }]);
  declareAttackBy(dealt.engine, P1, [dealt.id("cr")]);
  declareBlockers(dealt.engine, P2, [dealt.id("wall")]);
  finishBattle(dealt.engine);
  assert.equal(damageOn(dealt.engine, dealt.id("wall")), 2, "Cr4ck13 dealt its 2 strength to the blocker");
  assert.equal(damageOn(dealt.engine, dealt.id("cr")), 0, "and took none");
  assert.equal(tokensNamed(dealt.engine, P1, "Micromajig").length, 0, "damage it deals makes no tokens");
});

clause(CRAC, "0:rule", "'under your control': if an opponent controls Cr4ck13, the tokens enter under THEIR control", () => {
  const { engine, id } = crackBoard([{ key: "z", def: zap(2), owner: P2, zone: "hand" }], { controller: P2, active: P2 });
  zapAt(engine, id, "z", "cr", P2);
  assert.equal(tokensNamed(engine, P2, "Micromajig").length, 2, "the controller (P2) gets the tokens");
  assert.equal(tokensNamed(engine, P1, "Micromajig").length, 0, "not its owner");
});

clause(CRAC, "0:rule", "the Micromajig tokens are Gearsmith character cards (CR 409.3c)", () => {
  const { engine, id } = crackBoard([{ key: "z", def: zap(1), owner: P1, zone: "hand" }]);
  zapAt(engine, id, "z", "cr");
  const [token] = tokensNamed(engine, P1, "Micromajig");
  assert.ok(token, "there is a token");
  assert.equal(engine.getDefinition(token).trade, "gearsmith");
});

// ---- END OF PART 1 ----


// --- review gap: only ACTIVATED abilities on locations are blocked; a location's triggered / static text still works ---
const richLocation = (): CardDefinition =>
  location({
    name: "RichLoc",
    structure: 3,
    behavior: {
      abilities: [
        { id: "use", type: "activated", costs: [], effects: [{ type: "modifyInfluence", player: "controller", amount: 1 }] },
        { id: "watch", type: "triggered", event: "cardEnteredPlay", effects: [{ type: "modifyInfluence", player: "controller", amount: 2 }] },
        { id: "sturdy", type: "continuous", modifiers: [{ target: "source", stat: "structure", operation: "add", value: 2 }] }
      ]
    }
  });

clause(ELF, "0:rule", "'abilities' means activated abilities: a location's triggered text still fires and its static text still applies while its activated ability is refused", () => {
  const { engine, id } = duo([
    { key: "elf", def: printing(ELF), owner: P1, zone: "play" },
    { key: "loc", def: richLocation(), owner: P1, zone: "play" },
    { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  assert.equal(engine.getStat(id("loc"), "structure"), 5, "static text still applies (3 + 2)");
  const before = influence(engine, P1);
  refused(() => activate(engine, P1, id("loc"), "use"), "activated ability is blocked");
  assert.equal(influence(engine, P1), before);
  play(engine, P1, id("newbie"), {});
  assert.equal(zoneOf(engine, id("newbie")), "play");
  assert.equal(influence(engine, P1), before + 2, "triggered text still resolves");
});

clause(ELF, "0:rule", "positive control for the triggered/static location: without the Elf the activated ability works too", () => {
  const { engine, id } = duo([
    { key: "loc", def: richLocation(), owner: P1, zone: "play" },
    { key: "newbie", def: character({ name: "Newbie", cost: 0 }), owner: P1, zone: "hand" }
  ]);
  assert.equal(engine.getStat(id("loc"), "structure"), 5);
  const before = influence(engine, P1);
  activate(engine, P1, id("loc"), "use");
  assert.equal(influence(engine, P1), before + 1);
  play(engine, P1, id("newbie"), {});
  assert.equal(influence(engine, P1), before + 3);
});
