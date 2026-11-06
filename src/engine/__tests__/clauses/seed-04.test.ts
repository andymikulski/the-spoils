// Clause tests — batch seed-04. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-04`. Expectations come from each card's
// PRINTED text, RULES.md and the Comprehensive Rules; engine data is only used
// to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  killTactic,
  location,
  play,
  resolvePendingResponses,
  resourceCard,
  tactic,
  volition,
  P1,
  P2
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, flipUpNow } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import {
  battleOf,
  declareAttackBy,
  declareAttackOpenWindow,
  playRaw
} from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ greed: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const damageOf = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted;
const START = 30; // developFaction() starting influence

/** A P1 / P2 board whose factions can both develop. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** `n` face-up resources of `icon` for `owner`, already attached to (spent on) `owner`'s faction. They still provide their icons. */
function spentRes(icon: StapleIcon, owner: PlayerId, n: number): CardPlacement[] {
  return bank(icon, n, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));
}

/** Raw `activateAbility` WITHOUT draining the response window. */
function actRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables } as never);
}

/** Raw `flipUp` WITHOUT draining the response window. */
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** A raw (non-asserting) `resolvePendingChoice`, for `refused(...)`. */
const answerRaw = (engine: SpoilsEngine, playerId: PlayerId, choice: Record<string, unknown>) => () =>
  engine.perform({ type: "resolvePendingChoice", playerId, choice } as never);

/** A raw search / pick answer for the open `chooserSelectsTarget`. */
const tryPick = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) =>
  answerRaw(engine, playerId, { kind: "chooserSelectsTarget", selected });

/** `playerId` plays `cardId` as a response while the response window is open (does not drain it). */
function respondRaw(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  engine.perform({ type: "playCard", playerId, cardId, selected, variables: {} } as never);
}

/** `playerId` plays `cardId` as a response and drains the response windows. */
function respondWith(engine: SpoilsEngine, playerId: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  respondRaw(engine, playerId, cardId, selected);
  resolvePendingResponses(engine);
}

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** `n` vanilla characters in `owner`'s zone, keyed `<prefix>0..n-1`, top of the deck first. */
const chars = (prefix: string, n: number, owner: PlayerId, zone: CardPlacement["zone"]): CardPlacement[] =>
  fillers(prefix, n, owner, zone, (i) => character({ name: `${prefix.toUpperCase()}${i}` }));

/** A free tactic (id "zap", pick "t"): deals `amount` damage to one picked card in play of `type`. */
const zapTactic = (name: string, amount: number, type: "character" | "location" = "character"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic (id "term"): terminates the newest unresolved card or ability on the response stack. */
const terminatorTactic = (name = "Terminator"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "term", type: "activated", effects: [{ type: "terminate", scope: "respondedItem" }] }] }
  });

/** A free tactic (id "kill", pick "t"): destroys one picked card in play of `type`. */
const destroyTactic = (type: "character" | "item" | "location" | "resource"): CardDefinition =>
  tactic({
    name: `Destroy ${type}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "kill", type: "activated", targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });

/** A free tactic (id "hurt"): deals `amount` damage to the PLAYER'S OWN faction (`who` = the playing player's own, or the opponent's). */
const factionZap = (name: string, amount: number, who: "controller" | "opponent"): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hurt",
          type: "activated",
          effects: [{ type: "dealDamage", target: { type: "factionOf", player: who }, amount }]
        }
      ]
    }
  });

// =================================================================================
// High Court of Demands
// When this card enters play, draw a card.
// Your opponent cannot attack your faction.
// Location (banker), cost 3, [G], structure 1.
// =================================================================================

const HIGH_COURT = "61688c92-96d1-40ae-ac64-2975d292b0d9";

function courtBoard(
  opts: { court?: "hand" | "play" | "discard"; icons?: Icons; deck?: number; turn?: number; active?: PlayerId; extra?: CardPlacement[]; courtFaceDown?: boolean } = {}
) {
  return devBoard(
    [
      { key: "court", def: printing(HIGH_COURT), owner: P1, zone: opts.court ?? "hand", faceDown: opts.courtFaceDown },
      ...chars("d", opts.deck ?? 4, P1, "deck"),
      ...chars("h", 2, P1, "hand"),
      ...chars("od", 3, P2, "deck"),
      ...chars("oh", 2, P2, "hand"),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

clause(HIGH_COURT, "0:rule", "deploys for exactly its printed cost of 3 with [G]: refused one resource short and refused without [G]", () => {
  const short = courtBoard({ icons: { greed: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("court")), "2 resources: one short of 3");
  assert.equal(zoneOf(short.engine, short.id("court")), "hand", "nothing was played");
  const noGreed = courtBoard({ icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("court")), "plenty of resources but no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("court")), "hand");
  const { engine, id } = courtBoard({ icons: { greed: 5 } });
  const before = ready(engine);
  play(engine, P1, id("court"));
  assert.equal(before - ready(engine), 3, "exactly the printed cost is paid");
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(engine.state.cards[id("court")].controllerId, P1);
});

clause(HIGH_COURT, "0:rule", "has its printed structure of 1: 1 damage destroys it, 0 does not (it is a location, with no strength or life)", () => {
  const { engine, id } = courtBoard({ court: "play", extra: [{ key: "zap", def: zapTactic("Zap1", 1, "location"), owner: P1, zone: "hand" }] });
  assert.equal(engine.getDefinition(id("court")).type, "location");
  assert.equal(engine.getDefinition(id("court")).structure, 1);
  assert.equal(damageOf(engine, id("court")), 0);
  play(engine, P1, id("zap"), { selected: { t: [id("court")] } });
  assert.equal(zoneOf(engine, id("court")), "discard", "1 damage meets its structure of 1");
});

clause(HIGH_COURT, "0:rule", "when it enters play its controller draws exactly one card, the top card of their deck", () => {
  const { engine, id } = courtBoard();
  const top = deckOf(engine, P1)[0];
  const second = deckOf(engine, P1)[1];
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const oppDeck = deckOf(engine, P2).length;
  play(engine, P1, id("court"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the location left the hand and exactly one card was drawn");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(zoneOf(engine, top), "hand", "the top card is the one drawn");
  assert.equal(zoneOf(engine, second), "deck", "only one card");
  assert.equal(handOf(engine, P2).length, oppHand, "the opponent draws nothing");
  assert.equal(deckOf(engine, P2).length, oppDeck, "the opponent's deck is untouched");
});

clause(HIGH_COURT, "0:rule", "the draw happens when it enters play (resolves), not while the opponent can still respond", () => {
  const { engine, id } = courtBoard();
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("court"));
  assert.ok(engine.state.responseWindow, "the response window is open");
  assert.equal(zoneOf(engine, id("court")), "deploying");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing has been drawn yet: the card is only being deployed");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "it drew when it entered play");
});

clause(HIGH_COURT, "0:rule", "if the card is terminated while being deployed it never enters play, so nothing is drawn", () => {
  const { engine, id } = courtBoard({ extra: [{ key: "term", def: terminatorTactic(), owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  const top = deckOf(engine, P1)[0];
  playRaw(engine, P1, id("court"));
  respondWith(engine, P2, id("term"));
  assert.equal(zoneOf(engine, id("court")), "discard", "terminated: it went to its owner's discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no card was drawn");
  assert.equal(zoneOf(engine, top), "deck");
});

clause(HIGH_COURT, "0:rule", "it draws only for itself: another location entering play later draws nothing, and a second Court draws one card for its own entering only", () => {
  const second = { key: "court2", def: printing(HIGH_COURT), owner: P1, zone: "hand" as const };
  const plain = { key: "plain", def: location({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" as const };
  const { engine, id } = courtBoard({ court: "play", icons: { greed: 8 }, extra: [second, plain] });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("plain"));
  assert.equal(handOf(engine, P1).length, handBefore - 1, "an ordinary location entering play does not make the Court in play draw");
  play(engine, P1, id("court2"));
  assert.equal(handOf(engine, P1).length, handBefore - 2 + 1, "the second Court draws exactly one card (its own), not two");
});

clause(HIGH_COURT, "0:rule", "an empty deck: nothing is drawn and it is not a loss (CR 102.1a)", () => {
  const { engine, id } = courtBoard({ deck: 0 });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("court"));
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "there was nothing to draw");
  assert.equal(engine.state.result, undefined);
});

clause(HIGH_COURT, "0:rule", "entering play by an effect (put into play, not deployed) still triggers 'enters play': one card is drawn", () => {
  const raise = tactic({
    name: "Raise Location",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "location" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = courtBoard({ court: "discard", extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("raise"), { selected: { t: [id("court")] } });
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(zoneOf(engine, top), "hand", "its enters-play trigger drew the top card");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1);
});

clause(HIGH_COURT, "0:rule", "the opponent's Court makes the OPPONENT draw (the controller of the entering card draws)", () => {
  const { engine, id } = courtBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "ocourt", def: printing(HIGH_COURT), owner: P2, zone: "hand" },
      ...res({ greed: 5 }, P2)
    ]
  });
  const mine = handOf(engine, P1).length;
  const theirs = handOf(engine, P2).length;
  play(engine, P2, id("ocourt"));
  assert.equal(handOf(engine, P2).length, theirs - 1 + 1, "its controller draws");
  assert.equal(handOf(engine, P1).length, mine, "I draw nothing");
});

clause(HIGH_COURT, "0:rule", "played face-down as a resource it is only a resource: it does not draw", () => {
  const { engine, id } = courtBoard({ extra: [] });
  const handBefore = handOf(engine, P1).length;
  developResource(engine, P1, id("court"), true);
  assert.equal(zoneOf(engine, id("court")), "play");
  assert.equal(engine.state.cards[id("court")].faceDown, true);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no card is drawn: a face-down card has no rules text (CR 411.1)");
});

// --- Your opponent cannot attack your faction ---------------------------------

/** P2 attacks P1's faction with `foe`; the Court (P1's) is in play unless `court` says otherwise. */
const attackFaction = (game: { engine: SpoilsEngine; id: (key: string) => CardInstanceId }, attackers = ["foe"]) =>
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: attackers.map(game.id), target: { type: "faction", playerId: P1 } });

clause(HIGH_COURT, "1:rule", "while it is in play my opponent cannot attack my faction (refused), and with no Court the same attack is legal", () => {
  const withCourt = courtBoard({ court: "play", turn: 2, active: P2 });
  refused(() => attackFaction(withCourt), "the Court forbids attacking my faction");
  assert.equal(withCourt.engine.state.battle, undefined, "no battle began");
  assert.equal(isDepleted(withCourt.engine, withCourt.id("foe")), false, "the would-be attacker was not depleted");
  assert.equal(influenceOf(withCourt.engine, P1), START);
  const without = courtBoard({ court: "hand", turn: 2, active: P2 });
  attackFaction(without);
  assert.ok(without.engine.state.battle, "control: with the Court still in my hand the attack on my faction is legal");
});

clause(HIGH_COURT, "1:rule", "it forbids any attacking party: two attackers together are refused as well (and the same party may attack when there is no Court)", () => {
  const extra: CardPlacement[] = [{ key: "foe2", def: character({ name: "Foe2", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }];
  const { engine, id } = courtBoard({ court: "play", turn: 2, active: P2, extra });
  refused(() => engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [id("foe"), id("foe2")], target: { type: "faction", playerId: P1 } }), "party of two");
  assert.equal(engine.state.battle, undefined);
  assert.equal(isDepleted(engine, id("foe")), false);
  assert.equal(isDepleted(engine, id("foe2")), false);
  const control = courtBoard({ court: "hand", turn: 2, active: P2, extra });
  control.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [control.id("foe"), control.id("foe2")], target: { type: "faction", playerId: P1 } });
  assert.deepEqual(battleOf(control.engine)?.attackingParty.length, 2, "control: the same two-character party can attack my faction without the Court");
});

clause(HIGH_COURT, "1:rule", "it only protects my FACTION: my opponent can still attack one of my locations (including the Court itself)", () => {
  const board = () =>
    courtBoard({ court: "play", turn: 2, active: P2, extra: [{ key: "place", def: location({ name: "Place", structure: 5 }), owner: P1, zone: "play" }] });
  const a = board();
  a.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [a.id("foe")], target: { type: "card", cardId: a.id("place") } });
  assert.ok(a.engine.state.battle, "attacking my other location is legal");
  const b = board();
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("foe")], target: { type: "card", cardId: b.id("court") } });
  assert.ok(b.engine.state.battle, "attacking the Court itself is legal");
});

clause(HIGH_COURT, "1:rule", "it protects only 'your' faction: the Court's controller can still attack the opponent's faction", () => {
  const { engine, id } = courtBoard({ court: "play", turn: 2, active: P1 });
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.battle, "my own attack on their faction is not restricted");
});

clause(HIGH_COURT, "1:rule", "once the Court leaves play (destroyed), the restriction is gone and my faction can be attacked", () => {
  const { engine, id } = courtBoard({ court: "play", turn: 2, active: P2, extra: [{ key: "zap", def: zapTactic("Zap1", 1, "location"), owner: P2, zone: "hand" }] });
  refused(() => attackFaction({ engine, id }), "restricted while the Court is in play");
  respondWith(engine, P2, id("zap"), { t: [id("court")] });
  assert.equal(zoneOf(engine, id("court")), "discard");
  attackFaction({ engine, id });
  assert.ok(engine.state.battle, "the attack on my faction is now legal");
});

clause(HIGH_COURT, "1:rule", "it is controller-relative: a Court controlled by the opponent forbids ME to attack THEIR faction, and not them to attack mine", () => {
  const theirs: CardPlacement = { key: "court", def: printing(HIGH_COURT), owner: P2, zone: "play" };
  const mineTurn = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [theirs, { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" }]
  });
  refused(
    () => mineTurn.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [mineTurn.id("mine")], target: { type: "faction", playerId: P2 } }),
    "their Court protects their faction from me"
  );
  const theirTurn = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [theirs, { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" }]
  });
  theirTurn.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [theirTurn.id("foe")], target: { type: "faction", playerId: P1 } });
  assert.ok(theirTurn.engine.state.battle, "their Court does not protect MY faction");
});

clause(HIGH_COURT, "1:rule", "with a Court in play for each player, neither player can attack the other's faction", () => {
  const cards: CardPlacement[] = [
    { key: "court", def: printing(HIGH_COURT), owner: P1, zone: "play" },
    { key: "ocourt", def: printing(HIGH_COURT), owner: P2, zone: "play" },
    { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" },
    { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" }
  ];
  const p1Turn = devBoard(cards, { turn: 2, activePlayerId: P1 });
  refused(() => p1Turn.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [p1Turn.id("mine")], target: { type: "faction", playerId: P2 } }), "P1 into P2's Court");
  const p2Turn = devBoard(cards, { turn: 2, activePlayerId: P2 });
  refused(() => p2Turn.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [p2Turn.id("foe")], target: { type: "faction", playerId: P1 } }), "P2 into P1's Court");
});

clause(HIGH_COURT, "1:rule", "a Court that is not in play restricts nothing: in my hand, in my discard pile, or face-down as a resource", () => {
  const inDiscard = courtBoard({ court: "discard", turn: 2, active: P2 });
  attackFaction(inDiscard);
  assert.ok(inDiscard.engine.state.battle, "in the discard pile");
  const faceDown = courtBoard({ court: "play", courtFaceDown: true, turn: 2, active: P2 });
  attackFaction(faceDown);
  assert.ok(faceDown.engine.state.battle, "a face-down Court is only a resource and has no rules text (CR 411.1)");
});

// =================================================================================
// Hungry-Hungry Idol
// FEED -- COST: Pay 1. Pick a character. -- EFFECT: This turn, the character gains
// 1 life. Your faction loses 1 influence.
// Item (banker), cost 1, [G][G].
// =================================================================================

const IDOL = "eb9b7351-5790-4ae9-928a-c2669a44f349";

function idolBoard(
  opts: { icons?: Icons; turn?: number; active?: PlayerId; influence?: number; idol?: "hand" | "play" | "discard"; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    playerA: { faction: developFaction(), influence: opts.influence },
    playerB: { faction: developFaction() },
    cards: [
      { key: "idol", def: printing(IDOL), owner: P1, zone: opts.idol ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "other", def: character({ name: "Other", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

const feed = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, target: string, player: PlayerId = P1) =>
  activate(engine, player, id("idol"), "feed", { selected: { c: [id(target)] } });
const feedRaw = (engine: SpoilsEngine, id: (key: string) => CardInstanceId, target: string, player: PlayerId = P1) =>
  actRaw(engine, player, id("idol"), "feed", { c: [id(target)] });

clause(IDOL, "0:ability:feed", "deploys for exactly its printed cost of 1 with [G][G]: one [G] with plenty of other resources is refused, two [G] are accepted", () => {
  const board = (icons: Icons) => idolBoard({ idol: "hand", icons });
  const oneGreed = board({ greed: 1, rage: 5 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("idol")), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("idol")), "hand");
  const none = board({ rage: 6 });
  refused(() => playRaw(none.engine, P1, none.id("idol")), "no [G]");
  const { engine, id } = board({ greed: 2, rage: 2 });
  const before = ready(engine);
  play(engine, P1, id("idol"));
  assert.equal(before - ready(engine), 1, "exactly the printed cost of 1 is paid");
  assert.equal(zoneOf(engine, id("idol")), "play");
  assert.equal(engine.getDefinition(id("idol")).type, "item");
});

clause(IDOL, "0:ability:feed", "pays exactly 1 resource; the picked character gains exactly 1 life (and nothing else about it changes); the Idol is not depleted", () => {
  const { engine, id } = idolBoard();
  const before = ready(engine);
  feed(engine, id, "mine");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 1, "Pay 1");
  assert.equal(engine.getStat(id("mine"), "life"), 3 + 1, "gains 1 life");
  assert.equal(engine.getStat(id("mine"), "strength"), 2, "strength unchanged");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "speed unchanged");
  assert.equal(isDepleted(engine, id("idol")), false, "the Idol is not depleted: FEED has no deplete cost");
  assert.equal(zoneOf(engine, id("idol")), "play");
});

clause(IDOL, "0:ability:feed", "only the picked character gains life: my other character and the opponent's are unaffected", () => {
  const { engine, id } = idolBoard();
  feed(engine, id, "mine");
  assert.equal(engine.getStat(id("other"), "life"), 3, "my other character");
  assert.equal(engine.getStat(id("foe"), "life"), 3, "the opponent's character");
});

clause(IDOL, "0:ability:feed", "your faction loses exactly 1 influence; the opponent's influence is untouched", () => {
  const { engine, id } = idolBoard();
  feed(engine, id, "mine");
  assert.equal(influenceOf(engine, P1), START - 1);
  assert.equal(influenceOf(engine, P2), START);
});

clause(IDOL, "0:ability:feed", "can pick an opponent's character: it gains the life, and it is still MY faction that loses the influence", () => {
  const { engine, id } = idolBoard();
  feed(engine, id, "foe");
  assert.equal(engine.getStat(id("foe"), "life"), 4);
  assert.equal(influenceOf(engine, P1), START - 1, "my faction pays");
  assert.equal(influenceOf(engine, P2), START, "theirs does not");
});

clause(IDOL, "0:ability:feed", "the life is real life: a 3-life character survives 3 damage after FEED and dies to the 4th point (without FEED 3 damage kills it)", () => {
  const zaps: CardPlacement[] = [
    { key: "z3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" },
    { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
  ];
  const fed = idolBoard({ extra: zaps });
  feed(fed.engine, fed.id, "mine");
  play(fed.engine, P1, fed.id("z3"), { selected: { t: [fed.id("mine")] } });
  assert.equal(zoneOf(fed.engine, fed.id("mine")), "play", "3 damage does not kill a 4-life character");
  assert.equal(damageOf(fed.engine, fed.id("mine")), 3);
  play(fed.engine, P1, fed.id("z1"), { selected: { t: [fed.id("mine")] } });
  assert.equal(zoneOf(fed.engine, fed.id("mine")), "discard", "the 4th point of damage kills it");
  const plain = idolBoard({ extra: zaps });
  play(plain.engine, P1, plain.id("z3"), { selected: { t: [plain.id("mine")] } });
  assert.equal(zoneOf(plain.engine, plain.id("mine")), "discard", "control: without FEED 3 damage kills it");
});

clause(IDOL, "0:ability:feed", "'this turn': the extra life is gone when the turn ends", () => {
  const { engine, id } = idolBoard();
  feed(engine, id, "mine");
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn has passed");
  assert.equal(engine.getStat(id("mine"), "life"), 3, "back to its printed life");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "life"), 3, "and it does not come back");
});

clause(IDOL, "0:ability:feed", "does not heal: damage already on the character stays, only its life total rises", () => {
  const { engine, id } = idolBoard({ extra: [{ key: "hurt", def: character({ name: "Hurt", life: 3 }), owner: P1, zone: "play", damage: 2 }] });
  feed(engine, id, "hurt");
  assert.equal(damageOf(engine, id("hurt")), 2, "the 2 damage is still there");
  assert.equal(engine.getStat(id("hurt"), "life"), 4);
  assert.equal(zoneOf(engine, id("hurt")), "play");
});

clause(IDOL, "0:ability:feed", "can be used repeatedly in one turn: each use pays 1, adds 1 life and costs 1 influence", () => {
  const { engine, id } = idolBoard({ icons: { greed: 4 } });
  feed(engine, id, "mine");
  feed(engine, id, "mine");
  feed(engine, id, "other");
  assert.equal(engine.getStat(id("mine"), "life"), 5, "two uses on one character stack");
  assert.equal(engine.getStat(id("other"), "life"), 4);
  assert.equal(influenceOf(engine, P1), START - 3);
  assert.equal(ready(engine), 1, "three payments of 1");
});

clause(IDOL, "0:ability:feed", "is refused with no resource to pay: nothing changes", () => {
  const { engine, id } = idolBoard({ icons: {} });
  assert.equal(ready(engine), 0);
  refused(() => feedRaw(engine, id, "mine"), "no resources to Pay 1");
  assert.equal(engine.getStat(id("mine"), "life"), 3);
  assert.equal(influenceOf(engine, P1), START);
  const spent = idolBoard({ icons: {}, extra: spentRes("greed", P1, 2) });
  refused(() => feedRaw(spent.engine, spent.id, "mine"), "only resources already attached to the faction");
  assert.equal(influenceOf(spent.engine, P1), START);
  const ok = idolBoard({ icons: { greed: 1 } });
  feed(ok.engine, ok.id, "mine");
  assert.equal(ok.engine.getStat(ok.id("mine"), "life"), 4, "control: exactly 1 resource is enough");
});

clause(IDOL, "0:ability:feed", "needs a character pick that is a character in play: items, locations, factions, face-down cards and cards outside play are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
    { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true },
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" }
  ];
  for (const [key, why] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["fd", "a face-down card"],
    ["inHand", "a character in my hand"],
    ["inDiscard", "a character in my discard pile"]
  ] as const) {
    const bad = idolBoard({ extra: extras() });
    const before = ready(bad.engine);
    refused(() => feedRaw(bad.engine, bad.id, key), `picking ${why}`);
    assert.equal(influenceOf(bad.engine, P1), START, `${why}: nothing was paid or lost`);
    assert.equal(ready(bad.engine), before, `${why}: nothing was paid`);
  }
  const faction = idolBoard();
  refused(() => actRaw(faction.engine, P1, faction.id("idol"), "feed", { c: [faction.engine.state.players[P1].factionId!] }), "my own faction");
  refused(() => actRaw(faction.engine, P1, faction.id("idol"), "feed", { c: [faction.engine.state.players[P2].factionId!] }), "their faction");
  const good = idolBoard({ extra: extras() });
  feed(good.engine, good.id, "mine");
  assert.equal(good.engine.getStat(good.id("mine"), "life"), 4, "control: a character is accepted");
});

clause(IDOL, "0:ability:feed", "needs exactly one pick: none or two are refused", () => {
  const { engine, id } = idolBoard();
  refused(() => actRaw(engine, P1, id("idol"), "feed", {}), "no pick");
  refused(() => actRaw(engine, P1, id("idol"), "feed", { c: [] }), "an empty pick");
  refused(() => actRaw(engine, P1, id("idol"), "feed", { c: [id("mine"), id("other")] }), "two picks");
  assert.equal(influenceOf(engine, P1), START);
  assert.equal(ready(engine), 3, "nothing was paid");
});

clause(IDOL, "0:ability:feed", "losing influence is not damage: a damage shield on my faction is not used up by it", () => {
  const shield = tactic({
    name: "Shield",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "shield",
          type: "activated",
          effects: [{ type: "preventDamage", target: { type: "factionOf", player: "controller" }, amount: 1, mode: "reduce", wholeInstance: true }]
        }
      ]
    }
  });
  const { engine, id } = idolBoard({
    extra: [
      { key: "shield", def: shield, owner: P1, zone: "hand" },
      { key: "hurt", def: factionZap("Hurt3", 3, "controller"), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("shield"));
  feed(engine, id, "mine");
  assert.equal(influenceOf(engine, P1), START - 1, "the influence loss is not damage, so the shield does not reduce it");
  play(engine, P1, id("hurt"));
  assert.equal(influenceOf(engine, P1), START - 1, "the shield is still there: the next damage instance is reduced to 0");
});

clause(IDOL, "0:ability:feed", "with 2 influence it leaves 1 influence and the game goes on; with 1 influence the faction reaches 0 and its owner loses", () => {
  const two = idolBoard({ influence: 2 });
  feed(two.engine, two.id, "mine");
  assert.equal(influenceOf(two.engine, P1), 1);
  assert.equal(two.engine.state.result, undefined);
  const one = idolBoard({ influence: 1 });
  feed(one.engine, one.id, "mine");
  assert.equal(influenceOf(one.engine, P1), 0);
  assert.deepEqual(one.engine.state.result, { outcome: "victory", winners: [P2] }, "a faction at 0 influence loses (CR 102)");
});

clause(IDOL, "0:ability:feed", "if the picked character is destroyed in response, the faction still loses its influence (the ability resolves as far as it can)", () => {
  const { engine, id } = idolBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  const before = ready(engine);
  feedRaw(engine, id, "mine");
  assert.equal(before - ready(engine), 1, "the cost is paid at once");
  respondWith(engine, P2, id("kill"), { t: [id("mine")] });
  assert.equal(zoneOf(engine, id("mine")), "discard", "destroyed in response");
  assert.equal(influenceOf(engine, P1), START - 1, "'your faction loses 1 influence' does not depend on the character (CR 402.5a)");
});

clause(IDOL, "0:ability:feed", "usable on the opponent's turn in response to their attack: the blocker gets the life for that turn", () => {
  const { engine, id } = idolBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.priorityPlayerId, P1);
  actRaw(engine, P1, id("idol"), "feed", { c: [id("mine")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
  assert.equal(influenceOf(engine, P1), START - 1);
});

clause(IDOL, "0:ability:feed", "only the Idol's controller can use it: the opponent cannot feed my Idol", () => {
  const { engine, id } = idolBoard({ icons: { greed: 3 }, extra: [...res({ greed: 3 }, P2)], turn: 2, active: P2 });
  refused(() => actRaw(engine, P2, id("idol"), "feed", { c: [id("foe")] }), "not its controller");
  assert.equal(engine.getStat(id("foe"), "life"), 3);
  assert.equal(influenceOf(engine, P2), START);
  assert.equal(influenceOf(engine, P1), START);
});

clause(IDOL, "0:ability:feed", "it is an in-play ability: from the hand or the discard pile it cannot be used", () => {
  const inHand = idolBoard({ idol: "hand" });
  refused(() => feedRaw(inHand.engine, inHand.id, "mine"), "Idol in hand");
  const inDiscard = idolBoard({ idol: "discard" });
  refused(() => feedRaw(inDiscard.engine, inDiscard.id, "mine"), "Idol in the discard pile");
  assert.equal(influenceOf(inHand.engine, P1), START);
});

// =================================================================================
// Inconvenient Roadblock
// COST: Play this only during a battle. -- EFFECT: Reduce all battle damage inflicted
// during this battle to 0. Draw a card.
// FLIP UP: 1 [G]
// Tactic (banker), cost 3, [G].
// =================================================================================

const ROADBLOCK = "82140912-9e21-4598-9c7b-6d45e3c50d83";

/** Passes priority (letting each responder in turn decline) until `player` holds priority in the open window. */
function untilPriority(engine: SpoilsEngine, player: PlayerId): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player) {
    assert.ok(guard++ < 10, "priority never reached the player");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

/** The responder declines and the response on top of the stack resolves, leaving the window open for more actions. */
function resolveOneResponse(engine: SpoilsEngine, responder: PlayerId): void {
  engine.perform({ type: "passPriority", playerId: responder });
  engine.perform({ type: "advanceFlow" });
}

/** Drives a declared battle forward (everyone declines, damage goes to the first legal target at full strength) until `stop()` is true or the battle ends. */
function stepBattleUntil(engine: SpoilsEngine, stop: () => boolean): void {
  let guard = 0;
  while (engine.state.battle && !stop()) {
    assert.ok(guard++ < 200, "the battle did not progress");
    const window = engine.state.responseWindow;
    if (window) {
      if (window.phase === "acceptingResponses") engine.perform({ type: "passPriority", playerId: window.priorityPlayerId });
      else engine.perform({ type: "advanceFlow" });
      continue;
    }
    const battle = engine.state.battle;
    if (battle.phase === "attackerDamageAssignment" || battle.phase === "defenderDamageAssignment") {
      const view = engine.getBattleView()!;
      const assignments = view.damageSources.flatMap((source) =>
        source.legalTargets.length > 0 && source.strength > 0 ? [{ sourceId: source.cardId, target: source.legalTargets[0], amount: source.strength }] : []
      );
      engine.perform({ type: "assignBattleDamage", playerId: view.actingPlayerId!, assignments });
      continue;
    }
    if (battle.phase === "finished") {
      engine.perform({ type: "advanceFlow" });
      continue;
    }
    throw new Error(`unexpected battle phase ${battle.phase}`);
  }
}

/**
 * P2 (active, turn 2) attacks; P1 holds the Roadblock. `atk` 3/5/3 and `atk2` 2/5/1 are P2's, `blk` 2/5/2 is P1's.
 * The Roadblock is in P1's hand, or in play face-down for the FLIP UP tests.
 */
function roadblockBoard(
  opts: { icons?: Icons; spentGreed?: number; rb?: "hand" | "faceDown" | "faceUp" | "discard"; rbSpent?: boolean; extra?: CardPlacement[]; deck?: number; turn?: number; active?: PlayerId } = {}
) {
  const rb = opts.rb ?? "hand";
  return devBoard(
    [
      {
        key: "rb",
        def: printing(ROADBLOCK),
        owner: P1,
        zone: rb === "hand" ? "hand" : rb === "discard" ? "discard" : "play",
        faceDown: rb === "faceDown" ? true : undefined,
        attachedToKey: opts.rbSpent ? "__factionA" : undefined
      },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" },
      ...chars("d", opts.deck ?? 4, P1, "deck"),
      ...chars("od", 3, P2, "deck"),
      ...res(opts.icons ?? { greed: 5 }),
      ...spentRes("greed", P1, opts.spentGreed ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type RbGame = ReturnType<typeof roadblockBoard>;

/** P2 attacks with `attackers` (P1's faction unless `target` is given) and passes priority: P1 holds priority in the declaration window. */
function rbAttack(game: RbGame, attackers = ["atk"], target?: string): void {
  declareAttackOpenWindow(
    game.engine,
    P2,
    attackers.map(game.id),
    target ? { type: "card", cardId: game.id(target) } : { type: "faction", playerId: P1 }
  );
}

/** P1 plays the Roadblock in the open window and lets it resolve, leaving the window open. */
function playRoadblockInWindow(game: RbGame): void {
  playRaw(game.engine, P1, game.id("rb"));
  resolveOneResponse(game.engine, P2);
}

clause(ROADBLOCK, "0:ability", "deploys (during a battle) for exactly its printed cost of 3 with [G]: refused one resource short and refused without [G]", () => {
  const short = roadblockBoard({ icons: { greed: 2 } });
  rbAttack(short);
  refused(() => playRaw(short.engine, P1, short.id("rb")), "2 resources: one short of 3");
  assert.equal(zoneOf(short.engine, short.id("rb")), "hand");
  const noGreed = roadblockBoard({ icons: { rage: 6 } });
  rbAttack(noGreed);
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("rb")), "plenty of resources but no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("rb")), "hand");
  const exact = roadblockBoard({ icons: { greed: 5 } });
  rbAttack(exact);
  const before = ready(exact.engine);
  playRaw(exact.engine, P1, exact.id("rb"));
  assert.equal(before - ready(exact.engine), 3, "exactly the printed cost is paid when it is played");
});

clause(ROADBLOCK, "0:ability", "an unblocked attack on my faction deals nothing: no influence is lost (and without the Roadblock it would be 3)", () => {
  const control = roadblockBoard();
  rbAttack(control);
  resolvePendingResponses(control.engine);
  declareBlockers(control.engine, P1, []);
  autoResolveBattle(control.engine);
  assert.equal(influenceOf(control.engine, P1), START - 3, "control: without the Roadblock the attacker's 3 battle damage costs 3 influence");

  const game = roadblockBoard();
  rbAttack(game);
  playRoadblockInWindow(game);
  resolvePendingResponses(game.engine);
  declareBlockers(game.engine, P1, []);
  autoResolveBattle(game.engine);
  assert.equal(game.engine.state.battle, undefined, "the battle ended");
  assert.equal(influenceOf(game.engine, P1), START, "the battle damage was reduced to 0");
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(ROADBLOCK, "0:ability", "a blocked battle deals no damage either way: the attacker and the blocker are both unhurt", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game);
  playRoadblockInWindow(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("atk")), 0, "the blocker dealt no damage to the attacker");
  assert.equal(damageOf(engine, id("blk")), 0, "the attacker dealt no damage to the blocker");
  assert.equal(influenceOf(engine, P1), START);
  const control = roadblockBoard();
  rbAttack(control);
  resolvePendingResponses(control.engine);
  declareBlockers(control.engine, P1, [control.id("blk")]);
  autoResolveBattle(control.engine);
  assert.equal(damageOf(control.engine, control.id("blk")), 3, "control: without the Roadblock the blocker takes 3");
  assert.equal(damageOf(control.engine, control.id("atk")), 2, "control: and the attacker takes 2");
});

clause(ROADBLOCK, "0:ability", "it can be played after blockers are declared, before any damage: all damage is still reduced to 0", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk")]);
  untilPriority(engine, P1);
  assert.equal(engine.state.battle?.phase, "beforeDamageResponse");
  playRaw(engine, P1, id("rb"));
  resolveOneResponse(engine, P2);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("atk")), 0);
  assert.equal(damageOf(engine, id("blk")), 0);
  assert.equal(zoneOf(engine, id("atk")), "play");
  assert.equal(zoneOf(engine, id("blk")), "play");
});

clause(ROADBLOCK, "0:ability", "a party battle: every attacker's and every blocker's damage is reduced to 0", () => {
  const game = roadblockBoard({ extra: [{ key: "blk2", def: character({ name: "Blk2", strength: 4, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  rbAttack(game, ["atk", "atk2"]);
  playRoadblockInWindow(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk"), id("blk2")]);
  autoResolveBattle(engine);
  for (const key of ["atk", "atk2", "blk", "blk2"]) assert.equal(damageOf(engine, id(key)), 0, `${key} took no damage`);
  assert.equal(influenceOf(engine, P1), START);
});

clause(ROADBLOCK, "0:ability", "an attack on a location: the location takes no damage", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game, ["atk"], "place");
  playRoadblockInWindow(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 0);
  assert.equal(zoneOf(engine, id("place")), "play");
  const control = roadblockBoard();
  rbAttack(control, ["atk"], "place");
  resolvePendingResponses(control.engine);
  declareBlockers(control.engine, P1, []);
  autoResolveBattle(control.engine);
  assert.equal(damageOf(control.engine, control.id("place")), 3, "control: without the Roadblock the location takes 3");
});

clause(ROADBLOCK, "0:ability", "the attacker can play it too, in their own battle: their blocked attack deals no damage", () => {
  const { engine, id } = devBoard(
    [
      { key: "rb", def: printing(ROADBLOCK), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res({ greed: 4 })
    ],
    { turn: 2, activePlayerId: P1 }
  );
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  assert.equal(engine.state.priorityPlayerId, P1, "the attacker holds priority first");
  const handBefore = handOf(engine, P1).length;
  playRaw(engine, P1, id("rb"));
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, [id("foe")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("foe")), 0);
  assert.equal(damageOf(engine, id("mine")), 0);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the attacker who played it drew the card");
  assert.equal(zoneOf(engine, id("rb")), "discard");
});

clause(ROADBLOCK, "0:ability", "the card's controller draws exactly one card (the top card of their deck); the opponent draws nothing; the tactic ends in the discard pile", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game);
  const top = deckOf(engine, P1)[0];
  const next = deckOf(engine, P1)[1];
  const handBefore = handOf(engine, P1).length;
  const oppHand = handOf(engine, P2).length;
  const oppDeck = deckOf(engine, P2).length;
  playRoadblockInWindow(game);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the tactic left my hand and one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the top card");
  assert.equal(zoneOf(engine, next), "deck", "only one card");
  assert.equal(zoneOf(engine, id("rb")), "discard");
  assert.equal(handOf(engine, P2).length, oppHand);
  assert.equal(deckOf(engine, P2).length, oppDeck);
});

clause(ROADBLOCK, "0:ability", "with an empty deck the damage is still reduced and nothing is drawn (not a loss)", () => {
  const game = roadblockBoard({ deck: 0 });
  const { engine } = game;
  rbAttack(game);
  playRoadblockInWindow(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START);
  assert.equal(engine.state.result, undefined);
});

clause(ROADBLOCK, "0:ability", "damage already inflicted earlier in the battle stays: only damage inflicted after it is played is reduced to 0", () => {
  const game = roadblockBoard({ extra: [{ key: "slow", def: character({ name: "Slow", strength: 2, life: 5, speed: 1 }), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  rbAttack(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("slow")]);
  // the speed 3 attacker deals its 3 to the speed 1 blocker first; the blocker's reply (speed 1) comes later
  stepBattleUntil(engine, () => damageOf(engine, id("slow")) === 3);
  assert.equal(damageOf(engine, id("slow")), 3, "the attacker's damage was inflicted before the Roadblock");
  untilPriority(engine, P1);
  playRaw(engine, P1, id("rb"));
  resolveOneResponse(engine, P2);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("slow")), 3, "the damage already inflicted is not undone");
  assert.equal(damageOf(engine, id("atk")), 0, "but the blocker's later damage was reduced to 0");
});

clause(ROADBLOCK, "0:ability", "only BATTLE damage is reduced: damage from a tactic during the same battle is not battle damage (FAQ) and is still inflicted", () => {
  const game = roadblockBoard({ extra: [{ key: "zap", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  rbAttack(game);
  playRoadblockInWindow(game);
  play(engine, P1, id("zap"), { selected: { t: [id("atk")] } });
  assert.equal(damageOf(engine, id("atk")), 3, "a tactic's damage during the battle is not battle damage, so it is not reduced");
});

clause(ROADBLOCK, "0:ability", "'during this battle': a later battle in the same turn is unaffected and its battle damage is inflicted normally", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game);
  playRoadblockInWindow(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined);
  assert.equal(influenceOf(engine, P1), START, "the first battle dealt no damage");
  declareAttackBy(engine, P2, [id("atk2")]);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START - 2, "the second battle's 2 damage is not covered by the first battle's Roadblock");
});

clause(ROADBLOCK, "0:ability", "'play this only during a battle': refused on my own turn with no battle, and the card stays in my hand", () => {
  const { engine, id } = roadblockBoard({ turn: 1, active: P1 });
  const before = ready(engine);
  refused(() => playRaw(engine, P1, id("rb")), "no battle");
  assert.equal(zoneOf(engine, id("rb")), "hand");
  assert.equal(ready(engine), before, "nothing was paid");
});

clause(ROADBLOCK, "0:ability", "'play this only during a battle': refused in response to a non-battle action on the opponent's turn", () => {
  const { engine, id } = roadblockBoard({ extra: [{ key: "zapP2", def: zapTactic("ZapP2", 1), owner: P2, zone: "hand" }] });
  playRaw(engine, P2, id("zapP2"), { selected: { t: [id("atk2")] } });
  assert.equal(engine.state.priorityPlayerId, P1, "I may respond to their tactic");
  assert.equal(engine.state.battle, undefined);
  refused(() => playRaw(engine, P1, id("rb")), "responding to a tactic outside a battle");
  assert.equal(zoneOf(engine, id("rb")), "hand");
});

clause(ROADBLOCK, "0:ability", "'play this only during a battle': refused in response to the opponent ending their turn", () => {
  const { engine, id } = roadblockBoard();
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.ok(engine.state.responseWindow, "the end-of-turn window is open");
  assert.equal(engine.state.priorityPlayerId, P1);
  refused(() => playRaw(engine, P1, id("rb")), "end of turn is not a battle");
  assert.equal(zoneOf(engine, id("rb")), "hand");
});

clause(ROADBLOCK, "0:ability", "'play this only during a battle': once the battle is over it is refused again", () => {
  const game = roadblockBoard();
  const { engine, id } = game;
  rbAttack(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined, "the battle is over");
  refused(() => playRaw(engine, P1, id("rb")), "no battle any more");
  assert.equal(zoneOf(engine, id("rb")), "hand");
});

// --- FLIP UP: 1 [G] ---

/** Raw `flipUp` of the face-down Roadblock. */
const flipRoadblock = (game: RbGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("rb"));

clause(ROADBLOCK, "1:flipUp", "flipping up in a battle pays exactly 1 (not the card's 3) and then does what it says: no battle damage, a card drawn, the tactic in the discard pile", () => {
  const game = roadblockBoard({ rb: "faceDown", icons: { greed: 4 } });
  const { engine, id } = game;
  rbAttack(game);
  const readyBefore = ready(engine);
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  flipRoadblock(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("rb")), "discard", "a resolved tactic goes to its owner's discard pile");
  assert.equal(readyBefore - ready(engine), 2, "1 paid, plus the face-down card itself stops being a resource");
  assert.equal(zoneOf(engine, top), "hand", "a card was drawn");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START, "the battle damage was reduced to 0");
});

clause(ROADBLOCK, "1:flipUp", "the face-down card may pay for its own FLIP UP (CR 507.4b): with [G] already spent and the face-down card itself ready, it flips up", () => {
  const game = roadblockBoard({ rb: "faceDown", icons: {}, spentGreed: 1 });
  const { engine, id } = game;
  assert.equal(ready(engine), 1, "only the face-down card is ready");
  rbAttack(game);
  flipRoadblock(game);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rb")), "discard");
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START);
});

clause(ROADBLOCK, "1:flipUp", "needs [G]: plenty of other resources are not enough, one [G] is", () => {
  const none = roadblockBoard({ rb: "faceDown", icons: { rage: 5 } });
  rbAttack(none);
  refused(() => flipRoadblock(none), "no [G]");
  assert.equal(none.engine.state.cards[none.id("rb")].faceDown, true);
  assert.equal(ready(none.engine), 6, "nothing was paid");
  const one = roadblockBoard({ rb: "faceDown", icons: { greed: 1, rage: 4 } });
  rbAttack(one);
  flipRoadblock(one);
  resolvePendingResponses(one.engine);
  assert.equal(zoneOf(one.engine, one.id("rb")), "discard", "control: one [G] meets the threshold");
});

clause(ROADBLOCK, "1:flipUp", "'play this only during a battle' still applies when flipped up: refused with no battle, allowed in one", () => {
  const outside = roadblockBoard({ rb: "faceDown", turn: 1, active: P1 });
  refused(() => flipRoadblock(outside), "no battle");
  assert.equal(outside.engine.state.cards[outside.id("rb")].faceDown, true, "still face-down");
  assert.equal(zoneOf(outside.engine, outside.id("rb")), "play");
  const inside = roadblockBoard({ rb: "faceDown" });
  rbAttack(inside);
  flipRoadblock(inside);
  resolvePendingResponses(inside.engine);
  assert.equal(zoneOf(inside.engine, inside.id("rb")), "discard", "control: the same flip works during a battle");
});

clause(ROADBLOCK, "1:flipUp", "only a face-down Roadblock I control can be flipped: face-up in play, in hand, or the opponent's face-down one cannot", () => {
  const faceUp = roadblockBoard({ rb: "faceUp" });
  rbAttack(faceUp);
  refused(() => flipRoadblock(faceUp), "already face-up");
  const inHand = roadblockBoard({ rb: "hand" });
  rbAttack(inHand);
  refused(() => flipRoadblock(inHand), "in hand");
  const theirs = roadblockBoard({ rb: "faceDown", active: P2 });
  rbAttack(theirs);
  refused(() => flipRoadblock(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("rb")].faceDown, true);
});

clause(ROADBLOCK, "1:flipUp", "the attacker can flip it up in their own battle too", () => {
  const { engine, id } = devBoard(
    [
      { key: "rb", def: printing(ROADBLOCK), owner: P1, zone: "play", faceDown: true },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 5, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res({ greed: 2 })
    ],
    { turn: 2, activePlayerId: P1 }
  );
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  flipUpRaw(engine, P1, id("rb"));
  resolvePendingResponses(engine);
  declareBlockers(engine, P2, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P2), START, "no damage reached their faction");
  assert.equal(zoneOf(engine, id("rb")), "discard");
});

// =================================================================================
// shared by the search cards (Karmic Cake, The Currency Bazaar, Treasure Brokerage, Aristocratic Artificer)
// =================================================================================

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const stapleCard = (name: string, icon: StapleIcon): CardDefinition => resourceCard({ name, resource: { provides: [icon], staple: true } });
/** A resource card that is NOT a staple. */
const oddResource = (name = "Odd Coin"): CardDefinition => resourceCard({ name, resource: { provides: ["greed"], staple: false } });

/** Reveal events in the log (cardsRevealed). */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");
const revealedIds = (engine: SpoilsEngine): string[] =>
  revealEvents(engine).flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);

/**
 * A deck for `owner`, top to bottom: c0, g0 (staple Greed), odd (NON-staple resource), c1, r0 (staple Rage),
 * it (item), g1 (staple Greed), tac (tactic), loc (location). Keys get `prefix`.
 */
function resourceDeck(owner: PlayerId, prefix = ""): CardPlacement[] {
  return [
    { key: `${prefix}c0`, def: character({ name: `${prefix}C0` }), owner, zone: "deck" },
    { key: `${prefix}g0`, def: stapleCard("Greed", "greed"), owner, zone: "deck" },
    { key: `${prefix}odd`, def: oddResource(), owner, zone: "deck" },
    { key: `${prefix}c1`, def: character({ name: `${prefix}C1` }), owner, zone: "deck" },
    { key: `${prefix}r0`, def: stapleCard("Rage", "rage"), owner, zone: "deck" },
    { key: `${prefix}it`, def: item({ name: `${prefix}Item` }), owner, zone: "deck" },
    { key: `${prefix}g1`, def: stapleCard("Greed", "greed"), owner, zone: "deck" },
    { key: `${prefix}tac`, def: tactic({ name: `${prefix}Tactic` }), owner, zone: "deck" },
    { key: `${prefix}loc`, def: location({ name: `${prefix}Loc` }), owner, zone: "deck" }
  ];
}

/** Cards of the right kind that sit in the WRONG place for a "search your deck" (hand, discard pile, play, the opponent's deck). */
const decoyResources = (): CardPlacement[] => [
  { key: "hres", def: stapleCard("Greed", "greed"), owner: P1, zone: "hand" },
  { key: "dres", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" },
  { key: "pres", def: stapleCard("Rage", "rage"), owner: P1, zone: "play", attachedToKey: "__factionA" },
  ...resourceDeck(P2, "o")
];

/** Answers the open search prompt (asserting it is `player`'s) with `keys`, then lets everything finish. */
function pickFromSearch(engine: SpoilsEngine, id: (k: string) => CardInstanceId, keys: string[], player: PlayerId = P1): void {
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, player, "the searching player chooses");
  answerPending(engine, "chooserSelectsTarget", { selected: keys.map(id) });
}

// =================================================================================
// Karmic Cake
// Search your deck for a resource and reveal it. Put it into your hand.
// RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 2.
// Remove this card from the game. -- EFFECT: Search your deck for a staple resource
// and reveal it. Put it into your hand.
// Tactic (banker), cost 2, [G].
// =================================================================================

const CAKE = "ae3fd7e6-7886-4529-9d27-54617d25826c";

function cakeBoard(
  opts: {
    cake?: "hand" | "discard" | "deck" | "play" | "removed";
    icons?: Icons;
    deck?: "full" | "noResources" | "empty";
    turn?: number;
    active?: PlayerId;
    random?: () => number;
    extra?: CardPlacement[];
  } = {}
) {
  const deck = opts.deck === "empty" ? [] : opts.deck === "noResources" ? chars("n", 3, P1, "deck") : resourceDeck(P1);
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cake", def: printing(CAKE), owner: P1, zone: opts.cake ?? "hand" },
      ...deck,
      ...decoyResources(),
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ]
  });
}

const cakeRecurRaw = (engine: SpoilsEngine, id: (k: string) => CardInstanceId, player: PlayerId = P1) => actRaw(engine, player, id("cake"), "recur");

clause(CAKE, "0:rule", "deploys for exactly its printed cost of 2 with [G]: refused one resource short and refused without [G]", () => {
  const short = cakeBoard({ icons: { greed: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("cake")), "1 resource: one short of 2");
  assert.equal(zoneOf(short.engine, short.id("cake")), "hand");
  const noGreed = cakeBoard({ icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("cake")), "plenty of resources but no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("cake")), "hand");
  const { engine, id } = cakeBoard({ icons: { greed: 5 } });
  const before = ready(engine);
  play(engine, P1, id("cake"));
  assert.equal(before - ready(engine), 2, "exactly the printed cost is paid");
  assert.equal(engine.getDefinition(id("cake")).type, "tactic");
});

clause(CAKE, "0:rule", "searches MY deck for a resource: the chosen card goes to my hand, is revealed, and the Cake ends in my discard pile", () => {
  const { engine, id } = cakeBoard();
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  play(engine, P1, id("cake"));
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("g0")), "hand", "the found resource is in my hand");
  assert.ok(handOf(engine, P1).includes(id("g0")), "handOf(engine, P1).includes(id(\"g0\"))");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the Cake left the hand and exactly one card entered it");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(zoneOf(engine, id("cake")), "discard");
  assert.deepEqual(revealedIds(engine), [id("g0")], "exactly the found card is revealed");
  assert.equal(revealEvents(engine).length, 1);
});

for (const [key, why] of [
  ["g0", "a staple Greed"],
  ["r0", "a staple Rage (any resource, not only Greed)"],
  ["odd", "a resource that is NOT a staple (it says 'a resource', not 'a staple resource')"]
] as const) {
  clause(CAKE, "0:rule", `can find ${why}`, () => {
    const { engine, id } = cakeBoard();
    play(engine, P1, id("cake"));
    pickFromSearch(engine, id, [key]);
    assert.equal(zoneOf(engine, id(key)), "hand");
  });
}

clause(CAKE, "0:rule", "only a RESOURCE can be found: a character, item, tactic or location in my deck is refused", () => {
  const { engine, id } = cakeBoard();
  play(engine, P1, id("cake"));
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("it")]), "an item");
  refused(tryPick(engine, P1, [id("tac")]), "a tactic");
  refused(tryPick(engine, P1, [id("loc")]), "a location");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickFromSearch(engine, id, ["g1"]);
  assert.equal(zoneOf(engine, id("g1")), "hand", "control: a resource is accepted");
});

clause(CAKE, "0:rule", "only MY DECK is searched: a resource in the opponent's deck, in my hand, in my discard pile or in play is refused", () => {
  const { engine, id } = cakeBoard();
  play(engine, P1, id("cake"));
  refused(tryPick(engine, P1, [id("og0")]), "a staple in the opponent's deck");
  refused(tryPick(engine, P1, [id("oodd")]), "a non-staple in the opponent's deck");
  refused(tryPick(engine, P1, [id("hres")]), "a resource in my hand");
  refused(tryPick(engine, P1, [id("dres")]), "a resource in my discard pile");
  refused(tryPick(engine, P1, [id("pres")]), "a resource in play");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand", "control");
});

clause(CAKE, "0:rule", "finds exactly ONE card: two are refused, and so is the same card twice", () => {
  const { engine, id } = cakeBoard();
  play(engine, P1, id("cake"));
  refused(tryPick(engine, P1, [id("g0"), id("r0")]), "two resources");
  refused(tryPick(engine, P1, [id("g0"), id("g0")]), "the same resource twice");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(handOf(engine, P1).filter((c) => [id("g0"), id("r0"), id("g1"), id("odd")].includes(c)).length, 1);
});

clause(CAKE, "0:rule", "the search can be failed on purpose (CR 312.2): taking nothing puts nothing in my hand, the cost is paid and the Cake is discarded", () => {
  const { engine, id } = cakeBoard();
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  play(engine, P1, id("cake"));
  pickFromSearch(engine, id, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing was found");
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, id("cake")), "discard");
  assert.equal(revealEvents(engine).length, 0, "nothing was revealed");
});

clause(CAKE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const { engine, id } = cakeBoard({ random: () => 0 });
  play(engine, P1, id("cake"));
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("g0"));
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(CAKE, "0:rule", "the deck is shuffled even when I take nothing (I searched, CR 312.1 / 312.2)", () => {
  const { engine, id } = cakeBoard({ random: () => 0 });
  const unshuffled = deckOf(engine, P1);
  play(engine, P1, id("cake"));
  pickFromSearch(engine, id, []);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0), "searched decks are shuffled whether or not a card was found");
});

clause(CAKE, "0:rule", "the opponent's deck, hand and discard pile are untouched, and not shuffled", () => {
  const { engine, id } = cakeBoard({ random: () => 0 });
  const oppDeck = deckOf(engine, P2);
  const oppHand = handOf(engine, P2);
  const oppDiscard = discardOf(engine, P2);
  play(engine, P1, id("cake"));
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual(deckOf(engine, P2), oppDeck, "their deck is not searched or shuffled");
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(CAKE, "0:rule", "with no resource in my deck it resolves cleanly (nothing found, no stuck prompt) and the Cake is discarded", () => {
  const { engine, id } = cakeBoard({ deck: "noResources" });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("cake"));
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("cake")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1);
});

clause(CAKE, "0:rule", "a deck with no resource in it is still searched, so it is shuffled afterwards (CR 312.1)", () => {
  const { engine, id } = cakeBoard({ deck: "noResources", random: () => 0 });
  const unshuffled = deckOf(engine, P1);
  play(engine, P1, id("cake"));
  drain(engine, pickTargets([]));
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "the searched deck was shuffled although nothing could be found");
});

clause(CAKE, "0:rule", "an empty deck: it resolves, nothing is found, and it is not a loss", () => {
  const { engine, id } = cakeBoard({ deck: "empty" });
  play(engine, P1, id("cake"));
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("cake")), "discard");
  assert.equal(engine.state.result, undefined);
});

clause(CAKE, "0:rule", "it is a tactic: it can be played in response to the opponent's attack", () => {
  const { engine, id } = cakeBoard({ turn: 2, active: P2 });
  refused(() => playRaw(engine, P1, id("cake")), "no window is open yet");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  playRaw(engine, P1, id("cake"));
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand", "found in response to the attack");
});

// --- RECUR ---

clause(CAKE, "1:ability:recur", "from the discard pile: pays exactly 2, removes the Cake from the game, then searches for a staple resource and puts it into my hand", () => {
  const { engine, id } = cakeBoard({ cake: "discard" });
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  cakeRecurRaw(engine, id);
  assert.equal(before - ready(engine), 2, "Pay 2 is paid when the ability is used");
  assert.equal(zoneOf(engine, id("cake")), "removed", "the card is removed from the game as part of the cost");
  assert.ok(removedOf(engine, P1).includes(id("cake")), "removedOf(engine, P1).includes(id(\"cake\"))");
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.deepEqual(revealedIds(engine), [id("g0")], "the found staple is revealed");
  assert.equal(zoneOf(engine, id("cake")), "removed", "and the Cake stays out of the game");
});

clause(CAKE, "1:ability:recur", "only a STAPLE resource can be found: the non-staple resource, characters, items and the opponent's staples are refused", () => {
  const { engine, id } = cakeBoard({ cake: "discard" });
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("odd")]), "a resource that is not a staple");
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("it")]), "an item");
  refused(tryPick(engine, P1, [id("tac")]), "a tactic");
  refused(tryPick(engine, P1, [id("og0")]), "a staple in the opponent's deck");
  refused(tryPick(engine, P1, [id("hres")]), "a staple in my hand");
  refused(tryPick(engine, P1, [id("dres")]), "a staple in my discard pile");
  refused(tryPick(engine, P1, [id("g0"), id("r0")]), "two staples");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("r0")), "hand", "control: a staple resource is accepted");
});

clause(CAKE, "1:ability:recur", "the search can be failed on purpose (CR 312.2): the cost is still paid and the Cake is still removed", () => {
  const { engine, id } = cakeBoard({ cake: "discard" });
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, []);
  assert.equal(handOf(engine, P1).length, handBefore, "nothing found");
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, id("cake")), "removed");
});

clause(CAKE, "1:ability:recur", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const { engine, id } = cakeBoard({ cake: "discard", random: () => 0 });
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("g0"));
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0));
});

clause(CAKE, "1:ability:recur", "with no staple resource in my deck it resolves cleanly (the cost is still paid) and the deck is still shuffled", () => {
  const { engine, id } = cakeBoard({ cake: "discard", deck: "noResources", random: () => 0 });
  const unshuffled = deckOf(engine, P1);
  const before = ready(engine);
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 2);
  assert.equal(zoneOf(engine, id("cake")), "removed");
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "a searched deck is shuffled although nothing could be found");
});

clause(CAKE, "1:ability:recur", "'use this only if this card is in your discard pile': refused from the hand, the deck, in play and once removed", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const { engine, id } = cakeBoard({ cake: zone });
    refused(() => cakeRecurRaw(engine, id), `the Cake is in ${zone}`);
    assert.equal(ready(engine), 6, `${zone}: nothing was paid`);
    assert.equal(zoneOf(engine, id("cake")), zone);
  }
  const ok = cakeBoard({ cake: "discard" });
  cakeRecurRaw(ok.engine, ok.id);
  assert.equal(zoneOf(ok.engine, ok.id("cake")), "removed", "control: from the discard pile it works");
});

clause(CAKE, "1:ability:recur", "'your discard pile': the opponent's Cake in THEIR discard pile cannot be recurred by me, and mine cannot be recurred by them", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "cake", def: printing(CAKE), owner: P2, zone: "discard" },
      { key: "mycake", def: printing(CAKE), owner: P1, zone: "discard" },
      ...resourceDeck(P1),
      ...resourceDeck(P2, "o"),
      ...res({ greed: 6 }),
      ...res({ greed: 6 }, P2)
    ]
  });
  refused(() => actRaw(engine, P1, id("cake"), "recur"), "not my discard pile");
  assert.equal(zoneOf(engine, id("cake")), "discard");
  refused(() => actRaw(engine, P2, id("mycake"), "recur"), "not their discard pile");
  assert.equal(zoneOf(engine, id("mycake")), "discard");
  actRaw(engine, P1, id("mycake"), "recur");
  assert.equal(zoneOf(engine, id("mycake")), "removed", "control: my own Cake in my own discard pile works");
});

clause(CAKE, "1:ability:recur", "is refused one resource short of Pay 2, allowed with exactly 2", () => {
  const short = cakeBoard({ cake: "discard", icons: { greed: 1 } });
  refused(() => cakeRecurRaw(short.engine, short.id), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("cake")), "discard", "not removed");
  const exact = cakeBoard({ cake: "discard", icons: { greed: 2 } });
  cakeRecurRaw(exact.engine, exact.id);
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("cake")), "removed");
});

clause(CAKE, "1:ability:recur", "RECUR: [G] needs a [G]: plenty of other resources are not enough, one [G] among them is (and only the 2 are spent)", () => {
  const none = cakeBoard({ cake: "discard", icons: { rage: 5 } });
  refused(() => cakeRecurRaw(none.engine, none.id), "no [G]");
  assert.equal(zoneOf(none.engine, none.id("cake")), "discard");
  const one = cakeBoard({ cake: "discard", icons: { greed: 1, rage: 4 } });
  cakeRecurRaw(one.engine, one.id);
  assert.equal(zoneOf(one.engine, one.id("cake")), "removed");
  assert.equal(ready(one.engine), 3, "exactly 2 of the 5 resources were paid");
});

clause(CAKE, "1:ability:recur", "it is an ability, not a tactic play: it can be used on the opponent's turn in response to their attack", () => {
  const { engine, id } = cakeBoard({ cake: "discard", turn: 2, active: P2 });
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(zoneOf(engine, id("cake")), "removed");
});

clause(CAKE, "1:ability:recur", "can be used only once: the removed Cake is gone for the rest of the game", () => {
  const { engine, id } = cakeBoard({ cake: "discard" });
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  refused(() => cakeRecurRaw(engine, id), "the card was removed from the game");
  assert.equal(ready(engine), 4, "only the first use was paid for");
});

clause(CAKE, "1:ability:recur", "after playing the Cake normally it lands in the discard pile and its RECUR becomes available", () => {
  const { engine, id } = cakeBoard({ icons: { greed: 8 } });
  refused(() => cakeRecurRaw(engine, id), "still in my hand");
  play(engine, P1, id("cake"));
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("cake")), "discard");
  cakeRecurRaw(engine, id);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("cake")), "removed");
  assert.equal(zoneOf(engine, id("r0")), "hand");
  assert.equal(ready(engine), 4, "2 for playing it and 2 for recurring it");
});

// =================================================================================
// Marduun Baitings and Loan
// UNIQUE MARDUUN BAITINGS AND LOAN
// [G][G][G]: At the start of your turn, your faction gains 2 influence.
// [G][G][G][G][G]: At the start of your turn, draw a card. Discard a card.
// [G][G][G][G][G][G][G]: At the start of your turn, draw a card.
// Location (banker), cost 3, [G], structure 5.
// =================================================================================

const BAITINGS = "30363637-822a-424d-84b4-4ec05b79c6b0";

function baitBoard(
  opts: {
    bait?: "play" | "hand" | "discard";
    baitFaceDown?: boolean;
    greed?: number;
    rage?: number;
    spentGreed?: number;
    faceDown?: number;
    oppGreed?: number;
    deck?: number;
    hand?: number;
    turn?: number;
    active?: PlayerId;
    baitController?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return buildGame({
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bait", def: printing(BAITINGS), owner: P1, zone: opts.bait ?? "play", faceDown: opts.baitFaceDown, controller: opts.baitController },
      ...chars("d", opts.deck ?? 10, P1, "deck"),
      ...chars("h", opts.hand ?? 3, P1, "hand"),
      ...chars("od", 5, P2, "deck"),
      ...chars("oh", 2, P2, "hand"),
      ...res({ greed: opts.greed ?? 0, rage: opts.rage ?? 0 }),
      ...spentRes("greed", P1, opts.spentGreed ?? 0),
      ...volition(opts.faceDown ?? 0, P1),
      ...res({ greed: opts.oppGreed ?? 0 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

/** Answers any `orderTriggers` prompt (the controller picks the first listed trigger) until some other prompt, or none, is open. */
function orderFirst(engine: SpoilsEngine): void {
  let guard = 0;
  while (pending(engine)?.kind === "orderTriggers" && guard++ < 10) {
    const pc = pending(engine)!;
    engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } } as never);
    resolvePendingResponses(engine);
  }
}

/** P2 ends their turn so P1's turn begins; any discard prompt is answered with `discardKey`, ordering prompts with the first trigger. */
function startMyTurn(game: ReturnType<typeof baitBoard>, discardKey = "h0", ender: PlayerId = P2): void {
  endTurn(game.engine, ender);
  drain(game.engine, (pc) => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id(discardKey)] } : declineAll(pc)));
  assert.equal(game.engine.state.pendingChoice, undefined, "the start-of-turn steps finished");
}

clause(BAITINGS, "0:unique", "deploys for exactly its printed cost of 3 with [G], and has structure 5", () => {
  // P1 is the active player and [G] is present, so only the cost (2 of 3) can refuse
  const short = baitBoard({ bait: "hand", greed: 2, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("bait")), "2 resources: one short of 3", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("bait")), "hand");
  const noGreed = baitBoard({ bait: "hand", rage: 6, turn: 1, active: P1 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("bait")), "no [G]", /Threshold requirements are not met/);
  const { engine, id } = baitBoard({ bait: "hand", greed: 4, turn: 1, active: P1 });
  const before = ready(engine);
  play(engine, P1, id("bait"));
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bait")), "play");
  assert.equal(engine.getDefinition(id("bait")).type, "location");
  assert.equal(engine.getDefinition(id("bait")).structure, 5);
});

clause(BAITINGS, "0:unique", "controlling a second copy makes me keep one: keeping the new one destroys the old one", () => {
  const { engine, id } = baitBoard({ greed: 6, turn: 1, active: P1, extra: [{ key: "bait2", def: printing(BAITINGS), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bait2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...pc.candidates].sort(), [id("bait"), id("bait2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("bait2") });
  assert.equal(zoneOf(engine, id("bait2")), "play");
  assert.equal(zoneOf(engine, id("bait")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BAITINGS, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = baitBoard({ greed: 6, turn: 1, active: P1, extra: [{ key: "bait2", def: printing(BAITINGS), owner: P1, zone: "hand" }] });
  play(engine, P1, id("bait2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("bait") });
  assert.equal(zoneOf(engine, id("bait")), "play");
  assert.equal(zoneOf(engine, id("bait2")), "discard");
});

clause(BAITINGS, "0:unique", "the choice must name one of the two copies", () => {
  const { engine, id } = baitBoard({ greed: 6, turn: 1, active: P1, extra: [{ key: "bait2", def: printing(BAITINGS), owner: P1, zone: "hand" }, { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }] });
  play(engine, P1, id("bait2"));
  refused(answerRaw(engine, P1, { kind: "uniqueSurvivor", keep: id("mine") }), "a card that is not one of the copies");
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
  answerPending(engine, "uniqueSurvivor", { keep: id("bait") });
  assert.equal(zoneOf(engine, id("bait")), "play", "control: a real copy is accepted");
});

clause(BAITINGS, "0:unique", "UNIQUE is per player: the opponent may control their own copy with no choice and no destruction", () => {
  const { engine, id } = baitBoard({
    greed: 6,
    turn: 2,
    active: P2,
    extra: [{ key: "obait", def: printing(BAITINGS), owner: P2, zone: "hand" }, ...res({ greed: 6 }, P2)]
  });
  play(engine, P2, id("obait"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("bait")), "play");
  assert.equal(zoneOf(engine, id("obait")), "play");
});

clause(BAITINGS, "0:unique", "taking control of the opponent's copy while I have my own is a duplicate: I must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = baitBoard({
    turn: 1,
    active: P1,
    extra: [
      { key: "theirs", def: printing(BAITINGS), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("theirs")] } });
  assert.equal(pending(engine)?.kind, "uniqueSurvivor", "two copies under one player's control");
  assert.equal(pending(engine)?.playerId, P1);
});

clause(BAITINGS, "0:unique", "a second copy in hand (not in play) is no conflict, and after the first copy is destroyed a new one can be played with no conflict", () => {
  const { engine, id } = baitBoard({
    greed: 8,
    turn: 1,
    active: P1,
    extra: [{ key: "bait2", def: printing(BAITINGS), owner: P1, zone: "hand" }, { key: "kill", def: destroyTactic("location"), owner: P1, zone: "hand" }]
  });
  assert.equal(engine.state.pendingChoice, undefined, "a copy in hand is no conflict");
  assert.equal(zoneOf(engine, id("bait")), "play");
  play(engine, P1, id("kill"), { selected: { t: [id("bait")] } });
  assert.equal(zoneOf(engine, id("bait")), "discard");
  play(engine, P1, id("bait2"));
  assert.equal(engine.state.pendingChoice, undefined, "no conflict: the first copy is gone");
  assert.equal(zoneOf(engine, id("bait2")), "play");
});

clause(BAITINGS, "0:unique", "a location with a different UNIQUE designation (or none) is not a duplicate", () => {
  const { engine, id } = baitBoard({
    extra: [
      { key: "other", def: location({ name: "OtherLoc", unique: "other loc" } as Partial<CardDefinition>), owner: P1, zone: "play" },
      { key: "plain", def: location({ name: "PlainLoc" }), owner: P1, zone: "play" }
    ]
  });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("bait")), "play");
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(zoneOf(engine, id("plain")), "play");
});

// --- [G][G][G]: At the start of your turn, your faction gains 2 influence. ---

clause(BAITINGS, "1:rule@ggg", "with [G][G][G] my faction gains exactly 2 influence at the start of my turn, and nothing else happens (no card drawn or discarded)", () => {
  const game = baitBoard({ greed: 3 });
  const { engine } = game;
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  startMyTurn(game);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(influenceOf(engine, P1), START + 2);
  assert.deepEqual(handOf(engine, P1), hand, "no card drawn or discarded");
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.equal(influenceOf(engine, P2), START, "the opponent's influence is untouched");
});

clause(BAITINGS, "1:rule@ggg", "with only [G][G] there is no gain; with [G][G][G] among other resources there is", () => {
  const two = baitBoard({ greed: 2, rage: 5 });
  startMyTurn(two);
  assert.equal(influenceOf(two.engine, P1), START, "[G][G] is below the threshold");
  const three = baitBoard({ greed: 3, rage: 5 });
  startMyTurn(three);
  assert.equal(influenceOf(three.engine, P1), START + 2);
});

clause(BAITINGS, "1:rule@ggg", "other icons do not count: [R][R][R][R][R][R][R] and face-down (Volition) resources give nothing", () => {
  const rage = baitBoard({ greed: 0, rage: 7 });
  startMyTurn(rage);
  assert.equal(influenceOf(rage.engine, P1), START);
  const faceDown = baitBoard({ greed: 2, faceDown: 5 });
  startMyTurn(faceDown);
  assert.equal(influenceOf(faceDown.engine, P1), START, "face-down cards provide Volition, not [G]");
});

clause(BAITINGS, "1:rule@ggg", "[G] I control counts even when those resources are spent (attached to my faction), but the opponent's [G] does not", () => {
  const spent = baitBoard({ spentGreed: 3 });
  startMyTurn(spent);
  assert.equal(influenceOf(spent.engine, P1), START + 2, "control, not availability, is what counts");
  const theirs = baitBoard({ greed: 2, oppGreed: 6 });
  startMyTurn(theirs);
  assert.equal(influenceOf(theirs.engine, P1), START, "their [G] is not mine");
});

clause(BAITINGS, "1:rule@ggg", "more [G] does not repeat it: the gain is 2 once per turn, not 2 per extra icon (4 [G] -> still +2)", () => {
  const game = baitBoard({ greed: 4 });
  startMyTurn(game);
  assert.equal(influenceOf(game.engine, P1), START + 2);
  assert.equal(game.engine.state.players[P1].hand.length, 3, "and no draw at 4 [G]");
});

clause(BAITINGS, "1:rule@ggg", "it fires at the start of every one of my turns", () => {
  const game = baitBoard({ greed: 3 });
  startMyTurn(game);
  assert.equal(influenceOf(game.engine, P1), START + 2);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(influenceOf(game.engine, P1), START + 4, "+2 again at my next turn");
});

clause(BAITINGS, "1:rule@ggg", "only at the start of MY turn: when the opponent's turn starts nothing happens", () => {
  const game = baitBoard({ greed: 7, turn: 1, active: P1 });
  const { engine } = game;
  const hand = handOf(engine, P1);
  endTurn(engine, P1);
  drain(engine, declineAll);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(influenceOf(engine, P1), START, "no gain at their turn start");
  assert.deepEqual(handOf(engine, P1), hand, "no draw at their turn start");
  assert.equal(influenceOf(engine, P2), START);
});

clause(BAITINGS, "1:rule@ggg", "it does nothing unless it is in play: in hand, in the discard pile, or face-down as a resource", () => {
  for (const [label, opts] of [
    ["in hand", { bait: "hand" as const }],
    ["in the discard pile", { bait: "discard" as const }],
    ["face-down", { bait: "play" as const, baitFaceDown: true }]
  ] as const) {
    const game = baitBoard({ greed: 7, ...opts });
    const hand = handOf(game.engine, P1);
    startMyTurn(game);
    assert.equal(influenceOf(game.engine, P1), START, `${label}: no gain`);
    assert.deepEqual(handOf(game.engine, P1), hand, `${label}: no draw`);
  }
});

clause(BAITINGS, "1:rule@ggg", "it belongs to its controller: a copy I own but the opponent controls gives THEM the influence at THEIR turn start (with their [G])", () => {
  const game = baitBoard({ baitController: P2, greed: 0, oppGreed: 3, turn: 1, active: P1 });
  const { engine } = game;
  endTurn(engine, P1);
  drain(engine, declineAll);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(influenceOf(engine, P2), START + 2, "its controller's faction gains");
  assert.equal(influenceOf(engine, P1), START);
});

clause(BAITINGS, "1:rule@ggg", "the paragraph switches off when the [G] are gone: after one of three [G] is destroyed there is no gain at my next turn start", () => {
  const game = baitBoard({ greed: 3, turn: 1, active: P1, extra: [{ key: "kill", def: destroyTactic("resource"), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  const greed = engine.state.players[P1].play.filter((c) => engine.isResource(c) && c !== id("bait"));
  assert.equal(greed.length, 3);
  play(engine, P1, id("kill"), { selected: { t: [greed[0]] } });
  assert.equal(zoneOf(engine, greed[0]), "discard", "one [G] is gone");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(influenceOf(engine, P1), START, "[G][G] no longer meets the threshold");
});

clause(BAITINGS, "1:rule@ggg", "once the Baitings has left play it does nothing at my next turn start", () => {
  const game = baitBoard({ greed: 3, turn: 1, active: P1, extra: [{ key: "kill", def: destroyTactic("location"), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("kill"), { selected: { t: [id("bait")] } });
  assert.equal(zoneOf(engine, id("bait")), "discard");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(influenceOf(engine, P1), START);
});

// --- [G][G][G][G][G]: At the start of your turn, draw a card. Discard a card. ---

clause(BAITINGS, "2:rule@ggggg", "with [G]x5 I gain 2 influence (the lower paragraph), draw a card, then discard a card of my choice: the hand ends the same size", () => {
  const game = baitBoard({ greed: 5 });
  const { engine, id } = game;
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1);
  endTurn(engine, P2);
  orderFirst(engine);
  assert.equal(influenceOf(engine, P1), START + 2, "the [G][G][G] paragraph is active too");
  assert.equal(zoneOf(engine, top), "hand", "the top card was drawn");
  assert.equal(handOf(engine, P1).length, handBefore.length + 1, "drawn before the discard");
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose what to discard");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h1")] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("h1")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("h1")), "into my discard pile");
  assert.equal(handOf(engine, P1).length, handBefore.length, "draw one, discard one");
  assert.equal(deckOf(engine, P1).length, 9);
});

clause(BAITINGS, "2:rule@ggggg", "the card to discard may be any card in my hand, including the one just drawn", () => {
  const game = baitBoard({ greed: 5 });
  const { engine } = game;
  const top = deckOf(engine, P1)[0];
  endTurn(engine, P2);
  orderFirst(engine);
  answerPending(engine, "chooserSelectsTarget", { selected: [top] });
  assert.equal(zoneOf(engine, top), "discard", "the drawn card was discarded");
  assert.equal(handOf(engine, P1).length, 3);
});

clause(BAITINGS, "2:rule@ggggg", "exactly one card must be discarded, from MY hand: none, two, a card in play, or a card in the opponent's hand are refused", () => {
  const game = baitBoard({ greed: 5, extra: [{ key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  endTurn(engine, P2);
  orderFirst(engine);
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, []), "discarding nothing");
  refused(tryPick(engine, P1, [id("h0"), id("h1")]), "two cards");
  refused(tryPick(engine, P1, [id("mine")]), "a card in play");
  refused(tryPick(engine, P1, [id("oh0")]), "a card in the opponent's hand");
  refused(tryPick(engine, P1, [id("d5")]), "a card still in my deck");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("h2")] });
  assert.equal(zoneOf(engine, id("h2")), "discard", "control: a card in my hand is accepted");
});

clause(BAITINGS, "2:rule@ggggg", "with only [G]x4 there is no draw and no discard (but the influence is still gained)", () => {
  const game = baitBoard({ greed: 4 });
  const { engine } = game;
  const hand = handOf(engine, P1);
  const deck = deckOf(engine, P1);
  startMyTurn(game);
  assert.deepEqual(handOf(engine, P1), hand);
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.equal(discardOf(engine, P1).length, 0);
  assert.equal(influenceOf(engine, P1), START + 2);
});

clause(BAITINGS, "2:rule@ggggg", "with [G]x6 (below seven) it draws one card and discards one, not two draws", () => {
  const game = baitBoard({ greed: 6 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  startMyTurn(game);
  assert.equal(deckOf(engine, P1).length, deckBefore - 1, "exactly one card drawn");
  assert.equal(handOf(engine, P1).length, 3, "and one discarded");
  assert.equal(discardOf(engine, P1).length, 1);
});

clause(BAITINGS, "2:rule@ggggg", "an empty deck: nothing is drawn (not a loss) but a card is still discarded", () => {
  const game = baitBoard({ greed: 5, deck: 0 });
  const { engine } = game;
  startMyTurn(game);
  assert.equal(engine.state.result, undefined);
  assert.equal(handOf(engine, P1).length, 2, "no card was drawn, one was discarded");
  assert.equal(discardOf(engine, P1).length, 1);
});

clause(BAITINGS, "2:rule@ggggg", "an empty hand: the drawn card is the only one I can discard, and it is discarded", () => {
  const game = baitBoard({ greed: 5, hand: 0 });
  const { engine } = game;
  const top = deckOf(engine, P1)[0];
  endTurn(engine, P2);
  orderFirst(engine);
  const pc = pending(engine);
  if (pc) answerPending(engine, "chooserSelectsTarget", { selected: [top] });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, top), "discard", "drawn first, then discarded");
  assert.equal(handOf(engine, P1).length, 0);
});

clause(BAITINGS, "2:rule@ggggg", "only the opponent's hand and deck are untouched, and the discard goes to MY discard pile", () => {
  const game = baitBoard({ greed: 5 });
  const { engine } = game;
  const oppHand = handOf(engine, P2);
  const oppDeck = deckOf(engine, P2);
  startMyTurn(game);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(discardOf(engine, P2).length, 0);
  assert.equal(discardOf(engine, P1).length, 1);
});

clause(BAITINGS, "2:rule@ggggg", "only at the start of MY turn, and not at all unless it is in play", () => {
  const theirTurn = baitBoard({ greed: 5, turn: 1, active: P1 });
  const hand = handOf(theirTurn.engine, P1);
  endTurn(theirTurn.engine, P1);
  drain(theirTurn.engine, declineAll);
  assert.deepEqual(handOf(theirTurn.engine, P1), hand, "nothing at the start of their turn");
  assert.equal(discardOf(theirTurn.engine, P1).length, 0);
  const inHand = baitBoard({ greed: 5, bait: "hand" });
  const handBefore = handOf(inHand.engine, P1);
  startMyTurn(inHand);
  assert.deepEqual(handOf(inHand.engine, P1), handBefore, "in hand: nothing");
});

// --- [G]x7: At the start of your turn, draw a card. ---

clause(BAITINGS, "3:rule@ggggggg", "with [G]x7 all three paragraphs are active: +2 influence, two cards drawn and one discarded (the hand grows by one)", () => {
  const game = baitBoard({ greed: 7 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  startMyTurn(game);
  assert.equal(influenceOf(engine, P1), START + 2);
  assert.equal(deckOf(engine, P1).length, deckBefore - 2, "two cards drawn in all");
  assert.equal(handOf(engine, P1).length, 3 + 2 - 1, "drew two, discarded one");
  assert.equal(discardOf(engine, P1).length, 1, "exactly one card discarded");
});

clause(BAITINGS, "3:rule@ggggggg", "with [G]x6 there is only the one draw (the [G]x5 paragraph), not the second", () => {
  const game = baitBoard({ greed: 6 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  startMyTurn(game);
  assert.equal(deckOf(engine, P1).length, deckBefore - 1, "only one card drawn");
});

clause(BAITINGS, "3:rule@ggggggg", "more than seven [G] does not draw more: 9 [G] is still two draws in all", () => {
  const game = baitBoard({ greed: 9 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  startMyTurn(game);
  assert.equal(deckOf(engine, P1).length, deckBefore - 2);
  assert.equal(influenceOf(engine, P1), START + 2);
});

clause(BAITINGS, "3:rule@ggggggg", "the plain draw has no discard of its own: with no hand-size change beyond the other paragraph's single discard", () => {
  const game = baitBoard({ greed: 7, hand: 0 });
  const { engine } = game;
  startMyTurn(game, "d0");
  assert.equal(discardOf(engine, P1).length, 1, "one discard in all (the [G]x5 paragraph's)");
  assert.equal(handOf(engine, P1).length, 1, "two drawn, one discarded");
});

clause(BAITINGS, "3:rule@ggggggg", "spent [G] count towards seven too (control, not availability)", () => {
  const game = baitBoard({ greed: 2, spentGreed: 5 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  startMyTurn(game);
  assert.equal(deckOf(engine, P1).length, deckBefore - 2, "seven [G] controlled: both draws");
});

clause(BAITINGS, "3:rule@ggggggg", "an empty deck: nothing is drawn by the plain draw either (not a loss)", () => {
  const game = baitBoard({ greed: 7, deck: 0 });
  const { engine } = game;
  startMyTurn(game);
  assert.equal(engine.state.result, undefined);
  assert.equal(handOf(engine, P1).length, 2, "nothing drawn, one discarded");
});

clause(BAITINGS, "3:rule@ggggggg", "only at the start of my turn: not at the start of the opponent's", () => {
  const game = baitBoard({ greed: 7, turn: 1, active: P1 });
  const { engine } = game;
  const deck = deckOf(engine, P1);
  endTurn(engine, P1);
  drain(engine, declineAll);
  assert.deepEqual(deckOf(engine, P1), deck, "no draw at their turn start");
});

// =================================================================================
// Montgomery Blatherscythe
// UNIQUE MONTGOMERY
// RESURRECT -- COST: Pay 1. Deplete this card. Pick a character in your discard pile
// with numeric cost 2 or less. -- EFFECT: Put the character into play under your control.
// Character (mau), cost 1, [G][G][G], 0 strength / 3 speed / 1 life.
// =================================================================================

const MONTGOMERY = "295d16d0-7923-4153-8ee2-c7d927fe68d8";
const MONTGOMERY_SAGA = "3c5f2558-8629-44fe-a7a8-18f361b3c843";

/** A character with the given numeric cost and a draw-a-card "enters play" trigger. */
const echoChar = (name: string, cost: number): CardDefinition =>
  character({
    name,
    cost,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function montBoard(
  opts: {
    monty?: "play" | "hand";
    montyDepleted?: boolean;
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "monty", def: printing(MONTGOMERY), owner: P1, zone: opts.monty ?? "play", depleted: opts.montyDepleted },
      { key: "c0", def: character({ name: "Cost0", cost: 0, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      { key: "c1", def: character({ name: "Cost1", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      { key: "c2", def: character({ name: "Cost2", cost: 2, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      { key: "c3", def: character({ name: "Cost3", cost: 3, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      { key: "c5", def: character({ name: "Cost5", cost: 5, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "discard" },
      { key: "echo", def: echoChar("Echo", 2), owner: P1, zone: "discard" },
      { key: "thing", def: item({ name: "Thing", cost: 1 }), owner: P1, zone: "discard" },
      { key: "place", def: location({ name: "Place", cost: 1 }), owner: P1, zone: "discard" },
      { key: "tac", def: tactic({ name: "Tac", cost: 1 }), owner: P1, zone: "discard" },
      { key: "dres", def: resourceCard({ name: "DiscardRes", cost: 0 }), owner: P1, zone: "discard" },
      { key: "oc1", def: character({ name: "OppCost1", cost: 1 }), owner: P2, zone: "discard" },
      { key: "hc", def: character({ name: "HandChar", cost: 1 }), owner: P1, zone: "hand" },
      { key: "dc", def: character({ name: "DeckChar", cost: 1 }), owner: P1, zone: "deck" },
      { key: "pc", def: character({ name: "PlayChar", cost: 1, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", 4, P1, "deck"),
      ...chars("od", 3, P2, "deck"),
      ...res(opts.icons ?? { rage: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

const resurrect = (game: ReturnType<typeof montBoard>, target: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("monty"), "resurrect", { selected: { c: [game.id(target)] } });
const resurrectRaw = (game: ReturnType<typeof montBoard>, target: string, player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("monty"), "resurrect", { c: [game.id(target)] });

clause(MONTGOMERY, "0:unique", "deploys for exactly its printed cost of 1 with [G][G][G]: two [G] among many resources are refused; it has its printed 0 strength / 3 speed / 1 life and is a mau", () => {
  const two = montBoard({ monty: "hand", icons: { greed: 2, rage: 5 } });
  refused(() => playRaw(two.engine, P1, two.id("monty")), "only two [G]");
  assert.equal(zoneOf(two.engine, two.id("monty")), "hand");
  const none = montBoard({ monty: "hand", icons: { rage: 6 } });
  refused(() => playRaw(none.engine, P1, none.id("monty")), "no [G]");
  const { engine, id } = montBoard({ monty: "hand", icons: { greed: 3, rage: 2 } });
  const before = ready(engine);
  play(engine, P1, id("monty"));
  assert.equal(before - ready(engine), 1, "exactly the printed cost of 1");
  assert.equal(zoneOf(engine, id("monty")), "play");
  assert.equal(engine.getStat(id("monty"), "strength"), 0);
  assert.equal(engine.getStat(id("monty"), "speed"), 3);
  assert.equal(engine.getStat(id("monty"), "life"), 1);
  assert.deepEqual(engine.getSubtypes(id("monty")), ["mau"]);
});

clause(MONTGOMERY, "0:unique", "controlling a second Montgomery makes me keep one: keeping the new one destroys the old one", () => {
  const game = montBoard({ icons: { greed: 3, rage: 2 }, extra: [{ key: "monty2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("monty2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...pc.candidates].sort(), [id("monty"), id("monty2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("monty2") });
  assert.equal(zoneOf(engine, id("monty2")), "play");
  assert.equal(zoneOf(engine, id("monty")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MONTGOMERY, "0:unique", "keeping the old Montgomery destroys the new one", () => {
  const game = montBoard({ icons: { greed: 3, rage: 2 }, extra: [{ key: "monty2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("monty2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("monty") });
  assert.equal(zoneOf(engine, id("monty")), "play");
  assert.equal(zoneOf(engine, id("monty2")), "discard");
});

clause(MONTGOMERY, "0:unique", "all printings share the designation: a Seed Saga Montgomery conflicts with a Seed one", () => {
  const game = montBoard({ icons: { greed: 3, rage: 2 }, extra: [{ key: "saga", def: printing(MONTGOMERY_SAGA), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("saga"));
  assert.equal(pending(engine)?.kind, "uniqueSurvivor", "UNIQUE MONTGOMERY on both printings");
});

clause(MONTGOMERY, "0:unique", "the choice must name one of the two copies", () => {
  const game = montBoard({ icons: { greed: 3, rage: 2 }, extra: [{ key: "monty2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("monty2"));
  refused(answerRaw(engine, P1, { kind: "uniqueSurvivor", keep: id("pc") }), "a card that is not a copy");
  assert.equal(pending(engine)?.kind, "uniqueSurvivor");
  answerPending(engine, "uniqueSurvivor", { keep: id("monty") });
  assert.equal(zoneOf(engine, id("monty")), "play", "control: a real copy is accepted");
});

clause(MONTGOMERY, "0:unique", "UNIQUE is per player: the opponent may control their own Montgomery with no choice and no destruction", () => {
  const game = montBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "omonty", def: printing(MONTGOMERY), owner: P2, zone: "hand" }, ...res({ greed: 3, rage: 2 }, P2)]
  });
  const { engine, id } = game;
  play(engine, P2, id("omonty"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("monty")), "play");
  assert.equal(zoneOf(engine, id("omonty")), "play");
});

clause(MONTGOMERY, "0:unique", "taking control of the opponent's Montgomery while I have my own is a duplicate: I must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = montBoard({
    extra: [
      { key: "theirs", def: printing(MONTGOMERY), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("steal"), { selected: { t: [game.id("theirs")] } });
  assert.equal(pending(game.engine)?.kind, "uniqueSurvivor");
  assert.equal(pending(game.engine)?.playerId, P1);
});

clause(MONTGOMERY, "0:unique", "a second copy in my hand or in my discard pile is no conflict (UNIQUE only counts cards in play)", () => {
  const hand = montBoard({ extra: [{ key: "monty2", def: printing(MONTGOMERY), owner: P1, zone: "hand" }] });
  assert.equal(hand.engine.state.pendingChoice, undefined, "a copy in hand is no conflict");
  const discard = montBoard({ extra: [{ key: "monty2", def: printing(MONTGOMERY), owner: P1, zone: "discard" }] });
  assert.equal(discard.engine.state.pendingChoice, undefined, "a copy in the discard pile is no conflict");
});

clause(MONTGOMERY, "0:unique", "a character with a different UNIQUE designation (or none) is not a duplicate", () => {
  const game = montBoard({ extra: [{ key: "other", def: character({ name: "Other", unique: "other guy" } as Partial<CardDefinition>), owner: P1, zone: "play" }] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("monty")), "play");
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
});

// --- RESURRECT ---

clause(MONTGOMERY, "1:ability:resurrect", "pays exactly 1 and depletes Montgomery as the cost, then puts the picked character into play under my control", () => {
  const game = montBoard();
  const { engine, id } = game;
  const before = ready(engine);
  resurrectRaw(game, "c1");
  assert.equal(before - ready(engine), 1, "Pay 1 is paid when the ability is used");
  assert.equal(isDepleted(engine, id("monty")), true, "Montgomery is depleted as a cost");
  assert.equal(zoneOf(engine, id("c1")), "discard", "the character is still in the discard pile while the ability waits to resolve");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(engine.state.cards[id("c1")].controllerId, P1, "under my control");
  assert.equal(engine.state.cards[id("c1")].ownerId, P1);
  assert.ok(engine.state.players[P1].play.includes(id("c1")), "engine.state.players[P1].play.includes(id(\"c1\"))");
  assert.ok(!discardOf(engine, P1).includes(id("c1")), "!discardOf(engine, P1).includes(id(\"c1\"))");
  assert.equal(engine.state.pendingChoice, undefined);
});

for (const [key, cost] of [["c0", 0], ["c1", 1], ["c2", 2]] as const) {
  clause(MONTGOMERY, "1:ability:resurrect", `a character with numeric cost ${cost} (2 or less) can be picked`, () => {
    const game = montBoard();
    resurrect(game, key);
    assert.equal(zoneOf(game.engine, game.id(key)), "play");
  });
}

for (const [key, cost] of [["c3", 3], ["c5", 5]] as const) {
  clause(MONTGOMERY, "1:ability:resurrect", `a character with numeric cost ${cost} (more than 2) cannot be picked`, () => {
    const game = montBoard();
    const before = ready(game.engine);
    refused(() => resurrectRaw(game, key), `cost ${cost}`);
    assert.equal(zoneOf(game.engine, game.id(key)), "discard");
    assert.equal(isDepleted(game.engine, game.id("monty")), false, "nothing was paid");
    assert.equal(ready(game.engine), before);
    resurrect(game, "c2");
    assert.equal(zoneOf(game.engine, game.id("c2")), "play", "control: cost 2 works");
  });
}

clause(MONTGOMERY, "1:ability:resurrect", "only a CHARACTER in MY discard pile can be picked: an item, location, tactic or resource there, the opponent's discard pile, my hand, my deck and play are all refused", () => {
  const game = montBoard();
  for (const [key, why] of [
    ["thing", "an item in my discard pile"],
    ["place", "a location in my discard pile"],
    ["tac", "a tactic in my discard pile"],
    ["dres", "a resource card in my discard pile"],
    ["oc1", "a character in the opponent's discard pile"],
    ["hc", "a character in my hand"],
    ["dc", "a character in my deck"],
    ["pc", "a character already in play"],
    ["foe", "the opponent's character in play"]
  ] as const) {
    refused(() => resurrectRaw(game, key), why);
    assert.equal(isDepleted(game.engine, game.id("monty")), false, `${why}: Montgomery was not depleted`);
  }
  refused(() => actRaw(game.engine, P1, game.id("monty"), "resurrect", { c: [game.engine.state.players[P1].factionId!] }), "my faction");
  assert.equal(ready(game.engine), 3, "nothing was paid by any refused attempt");
  resurrect(game, "c1");
  assert.equal(zoneOf(game.engine, game.id("c1")), "play", "control: a cheap character in my discard pile works");
});

clause(MONTGOMERY, "1:ability:resurrect", "needs exactly one pick: none or two are refused", () => {
  const game = montBoard();
  refused(() => actRaw(game.engine, P1, game.id("monty"), "resurrect", {}), "no pick");
  refused(() => actRaw(game.engine, P1, game.id("monty"), "resurrect", { c: [] }), "an empty pick");
  refused(() => actRaw(game.engine, P1, game.id("monty"), "resurrect", { c: [game.id("c1"), game.id("c2")] }), "two picks");
  assert.equal(zoneOf(game.engine, game.id("c1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("c2")), "discard");
  assert.equal(isDepleted(game.engine, game.id("monty")), false);
});

clause(MONTGOMERY, "1:ability:resurrect", "only the picked character is returned: the other characters in my discard pile and the opponent's stay put", () => {
  const game = montBoard();
  resurrect(game, "c1");
  for (const key of ["c0", "c2", "c3", "c5", "echo", "thing", "place", "tac", "dres"]) assert.equal(zoneOf(game.engine, game.id(key)), "discard", `${key} stays`);
  assert.equal(zoneOf(game.engine, game.id("oc1")), "discard");
});

clause(MONTGOMERY, "1:ability:resurrect", "the character enters play for real: its 'enters play' trigger fires (it draws a card for me)", () => {
  const game = montBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const top = deckOf(engine, P1)[0];
  resurrect(game, "echo");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("echo")), "play");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "the trigger drew a card");
  assert.equal(zoneOf(engine, top), "hand");
});

clause(MONTGOMERY, "1:ability:resurrect", "the returned character is a fresh card: undamaged, undepleted, with its printed stats", () => {
  const game = montBoard();
  const { engine, id } = game;
  resurrect(game, "c1");
  assert.equal(damageOf(engine, id("c1")), 0);
  assert.equal(isDepleted(engine, id("c1")), false);
  assert.equal(engine.getStat(id("c1"), "strength"), 2);
  assert.equal(engine.getStat(id("c1"), "life"), 3);
  assert.equal(engine.getStat(id("c1"), "speed"), 2);
});

clause(MONTGOMERY, "1:ability:resurrect", "a character that died earlier (damage) comes back with no damage", () => {
  const game = montBoard({
    icons: { rage: 4 },
    extra: [
      { key: "victim", def: character({ name: "Victim", cost: 2, strength: 1, life: 2, speed: 1 }), owner: P1, zone: "play" },
      { key: "zap", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }
    ]
  });
  const { engine, id } = game;
  play(engine, P1, id("zap"), { selected: { t: [id("victim")] } });
  assert.equal(zoneOf(engine, id("victim")), "discard");
  resurrect(game, "victim");
  assert.equal(zoneOf(engine, id("victim")), "play");
  assert.equal(damageOf(engine, id("victim")), 0, "it comes back undamaged (CR 408.9)");
});

clause(MONTGOMERY, "1:ability:resurrect", "it is a new card entering play: the resurrected character cannot attack this turn", () => {
  const game = montBoard();
  const { engine, id } = game;
  resurrect(game, "c1");
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("c1")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("pc")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.battle, "control: a character that was already in play can attack");
});

clause(MONTGOMERY, "1:ability:resurrect", "is refused when Montgomery is already depleted, and works again once he is restored on my next turn", () => {
  const game = montBoard();
  const { engine, id } = game;
  resurrect(game, "c1");
  assert.equal(isDepleted(engine, id("monty")), true);
  refused(() => resurrectRaw(game, "c2"), "Montgomery is depleted");
  assert.equal(zoneOf(engine, id("c2")), "discard");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("monty")), false, "restored at the start of my turn");
  resurrect(game, "c2");
  assert.equal(zoneOf(engine, id("c2")), "play");
});

clause(MONTGOMERY, "1:ability:resurrect", "is refused with no resource to pay 1: nothing is depleted", () => {
  const none = montBoard({ icons: {} });
  assert.equal(ready(none.engine), 0);
  refused(() => resurrectRaw(none, "c1"), "no resource");
  assert.equal(isDepleted(none.engine, none.id("monty")), false);
  assert.equal(zoneOf(none.engine, none.id("c1")), "discard");
  const spent = montBoard({ icons: {}, extra: spentRes("rage", P1, 2) });
  refused(() => resurrectRaw(spent, "c1"), "only spent resources");
  const one = montBoard({ icons: { rage: 1 } });
  resurrect(one, "c1");
  assert.equal(zoneOf(one.engine, one.id("c1")), "play", "control: one resource is enough");
  assert.equal(ready(one.engine), 0);
});

clause(MONTGOMERY, "1:ability:resurrect", "can be used the turn Montgomery enters play (abilities are not blocked by summoning sickness)", () => {
  const game = montBoard({ monty: "hand", icons: { greed: 3, rage: 3 } });
  const { engine, id } = game;
  play(engine, P1, id("monty"));
  resurrect(game, "c1");
  assert.equal(zoneOf(engine, id("c1")), "play");
  assert.equal(isDepleted(engine, id("monty")), true);
});

clause(MONTGOMERY, "1:ability:resurrect", "it can be used in response on the opponent's turn: the character enters play on their turn", () => {
  const game = montBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  actRaw(engine, P1, id("monty"), "resurrect", { c: [id("c2")] });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("c2")), "play");
  assert.equal(engine.state.cards[id("c2")].controllerId, P1);
});

clause(MONTGOMERY, "1:ability:resurrect", "only Montgomery's controller can use it: the opponent cannot", () => {
  const game = montBoard({ turn: 2, active: P2, extra: res({ rage: 3 }, P2) });
  refused(() => actRaw(game.engine, P2, game.id("monty"), "resurrect", { c: [game.id("c1")] }), "not its controller");
  assert.equal(zoneOf(game.engine, game.id("c1")), "discard");
});

clause(MONTGOMERY, "1:ability:resurrect", "it is an in-play ability: from my hand it cannot be used", () => {
  const game = montBoard({ monty: "hand" });
  refused(() => resurrectRaw(game, "c1"), "Montgomery in hand");
  assert.equal(zoneOf(game.engine, game.id("c1")), "discard");
});

clause(MONTGOMERY, "1:ability:resurrect", "if the picked character leaves the discard pile in response, the effect loses track of it and nothing is put into play (CR 402.4)", () => {
  const bouncer = tactic({
    name: "Bouncer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ex",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const game = montBoard({ extra: [{ key: "ex", def: bouncer, owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  resurrectRaw(game, "c1");
  respondWith(engine, P2, id("ex"), { t: [id("c1")] });
  assert.equal(isDepleted(engine, id("monty")), true, "the cost was paid anyway");
  assert.equal(zoneOf(engine, id("c1")), "hand", "the card left the discard pile in response (to its owner's hand)");
  assert.equal(engine.state.players[P1].play.includes(id("c1")), false, "the effect no longer finds the card in the discard pile, so it is not put into play from the hand");
  assert.equal(zoneOf(engine, id("c1")), "hand", "and it stays where it went");
});

// =================================================================================
// Mutineer's Hiatus
// COST: Destroy a character you own. -- EFFECT: Draw 2 cards.
// RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 2. Remove this
// card from the game. Pick a character you own. -- EFFECT: Destroy the character. Draw a card.
// Tactic (banker), cost 1, [G].
// =================================================================================

const HIATUS = "09e941f7-a0b9-4727-a30b-3783fca566eb";

function hiatusBoard(
  opts: {
    hiatus?: "hand" | "discard" | "deck" | "play" | "removed";
    icons?: Icons;
    deck?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "hi", def: printing(HIATUS), owner: P1, zone: opts.hiatus ?? "hand" },
      { key: "victim", def: character({ name: "Victim", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "victim2", def: character({ name: "Victim2", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      // owned by the opponent, controlled by me
      { key: "stolenByMe", def: character({ name: "StolenByMe", strength: 1, life: 3, speed: 1 }), owner: P2, controller: P1, zone: "play" },
      // owned by me, controlled by the opponent
      { key: "stolenFromMe", def: character({ name: "StolenFromMe", strength: 1, life: 3, speed: 1 }), owner: P1, controller: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      ...chars("d", opts.deck ?? 6, P1, "deck"),
      ...chars("od", 3, P2, "deck"),
      ...chars("oh", 2, P2, "hand"),
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type HiGame = ReturnType<typeof hiatusBoard>;
const hiPlayRaw = (game: HiGame, victim: string) => playRaw(game.engine, P1, game.id("hi"), { selected: { c: [game.id(victim)] } });
const hiPlay = (game: HiGame, victim: string) => play(game.engine, P1, game.id("hi"), { selected: { c: [game.id(victim)] } });
const hiRecurRaw = (game: HiGame, victim: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("hi"), "recur", { rc: [game.id(victim)] });
const hiRecur = (game: HiGame, victim: string) => activate(game.engine, P1, game.id("hi"), "recur", { selected: { rc: [game.id(victim)] } });

clause(HIATUS, "0:ability", "deploys for exactly its printed cost of 1 with [G]: refused with no [G] even with plenty of resources, and refused with no resources", () => {
  const noGreed = hiatusBoard({ icons: { rage: 6 } });
  refused(() => hiPlayRaw(noGreed, "victim"), "no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("hi")), "hand");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("victim")), "play", "the victim was not destroyed by the refused play");
  const none = hiatusBoard({ icons: {} });
  refused(() => hiPlayRaw(none, "victim"), "no resources at all");
  const { engine, id } = hiatusBoard({ icons: { greed: 4 } });
  const before = ready(engine);
  hiPlay({ engine, id } as HiGame, "victim");
  assert.equal(before - ready(engine), 1, "exactly the printed cost of 1 is paid");
  assert.equal(engine.getDefinition(id("hi")).type, "tactic");
});

clause(HIATUS, "0:ability", "the cost destroys the picked character when the tactic is played (before the opponent can respond), then I draw exactly 2 cards", () => {
  const game = hiatusBoard();
  const { engine, id } = game;
  const top2 = deckOf(engine, P1).slice(0, 2);
  const third = deckOf(engine, P1)[2];
  const handBefore = handOf(engine, P1).length;
  hiPlayRaw(game, "victim");
  assert.ok(engine.state.responseWindow, "the response window is open");
  assert.equal(zoneOf(engine, id("victim")), "discard", "'Destroy a character you own' is a cost: it is already destroyed while the tactic waits");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing drawn yet");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "the tactic left the hand and exactly 2 cards were drawn");
  for (const card of top2) assert.equal(zoneOf(engine, card), "hand", "the top two cards of my deck");
  assert.equal(zoneOf(engine, third), "deck", "only two");
  assert.equal(zoneOf(engine, id("hi")), "discard", "the tactic ends in my discard pile");
  assert.ok(discardOf(engine, P1).includes(id("victim")), "the destroyed character is in its owner's discard pile");
});

clause(HIATUS, "0:ability", "only the picked character is destroyed: my other characters, the opponent's and my items and locations stay", () => {
  const game = hiatusBoard();
  const { engine, id } = game;
  hiPlay(game, "victim");
  for (const key of ["victim2", "foe", "stolenByMe", "stolenFromMe", "thing", "place"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
});

clause(HIATUS, "0:ability", "the opponent's hand, deck and discard pile are untouched: only I draw", () => {
  const game = hiatusBoard();
  const { engine } = game;
  const oppHand = handOf(engine, P2);
  const oppDeck = deckOf(engine, P2);
  hiPlay(game, "victim");
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(HIATUS, "0:ability", "'a character you own': a character I own is a legal pick even though the opponent controls it (and it goes to MY discard pile)", () => {
  const game = hiatusBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  hiPlay(game, "stolenFromMe");
  assert.equal(zoneOf(engine, id("stolenFromMe")), "discard", "destroyed");
  assert.ok(discardOf(engine, P1).includes(id("stolenFromMe")), "in its owner's discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "and the 2 cards were drawn");
});

clause(HIATUS, "0:ability", "'a character you own': a character I control but the opponent owns is NOT a legal pick", () => {
  const game = hiatusBoard();
  const { engine, id } = game;
  const before = ready(engine);
  refused(() => hiPlayRaw(game, "stolenByMe"), "I control it but do not own it");
  assert.equal(zoneOf(engine, id("stolenByMe")), "play");
  assert.equal(zoneOf(engine, id("hi")), "hand");
  assert.equal(ready(engine), before);
});

clause(HIATUS, "0:ability", "the pick must be a character I own: the opponent's character, an item, a location, my faction, a character in hand or discard are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
    { key: "fd", def: character({ name: "FaceDown" }), owner: P1, zone: "play", faceDown: true }
  ];
  for (const [key, why] of [
    ["foe", "the opponent's character"],
    ["thing", "an item"],
    ["place", "a location"],
    ["inHand", "a character in my hand"],
    ["inDiscard", "a character in my discard pile"],
    ["fd", "a face-down card (only a resource)"]
  ] as const) {
    const game = hiatusBoard({ extra: extras() });
    refused(() => hiPlayRaw(game, key), why);
    assert.equal(zoneOf(game.engine, game.id("hi")), "hand", `${why}: not played`);
    assert.equal(zoneOf(game.engine, game.id(key)), game.engine.state.cards[game.id(key)].zone, "nothing destroyed");
    assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  }
  const faction = hiatusBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("hi"), { selected: { c: [faction.engine.state.players[P1].factionId!] } }), "my own faction");
  const good = hiatusBoard({ extra: extras() });
  hiPlay(good, "victim");
  assert.equal(zoneOf(good.engine, good.id("victim")), "discard", "control: my own character is accepted");
});

clause(HIATUS, "0:ability", "needs exactly one character: none or two are refused (and nothing is destroyed)", () => {
  const game = hiatusBoard();
  refused(() => playRaw(game.engine, P1, game.id("hi"), { selected: {} }), "no pick");
  refused(() => playRaw(game.engine, P1, game.id("hi"), { selected: { c: [] } }), "an empty pick");
  refused(() => playRaw(game.engine, P1, game.id("hi"), { selected: { c: [game.id("victim"), game.id("victim2")] } }), "two picks");
  assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  assert.equal(zoneOf(game.engine, game.id("victim2")), "play");
  assert.equal(zoneOf(game.engine, game.id("hi")), "hand");
});

clause(HIATUS, "0:ability", "with no character I own in play it cannot be played", () => {
  const { engine, id } = devBoard([
    { key: "hi", def: printing(HIATUS), owner: P1, zone: "hand" },
    { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
    ...chars("d", 4, P1, "deck"),
    ...res({ greed: 3 })
  ]);
  refused(() => playRaw(engine, P1, id("hi"), { selected: { c: [id("foe")] } }), "the only character is the opponent's");
  refused(() => playRaw(engine, P1, id("hi"), { selected: {} }), "nothing to pick");
  assert.equal(zoneOf(engine, id("hi")), "hand");
});

clause(HIATUS, "0:ability", "a deck of 1 card draws that card; an empty deck draws nothing and is not a loss", () => {
  const one = hiatusBoard({ deck: 1 });
  const only = deckOf(one.engine, P1)[0];
  hiPlay(one, "victim");
  assert.equal(zoneOf(one.engine, only), "hand");
  assert.equal(deckOf(one.engine, P1).length, 0);
  const empty = hiatusBoard({ deck: 0 });
  const handBefore = handOf(empty.engine, P1).length;
  hiPlay(empty, "victim");
  assert.equal(handOf(empty.engine, P1).length, handBefore - 1);
  assert.equal(empty.engine.state.result, undefined);
});

clause(HIATUS, "0:ability", "if the tactic is terminated, the cost stays paid (the character is destroyed) but I draw nothing", () => {
  const game = hiatusBoard({ extra: [{ key: "term", def: terminatorTactic(), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  hiPlayRaw(game, "victim");
  respondWith(engine, P2, id("term"));
  assert.equal(zoneOf(engine, id("victim")), "discard", "the cost was paid");
  assert.equal(zoneOf(engine, id("hi")), "discard", "terminated: the tactic went to the discard pile");
  assert.equal(handOf(engine, P1).length, handBefore - 1, "no cards drawn");
});

clause(HIATUS, "0:ability", "it is a tactic: it can be played in response to the opponent's attack", () => {
  const game = hiatusBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  refused(() => hiPlayRaw(game, "victim"), "no window is open yet");
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  const handBefore = handOf(engine, P1).length;
  hiPlayRaw(game, "victim");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("victim")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 2, "and I drew 2");
});

// --- RECUR ---

clause(HIATUS, "1:ability:recur", "from the discard pile: pays 2 and removes the card from the game as part of the cost, picks one of my characters, then destroys it and draws exactly 1 card", () => {
  const game = hiatusBoard({ hiatus: "discard" });
  const { engine, id } = game;
  const before = ready(engine);
  const top = deckOf(engine, P1)[0];
  const next = deckOf(engine, P1)[1];
  const handBefore = handOf(engine, P1).length;
  hiRecurRaw(game, "victim");
  assert.equal(before - ready(engine), 2, "Pay 2 is paid when the ability is used");
  assert.equal(zoneOf(engine, id("hi")), "removed", "removed from the game as a cost");
  assert.ok(removedOf(engine, P1).includes(id("hi")), "removedOf(engine, P1).includes(id(\"hi\"))");
  assert.equal(zoneOf(engine, id("victim")), "play", "the destroy is the effect: it has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("victim")), "discard", "destroyed");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(zoneOf(engine, next), "deck");
});

clause(HIATUS, "1:ability:recur", "only the picked character is destroyed", () => {
  const game = hiatusBoard({ hiatus: "discard" });
  hiRecur(game, "victim");
  for (const key of ["victim2", "foe", "stolenByMe", "stolenFromMe", "thing", "place"]) assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} stays`);
});

clause(HIATUS, "1:ability:recur", "'a character you own': one I own but the opponent controls can be picked and destroyed; one I control but do not own cannot", () => {
  const mine = hiatusBoard({ hiatus: "discard" });
  hiRecur(mine, "stolenFromMe");
  assert.equal(zoneOf(mine.engine, mine.id("stolenFromMe")), "discard");
  assert.ok(discardOf(mine.engine, P1).includes(mine.id("stolenFromMe")), "discardOf(mine.engine, P1).includes(mine.id(\"stolenFromMe\"))");
  const theirs = hiatusBoard({ hiatus: "discard" });
  const before = ready(theirs.engine);
  refused(() => hiRecurRaw(theirs, "stolenByMe"), "I control it but do not own it");
  assert.equal(zoneOf(theirs.engine, theirs.id("hi")), "discard", "not removed");
  assert.equal(ready(theirs.engine), before, "nothing paid");
});

clause(HIATUS, "1:ability:recur", "the pick must be one of my characters in play: the opponent's character, an item, a location, a faction, or a character in hand are refused", () => {
  for (const [key, why] of [
    ["foe", "the opponent's character"],
    ["thing", "an item"],
    ["place", "a location"],
    ["inHand", "a character in my hand"]
  ] as const) {
    const game = hiatusBoard({ hiatus: "discard", extra: [{ key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" }] });
    refused(() => hiRecurRaw(game, key), why);
    assert.equal(zoneOf(game.engine, game.id("hi")), "discard", `${why}: not removed`);
  }
  const faction = hiatusBoard({ hiatus: "discard" });
  refused(() => actRaw(faction.engine, P1, faction.id("hi"), "recur", { rc: [faction.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => actRaw(faction.engine, P1, faction.id("hi"), "recur", {}), "no pick");
  refused(() => actRaw(faction.engine, P1, faction.id("hi"), "recur", { rc: [faction.id("victim"), faction.id("victim2")] }), "two picks");
  assert.equal(zoneOf(faction.engine, faction.id("victim")), "play");
  hiRecur(faction, "victim");
  assert.equal(zoneOf(faction.engine, faction.id("victim")), "discard", "control: my own character works");
});

clause(HIATUS, "1:ability:recur", "if the picked character is already gone when the ability resolves, the destroy does nothing but I still draw a card (CR 402.5)", () => {
  const game = hiatusBoard({ hiatus: "discard", extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  hiRecurRaw(game, "victim");
  respondWith(engine, P2, id("kill"), { t: [id("victim")] });
  assert.equal(zoneOf(engine, id("victim")), "discard", "destroyed in response");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "the draw still happens");
  assert.equal(zoneOf(engine, id("hi")), "removed");
});

clause(HIATUS, "1:ability:recur", "an empty deck: the character is destroyed, nothing is drawn, and it is not a loss", () => {
  const game = hiatusBoard({ hiatus: "discard", deck: 0 });
  hiRecur(game, "victim");
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard");
  assert.equal(game.engine.state.result, undefined);
});

clause(HIATUS, "1:ability:recur", "'use this only if this card is in your discard pile': refused from the hand, the deck, in play and once removed", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const game = hiatusBoard({ hiatus: zone });
    const before = ready(game.engine);
    refused(() => hiRecurRaw(game, "victim"), `Hiatus in ${zone}`);
    assert.equal(ready(game.engine), before, `${zone}: nothing was paid`);
    assert.equal(zoneOf(game.engine, game.id("victim")), "play");
  }
  const ok = hiatusBoard({ hiatus: "discard" });
  hiRecurRaw(ok, "victim");
  assert.equal(zoneOf(ok.engine, ok.id("hi")), "removed", "control: from the discard pile it works");
});

clause(HIATUS, "1:ability:recur", "'your discard pile': the opponent's Hiatus in THEIR discard pile cannot be recurred by me, and mine cannot be recurred by them", () => {
  const game = hiatusBoard({ hiatus: "discard", extra: [{ key: "ohi", def: printing(HIATUS), owner: P2, zone: "discard" }, ...res({ greed: 4 }, P2)] });
  refused(() => actRaw(game.engine, P1, game.id("ohi"), "recur", { rc: [game.id("victim")] }), "not my discard pile");
  assert.equal(zoneOf(game.engine, game.id("ohi")), "discard");
  refused(() => actRaw(game.engine, P2, game.id("hi"), "recur", { rc: [game.id("foe")] }), "not their discard pile");
  assert.equal(zoneOf(game.engine, game.id("hi")), "discard");
});

clause(HIATUS, "1:ability:recur", "is refused one resource short of Pay 2, allowed with exactly 2", () => {
  const short = hiatusBoard({ hiatus: "discard", icons: { greed: 1 } });
  refused(() => hiRecurRaw(short, "victim"), "1 resource");
  assert.equal(zoneOf(short.engine, short.id("hi")), "discard", "not removed");
  const exact = hiatusBoard({ hiatus: "discard", icons: { greed: 2 } });
  hiRecur(exact, "victim");
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("hi")), "removed");
});

clause(HIATUS, "1:ability:recur", "RECUR: [G] needs a [G]: plenty of other resources are not enough, one [G] among them is", () => {
  const none = hiatusBoard({ hiatus: "discard", icons: { rage: 5 } });
  refused(() => hiRecurRaw(none, "victim"), "no [G]");
  assert.equal(zoneOf(none.engine, none.id("hi")), "discard");
  const one = hiatusBoard({ hiatus: "discard", icons: { greed: 1, rage: 4 } });
  hiRecur(one, "victim");
  assert.equal(zoneOf(one.engine, one.id("hi")), "removed");
  assert.equal(ready(one.engine), 3, "exactly 2 of the 5 resources were paid");
});

clause(HIATUS, "1:ability:recur", "it is an ability, not a tactic play: it can be used on the opponent's turn in response to their attack", () => {
  const game = hiatusBoard({ hiatus: "discard", turn: 2, active: P2 });
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  hiRecurRaw(game, "victim");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("victim")), "discard");
  assert.equal(zoneOf(game.engine, game.id("hi")), "removed");
});

clause(HIATUS, "1:ability:recur", "can be used only once: the removed card is gone for good", () => {
  const game = hiatusBoard({ hiatus: "discard", icons: { greed: 6 } });
  hiRecur(game, "victim");
  refused(() => hiRecurRaw(game, "victim2"), "the card was removed from the game");
  assert.equal(ready(game.engine), 4, "only the first use was paid for");
  assert.equal(zoneOf(game.engine, game.id("victim2")), "play");
});

clause(HIATUS, "1:ability:recur", "after playing it normally, it lands in the discard pile and its RECUR becomes available", () => {
  const game = hiatusBoard({ icons: { greed: 8 } });
  refused(() => hiRecurRaw(game, "victim2"), "still in my hand");
  hiPlay(game, "victim");
  assert.equal(zoneOf(game.engine, game.id("hi")), "discard");
  hiRecur(game, "victim2");
  assert.equal(zoneOf(game.engine, game.id("victim2")), "discard");
  assert.equal(zoneOf(game.engine, game.id("hi")), "removed");
  assert.equal(ready(game.engine), 8 - 1 - 2);
});

// =================================================================================
// Pilgrimage Auditor
// IMPEDE -- COST: Deplete this card. Pick a character. -- EFFECT: Deplete the character.
// Character (mau), cost 3, [G], 0 strength / 3 speed / 5 life.
// =================================================================================

const AUDITOR = "842d8014-282d-4ee0-8510-92c2c13a8291";

function auditorBoard(
  opts: { aud?: "play" | "hand"; audDepleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "aud", def: printing(AUDITOR), owner: P1, zone: opts.aud ?? "play", depleted: opts.audDepleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type AudGame = ReturnType<typeof auditorBoard>;
const impede = (game: AudGame, target: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("aud"), "impede", { selected: { c: [game.id(target)] } });
const impedeRaw = (game: AudGame, target: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("aud"), "impede", { c: [game.id(target)] });

clause(AUDITOR, "0:ability:impede", "deploys for exactly its printed cost of 3 with [G]: refused one resource short and without [G]; printed 0 strength / 3 speed / 5 life, subtype mau", () => {
  const short = auditorBoard({ aud: "hand", icons: { greed: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("aud")), "2 resources: one short of 3");
  const noGreed = auditorBoard({ aud: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("aud")), "no [G]");
  const { engine, id } = auditorBoard({ aud: "hand", icons: { greed: 4 } });
  const before = ready(engine);
  play(engine, P1, id("aud"));
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("aud")), "play");
  assert.equal(engine.getStat(id("aud"), "strength"), 0);
  assert.equal(engine.getStat(id("aud"), "speed"), 3);
  assert.equal(engine.getStat(id("aud"), "life"), 5);
  assert.deepEqual(engine.getSubtypes(id("aud")), ["mau"]);
});

clause(AUDITOR, "0:ability:impede", "depletes the Auditor as its cost (immediately) and the picked character when it resolves; no resources are needed or paid", () => {
  const game = auditorBoard();
  const { engine, id } = game;
  assert.equal(ready(engine), 0, "no resources at all");
  impedeRaw(game, "foe");
  assert.equal(isDepleted(engine, id("aud")), true, "COST: Deplete this card");
  assert.equal(isDepleted(engine, id("foe")), false, "the effect has not resolved yet");
  resolvePendingResponses(engine);
  assert.equal(isDepleted(engine, id("foe")), true, "the picked character is depleted");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foe")), "play", "only depleted, not otherwise harmed");
  assert.equal(damageOf(engine, id("foe")), 0);
});

clause(AUDITOR, "0:ability:impede", "only the picked character is depleted: my other characters and the opponent's other characters are not", () => {
  const game = auditorBoard();
  const { engine, id } = game;
  impede(game, "foe");
  assert.equal(isDepleted(engine, id("foe2")), false);
  assert.equal(isDepleted(engine, id("mine")), false);
});

clause(AUDITOR, "0:ability:impede", "can pick one of my own characters", () => {
  const game = auditorBoard();
  impede(game, "mine");
  assert.equal(isDepleted(game.engine, game.id("mine")), true);
  assert.equal(isDepleted(game.engine, game.id("aud")), true);
});

clause(AUDITOR, "0:ability:impede", "can pick the Auditor itself (it is a character): it is just depleted, and nothing breaks", () => {
  const game = auditorBoard();
  impede(game, "aud");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("aud")), true);
  assert.equal(zoneOf(game.engine, game.id("aud")), "play");
});

clause(AUDITOR, "0:ability:impede", "an already depleted character stays depleted (and it resolves cleanly)", () => {
  const game = auditorBoard({ extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P2, zone: "play", depleted: true }] });
  impede(game, "tired");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("tired")), true);
  assert.equal(isDepleted(game.engine, game.id("aud")), true);
});

clause(AUDITOR, "0:ability:impede", "the pick must be a character in play: an item, a location, a faction, a face-down card and cards in hand or discard are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ];
  for (const [key, why] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["fd", "a face-down card"],
    ["inHand", "a character in hand"],
    ["inDiscard", "a character in the discard pile"]
  ] as const) {
    const game = auditorBoard({ extra: extras() });
    refused(() => impedeRaw(game, key), why);
    assert.equal(isDepleted(game.engine, game.id("aud")), false, `${why}: the cost was not paid`);
  }
  const faction = auditorBoard();
  refused(() => actRaw(faction.engine, P1, faction.id("aud"), "impede", { c: [faction.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(faction.engine, P1, faction.id("aud"), "impede", { c: [faction.engine.state.players[P1].factionId!] }), "my faction");
  assert.equal(isDepleted(faction.engine, faction.id("aud")), false);
  const good = auditorBoard({ extra: extras() });
  impede(good, "foe");
  assert.equal(isDepleted(good.engine, good.id("foe")), true, "control: a character in play is accepted");
});

clause(AUDITOR, "0:ability:impede", "needs exactly one pick: none or two are refused", () => {
  const game = auditorBoard();
  refused(() => actRaw(game.engine, P1, game.id("aud"), "impede", {}), "no pick");
  refused(() => actRaw(game.engine, P1, game.id("aud"), "impede", { c: [] }), "an empty pick");
  refused(() => actRaw(game.engine, P1, game.id("aud"), "impede", { c: [game.id("foe"), game.id("foe2")] }), "two picks");
  assert.equal(isDepleted(game.engine, game.id("aud")), false);
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(AUDITOR, "0:ability:impede", "is refused when the Auditor is already depleted, and works again after it is restored at the start of my next turn", () => {
  const game = auditorBoard();
  const { engine, id } = game;
  impede(game, "foe");
  refused(() => impedeRaw(game, "foe2"), "the Auditor is depleted");
  assert.equal(isDepleted(engine, id("foe2")), false);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("aud")), false, "restored");
  impede(game, "foe2");
  assert.equal(isDepleted(engine, id("foe2")), true);
});

clause(AUDITOR, "0:ability:impede", "is refused if it started depleted (e.g. it attacked)", () => {
  const game = auditorBoard({ audDepleted: true });
  refused(() => impedeRaw(game, "foe"), "already depleted");
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(AUDITOR, "0:ability:impede", "can be used the turn the Auditor enters play (no summoning sickness for abilities)", () => {
  const game = auditorBoard({ aud: "hand", icons: { greed: 3 } });
  play(game.engine, P1, game.id("aud"));
  impede(game, "foe");
  assert.equal(isDepleted(game.engine, game.id("foe")), true);
});

clause(AUDITOR, "0:ability:impede", "a depleted character cannot block: depleting their blocker before blockers are declared stops it from blocking", () => {
  const board = () =>
    auditorBoard({ turn: 2, active: P1, extra: [{ key: "atk", def: character({ name: "Atk", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" }] });
  const control = board();
  declareAttackBy(control.engine, P1, [control.id("atk")]);
  declareBlockers(control.engine, P2, [control.id("foe")]);
  assert.deepEqual(battleOf(control.engine)?.blockingParty, [control.id("foe")], "control: an undepleted character can block");
  const game = board();
  const { engine, id } = game;
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("atk")], target: { type: "faction", playerId: P2 } });
  impede(game, "foe");
  assert.equal(isDepleted(engine, id("foe")), true);
  refused(() => declareBlockers(engine, P2, [id("foe")]), "a depleted character cannot block");
  declareBlockers(engine, P2, [id("foe2")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("foe2")], "its sibling still can");
});

clause(AUDITOR, "0:ability:impede", "only the Auditor's controller can use it: the opponent cannot", () => {
  const game = auditorBoard({ turn: 2, active: P2 });
  refused(() => impedeRaw(game, "foe", P2), "not its controller");
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(AUDITOR, "0:ability:impede", "it is an in-play ability: from my hand it cannot be used", () => {
  const game = auditorBoard({ aud: "hand" });
  refused(() => impedeRaw(game, "foe"), "Auditor in hand");
  assert.equal(isDepleted(game.engine, game.id("foe")), false);
});

clause(AUDITOR, "0:ability:impede", "it can be used in response on the opponent's turn: a character is depleted in response to their attack", () => {
  const game = auditorBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  impedeRaw(game, "foe2");
  resolvePendingResponses(game.engine);
  assert.equal(isDepleted(game.engine, game.id("foe2")), true);
  assert.equal(isDepleted(game.engine, game.id("aud")), true);
});

clause(AUDITOR, "0:ability:impede", "if the picked character leaves play in response, the effect does nothing and the Auditor stays depleted", () => {
  const game = auditorBoard({ extra: [{ key: "kill", def: killTactic({ name: "FoeKill" }), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  impedeRaw(game, "foe");
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(engine, id("aud")), true);
});

// =================================================================================
// Portly Tradesmau
// If this card blocks, draw X cards, where X is the number of characters in the attacking party.
// Character (merchant, mau), cost 2, [G][G], 0 strength / 3 speed / 4 life.
// =================================================================================

const TRADESMAU = "1c974981-51dc-4a75-985c-116089fd9356";

function tradeBoard(
  opts: { attackers?: number; deck?: number; trade?: "play" | "hand"; tradeDepleted?: boolean; tradeFaceDown?: boolean; extra?: CardPlacement[]; icons?: Icons; turn?: number; active?: PlayerId } = {}
) {
  const n = opts.attackers ?? 1;
  return devBoard(
    [
      { key: "trade", def: printing(TRADESMAU), owner: P1, zone: opts.trade ?? "play", depleted: opts.tradeDepleted, faceDown: opts.tradeFaceDown },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      ...Array.from({ length: n }, (_, i) => ({ key: `atk${i}`, def: character({ name: `Atk${i}`, strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" as const })),
      ...chars("d", opts.deck ?? 8, P1, "deck"),
      ...chars("od", 5, P2, "deck"),
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type TradeGame = ReturnType<typeof tradeBoard>;
const attackWith = (game: TradeGame, n: number): string[] => Array.from({ length: n }, (_, i) => `atk${i}`);
function tradeAttack(game: TradeGame, n = 1): void {
  declareAttackBy(game.engine, P2, attackWith(game, n).map(game.id));
}

clause(TRADESMAU, "0:rule", "deploys for exactly its printed cost of 2 with [G][G]: one [G] among many resources is refused; printed 0 strength / 3 speed / 4 life, merchant and mau", () => {
  const one = tradeBoard({ trade: "hand", icons: { greed: 1, rage: 5 }, turn: 1, active: P1 });
  refused(() => playRaw(one.engine, P1, one.id("trade")), "only one [G]", /Threshold requirements are not met/);
  const none = tradeBoard({ trade: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(none.engine, P1, none.id("trade")), "no [G]", /Threshold requirements are not met/);
  const { engine, id } = tradeBoard({ trade: "hand", icons: { greed: 2, rage: 2 }, turn: 1, active: P1 });
  const before = ready(engine);
  play(engine, P1, id("trade"));
  assert.equal(before - ready(engine), 2);
  assert.equal(engine.getStat(id("trade"), "strength"), 0);
  assert.equal(engine.getStat(id("trade"), "speed"), 3);
  assert.equal(engine.getStat(id("trade"), "life"), 4);
  assert.deepEqual([...engine.getSubtypes(id("trade"))].sort(), ["mau", "merchant"]);
});

for (const n of [1, 2, 3, 4]) {
  clause(TRADESMAU, "0:rule", `blocking an attacking party of ${n} draws exactly ${n} card${n === 1 ? "" : "s"} (X = the number of characters in the attacking party)`, () => {
    const game = tradeBoard({ attackers: n });
    const { engine, id } = game;
    tradeAttack(game, n);
    const top = deckOf(engine, P1).slice(0, n);
    const next = deckOf(engine, P1)[n];
    const handBefore = handOf(engine, P1).length;
    declareBlockers(engine, P1, [id("trade")]);
    drain(engine, declineAll);
    assert.equal(handOf(engine, P1).length, handBefore + n, `${n} cards drawn`);
    for (const card of top) assert.equal(zoneOf(engine, card), "hand");
    assert.equal(zoneOf(engine, next), "deck", `not ${n + 1}`);
  });
}

clause(TRADESMAU, "0:rule", "the cards are drawn when it blocks (at block declaration), before any battle damage", () => {
  const game = tradeBoard({ attackers: 2 });
  const { engine, id } = game;
  tradeAttack(game, 2);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, [id("trade")]);
  assert.ok(battleOf(engine), "the battle is still going");
  assert.equal(handOf(engine, P1).length, handBefore + 2, "already drawn");
  assert.equal(damageOf(engine, id("trade")), 0, "and no damage has been dealt yet");
});

clause(TRADESMAU, "0:rule", "X is the number of characters in the ATTACKING party, not the blocking party: blocking together with other characters still draws X (one trigger)", () => {
  const game = tradeBoard({ attackers: 2 });
  const { engine, id } = game;
  tradeAttack(game, 2);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, [id("trade"), id("plain")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore + 2, "X = 2 (two attackers), not 2 + something for the two blockers");
});

clause(TRADESMAU, "0:rule", "it only triggers when THIS card blocks: other characters blocking alone draw nothing", () => {
  const game = tradeBoard({ attackers: 3 });
  const { engine, id } = game;
  tradeAttack(game, 3);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, [id("plain")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore, "no draw: the Tradesmau did not block");
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plain")]);
});

clause(TRADESMAU, "0:rule", "not blocking (declaring no blockers) draws nothing", () => {
  const game = tradeBoard({ attackers: 2 });
  const { engine, id } = game;
  tradeAttack(game, 2);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, []);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore);
  assert.equal(zoneOf(engine, id("trade")), "play");
});

clause(TRADESMAU, "0:rule", "it triggers on blocking, not on attacking: attacking with it draws nothing", () => {
  const { engine, id } = devBoard(
    [
      { key: "trade", def: printing(TRADESMAU), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...chars("d", 5, P1, "deck")
    ],
    { turn: 2, activePlayerId: P1 }
  );
  const handBefore = handOf(engine, P1).length;
  declareAttackBy(engine, P1, [id("trade")]);
  declareBlockers(engine, P2, [id("foe")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore, "attacking draws nothing");
});

clause(TRADESMAU, "0:rule", "the controller draws: the opponent's Tradesmau blocking MY attack draws cards for THEM, not me", () => {
  const { engine, id } = devBoard(
    [
      { key: "trade", def: printing(TRADESMAU), owner: P2, zone: "play" },
      { key: "a0", def: character({ name: "A0", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      ...chars("d", 5, P1, "deck"),
      ...chars("od", 5, P2, "deck")
    ],
    { turn: 2, activePlayerId: P1 }
  );
  const mine = handOf(engine, P1).length;
  const theirs = handOf(engine, P2).length;
  declareAttackBy(engine, P1, [id("a0"), id("a1")]);
  declareBlockers(engine, P2, [id("trade")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P2).length, theirs + 2, "its controller draws 2");
  assert.equal(handOf(engine, P1).length, mine, "I draw nothing");
});

clause(TRADESMAU, "0:rule", "X counts the characters left in the party when it blocks: an attacker removed in response beforehand is not counted", () => {
  const game = tradeBoard({ attackers: 3, extra: [{ key: "kill", def: killTactic({ name: "MyKill" }), owner: P1, zone: "hand" }, ...res({ rage: 1 })] });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("atk0"), id("atk1"), id("atk2")]);
  respondWith(engine, P1, id("kill"), { t: [id("atk0")] });
  assert.equal(zoneOf(engine, id("atk0")), "discard", "one attacker is gone");
  resolvePendingResponses(engine);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, [id("trade")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore + 2, "X = 2 characters left in the attacking party");
});

clause(TRADESMAU, "0:rule", "two Tradesmau blocking together each draw X: 2 x X cards in all", () => {
  const game = tradeBoard({ attackers: 2, extra: [{ key: "trade2", def: printing(TRADESMAU), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  tradeAttack(game, 2);
  const handBefore = handOf(engine, P1).length;
  declareBlockers(engine, P1, [id("trade"), id("trade2")]);
  drain(engine, declineAll);
  assert.equal(handOf(engine, P1).length, handBefore + 4, "two triggers of X = 2");
});

clause(TRADESMAU, "0:rule", "a short deck draws what it has (not a loss); an empty deck draws nothing", () => {
  const short = tradeBoard({ attackers: 3, deck: 2 });
  tradeAttack(short, 3);
  declareBlockers(short.engine, P1, [short.id("trade")]);
  drain(short.engine, declineAll);
  assert.equal(deckOf(short.engine, P1).length, 0);
  assert.equal(short.engine.state.result, undefined);
  const empty = tradeBoard({ attackers: 2, deck: 0 });
  tradeAttack(empty, 2);
  const handBefore = handOf(empty.engine, P1).length;
  declareBlockers(empty.engine, P1, [empty.id("trade")]);
  drain(empty.engine, declineAll);
  assert.equal(handOf(empty.engine, P1).length, handBefore);
  assert.equal(empty.engine.state.result, undefined);
});

clause(TRADESMAU, "0:rule", "a depleted Tradesmau cannot block, so nothing is drawn; a face-down one is not a character", () => {
  const depleted = tradeBoard({ attackers: 2, tradeDepleted: true });
  tradeAttack(depleted, 2);
  const handBefore = handOf(depleted.engine, P1).length;
  refused(() => declareBlockers(depleted.engine, P1, [depleted.id("trade")]), "depleted characters cannot block");
  assert.equal(handOf(depleted.engine, P1).length, handBefore);
  declareBlockers(depleted.engine, P1, [depleted.id("plain")]);
  assert.deepEqual(battleOf(depleted.engine)?.blockingParty, [depleted.id("plain")], "control: an undepleted character can block");
  const faceDown = tradeBoard({ attackers: 2, tradeFaceDown: true });
  tradeAttack(faceDown, 2);
  refused(() => declareBlockers(faceDown.engine, P1, [faceDown.id("trade")]), "a face-down card is not a character");
  declareBlockers(faceDown.engine, P1, [faceDown.id("plain")]);
  assert.deepEqual(battleOf(faceDown.engine)?.blockingParty, [faceDown.id("plain")], "control: a character can block");
});

clause(TRADESMAU, "0:rule", "the trigger is part of the Tradesmau itself: in my hand it does nothing (it cannot block)", () => {
  const game = tradeBoard({ attackers: 2, trade: "hand" });
  tradeAttack(game, 2);
  const handBefore = handOf(game.engine, P1).length;
  declareBlockers(game.engine, P1, [game.id("plain")]);
  drain(game.engine, declineAll);
  assert.equal(handOf(game.engine, P1).length, handBefore);
});

// =================================================================================
// Prehensile Pirate
// COST: Remove 4 cards in your discard pile from the game.
// Character (pirate, mau), cost 4, [G][G], 3 strength / 3 speed / 5 life.
// =================================================================================

const PIRATE = "3969a272-2b6b-44b1-a95c-97303534163a";

function pirateBoard(opts: { discard?: number; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  const n = opts.discard ?? 6;
  const kinds: Array<() => CardDefinition> = [
    () => character({ name: "DiscChar" }),
    () => item({ name: "DiscItem" }),
    () => tactic({ name: "DiscTactic" }),
    () => location({ name: "DiscLocation" }),
    () => resourceCard({ name: "DiscResource" }),
    () => character({ name: "DiscChar2" })
  ];
  return devBoard(
    [
      { key: "pirate", def: printing(PIRATE), owner: P1, zone: "hand" },
      ...Array.from({ length: n }, (_, i) => ({ key: `dc${i}`, def: kinds[i % kinds.length](), owner: P1, zone: "discard" as const })),
      ...chars("odc", 5, P2, "discard"),
      ...chars("h", 2, P1, "hand"),
      ...chars("d", 3, P1, "deck"),
      { key: "inPlay", def: character({ name: "InPlay" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PirateGame = ReturnType<typeof pirateBoard>;
const piratePlayRaw = (game: PirateGame, keys: string[]) => playRaw(game.engine, P1, game.id("pirate"), { selected: { exile4: keys.map(game.id) } });
const piratePlay = (game: PirateGame, keys: string[]) => play(game.engine, P1, game.id("pirate"), { selected: { exile4: keys.map(game.id) } });

clause(PIRATE, "0:ability", "deploys for exactly its printed cost of 4 with [G][G] (one [G] or three resources is refused), and has its printed 3 strength / 3 speed / 5 life, pirate and mau", () => {
  const oneGreed = pirateBoard({ icons: { greed: 1, rage: 5 } });
  refused(() => piratePlayRaw(oneGreed, ["dc0", "dc1", "dc2", "dc3"]), "only one [G]");
  assert.equal(zoneOf(oneGreed.engine, oneGreed.id("pirate")), "hand");
  const short = pirateBoard({ icons: { greed: 3 } });
  refused(() => piratePlayRaw(short, ["dc0", "dc1", "dc2", "dc3"]), "3 resources: one short of 4");
  const { engine, id } = pirateBoard();
  const before = ready(engine);
  piratePlay({ engine, id } as PirateGame, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(before - ready(engine), 4, "exactly the printed cost of 4 (the removal is not a payment)");
  assert.equal(zoneOf(engine, id("pirate")), "play");
  assert.equal(engine.getStat(id("pirate"), "strength"), 3);
  assert.equal(engine.getStat(id("pirate"), "speed"), 3);
  assert.equal(engine.getStat(id("pirate"), "life"), 5);
  assert.deepEqual([...engine.getSubtypes(id("pirate"))].sort(), ["mau", "pirate"]);
});

clause(PIRATE, "0:ability", "the cost removes exactly the 4 chosen cards in my discard pile from the game (any card types), when the Pirate is played", () => {
  const game = pirateBoard();
  const { engine, id } = game;
  const picks = ["dc0", "dc1", "dc2", "dc3"];
  piratePlayRaw(game, picks);
  assert.ok(engine.state.responseWindow, "the response window is open");
  for (const key of picks) {
    assert.equal(zoneOf(engine, id(key)), "removed", `${key} is out of the game as a cost, before any response`);
    assert.ok(removedOf(engine, P1).includes(id(key)), "removedOf(engine, P1).includes(id(key))");
    assert.ok(!discardOf(engine, P1).includes(id(key)), "!discardOf(engine, P1).includes(id(key))");
  }
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("pirate")), "play");
  assert.equal(removedOf(engine, P1).length, 4, "exactly four cards were removed");
});

clause(PIRATE, "0:ability", "the cards I did not choose stay in my discard pile, and the opponent's discard pile is untouched", () => {
  const game = pirateBoard();
  const { engine, id } = game;
  const oppDiscard = discardOf(engine, P2);
  piratePlay(game, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(zoneOf(engine, id("dc4")), "discard");
  assert.equal(zoneOf(engine, id("dc5")), "discard");
  assert.equal(discardOf(engine, P1).length, 2);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
  assert.equal(removedOf(engine, P2).length, 0);
});

clause(PIRATE, "0:ability", "I choose WHICH four: choosing the last four leaves the first ones behind", () => {
  const game = pirateBoard();
  const { engine, id } = game;
  piratePlay(game, ["dc2", "dc3", "dc4", "dc5"]);
  assert.equal(zoneOf(engine, id("dc0")), "discard");
  assert.equal(zoneOf(engine, id("dc1")), "discard");
  for (const key of ["dc2", "dc3", "dc4", "dc5"]) assert.equal(zoneOf(engine, id(key)), "removed");
});

clause(PIRATE, "0:ability", "each card type can be removed: character, item, tactic, location and resource cards in the discard pile", () => {
  const game = pirateBoard({ discard: 5 });
  const { engine, id } = game;
  piratePlay(game, ["dc1", "dc2", "dc3", "dc4"]);
  assert.equal(zoneOf(engine, id("dc1")), "removed", "an item");
  assert.equal(zoneOf(engine, id("dc2")), "removed", "a tactic");
  assert.equal(zoneOf(engine, id("dc3")), "removed", "a location");
  assert.equal(zoneOf(engine, id("dc4")), "removed", "a resource card");
});

clause(PIRATE, "0:ability", "it cannot be played with fewer than 4 cards in my discard pile (even with every resource it needs)", () => {
  const game = pirateBoard({ discard: 3 });
  const { engine, id } = game;
  const before = ready(engine);
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2"]), "three cards cannot pay a cost of four");
  refused(() => playRaw(engine, P1, id("pirate")), "no picks at all");
  assert.equal(zoneOf(engine, id("pirate")), "hand");
  assert.equal(ready(engine), before, "nothing was paid");
  for (const key of ["dc0", "dc1", "dc2"]) assert.equal(zoneOf(engine, id(key)), "discard");
  const none = pirateBoard({ discard: 0 });
  refused(() => playRaw(none.engine, P1, none.id("pirate")), "an empty discard pile");
  const exact = pirateBoard({ discard: 4 });
  piratePlay(exact, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(zoneOf(exact.engine, exact.id("pirate")), "play", "control: exactly 4 cards is enough");
  assert.equal(discardOf(exact.engine, P1).length, 0);
});

clause(PIRATE, "0:ability", "exactly 4 must be chosen: 3 or 5 are refused, and so are duplicates", () => {
  const game = pirateBoard({ discard: 6 });
  const { engine, id } = game;
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2"]), "three");
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "dc3", "dc4"]), "five");
  refused(() => piratePlayRaw(game, ["dc0", "dc0", "dc1", "dc2"]), "the same card twice");
  assert.equal(zoneOf(engine, id("pirate")), "hand");
  for (let i = 0; i < 6; i++) assert.equal(zoneOf(engine, id(`dc${i}`)), "discard", "nothing was removed by a refused attempt");
  piratePlay(game, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(zoneOf(engine, id("pirate")), "play", "control: four distinct cards");
});

clause(PIRATE, "0:ability", "the cards must be in MY discard pile: the opponent's discard pile, my hand, my deck and cards in play are refused", () => {
  const game = pirateBoard({ discard: 3 });
  const { engine, id } = game;
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "odc0"]), "one card from the opponent's discard pile");
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "h0"]), "one card from my hand");
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "d0"]), "one card from my deck");
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "inPlay"]), "one card in play");
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "pirate"]), "the Pirate itself");
  assert.equal(zoneOf(engine, id("pirate")), "hand");
  assert.equal(zoneOf(engine, id("odc0")), "discard");
  for (const key of ["dc0", "dc1", "dc2"]) assert.equal(zoneOf(engine, id(key)), "discard");
  const four = pirateBoard({ discard: 4 });
  piratePlay(four, ["dc0", "dc1", "dc2", "dc3"]);
  assert.equal(zoneOf(four.engine, four.id("pirate")), "play", "control");
});

clause(PIRATE, "0:ability", "the Pirate pays its numeric cost too: with 4 discards but only 3 resources it is still refused, and nothing is removed", () => {
  const game = pirateBoard({ icons: { greed: 3 } });
  const { engine, id } = game;
  refused(() => piratePlayRaw(game, ["dc0", "dc1", "dc2", "dc3"]), "one resource short");
  for (const key of ["dc0", "dc1", "dc2", "dc3"]) assert.equal(zoneOf(engine, id(key)), "discard", "the cards were not removed by a refused play");
});

clause(PIRATE, "0:ability", "if the Pirate is terminated while being deployed, the removal was a cost and stays paid", () => {
  const game = pirateBoard({ extra: [{ key: "term", def: terminatorTactic(), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  piratePlayRaw(game, ["dc0", "dc1", "dc2", "dc3"]);
  respondWith(engine, P2, id("term"));
  assert.equal(zoneOf(engine, id("pirate")), "discard", "terminated: the Pirate went to the discard pile");
  for (const key of ["dc0", "dc1", "dc2", "dc3"]) assert.equal(zoneOf(engine, id(key)), "removed", `${key} stays removed`);
});

clause(PIRATE, "0:ability", "the Pirate itself is not in the discard pile when it is paid for, so it can't count as one of the four (and a later Pirate in the pile can)", () => {
  const game = pirateBoard({ discard: 3, extra: [{ key: "pirate2", def: printing(PIRATE), owner: P1, zone: "discard" }] });
  piratePlay(game, ["dc0", "dc1", "dc2", "pirate2"]);
  assert.equal(zoneOf(game.engine, game.id("pirate")), "play");
  assert.equal(zoneOf(game.engine, game.id("pirate2")), "removed", "another Pirate in the discard pile is just a card");
});

// =================================================================================
// Property Condemner
// When this card enters play, you may pick a location. If you do, destroy it.
// FLIP UP: 2 [G][G]
// Character (priest, mau), cost 4, [G][G], 2 strength / 4 speed / 2 life.
// =================================================================================

const CONDEMNER = "5c9f3b23-156b-4191-a722-d7e7c5dbf59b";

function condemnerBoard(
  opts: {
    cond?: "hand" | "faceDown" | "faceUp" | "discard";
    icons?: Icons;
    spentGreed?: number;
    condSpent?: boolean;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const cond = opts.cond ?? "hand";
  return devBoard(
    [
      {
        key: "cond",
        def: printing(CONDEMNER),
        owner: P1,
        zone: cond === "hand" ? "hand" : cond === "discard" ? "discard" : "play",
        faceDown: cond === "faceDown" ? true : undefined,
        attachedToKey: opts.condSpent ? "__factionA" : undefined
      },
      { key: "myPlace", def: location({ name: "MyPlace", structure: 7 }), owner: P1, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace", structure: 7 }), owner: P2, zone: "play" },
      { key: "foePlace2", def: location({ name: "FoePlace2", structure: 7 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      { key: "foeThing", def: item({ name: "FoeThing" }), owner: P2, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res(opts.icons ?? { greed: 6 }),
      ...spentRes("greed", P1, opts.spentGreed ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type CondGame = ReturnType<typeof condemnerBoard>;
const pickLocation = (game: CondGame, key: string | undefined) => {
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "the Condemner's controller picks");
  answerPending(game.engine, "chooserSelectsTarget", { selected: key ? [game.id(key)] : [] });
};

clause(CONDEMNER, "0:rule", "deploys for exactly its printed cost of 4 with [G][G]: refused one resource short and with one [G]; printed 2 strength / 4 speed / 2 life, priest and mau", () => {
  const short = condemnerBoard({ icons: { greed: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("cond")), "3 resources: one short of 4");
  const oneGreed = condemnerBoard({ icons: { greed: 1, rage: 5 } });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("cond")), "one [G]");
  const game = condemnerBoard({ icons: { greed: 5 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("cond"));
  pickLocation(game, undefined);
  assert.equal(before - ready(game.engine), 4);
  assert.equal(game.engine.getStat(game.id("cond"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("cond"), "speed"), 4);
  assert.equal(game.engine.getStat(game.id("cond"), "life"), 2);
  assert.deepEqual([...game.engine.getSubtypes(game.id("cond"))].sort(), ["mau", "priest"]);
});


clause(CONDEMNER, "0:rule", "when it enters play I may pick a location, and the picked location is destroyed (and only it)", () => {
  const game = condemnerBoard();
  const { engine, id } = game;
  play(engine, P1, id("cond"));
  pickLocation(game, "foePlace");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("foePlace")), "discard", "destroyed");
  assert.ok(discardOf(engine, P2).includes(id("foePlace")), "into its owner's discard pile");
  for (const key of ["foePlace2", "myPlace", "foeThing", "mine", "foe"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} stays`);
  assert.equal(zoneOf(engine, id("cond")), "play", "the Condemner stays");
});

clause(CONDEMNER, "0:rule", "the location may be one of MY OWN (it says 'a location')", () => {
  const game = condemnerBoard();
  play(game.engine, P1, game.id("cond"));
  pickLocation(game, "myPlace");
  assert.equal(zoneOf(game.engine, game.id("myPlace")), "discard");
  assert.equal(zoneOf(game.engine, game.id("foePlace")), "play");
});

clause(CONDEMNER, "0:rule", "it is a 'may': picking no location destroys nothing", () => {
  const game = condemnerBoard();
  const { engine, id } = game;
  play(engine, P1, id("cond"));
  pickLocation(game, undefined);
  assert.equal(engine.state.pendingChoice, undefined);
  for (const key of ["myPlace", "foePlace", "foePlace2"]) assert.equal(zoneOf(engine, id(key)), "play", `${key} survives`);
  assert.equal(zoneOf(engine, id("cond")), "play");
});

clause(CONDEMNER, "0:rule", "destroys the location whatever its structure or damage", () => {
  const game = condemnerBoard({ extra: [{ key: "fortress", def: location({ name: "Fortress", structure: 99 }), owner: P2, zone: "play" }] });
  play(game.engine, P1, game.id("cond"));
  pickLocation(game, "fortress");
  assert.equal(zoneOf(game.engine, game.id("fortress")), "discard");
});

clause(CONDEMNER, "0:rule", "only a LOCATION can be picked: a character, an item, a faction and a face-down card are refused; so are locations outside play", () => {
  const game = condemnerBoard({
    extra: [
      { key: "fd", def: location({ name: "FaceDownPlace" }), owner: P2, zone: "play", faceDown: true },
      { key: "handPlace", def: location({ name: "HandPlace" }), owner: P2, zone: "hand" },
      { key: "discardPlace", def: location({ name: "DiscardPlace" }), owner: P2, zone: "discard" },
      { key: "deckPlace", def: location({ name: "DeckPlace" }), owner: P2, zone: "deck" }
    ]
  });
  const { engine, id } = game;
  play(engine, P1, id("cond"));
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("foe")]), "a character");
  refused(tryPick(engine, P1, [id("mine")]), "my character");
  refused(tryPick(engine, P1, [id("foeThing")]), "an item");
  refused(tryPick(engine, P1, [engine.state.players[P2].factionId!]), "their faction");
  refused(tryPick(engine, P1, [id("cond")]), "the Condemner itself");
  refused(tryPick(engine, P1, [id("fd")]), "a face-down card");
  refused(tryPick(engine, P1, [id("handPlace")]), "a location in hand");
  refused(tryPick(engine, P1, [id("discardPlace")]), "a location in the discard pile");
  refused(tryPick(engine, P1, [id("deckPlace")]), "a location in the deck");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickLocation(game, "foePlace");
  assert.equal(zoneOf(engine, id("foePlace")), "discard", "control: a location in play is accepted");
});

clause(CONDEMNER, "0:rule", "at most one location: picking two is refused", () => {
  const game = condemnerBoard();
  const { engine, id } = game;
  play(engine, P1, id("cond"));
  refused(tryPick(engine, P1, [id("foePlace"), id("foePlace2")]), "two locations");
  refused(tryPick(engine, P1, [id("foePlace"), id("foePlace")]), "the same location twice");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
  assert.equal(zoneOf(engine, id("foePlace2")), "play");
  pickLocation(game, "foePlace2");
  assert.equal(zoneOf(engine, id("foePlace2")), "discard");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
});

clause(CONDEMNER, "0:rule", "with no location in play there is nothing to pick: it enters play and nothing is stuck", () => {
  const { engine, id } = devBoard([
    { key: "cond", def: printing(CONDEMNER), owner: P1, zone: "hand" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
    ...res({ greed: 5 })
  ]);
  play(engine, P1, id("cond"));
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("cond")), "play");
});

clause(CONDEMNER, "0:rule", "the pick happens when it enters play, not while it is being deployed (the opponent may still respond)", () => {
  const game = condemnerBoard();
  const { engine, id } = game;
  playRaw(engine, P1, id("cond"));
  assert.equal(engine.state.pendingChoice, undefined, "no pick yet: the card is still only being deployed");
  assert.equal(zoneOf(engine, id("cond")), "deploying");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
  resolvePendingResponses(engine);
  expectPending(engine, "chooserSelectsTarget");
  assert.equal(zoneOf(engine, id("cond")), "play");
});

clause(CONDEMNER, "0:rule", "if the Condemner is terminated while being deployed it never enters play: no location is picked or destroyed", () => {
  const game = condemnerBoard({ extra: [{ key: "term", def: terminatorTactic(), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  playRaw(engine, P1, id("cond"));
  respondWith(engine, P2, id("term"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("cond")), "discard");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
});

clause(CONDEMNER, "0:rule", "entering play by an effect (put into play, not deployed) still triggers it", () => {
  const raise = tactic({
    name: "Raise Character",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = condemnerBoard({ cond: "discard", extra: [{ key: "raise", def: raise, owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("raise"), { selected: { t: [id("cond")] } });
  assert.equal(zoneOf(engine, id("cond")), "play");
  pickLocation(game, "foePlace");
  assert.equal(zoneOf(engine, id("foePlace")), "discard");
});

clause(CONDEMNER, "0:rule", "played face-down as a resource it is only a resource: no pick, no destruction", () => {
  const game = condemnerBoard();
  const { engine, id } = game;
  developResource(engine, P1, id("cond"), true);
  assert.equal(engine.state.cards[id("cond")].faceDown, true);
  assert.equal(engine.state.pendingChoice, undefined, "a face-down card has no rules text (CR 411.1)");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
});

clause(CONDEMNER, "0:rule", "the opponent's Condemner is picked by THEM: they choose a location (mine included) and it is destroyed", () => {
  const game = condemnerBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "ocond", def: printing(CONDEMNER), owner: P2, zone: "hand" }, ...res({ greed: 5 }, P2)]
  });
  const { engine, id } = game;
  play(engine, P2, id("ocond"));
  const pc = expectPending(engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "its controller picks");
  answerPending(engine, "chooserSelectsTarget", { selected: [id("myPlace")] });
  assert.equal(zoneOf(engine, id("myPlace")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("myPlace")), "to its owner's discard pile");
});

// --- FLIP UP: 2 [G][G] ---

const flipCond = (game: CondGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("cond"));

clause(CONDEMNER, "1:flipUp", "flipping up pays exactly 2 with [G][G], turns it face-up into a character with its printed stats, and its enters-play pick follows", () => {
  const game = condemnerBoard({ cond: "faceDown", icons: { rage: 3 }, spentGreed: 2 });
  const { engine, id } = game;
  assert.equal(ready(engine), 4, "three rage banks and the face-down card itself");
  flipCond(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("cond")].faceDown, false, "face-up");
  assert.equal(zoneOf(engine, id("cond")), "play");
  assert.equal(ready(engine), 1, "2 paid, plus the face-down card itself stops being a resource (4 - 2 - 1)");
  assert.equal(engine.getStat(id("cond"), "strength"), 2);
  assert.equal(engine.getStat(id("cond"), "speed"), 4);
  assert.equal(engine.getStat(id("cond"), "life"), 2);
  assert.equal(engine.getDefinition(id("cond")).type, "character");
  pickLocation(game, "foePlace");
  assert.equal(zoneOf(engine, id("foePlace")), "discard", "entering play by FLIP UP triggers the pick (CR 411.3)");
});

clause(CONDEMNER, "1:flipUp", "the face-down card may pay for its own FLIP UP (CR 507.4b): one other ready resource plus the face-down card is exactly 2", () => {
  const game = condemnerBoard({ cond: "faceDown", icons: { rage: 1 }, spentGreed: 2 });
  const { engine, id } = game;
  assert.equal(ready(engine), 2, "one rage and the face-down card itself");
  flipCond(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("cond")].faceDown, false);
  assert.equal(ready(engine), 0);
  pickLocation(game, undefined);
});

clause(CONDEMNER, "1:flipUp", "is refused one resource short: with only the face-down card itself ready (cost 2) it cannot flip up", () => {
  const game = condemnerBoard({ cond: "faceDown", icons: {}, spentGreed: 2 });
  assert.equal(ready(game.engine), 1);
  refused(() => flipCond(game), "1 ready resource");
  assert.equal(game.engine.state.cards[game.id("cond")].faceDown, true, "still face-down");
  assert.equal(zoneOf(game.engine, game.id("cond")), "play");
});

clause(CONDEMNER, "1:flipUp", "needs [G][G]: one [G] with plenty of other resources is refused, two [G] are accepted", () => {
  const one = condemnerBoard({ cond: "faceDown", icons: { greed: 1, rage: 5 } });
  refused(() => flipCond(one), "only one [G]");
  assert.equal(one.engine.state.cards[one.id("cond")].faceDown, true);
  assert.equal(ready(one.engine), 7, "nothing was paid");
  const none = condemnerBoard({ cond: "faceDown", icons: { rage: 6 } });
  refused(() => flipCond(none), "no [G]");
  const two = condemnerBoard({ cond: "faceDown", icons: { greed: 2, rage: 4 } });
  flipCond(two);
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("cond")].faceDown, false, "control");
});

clause(CONDEMNER, "1:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn (in response), allowed on mine", () => {
  const theirTurn = condemnerBoard({ cond: "faceDown", turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk" }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(theirTurn.engine, P2, [theirTurn.id("atk")]);
  assert.equal(theirTurn.engine.state.priorityPlayerId, P1);
  refused(() => flipCond(theirTurn), "a character is only deployed on its controller's turn (CR 507.4d)");
  assert.equal(theirTurn.engine.state.cards[theirTurn.id("cond")].faceDown, true);
  const myTurn = condemnerBoard({ cond: "faceDown" });
  flipCond(myTurn);
  resolvePendingResponses(myTurn.engine);
  assert.equal(myTurn.engine.state.cards[myTurn.id("cond")].faceDown, false, "control: on my own turn it flips");
});

clause(CONDEMNER, "1:flipUp", "only a face-down Condemner I control can be flipped: face-up in play, in my hand, or the opponent's face-down one cannot", () => {
  const faceUp = condemnerBoard({ cond: "faceUp" });
  refused(() => flipCond(faceUp), "already face-up");
  const inHand = condemnerBoard({ cond: "hand" });
  refused(() => flipCond(inHand), "in hand");
  const theirs = condemnerBoard({ cond: "faceDown", turn: 2, active: P2, extra: res({ greed: 4 }, P2) });
  refused(() => flipCond(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("cond")].faceDown, true);
});

clause(CONDEMNER, "1:flipUp", "a flipped-up Condemner is a new card in play: it cannot attack the turn it was flipped up", () => {
  const game = condemnerBoard({ cond: "faceDown" });
  const { engine, id } = game;
  flipCond(game);
  resolvePendingResponses(engine);
  pickLocation(game, undefined);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("cond")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.battle, "control: a character that was already in play can attack");
});

// =================================================================================
// Prostitution Lobbyist
// FLIP UP: 0 [G]
// Character (politician, mau), cost 2, [G], 1 strength / 3 speed / 3 life.
// =================================================================================

const LOBBYIST = "f3b487f0-f76a-4a72-ad51-030fb5a96c90";

function lobbyBoard(
  opts: {
    lob?: "hand" | "faceDown" | "faceUp";
    lobSpent?: boolean;
    icons?: Icons;
    spentGreed?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const lob = opts.lob ?? "faceDown";
  return devBoard(
    [
      {
        key: "lob",
        def: printing(LOBBYIST),
        owner: P1,
        zone: lob === "hand" ? "hand" : "play",
        faceDown: lob === "faceDown" ? true : undefined,
        attachedToKey: opts.lobSpent ? "__factionA" : undefined
      },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...spentRes("greed", P1, opts.spentGreed ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type LobGame = ReturnType<typeof lobbyBoard>;
const flipLob = (game: LobGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("lob"));

clause(LOBBYIST, "0:flipUp", "a face-down Lobbyist that has already been spent (attached to my faction while paying for something) can still be flipped up: FLIP UP costs 0 and needs only [G]", () => {
  const game = lobbyBoard({ lobSpent: true, spentGreed: 1 });
  const { engine, id } = game;
  assert.equal(ready(engine), 0, "no resource is ready at all");
  flipLob(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("lob")].faceDown, false, "face-up");
  assert.equal(zoneOf(engine, id("lob")), "play");
  assert.equal(engine.getDefinition(id("lob")).type, "character");
});

clause(LOBBYIST, "0:flipUp", "flipping up costs nothing (0): a face-down Lobbyist with nothing else ready and only a spent [G] still flips up", () => {
  const game = lobbyBoard({ spentGreed: 1 });
  const { engine, id } = game;
  assert.equal(ready(engine), 1, "only the face-down Lobbyist itself is ready");
  flipLob(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("lob")].faceDown, false, "face-up");
  assert.equal(zoneOf(engine, id("lob")), "play");
  assert.equal(engine.getDefinition(id("lob")).type, "character");
  assert.equal(ready(engine), 0, "it stopped being a resource; nothing else was touched");
});

clause(LOBBYIST, "0:flipUp", "FLIP UP: 0 pays nothing: with plenty of ready resources none of them is spent", () => {
  const game = lobbyBoard({ icons: { greed: 3, rage: 2 } });
  const { engine, id } = game;
  assert.equal(ready(engine), 6, "five banks and the face-down Lobbyist");
  flipLob(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("lob")].faceDown, false);
  assert.equal(ready(engine), 5, "only the face-down card stopped being a resource: nothing was paid");
  assert.equal(attachedCount(engine, P1), 0, "no resource was attached to my faction");
});

clause(LOBBYIST, "0:flipUp", "the flipped-up Lobbyist is a face-up character with its printed 1 strength / 3 speed / 3 life, politician and mau", () => {
  const game = lobbyBoard({ icons: { greed: 1 } });
  const { engine, id } = game;
  flipLob(game);
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("lob"), "strength"), 1);
  assert.equal(engine.getStat(id("lob"), "speed"), 3);
  assert.equal(engine.getStat(id("lob"), "life"), 3);
  assert.deepEqual([...engine.getSubtypes(id("lob"))].sort(), ["mau", "politician"]);
});

clause(LOBBYIST, "0:flipUp", "needs [G]: plenty of other resources are not enough, and neither is its own Volition", () => {
  const none = lobbyBoard({ icons: { rage: 5 } });
  refused(() => flipLob(none), "no [G]");
  assert.equal(none.engine.state.cards[none.id("lob")].faceDown, true);
  const onlyItself = lobbyBoard({ icons: {} });
  refused(() => flipLob(onlyItself), "only the face-down card: Volition is not [G]");
  assert.equal(onlyItself.engine.state.cards[onlyItself.id("lob")].faceDown, true);
  const faceDowns = lobbyBoard({ extra: volition(3, P1) });
  refused(() => flipLob(faceDowns), "other face-down cards give Volition, not [G]");
  const opp = lobbyBoard({ icons: {}, extra: res({ greed: 4 }, P2) });
  refused(() => flipLob(opp), "the opponent's [G] is not mine");
  const one = lobbyBoard({ icons: { greed: 1 } });
  flipLob(one);
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("lob")].faceDown, false, "control: one [G]");
});

clause(LOBBYIST, "0:flipUp", "a spent [G] still meets the threshold (control, not availability)", () => {
  const game = lobbyBoard({ icons: {}, spentGreed: 1 });
  flipLob(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("lob")].faceDown, false);
});

clause(LOBBYIST, "0:flipUp", "FLIP UP does not change when a character can be deployed: refused on the opponent's turn, allowed on mine", () => {
  const theirTurn = lobbyBoard({ icons: { greed: 1 }, turn: 2, active: P2 });
  declareAttackOpenWindow(theirTurn.engine, P2, [theirTurn.id("foe")]);
  refused(() => flipLob(theirTurn), "a character is only deployed on its controller's turn (CR 507.4d)");
  assert.equal(theirTurn.engine.state.cards[theirTurn.id("lob")].faceDown, true);
  const myTurn = lobbyBoard({ icons: { greed: 1 } });
  flipLob(myTurn);
  resolvePendingResponses(myTurn.engine);
  assert.equal(myTurn.engine.state.cards[myTurn.id("lob")].faceDown, false, "control");
});

clause(LOBBYIST, "0:flipUp", "only a face-down Lobbyist I control can be flipped: face-up, in hand, or the opponent's cannot", () => {
  const faceUp = lobbyBoard({ lob: "faceUp", icons: { greed: 1 } });
  refused(() => flipLob(faceUp), "already face-up");
  const inHand = lobbyBoard({ lob: "hand", icons: { greed: 1 } });
  refused(() => flipLob(inHand), "in hand");
  const theirs = lobbyBoard({ icons: { greed: 1 }, turn: 2, active: P2, extra: res({ greed: 2 }, P2) });
  refused(() => flipLob(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("lob")].faceDown, true);
});

clause(LOBBYIST, "0:flipUp", "it is a new card entering play (CR 411.3): the flipped-up Lobbyist cannot attack that turn", () => {
  const game = lobbyBoard({ icons: { greed: 1 } });
  const { engine, id } = game;
  flipLob(game);
  resolvePendingResponses(engine);
  refused(() => engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("lob")], target: { type: "faction", playerId: P2 } }), "it entered play this turn");
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  assert.ok(engine.state.battle, "control: a character that was already in play can attack");
});

clause(LOBBYIST, "0:flipUp", "flipping it up is a way to play it for less: from the hand the Lobbyist costs its printed 2 + [G]", () => {
  const hand = lobbyBoard({ lob: "hand", icons: { greed: 3 }, turn: 1, active: P1 });
  const before = ready(hand.engine);
  play(hand.engine, P1, hand.id("lob"));
  assert.equal(before - ready(hand.engine), 2, "from the hand it costs 2");
  const short = lobbyBoard({ lob: "hand", icons: { greed: 1 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("lob")), "from the hand one resource is short of 2");
});

// --- FLIP UP of a face-down card that has already been spent paying for something (the engine refuses: "A resource attached to your faction cannot be flipped up.") ---

clause(ROADBLOCK, "1:flipUp", "a face-down Roadblock that was already spent (attached to my faction) paying for something can still be flipped up, paying the 1 with another resource", () => {
  const game = roadblockBoard({ rb: "faceDown", rbSpent: true, icons: { greed: 1 } });
  const { engine, id } = game;
  assert.equal(ready(engine), 1, "one ready [G]; the face-down Roadblock itself is spent");
  rbAttack(game);
  flipRoadblock(game);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("rb")), "discard", "it was flipped up and resolved");
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START, "the battle damage was reduced to 0");
});

clause(CONDEMNER, "1:flipUp", "a face-down Condemner that was already spent (attached to my faction) paying for something can still be flipped up, paying the 2 with other resources", () => {
  const game = condemnerBoard({ cond: "faceDown", condSpent: true, icons: { greed: 2 } });
  const { engine, id } = game;
  assert.equal(ready(engine), 2, "two ready [G]; the face-down Condemner itself is spent");
  flipCond(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("cond")].faceDown, false, "face-up");
  assert.equal(ready(engine), 0, "2 paid");
  pickLocation(game, undefined);
});

// =================================================================================
// Purifying Priest
// BANISH -- COST: Pick a location. -- EFFECT: The next 1 damage inflicted to your faction
// this turn is inflicted to the location instead.
// Character (priest, mau), cost 4, [G], 2 strength / 3 speed / 4 life.
// =================================================================================

const PRIEST = "9108759f-9c6f-457d-a162-6fbf1204757c";

function priestBoard(
  opts: { priest?: "play" | "hand"; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "priest", def: printing(PRIEST), owner: P1, zone: opts.priest ?? "play" },
      { key: "myPlace", def: location({ name: "MyPlace", structure: 5 }), owner: P1, zone: "play" },
      { key: "foePlace", def: location({ name: "FoePlace", structure: 5 }), owner: P2, zone: "play" },
      { key: "tiny", def: location({ name: "Tiny", structure: 1 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe2", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
      { key: "selfHurt3", def: factionZap("SelfHurt3", 3, "controller"), owner: P1, zone: "hand" },
      { key: "selfHurt1", def: factionZap("SelfHurt1", 1, "controller"), owner: P1, zone: "hand" },
      { key: "theirHurt3", def: factionZap("TheirHurt3", 3, "opponent"), owner: P2, zone: "hand" },
      { key: "theirHurt1", def: factionZap("TheirHurt1", 1, "opponent"), owner: P2, zone: "hand" },
      { key: "hurtThem2", def: factionZap("HurtThem2", 2, "opponent"), owner: P1, zone: "hand" },
      ...chars("d", 3, P1, "deck"),
      ...res(opts.icons ?? { greed: 4 }),
      ...res({ greed: 4 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PriestGame = ReturnType<typeof priestBoard>;
const banish = (game: PriestGame, place: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("priest"), "banish", { selected: { l: [game.id(place)] } });
const banishRaw = (game: PriestGame, place: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("priest"), "banish", { l: [game.id(place)] });

clause(PRIEST, "0:ability:banish", "deploys for exactly its printed cost of 4 with [G]: one resource short and no [G] are refused; printed 2 strength / 3 speed / 4 life, priest and mau", () => {
  const short = priestBoard({ priest: "hand", icons: { greed: 3 } });
  refused(() => playRaw(short.engine, P1, short.id("priest")), "3 resources: one short of 4");
  const noGreed = priestBoard({ priest: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("priest")), "no [G]");
  const game = priestBoard({ priest: "hand", icons: { greed: 5 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("priest"));
  assert.equal(before - ready(game.engine), 4);
  assert.equal(game.engine.getStat(game.id("priest"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("priest"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("priest"), "life"), 4);
  assert.deepEqual([...game.engine.getSubtypes(game.id("priest"))].sort(), ["mau", "priest"]);
});

clause(PRIEST, "0:ability:banish", "using it costs nothing but the pick: no resource is paid and the Priest is not depleted", () => {
  const game = priestBoard({ icons: {} });
  const { engine, id } = game;
  assert.equal(ready(engine), 0, "no resources at all");
  banish(game, "foePlace");
  assert.equal(isDepleted(engine, id("priest")), false, "there is no deplete cost");
  assert.equal(engine.state.pendingChoice, undefined);
  banish(game, "foePlace");
  banish(game, "myPlace");
  assert.equal(isDepleted(engine, id("priest")), false, "and it can be used again and again");
});

clause(PRIEST, "0:ability:banish", "the next 1 damage to my faction goes to the location: a 3-damage hit costs my faction only 2 influence and the location takes 1", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "foePlace");
  play(engine, P1, id("selfHurt3"));
  assert.equal(influenceOf(engine, P1), START - 2, "only 2 of the 3 damage reached my faction");
  assert.equal(damageOf(engine, id("foePlace")), 1, "the location took the 1 redirected damage");
  assert.equal(zoneOf(engine, id("foePlace")), "play");
});

clause(PRIEST, "0:ability:banish", "a 1-damage hit is redirected in full: my faction loses nothing", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "myPlace");
  play(engine, P1, id("selfHurt1"));
  assert.equal(influenceOf(engine, P1), START, "no influence lost");
  assert.equal(damageOf(engine, id("myPlace")), 1, "the picked location (mine) took it");
});

clause(PRIEST, "0:ability:banish", "only the NEXT 1 damage: once it has been redirected, later damage hits my faction normally", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "foePlace");
  play(engine, P1, id("selfHurt1"));
  assert.equal(influenceOf(engine, P1), START);
  play(engine, P1, id("selfHurt3"));
  assert.equal(influenceOf(engine, P1), START - 3, "the second hit is not redirected at all");
  assert.equal(damageOf(engine, id("foePlace")), 1, "the location took only the one point");
});

clause(PRIEST, "0:ability:banish", "used twice, it redirects the next 2 damage (one point per use); a third point goes to my faction", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "foePlace");
  banish(game, "foePlace");
  play(engine, P1, id("selfHurt3"));
  assert.equal(influenceOf(engine, P1), START - 1, "two points were redirected, one reached my faction");
  assert.equal(damageOf(engine, id("foePlace")), 2);
});

clause(PRIEST, "0:ability:banish", "two uses on two locations send one point to each", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "foePlace");
  banish(game, "myPlace");
  play(engine, P1, id("selfHurt3"));
  assert.equal(influenceOf(engine, P1), START - 1);
  assert.equal(damageOf(engine, id("foePlace")) + damageOf(engine, id("myPlace")), 2, "two points in all");
  assert.equal(damageOf(engine, id("foePlace")), 1);
  assert.equal(damageOf(engine, id("myPlace")), 1);
});

clause(PRIEST, "0:ability:banish", "the redirected damage is real damage to the location: a location with structure 1 is destroyed by it", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "tiny");
  play(engine, P1, id("selfHurt1"));
  assert.equal(zoneOf(engine, id("tiny")), "discard", "1 damage meets its structure of 1");
  assert.equal(influenceOf(engine, P1), START);
});

clause(PRIEST, "0:ability:banish", "without BANISH the same 3 damage costs 3 influence (control)", () => {
  const game = priestBoard();
  play(game.engine, P1, game.id("selfHurt3"));
  assert.equal(influenceOf(game.engine, P1), START - 3);
});

clause(PRIEST, "0:ability:banish", "the opponent's damage to my faction is redirected too: their tactic dealing 3 on their turn costs me 2 and the location 1", () => {
  const game = priestBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe2")]);
  actRaw(engine, P1, id("priest"), "banish", { l: [id("foePlace")] });
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("mine")]);
  autoResolveBattle(engine);
  play(engine, P2, id("theirHurt3"));
  assert.equal(influenceOf(engine, P1), START - 2);
  assert.equal(damageOf(engine, id("foePlace")), 1);
});

clause(PRIEST, "0:ability:banish", "battle damage to my faction is redirected: a 3-strength unblocked attacker costs me 2 influence and the location takes 1", () => {
  const game = priestBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  actRaw(engine, P1, id("priest"), "banish", { l: [id("myPlace")] });
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START - 2);
  assert.equal(damageOf(engine, id("myPlace")), 1);
});

clause(PRIEST, "0:ability:banish", "only damage to MY faction: damage to my characters and to the opponent's faction is not redirected, and does not use the redirect up", () => {
  const game = priestBoard({ extra: [{ key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  banish(game, "foePlace");
  play(engine, P1, id("z2"), { selected: { t: [id("mine")] } });
  assert.equal(damageOf(engine, id("mine")), 2, "my character took all of its damage");
  assert.equal(damageOf(engine, id("foePlace")), 0, "nothing was redirected");
  play(engine, P1, id("hurtThem2"));
  assert.equal(influenceOf(engine, P2), START - 2, "the opponent's faction took all of its damage");
  assert.equal(damageOf(engine, id("foePlace")), 0);
  play(engine, P1, id("selfHurt1"));
  assert.equal(influenceOf(engine, P1), START, "the redirect was still available for my faction");
  assert.equal(damageOf(engine, id("foePlace")), 1);
});

clause(PRIEST, "0:ability:banish", "losing influence is not damage: a direct 'loses influence' effect neither is redirected nor uses the redirect up", () => {
  const drain1 = tactic({
    name: "Drain",
    cost: 0,
    behavior: { abilities: [{ id: "drain", type: "activated", effects: [{ type: "modifyInfluence", player: "controller", amount: -2 }] }] }
  });
  const game = priestBoard({ extra: [{ key: "drain", def: drain1, owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  banish(game, "foePlace");
  play(engine, P1, id("drain"));
  assert.equal(influenceOf(engine, P1), START - 2, "the influence loss is not damage");
  assert.equal(damageOf(engine, id("foePlace")), 0);
  play(engine, P1, id("selfHurt1"));
  assert.equal(damageOf(engine, id("foePlace")), 1, "the redirect is still there for real damage");
  assert.equal(influenceOf(engine, P1), START - 2);
});

clause(PRIEST, "0:ability:banish", "'this turn': an unused redirect is gone when the turn ends", () => {
  const game = priestBoard();
  const { engine, id } = game;
  banish(game, "foePlace");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  play(engine, P2, id("theirHurt3"));
  assert.equal(influenceOf(engine, P1), START - 3, "the redirect expired at the end of my turn");
  assert.equal(damageOf(engine, id("foePlace")), 0);
});

clause(PRIEST, "0:ability:banish", "the pick must be a location in play: a character, an item, a faction, a face-down card and locations outside play are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "fd", def: location({ name: "FaceDownPlace" }), owner: P2, zone: "play", faceDown: true },
    { key: "handPlace", def: location({ name: "HandPlace" }), owner: P1, zone: "hand" },
    { key: "discardPlace", def: location({ name: "DiscardPlace" }), owner: P1, zone: "discard" }
  ];
  for (const [key, why] of [
    ["mine", "my character"],
    ["foe", "their character"],
    ["thing", "an item"],
    ["priest", "the Priest itself"],
    ["fd", "a face-down card"],
    ["handPlace", "a location in my hand"],
    ["discardPlace", "a location in my discard pile"]
  ] as const) {
    const game = priestBoard({ extra: extras() });
    refused(() => banishRaw(game, key), why);
  }
  const faction = priestBoard();
  refused(() => actRaw(faction.engine, P1, faction.id("priest"), "banish", { l: [faction.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => actRaw(faction.engine, P1, faction.id("priest"), "banish", { l: [faction.engine.state.players[P2].factionId!] }), "their faction");
  const good = priestBoard({ extra: extras() });
  banish(good, "foePlace");
  play(good.engine, P1, good.id("selfHurt1"));
  assert.equal(damageOf(good.engine, good.id("foePlace")), 1, "control: a location in play is accepted and receives the damage");
});

clause(PRIEST, "0:ability:banish", "needs exactly one location: none or two are refused, and with no location in play it cannot be used", () => {
  const game = priestBoard();
  refused(() => actRaw(game.engine, P1, game.id("priest"), "banish", {}), "no pick");
  refused(() => actRaw(game.engine, P1, game.id("priest"), "banish", { l: [] }), "an empty pick");
  refused(() => actRaw(game.engine, P1, game.id("priest"), "banish", { l: [game.id("foePlace"), game.id("myPlace")] }), "two picks");
  const none = devBoard([
    { key: "priest", def: printing(PRIEST), owner: P1, zone: "play" },
    { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" }
  ]);
  refused(() => actRaw(none.engine, P1, none.id("priest"), "banish", {}), "no location exists");
});

clause(PRIEST, "0:ability:banish", "only the Priest's controller can use it: the opponent cannot", () => {
  const game = priestBoard({ turn: 2, active: P2 });
  refused(() => banishRaw(game, "foePlace", P2), "not its controller");
  play(game.engine, P2, game.id("theirHurt1"));
  assert.equal(influenceOf(game.engine, P1), START - 1, "no redirect was set up");
});

clause(PRIEST, "0:ability:banish", "it is an in-play ability: from my hand it cannot be used", () => {
  const game = priestBoard({ priest: "hand" });
  refused(() => banishRaw(game, "foePlace"), "Priest in hand");
});

// =================================================================================
// Scintillating Chamber Pot
// TANTALIZE -- COST: Pay 1. Deplete this card. Pick a character. -- EFFECT: This turn, reduce
// all damage the character inflicts to your faction to 0. The character cannot be restored
// until the start of your next turn.
// Item (banker), cost 2, [G].
// =================================================================================

const POT = "be3ec86a-1535-4fbf-a293-777c47743caa";

/** A character with two free abilities: BURN deals 2 damage to the opponent's faction, SCORCH deals 2 damage to one picked character. */
const pyroChar = (name: string): CardDefinition =>
  character({
    name,
    strength: 3,
    life: 6,
    speed: 2,
    behavior: {
      abilities: [
        { id: "burn", type: "activated", effects: [{ type: "dealDamage", target: { type: "factionOf", player: "opponent" }, amount: 2 }] },
        {
          id: "scorch",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        }
      ]
    }
  });

function potBoard(
  opts: { pot?: "play" | "hand"; potDepleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "pot", def: printing(POT), owner: P1, zone: opts.pot ?? "play", depleted: opts.potDepleted },
      { key: "mine", def: pyroChar("MyPyro"), owner: P1, zone: "play" },
      { key: "foe", def: pyroChar("FoePyro"), owner: P2, zone: "play" },
      { key: "foe2", def: pyroChar("FoePyro2"), owner: P2, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 9, speed: 1 }), owner: P1, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res(opts.icons ?? { greed: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PotGame = ReturnType<typeof potBoard>;
const tantalize = (game: PotGame, target: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("pot"), "tantalize", { selected: { c: [game.id(target)] } });
const tantalizeRaw = (game: PotGame, target: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("pot"), "tantalize", { c: [game.id(target)] });

clause(POT, "0:ability:tantalize", "deploys for exactly its printed cost of 2 with [G]: one resource short and no [G] are refused", () => {
  const short = potBoard({ pot: "hand", icons: { greed: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("pot")), "1 resource: one short of 2");
  const noGreed = potBoard({ pot: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("pot")), "no [G]");
  const game = potBoard({ pot: "hand", icons: { greed: 4 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("pot"));
  assert.equal(before - ready(game.engine), 2);
  assert.equal(game.engine.getDefinition(game.id("pot")).type, "item");
});

clause(POT, "0:ability:tantalize", "pays exactly 1 and depletes the Pot as the cost (immediately); the picked character is not otherwise changed", () => {
  const game = potBoard();
  const { engine, id } = game;
  const before = ready(engine);
  tantalizeRaw(game, "foe");
  assert.equal(before - ready(engine), 1, "Pay 1");
  assert.equal(isDepleted(engine, id("pot")), true, "Deplete this card");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.getStat(id("foe"), "strength"), 3, "its strength is unchanged");
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(POT, "0:ability:tantalize", "the picked attacker's battle damage to my faction is reduced to 0: an unblocked attack costs no influence", () => {
  const game = potBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  actRaw(engine, P1, id("pot"), "tantalize", { c: [id("foe")] });
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START, "the 3 damage was reduced to 0");
  const control = potBoard({ turn: 2, active: P2 });
  declareAttackBy(control.engine, P2, [control.id("foe")]);
  declareBlockers(control.engine, P1, []);
  autoResolveBattle(control.engine);
  assert.equal(influenceOf(control.engine, P1), START - 3, "control: without the Pot the same attack costs 3");
});

clause(POT, "0:ability:tantalize", "it reduces only the picked character's damage: in a party, another attacker still hurts my faction", () => {
  const game = potBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe"), id("foe2")]);
  actRaw(engine, P1, id("pot"), "tantalize", { c: [id("foe")] });
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START - 3, "foe2's 3 damage still lands; foe's 3 was reduced to 0");
});

clause(POT, "0:ability:tantalize", "'all damage': a non-battle damage ability of the picked character against my faction is reduced to 0 as well", () => {
  const game = potBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  actRaw(engine, P2, id("foe"), "burn");
  assert.equal(engine.state.priorityPlayerId, P1, "I may respond to their ability");
  actRaw(engine, P1, id("pot"), "tantalize", { c: [id("foe")] });
  resolvePendingResponses(engine);
  assert.equal(influenceOf(engine, P1), START, "FoePyro's BURN dealt 0");
  const control = potBoard({ turn: 2, active: P2 });
  activate(control.engine, P2, control.id("foe2"), "burn");
  assert.equal(influenceOf(control.engine, P1), START - 2, "control: an unpicked character's BURN deals its 2");
});

clause(POT, "0:ability:tantalize", "only damage to MY FACTION is reduced: the picked character still damages my characters", () => {
  const game = potBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  actRaw(engine, P2, id("foe"), "scorch", { t: [id("blk")] });
  actRaw(engine, P1, id("pot"), "tantalize", { c: [id("foe")] });
  resolvePendingResponses(engine);
  assert.equal(damageOf(engine, id("blk")), 2, "damage to a character is not reduced");
});

clause(POT, "0:ability:tantalize", "in a battle it only protects my faction: the picked attacker still damages a blocker of mine", () => {
  const game = potBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  actRaw(engine, P1, id("pot"), "tantalize", { c: [id("foe")] });
  resolveOneResponse(engine, P2);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("blk")), 3, "the blocker took the attacker's full damage");
});

clause(POT, "0:ability:tantalize", "damage the picked character inflicts to the OPPONENT's faction is unaffected (it only reduces damage to my faction)", () => {
  const game = potBoard();
  const { engine, id } = game;
  tantalize(game, "mine");
  activate(engine, P1, id("mine"), "burn");
  assert.equal(influenceOf(engine, P2), START - 2, "my picked character's BURN against their faction still deals 2");
});

clause(POT, "0:ability:tantalize", "'this turn': the reduction is gone next turn: the same character's attack then hurts my faction again", () => {
  const game = potBoard({ turn: 1, active: P1 });
  const { engine, id } = game;
  tantalize(game, "foe");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  declareAttackBy(engine, P2, [id("foe")]);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START - 3, "no longer reduced");
});

clause(POT, "0:ability:tantalize", "the picked character cannot be restored until the start of my next turn: their depleted character stays depleted at the start of THEIR turn", () => {
  const game = potBoard({ turn: 1, active: P1, extra: [{ key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play", depleted: true }] });
  const { engine, id } = game;
  tantalize(game, "tired");
  assert.equal(isDepleted(engine, id("tired")), true);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("tired")), true, "their restore rule did not restore it");
  const control = potBoard({ turn: 1, active: P1, extra: [{ key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play", depleted: true }] });
  endTurn(control.engine, P1);
  assert.equal(isDepleted(control.engine, control.id("tired")), false, "control: without the Pot it is restored at the start of their turn");
});

clause(POT, "0:ability:tantalize", "the restriction ends at the start of my next turn: the opponent's character is restored normally at the start of their following turn", () => {
  const game = potBoard({ turn: 1, active: P1, extra: [{ key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 1 }), owner: P2, zone: "play", depleted: true }] });
  const { engine, id } = game;
  tantalize(game, "tired");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my next turn has begun");
  assert.equal(isDepleted(engine, id("tired")), true, "my restore rule does not restore their character");
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(isDepleted(engine, id("tired")), false, "at the start of their next turn it is restored again");
});

clause(POT, "0:ability:tantalize", "it cannot be restored by an effect either, until the start of my next turn", () => {
  const restorer = tactic({
    name: "Restorer",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "res",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "restore", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const make = () =>
    potBoard({
      extra: [
        { key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play", depleted: true },
        { key: "restorer", def: restorer, owner: P1, zone: "hand" }
      ]
    });
  const control = make();
  play(control.engine, P1, control.id("restorer"), { selected: { t: [control.id("tired")] } });
  assert.equal(isDepleted(control.engine, control.id("tired")), false, "control: the restore effect works normally");
  const game = make();
  tantalize(game, "tired");
  play(game.engine, P1, game.id("restorer"), { selected: { t: [game.id("tired")] } });
  assert.equal(isDepleted(game.engine, game.id("tired")), true, "the picked character cannot be restored");
});

clause(POT, "0:ability:tantalize", "my own character can be picked too: it is restored normally at the start of my next turn (the restriction ends at that moment)", () => {
  const game = potBoard({ turn: 1, active: P1, extra: [{ key: "tired", def: character({ name: "Tired", strength: 2, life: 4, speed: 1 }), owner: P1, zone: "play", depleted: true }] });
  const { engine, id } = game;
  tantalize(game, "tired");
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("tired")), false, "restored at the start of my next turn");
});

clause(POT, "0:ability:tantalize", "the pick must be a character in play: an item, a location, a faction, a face-down card and cards outside play are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
    { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" }
  ];
  for (const [key, why] of [
    ["thing", "an item"],
    ["place", "a location"],
    ["fd", "a face-down card"],
    ["inHand", "a character in hand"],
    ["inDiscard", "a character in the discard pile"]
  ] as const) {
    const game = potBoard({ extra: extras() });
    const before = ready(game.engine);
    refused(() => tantalizeRaw(game, key), why);
    assert.equal(isDepleted(game.engine, game.id("pot")), false, `${why}: not depleted`);
    assert.equal(ready(game.engine), before, `${why}: nothing paid`);
  }
  const faction = potBoard();
  refused(() => actRaw(faction.engine, P1, faction.id("pot"), "tantalize", { c: [faction.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(faction.engine, P1, faction.id("pot"), "tantalize", {}), "no pick");
  refused(() => actRaw(faction.engine, P1, faction.id("pot"), "tantalize", { c: [faction.id("foe"), faction.id("foe2")] }), "two picks");
  const good = potBoard({ extra: extras() });
  tantalize(good, "foe");
  assert.equal(isDepleted(good.engine, good.id("pot")), true, "control: a character is accepted");
});

clause(POT, "0:ability:tantalize", "is refused with no resource to pay 1 and when the Pot is already depleted; works again after it is restored", () => {
  const none = potBoard({ icons: {} });
  refused(() => tantalizeRaw(none, "foe"), "no resources");
  assert.equal(isDepleted(none.engine, none.id("pot")), false);
  const depleted = potBoard({ potDepleted: true });
  refused(() => tantalizeRaw(depleted, "foe"), "the Pot is depleted");
  assert.equal(ready(depleted.engine), 3, "nothing was paid");
  const game = potBoard();
  tantalize(game, "foe");
  refused(() => tantalizeRaw(game, "foe2"), "depleted by the first use");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(isDepleted(game.engine, game.id("pot")), false, "restored at the start of my turn");
  tantalize(game, "foe2");
  assert.equal(isDepleted(game.engine, game.id("pot")), true);
});

clause(POT, "0:ability:tantalize", "only the Pot's controller can use it, and only while it is in play", () => {
  const theirs = potBoard({ turn: 2, active: P2, extra: res({ greed: 3 }, P2) });
  refused(() => tantalizeRaw(theirs, "foe", P2), "not its controller");
  const inHand = potBoard({ pot: "hand" });
  refused(() => tantalizeRaw(inHand, "foe"), "the Pot is in my hand");
});

// =================================================================================
// Slick Orator
// RECUR: [G][G] -- COST: Use this only if this card is in your discard pile. Remove this
// card from the game. -- EFFECT: Draw a card.
// Character (politician, mau), cost 3, [G][G], 1 strength / 2 speed / 4 life.
// =================================================================================

const ORATOR = "a0265ee4-8de2-46c6-b840-7b04ffdaae66";

function oratorBoard(opts: { orator?: "hand" | "discard" | "deck" | "play" | "removed"; icons?: Icons; deck?: number; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}) {
  return devBoard(
    [
      { key: "orator", def: printing(ORATOR), owner: P1, zone: opts.orator ?? "discard" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", opts.deck ?? 5, P1, "deck"),
      ...chars("h", 2, P1, "hand"),
      ...chars("od", 3, P2, "deck"),
      ...res(opts.icons ?? { greed: 2 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type OratorGame = ReturnType<typeof oratorBoard>;
const oratorRecurRaw = (game: OratorGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("orator"), "recur");

clause(ORATOR, "0:ability:recur", "deploys for exactly its printed cost of 3 with [G][G]: one [G] or two resources is refused; printed 1 strength / 2 speed / 4 life, politician and mau", () => {
  const short = oratorBoard({ orator: "hand", icons: { greed: 2 } });
  refused(() => playRaw(short.engine, P1, short.id("orator")), "2 resources: one short of 3");
  const oneGreed = oratorBoard({ orator: "hand", icons: { greed: 1, rage: 5 } });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("orator")), "one [G]");
  const game = oratorBoard({ orator: "hand", icons: { greed: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("orator"));
  assert.equal(before - ready(game.engine), 3);
  assert.equal(game.engine.getStat(game.id("orator"), "strength"), 1);
  assert.equal(game.engine.getStat(game.id("orator"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("orator"), "life"), 4);
  assert.deepEqual([...game.engine.getSubtypes(game.id("orator"))].sort(), ["mau", "politician"]);
});

clause(ORATOR, "0:ability:recur", "from the discard pile: removes the Orator from the game as the cost, pays NO resources, and draws exactly one card", () => {
  const game = oratorBoard();
  const { engine, id } = game;
  const before = ready(engine);
  const top = deckOf(engine, P1)[0];
  const next = deckOf(engine, P1)[1];
  const handBefore = handOf(engine, P1).length;
  oratorRecurRaw(game);
  assert.equal(zoneOf(engine, id("orator")), "removed", "Remove this card from the game is a cost");
  assert.ok(removedOf(engine, P1).includes(id("orator")), "removedOf(engine, P1).includes(id(\"orator\"))");
  assert.equal(handOf(engine, P1).length, handBefore, "nothing drawn yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card drawn");
  assert.equal(zoneOf(engine, top), "hand");
  assert.equal(zoneOf(engine, next), "deck");
  assert.equal(ready(engine), before, "no resource was paid: [G][G] is a threshold, not a cost");
  assert.equal(attachedCount(engine, P1), 0);
});

clause(ORATOR, "0:ability:recur", "the opponent's deck and hand are untouched", () => {
  const game = oratorBoard();
  const oppHand = handOf(game.engine, P2);
  const oppDeck = deckOf(game.engine, P2);
  activate(game.engine, P1, game.id("orator"), "recur");
  assert.deepEqual(handOf(game.engine, P2), oppHand);
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
});

clause(ORATOR, "0:ability:recur", "RECUR: [G][G] needs two [G]: one [G] among many other resources is refused; two [G] are accepted (and still nothing is spent)", () => {
  const one = oratorBoard({ icons: { greed: 1, rage: 5 } });
  refused(() => oratorRecurRaw(one), "one [G]");
  assert.equal(zoneOf(one.engine, one.id("orator")), "discard", "not removed");
  const none = oratorBoard({ icons: { rage: 6 } });
  refused(() => oratorRecurRaw(none), "no [G]");
  const noResources = oratorBoard({ icons: {} });
  refused(() => oratorRecurRaw(noResources), "no resources");
  const two = oratorBoard({ icons: { greed: 2 } });
  activate(two.engine, P1, two.id("orator"), "recur");
  assert.equal(zoneOf(two.engine, two.id("orator")), "removed", "control");
  assert.equal(ready(two.engine), 2, "both [G] are still ready: a threshold is not spent");
});

clause(ORATOR, "0:ability:recur", "spent [G] still meet the threshold (control, not availability)", () => {
  const game = oratorBoard({ icons: {}, extra: spentRes("greed", P1, 2) });
  activate(game.engine, P1, game.id("orator"), "recur");
  assert.equal(zoneOf(game.engine, game.id("orator")), "removed");
});

clause(ORATOR, "0:ability:recur", "'use this only if this card is in your discard pile': refused from the hand, the deck, in play and once removed", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const game = oratorBoard({ orator: zone });
    const handBefore = handOf(game.engine, P1).length;
    refused(() => oratorRecurRaw(game), `the Orator is in ${zone}`);
    assert.equal(zoneOf(game.engine, game.id("orator")), zone);
    assert.equal(handOf(game.engine, P1).length, handBefore);
  }
  const ok = oratorBoard();
  oratorRecurRaw(ok);
  assert.equal(zoneOf(ok.engine, ok.id("orator")), "removed", "control: from the discard pile it works");
});

clause(ORATOR, "0:ability:recur", "'your discard pile': the opponent's Orator in THEIR discard pile cannot be recurred by me, and mine cannot be recurred by them", () => {
  const game = oratorBoard({ extra: [{ key: "oorator", def: printing(ORATOR), owner: P2, zone: "discard" }, ...res({ greed: 2 }, P2), ...chars("odd", 2, P2, "deck")] });
  refused(() => actRaw(game.engine, P1, game.id("oorator"), "recur"), "not my discard pile");
  assert.equal(zoneOf(game.engine, game.id("oorator")), "discard");
  refused(() => actRaw(game.engine, P2, game.id("orator"), "recur"), "not their discard pile");
  assert.equal(zoneOf(game.engine, game.id("orator")), "discard");
});

clause(ORATOR, "0:ability:recur", "an empty deck: the Orator is still removed, nothing is drawn, and it is not a loss", () => {
  const game = oratorBoard({ deck: 0 });
  const handBefore = handOf(game.engine, P1).length;
  activate(game.engine, P1, game.id("orator"), "recur");
  assert.equal(zoneOf(game.engine, game.id("orator")), "removed");
  assert.equal(handOf(game.engine, P1).length, handBefore);
  assert.equal(game.engine.state.result, undefined);
});

clause(ORATOR, "0:ability:recur", "it is an ability: it can be used on the opponent's turn in response to their attack", () => {
  const game = oratorBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  const handBefore = handOf(game.engine, P1).length;
  oratorRecurRaw(game);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, handBefore + 1);
  assert.equal(zoneOf(game.engine, game.id("orator")), "removed");
});

clause(ORATOR, "0:ability:recur", "can be used only once: the removed Orator is gone for good", () => {
  const game = oratorBoard();
  activate(game.engine, P1, game.id("orator"), "recur");
  refused(() => oratorRecurRaw(game), "the card was removed from the game");
  assert.equal(handOf(game.engine, P1).length, 3, "only one card was drawn");
});

clause(ORATOR, "0:ability:recur", "after being destroyed in play the Orator lands in the discard pile and its RECUR becomes available", () => {
  const game = oratorBoard({ orator: "play", extra: [{ key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" }] });
  refused(() => oratorRecurRaw(game), "still in play");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("orator")] } });
  assert.equal(zoneOf(game.engine, game.id("orator")), "discard");
  const handBefore = handOf(game.engine, P1).length;
  activate(game.engine, P1, game.id("orator"), "recur");
  assert.equal(zoneOf(game.engine, game.id("orator")), "removed");
  assert.equal(handOf(game.engine, P1).length, handBefore + 1);
});

// =================================================================================
// Subordinate Demotivation
// Destroy the character your opponent controls with the lowest numeric cost. If there is a
// tie, you decide which character is destroyed.
// Tactic (banker), cost 3, [G].
// =================================================================================

const DEMOTIVATION = "e99994ea-71f1-4143-98dd-c2782fc38ff7";

function demotBoard(
  opts: {
    costs?: number[];
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const costs = opts.costs ?? [1, 3, 5];
  return devBoard(
    [
      { key: "sd", def: printing(DEMOTIVATION), owner: P1, zone: "hand" },
      ...costs.map((cost, i) => ({ key: `f${i}`, def: character({ name: `Foe${i}`, cost, strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" as const })),
      { key: "mineCheap", def: character({ name: "MineCheap", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "mineDear", def: character({ name: "MineDear", cost: 6, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type DemotGame = ReturnType<typeof demotBoard>;
// E10b: test corrected because the printed card picks nothing when it is played (seed-04-16): the lowest-cost character is chosen when it resolves, and only a TIE asks the caster ("you decide"). `demot(game, pick)` plays it and, if a tie prompt opened, answers it with `pick`.
const demotPlay = (game: DemotGame) => play(game.engine, P1, game.id("sd"), {});
const demotAnswer = (game: DemotGame, pick: string) => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(pick)] });
const demot = (game: DemotGame, pick?: string) => {
  demotPlay(game);
  if (pick && game.engine.state.pendingChoice) demotAnswer(game, pick);
};
const demotRaw = (game: DemotGame, _pick?: string) => playRaw(game.engine, P1, game.id("sd"), {});

clause(DEMOTIVATION, "0:rule", "deploys for exactly its printed cost of 3 with [G]: one resource short and no [G] are refused", () => {
  const short = demotBoard({ icons: { greed: 2 } });
  refused(() => demotRaw(short), "2 resources: one short of 3");
  assert.equal(zoneOf(short.engine, short.id("sd")), "hand");
  assert.equal(zoneOf(short.engine, short.id("f0")), "play");
  const noGreed = demotBoard({ icons: { rage: 6 } });
  refused(() => demotRaw(noGreed), "no [G]");
  const game = demotBoard({ icons: { greed: 4 } });
  const before = ready(game.engine);
  demot(game, "f0");
  assert.equal(before - ready(game.engine), 3, "exactly the printed cost");
  assert.equal(game.engine.getDefinition(game.id("sd")).type, "tactic");
  assert.equal(zoneOf(game.engine, game.id("sd")), "discard", "the tactic ends in its owner's discard pile");
});

clause(DEMOTIVATION, "0:rule", "destroys the opposing character with the lowest numeric cost (and only it); the others, and my own characters, stay", () => {
  const game = demotBoard({ costs: [3, 1, 5] });
  const { engine, id } = game;
  demot(game, "f1");
  assert.equal(zoneOf(engine, id("f1")), "discard", "the cost-1 character is destroyed");
  assert.ok(discardOf(engine, P2).includes(id("f1")), "into its owner's discard pile");
  assert.equal(zoneOf(engine, id("f0")), "play");
  assert.equal(zoneOf(engine, id("f2")), "play");
  assert.equal(zoneOf(engine, id("mineCheap")), "play", "my own cost-0 character is not affected, although it is cheaper");
  assert.equal(zoneOf(engine, id("mineDear")), "play");
});

clause(DEMOTIVATION, "0:rule", "when there is a single lowest-cost character no decision is needed: playing it with no pick destroys that character", () => {
  const game = demotBoard({ costs: [3, 1, 5] });
  demot(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("f1")), "discard", "the unique lowest-cost character is destroyed without anyone choosing it");
  assert.equal(zoneOf(game.engine, game.id("f0")), "play");
  assert.equal(zoneOf(game.engine, game.id("f2")), "play");
});

clause(DEMOTIVATION, "0:rule", "a character that is not the lowest cost cannot be chosen in place of it", () => {
  const game = demotBoard({ costs: [3, 1, 5] });
  demotPlay(game);
  assert.equal(game.engine.state.pendingChoice, undefined, "a single lowest character is not a choice");
  assert.equal(zoneOf(game.engine, game.id("f1")), "discard", "the lowest is destroyed");
  assert.equal(zoneOf(game.engine, game.id("f0")), "play", "cost 3 is not the lowest");
  assert.equal(zoneOf(game.engine, game.id("f2")), "play", "cost 5 is not the lowest");
});

clause(DEMOTIVATION, "0:rule", "numeric cost 0 is the lowest there is", () => {
  const game = demotBoard({ costs: [2, 0, 1] });
  demot(game, "f1");
  assert.equal(zoneOf(game.engine, game.id("f1")), "discard");
  assert.equal(zoneOf(game.engine, game.id("f2")), "play");
});

clause(DEMOTIVATION, "0:rule", "a tie: I decide which of the tied characters is destroyed (either one), and only one is", () => {
  const first = demotBoard({ costs: [2, 2, 5] });
  demot(first, "f0");
  assert.equal(zoneOf(first.engine, first.id("f0")), "discard", "I chose the first");
  assert.equal(zoneOf(first.engine, first.id("f1")), "play", "the other tied character survives");
  assert.equal(zoneOf(first.engine, first.id("f2")), "play");
  const second = demotBoard({ costs: [2, 2, 5] });
  demot(second, "f1");
  assert.equal(zoneOf(second.engine, second.id("f1")), "discard", "I chose the second");
  assert.equal(zoneOf(second.engine, second.id("f0")), "play");
});

clause(DEMOTIVATION, "0:rule", "in a tie only a tied character can be chosen: the dearer one is refused", () => {
  const game = demotBoard({ costs: [2, 2, 5] });
  demotPlay(game);
  refused(() => demotAnswer(game, "f2"), "cost 5 is not tied for lowest");
  assert.equal(game.engine.state.pendingChoice?.kind, "chooserSelectsTarget", "still waiting for a legal decision");
  demotAnswer(game, "f0");
  assert.equal(zoneOf(game.engine, game.id("f0")), "discard", "control");
});

clause(DEMOTIVATION, "0:rule", "a three-way tie: any of the three may be chosen", () => {
  for (const key of ["f0", "f1", "f2"]) {
    const game = demotBoard({ costs: [1, 1, 1, 4] });
    demot(game, key);
    assert.equal(zoneOf(game.engine, game.id(key)), "discard", `${key} destroyed`);
    assert.equal(zoneOf(game.engine, game.id("f3")), "play");
  }
});

clause(DEMOTIVATION, "0:rule", "only characters my OPPONENT controls count: my own cheaper characters are never destroyed or chosen", () => {
  const game = demotBoard({ costs: [4, 4, 7] });
  demotPlay(game);
  refused(() => demotAnswer(game, "mineCheap"), "my own character");
  assert.equal(zoneOf(game.engine, game.id("mineCheap")), "play");
  demotAnswer(game, "f0");
  assert.equal(zoneOf(game.engine, game.id("f0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("mineCheap")), "play");
});

clause(DEMOTIVATION, "0:rule", "'controls', not 'owns': a character I own but the opponent controls counts, and one the opponent owns but I control does not", () => {
  const stolenFromMe: CardPlacement = { key: "stolenFromMe", def: character({ name: "StolenFromMe", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P1, controller: P2, zone: "play" };
  const a = demotBoard({ costs: [3, 5], extra: [stolenFromMe] });
  demot(a, "stolenFromMe");
  assert.equal(zoneOf(a.engine, a.id("stolenFromMe")), "discard", "the opponent controls it and it is the cheapest");
  assert.ok(discardOf(a.engine, P1).includes(a.id("stolenFromMe")), "it goes to its owner's (my) discard pile");
  assert.equal(zoneOf(a.engine, a.id("f0")), "play");
  const stolenByMe: CardPlacement = { key: "stolenByMe", def: character({ name: "StolenByMe", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P2, controller: P1, zone: "play" };
  const b = demotBoard({ costs: [3, 5], extra: [stolenByMe] });
  demot(b, "f0");
  assert.equal(zoneOf(b.engine, b.id("stolenByMe")), "play", "I control it, so it is not 'a character your opponent controls'");
  assert.equal(zoneOf(b.engine, b.id("f0")), "discard", "the cheapest character the opponent controls is destroyed instead");
});

clause(DEMOTIVATION, "0:rule", "face-down cards are only resources, not characters: a face-down card is never destroyed or counted as the lowest cost", () => {
  const game = demotBoard({ costs: [3, 3, 5], extra: [{ key: "fd", def: character({ name: "FaceDown", cost: 0 }), owner: P2, zone: "play", faceDown: true }] });
  demotPlay(game);
  refused(() => demotAnswer(game, "fd"), "a face-down card is not a character");
  demotAnswer(game, "f0");
  assert.equal(zoneOf(game.engine, game.id("fd")), "play", "the face-down card is untouched");
  assert.equal(zoneOf(game.engine, game.id("f0")), "discard", "the cost-3 character is the lowest actual character");
});

clause(DEMOTIVATION, "0:rule", "only characters in play count: the opponent's cheaper character in hand or discard pile is ignored; items and locations are untouched", () => {
  const game = demotBoard({
    costs: [3, 3, 5],
    extra: [
      { key: "inHand", def: character({ name: "InHand", cost: 0 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 0 }), owner: P2, zone: "discard" },
      { key: "thing", def: item({ name: "Thing", cost: 0 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" }
    ]
  });
  demotPlay(game);
  refused(() => demotAnswer(game, "inHand"), "a character in hand");
  refused(() => demotAnswer(game, "inDiscard"), "a character in the discard pile");
  demotAnswer(game, "f0");
  assert.equal(zoneOf(game.engine, game.id("f0")), "discard");
  assert.equal(zoneOf(game.engine, game.id("inHand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "discard");
  assert.equal(zoneOf(game.engine, game.id("thing")), "play");
  assert.equal(zoneOf(game.engine, game.id("place")), "play");
});

clause(DEMOTIVATION, "0:rule", "the numeric cost is the printed cost: a character's current stats do not matter (the cheapest is destroyed even if it is the strongest)", () => {
  const game = demotBoard({
    costs: [3, 5],
    extra: [{ key: "bigCheap", def: character({ name: "BigCheap", cost: 1, strength: 9, life: 9, speed: 9 }), owner: P2, zone: "play" }]
  });
  demot(game, "bigCheap");
  assert.equal(zoneOf(game.engine, game.id("bigCheap")), "discard");
  assert.equal(zoneOf(game.engine, game.id("f0")), "play");
});

clause(DEMOTIVATION, "0:rule", "the lowest cost is judged when the tactic resolves: if the cheapest character is destroyed in response, the next-cheapest is destroyed instead", () => {
  const game = demotBoard({ costs: [1, 3, 5], extra: [{ key: "kill", def: killTactic({ name: "TheirKill" }), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  demotRaw(game);
  respondWith(engine, P2, id("kill"), { t: [id("f0")] });
  assert.equal(zoneOf(engine, id("f0")), "discard", "the cheapest was destroyed in response");
  assert.equal(zoneOf(engine, id("f1")), "discard", "so the lowest cost among the characters left is now the cost-3 one, and it is destroyed");
  assert.equal(zoneOf(engine, id("f2")), "play");
});

clause(DEMOTIVATION, "0:rule", "if the opponent controls no character it can still be played: it resolves and does nothing", () => {
  const game = demotBoard({ costs: [] });
  assert.equal(game.engine.state.players[P2].play.filter((c) => game.engine.getDefinition(c).type === "character").length, 0);
  const before = ready(game.engine);
  demot(game);
  assert.equal(zoneOf(game.engine, game.id("sd")), "discard", "it was played and went to the discard pile");
  assert.equal(before - ready(game.engine), 3);
  assert.equal(zoneOf(game.engine, game.id("mineCheap")), "play");
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(DEMOTIVATION, "0:rule", "it is a tactic: it can be played in response to the opponent's attack, destroying their cheapest character (an attacker leaves the battle)", () => {
  const game = demotBoard({ costs: [1, 3], turn: 2, active: P2 });
  const { engine, id } = game;
  refused(() => demotRaw(game), "no window is open yet");
  declareAttackOpenWindow(engine, P2, [id("f0")]);
  demotRaw(game);
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("f0")), "discard");
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "the destroyed attacker left the attacking party");
});

// =================================================================================
// Temple Guardian
// DEFLECT -- COST: Pay 3. Deplete this card. Pick an attacking character. -- EFFECT: Remove
// the character from the battle.
// Character (priest, mau), cost 2, [G][G], 0 strength / 3 speed / 1 life.
// =================================================================================

const GUARDIAN = "033bf619-7e24-4854-9716-91ba5e05df8b";

function guardBoard(
  opts: { guard?: "play" | "hand"; guardDepleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "guard", def: printing(GUARDIAN), owner: P1, zone: opts.guard ?? "play", depleted: opts.guardDepleted },
      { key: "blk", def: character({ name: "Blk", strength: 2, life: 9, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 6, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "idle", def: character({ name: "Idle", strength: 2, life: 6, speed: 2 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", structure: 9 }), owner: P1, zone: "play" },
      ...res(opts.icons ?? { greed: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type GuardGame = ReturnType<typeof guardBoard>;
const deflect = (game: GuardGame, target: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("guard"), "deflect", { selected: { c: [game.id(target)] } });
const deflectRaw = (game: GuardGame, target: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("guard"), "deflect", { c: [game.id(target)] });
const guardAttack = (game: GuardGame, attackers = ["atk"], target?: string) =>
  declareAttackOpenWindow(game.engine, P2, attackers.map(game.id), target ? { type: "card", cardId: game.id(target) } : { type: "faction", playerId: P1 });

clause(GUARDIAN, "0:ability:deflect", "deploys for exactly its printed cost of 2 with [G][G]: one [G] is refused; printed 0 strength / 3 speed / 1 life, priest and mau", () => {
  const oneGreed = guardBoard({ guard: "hand", icons: { greed: 1, rage: 5 }, turn: 1, active: P1 });
  refused(() => playRaw(oneGreed.engine, P1, oneGreed.id("guard")), "only one [G]", /Threshold requirements are not met/);
  // [G][G] met by already-spent Greed, but only one ready resource for the cost of 2
  const short = guardBoard({ guard: "hand", icons: { rage: 1 }, turn: 1, active: P1, extra: bank("greed", 2, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  refused(() => playRaw(short.engine, P1, short.id("guard")), "one ready resource for a cost of 2 (threshold met by spent icons)", /Costs cannot be paid/);
  const game = guardBoard({ guard: "hand", icons: { greed: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("guard"));
  assert.equal(before - ready(game.engine), 2);
  assert.equal(game.engine.getStat(game.id("guard"), "strength"), 0);
  assert.equal(game.engine.getStat(game.id("guard"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("guard"), "life"), 1);
  assert.deepEqual([...game.engine.getSubtypes(game.id("guard"))].sort(), ["mau", "priest"]);
});

clause(GUARDIAN, "0:ability:deflect", "pays exactly 3 and depletes the Guardian as the cost, then removes the picked attacker from the battle: a lone attacker leaves the battle, deals no damage, and is not harmed", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game);
  const before = ready(engine);
  deflectRaw(game, "atk");
  assert.equal(before - ready(engine), 3, "Pay 3");
  assert.equal(isDepleted(engine, id("guard")), true, "Deplete this card");
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atk")], "the effect has not resolved yet");
  resolveOneResponse(engine, P2);
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "the attacker is no longer in the battle");
  resolvePendingResponses(engine);
  autoResolveBattle(engine);
  assert.equal(engine.state.battle, undefined);
  assert.equal(influenceOf(engine, P1), START, "its damage never lands");
  assert.equal(zoneOf(engine, id("atk")), "play", "the attacker is not destroyed or moved");
  assert.equal(damageOf(engine, id("atk")), 0);
});

clause(GUARDIAN, "0:ability:deflect", "in a party only the picked attacker is removed: the other keeps attacking and its damage lands", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game, ["atk", "atk2"]);
  deflectRaw(game, "atk");
  resolveOneResponse(engine, P2);
  assert.deepEqual(battleOf(engine)?.attackingParty, [id("atk2")]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  assert.equal(influenceOf(engine, P1), START - 2, "only atk2's 2 damage landed (atk's 3 did not)");
});

clause(GUARDIAN, "0:ability:deflect", "it can be used after blockers are declared: the removed attacker deals no damage to the blocker and takes none", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game, ["atk", "atk2"]);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk")]);
  untilPriority(engine, P1);
  deflectRaw(game, "atk");
  resolveOneResponse(engine, P2);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("blk")), 2, "only atk2's 2 damage reached the blocker");
  assert.equal(damageOf(engine, id("atk")), 0, "the removed attacker took no damage from the blocker");
  assert.equal(zoneOf(engine, id("atk")), "play");
});

clause(GUARDIAN, "0:ability:deflect", "an attack on a location: removing the attacker means the location takes no damage", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game, ["atk"], "place");
  deflect(game, "atk");
  resolvePendingResponses(engine);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("place")), 0);
});

clause(GUARDIAN, "0:ability:deflect", "the picked attacker is only removed from this battle: it stays in play and is restored/usable as usual (depleted by attacking)", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game);
  deflect(game, "atk");
  resolvePendingResponses(engine);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("atk")), "play");
  assert.equal(isDepleted(engine, id("atk")), true, "it was depleted by declaring the attack and stays so");
});

clause(GUARDIAN, "0:ability:deflect", "'an attacking character': a character that is not attacking, a blocker, an item, a location, a faction and a card outside play are refused", () => {
  const extras = (): CardPlacement[] => [
    { key: "thing", def: item({ name: "Thing" }), owner: P2, zone: "play" },
    { key: "inHand", def: character({ name: "InHand" }), owner: P2, zone: "hand" },
    { key: "fd", def: character({ name: "FaceDown" }), owner: P2, zone: "play", faceDown: true }
  ];
  for (const [key, why] of [
    ["idle", "a character that is not attacking"],
    ["atk2", "a character that is not part of this attack"],
    ["blk", "my own non-attacking character"],
    ["place", "a location"],
    ["thing", "an item"],
    ["inHand", "a character in hand"],
    ["fd", "a face-down card"]
  ] as const) {
    const game = guardBoard({ extra: extras() });
    guardAttack(game);
    const before = ready(game.engine);
    refused(() => deflectRaw(game, key), why);
    assert.equal(isDepleted(game.engine, game.id("guard")), false, `${why}: not depleted`);
    assert.equal(ready(game.engine), before, `${why}: nothing paid`);
  }
  const faction = guardBoard();
  guardAttack(faction);
  refused(() => actRaw(faction.engine, P1, faction.id("guard"), "deflect", { c: [faction.engine.state.players[P2].factionId!] }), "their faction");
  refused(() => actRaw(faction.engine, P1, faction.id("guard"), "deflect", { c: [faction.engine.state.players[P1].factionId!] }), "my faction");
  refused(() => actRaw(faction.engine, P1, faction.id("guard"), "deflect", {}), "no pick");
  refused(() => actRaw(faction.engine, P1, faction.id("guard"), "deflect", { c: [faction.id("atk"), faction.id("atk2")] }), "two picks");
  const good = guardBoard({ extra: extras() });
  guardAttack(good, ["atk", "atk2"]);
  deflect(good, "atk2");
  assert.deepEqual(battleOf(good.engine)?.attackingParty, [good.id("atk")], "control: an attacking character is accepted");
});

clause(GUARDIAN, "0:ability:deflect", "a defending character is not an attacking character: once blockers are declared the blocker cannot be picked", () => {
  const game = guardBoard();
  const { engine, id } = game;
  guardAttack(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, [id("blk")]);
  untilPriority(engine, P1);
  refused(() => deflectRaw(game, "blk"), "the blocker");
  assert.equal(isDepleted(engine, id("guard")), false);
});

clause(GUARDIAN, "0:ability:deflect", "it can be used on my own attack too: the pick is simply 'an attacking character' (one of mine)", () => {
  const { engine, id } = devBoard(
    [
      { key: "guard", def: printing(GUARDIAN), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 6, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 6, speed: 2 }), owner: P2, zone: "play" },
      ...res({ greed: 4 })
    ],
    { turn: 2, activePlayerId: P1 }
  );
  engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [id("mine")], target: { type: "faction", playerId: P2 } });
  actRaw(engine, P1, id("guard"), "deflect", { c: [id("mine")] });
  resolvePendingResponses(engine);
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], [], "my own attacker was removed from my battle");
});

clause(GUARDIAN, "0:ability:deflect", "is refused when there is no battle, and a battle that has ended", () => {
  const none = guardBoard({ turn: 1, active: P1 });
  refused(() => deflectRaw(none, "atk"), "no battle");
  assert.equal(isDepleted(none.engine, none.id("guard")), false);
  const over = guardBoard();
  guardAttack(over);
  resolvePendingResponses(over.engine);
  declareBlockers(over.engine, P1, []);
  autoResolveBattle(over.engine);
  refused(() => deflectRaw(over, "atk"), "the battle is over");
});

clause(GUARDIAN, "0:ability:deflect", "is refused one resource short of Pay 3, allowed with exactly 3", () => {
  const short = guardBoard({ icons: { greed: 2 } });
  guardAttack(short);
  refused(() => deflectRaw(short, "atk"), "2 resources");
  assert.equal(isDepleted(short.engine, short.id("guard")), false);
  const exact = guardBoard({ icons: { greed: 3 } });
  guardAttack(exact);
  deflect(exact, "atk");
  assert.equal(ready(exact.engine), 0);
  assert.deepEqual(battleOf(exact.engine)?.attackingParty ?? [], []);
});

clause(GUARDIAN, "0:ability:deflect", "is refused when the Guardian is already depleted, and works again once it is restored", () => {
  const depleted = guardBoard({ guardDepleted: true });
  guardAttack(depleted);
  refused(() => deflectRaw(depleted, "atk"), "the Guardian is depleted");
  assert.equal(ready(depleted.engine), 4, "nothing was paid");
});

clause(GUARDIAN, "0:ability:deflect", "only the Guardian's controller can use it: the attacker's controller cannot", () => {
  const game = guardBoard({ extra: res({ greed: 4 }, P2) });
  guardAttack(game);
  refused(() => deflectRaw(game, "atk", P2), "not its controller");
  assert.deepEqual(battleOf(game.engine)?.attackingParty, [game.id("atk")]);
});

clause(GUARDIAN, "0:ability:deflect", "it is an in-play ability: from my hand it cannot be used", () => {
  const game = guardBoard({ guard: "hand" });
  guardAttack(game);
  refused(() => deflectRaw(game, "atk"), "Guardian in hand");
});

// =================================================================================
// The Currency Bazaar
// TRADE -- COST: Pay 1. Discard a resource. -- EFFECT: Search your deck for a staple resource
// and reveal it. Put it into your hand.
// RECUR: [G] -- COST: Use this only if this card is in your discard pile. Pay 3. Remove this
// card from the game. -- EFFECT: Search your deck for a card named The Currency Bazaar and
// reveal it. Put it into your hand.
// Location (banker), cost 0, [G], structure 3.
// =================================================================================

const BAZAAR = "46d55ff2-289d-4722-8ce0-6c5aba7e46c6";

function bazaarBoard(
  opts: {
    bazaar?: "hand" | "play" | "discard" | "deck" | "removed";
    icons?: Icons;
    deck?: "full" | "noStaple" | "empty";
    copies?: number;
    random?: () => number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const deck: CardPlacement[] =
    opts.deck === "empty"
      ? []
      : opts.deck === "noStaple"
        ? [{ key: "odd", def: oddResource(), owner: P1, zone: "deck" }, ...chars("n", 3, P1, "deck")]
        : resourceDeck(P1);
  const bazaarCopies: CardPlacement[] = Array.from({ length: opts.copies ?? 2 }, (_, i) => ({ key: `bz${i}`, def: printing(BAZAAR), owner: P1, zone: "deck" as const }));
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "bazaar", def: printing(BAZAAR), owner: P1, zone: opts.bazaar ?? "play" },
      ...deck,
      ...bazaarCopies,
      // near-misses by name
      { key: "bzSimilar", def: location({ name: "The Currency Bazaar II" }), owner: P1, zone: "deck" },
      { key: "bzShort", def: location({ name: "Currency Bazaar" }), owner: P1, zone: "deck" },
      { key: "obz", def: printing(BAZAAR), owner: P2, zone: "deck" },
      ...resourceDeck(P2, "o"),
      { key: "hStaple", def: stapleCard("Rage", "rage"), owner: P1, zone: "hand" },
      { key: "hOdd", def: oddResource("Hand Odd Coin"), owner: P1, zone: "hand" },
      { key: "hChar", def: character({ name: "HandChar" }), owner: P1, zone: "hand" },
      { key: "hTac", def: tactic({ name: "HandTactic" }), owner: P1, zone: "hand" },
      { key: "oHandRes", def: stapleCard("Greed", "greed"), owner: P2, zone: "hand" },
      { key: "dRes", def: stapleCard("Greed", "greed"), owner: P1, zone: "discard" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ]
  });
}

type BazaarGame = ReturnType<typeof bazaarBoard>;
const trade = (game: BazaarGame, discardKey: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("bazaar"), "trade", { selected: { dr: [game.id(discardKey)] } });
const tradeRaw = (game: BazaarGame, discardKey?: string, player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("bazaar"), "trade", discardKey ? { dr: [game.id(discardKey)] } : {});
const bazaarRecurRaw = (game: BazaarGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("bazaar"), "recur");

clause(BAZAAR, "0:ability:trade", "deploys for its printed cost of 0 but needs [G]: refused with no [G] even with plenty of resources, and with no resources at all; structure 3", () => {
  const noGreed = bazaarBoard({ bazaar: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("bazaar")), "no [G]");
  assert.equal(zoneOf(noGreed.engine, noGreed.id("bazaar")), "hand");
  const none = bazaarBoard({ bazaar: "hand", icons: {} });
  refused(() => playRaw(none.engine, P1, none.id("bazaar")), "no resources");
  const game = bazaarBoard({ bazaar: "hand", icons: { greed: 2 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("bazaar"));
  assert.equal(before - ready(game.engine), 0, "it costs nothing");
  assert.equal(zoneOf(game.engine, game.id("bazaar")), "play");
  assert.equal(game.engine.getDefinition(game.id("bazaar")).type, "location");
  assert.equal(game.engine.getDefinition(game.id("bazaar")).structure, 3);
});

clause(BAZAAR, "0:ability:trade", "pays exactly 1 and discards the chosen resource card from my hand as the cost; then a staple resource from my deck goes to my hand and is revealed", () => {
  const game = bazaarBoard();
  const { engine, id } = game;
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  tradeRaw(game, "hStaple");
  assert.equal(before - ready(engine), 1, "Pay 1");
  assert.equal(zoneOf(engine, id("hStaple")), "discard", "the discarded resource is already in the discard pile (a cost)");
  assert.ok(discardOf(engine, P1).includes(id("hStaple")), "my discard pile");
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore, "one card out, one card in");
  assert.deepEqual(revealedIds(engine), [id("g0")], "the found card is revealed");
  assert.equal(zoneOf(engine, id("bazaar")), "play", "the Bazaar stays in play");
});

clause(BAZAAR, "0:ability:trade", "a resource card that is not a staple can be discarded too ('a resource')", () => {
  const game = bazaarBoard();
  trade(game, "hOdd");
  pickFromSearch(game.engine, game.id, ["r0"]);
  assert.equal(zoneOf(game.engine, game.id("hOdd")), "discard");
  assert.equal(zoneOf(game.engine, game.id("r0")), "hand");
});

clause(BAZAAR, "0:ability:trade", "only a RESOURCE card in my hand can be discarded: a character or tactic in hand, a resource in play, the opponent's hand, my discard pile and my deck are refused; none is refused", () => {
  const game = bazaarBoard();
  const { engine, id } = game;
  const before = ready(engine);
  refused(() => tradeRaw(game, "hChar"), "a character card");
  refused(() => tradeRaw(game, "hTac"), "a tactic card");
  refused(() => tradeRaw(game, "oHandRes"), "a resource in the opponent's hand");
  refused(() => tradeRaw(game, "dRes"), "a resource already in my discard pile");
  refused(() => tradeRaw(game, "g0"), "a resource in my deck");
  refused(() => tradeRaw(game, undefined), "no discard chosen");
  const bank = engine.state.players[P1].play.find((c) => engine.isResource(c) && c !== id("bazaar"))!;
  refused(() => actRaw(engine, P1, id("bazaar"), "trade", { dr: [bank] }), "a resource in play");
  refused(() => actRaw(engine, P1, id("bazaar"), "trade", { dr: [id("hStaple"), id("hOdd")] }), "two resources");
  assert.equal(ready(engine), before, "nothing was paid");
  assert.equal(zoneOf(engine, id("hStaple")), "hand");
  trade(game, "hStaple");
  assert.equal(zoneOf(engine, id("hStaple")), "discard", "control: a resource card in my hand is accepted");
});

clause(BAZAAR, "0:ability:trade", "with no resource card in my hand it cannot be used (nothing to discard)", () => {
  const game = bazaarBoard({ extra: [] });
  const { engine, id } = game;
  for (const key of ["hStaple", "hOdd"]) engine.state.players[P1].hand.splice(engine.state.players[P1].hand.indexOf(id(key)), 1);
  refused(() => actRaw(engine, P1, id("bazaar"), "trade", {}), "no resource card in hand");
});

clause(BAZAAR, "0:ability:trade", "only a STAPLE resource can be found: the non-staple resource, characters, items, tactics, the Bazaar copies and the opponent's staples are refused", () => {
  const game = bazaarBoard();
  const { engine, id } = game;
  trade(game, "hStaple");
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("odd")]), "a resource that is not a staple");
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("it")]), "an item");
  refused(tryPick(engine, P1, [id("tac")]), "a tactic");
  refused(tryPick(engine, P1, [id("bz0")]), "a Bazaar");
  refused(tryPick(engine, P1, [id("og0")]), "a staple in the opponent's deck");
  refused(tryPick(engine, P1, [id("hOdd")]), "a resource in my hand");
  refused(tryPick(engine, P1, [id("g0"), id("r0")]), "two staples");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("r0")), "hand", "control: a staple is accepted");
});

clause(BAZAAR, "0:ability:trade", "the search can be failed on purpose (CR 312.2): taking nothing puts nothing in my hand, but the 1 and the discarded resource are still paid", () => {
  const game = bazaarBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  trade(game, "hStaple");
  pickFromSearch(engine, id, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing was found");
  assert.equal(before - ready(engine), 1);
  assert.equal(zoneOf(engine, id("hStaple")), "discard");
  assert.equal(revealEvents(engine).length, 0);
});

clause(BAZAAR, "0:ability:trade", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const game = bazaarBoard({ random: () => 0 });
  const { engine, id } = game;
  trade(game, "hStaple");
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("g0"));
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0));
});

clause(BAZAAR, "0:ability:trade", "a deck with no staple resource in it is still searched, so it is shuffled afterwards (CR 312.1), and the cost is still paid", () => {
  const game = bazaarBoard({ deck: "noStaple", random: () => 0 });
  const { engine, id } = game;
  const unshuffled = deckOf(engine, P1);
  const before = ready(engine);
  trade(game, "hStaple");
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 1);
  assert.equal(zoneOf(engine, id("hStaple")), "discard");
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "a searched deck is shuffled although nothing could be found");
});

clause(BAZAAR, "0:ability:trade", "an empty deck: the cost is paid, nothing is found, and it is not a loss", () => {
  const game = bazaarBoard({ deck: "empty" });
  const { engine, id } = game;
  trade(game, "hStaple");
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("hStaple")), "discard");
  assert.equal(engine.state.result, undefined);
});

clause(BAZAAR, "0:ability:trade", "the Bazaar is not depleted by TRADE: it can be used again and again in one turn, each use paying 1 and discarding a resource", () => {
  const game = bazaarBoard({ icons: { greed: 5 } });
  const { engine, id } = game;
  trade(game, "hStaple");
  pickFromSearch(engine, id, ["g0"]);
  trade(game, "hOdd");
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(isDepleted(engine, id("bazaar")), false);
  assert.equal(ready(engine), 3, "two payments of 1");
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(zoneOf(engine, id("r0")), "hand");
});

clause(BAZAAR, "0:ability:trade", "the opponent's deck, hand and discard pile are untouched, and the opponent's deck is not shuffled", () => {
  const game = bazaarBoard({ random: () => 0 });
  const { engine, id } = game;
  const oppDeck = deckOf(engine, P2);
  const oppHand = handOf(engine, P2);
  const oppDiscard = discardOf(engine, P2);
  trade(game, "hStaple");
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(BAZAAR, "0:ability:trade", "is refused with no resource to pay 1: nothing is discarded", () => {
  const game = bazaarBoard({ icons: {} });
  assert.equal(ready(game.engine), 0);
  refused(() => tradeRaw(game, "hStaple"), "no resources");
  assert.equal(zoneOf(game.engine, game.id("hStaple")), "hand");
  const spent = bazaarBoard({ icons: {}, extra: spentRes("greed", P1, 2) });
  refused(() => tradeRaw(spent, "hStaple"), "only spent resources");
  const one = bazaarBoard({ icons: { greed: 1 } });
  trade(one, "hStaple");
  assert.equal(zoneOf(one.engine, one.id("hStaple")), "discard", "control: one resource is enough");
});

clause(BAZAAR, "0:ability:trade", "only its controller can use it, and only while it is in play", () => {
  const theirs = bazaarBoard({ turn: 2, active: P2, extra: res({ greed: 3 }, P2) });
  refused(() => tradeRaw(theirs, "oHandRes", P2), "not its controller");
  const inHand = bazaarBoard({ bazaar: "hand" });
  refused(() => tradeRaw(inHand, "hStaple"), "the Bazaar is in my hand");
});

clause(BAZAAR, "0:ability:trade", "it is an ability: it can be used on the opponent's turn in response to their attack", () => {
  const game = bazaarBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  tradeRaw(game, "hStaple");
  resolvePendingResponses(game.engine);
  pickFromSearch(game.engine, game.id, ["g0"]);
  assert.equal(zoneOf(game.engine, game.id("g0")), "hand");
});

// --- RECUR ---

clause(BAZAAR, "1:ability:recur", "from the discard pile: pays exactly 3, removes the Bazaar from the game as a cost, then finds a card named The Currency Bazaar in my deck and puts it into my hand (revealed)", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 } });
  const { engine, id } = game;
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  bazaarRecurRaw(game);
  assert.equal(before - ready(engine), 3, "Pay 3");
  assert.equal(zoneOf(engine, id("bazaar")), "removed", "removed from the game as a cost");
  assert.ok(removedOf(engine, P1).includes(id("bazaar")), "removedOf(engine, P1).includes(id(\"bazaar\"))");
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["bz0"]);
  assert.equal(zoneOf(engine, id("bz0")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.deepEqual(revealedIds(engine), [id("bz0")]);
});

clause(BAZAAR, "1:ability:recur", "either copy in the deck may be chosen", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 } });
  activate(game.engine, P1, game.id("bazaar"), "recur");
  pickFromSearch(game.engine, game.id, ["bz1"]);
  assert.equal(zoneOf(game.engine, game.id("bz1")), "hand");
  assert.equal(zoneOf(game.engine, game.id("bz0")), "deck");
});

clause(BAZAAR, "1:ability:recur", "only a card NAMED The Currency Bazaar: other cards in the deck, near-miss names, and the opponent's Bazaar are refused", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 } });
  const { engine, id } = game;
  activate(engine, P1, id("bazaar"), "recur");
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("bzSimilar")]), "The Currency Bazaar II");
  refused(tryPick(engine, P1, [id("bzShort")]), "Currency Bazaar");
  refused(tryPick(engine, P1, [id("g0")]), "a staple resource");
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("obz")]), "the opponent's Bazaar");
  refused(tryPick(engine, P1, [id("bz0"), id("bz1")]), "two copies");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["bz0"]);
  assert.equal(zoneOf(engine, id("bz0")), "hand", "control");
});

clause(BAZAAR, "1:ability:recur", "the search can be failed on purpose (CR 312.2): the cost is paid and the Bazaar removed, nothing is put into my hand", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 } });
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  bazaarRecurRaw(game);
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, []);
  assert.equal(handOf(engine, P1).length, handBefore);
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bazaar")), "removed");
});

clause(BAZAAR, "1:ability:recur", "the searched deck is shuffled afterwards (CR 312.1)", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 }, random: () => 0 });
  const unshuffled = deckOf(game.engine, P1).filter((c) => c !== game.id("bz0"));
  activate(game.engine, P1, game.id("bazaar"), "recur");
  pickFromSearch(game.engine, game.id, ["bz0"]);
  assert.deepEqual(deckOf(game.engine, P1), shuffledWithConstant(unshuffled, 0));
});

clause(BAZAAR, "1:ability:recur", "with no Bazaar left in my deck it resolves cleanly (the cost is paid), and the searched deck is still shuffled (CR 312.1)", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 }, copies: 0, random: () => 0 });
  const { engine, id } = game;
  const unshuffled = deckOf(engine, P1);
  const before = ready(engine);
  bazaarRecurRaw(game);
  resolvePendingResponses(engine);
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 3);
  assert.equal(zoneOf(engine, id("bazaar")), "removed");
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "the deck was searched, so it is shuffled although there was nothing to find");
});

clause(BAZAAR, "1:ability:recur", "'use this only if this card is in your discard pile': refused from the hand, the deck, in play and once removed", () => {
  for (const zone of ["hand", "deck", "play", "removed"] as const) {
    const game = bazaarBoard({ bazaar: zone, icons: { greed: 6 } });
    const before = ready(game.engine);
    refused(() => bazaarRecurRaw(game), `the Bazaar is in ${zone}`);
    assert.equal(ready(game.engine), before, `${zone}: nothing paid`);
    assert.equal(zoneOf(game.engine, game.id("bazaar")), zone);
  }
  const ok = bazaarBoard({ bazaar: "discard", icons: { greed: 6 } });
  bazaarRecurRaw(ok);
  assert.equal(zoneOf(ok.engine, ok.id("bazaar")), "removed", "control");
});

clause(BAZAAR, "1:ability:recur", "'your discard pile': the opponent's Bazaar in THEIR discard pile cannot be recurred by me, and mine cannot be recurred by them", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 }, extra: [{ key: "oBazaar", def: printing(BAZAAR), owner: P2, zone: "discard" }, ...res({ greed: 6 }, P2)] });
  refused(() => actRaw(game.engine, P1, game.id("oBazaar"), "recur"), "not my discard pile");
  assert.equal(zoneOf(game.engine, game.id("oBazaar")), "discard");
  refused(() => actRaw(game.engine, P2, game.id("bazaar"), "recur"), "not their discard pile");
  assert.equal(zoneOf(game.engine, game.id("bazaar")), "discard");
});

clause(BAZAAR, "1:ability:recur", "is refused one resource short of Pay 3, allowed with exactly 3", () => {
  const short = bazaarBoard({ bazaar: "discard", icons: { greed: 2 } });
  refused(() => bazaarRecurRaw(short), "2 resources");
  assert.equal(zoneOf(short.engine, short.id("bazaar")), "discard", "not removed");
  const exact = bazaarBoard({ bazaar: "discard", icons: { greed: 3 } });
  bazaarRecurRaw(exact);
  assert.equal(ready(exact.engine), 0);
  assert.equal(zoneOf(exact.engine, exact.id("bazaar")), "removed");
});

clause(BAZAAR, "1:ability:recur", "RECUR: [G] needs a [G]: plenty of other resources are not enough, one [G] among them is (and only 3 are spent)", () => {
  const none = bazaarBoard({ bazaar: "discard", icons: { rage: 6 } });
  refused(() => bazaarRecurRaw(none), "no [G]");
  assert.equal(zoneOf(none.engine, none.id("bazaar")), "discard");
  const one = bazaarBoard({ bazaar: "discard", icons: { greed: 1, rage: 5 } });
  bazaarRecurRaw(one);
  assert.equal(zoneOf(one.engine, one.id("bazaar")), "removed");
  assert.equal(ready(one.engine), 3, "exactly 3 of the 6 resources were paid");
});

clause(BAZAAR, "1:ability:recur", "it is an ability: it can be used on the opponent's turn in response to their attack", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 6 }, turn: 2, active: P2 });
  declareAttackOpenWindow(game.engine, P2, [game.id("foe")]);
  bazaarRecurRaw(game);
  resolvePendingResponses(game.engine);
  pickFromSearch(game.engine, game.id, ["bz0"]);
  assert.equal(zoneOf(game.engine, game.id("bz0")), "hand");
});

clause(BAZAAR, "1:ability:recur", "can be used only once: the removed Bazaar is gone for good", () => {
  const game = bazaarBoard({ bazaar: "discard", icons: { greed: 8 } });
  activate(game.engine, P1, game.id("bazaar"), "recur");
  pickFromSearch(game.engine, game.id, ["bz0"]);
  refused(() => bazaarRecurRaw(game), "the card was removed from the game");
  assert.equal(ready(game.engine), 5, "only the first use was paid for");
});

clause(BAZAAR, "1:ability:recur", "after being destroyed in play the Bazaar lands in the discard pile and its RECUR becomes available", () => {
  const game = bazaarBoard({ icons: { greed: 6 }, extra: [{ key: "kill", def: destroyTactic("location"), owner: P1, zone: "hand" }] });
  refused(() => bazaarRecurRaw(game), "still in play");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("bazaar")] } });
  assert.equal(zoneOf(game.engine, game.id("bazaar")), "discard");
  bazaarRecurRaw(game);
  resolvePendingResponses(game.engine);
  pickFromSearch(game.engine, game.id, ["bz1"]);
  assert.equal(zoneOf(game.engine, game.id("bazaar")), "removed");
  assert.equal(zoneOf(game.engine, game.id("bz1")), "hand");
});

// =================================================================================
// Theocratic Senate of Marduun
// UNIQUE THEOCRATIC SENATE OF MARDUUN
// Your opponent cannot attack your faction.
// If a character inflicts damage to this card, inflict the same amount of damage to the character.
// Location (banker), cost 5, [G][G][G], structure 5.
// =================================================================================

const SENATE = "9f06b372-48a0-49eb-a2df-a4c5c923694b";

/** A character with a free ability SCORCH (id "scorch") that deals 2 damage to one picked location. */
const arsonistChar = (name: string, life = 6): CardDefinition =>
  character({
    name,
    strength: 1,
    life,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "scorch",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 2 }]
        }
      ]
    }
  });

function senateBoard(
  opts: {
    senate?: "hand" | "play" | "discard";
    senateFaceDown?: boolean;
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "senate", def: printing(SENATE), owner: P1, zone: opts.senate ?? "play", faceDown: opts.senateFaceDown },
      { key: "place", def: location({ name: "OtherPlace", structure: 6 }), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 2, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "atk3", def: character({ name: "Atk3", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "big", def: character({ name: "Big", strength: 7, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "weak", def: character({ name: "Weak", strength: 3, life: 2, speed: 2 }), owner: P2, zone: "play" },
      { key: "s2f", def: character({ name: "S2F", strength: 2, life: 9, speed: 3 }), owner: P2, zone: "play" },
      { key: "s1s", def: character({ name: "S1S", strength: 1, life: 9, speed: 1 }), owner: P2, zone: "play" },
      { key: "s2m", def: character({ name: "S2M", strength: 2, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "s1m", def: character({ name: "S1M", strength: 1, life: 9, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", 3, P1, "deck"),
      ...res(opts.icons ?? { greed: 6 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type SenateGame = ReturnType<typeof senateBoard>;
/** P2 attacks (P1's faction unless `target`), declares and passes priority; P1 then declares no blockers and the battle resolves. */
function senateFight(game: SenateGame, attackers: string[], target: string, blockers: string[] = []): void {
  declareAttackBy(game.engine, P2, attackers.map(game.id), { type: "card", cardId: game.id(target) });
  declareBlockers(game.engine, P1, blockers.map(game.id));
  autoResolveBattle(game.engine);
}

clause(SENATE, "0:unique", "deploys for exactly its printed cost of 5 with [G][G][G]: two [G] among many resources is refused; it has structure 5", () => {
  const two = senateBoard({ senate: "hand", icons: { greed: 2, rage: 5 }, turn: 1, active: P1 });
  refused(() => playRaw(two.engine, P1, two.id("senate")), "only two [G]");
  const short = senateBoard({ senate: "hand", icons: { greed: 4 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("senate")), "4 resources: one short of 5");
  const game = senateBoard({ senate: "hand", icons: { greed: 5 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("senate"));
  assert.equal(before - ready(game.engine), 5);
  assert.equal(zoneOf(game.engine, game.id("senate")), "play");
  assert.equal(game.engine.getDefinition(game.id("senate")).type, "location");
  assert.equal(game.engine.getDefinition(game.id("senate")).structure, 5);
});

clause(SENATE, "0:unique", "controlling a second Senate makes me keep one: keeping the new one destroys the old one", () => {
  const game = senateBoard({ icons: { greed: 8 }, turn: 1, active: P1, extra: [{ key: "senate2", def: printing(SENATE), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  play(engine, P1, id("senate2"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; candidates: string[] };
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...pc.candidates].sort(), [id("senate"), id("senate2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("senate2") });
  assert.equal(zoneOf(engine, id("senate2")), "play");
  assert.equal(zoneOf(engine, id("senate")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(SENATE, "0:unique", "keeping the old Senate destroys the new one", () => {
  const game = senateBoard({ icons: { greed: 8 }, turn: 1, active: P1, extra: [{ key: "senate2", def: printing(SENATE), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("senate2"));
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("senate") });
  assert.equal(zoneOf(game.engine, game.id("senate")), "play");
  assert.equal(zoneOf(game.engine, game.id("senate2")), "discard");
});

clause(SENATE, "0:unique", "the choice must name one of the two copies", () => {
  const game = senateBoard({ icons: { greed: 8 }, turn: 1, active: P1, extra: [{ key: "senate2", def: printing(SENATE), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("senate2"));
  refused(answerRaw(game.engine, P1, { kind: "uniqueSurvivor", keep: game.id("mine") }), "a card that is not a copy");
  assert.equal(pending(game.engine)?.kind, "uniqueSurvivor");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("senate") });
  assert.equal(zoneOf(game.engine, game.id("senate")), "play", "control");
});

clause(SENATE, "0:unique", "UNIQUE is per player: the opponent may control their own Senate with no choice and no destruction", () => {
  const game = senateBoard({ extra: [{ key: "osenate", def: printing(SENATE), owner: P2, zone: "hand" }, ...res({ greed: 6 }, P2)] });
  play(game.engine, P2, game.id("osenate"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("senate")), "play");
  assert.equal(zoneOf(game.engine, game.id("osenate")), "play");
});

clause(SENATE, "0:unique", "taking control of the opponent's Senate while I have my own is a duplicate: I must keep one", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "s",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = senateBoard({
    turn: 1,
    active: P1,
    extra: [
      { key: "theirs", def: printing(SENATE), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("steal"), { selected: { t: [game.id("theirs")] } });
  assert.equal(pending(game.engine)?.kind, "uniqueSurvivor");
  assert.equal(pending(game.engine)?.playerId, P1);
});

clause(SENATE, "0:unique", "a second Senate in hand or discard is no conflict, and a location with a different UNIQUE designation (or none) is not a duplicate", () => {
  const game = senateBoard({
    extra: [
      { key: "senateH", def: printing(SENATE), owner: P1, zone: "hand" },
      { key: "senateD", def: printing(SENATE), owner: P1, zone: "discard" },
      { key: "other", def: location({ name: "OtherUnique", unique: "other unique" } as Partial<CardDefinition>), owner: P1, zone: "play" }
    ]
  });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("senate")), "play");
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
});

// --- Your opponent cannot attack your faction ---

const senateAttackFaction = (game: SenateGame, attackers = ["atk"]) =>
  game.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: attackers.map(game.id), target: { type: "faction", playerId: P1 } });

clause(SENATE, "1:rule", "while it is in play my opponent cannot attack my faction (refused), and with no Senate the same attack is legal", () => {
  const withSenate = senateBoard();
  refused(() => senateAttackFaction(withSenate), "the Senate forbids attacking my faction");
  assert.equal(withSenate.engine.state.battle, undefined);
  assert.equal(isDepleted(withSenate.engine, withSenate.id("atk")), false, "the would-be attacker was not depleted");
  assert.equal(influenceOf(withSenate.engine, P1), START);
  const without = senateBoard({ senate: "hand" });
  senateAttackFaction(without);
  assert.ok(without.engine.state.battle, "control: with the Senate still in my hand the attack on my faction is legal");
});

clause(SENATE, "1:rule", "it forbids any attacking party, not just a single attacker", () => {
  const game = senateBoard();
  refused(() => senateAttackFaction(game, ["atk", "atk2", "big"]), "party of three");
  assert.equal(game.engine.state.battle, undefined);
});

clause(SENATE, "1:rule", "it only protects my FACTION: my opponent can still attack my other locations and the Senate itself", () => {
  const a = senateBoard();
  a.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [a.id("atk")], target: { type: "card", cardId: a.id("place") } });
  assert.ok(a.engine.state.battle, "attacking my other location is legal");
  const b = senateBoard();
  b.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [b.id("atk")], target: { type: "card", cardId: b.id("senate") } });
  assert.ok(b.engine.state.battle, "attacking the Senate itself is legal");
});

clause(SENATE, "1:rule", "it protects only 'your' faction: the Senate's controller can still attack the opponent's faction", () => {
  const game = senateBoard({ turn: 2, active: P1 });
  game.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [game.id("mine")], target: { type: "faction", playerId: P2 } });
  assert.ok(game.engine.state.battle, "game.engine.state.battle");
});

clause(SENATE, "1:rule", "once the Senate leaves play the restriction is gone and my faction can be attacked", () => {
  const game = senateBoard({ extra: [{ key: "zap", def: destroyTactic("location"), owner: P2, zone: "hand" }] });
  refused(() => senateAttackFaction(game), "restricted while the Senate is in play");
  respondWith(game.engine, P2, game.id("zap"), { t: [game.id("senate")] });
  assert.equal(zoneOf(game.engine, game.id("senate")), "discard");
  senateAttackFaction(game);
  assert.ok(game.engine.state.battle, "the attack on my faction is now legal");
});

clause(SENATE, "1:rule", "it is controller-relative: a Senate controlled by the opponent forbids ME to attack THEIR faction, and not them to attack mine", () => {
  const theirs: CardPlacement = { key: "senate", def: printing(SENATE), owner: P2, zone: "play" };
  const myTurn = devBoard([theirs, { key: "mine", def: character({ name: "Mine", life: 3 }), owner: P1, zone: "play" }], { turn: 2, activePlayerId: P1 });
  refused(() => myTurn.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [myTurn.id("mine")], target: { type: "faction", playerId: P2 } }), "their Senate protects their faction");
  const theirTurn = devBoard([theirs, { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" }], { turn: 2, activePlayerId: P2 });
  theirTurn.engine.perform({ type: "declareAttack", playerId: P2, attackerIds: [theirTurn.id("foe")], target: { type: "faction", playerId: P1 } });
  assert.ok(theirTurn.engine.state.battle, "their Senate does not protect MY faction");
});

clause(SENATE, "1:rule", "a Senate that is not in play restricts nothing: in my discard pile, or face-down as a resource", () => {
  const inDiscard = senateBoard({ senate: "discard" });
  senateAttackFaction(inDiscard);
  assert.ok(inDiscard.engine.state.battle, "inDiscard.engine.state.battle");
  const faceDown = senateBoard({ senateFaceDown: true });
  senateAttackFaction(faceDown);
  assert.ok(faceDown.engine.state.battle, "a face-down Senate is only a resource (CR 411.1)");
});

// --- If a character inflicts damage to this card, inflict the same amount of damage to the character. ---

clause(SENATE, "2:rule", "an attacker that damages the Senate takes the same amount of damage: a 3-strength attacker deals 3 to the Senate and takes 3", () => {
  const game = senateBoard();
  const { engine, id } = game;
  senateFight(game, ["atk"], "senate");
  assert.equal(damageOf(engine, id("senate")), 3, "the Senate took 3");
  assert.equal(damageOf(engine, id("atk")), 3, "and the attacker took the same 3");
  assert.equal(zoneOf(engine, id("atk")), "play");
});

clause(SENATE, "2:rule", "a weaker attacker takes less: 2 damage to the Senate means 2 damage back", () => {
  const game = senateBoard();
  senateFight(game, ["atk2"], "senate");
  assert.equal(damageOf(game.engine, game.id("senate")), 2);
  assert.equal(damageOf(game.engine, game.id("atk2")), 2);
});

clause(SENATE, "2:rule", "the damage back can destroy the attacker: a 3-strength, 2-life attacker is destroyed by its own 3 damage", () => {
  const game = senateBoard();
  senateFight(game, ["weak"], "senate");
  assert.equal(damageOf(game.engine, game.id("senate")), 3);
  assert.equal(zoneOf(game.engine, game.id("weak")), "discard", "it took 3 and has 2 life");
});

clause(SENATE, "2:rule", "attackers in different speed groups each take exactly the damage they inflicted", () => {
  const game = senateBoard();
  senateFight(game, ["s2f", "s1s"], "senate");
  assert.equal(damageOf(game.engine, game.id("senate")), 3, "2 + 1");
  assert.equal(damageOf(game.engine, game.id("s2f")), 2);
  assert.equal(damageOf(game.engine, game.id("s1s")), 1);
});

clause(SENATE, "2:rule", "attackers at the SAME speed each take the damage THEY inflicted (2 and 1), not the combined 3", () => {
  const game = senateBoard();
  senateFight(game, ["s2m", "s1m"], "senate");
  assert.equal(damageOf(game.engine, game.id("senate")), 3);
  assert.equal(damageOf(game.engine, game.id("s2m")), 2, "the 2-strength attacker takes 2");
  assert.equal(damageOf(game.engine, game.id("s1m")), 1, "the 1-strength attacker takes 1");
});

clause(SENATE, "2:rule", "attackers whose combined damage destroys the Senate still each take what they inflicted (3 and 2)", () => {
  const game = senateBoard();
  senateFight(game, ["atk", "atk2"], "senate");
  assert.equal(zoneOf(game.engine, game.id("senate")), "discard", "5 damage destroys a structure-5 Senate");
  assert.equal(damageOf(game.engine, game.id("atk")), 3);
  assert.equal(damageOf(game.engine, game.id("atk2")), 2);
});

clause(SENATE, "2:rule", "the same amount of damage: the damage inflicted, even when it destroys the Senate (a 7-strength attacker deals 7 and takes 7)", () => {
  const game = senateBoard();
  senateFight(game, ["big"], "senate");
  assert.equal(zoneOf(game.engine, game.id("senate")), "discard", "the Senate (structure 5) was destroyed");
  assert.equal(damageOf(game.engine, game.id("big")), 7, "and the attacker still takes the 7 it inflicted");
});

clause(SENATE, "2:rule", "a character blocking the attackers inflicts no damage to the Senate, so nothing comes back", () => {
  const game = senateBoard();
  senateFight(game, ["atk"], "senate", ["mine"]);
  assert.equal(damageOf(game.engine, game.id("senate")), 0, "the blocker took the damage, not the Senate");
  assert.equal(damageOf(game.engine, game.id("atk")), 2, "the attacker only took the blocker's 2 battle damage");
});

clause(SENATE, "2:rule", "damage from a non-character source (a tactic) does not come back: the tactic is not a character", () => {
  const game = senateBoard({ turn: 1, active: P1, extra: [{ key: "zap", def: zapTactic("ZapLoc", 3, "location"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("zap"), { selected: { t: [game.id("senate")] } });
  assert.equal(damageOf(game.engine, game.id("senate")), 3);
  for (const key of ["mine", "atk", "atk2", "big", "weak"]) assert.equal(damageOf(game.engine, game.id(key)), 0, `${key} took nothing`);
});

clause(SENATE, "2:rule", "a character's ability that damages the Senate (not battle damage) comes back to that character too", () => {
  const game = senateBoard({ extra: [{ key: "arson", def: arsonistChar("Arsonist"), owner: P2, zone: "play" }] });
  activate(game.engine, P2, game.id("arson"), "scorch", { selected: { t: [game.id("senate")] } });
  assert.equal(damageOf(game.engine, game.id("senate")), 2);
  assert.equal(damageOf(game.engine, game.id("arson")), 2, "the Arsonist takes the 2 it inflicted");
});

clause(SENATE, "2:rule", "it also applies to my own characters: my Arsonist that damages my Senate takes the damage back", () => {
  const game = senateBoard({ turn: 1, active: P1, extra: [{ key: "arson", def: arsonistChar("Arsonist"), owner: P1, zone: "play" }] });
  activate(game.engine, P1, game.id("arson"), "scorch", { selected: { t: [game.id("senate")] } });
  assert.equal(damageOf(game.engine, game.id("senate")), 2);
  assert.equal(damageOf(game.engine, game.id("arson")), 2);
});

clause(SENATE, "2:rule", "it only reacts to damage to THIS card: damage to another location does not come back", () => {
  const game = senateBoard({ extra: [{ key: "arson", def: arsonistChar("Arsonist"), owner: P2, zone: "play" }] });
  activate(game.engine, P2, game.id("arson"), "scorch", { selected: { t: [game.id("place")] } });
  assert.equal(damageOf(game.engine, game.id("place")), 2);
  assert.equal(damageOf(game.engine, game.id("arson")), 0);
});

clause(SENATE, "2:rule", "the opponent's attack on the Senate costs my faction nothing", () => {
  const game = senateBoard();
  senateFight(game, ["atk"], "senate");
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(SENATE, "2:rule", "it does nothing when it is not in play: an attack on another location of mine is not reflected", () => {
  const game = senateBoard({ senate: "hand" });
  senateFight(game, ["atk"], "place");
  assert.equal(damageOf(game.engine, game.id("place")), 3);
  assert.equal(damageOf(game.engine, game.id("atk")), 0);
});

// =================================================================================
// Treasure Brokerage
// If a character enters play under your control, you may pay 1. If you do, search your deck for
// a staple resource and reveal it. Put it into your hand.
// Location (banker), cost 2, [G], structure 5.
// =================================================================================

const BROKERAGE = "a691d84a-b0b0-4590-9333-698c448e3062";

/** A free tactic (id "raise", pick "t"): puts one picked character from `zone` of its owner's pile into play under `who`'s control. */
const raiseTactic = (who: "controller" | "opponent", owner: "self" | "opponent" = "self"): CardDefinition =>
  tactic({
    name: `Raise for ${who}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "raise",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner, type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: who }]
        }
      ]
    }
  });

function brokerBoard(
  opts: {
    brok?: "hand" | "play" | "discard";
    brokFaceDown?: boolean;
    icons?: Icons;
    deck?: "full" | "noStaple" | "empty";
    random?: () => number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const deck: CardPlacement[] =
    opts.deck === "empty"
      ? []
      : opts.deck === "noStaple"
        ? [{ key: "odd", def: oddResource(), owner: P1, zone: "deck" }, ...chars("n", 3, P1, "deck")]
        : resourceDeck(P1);
  return buildGame({
    turn: opts.turn,
    activePlayerId: opts.active,
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "brok", def: printing(BROKERAGE), owner: P1, zone: opts.brok ?? "play", faceDown: opts.brokFaceDown },
      ...deck,
      ...resourceDeck(P2, "o"),
      { key: "hc0", def: character({ name: "Hand0", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "hand" },
      { key: "hc1", def: character({ name: "Hand1", cost: 1, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "hand" },
      { key: "hc2", def: character({ name: "Hand2", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "hand" },
      { key: "hItem", def: item({ name: "HandItem", cost: 0 }), owner: P1, zone: "hand" },
      { key: "hPlace", def: location({ name: "HandPlace", cost: 0 }), owner: P1, zone: "hand" },
      { key: "hTac", def: tactic({ name: "HandTactic", cost: 0 }), owner: P1, zone: "hand" },
      { key: "dChar", def: character({ name: "DiscChar", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "discard" },
      { key: "oChar", def: character({ name: "OppDiscChar", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P2, zone: "discard" },
      { key: "oh0", def: character({ name: "OppHand0", cost: 0, strength: 1, life: 3, speed: 1 }), owner: P2, zone: "hand" },
      { key: "raiseMine", def: raiseTactic("controller"), owner: P1, zone: "hand" },
      { key: "raiseTheirs", def: raiseTactic("opponent"), owner: P1, zone: "hand" },
      { key: "raiseTheirsForMe", def: raiseTactic("controller", "opponent"), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ],
  });
}

type BrokerGame = ReturnType<typeof brokerBoard>;

/** Answers the open `mayPay` (asserting whose it is). */
function answerMayPay(engine: SpoilsEngine, pay: boolean, player: PlayerId = P1): void {
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, player, "the Brokerage's controller decides");
  answerPending(engine, "mayPay", { pay });
}

clause(BROKERAGE, "0:rule", "deploys for exactly its printed cost of 2 with [G]: one resource short and no [G] are refused; structure 5", () => {
  const short = brokerBoard({ brok: "hand", icons: { greed: 1 } });
  refused(() => playRaw(short.engine, P1, short.id("brok")), "1 resource: one short of 2");
  const noGreed = brokerBoard({ brok: "hand", icons: { rage: 6 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("brok")), "no [G]");
  const game = brokerBoard({ brok: "hand", icons: { greed: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("brok"));
  assert.equal(before - ready(game.engine), 2);
  assert.equal(game.engine.getDefinition(game.id("brok")).type, "location");
  assert.equal(game.engine.getDefinition(game.id("brok")).structure, 5);
  assert.equal(game.engine.state.pendingChoice, undefined, "a location entering play does not trigger it");
});

clause(BROKERAGE, "0:rule", "a character I deploy enters play under my control: I may pay 1, and if I do I search for a staple resource, reveal it and put it into my hand", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("hc0"));
  assert.equal(zoneOf(engine, id("hc0")), "play");
  assert.equal(before - ready(engine), 0, "the character cost nothing and nothing has been paid for the Brokerage yet");
  answerMayPay(engine, true);
  assert.equal(before - ready(engine), 1, "pay 1");
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "the character left the hand, the staple entered it");
  assert.deepEqual(revealedIds(engine), [id("g0")], "the found card is revealed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(BROKERAGE, "0:rule", "I may decline: nothing is paid, nothing is searched, the deck is not touched", () => {
  const game = brokerBoard({ random: () => 0 });
  const { engine, id } = game;
  const before = ready(engine);
  const deck = deckOf(engine, P1);
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("hc0"));
  answerMayPay(engine, false);
  assert.equal(engine.state.pendingChoice, undefined, "no search prompt follows");
  assert.equal(ready(engine), before, "nothing paid");
  assert.deepEqual(deckOf(engine, P1), deck, "the deck is not searched or shuffled");
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(revealEvents(engine).length, 0);
});

clause(BROKERAGE, "0:rule", "only a STAPLE resource can be found: the non-staple resource, characters, items, tactics and the opponent's staples are refused", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("odd")]), "a resource that is not a staple");
  refused(tryPick(engine, P1, [id("c0")]), "a character");
  refused(tryPick(engine, P1, [id("it")]), "an item");
  refused(tryPick(engine, P1, [id("tac")]), "a tactic");
  refused(tryPick(engine, P1, [id("og0")]), "a staple in the opponent's deck");
  refused(tryPick(engine, P1, [id("g0"), id("r0")]), "two staples");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("r0")), "hand", "control: a staple is accepted");
});

clause(BROKERAGE, "0:rule", "the search can be failed on purpose (CR 312.2): after paying 1, taking nothing puts nothing in my hand", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  pickFromSearch(engine, id, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "nothing found");
  assert.equal(before - ready(engine), 1, "the 1 was paid");
});

clause(BROKERAGE, "0:rule", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const game = brokerBoard({ random: () => 0 });
  const { engine, id } = game;
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("g0"));
  pickFromSearch(engine, id, ["g0"]);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0));
});

clause(BROKERAGE, "0:rule", "a deck with no staple resource in it is still searched, so it is shuffled afterwards (CR 312.1), and the 1 is paid", () => {
  const game = brokerBoard({ deck: "noStaple", random: () => 0 });
  const { engine, id } = game;
  const unshuffled = deckOf(engine, P1);
  const before = ready(engine);
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 1);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "a searched deck is shuffled although nothing could be found");
});

clause(BROKERAGE, "0:rule", "an empty deck: I can still pay, nothing is found, and it is not a loss", () => {
  const game = brokerBoard({ deck: "empty" });
  play(game.engine, P1, game.id("hc0"));
  answerMayPay(game.engine, true);
  drain(game.engine, pickTargets([]));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.result, undefined);
});

clause(BROKERAGE, "0:rule", "the 1 is separate from the character's own cost: a cost-1 character with 2 resources leaves exactly 0 after paying both", () => {
  const game = brokerBoard({ icons: { greed: 2 } });
  const { engine, id } = game;
  play(engine, P1, id("hc1"));
  assert.equal(ready(engine), 1, "the character cost 1");
  answerMayPay(engine, true);
  assert.equal(ready(engine), 0, "and the Brokerage's payment took the last one");
  pickFromSearch(engine, id, ["g0"]);
});

clause(BROKERAGE, "0:rule", "I cannot pay with no resource left: after a cost-1 character spends the only resource, the payment is not possible and nothing is searched", () => {
  const game = brokerBoard({ icons: { greed: 1 } });
  const { engine, id } = game;
  play(engine, P1, id("hc1"));
  assert.equal(ready(engine), 0);
  if (pending(engine)?.kind === "mayPay") {
    refused(answerRaw(engine, P1, { kind: "mayPay", pay: true }), "nothing to pay with");
    answerMayPay(engine, false);
  }
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).filter((c) => [id("g0"), id("g1"), id("r0")].includes(c)).length, 0, "no staple was found");
});

clause(BROKERAGE, "0:rule", "a character put into play by an effect (not deployed) also 'enters play under your control'", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  play(engine, P1, id("raiseMine"), { selected: { t: [id("dChar")] } });
  assert.equal(zoneOf(engine, id("dChar")), "play");
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
});

clause(BROKERAGE, "0:rule", "a character the OPPONENT owns that enters play under MY control triggers it", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  play(engine, P1, id("raiseTheirsForMe"), { selected: { t: [id("oChar")] } });
  assert.equal(engine.state.cards[id("oChar")].controllerId, P1);
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
});

clause(BROKERAGE, "0:rule", "a character of mine that enters play under the OPPONENT's control does not trigger it", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  const before = ready(engine);
  play(engine, P1, id("raiseTheirs"), { selected: { t: [id("dChar")] } });
  assert.equal(zoneOf(engine, id("dChar")), "play");
  assert.equal(engine.state.cards[id("dChar")].controllerId, P2);
  drain(engine, declineAll);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), before);
  assert.equal(revealEvents(engine).length, 0);
});

clause(BROKERAGE, "0:rule", "a character entering play under the opponent's control (their own deploy) does not trigger my Brokerage", () => {
  const game = brokerBoard({ turn: 2, active: P2, extra: res({ greed: 2 }, P2) });
  const { engine, id } = game;
  const before = ready(engine);
  play(engine, P2, id("oh0"));
  assert.equal(zoneOf(engine, id("oh0")), "play");
  assert.equal(engine.state.pendingChoice, undefined, "no prompt");
  assert.equal(ready(engine), before);
});

clause(BROKERAGE, "0:rule", "only characters count: an item, a location or a tactic does not trigger it", () => {
  const game = brokerBoard({ icons: { greed: 4 } });
  const { engine, id } = game;
  for (const key of ["hItem", "hPlace", "hTac"]) {
    play(engine, P1, id(key));
    assert.equal(engine.state.pendingChoice, undefined, `${key}: no prompt`);
  }
  assert.equal(revealEvents(engine).length, 0);
});

clause(BROKERAGE, "0:rule", "a card played face-down as a resource is not a character entering play: no prompt", () => {
  const game = brokerBoard();
  const { engine, id } = game;
  developResource(engine, P1, id("hc0"), true);
  assert.equal(engine.state.cards[id("hc0")].faceDown, true);
  assert.equal(engine.state.pendingChoice, undefined, "a face-down card is only a resource (CR 411.1)");
});

clause(BROKERAGE, "0:rule", "flipping a face-down character up makes a character enter play under my control: it triggers", () => {
  const game = brokerBoard({ icons: { greed: 3 }, extra: [{ key: "lob", def: printing(LOBBYIST), owner: P1, zone: "play", faceDown: true }] });
  const { engine, id } = game;
  flipUpRaw(engine, P1, id("lob"));
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("lob")].faceDown, false);
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
});

clause(BROKERAGE, "0:rule", "each character that enters play triggers it again: two characters, two separate offers", () => {
  const game = brokerBoard({ icons: { greed: 5 } });
  const { engine, id } = game;
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  play(engine, P1, id("hc2"));
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(zoneOf(engine, id("r0")), "hand");
  assert.equal(ready(engine), 3, "two payments of 1");
});

clause(BROKERAGE, "0:rule", "two Brokerages: each triggers separately, so a character offers two payments and two searches", () => {
  const game = brokerBoard({ icons: { greed: 5 }, extra: [{ key: "brok2", def: printing(BROKERAGE), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  play(engine, P1, id("hc0"));
  orderFirst(engine);
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  orderFirst(engine);
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(ready(engine), 3, "2 payments of 1");
  assert.equal(zoneOf(engine, id("g0")), "hand");
  assert.equal(zoneOf(engine, id("r0")), "hand");
});

clause(BROKERAGE, "0:rule", "the opponent's Brokerage offers THEM the choice when their character enters play", () => {
  const game = brokerBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "obrok", def: printing(BROKERAGE), owner: P2, zone: "play" },
      ...res({ greed: 3 }, P2)
    ]
  });
  const { engine, id } = game;
  play(engine, P2, id("oh0"));
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P2, "its controller decides");
  answerPending(engine, "mayPay", { pay: true });
  pickFromSearch(engine, id, ["og0"], P2);
  assert.equal(zoneOf(engine, id("og0")), "hand");
  assert.ok(handOf(engine, P2).includes(id("og0")), "handOf(engine, P2).includes(id(\"og0\"))");
});

clause(BROKERAGE, "0:rule", "it does nothing unless it is in play: in my hand, in my discard pile, or face-down as a resource", () => {
  for (const [label, opts] of [
    ["in hand", { brok: "hand" as const }],
    ["in the discard pile", { brok: "discard" as const }],
    ["face-down", { brok: "play" as const, brokFaceDown: true }]
  ] as const) {
    const game = brokerBoard(opts);
    play(game.engine, P1, game.id("hc0"));
    assert.equal(game.engine.state.pendingChoice, undefined, `${label}: no prompt`);
  }
});

clause(BROKERAGE, "0:rule", "the Brokerage is not depleted or used up: it keeps triggering turn after turn", () => {
  const game = brokerBoard({ icons: { greed: 6 }, turn: 1, active: P1 });
  const { engine, id } = game;
  play(engine, P1, id("hc0"));
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["g0"]);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  play(engine, P1, id("hc2"));
  answerMayPay(engine, true);
  pickFromSearch(engine, id, ["r0"]);
  assert.equal(zoneOf(engine, id("r0")), "hand");
  assert.equal(isDepleted(engine, id("brok")), false);
});

// =================================================================================
// Underpaid Ancestor
// If this card is put into your discard pile from play, you may pay 3. If you do, put it into
// play under your control. Deplete it.
// Character (ghost, mau), cost 5, [G], 3 strength / 2 speed / 4 life.
// =================================================================================

const ANCESTOR = "e747070f-874a-4653-aaaa-72ca26915593";

/** A free tactic (id "mv", pick "t"): moves one picked card in play to `to` (not a destruction). */
const moveFromPlayTactic = (to: "discard" | "hand" | "deck"): CardDefinition =>
  tactic({
    name: `Move to ${to}`,
    cost: 0,
    behavior: {
      abilities: [{ id: "mv", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to }] }]
    }
  });

function ancBoard(
  opts: {
    anc?: "play" | "hand" | "deck" | "discard";
    ancFaceDown?: boolean;
    ancOwner?: PlayerId;
    ancController?: PlayerId;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return devBoard(
    [
      { key: "anc", def: printing(ANCESTOR), owner: opts.ancOwner ?? P1, controller: opts.ancController, zone: opts.anc ?? "play", faceDown: opts.ancFaceDown },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 5, life: 9, speed: 2 }), owner: P2, zone: "play" },
      { key: "kill", def: destroyTactic("character"), owner: P1, zone: "hand" },
      { key: "kill2", def: destroyTactic("character"), owner: P1, zone: "hand" },
      { key: "okill", def: destroyTactic("character"), owner: P2, zone: "hand" },
      { key: "toDiscard", def: moveFromPlayTactic("discard"), owner: P1, zone: "hand" },
      { key: "toHand", def: moveFromPlayTactic("hand"), owner: P1, zone: "hand" },
      { key: "toDeck", def: moveFromPlayTactic("deck"), owner: P1, zone: "hand" },
      { key: "remove", def: removerTactic(), owner: P1, zone: "hand" },
      ...chars("d", 4, P1, "deck"),
      ...res(opts.icons ?? { greed: 5 }),
      ...res(opts.oppIcons ?? { greed: 5 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

/** A free tactic (id "rm", pick "t"): removes one picked card in play from the game. */
function removerTactic(): CardDefinition {
  return tactic({
    name: "Remover",
    cost: 0,
    behavior: { abilities: [{ id: "rm", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }] }
  });
}

type AncGame = ReturnType<typeof ancBoard>;
const killAnc = (game: AncGame, tacticKey = "kill", player: PlayerId = P1) => play(game.engine, player, game.id(tacticKey), { selected: { t: [game.id("anc")] } });

clause(ANCESTOR, "0:rule", "deploys for exactly its printed cost of 5 with [G]: one resource short and no [G] are refused; printed 3 strength / 2 speed / 4 life, ghost and mau", () => {
  const short = ancBoard({ anc: "hand", icons: { greed: 4 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("anc")), "4 resources: one short of 5");
  const noGreed = ancBoard({ anc: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("anc")), "no [G]");
  const game = ancBoard({ anc: "hand", icons: { greed: 6 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("anc"));
  assert.equal(before - ready(game.engine), 5);
  assert.equal(game.engine.getStat(game.id("anc"), "strength"), 3);
  assert.equal(game.engine.getStat(game.id("anc"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("anc"), "life"), 4);
  assert.deepEqual([...game.engine.getSubtypes(game.id("anc"))].sort(), ["ghost", "mau"]);
});

clause(ANCESTOR, "0:rule", "when it is destroyed I may pay 3: if I do it returns to play under my control, depleted", () => {
  const game = ancBoard();
  const { engine, id } = game;
  const before = ready(engine);
  killAnc(game);
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P1, "its controller decides");
  assert.equal(zoneOf(engine, id("anc")), "discard", "it is in the discard pile while I decide");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 3, "pay 3");
  assert.equal(zoneOf(engine, id("anc")), "play", "back in play");
  assert.equal(engine.state.cards[id("anc")].controllerId, P1, "under my control");
  assert.equal(isDepleted(engine, id("anc")), true, "'Deplete it'");
  assert.ok(!discardOf(engine, P1).includes(id("anc")), "!discardOf(engine, P1).includes(id(\"anc\"))");
  assert.ok(engine.state.players[P1].play.includes(id("anc")), "engine.state.players[P1].play.includes(id(\"anc\"))");
});

clause(ANCESTOR, "0:rule", "I may decline: it stays in the discard pile and nothing is paid", () => {
  const game = ancBoard();
  const { engine, id } = game;
  const before = ready(engine);
  killAnc(game);
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(zoneOf(engine, id("anc")), "discard");
  assert.equal(ready(engine), before);
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(ANCESTOR, "0:rule", "it returns as a fresh card: undamaged, with no damage carried over from the battle that destroyed it", () => {
  const game = ancBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackBy(engine, P2, [id("foe")]);
  declareBlockers(engine, P1, [id("anc")]);
  autoResolveBattle(engine);
  assert.equal(zoneOf(engine, id("anc")), "discard", "the 5-strength attacker destroyed the Ancestor");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
  assert.equal(damageOf(engine, id("anc")), 0, "no damage carried over");
  assert.equal(isDepleted(engine, id("anc")), true);
});

clause(ANCESTOR, "0:rule", "it triggers when destroyed in battle too (not only by tactics)", () => {
  const game = ancBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  declareAttackBy(engine, P2, [id("foe")]);
  declareBlockers(engine, P1, [id("anc")]);
  autoResolveBattle(engine);
  const pc = pending(engine);
  assert.equal(pc?.kind, "mayPay");
  assert.equal(pc?.playerId, P1);
});

clause(ANCESTOR, "0:rule", "I need to be able to pay 3: with only 2 resources I cannot pay, and it stays in the discard pile", () => {
  const game = ancBoard({ icons: { greed: 2 } });
  const { engine, id } = game;
  killAnc(game);
  if (pending(engine)?.kind === "mayPay") {
    refused(answerRaw(engine, P1, { kind: "mayPay", pay: true }), "2 resources cannot pay 3");
    answerPending(engine, "mayPay", { pay: false });
  }
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("anc")), "discard");
  assert.equal(ready(engine), 2, "nothing was paid");
});

clause(ANCESTOR, "0:rule", "exactly 3 resources is enough, and exactly 3 are paid", () => {
  const game = ancBoard({ icons: { greed: 3 } });
  killAnc(game);
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(zoneOf(game.engine, game.id("anc")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(ANCESTOR, "0:rule", "it triggers every time: after returning and being destroyed again I may pay 3 again", () => {
  const game = ancBoard({ icons: { greed: 8 } });
  const { engine, id } = game;
  killAnc(game);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
  killAnc(game, "kill2");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
  assert.equal(ready(engine), 2, "two payments of 3");
});

clause(ANCESTOR, "0:rule", "put into the discard pile from play by an effect that is not a destruction also triggers it", () => {
  const game = ancBoard();
  const { engine, id } = game;
  play(engine, P1, id("toDiscard"), { selected: { t: [id("anc")] } });
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
});

clause(ANCESTOR, "0:rule", "it does NOT trigger when it leaves play any other way: returned to hand, shuffled into the deck, or removed from the game", () => {
  for (const [tacticKey, expected] of [
    ["toHand", "hand"],
    ["toDeck", "deck"],
    ["remove", "removed"]
  ] as const) {
    const game = ancBoard();
    play(game.engine, P1, game.id(tacticKey), { selected: { t: [game.id("anc")] } });
    assert.equal(game.engine.state.pendingChoice, undefined, `${tacticKey}: no prompt`);
    assert.equal(zoneOf(game.engine, game.id("anc")), expected);
  }
});

clause(ANCESTOR, "0:rule", "it does NOT trigger when it goes to the discard pile from somewhere other than play: discarded from my hand, or milled from my deck", () => {
  const discarder = tactic({
    name: "Discarder",
    cost: 0,
    behavior: { abilities: [{ id: "dis", type: "activated", targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }] }] }
  });
  const hand = ancBoard({ anc: "hand", extra: [{ key: "dis", def: discarder, owner: P1, zone: "hand" }] });
  play(hand.engine, P1, hand.id("dis"), { selected: { t: [hand.id("anc")] } });
  assert.equal(zoneOf(hand.engine, hand.id("anc")), "discard");
  assert.equal(hand.engine.state.pendingChoice, undefined, "from hand: no prompt");
  const miller = tactic({
    name: "Miller",
    cost: 0,
    behavior: { abilities: [{ id: "mill", type: "activated", effects: [{ type: "moveCard", target: { type: "deckPosition", player: "controller", from: "top" }, to: "discard" }] }] }
  });
  const deck = ancBoard({ anc: "deck", extra: [{ key: "mill", def: miller, owner: P1, zone: "hand" }] });
  assert.equal(deckOf(deck.engine, P1)[0], deck.id("anc"), "the Ancestor is the top card of the deck");
  play(deck.engine, P1, deck.id("mill"));
  assert.equal(zoneOf(deck.engine, deck.id("anc")), "discard");
  assert.equal(deck.engine.state.pendingChoice, undefined, "from the deck: no prompt");
});

clause(ANCESTOR, "0:rule", "only its own death counts: another Ancestor dying does not offer this one anything", () => {
  const game = ancBoard({ extra: [{ key: "anc2", def: printing(ANCESTOR), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  play(engine, P1, id("kill"), { selected: { t: [id("anc2")] } });
  const pc = expectPending(engine, "mayPay");
  answerPending(engine, "mayPay", { pay: false });
  assert.equal(engine.state.pendingChoice, undefined, "exactly one offer: for the one that died");
  assert.equal(zoneOf(engine, id("anc")), "play", "the other Ancestor is untouched");
  assert.equal(pc.playerId, P1);
});

clause(ANCESTOR, "0:rule", "another character dying does not trigger it", () => {
  const game = ancBoard();
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("mine")] } });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("anc")), "play");
});

clause(ANCESTOR, "0:rule", "a face-down Ancestor is only a resource: destroying it offers nothing", () => {
  const game = ancBoard({ ancFaceDown: true, extra: [{ key: "killRes", def: destroyTactic("resource"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("killRes"), { selected: { t: [game.id("anc")] } });
  assert.equal(zoneOf(game.engine, game.id("anc")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "a face-down card has no rules text (CR 411.1)");
});

clause(ANCESTOR, "0:rule", "the opponent's Ancestor offers THEM the choice, and it returns under their control", () => {
  const game = ancBoard({ ancOwner: P2, turn: 1, active: P1 });
  const { engine, id } = game;
  play(engine, P1, id("kill"), { selected: { t: [id("anc")] } });
  const pc = expectPending(engine, "mayPay");
  assert.equal(pc.playerId, P2, "its controller (the opponent) decides");
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
  assert.equal(engine.state.cards[id("anc")].controllerId, P2);
  assert.equal(isDepleted(engine, id("anc")), true);
});

clause(ANCESTOR, "0:rule", "'your discard pile' means its controller's (CR 407.2): an Ancestor I own but the opponent controls goes to MY discard pile when destroyed, which is not THEIR discard pile, so it does not return", () => {
  const game = ancBoard({ ancOwner: P1, ancController: P2, turn: 1, active: P1 });
  const { engine, id } = game;
  play(engine, P1, id("kill"), { selected: { t: [id("anc")] } });
  assert.equal(zoneOf(engine, id("anc")), "discard");
  assert.ok(discardOf(engine, P1).includes(id("anc")), "it is in its owner's discard pile");
  assert.equal(engine.state.pendingChoice, undefined, "it was not put into its controller's discard pile, so there is no offer");
});

clause(ANCESTOR, "0:rule", "'your discard pile' means its controller's (CR 407.2): an Ancestor the opponent owns but I control goes to THEIR discard pile when destroyed, which is not MY discard pile, so it does not return", () => {
  const game = ancBoard({ ancOwner: P2, ancController: P1, turn: 1, active: P1 });
  const { engine, id } = game;
  play(engine, P1, id("kill"), { selected: { t: [id("anc")] } });
  assert.equal(zoneOf(engine, id("anc")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("anc")), "it is in its owner's (the opponent's) discard pile");
  assert.equal(engine.state.pendingChoice, undefined, "it was not put into MY discard pile, so there is no offer");
});

clause(ANCESTOR, "0:rule", "the returned Ancestor is depleted, so it cannot block until restored (my other character still can)", () => {
  const game = ancBoard({ turn: 2, active: P2 });
  const { engine, id } = game;
  play(engine, P2, id("okill"), { selected: { t: [id("anc")] } });
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(zoneOf(engine, id("anc")), "play");
  declareAttackBy(engine, P2, [id("foe")]);
  refused(() => declareBlockers(engine, P1, [id("anc")]), "a depleted character cannot block");
  declareBlockers(engine, P1, [id("mine")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("mine")], "control: an undepleted character can block");
});

clause(ANCESTOR, "0:rule", "it is restored normally at the start of my next turn", () => {
  const game = ancBoard({ turn: 1, active: P1 });
  const { engine, id } = game;
  killAnc(game);
  answerPending(engine, "mayPay", { pay: true });
  assert.equal(isDepleted(engine, id("anc")), true);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(isDepleted(engine, id("anc")), false, "restored");
});

// =================================================================================
// Unscrupulous Attendant
// If a character you control blocks, it gains 1 life this turn.
// Character (attendant), cost 4, [G], 2 strength / 2 speed / 3 life.
// =================================================================================

const ATTENDANT = "15baea7c-8f80-4afe-8348-7cd7bba42993";

function attendBoard(
  opts: { att?: "play" | "hand"; attFaceDown?: boolean; attController?: PlayerId; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "att", def: printing(ATTENDANT), owner: P1, controller: opts.attController, zone: opts.att ?? "play", faceDown: opts.attFaceDown },
      { key: "b1", def: character({ name: "B1", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "b2", def: character({ name: "B2", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "stolen", def: character({ name: "Stolen", strength: 1, life: 3, speed: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "atk2", def: character({ name: "Atk2", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" },
      { key: "ob", def: character({ name: "OppBlocker", strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { greed: 5 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type AttGame = ReturnType<typeof attendBoard>;
const attendAttack = (game: AttGame, attackers = ["atk"]) => declareAttackBy(game.engine, P2, attackers.map(game.id));

clause(ATTENDANT, "0:rule", "deploys for exactly its printed cost of 4 with [G]: one resource short and no [G] are refused; printed 2 strength / 2 speed / 3 life and the attendant subtype", () => {
  const short = attendBoard({ att: "hand", icons: { greed: 3 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("att")), "3 resources: one short of 4");
  const noGreed = attendBoard({ att: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("att")), "no [G]");
  const game = attendBoard({ att: "hand", icons: { greed: 5 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("att"));
  assert.equal(before - ready(game.engine), 4);
  assert.equal(game.engine.getStat(game.id("att"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("att"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("att"), "life"), 3);
  assert.deepEqual(game.engine.getSubtypes(game.id("att")), ["attendant"]);
});

clause(ATTENDANT, "0:rule", "a character I control that blocks gains exactly 1 life (and nothing else changes)", () => {
  const game = attendBoard();
  const { engine, id } = game;
  assert.equal(engine.getStat(id("b1"), "life"), 3);
  attendAttack(game);
  declareBlockers(engine, P1, [id("b1")]);
  assert.equal(engine.getStat(id("b1"), "life"), 4, "+1 life once it blocks");
  assert.equal(engine.getStat(id("b1"), "strength"), 1);
  assert.equal(engine.getStat(id("b1"), "speed"), 1);
});

clause(ATTENDANT, "0:rule", "the life is real: a 3-life blocker survives 3 battle damage with it, and without the Attendant it is destroyed", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game);
  declareBlockers(engine, P1, [id("b1")]);
  autoResolveBattle(engine);
  assert.equal(damageOf(engine, id("b1")), 3);
  assert.equal(zoneOf(engine, id("b1")), "play", "it survived with 4 life");
  const control = attendBoard({ att: "hand" });
  attendAttack(control);
  declareBlockers(control.engine, P1, [control.id("b1")]);
  autoResolveBattle(control.engine);
  assert.equal(zoneOf(control.engine, control.id("b1")), "discard", "control: without the Attendant 3 damage kills it");
});

clause(ATTENDANT, "0:rule", "every character I control that blocks gains the life: a blocking party of two gets +1 each", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game);
  declareBlockers(engine, P1, [id("b1"), id("b2")]);
  assert.equal(engine.getStat(id("b1"), "life"), 4);
  assert.equal(engine.getStat(id("b2"), "life"), 4);
});

clause(ATTENDANT, "0:rule", "the Attendant itself gains the life when it blocks", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game);
  declareBlockers(engine, P1, [id("att")]);
  assert.equal(engine.getStat(id("att"), "life"), 4);
});

clause(ATTENDANT, "0:rule", "a character I control but do not own counts ('a character you control')", () => {
  const game = attendBoard();
  attendAttack(game);
  declareBlockers(game.engine, P1, [game.id("stolen")]);
  assert.equal(game.engine.getStat(game.id("stolen"), "life"), 4);
});

clause(ATTENDANT, "0:rule", "only characters that block gain it: characters that do not block, and the attackers, are unaffected", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game, ["atk", "atk2"]);
  declareBlockers(engine, P1, [id("b1")]);
  assert.equal(engine.getStat(id("b2"), "life"), 3, "my non-blocking character");
  assert.equal(engine.getStat(id("att"), "life"), 3, "the Attendant, which did not block");
  assert.equal(engine.getStat(id("atk"), "life"), 5, "an attacker");
  assert.equal(engine.getStat(id("atk2"), "life"), 5);
});

clause(ATTENDANT, "0:rule", "an opposing character that blocks (my attack) gains nothing: only characters I control", () => {
  const game = attendBoard({ turn: 2, active: P1 });
  const { engine, id } = game;
  declareAttackBy(engine, P1, [id("b1")]);
  declareBlockers(engine, P2, [id("ob")]);
  assert.equal(engine.getStat(id("ob"), "life"), 3, "their blocker is not 'a character you control'");
  assert.equal(engine.getStat(id("b1"), "life"), 3, "and my attacker gains nothing either");
});

clause(ATTENDANT, "0:rule", "declaring no blockers gives nothing", () => {
  const game = attendBoard();
  attendAttack(game);
  declareBlockers(game.engine, P1, []);
  for (const key of ["att", "b1", "b2", "stolen"]) assert.equal(game.engine.getStat(game.id(key), "life"), 3, `${key} unchanged`);
});

clause(ATTENDANT, "0:rule", "'this turn': the extra life is gone when the turn ends", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game);
  declareBlockers(engine, P1, [id("b1")]);
  assert.equal(engine.getStat(id("b1"), "life"), 4);
  autoResolveBattle(engine);
  assert.equal(engine.getStat(id("b1"), "life"), 4, "still this turn after the battle");
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1);
  assert.equal(engine.getStat(id("b1"), "life"), 3, "back to its printed life");
});

clause(ATTENDANT, "0:rule", "it triggers each time a character blocks: a second battle the same turn with another blocker gives that blocker its own +1 life", () => {
  const game = attendBoard();
  const { engine, id } = game;
  attendAttack(game, ["atk2"]);
  declareBlockers(engine, P1, [id("b1")]);
  autoResolveBattle(engine);
  assert.equal(engine.getStat(id("b1"), "life"), 4);
  declareAttackBy(engine, P2, [id("atk")]);
  declareBlockers(engine, P1, [id("b2")]);
  assert.equal(engine.getStat(id("b2"), "life"), 4, "the second blocker gains its own life");
  assert.equal(engine.getStat(id("b1"), "life"), 4, "and the first one keeps its gain for the turn");
});

clause(ATTENDANT, "0:rule", "two Attendants stack: a blocker gains 2 life (I order the two triggers)", () => {
  const game = attendBoard({ extra: [{ key: "att2", def: printing(ATTENDANT), owner: P1, zone: "play" }] });
  const { engine, id } = game;
  attendAttack(game);
  declareBlockers(engine, P1, [id("b1")]);
  const pc = pending(engine);
  assert.equal(pc?.kind, "orderTriggers", "two triggers from my cards at once: I choose the order (FAQ)");
  assert.equal(pc?.playerId, P1);
  orderFirst(engine);
  assert.equal(engine.getStat(id("b1"), "life"), 5);
});

clause(ATTENDANT, "0:rule", "it does nothing when it is not in play: in hand, or face-down as a resource", () => {
  const inHand = attendBoard({ att: "hand" });
  attendAttack(inHand);
  declareBlockers(inHand.engine, P1, [inHand.id("b1")]);
  assert.equal(inHand.engine.getStat(inHand.id("b1"), "life"), 3);
  const faceDown = attendBoard({ attFaceDown: true });
  attendAttack(faceDown);
  declareBlockers(faceDown.engine, P1, [faceDown.id("b1")]);
  assert.equal(faceDown.engine.getStat(faceDown.id("b1"), "life"), 3, "a face-down Attendant is only a resource");
});

clause(ATTENDANT, "0:rule", "it belongs to its controller: the opponent's Attendant buffs THEIR blockers, not mine", () => {
  const game = attendBoard({ att: "play", attController: P2, turn: 2, active: P1 });
  const { engine, id } = game;
  declareAttackBy(engine, P1, [id("b1")]);
  declareBlockers(engine, P2, [id("ob")]);
  assert.equal(engine.getStat(id("ob"), "life"), 4, "their Attendant buffs their blocker");
  const mine = attendBoard({ att: "play", attController: P2 });
  attendAttack(mine);
  declareBlockers(mine.engine, P1, [mine.id("b1")]);
  assert.equal(mine.engine.getStat(mine.id("b1"), "life"), 3, "their Attendant does not buff my blocker");
});

// =================================================================================
// Walk the Plank
// Destroy all characters with numeric cost X or less, where X is the number of [G] you control.
// Tactic (banker), cost 7, [G].
// =================================================================================

const PLANK = "55bbc252-d0dc-4226-9d7e-cfb8bd80755b";

const COSTS = [0, 2, 3, 4, 7, 8] as const;

function plankBoard(
  opts: { icons?: Icons; spentGreed?: number; oppGreed?: number; faceDown?: number; plank?: "hand" | "discard"; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "plank", def: printing(PLANK), owner: P1, zone: opts.plank ?? "hand" },
      ...COSTS.map((cost) => ({ key: `m${cost}`, def: character({ name: `Mine${cost}`, cost, strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" as const })),
      ...COSTS.map((cost) => ({ key: `f${cost}`, def: character({ name: `Foe${cost}`, cost, strength: 1, life: 3, speed: 1 }), owner: P2, zone: "play" as const })),
      { key: "thing", def: item({ name: "Thing", cost: 0 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" },
      { key: "inHand", def: character({ name: "InHand", cost: 0 }), owner: P2, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard", cost: 0 }), owner: P2, zone: "discard" },
      ...res(opts.icons ?? { greed: 7 }),
      ...spentRes("greed", P1, opts.spentGreed ?? 0),
      ...volition(opts.faceDown ?? 0, P1),
      ...res({ greed: opts.oppGreed ?? 0 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type PlankGame = ReturnType<typeof plankBoard>;
const survivors = (game: PlankGame): string[] =>
  COSTS.flatMap((cost) => [`m${cost}`, `f${cost}`]).filter((key) => zoneOf(game.engine, game.id(key)) === "play");

function assertDestroyedUpTo(game: PlankGame, x: number): void {
  for (const cost of COSTS) {
    for (const side of ["m", "f"]) {
      const key = `${side}${cost}`;
      assert.equal(zoneOf(game.engine, game.id(key)), cost <= x ? "discard" : "play", `${key} (cost ${cost}) with X = ${x}`);
    }
  }
}

clause(PLANK, "0:rule", "deploys for exactly its printed cost of 7 with [G]: six resources or no [G] is refused", () => {
  const short = plankBoard({ icons: { greed: 6 } });
  refused(() => playRaw(short.engine, P1, short.id("plank")), "6 resources: one short of 7");
  assert.equal(zoneOf(short.engine, short.id("plank")), "hand");
  const noGreed = plankBoard({ icons: { rage: 9 } });
  refused(() => playRaw(noGreed.engine, P1, noGreed.id("plank")), "no [G]");
  const game = plankBoard({ icons: { greed: 8 } });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("plank"));
  assert.equal(before - ready(game.engine), 7);
  assert.equal(game.engine.getDefinition(game.id("plank")).type, "tactic");
  assert.equal(zoneOf(game.engine, game.id("plank")), "discard");
});

clause(PLANK, "0:rule", "with seven [G] (X = 7) every character with cost 7 or less is destroyed, mine and theirs, and costlier ones survive", () => {
  const game = plankBoard({ icons: { greed: 7 } });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 7);
  assert.deepEqual(survivors(game).sort(), ["f8", "m8"]);
});

clause(PLANK, "0:rule", "X counts only [G]: with [G]x3 and four other resources (X = 3) only characters of cost 3 or less are destroyed", () => {
  const game = plankBoard({ icons: { greed: 3, rage: 4 } });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 3);
  assert.equal(zoneOf(game.engine, game.id("m4")), "play", "cost 4 is more than X");
  assert.equal(zoneOf(game.engine, game.id("f3")), "discard", "cost 3 is exactly X");
});

clause(PLANK, "0:rule", "with a single [G] (X = 1) only cost 0 and 1 characters die", () => {
  const game = plankBoard({ icons: { greed: 1, rage: 6 } });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 1);
  assert.deepEqual(survivors(game).sort(), ["f2", "f3", "f4", "f7", "f8", "m2", "m3", "m4", "m7", "m8"]);
});

clause(PLANK, "0:rule", "X can exceed the cost I paid: nine [G] (X = 9) destroys every character, even cost 8", () => {
  const game = plankBoard({ icons: { greed: 9 } });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 9);
  assert.deepEqual(survivors(game), []);
});

clause(PLANK, "0:rule", "the [G] I spend paying for it still count (I control them): seven spent [G] (X = 7)", () => {
  const game = plankBoard({ icons: { rage: 7 }, spentGreed: 7 });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 7);
});

clause(PLANK, "0:rule", "spent [G] count too, but face-down resources (Volition) and the opponent's [G] do not (X = 2, not 7)", () => {
  const game = plankBoard({ icons: { greed: 2, rage: 5 }, faceDown: 3, oppGreed: 6 });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 2);
});

clause(PLANK, "0:rule", "any resource providing [G] counts, staple or not", () => {
  const game = plankBoard({ icons: { greed: 1, rage: 6 }, extra: [{ key: "odd", def: oddResource(), owner: P1, zone: "play" }, { key: "odd2", def: oddResource("Odd Coin 2"), owner: P1, zone: "play" }] });
  play(game.engine, P1, game.id("plank"));
  assertDestroyedUpTo(game, 3);
});

clause(PLANK, "0:rule", "only characters in play are destroyed: items, locations, face-down cards, cards in hand or discard and factions are untouched", () => {
  const game = plankBoard({ icons: { greed: 7 }, extra: [{ key: "fd", def: character({ name: "FaceDownGuy", cost: 0 }), owner: P2, zone: "play", faceDown: true }] });
  play(game.engine, P1, game.id("plank"));
  assert.equal(zoneOf(game.engine, game.id("thing")), "play");
  assert.equal(zoneOf(game.engine, game.id("place")), "play");
  assert.equal(zoneOf(game.engine, game.id("fd")), "play", "a face-down card is not a character");
  assert.equal(zoneOf(game.engine, game.id("inHand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "discard");
  assert.equal(zoneOf(game.engine, game.engine.state.players[P1].factionId!), "play");
  assert.equal(zoneOf(game.engine, game.engine.state.players[P2].factionId!), "play");
});

clause(PLANK, "0:rule", "the destroyed characters go to their owners' discard piles", () => {
  const game = plankBoard({ icons: { greed: 3, rage: 4 } });
  play(game.engine, P1, game.id("plank"));
  assert.ok(discardOf(game.engine, P1).includes(game.id("m2")), "discardOf(game.engine, P1).includes(game.id(\"m2\"))");
  assert.ok(discardOf(game.engine, P2).includes(game.id("f2")), "discardOf(game.engine, P2).includes(game.id(\"f2\"))");
  assert.ok(!discardOf(game.engine, P2).includes(game.id("m2")), "!discardOf(game.engine, P2).includes(game.id(\"m2\"))");
});

clause(PLANK, "0:rule", "a character I control but the opponent owns is destroyed too (it says 'all characters') and goes to its owner's pile", () => {
  const game = plankBoard({ icons: { greed: 3, rage: 4 }, extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" }] });
  play(game.engine, P1, game.id("plank"));
  assert.equal(zoneOf(game.engine, game.id("stolen")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("stolen")), "discardOf(game.engine, P2).includes(game.id(\"stolen\"))");
});

clause(PLANK, "0:rule", "X is counted when it resolves: if one of my [G] is destroyed in response, X is smaller (7 -> 6) and a cost-7 character survives", () => {
  const game = plankBoard({ icons: { greed: 8 }, extra: [{ key: "killRes", def: destroyTactic("resource"), owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  playRaw(engine, P1, id("plank"));
  const myGreed = engine.state.players[P1].play.filter((c) => engine.isResource(c));
  assert.equal(myGreed.length, 8);
  respondWith(engine, P2, id("killRes"), { t: [myGreed[0]] });
  assert.equal(zoneOf(engine, myGreed[0]), "discard", "one [G] is gone");
  assertDestroyedUpTo(game, 7);
  const control = plankBoard({ icons: { greed: 7 }, extra: [{ key: "killRes", def: destroyTactic("resource"), owner: P2, zone: "hand" }] });
  playRaw(control.engine, P1, control.id("plank"));
  const greed = control.engine.state.players[P1].play.filter((c) => control.engine.isResource(c));
  respondWith(control.engine, P2, control.id("killRes"), { t: [greed[0]] });
  assertDestroyedUpTo(control, 6);
  assert.equal(zoneOf(control.engine, control.id("m7")), "play", "with only six [G] left, a cost-7 character survives");
});

clause(PLANK, "0:rule", "it is a tactic: it can be played in response to the opponent's attack, destroying the attackers within X", () => {
  const game = plankBoard({ icons: { greed: 7 }, turn: 2, active: P2 });
  const { engine, id } = game;
  refused(() => playRaw(engine, P1, id("plank")), "no window is open yet");
  declareAttackOpenWindow(engine, P2, [id("f2")]);
  playRaw(engine, P1, id("plank"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("f2")), "discard");
  assert.deepEqual(battleOf(engine)?.attackingParty ?? [], []);
});

// =================================================================================
// 313373 M3ch4n1c
// REPAIR -- COST: Choose a number for X that is less than or equal to the number of [E] you
// control. Pay X. Destroy this card. Pick an item in your discard pile with numeric cost X or
// less. -- EFFECT: Put the item into play under your control.
// Character (31f), cost 3, [E], 2 strength / 3 speed / 2 life.
// =================================================================================

const MECHANIC = "e212b965-7c46-440f-b45c-86fb5204f6dd";

function mechBoard(
  opts: { mech?: "play" | "hand"; icons?: Icons; spentElitism?: number; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "mech", def: printing(MECHANIC), owner: P1, zone: opts.mech ?? "play" },
      { key: "i0", def: item({ name: "Item0", cost: 0 }), owner: P1, zone: "discard" },
      { key: "i1", def: item({ name: "Item1", cost: 1 }), owner: P1, zone: "discard" },
      { key: "i2", def: item({ name: "Item2", cost: 2 }), owner: P1, zone: "discard" },
      { key: "i3", def: item({ name: "Item3", cost: 3 }), owner: P1, zone: "discard" },
      { key: "i5", def: item({ name: "Item5", cost: 5 }), owner: P1, zone: "discard" },
      {
        key: "iEcho",
        def: item({
          name: "ItemEcho",
          cost: 2,
          behavior: { abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
        }),
        owner: P1,
        zone: "discard"
      },
      { key: "dChar", def: character({ name: "DiscChar", cost: 1 }), owner: P1, zone: "discard" },
      { key: "dTac", def: tactic({ name: "DiscTactic", cost: 1 }), owner: P1, zone: "discard" },
      { key: "dPlace", def: location({ name: "DiscPlace", cost: 1 }), owner: P1, zone: "discard" },
      { key: "oi1", def: item({ name: "OppItem1", cost: 1 }), owner: P2, zone: "discard" },
      { key: "hi", def: item({ name: "HandItem", cost: 1 }), owner: P1, zone: "hand" },
      { key: "pi", def: item({ name: "PlayItem", cost: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...chars("d", 4, P1, "deck"),
      ...res(opts.icons ?? { elitism: 3, rage: 2 }),
      ...spentRes("elitism", P1, opts.spentElitism ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type MechGame = ReturnType<typeof mechBoard>;
const repair = (game: MechGame, x: number, itemKey: string, player: PlayerId = P1) =>
  activate(game.engine, player, game.id("mech"), "repair", { selected: { it: [game.id(itemKey)] }, variables: { x } });
const repairRaw = (game: MechGame, x: number, itemKey?: string, player: PlayerId = P1) =>
  actRaw(game.engine, player, game.id("mech"), "repair", itemKey ? { it: [game.id(itemKey)] } : {}, { x });

clause(MECHANIC, "0:ability:repair", "deploys for exactly its printed cost of 3 with [E]: two resources or no [E] is refused; printed 2 strength / 3 speed / 2 life and the 31f subtype", () => {
  const short = mechBoard({ mech: "hand", icons: { elitism: 2 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("mech")), "2 resources: one short of 3");
  const noE = mechBoard({ mech: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noE.engine, P1, noE.id("mech")), "no [E]");
  const game = mechBoard({ mech: "hand", icons: { elitism: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("mech"));
  assert.equal(before - ready(game.engine), 3);
  assert.equal(game.engine.getStat(game.id("mech"), "strength"), 2);
  assert.equal(game.engine.getStat(game.id("mech"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("mech"), "life"), 2);
  assert.deepEqual(game.engine.getSubtypes(game.id("mech")), ["31f"]);
});

clause(MECHANIC, "0:ability:repair", "X = 2: pays exactly 2 and destroys the Mechanic as the cost, then puts the picked item (cost 2) into play under my control", () => {
  const game = mechBoard();
  const { engine, id } = game;
  const before = ready(engine);
  repairRaw(game, 2, "i2");
  assert.equal(before - ready(engine), 2, "Pay X");
  assert.equal(zoneOf(engine, id("mech")), "discard", "Destroy this card is a cost");
  assert.ok(discardOf(engine, P1).includes(id("mech")), "the Mechanic is in its owner's discard pile");
  assert.equal(zoneOf(engine, id("i2")), "discard", "the item is still in the discard pile while the ability waits");
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("i2")), "play");
  assert.equal(engine.state.cards[id("i2")].controllerId, P1, "under my control");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MECHANIC, "0:ability:repair", "X = 0 is legal: it pays nothing and can fetch a cost-0 item only", () => {
  const game = mechBoard();
  const { engine, id } = game;
  const before = ready(engine);
  refused(() => repairRaw(game, 0, "i1"), "cost 1 is more than X = 0");
  assert.equal(zoneOf(engine, id("mech")), "play", "nothing was paid or destroyed by the refused attempt");
  repair(game, 0, "i0");
  assert.equal(ready(engine), before, "nothing paid");
  assert.equal(zoneOf(engine, id("i0")), "play");
  assert.equal(zoneOf(engine, id("mech")), "discard");
});

for (const [x, picks] of [
  [1, ["i0", "i1"]],
  [2, ["i0", "i1", "i2"]],
  [3, ["i0", "i1", "i2", "i3"]]
] as const) {
  clause(MECHANIC, "0:ability:repair", `X = ${x}: an item of numeric cost ${x} or less can be picked, and each costs exactly ${x} resources`, () => {
    for (const key of picks) {
      const game = mechBoard();
      const before = ready(game.engine);
      repair(game, x, key);
      assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} with X = ${x}`);
      assert.equal(before - ready(game.engine), x, "Pay X");
    }
  });
}

clause(MECHANIC, "0:ability:repair", "an item costing more than X cannot be picked (cost 3 with X = 2, cost 5 with X = 3)", () => {
  const a = mechBoard();
  refused(() => repairRaw(a, 2, "i3"), "cost 3 with X = 2");
  assert.equal(zoneOf(a.engine, a.id("i3")), "discard");
  assert.equal(zoneOf(a.engine, a.id("mech")), "play");
  assert.equal(ready(a.engine), 5, "nothing paid");
  const b = mechBoard();
  refused(() => repairRaw(b, 3, "i5"), "cost 5 with X = 3");
  repair(b, 3, "i3");
  assert.equal(zoneOf(b.engine, b.id("i3")), "play", "control");
});

clause(MECHANIC, "0:ability:repair", "X cannot exceed the number of [E] I control: with [E][E] and four other resources, X = 3 is refused and X = 2 is accepted", () => {
  const game = mechBoard({ icons: { elitism: 2, rage: 4 } });
  refused(() => repairRaw(game, 3, "i3"), "X = 3 with two [E]");
  refused(() => repairRaw(game, 4, "i3"), "X = 4 with two [E]");
  assert.equal(zoneOf(game.engine, game.id("mech")), "play");
  assert.equal(ready(game.engine), 6, "nothing was paid");
  repair(game, 2, "i2");
  assert.equal(zoneOf(game.engine, game.id("i2")), "play", "control: X = 2");
  assert.equal(ready(game.engine), 4);
});

clause(MECHANIC, "0:ability:repair", "the X resources may be any resources, not only [E]: with two [E] and four rage, X = 2 can be paid with rage and still leave [E]", () => {
  const game = mechBoard({ icons: { elitism: 2, rage: 4 } });
  repair(game, 2, "i2");
  assert.equal(ready(game.engine), 4, "two of six resources were paid");
});

clause(MECHANIC, "0:ability:repair", "X must be a number from 0 up: a negative X is refused", () => {
  const game = mechBoard();
  refused(() => repairRaw(game, -1, "i0"), "X = -1");
  assert.equal(zoneOf(game.engine, game.id("mech")), "play");
  assert.equal(ready(game.engine), 5);
});

clause(MECHANIC, "0:ability:repair", "X must be a whole number (CR 410.2): X = 1.5 is refused", () => {
  const game = mechBoard();
  refused(() => repairRaw(game, 1.5, "i1"), "X = 1.5");
  assert.equal(zoneOf(game.engine, game.id("mech")), "play");
  assert.equal(ready(game.engine), 5, "nothing was paid");
});

clause(MECHANIC, "0:ability:repair", "spent [E] still count towards the limit on X (I control them), but X resources must still be available to pay: three spent [E] allow X = 3 only if three resources are ready", () => {
  const nothingReady = mechBoard({ icons: {}, spentElitism: 3 });
  refused(() => repairRaw(nothingReady, 3, "i3"), "three [E] controlled but nothing left to pay with");
  assert.equal(zoneOf(nothingReady.engine, nothingReady.id("mech")), "play");
  repair(nothingReady, 0, "i0");
  assert.equal(zoneOf(nothingReady.engine, nothingReady.id("i0")), "play", "X = 0 needs no payment");
  const withReady = mechBoard({ icons: { rage: 3 }, spentElitism: 3 });
  repair(withReady, 3, "i3");
  assert.equal(zoneOf(withReady.engine, withReady.id("i3")), "play", "the three spent [E] set the limit, three rage pay");
  assert.equal(ready(withReady.engine), 0);
});

clause(MECHANIC, "0:ability:repair", "no [E] at all means X = 0 only", () => {
  const game = mechBoard({ icons: { rage: 5 } });
  refused(() => repairRaw(game, 1, "i1"), "X = 1 with no [E]");
  repair(game, 0, "i0");
  assert.equal(zoneOf(game.engine, game.id("i0")), "play");
});

clause(MECHANIC, "0:ability:repair", "only an ITEM in MY discard pile can be picked: a character, tactic or location there, the opponent's item, an item in hand or in play are refused", () => {
  const game = mechBoard();
  for (const [key, why] of [
    ["dChar", "a character in my discard pile"],
    ["dTac", "a tactic in my discard pile"],
    ["dPlace", "a location in my discard pile"],
    ["oi1", "an item in the opponent's discard pile"],
    ["hi", "an item in my hand"],
    ["pi", "an item in play"],
    ["foe", "a character in play"]
  ] as const) {
    refused(() => repairRaw(game, 3, key), why);
    assert.equal(zoneOf(game.engine, game.id("mech")), "play", `${why}: the Mechanic was not destroyed`);
  }
  refused(() => repairRaw(game, 3), "no pick");
  refused(() => actRaw(game.engine, P1, game.id("mech"), "repair", { it: [game.id("i1"), game.id("i2")] }, { x: 3 }), "two picks");
  assert.equal(ready(game.engine), 5, "nothing was paid by any refused attempt");
  repair(game, 3, "i1");
  assert.equal(zoneOf(game.engine, game.id("i1")), "play", "control: an item in my discard pile works");
});

clause(MECHANIC, "0:ability:repair", "only the picked item is put into play: the other items in my discard pile and the opponent's stay", () => {
  const game = mechBoard();
  repair(game, 3, "i2");
  for (const key of ["i0", "i1", "i3", "i5", "iEcho", "dChar", "dTac", "dPlace", "oi1"]) assert.equal(zoneOf(game.engine, game.id(key)), "discard", `${key} stays`);
});

clause(MECHANIC, "0:ability:repair", "the item enters play for real: its 'enters play' trigger fires (it draws me a card)", () => {
  const game = mechBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const top = deckOf(engine, P1)[0];
  repair(game, 2, "iEcho");
  drain(engine, declineAll);
  assert.equal(zoneOf(engine, id("iEcho")), "play");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.equal(zoneOf(engine, top), "hand");
});

clause(MECHANIC, "0:ability:repair", "the Mechanic is destroyed even if the effect then finds nothing: if the item leaves the discard pile in response the cost stays paid", () => {
  const exiler = tactic({
    name: "Exiler",
    cost: 0,
    behavior: { abilities: [{ id: "ex", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const game = mechBoard({ extra: [{ key: "ex", def: exiler, owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  repairRaw(game, 2, "i2");
  respondWith(engine, P2, id("ex"), { t: [id("i2")] });
  assert.equal(zoneOf(engine, id("mech")), "discard", "the Mechanic was destroyed as a cost");
  assert.equal(ready(engine), 3, "X was paid");
});

clause(MECHANIC, "0:ability:repair", "if the picked item leaves the discard pile in response, the effect loses track of it and nothing is put into play (CR 402.4)", () => {
  const bouncer = tactic({
    name: "Bouncer",
    cost: 0,
    behavior: { abilities: [{ id: "ex", type: "activated", targets: [{ id: "t", selector: { zone: "discard", type: "item" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }] }
  });
  const game = mechBoard({ extra: [{ key: "ex", def: bouncer, owner: P2, zone: "hand" }] });
  const { engine, id } = game;
  repairRaw(game, 2, "i2");
  respondWith(engine, P2, id("ex"), { t: [id("i2")] });
  assert.equal(zoneOf(engine, id("i2")), "hand", "the item went to its owner's hand in response");
  assert.equal(engine.state.players[P1].play.includes(id("i2")), false, "it is not put into play from the hand");
});

clause(MECHANIC, "0:ability:repair", "is refused when there is no item in my discard pile, and nothing is destroyed", () => {
  const { engine, id } = devBoard([
    { key: "mech", def: printing(MECHANIC), owner: P1, zone: "play" },
    { key: "dChar", def: character({ name: "DiscChar", cost: 0 }), owner: P1, zone: "discard" },
    ...res({ elitism: 3 })
  ]);
  refused(() => actRaw(engine, P1, id("mech"), "repair", {}, { x: 0 }), "nothing to pick");
  refused(() => actRaw(engine, P1, id("mech"), "repair", { it: [id("dChar")] }, { x: 0 }), "a character is not an item");
  assert.equal(zoneOf(engine, id("mech")), "play");
});

clause(MECHANIC, "0:ability:repair", "it can be used the turn the Mechanic enters play, and on the opponent's turn in response", () => {
  const fresh = mechBoard({ mech: "hand", icons: { elitism: 4, rage: 2 }, turn: 1, active: P1 });
  play(fresh.engine, P1, fresh.id("mech"));
  repair(fresh, 1, "i1");
  assert.equal(zoneOf(fresh.engine, fresh.id("i1")), "play");
  const response = mechBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(response.engine, P2, [response.id("foe")]);
  actRaw(response.engine, P1, response.id("mech"), "repair", { it: [response.id("i2")] }, { x: 2 });
  resolvePendingResponses(response.engine);
  assert.equal(zoneOf(response.engine, response.id("i2")), "play");
});

clause(MECHANIC, "0:ability:repair", "only the Mechanic's controller can use it, and only while it is in play", () => {
  const theirs = mechBoard({ turn: 2, active: P2, extra: res({ elitism: 3 }, P2) });
  refused(() => repairRaw(theirs, 2, "i2", P2), "not its controller");
  const inHand = mechBoard({ mech: "hand" });
  refused(() => repairRaw(inHand, 2, "i2"), "the Mechanic is in my hand");
});

// =================================================================================
// 53cur17y 5y573m
// COVERT parties can be blocked by characters without COVERT.
// FLIP UP: 2 [E]
// Location (gearsmith), cost 4, [E], structure 5.
// =================================================================================

const SECURITY = "7e73ff48-a894-408a-a176-76bedfebc97d";

const covertChar = (name: string, extra: Partial<CardDefinition> = {}): CardDefinition =>
  character({ name, strength: 2, life: 5, speed: 2, behavior: { keywords: ["covert"] }, ...extra });

function secBoard(
  opts: {
    sec?: "play" | "hand" | "discard" | "faceDown" | "faceUp";
    secController?: PlayerId;
    secSpent?: boolean;
    icons?: Icons;
    spentElitism?: number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const sec = opts.sec ?? "play";
  return devBoard(
    [
      {
        key: "sec",
        def: printing(SECURITY),
        owner: P1,
        controller: opts.secController,
        zone: sec === "hand" ? "hand" : sec === "discard" ? "discard" : "play",
        faceDown: sec === "faceDown" ? true : undefined,
        attachedToKey: opts.secSpent ? "__factionA" : undefined
      },
      { key: "cov1", def: covertChar("Cov1"), owner: P1, zone: "play" },
      { key: "plain1", def: character({ name: "Plain1", strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "ocov1", def: covertChar("OppCov1"), owner: P2, zone: "play" },
      { key: "ocov2", def: covertChar("OppCov2"), owner: P2, zone: "play" },
      { key: "oplain1", def: character({ name: "OppPlain1", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "oplain2", def: character({ name: "OppPlain2", strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { elitism: 4 }),
      ...spentRes("elitism", P1, opts.spentElitism ?? 0),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}

type SecGame = ReturnType<typeof secBoard>;

clause(SECURITY, "0:rule", "deploys for exactly its printed cost of 4 with [E]: one resource short and no [E] are refused; structure 5", () => {
  const short = secBoard({ sec: "hand", icons: { elitism: 3 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("sec")), "3 resources: one short of 4");
  const noE = secBoard({ sec: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noE.engine, P1, noE.id("sec")), "no [E]");
  const game = secBoard({ sec: "hand", icons: { elitism: 5 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("sec"));
  assert.equal(before - ready(game.engine), 4);
  assert.equal(game.engine.getDefinition(game.id("sec")).type, "location");
  assert.equal(game.engine.getDefinition(game.id("sec")).structure, 5);
});

clause(SECURITY, "0:rule", "control: without it a covert attacking party cannot be blocked by a non-covert character, but a covert one can block it", () => {
  const game = secBoard({ sec: "hand" });
  declareAttackBy(game.engine, P2, [game.id("ocov1")]);
  refused(() => declareBlockers(game.engine, P1, [game.id("plain1")]), "a non-covert character cannot block a covert party");
  declareBlockers(game.engine, P1, [game.id("cov1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("cov1")]);
});

clause(SECURITY, "0:rule", "while it is in play a covert party CAN be blocked by a character without COVERT", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("ocov1")]);
  declareBlockers(game.engine, P1, [game.id("plain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plain1")], "a non-covert character blocks the covert attacker");
});

clause(SECURITY, "0:rule", "a covert party of two attackers can be blocked by non-covert characters too", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("ocov1"), game.id("ocov2")]);
  declareBlockers(game.engine, P1, [game.id("plain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plain1")]);
});

clause(SECURITY, "0:rule", "a blocking party mixing a covert and a non-covert character is accepted against a covert party", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("ocov1")]);
  declareBlockers(game.engine, P1, [game.id("plain1"), game.id("cov1")]);
  assert.equal(battleOf(game.engine)?.blockingParty.length, 2);
});

clause(SECURITY, "0:rule", "the block is real: the non-covert blocker takes the covert attacker's battle damage", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("ocov1")]);
  declareBlockers(game.engine, P1, [game.id("plain1")]);
  autoResolveBattle(game.engine);
  assert.equal(damageOf(game.engine, game.id("plain1")), 2);
  assert.equal(influenceOf(game.engine, P1), START, "the attack did not reach my faction");
});

clause(SECURITY, "0:rule", "it works for BOTH players' covert parties: my covert attacker can be blocked by the opponent's non-covert character", () => {
  const game = secBoard({ turn: 2, active: P1 });
  declareAttackBy(game.engine, P1, [game.id("cov1")]);
  declareBlockers(game.engine, P2, [game.id("oplain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("oplain1")]);
  const control = secBoard({ sec: "hand", turn: 2, active: P1 });
  declareAttackBy(control.engine, P1, [control.id("cov1")]);
  refused(() => declareBlockers(control.engine, P2, [control.id("oplain1")]), "control: without it they cannot");
});

clause(SECURITY, "0:rule", "it does not matter who controls it: a Security System controlled by the opponent has the same effect on my covert party", () => {
  const game = secBoard({ secController: P2, turn: 2, active: P1 });
  declareAttackBy(game.engine, P1, [game.id("cov1")]);
  declareBlockers(game.engine, P2, [game.id("oplain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("oplain1")]);
});

clause(SECURITY, "0:rule", "it only changes what can block a covert party: a covert character still cannot block a non-covert party", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("oplain1")]);
  refused(() => declareBlockers(game.engine, P1, [game.id("cov1")]), "a covert character may block only a covert party (CR 507.3c)");
  declareBlockers(game.engine, P1, [game.id("plain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plain1")], "control: a non-covert character blocks a non-covert party as ever");
});

clause(SECURITY, "0:rule", "a non-covert party (or a party with a non-covert member) can be blocked by non-covert characters either way", () => {
  const game = secBoard();
  declareAttackBy(game.engine, P2, [game.id("ocov1"), game.id("oplain1")]);
  declareBlockers(game.engine, P1, [game.id("plain1")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plain1")]);
});

clause(SECURITY, "0:rule", "it only works while in play: in hand, in the discard pile or face-down as a resource, a non-covert character still cannot block a covert party", () => {
  for (const sec of ["hand", "discard", "faceDown"] as const) {
    const game = secBoard({ sec });
    declareAttackBy(game.engine, P2, [game.id("ocov1")]);
    refused(() => declareBlockers(game.engine, P1, [game.id("plain1")]), `Security System ${sec}`);
  }
});

clause(SECURITY, "0:rule", "when it leaves play the permission ends: after it is destroyed a non-covert character can no longer block a covert party", () => {
  const game = secBoard({ turn: 2, active: P2, extra: [{ key: "kill", def: destroyTactic("location"), owner: P1, zone: "hand" }] });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("ocov1")]);
  respondWith(engine, P1, id("kill"), { t: [id("sec")] });
  assert.equal(zoneOf(engine, id("sec")), "discard");
  resolvePendingResponses(engine);
  refused(() => declareBlockers(engine, P1, [id("plain1")]), "the permission is gone");
  declareBlockers(engine, P1, [id("cov1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("cov1")], "control: a covert character can still block it");
});

// --- FLIP UP: 2 [E] ---

const flipSec = (game: SecGame, player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("sec"));

clause(SECURITY, "1:flipUp", "flipping up pays exactly 2 with [E] and turns the face-down card into a face-up location (structure 5) that then does its job", () => {
  const game = secBoard({ sec: "faceDown", icons: { rage: 3 }, spentElitism: 1, turn: 1, active: P1 });
  const { engine, id } = game;
  assert.equal(ready(engine), 4, "three rage and the face-down card itself");
  flipSec(game);
  resolvePendingResponses(engine);
  assert.equal(engine.state.cards[id("sec")].faceDown, false, "face-up");
  assert.equal(zoneOf(engine, id("sec")), "play");
  assert.equal(ready(engine), 1, "2 paid, plus the face-down card stops being a resource (4 - 2 - 1)");
  assert.equal(engine.getDefinition(id("sec")).type, "location");
  assert.equal(engine.getDefinition(id("sec")).structure, 5);
});

clause(SECURITY, "1:flipUp", "the flipped-up location has its static text: a covert party can be blocked by a non-covert character", () => {
  const game = secBoard({ sec: "faceDown", icons: { rage: 3 }, spentElitism: 1, turn: 1, active: P1 });
  const { engine, id } = game;
  flipSec(game);
  resolvePendingResponses(engine);
  endTurn(engine, P1);
  declareAttackBy(engine, P2, [id("ocov1")]);
  declareBlockers(engine, P1, [id("plain1")]);
  assert.deepEqual(battleOf(engine)?.blockingParty, [id("plain1")]);
});

clause(SECURITY, "1:flipUp", "the face-down card may pay for its own FLIP UP (CR 507.4b): one other ready resource plus the face-down card is exactly 2", () => {
  const game = secBoard({ sec: "faceDown", icons: { rage: 1 }, spentElitism: 1, turn: 1, active: P1 });
  assert.equal(ready(game.engine), 2);
  flipSec(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("sec")].faceDown, false);
  assert.equal(ready(game.engine), 0);
});

clause(SECURITY, "1:flipUp", "is refused one resource short: with only the face-down card itself ready (cost 2) it cannot flip up", () => {
  const game = secBoard({ sec: "faceDown", icons: {}, spentElitism: 1, turn: 1, active: P1 });
  assert.equal(ready(game.engine), 1);
  refused(() => flipSec(game), "1 ready resource");
  assert.equal(game.engine.state.cards[game.id("sec")].faceDown, true);
});

clause(SECURITY, "1:flipUp", "needs [E]: plenty of other resources are not enough, one [E] is", () => {
  const none = secBoard({ sec: "faceDown", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => flipSec(none), "no [E]");
  assert.equal(none.engine.state.cards[none.id("sec")].faceDown, true);
  assert.equal(ready(none.engine), 7, "nothing was paid");
  const one = secBoard({ sec: "faceDown", icons: { elitism: 1, rage: 4 }, turn: 1, active: P1 });
  flipSec(one);
  resolvePendingResponses(one.engine);
  assert.equal(one.engine.state.cards[one.id("sec")].faceDown, false, "control");
});

clause(SECURITY, "1:flipUp", "FLIP UP does not change when a location can be deployed (CR 507.4d): refused on the opponent's turn, accepted on mine", () => {
  const theirTurn = secBoard({ sec: "faceDown", turn: 2, active: P2 });
  declareAttackOpenWindow(theirTurn.engine, P2, [theirTurn.id("ocov1")]);
  assert.equal(theirTurn.engine.state.priorityPlayerId, P1);
  refused(() => flipSec(theirTurn), "a location is only deployed on its controller's turn");
  assert.equal(theirTurn.engine.state.cards[theirTurn.id("sec")].faceDown, true);
  const myTurn = secBoard({ sec: "faceDown", turn: 1, active: P1 });
  flipSec(myTurn);
  resolvePendingResponses(myTurn.engine);
  assert.equal(myTurn.engine.state.cards[myTurn.id("sec")].faceDown, false, "control");
});

clause(SECURITY, "1:flipUp", "a face-down Security System that was already spent (attached to my faction) paying for something can still be flipped up, paying the 2 with other resources", () => {
  const game = secBoard({ sec: "faceDown", secSpent: true, icons: { elitism: 2 }, turn: 1, active: P1 });
  assert.equal(ready(game.engine), 2);
  flipSec(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("sec")].faceDown, false, "face-up");
  assert.equal(ready(game.engine), 0, "2 paid");
});

clause(SECURITY, "1:flipUp", "only a face-down one I control can be flipped: face-up in play, in my hand, or the opponent's cannot", () => {
  const faceUp = secBoard({ sec: "faceUp", turn: 1, active: P1 });
  refused(() => flipSec(faceUp), "already face-up");
  const inHand = secBoard({ sec: "hand", turn: 1, active: P1 });
  refused(() => flipSec(inHand), "in hand");
  const theirs = secBoard({ sec: "faceDown", turn: 2, active: P2, extra: res({ elitism: 3 }, P2) });
  refused(() => flipSec(theirs, P2), "not their card");
  assert.equal(theirs.engine.state.cards[theirs.id("sec")].faceDown, true);
});

// =================================================================================
// Adjunct Artisan
// FABRICATE -- COST: Deplete this card. -- EFFECT: Reduce the next item's or item's ability's
// numeric cost you pay this turn by 2.
// Character (craftsman), cost 3, [E], 0 strength / 2 speed / 1 life.
// =================================================================================

const ARTISAN = "6ecf173c-843f-4e00-b9f6-7ca6d1dc0843";

/** An item in play with a free-standing ability ZING (id "zing") that costs `pay` and draws a card. */
const zingItem = (name: string, pay: number): CardDefinition =>
  item({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "zing", type: "activated", costs: [{ type: "payResources", amount: pay }], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });

function artisanBoard(
  opts: { art?: "play" | "hand"; artDepleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return devBoard(
    [
      { key: "art", def: printing(ARTISAN), owner: P1, zone: opts.art ?? "play", depleted: opts.artDepleted },
      { key: "i0", def: item({ name: "ItemCost0", cost: 0 }), owner: P1, zone: "hand" },
      { key: "i1", def: item({ name: "ItemCost1", cost: 1 }), owner: P1, zone: "hand" },
      { key: "i3", def: item({ name: "ItemCost3", cost: 3 }), owner: P1, zone: "hand" },
      { key: "i3b", def: item({ name: "ItemCost3b", cost: 3 }), owner: P1, zone: "hand" },
      { key: "i5", def: item({ name: "ItemCost5", cost: 5 }), owner: P1, zone: "hand" },
      { key: "c2", def: character({ name: "CharCost2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "t2", def: tactic({ name: "TacticCost2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "l2", def: location({ name: "LocCost2", cost: 2 }), owner: P1, zone: "hand" },
      { key: "gadget", def: zingItem("Gadget", 3), owner: P1, zone: "play" },
      { key: "gadget1", def: zingItem("Gadget1", 1), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "oi3", def: item({ name: "OppItem3", cost: 3 }), owner: P2, zone: "hand" },
      ...chars("d", 6, P1, "deck"),
      ...res(opts.icons ?? { rage: 8 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active }
  );
}

type ArtGame = ReturnType<typeof artisanBoard>;
const fabricate = (game: ArtGame, key = "art") => activate(game.engine, P1, game.id(key), "fabricate");
const fabricateRaw = (game: ArtGame, key = "art", player: PlayerId = P1) => actRaw(game.engine, player, game.id(key), "fabricate");
/** Plays `key` and returns how many resources it cost. */
function costOf(game: ArtGame, key: string, selected: Record<string, string[]> = {}): number {
  const before = ready(game.engine);
  play(game.engine, P1, game.id(key), { selected });
  return before - ready(game.engine);
}
const zing = (game: ArtGame, key = "gadget"): number => {
  const before = ready(game.engine);
  activate(game.engine, P1, game.id(key), "zing");
  return before - ready(game.engine);
};

clause(ARTISAN, "0:ability:fabricate", "deploys for exactly its printed cost of 3 with [E]: two resources or no [E] is refused; printed 0 strength / 2 speed / 1 life and the craftsman subtype", () => {
  const short = artisanBoard({ art: "hand", icons: { elitism: 2 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("art")), "2 resources: one short of 3");
  const noE = artisanBoard({ art: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noE.engine, P1, noE.id("art")), "no [E]");
  const game = artisanBoard({ art: "hand", icons: { elitism: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("art"));
  assert.equal(before - ready(game.engine), 3);
  assert.equal(game.engine.getStat(game.id("art"), "strength"), 0);
  assert.equal(game.engine.getStat(game.id("art"), "speed"), 2);
  assert.equal(game.engine.getStat(game.id("art"), "life"), 1);
  assert.deepEqual(game.engine.getSubtypes(game.id("art")), ["craftsman"]);
});

clause(ARTISAN, "0:ability:fabricate", "FABRICATE depletes the Artisan as its cost (immediately) and pays no resources", () => {
  const game = artisanBoard();
  const { engine, id } = game;
  const before = ready(engine);
  fabricateRaw(game);
  assert.equal(isDepleted(engine, id("art")), true, "Deplete this card");
  assert.equal(ready(engine), before, "no resource cost");
  resolvePendingResponses(engine);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(ready(engine), before);
});

clause(ARTISAN, "0:ability:fabricate", "the next item I deploy this turn costs 2 less: a cost-3 item costs 1", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(costOf(game, "i3"), 1);
  assert.equal(zoneOf(game.engine, game.id("i3")), "play");
});

clause(ARTISAN, "0:ability:fabricate", "without FABRICATE the same item costs its full 3 (control)", () => {
  const game = artisanBoard();
  assert.equal(costOf(game, "i3"), 3);
});

clause(ARTISAN, "0:ability:fabricate", "a numeric cost can never go below 0: a cost-1 item costs 0, a cost-0 item still costs 0", () => {
  const a = artisanBoard();
  fabricate(a);
  assert.equal(costOf(a, "i1"), 0);
  const b = artisanBoard();
  fabricate(b);
  assert.equal(costOf(b, "i0"), 0);
});

clause(ARTISAN, "0:ability:fabricate", "only the NEXT item: the reduction is used up, so a second cost-3 item costs the full 3", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(costOf(game, "i3"), 1);
  assert.equal(costOf(game, "i3b"), 3);
});

clause(ARTISAN, "0:ability:fabricate", "a reduction wasted on a cost-1 item is not carried over: the following item still costs full price", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(costOf(game, "i1"), 0);
  assert.equal(costOf(game, "i3"), 3, "the 2 was used up by the cost-1 item (1 of it was surplus)");
});

clause(ARTISAN, "0:ability:fabricate", "only ITEMS: a character, a tactic and a location deployed first cost their full price and do not use the reduction up", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(costOf(game, "c2"), 2, "a character is not an item");
  assert.equal(costOf(game, "t2"), 2, "a tactic is not an item");
  assert.equal(costOf(game, "l2"), 2, "a location is not an item");
  assert.equal(costOf(game, "i3"), 1, "the reduction is still waiting for the next item");
});

clause(ARTISAN, "0:ability:fabricate", "'item's ability's numeric cost': the next 'Pay N' of an item's ability costs 2 less (an ability costing 3 costs 1)", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(zing(game), 1, "ZING (Pay 3) costs 1 after FABRICATE");
});

clause(ARTISAN, "0:ability:fabricate", "an item's ability that costs less than 2 is reduced to 0 (an ability costing 1 costs 0)", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(zing(game, "gadget1"), 0);
});

clause(ARTISAN, "0:ability:fabricate", "the reduction goes to whichever comes first: after an item's ability used it, the next item costs its full price", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(zing(game), 1, "the ability took the reduction");
  assert.equal(costOf(game, "i3"), 3, "so the item that follows costs full price");
});

clause(ARTISAN, "0:ability:fabricate", "whichever comes first: an item deployed first takes the reduction, so the ability that follows costs its full 3", () => {
  const game = artisanBoard();
  fabricate(game);
  assert.equal(costOf(game, "i3"), 1);
  assert.equal(zing(game), 3, "the reduction was used by the item");
});

clause(ARTISAN, "0:ability:fabricate", "'this turn': an unused reduction is gone when the turn ends", () => {
  const game = artisanBoard({ turn: 1, active: P1 });
  fabricate(game);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(costOf(game, "i3"), 3, "back to the full price");
});

clause(ARTISAN, "0:ability:fabricate", "two Artisans: both reductions apply to the same next item (a cost-5 item costs 1)", () => {
  const game = artisanBoard({ extra: [{ key: "art2", def: printing(ARTISAN), owner: P1, zone: "play" }] });
  fabricate(game, "art");
  fabricate(game, "art2");
  assert.equal(costOf(game, "i5"), 1);
});

clause(ARTISAN, "0:ability:fabricate", "the item's THRESHOLD is not reduced: an item needing [E][E] still needs two [E] after FABRICATE", () => {
  const gated = (): CardPlacement => ({ key: "gated", def: item({ name: "Gated", cost: 3, threshold: "ee" }), owner: P1, zone: "hand" });
  const one = artisanBoard({ icons: { elitism: 1, rage: 6 }, extra: [gated()] });
  fabricate(one);
  refused(() => playRaw(one.engine, P1, one.id("gated")), "one [E] cannot meet [E][E]");
  const two = artisanBoard({ icons: { elitism: 2, rage: 5 }, extra: [gated()] });
  fabricate(two);
  assert.equal(costOf(two, "gated"), 1, "control: with [E][E] it is deployed for 3 - 2");
});

clause(ARTISAN, "0:ability:fabricate", "it only reduces costs I pay: the opponent's item on their turn costs them the full price", () => {
  const game = artisanBoard({ turn: 2, active: P2, extra: res({ rage: 5 }, P2) });
  const { engine, id } = game;
  declareAttackOpenWindow(engine, P2, [id("foe")]);
  fabricateRaw(game);
  resolvePendingResponses(engine);
  declareBlockers(engine, P1, []);
  autoResolveBattle(engine);
  const before = ready(engine, P2);
  play(engine, P2, id("oi3"));
  assert.equal(before - ready(engine, P2), 3, "their item costs full price");
});

clause(ARTISAN, "0:ability:fabricate", "is refused when the Artisan is already depleted, and works again after it is restored at the start of my next turn", () => {
  const game = artisanBoard();
  fabricate(game);
  refused(() => fabricateRaw(game), "the Artisan is depleted");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(isDepleted(game.engine, game.id("art")), false);
  fabricate(game);
  assert.equal(costOf(game, "i3"), 1);
  const started = artisanBoard({ artDepleted: true });
  refused(() => fabricateRaw(started), "depleted from the start");
});

clause(ARTISAN, "0:ability:fabricate", "can be used the turn the Artisan enters play", () => {
  const game = artisanBoard({ art: "hand", icons: { elitism: 3, rage: 5 }, turn: 1, active: P1 });
  play(game.engine, P1, game.id("art"));
  fabricate(game);
  assert.equal(costOf(game, "i3"), 1);
});

clause(ARTISAN, "0:ability:fabricate", "only the Artisan's controller can use it, and only while it is in play", () => {
  const theirs = artisanBoard({ turn: 2, active: P2 });
  refused(() => fabricateRaw(theirs, "art", P2), "not its controller");
  const inHand = artisanBoard({ art: "hand" });
  refused(() => fabricateRaw(inHand), "the Artisan is in my hand");
});

// =================================================================================
// Aristocratic Artificer
// SNUB -- COST: Pay 1. Deplete this card. -- EFFECT: Search your deck for a card named Elitism
// and reveal it. Put it into your hand.
// Character (craftsman), cost 2, [E], 0 strength / 3 speed / 2 life.
// =================================================================================

const ARTIFICER = "9ccc40b6-2008-4e25-af2f-4ef6862c3687";

function artificerBoard(
  opts: {
    art?: "play" | "hand";
    artDepleted?: boolean;
    icons?: Icons;
    deck?: "full" | "none" | "empty";
    random?: () => number;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const deck: CardPlacement[] =
    opts.deck === "empty"
      ? []
      : opts.deck === "none"
        ? [
            { key: "greed", def: stapleCard("Greed", "greed"), owner: P1, zone: "deck" },
            ...chars("n", 3, P1, "deck")
          ]
        : [
            { key: "c0", def: character({ name: "C0" }), owner: P1, zone: "deck" },
            { key: "el0", def: stapleCard("Elitism", "elitism"), owner: P1, zone: "deck" },
            { key: "greed", def: stapleCard("Greed", "greed"), owner: P1, zone: "deck" },
            { key: "bang", def: stapleCard("Elitism!", "elitism"), owner: P1, zone: "deck" },
            { key: "upgrade", def: character({ name: "Elitist Upgrade" }), owner: P1, zone: "deck" },
            { key: "el1", def: stapleCard("Elitism", "elitism"), owner: P1, zone: "deck" },
            { key: "elChar", def: character({ name: "Elitism" }), owner: P1, zone: "deck" },
            { key: "lower", def: stapleCard("elitism", "elitism"), owner: P1, zone: "deck" }
          ];
  return devBoard(
    [
      { key: "art", def: printing(ARTIFICER), owner: P1, zone: opts.art ?? "play", depleted: opts.artDepleted },
      ...deck,
      { key: "hEl", def: stapleCard("Elitism", "elitism"), owner: P1, zone: "hand" },
      { key: "dEl", def: stapleCard("Elitism", "elitism"), owner: P1, zone: "discard" },
      { key: "oEl", def: stapleCard("Elitism", "elitism"), owner: P2, zone: "deck" },
      ...chars("od", 2, P2, "deck"),
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { rage: 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn, activePlayerId: opts.active, random: opts.random }
  );
}

type ArtificerGame = ReturnType<typeof artificerBoard>;
const snub = (game: ArtificerGame) => activate(game.engine, P1, game.id("art"), "snub");
const snubRaw = (game: ArtificerGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("art"), "snub");

clause(ARTIFICER, "0:ability:snub", "deploys for exactly its printed cost of 2 with [E]: one resource short and no [E] are refused; printed 0 strength / 3 speed / 2 life and the craftsman subtype", () => {
  const short = artificerBoard({ art: "hand", icons: { elitism: 1 }, turn: 1, active: P1 });
  refused(() => playRaw(short.engine, P1, short.id("art")), "1 resource: one short of 2");
  const noE = artificerBoard({ art: "hand", icons: { rage: 6 }, turn: 1, active: P1 });
  refused(() => playRaw(noE.engine, P1, noE.id("art")), "no [E]");
  const game = artificerBoard({ art: "hand", icons: { elitism: 3 }, turn: 1, active: P1 });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("art"));
  assert.equal(before - ready(game.engine), 2);
  assert.equal(game.engine.getStat(game.id("art"), "strength"), 0);
  assert.equal(game.engine.getStat(game.id("art"), "speed"), 3);
  assert.equal(game.engine.getStat(game.id("art"), "life"), 2);
  assert.deepEqual(game.engine.getSubtypes(game.id("art")), ["craftsman"]);
});

clause(ARTIFICER, "0:ability:snub", "pays exactly 1 and depletes the Artificer as the cost, then the chosen Elitism goes from my deck to my hand and is revealed", () => {
  const game = artificerBoard();
  const { engine, id } = game;
  const before = ready(engine);
  const handBefore = handOf(engine, P1).length;
  snubRaw(game);
  assert.equal(before - ready(engine), 1, "Pay 1");
  assert.equal(isDepleted(engine, id("art")), true, "Deplete this card");
  assert.equal(zoneOf(engine, id("el0")), "deck", "nothing found yet");
  resolvePendingResponses(engine);
  pickFromSearch(engine, id, ["el0"]);
  assert.equal(zoneOf(engine, id("el0")), "hand");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.deepEqual(revealedIds(engine), [id("el0")]);
  assert.equal(zoneOf(engine, id("art")), "play");
});

clause(ARTIFICER, "0:ability:snub", "either Elitism in the deck may be taken", () => {
  const game = artificerBoard();
  snub(game);
  pickFromSearch(game.engine, game.id, ["el1"]);
  assert.equal(zoneOf(game.engine, game.id("el1")), "hand");
  assert.equal(zoneOf(game.engine, game.id("el0")), "deck");
});

clause(ARTIFICER, "0:ability:snub", "only a card NAMED Elitism: other staples, near-miss names, the opponent's Elitism and Elitism in hand or discard are refused", () => {
  const game = artificerBoard();
  const { engine, id } = game;
  snub(game);
  expectPending(engine, "chooserSelectsTarget");
  refused(tryPick(engine, P1, [id("greed")]), "Greed");
  refused(tryPick(engine, P1, [id("bang")]), "Elitism!");
  refused(tryPick(engine, P1, [id("upgrade")]), "Elitist Upgrade");
  refused(tryPick(engine, P1, [id("c0")]), "an unrelated character");
  refused(tryPick(engine, P1, [id("oEl")]), "the opponent's Elitism");
  refused(tryPick(engine, P1, [id("hEl")]), "an Elitism in my hand");
  refused(tryPick(engine, P1, [id("dEl")]), "an Elitism in my discard pile");
  refused(tryPick(engine, P1, [id("el0"), id("el1")]), "two copies");
  assert.equal(pending(engine)?.kind, "chooserSelectsTarget");
  pickFromSearch(engine, id, ["el0"]);
  assert.equal(zoneOf(engine, id("el0")), "hand", "control: a card named Elitism is accepted");
});

clause(ARTIFICER, "0:ability:snub", "'a card named Elitism' is a search by name: a non-resource card named Elitism can be found too", () => {
  const game = artificerBoard();
  snub(game);
  pickFromSearch(game.engine, game.id, ["elChar"]);
  assert.equal(zoneOf(game.engine, game.id("elChar")), "hand");
});

clause(ARTIFICER, "0:ability:snub", "the search can be failed on purpose (CR 312.2): taking nothing puts nothing in my hand, the cost is still paid", () => {
  const game = artificerBoard();
  const { engine, id } = game;
  const handBefore = handOf(engine, P1).length;
  const before = ready(engine);
  snub(game);
  pickFromSearch(engine, id, []);
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(handOf(engine, P1).length, handBefore, "nothing found");
  assert.equal(before - ready(engine), 1);
  assert.equal(isDepleted(engine, id("art")), true);
});

clause(ARTIFICER, "0:ability:snub", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const game = artificerBoard({ random: () => 0 });
  const { engine, id } = game;
  const unshuffled = deckOf(engine, P1).filter((c) => c !== id("el0"));
  snub(game);
  pickFromSearch(engine, id, ["el0"]);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.deepEqual(deckOf(engine, P1), shuffledWithConstant(unshuffled, 0));
});

clause(ARTIFICER, "0:ability:snub", "a deck with no Elitism in it is still searched, so it is shuffled afterwards (CR 312.1), and the cost is still paid", () => {
  const game = artificerBoard({ deck: "none", random: () => 0 });
  const { engine, id } = game;
  const unshuffled = deckOf(engine, P1);
  const before = ready(engine);
  snub(game);
  drain(engine, pickTargets([]));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(before - ready(engine), 1);
  assert.equal(isDepleted(engine, id("art")), true);
  assert.deepEqual([...deckOf(engine, P1)].sort(), [...unshuffled].sort());
  assert.notDeepEqual(deckOf(engine, P1), unshuffled, "a searched deck is shuffled although nothing could be found");
});

clause(ARTIFICER, "0:ability:snub", "an empty deck: the cost is paid, nothing is found, and it is not a loss", () => {
  const game = artificerBoard({ deck: "empty" });
  snub(game);
  drain(game.engine, pickTargets([]));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.result, undefined);
});

clause(ARTIFICER, "0:ability:snub", "the opponent's deck, hand and discard pile are untouched, and their deck is not shuffled", () => {
  const game = artificerBoard({ random: () => 0 });
  const oppDeck = deckOf(game.engine, P2);
  const oppHand = handOf(game.engine, P2);
  snub(game);
  pickFromSearch(game.engine, game.id, ["el0"]);
  assert.deepEqual(deckOf(game.engine, P2), oppDeck);
  assert.deepEqual(handOf(game.engine, P2), oppHand);
});

clause(ARTIFICER, "0:ability:snub", "is refused with no resource to pay 1: nothing is depleted", () => {
  const none = artificerBoard({ icons: {} });
  refused(() => snubRaw(none), "no resources");
  assert.equal(isDepleted(none.engine, none.id("art")), false);
  const spent = artificerBoard({ icons: {}, extra: spentRes("rage", P1, 2) });
  refused(() => snubRaw(spent), "only spent resources");
  const one = artificerBoard({ icons: { rage: 1 } });
  snub(one);
  assert.equal(isDepleted(one.engine, one.id("art")), true, "control: one resource is enough");
});

clause(ARTIFICER, "0:ability:snub", "is refused when the Artificer is already depleted, and works again after it is restored", () => {
  const game = artificerBoard();
  snub(game);
  pickFromSearch(game.engine, game.id, ["el0"]);
  refused(() => snubRaw(game), "the Artificer is depleted");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(isDepleted(game.engine, game.id("art")), false);
  snub(game);
  pickFromSearch(game.engine, game.id, ["el1"]);
  assert.equal(zoneOf(game.engine, game.id("el1")), "hand");
  const started = artificerBoard({ artDepleted: true });
  refused(() => snubRaw(started), "depleted from the start");
});

clause(ARTIFICER, "0:ability:snub", "can be used the turn the Artificer enters play, and on the opponent's turn in response", () => {
  const fresh = artificerBoard({ art: "hand", icons: { elitism: 2, rage: 2 }, turn: 1, active: P1 });
  play(fresh.engine, P1, fresh.id("art"));
  snub(fresh);
  pickFromSearch(fresh.engine, fresh.id, ["el0"]);
  assert.equal(zoneOf(fresh.engine, fresh.id("el0")), "hand");
  const response = artificerBoard({ turn: 2, active: P2 });
  declareAttackOpenWindow(response.engine, P2, [response.id("foe")]);
  snubRaw(response);
  resolvePendingResponses(response.engine);
  pickFromSearch(response.engine, response.id, ["el1"]);
  assert.equal(zoneOf(response.engine, response.id("el1")), "hand");
});

clause(ARTIFICER, "0:ability:snub", "only the Artificer's controller can use it, and only while it is in play", () => {
  const theirs = artificerBoard({ turn: 2, active: P2, extra: res({ rage: 3 }, P2) });
  refused(() => snubRaw(theirs, P2), "not its controller");
  const inHand = artificerBoard({ art: "hand" });
  refused(() => snubRaw(inHand), "the Artificer is in my hand");
});

// --- extra checks added after the first pass over every card ---

clause(BAITINGS, "2:rule@ggggg", "with [G]x5 two start-of-turn triggers of mine happen at once (influence, draw/discard): I am the one who orders them", () => {
  const game = baitBoard({ greed: 5 });
  const { engine } = game;
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "orderTriggers", "two triggers from my cards at once (FAQ)");
  assert.equal(pc?.playerId, P1, "I choose the order: both triggers are from my cards");
  orderFirst(engine);
  drain(engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id("h0")] } : declineAll(p)));
  assert.equal(influenceOf(engine, P1), START + 2);
  assert.equal(discardOf(engine, P1).length, 1);
});

clause(BAITINGS, "3:rule@ggggggg", "with [G]x7 all three of my triggers are ordered by me, and whatever the order the net result is +2 influence, two cards drawn, one discarded", () => {
  const game = baitBoard({ greed: 7 });
  const { engine } = game;
  const deckBefore = deckOf(engine, P1).length;
  endTurn(engine, P2);
  const pc = pending(engine);
  assert.equal(pc?.kind, "orderTriggers");
  assert.equal(pc?.playerId, P1);
  assert.equal(((pc as unknown as { triggers: unknown[] }).triggers ?? []).length, 3, "all three paragraphs are offered");
  orderFirst(engine);
  drain(engine, (p) => (p.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [game.id("h0")] } : p.kind === "orderTriggers" ? { kind: "orderTriggers", next: (p.triggers as unknown[])[0] } : declineAll(p)));
  assert.equal(influenceOf(engine, P1), START + 2);
  assert.equal(deckOf(engine, P1).length, deckBefore - 2);
  assert.equal(handOf(engine, P1).length, 3 + 2 - 1);
});

clause(MONTGOMERY, "1:ability:resurrect", "'your discard pile' is the controller's (CR 407.2): a Montgomery I own but the opponent controls fetches from THEIR discard pile, not mine", () => {
  const { engine, id } = devBoard([
    { key: "monty", def: printing(MONTGOMERY), owner: P1, controller: P2, zone: "play" },
    { key: "mineDead", def: character({ name: "MineDead", cost: 1 }), owner: P1, zone: "discard" },
    { key: "theirDead", def: character({ name: "TheirDead", cost: 1 }), owner: P2, zone: "discard" },
    ...res({ rage: 2 }, P2)
  ], { turn: 2, activePlayerId: P2 });
  refused(() => actRaw(engine, P2, id("monty"), "resurrect", { c: [id("mineDead")] }), "a character in the OWNER's discard pile is not in the controller's");
  assert.equal(isDepleted(engine, id("monty")), false);
  activate(engine, P2, id("monty"), "resurrect", { selected: { c: [id("theirDead")] } });
  assert.equal(zoneOf(engine, id("theirDead")), "play");
  assert.equal(engine.state.cards[id("theirDead")].controllerId, P2, "under the controller's control");
});
