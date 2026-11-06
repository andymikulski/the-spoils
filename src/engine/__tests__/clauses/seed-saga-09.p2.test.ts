// Clause tests — batch seed-saga-09 part p2. Expectations come from PRINTED text and RULES.md; engine data only drives the engine.

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
import { battleOf, covertBlocksOnlyCovertParties, covertCannotBeBlockedByNonCovert, covertHasKeyword, covertPartyNeedsEveryMemberCovert, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn, setupGame } from "./_turn.js";
import type { CardDefinition, CardInstanceId, CardSelector, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- file-local helpers -------------------------------------------------------

type Icons = Partial<Record<StapleIcon, number>>;

/** Staple resources for `owner`, e.g. `res({ deception: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

/** The same, but already spent (attached to `owner`'s faction): they still count for thresholds, but not for "pay N". */
const spent = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  res(icons, owner).map((placement) => ({ ...placement, attachedToKey: owner === P1 ? "__factionA" : "__factionB" }));

/** Resources not yet attached to the faction (what a "pay N" cost draws from). */
const ready = (engine: SpoilsEngine, player: PlayerId = P1): number => readyResources(engine, player);

const handOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].hand];
const deckOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].deck];
const discardOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].discard];
const removedOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].removed];
const playOf = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => [...engine.state.players[player].play];
const influenceOf = (engine: SpoilsEngine, player: PlayerId): number => engine.state.players[player].influence;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.state.cards[cardId].depleted === true;
const damageOn = (engine: SpoilsEngine, cardId: CardInstanceId): number => engine.state.cards[cardId].damage;
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId): PlayerId => engine.state.cards[cardId].controllerId;
const START = 30; // developFaction() starts at 30 influence

/** Stats of a card as [strength, life, speed]. */
const stats = (engine: SpoilsEngine, cardId: CardInstanceId): [number, number, number] => [
  engine.getStat(cardId, "strength"),
  engine.getStat(cardId, "life"),
  engine.getStat(cardId, "speed")
];

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
function flipUpRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  selected: Record<string, CardInstanceId[]> = {},
  variables: Record<string, number> = {}
): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables });
}

/** Both factions can develop; any extra build options go in `extra`. */
const devBoard = (cards: CardPlacement[], extra: Parameters<typeof buildGame>[0] = {}) =>
  buildGame({ playerA: { faction: developFaction() }, playerB: { faction: developFaction() }, ...extra, cards });

/** Answers `chooserSelectsTarget` with `selected`, anything else with the default decline. */
function pickTargets(selected: CardInstanceId[]) {
  return (pc: PendingChoiceLike): unknown => (pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected } : declineAll(pc));
}

/** Says yes to every mayPay, otherwise defers to `rest` (default: decline). */
const payYes =
  (rest: (pc: PendingChoiceLike) => unknown = declineAll) =>
  (pc: PendingChoiceLike): unknown =>
    pc.kind === "mayPay" ? { kind: "mayPay", pay: true } : rest(pc);

/** Says no to every mayPay, otherwise defers to `rest` (default: decline). */
const payNo =
  (rest: (pc: PendingChoiceLike) => unknown = declineAll) =>
  (pc: PendingChoiceLike): unknown =>
    pc.kind === "mayPay" ? { kind: "mayPay", pay: false } : rest(pc);

/** The sole open pending choice, asserting its kind. */
function expectPending(engine: SpoilsEngine, kind: string): PendingChoiceLike {
  const pc = pending(engine);
  assert.ok(pc, `expected an open pending choice of kind ${kind}, found none`);
  assert.equal(pc.kind, kind);
  return pc;
}

/** Every card in play under `player`'s control with this definition name. */
function inPlayNamed(engine: SpoilsEngine, player: PlayerId, name: string): CardInstanceId[] {
  return Object.values(engine.state.cards)
    .filter((c) => c.zone === "play" && c.controllerId === player && engine.getDefinition(c.id).name === name)
    .map((c) => c.id);
}

// --- synthetic helper cards (all free) ------------------------------------------------

type Selector = CardSelector;

/** A free tactic (id "ph", extra-cost pick "t"): `amount` non-battle damage to the picked card. */
function pickHitTactic(amount = 3, name = `Pick Hit ${amount}`, selector: Selector = { zone: "play", type: "character" }): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ph",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });
}

/** A free tactic (id "pk", pick "t"): destroys the picked card. */
function pickKillTactic(name = "Pick Kill", selector: Selector = { zone: "play", type: "character" }): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pk",
          type: "activated",
          targets: [{ id: "t", selector, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
}

/** A free tactic (id "pb", pick "t"): the picked card returns to its owner's hand; its controller then draws a card. */
function pickBounceTactic(name = "Pick Bounce"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "pb",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [
            { type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" },
            { type: "draw", player: "controller", amount: 1 }
          ]
        }
      ]
    }
  });
}

/** A free tactic (id "bf", pick "t"): the picked character gets +amount strength this turn. */
function pickBuffTactic(amount = 2, name = `Pick Buff ${amount}`): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bf",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [
            { type: "createModifier", target: { type: "selected", id: "t" }, stat: "strength", operation: "add", value: amount, duration: { type: "untilEndOfTurn" } }
          ]
        }
      ]
    }
  });
}

/** A free tactic (id "np"): no pick at all, draws a card. */
function noPickTactic(name = "No Pick"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: { abilities: [{ id: "np", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
}

/** `n` plain cost-0 characters `<prefix>0..n-1` for `owner` in `zone`. */
const chars = (prefix: string, n: number, owner: PlayerId, zone: Zone): CardPlacement[] =>
  fillers(prefix, n, owner, zone, (i) => character({ name: `${prefix} ${i}` }));

// =============================================================================
// Mistaken Identity (Seed Saga) — Tactic, rogue, cost 2, [D][D]
//   COST: Play this only in response to a card or ability that picked a
//         character as an extra cost. Pick another character that can be
//         picked by that card or ability.
//   EFFECT: When the card or ability resolves, its effect happens as though
//         your opponent had picked the other character instead.
// =============================================================================

const MISTAKEN = "da95244d-134d-4648-bb5d-c4e1e4fbd6ff";

interface MiOpts {
  /** Mine: the resources I (P1, the responder) have. Default exactly [D][D]. */
  icons?: Icons;
  /** The opponent's (P2) card that I respond to. Default: "Pick Hit 3". */
  orig?: CardDefinition;
  /** Extra placements. */
  extra?: CardPlacement[];
  /** Whether it is the opponent's turn (default true: I respond on their turn). */
  theirTurn?: boolean;
}

/**
 * Me = P1 with Mistaken Identity in hand and the responder's board; the
 * opponent = P2, active, with `orig` in hand. Characters: mine1 (cost 1),
 * mine2 (cost 4); foe1 (cost 1), foe2 (cost 4), all 3/5/2.
 */
function miBoard(opts: MiOpts = {}) {
  const theirTurn = opts.theirTurn !== false;
  return devBoard(
    [
      { key: "mi", def: printing(MISTAKEN), owner: P1, zone: "hand" },
      { key: "orig", def: opts.orig ?? pickHitTactic(3), owner: P2, zone: "hand" },
      { key: "mine1", def: character({ name: "Mine One", cost: 1, strength: 3, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", cost: 4, strength: 3, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", cost: 1, strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", cost: 4, strength: 3, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { deception: 2 }),
      ...(opts.extra ?? [])
    ],
    theirTurn ? { turn: 2, activePlayerId: P2 } : { turn: 1, activePlayerId: P1 }
  );
}
type MiGame = ReturnType<typeof miBoard>;

/** The opponent plays `orig` picking `picked` (window left open, I hold priority). */
function miOpen(game: MiGame, picked: string, key = "orig", pickId = "t"): void {
  playRaw(game.engine, P2, game.id(key), { selected: { [pickId]: [game.id(picked)] } });
}

/** I play Mistaken Identity picking `other` (raw: the window stays open). */
function miPlayRaw(game: MiGame, other: string, player: PlayerId = P1): void {
  playRaw(game.engine, player, game.id("mi"), { selected: { other: [game.id(other)] } });
}

/** The opponent plays `orig` on `picked`, I answer with Mistaken Identity on `other`, and everything resolves. */
function miRedirect(game: MiGame, picked: string, other: string, key = "orig", pickId = "t"): void {
  miOpen(game, picked, key, pickId);
  miPlayRaw(game, other);
  resolvePendingResponses(game.engine);
}

clause(MISTAKEN, "1:rule", "in response to a card that picked my character as an extra cost, I pick another character: the effect hits THAT character, not the one first picked", () => {
  const game = miBoard();
  miRedirect(game, "mine1", "foe1");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "the other character takes the damage");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0, "the character first picked is untouched");
  assert.equal(zoneOf(game.engine, game.id("orig")), "discard", "the responded-to tactic still resolves normally");
});

clause(MISTAKEN, "1:rule", "the swap works the other way round: the original pick was the opponent's own character and the other is mine", () => {
  const game = miBoard();
  miRedirect(game, "foe1", "mine2");
  assert.equal(damageOn(game.engine, game.id("mine2")), 3);
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
});

clause(MISTAKEN, "1:rule", "the other character may be one of my own, or one of the opponent's", () => {
  const mine = miBoard();
  miRedirect(mine, "mine1", "mine2");
  assert.equal(damageOn(mine.engine, mine.id("mine2")), 3);
  assert.equal(damageOn(mine.engine, mine.id("mine1")), 0);
  const theirs = miBoard();
  miRedirect(theirs, "mine1", "foe2");
  assert.equal(damageOn(theirs.engine, theirs.id("foe2")), 3);
  assert.equal(damageOn(theirs.engine, theirs.id("mine1")), 0);
});

clause(MISTAKEN, "1:rule", "no other character is touched: only the redirected-to character takes the damage", () => {
  const game = miBoard();
  miRedirect(game, "mine1", "foe1");
  for (const key of ["mine1", "mine2", "foe2"]) assert.equal(damageOn(game.engine, game.id(key)), 0, `${key} is untouched`);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3);
});

// --- cost: 2 and [D][D] ---

clause(MISTAKEN, "0:extraCost", "costs exactly 2: two resources are paid when it is played (while the window is still open), and it goes to my discard pile afterwards", () => {
  const game = miBoard({ icons: { deception: 5 } });
  miOpen(game, "mine1");
  const before = ready(game.engine);
  miPlayRaw(game, "foe1");
  assert.equal(before - ready(game.engine), 2, "two resources paid at once as the cost");
  assert.equal(zoneOf(game.engine, game.id("mi")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mi")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("mi")), "discardOf(game.engine, P1).includes(game.id(\"mi\"))");
  assert.equal(ready(game.engine), before - 2, "nothing more was paid");
});

clause(MISTAKEN, "0:extraCost", "is refused one resource short of its cost of 2, and nothing is paid", () => {
  // a spent [D] tops the threshold up, so only the cost can refuse
  const bad = miBoard({ icons: { deception: 1 }, extra: bank("deception", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" })) });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "foe1"), "one ready resource short of the cost 2 (threshold met by a spent [D])", /Costs cannot be paid/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 1);
  const good = miBoard({ icons: { deception: 2 } });
  miRedirect(good, "mine1", "foe1");
  assert.equal(damageOn(good.engine, good.id("foe1")), 3, "control: with 2 it works");
});

clause(MISTAKEN, "0:extraCost", "needs [D][D]: lots of other resources, or a single [D], are refused", () => {
  const rage = miBoard({ icons: { rage: 6 } });
  miOpen(rage, "mine1");
  refused(() => miPlayRaw(rage, "foe1"), "no [D] at all");
  assert.equal(zoneOf(rage.engine, rage.id("mi")), "hand");
  const one = miBoard({ icons: { deception: 1, rage: 5 } });
  miOpen(one, "mine1");
  refused(() => miPlayRaw(one, "foe1"), "only one [D]");
  assert.equal(zoneOf(one.engine, one.id("mi")), "hand");
  assert.equal(ready(one.engine), 6, "nothing paid");
});

clause(MISTAKEN, "0:extraCost", "Volition (face-down cards) does not meet [D][D], and neither do the opponent's [D]", () => {
  const vol = miBoard({ icons: {}, extra: volition(4, P1) });
  miOpen(vol, "mine1");
  refused(() => miPlayRaw(vol, "foe1"), "Volition is not [D]");
  const theirs = miBoard({ icons: { rage: 3 }, extra: res({ deception: 4 }, P2) });
  miOpen(theirs, "mine1");
  refused(() => miPlayRaw(theirs, "foe1"), "their [D] do not count");
  assert.equal(zoneOf(theirs.engine, theirs.id("mi")), "hand");
});

clause(MISTAKEN, "0:extraCost", "spent [D][D] still meet the threshold (icons are never spent) but cannot pay: two spent [D] plus two ready resources works", () => {
  const good = miBoard({ icons: { rage: 2 }, extra: spent({ deception: 2 }) });
  miRedirect(good, "mine1", "foe1");
  assert.equal(damageOn(good.engine, good.id("foe1")), 3);
  assert.equal(zoneOf(good.engine, good.id("mi")), "discard");
  const bad = miBoard({ icons: { rage: 1 }, extra: spent({ deception: 2 }) });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "foe1"), "spent resources cannot pay the cost of 2");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
});

// --- "Play this only in response to a card or ability that picked a character as an extra cost" ---

clause(MISTAKEN, "0:extraCost", "cannot be played when I am not responding to anything (my own turn, empty stack)", () => {
  const idle = miBoard({ theirTurn: false });
  refused(() => miPlayRaw(idle, "foe1"), "nothing to respond to on my own turn");
  assert.equal(zoneOf(idle.engine, idle.id("mi")), "hand");
  assert.equal(ready(idle.engine), 2, "nothing paid");
  const idleTheirs = miBoard();
  refused(() => miPlayRaw(idleTheirs, "foe1"), "nothing to respond to on their turn either");
  assert.equal(zoneOf(idleTheirs.engine, idleTheirs.id("mi")), "hand");
  const control = miBoard();
  miRedirect(control, "mine1", "foe1");
  assert.equal(damageOn(control.engine, control.id("foe1")), 3, "control: in response it works");
});

clause(MISTAKEN, "0:extraCost", "cannot be played in response to a card that picked no character (it picked nothing)", () => {
  const bad = miBoard({ orig: noPickTactic(), extra: fillers("dk", 3, P2, "deck") });
  playRaw(bad.engine, P2, bad.id("orig"));
  refused(() => miPlayRaw(bad, "foe1"), "the responded-to tactic picked nothing");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing paid");
});

clause(MISTAKEN, "0:extraCost", "cannot be played in response to a card that picked an ITEM (not a character) as its extra cost", () => {
  const bad = miBoard({
    orig: pickHitTactic(2, "Pick Item Hit", { zone: "play", type: "item" }),
    extra: [{ key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" }]
  });
  miOpen(bad, "gadget");
  refused(() => miPlayRaw(bad, "foe1"), "an item was picked, not a character", /cannot be deployed right now/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing paid");
});

clause(MISTAKEN, "0:extraCost", "cannot be played in response to a card whose character pick is made on resolution (an effect, not an extra cost)", () => {
  const lateTactic = tactic({
    name: "Late Pick",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "lp",
          type: "activated",
          effects: [
            {
              type: "chooserSelectsTarget",
              chooser: "controller",
              declaration: { id: "pick", selector: { zone: "play", type: "character" }, count: 1 },
              effects: [{ type: "dealDamage", target: { type: "selected", id: "pick" }, amount: 3 }]
            }
          ]
        }
      ]
    }
  });
  const bad = miBoard({ orig: lateTactic });
  playRaw(bad.engine, P2, bad.id("orig"));
  refused(() => miPlayRaw(bad, "foe1"), "the character is picked as an effect when it resolves", /cannot be deployed right now/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
});

clause(MISTAKEN, "0:extraCost", "cannot be played in response to an attack declaration (no card or ability picked anything)", () => {
  const bad = miBoard({ theirTurn: true });
  declareAttackOpenWindow(bad.engine, P2, [bad.id("foe1")]);
  assert.equal(bad.engine.state.priorityPlayerId, P1, "I hold priority in the attack's response window");
  refused(() => miPlayRaw(bad, "foe2"), "an attack is not a card or ability that picked a character", /cannot be deployed right now/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2);
});

clause(MISTAKEN, "0:extraCost", "cannot be played in response to the opponent announcing the end of their turn", () => {
  const bad = miBoard();
  bad.engine.perform({ type: "endTurn", playerId: P2 });
  assert.ok(bad.engine.state.responseWindow, "an end-of-turn response window is open");
  refused(() => miPlayRaw(bad, "foe1"), "announcing the end of the turn picked nothing");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
});

clause(MISTAKEN, "0:extraCost", "works in response to an ABILITY that picked a character as an extra cost, not only a card", () => {
  const striker = character({
    name: "Striker",
    cost: 1,
    life: 5,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [],
          targets: [{ id: "z", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "z" }, amount: 2 }]
        }
      ]
    }
  });
  const game = miBoard({ extra: [{ key: "striker", def: striker, owner: P2, zone: "play" }] });
  actRaw(game.engine, P2, game.id("striker"), "zap", { z: [game.id("mine1")] });
  miPlayRaw(game, "foe2");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe2")), 2, "the ability's damage lands on the other character");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0);
});

clause(MISTAKEN, "0:extraCost", "responds to the TOP card of the stack: my own tactic's pick cannot be redirected, only the opponent's response that picked a character", () => {
  const picker = pickHitTactic(2, "Second Hit");
  const game = miBoard({
    orig: noPickTactic("First Play"),
    extra: [
      { key: "second", def: picker, owner: P2, zone: "hand" },
      { key: "mine3", def: character({ name: "Mine Three", cost: 2, life: 5 }), owner: P1, zone: "play" },
      { key: "mine_t", def: tactic({ name: "My Own No Pick", cost: 0, behavior: { abilities: [{ id: "x", type: "activated", effects: [] }] } }), owner: P1, zone: "hand" },
      ...fillers("dk", 3, P2, "deck")
    ]
  });
  playRaw(game.engine, P2, game.id("orig"));
  playRaw(game.engine, P1, game.id("mine_t"));
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent may respond to my response");
  playRaw(game.engine, P2, game.id("second"), { selected: { t: [game.id("mine3")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  miPlayRaw(game, "foe1");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe1")), 2, "the response that picked a character is redirected");
  assert.equal(damageOn(game.engine, game.id("mine3")), 0);
});

// --- "Pick another character that can be picked by that card or ability" ---

clause(MISTAKEN, "0:extraCost", "the pick must be a character in play: an item, a location, a resource, a faction or a face-down card is refused", () => {
  const extra = [
    { key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" as const },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" as const },
    { key: "mine_res", def: resourceCard({ name: "Spare Resource" }), owner: P1, zone: "play" as const },
    { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play" as const, faceDown: true }
  ];
  const picks = ["gadget", "place", "mine_res", "fd"];
  for (const key of picks) {
    const bad = miBoard({ icons: { deception: 3 }, extra });
    miOpen(bad, "mine1");
    refused(() => miPlayRaw(bad, key), `${key} is not a character`);
    assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand", `${key}: Mistaken Identity stays in hand`);
  }
  const faction = miBoard();
  miOpen(faction, "mine1");
  refused(() => playRaw(faction.engine, P1, faction.id("mi"), { selected: { other: [faction.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(faction.engine, P1, faction.id("mi"), { selected: { other: [faction.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(faction.engine, faction.id("mi")), "hand");
});

clause(MISTAKEN, "0:extraCost", "the pick must be in play: a character in a hand, deck or discard pile is refused", () => {
  const extra = [
    { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" as const },
    { key: "inDeck", def: character({ name: "In Deck" }), owner: P2, zone: "deck" as const },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" as const }
  ];
  for (const key of ["inHand", "inDeck", "inDiscard"]) {
    const bad = miBoard({ icons: { deception: 3 }, extra });
    miOpen(bad, "mine1");
    refused(() => miPlayRaw(bad, key), `${key} is not in play`);
    assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  }
});

clause(MISTAKEN, "0:extraCost", "exactly one character must be picked: none and two are refused", () => {
  const none = miBoard({ icons: { deception: 3 } });
  miOpen(none, "mine1");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: { other: [] } }), "no pick");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: {} }), "no declaration");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: { other: [none.id("foe1"), none.id("foe2")] } }), "two picks");
  assert.equal(zoneOf(none.engine, none.id("mi")), "hand");
  assert.equal(ready(none.engine), 3, "nothing paid");
});

clause(MISTAKEN, "0:extraCost", "the pick must be ANOTHER character: picking the character that was already picked is refused", () => {
  const bad = miBoard({ icons: { deception: 3 } });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "mine1"), "the same character is not 'another' character");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 3, "nothing paid");
  const good = miBoard({ icons: { deception: 3 } });
  miOpen(good, "mine1");
  miPlayRaw(good, "mine2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("mine2")), 3, "control: a different character works");
});

clause(MISTAKEN, "0:extraCost", "the pick must be something THAT card could pick: a card that can only pick the opponent's characters cannot be redirected onto the opponent's own", () => {
  // The responded-to tactic is the opponent's (P2) and picks "a character your opponent controls" = one of mine.
  const orig = pickHitTactic(3, "Pick An Opposing Character", { zone: "play", type: "character", controller: "opponent" });
  const bad = miBoard({ orig, icons: { deception: 3 } });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "foe1"), "the original could not have picked its own controller's character");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 3, "nothing paid");
  const good = miBoard({ orig, icons: { deception: 3 } });
  miOpen(good, "mine1");
  miPlayRaw(good, "mine2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("mine2")), 3, "control: another of the opponent's-controlled characters works");
  assert.equal(damageOn(good.engine, good.id("mine1")), 0);
});

clause(MISTAKEN, "0:extraCost", "the pick must be something THAT card could pick: a card that can only pick its own controller's characters cannot be redirected onto mine", () => {
  const orig = pickHitTactic(3, "Pick Your Own Character", { zone: "play", type: "character", controller: "self" });
  const bad = miBoard({ orig, icons: { deception: 3 } });
  miOpen(bad, "foe1");
  refused(() => miPlayRaw(bad, "mine1"), "the original could not have picked my character");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  const good = miBoard({ orig, icons: { deception: 3 } });
  miOpen(good, "foe1");
  miPlayRaw(good, "foe2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("foe2")), 3, "control: another character of theirs works");
});

clause(MISTAKEN, "0:extraCost", "the pick must be something THAT card could pick: a numeric-cost limit applies to the new pick too", () => {
  const orig = pickHitTactic(3, "Pick A Cheap Character", {
    zone: "play",
    type: "character",
    conditions: [{ type: "numberCompare", left: { type: "cardCost", target: { type: "selected", id: "__candidate" } }, operator: "<=", right: 2 }]
  });
  const extra = [
    { key: "cheap2", def: character({ name: "Cheap Two", cost: 2, life: 5 }), owner: P1, zone: "play" as const },
    { key: "pricey", def: character({ name: "Pricey", cost: 5, life: 5 }), owner: P1, zone: "play" as const }
  ];
  const bad = miBoard({ orig, extra, icons: { deception: 3 } });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "mine2"), "cost 4 is over the limit of 2");
  refused(() => miPlayRaw(bad, "pricey"), "cost 5 is over the limit of 2");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  const good = miBoard({ orig, extra, icons: { deception: 3 } });
  miOpen(good, "mine1");
  miPlayRaw(good, "cheap2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("cheap2")), 3, "control: a cost-2 character is still within the limit");
  const good1 = miBoard({ orig, extra, icons: { deception: 3 } });
  miOpen(good1, "mine1");
  miPlayRaw(good1, "foe1");
  resolvePendingResponses(good1.engine);
  assert.equal(damageOn(good1.engine, good1.id("foe1")), 3, "control: the opponent's cost-1 character works too");
});

clause(MISTAKEN, "0:extraCost", "the pick must be something THAT ability could pick: an ability that says 'another character' cannot be redirected onto its own source", () => {
  const striker = character({
    name: "Striker",
    cost: 1,
    life: 9,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [],
          targets: [
            {
              id: "z",
              selector: {
                zone: "play",
                type: "character",
                conditions: [{ type: "not", condition: { type: "isCard", target: { type: "selected", id: "__candidate" }, other: "source" } }]
              },
              count: 1
            }
          ],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "z" }, amount: 2 }]
        }
      ]
    }
  });
  const good = miBoard({ extra: [{ key: "striker", def: striker, owner: P2, zone: "play" }], icons: { deception: 3 } });
  actRaw(good.engine, P2, good.id("striker"), "zap", { z: [good.id("mine1")] });
  miPlayRaw(good, "foe1");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("foe1")), 2, "control: another character works");
  const bad = miBoard({ extra: [{ key: "striker", def: striker, owner: P2, zone: "play" }], icons: { deception: 3 } });
  actRaw(bad.engine, P2, bad.id("striker"), "zap", { z: [bad.id("mine1")] });
  refused(() => miPlayRaw(bad, "striker"), "the ability could not have picked its own source");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
});

clause(MISTAKEN, "0:extraCost", "the pick must be something THAT card could pick: a subtype limit applies to the new pick too", () => {
  const orig = pickHitTactic(3, "Pick A Miner", { zone: "play", type: "character", subtype: "miner" });
  const extra = [
    { key: "miner1", def: character({ name: "Miner One", cost: 1, life: 5, subtype: ["miner"] }), owner: P1, zone: "play" as const },
    { key: "miner2", def: character({ name: "Miner Two", cost: 1, life: 5, subtype: ["miner"] }), owner: P2, zone: "play" as const }
  ];
  const good = miBoard({ orig, extra, icons: { deception: 3 } });
  miOpen(good, "miner1");
  miPlayRaw(good, "miner2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("miner2")), 3, "control: another miner works");
  assert.equal(damageOn(good.engine, good.id("miner1")), 0);
  const bad = miBoard({ orig, extra, icons: { deception: 3 } });
  miOpen(bad, "miner1");
  refused(() => miPlayRaw(bad, "foe1"), "a non-miner could not have been picked by the original");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 3, "nothing paid");
});

clause(MISTAKEN, "0:extraCost", "on my own turn it can answer the opponent's response: only the card that picked a character, the top of the stack, is redirected", () => {
  const game = miBoard({
    theirTurn: false,
    extra: [
      { key: "mineHit", def: pickHitTactic(3, "My Hit"), owner: P1, zone: "hand" },
      { key: "theirs", def: pickHitTactic(2, "Their Hit"), owner: P2, zone: "hand" }
    ]
  });
  // I (active) play my own tactic on their character; they answer by hitting my mine1; I answer THAT with Mistaken Identity.
  playRaw(game.engine, P1, game.id("mineHit"), { selected: { t: [game.id("foe1")] } });
  assert.equal(game.engine.state.priorityPlayerId, P2);
  playRaw(game.engine, P2, game.id("theirs"), { selected: { t: [game.id("mine1")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  miPlayRaw(game, "mine2");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine2")), 2, "their response hits the other character instead");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "my own tactic underneath still hits what I picked");
});

clause(MISTAKEN, "1:rule", "only the character pick is swapped: other extra-cost picks of the same card stay as picked", () => {
  const twoPicks = tactic({
    name: "Hit And Break",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "hb",
          type: "activated",
          targets: [
            { id: "t", selector: { zone: "play", type: "character" }, count: 1 },
            { id: "i", selector: { zone: "play", type: "item" }, count: 1 }
          ],
          effects: [
            { type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 },
            { type: "destroy", target: { type: "selected", id: "i" } }
          ]
        }
      ]
    }
  });
  const extra = [{ key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" as const }];
  const game = miBoard({ orig: twoPicks, extra });
  playRaw(game.engine, P2, game.id("orig"), { selected: { t: [game.id("mine1")], i: [game.id("gadget")] } });
  miPlayRaw(game, "foe1");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "the character pick is redirected");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0);
  assert.equal(zoneOf(game.engine, game.id("gadget")), "discard", "the item pick is untouched");
});

// --- EFFECT: the effect happens as though the opponent had picked the other character ---

clause(MISTAKEN, "1:rule", "a destroy effect destroys the other character and spares the one first picked", () => {
  const game = miBoard({ orig: pickKillTactic() });
  miRedirect(game, "mine1", "foe1");
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard", "the other character is destroyed");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play", "the character first picked survives");
  assert.ok(discardOf(game.engine, P2).includes(game.id("foe1")), "discardOf(game.engine, P2).includes(game.id(\"foe1\"))");
});

clause(MISTAKEN, "1:rule", "a return-to-hand effect returns the other character to ITS owner's hand, and the rest of the original effect still happens", () => {
  const game = miBoard({ orig: pickBounceTactic(), extra: fillers("dk", 3, P2, "deck") });
  const handBefore = handOf(game.engine, P2).length;
  miRedirect(game, "mine1", "mine2");
  assert.equal(zoneOf(game.engine, game.id("mine2")), "hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("mine2")), "mine2 returns to my hand");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play", "the character first picked stays");
  assert.equal(handOf(game.engine, P2).length, handBefore - 1 + 1, "the original's other instruction ('draw a card') still happened: the card played left the hand, one was drawn");
});

clause(MISTAKEN, "1:rule", "a buff effect is applied to the other character: the opponent's own pick can be swapped onto my character", () => {
  const game = miBoard({ orig: pickBuffTactic(2) });
  const mineBase = game.engine.getStat(game.id("mine2"), "strength");
  const foeBase = game.engine.getStat(game.id("foe1"), "strength");
  miRedirect(game, "foe1", "mine2");
  assert.equal(game.engine.getStat(game.id("mine2"), "strength"), mineBase + 2, "the buff lands on the other character");
  assert.equal(game.engine.getStat(game.id("foe1"), "strength"), foeBase, "the opponent's first pick gets nothing");
});

clause(MISTAKEN, "1:rule", "until it resolves, the original has not hit anyone: it is Mistaken Identity that resolves first (the window is a response chain)", () => {
  const game = miBoard();
  miOpen(game, "mine1");
  miPlayRaw(game, "foe1");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0, "nothing has happened yet");
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
  assert.equal(zoneOf(game.engine, game.id("orig")), "deploying", "the responded-to tactic is still waiting");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3);
  assert.equal(damageOn(game.engine, game.id("mine1")), 0);
});

clause(MISTAKEN, "1:rule", "the redirected damage is real damage: it can destroy the other character", () => {
  const frail = character({ name: "Frail", cost: 1, life: 2 });
  const game = miBoard({ extra: [{ key: "frail", def: frail, owner: P2, zone: "play" }] });
  miRedirect(game, "mine1", "frail");
  assert.equal(zoneOf(game.engine, game.id("frail")), "discard", "3 damage destroys a 2-life character");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play");
});

clause(MISTAKEN, "1:rule", "if the other character leaves play before the original resolves, the original does not fall back to its first pick (it happens as though the other was picked)", () => {
  const game = miBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  miOpen(game, "mine1");
  miPlayRaw(game, "foe1");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("foe1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard", "the opponent destroyed the other character in response");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0, "the first pick is not hit: the effect happens as though the other character was picked");
});

clause(MISTAKEN, "1:rule", "an unredirected response chain is unaffected: the original hits its first pick when I do not respond", () => {
  const game = miBoard();
  miOpen(game, "mine1");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine1")), 3, "control: with no Mistaken Identity the pick is hit");
  assert.equal(zoneOf(game.engine, game.id("mi")), "hand");
});

clause(MISTAKEN, "1:rule", "even if the character first picked has left play in response, the effect still happens as though the other character had been picked", () => {
  const game = miBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  miOpen(game, "mine1");
  miPlayRaw(game, "foe1");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("mine1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine1")), "discard", "the opponent destroyed the first pick in response");
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "the redirected effect lands on the other character regardless");
});

clause(MISTAKEN, "1:rule", "Mistaken Identity itself picked a character as an extra cost, so the opponent's own Mistaken Identity can answer it: the swap it makes is swapped again", () => {
  const second = { key: "mi2", def: printing(MISTAKEN), owner: P2 as PlayerId, zone: "hand" as Zone };
  const game = miBoard({ extra: [second, ...res({ deception: 2 }, P2)] });
  miOpen(game, "mine1");
  miPlayRaw(game, "foe1");
  assert.equal(game.engine.state.priorityPlayerId, P2, "they may respond to my Mistaken Identity");
  playRaw(game.engine, P2, game.id("mi2"), { selected: { other: [game.id("foe2")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe2")), 3, "my swap was itself swapped: the original lands on foe2");
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
  assert.equal(damageOn(game.engine, game.id("mine1")), 0);
});

// =============================================================================
// Muscle Tribe of Danger and Excellence (Seed Saga) — Character, rogue, miner, cost 2, [D], 2/1/4
//   If a card that provides at least [D] enters play under your control, this
//   card gains 1 strength and COVERT this turn.
// =============================================================================

const MUSCLE = "b956a5a0-3eae-4283-bb05-0606be2699b9";

/** A cost-0 character that PROVIDES the given icons while in play. */
function providerChar(name: string, provides: Array<"deception" | "rage" | "greed" | "elitism" | "obsession">): CardDefinition {
  return character({ name, cost: 0, strength: 1, life: 2, speed: 1, resource: { provides } });
}

/** A cost-0 item that PROVIDES the given icons while in play. */
function providerItem(name: string, provides: Array<"deception" | "rage" | "greed" | "elitism" | "obsession">): CardDefinition {
  return item({ name, cost: 0, resource: { provides } });
}

/** A staple resource card (in a hand) of one icon. */
function stapleCard(icon: StapleIcon, name = `Staple ${icon}`): CardDefinition {
  return resourceCard({ name, trade: "universal", resource: { provides: [icon], staple: true } });
}

/** A free tactic (id "put", pick "t"): puts one picked card from its controller's hand into play under its controller's control. */
function putFromHandTactic(controller: "controller" | "opponent" = "controller", name = "Put In Play"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "put",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", controller: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller }]
        }
      ]
    }
  });
}

interface MtOpts {
  extra?: CardPlacement[];
  /** Where the Muscle Tribe is (default play). */
  zone?: Zone;
  faceDown?: boolean;
  turn?: number;
  active?: PlayerId;
}

function mtBoard(opts: MtOpts = {}) {
  return devBoard(
    [
      { key: "mt", def: printing(MUSCLE), owner: P1, zone: opts.zone ?? "play", faceDown: opts.faceDown },
      { key: "ally", def: character({ name: "Ally", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}
type MtGame = ReturnType<typeof mtBoard>;

const MT_BASE_STRENGTH = 2;
const hasCovert = (engine: SpoilsEngine, cardId: CardInstanceId): boolean => engine.getKeywords(cardId).includes("covert");

/** The Muscle Tribe has gained nothing: base strength, no COVERT. */
function mtUnchanged(game: MtGame, why: string): void {
  assert.equal(game.engine.getStat(game.id("mt"), "strength"), MT_BASE_STRENGTH, `${why}: strength unchanged`);
  assert.equal(hasCovert(game.engine, game.id("mt")), false, `${why}: no COVERT`);
}

/** The Muscle Tribe has gained exactly `n` strength and COVERT. */
function mtGained(game: MtGame, n: number, why: string): void {
  assert.equal(game.engine.getStat(game.id("mt"), "strength"), MT_BASE_STRENGTH + n, `${why}: +${n} strength`);
  assert.equal(hasCovert(game.engine, game.id("mt")), true, `${why}: COVERT`);
}

clause(MUSCLE, "0:rule", "before anything happens it is a plain 2/1/4 without COVERT", () => {
  const game = mtBoard();
  assert.deepEqual(stats(game.engine, game.id("mt")), [2, 1, 4]);
  assert.equal(hasCovert(game.engine, game.id("mt")), false);
});

clause(MUSCLE, "0:rule", "deploying a character that provides [D] gives +1 strength and COVERT", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  mtGained(game, 1, "after a [D] character entered play");
});

clause(MUSCLE, "0:rule", "deploying the real Resistance Fighter (PROVIDES [D]) triggers it", () => {
  const game = mtBoard({
    extra: [
      { key: "rf", def: printing("54acfe5d-ccfe-4f8e-b324-65b65e6d927f"), owner: P1, zone: "hand" },
      ...res({ deception: 1 })
    ]
  });
  play(game.engine, P1, game.id("rf"));
  assert.equal(zoneOf(game.engine, game.id("rf")), "play");
  mtGained(game, 1, "after a Resistance Fighter entered play");
});

clause(MUSCLE, "0:rule", "deploying an item that provides [D] triggers it", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerItem("D Charm", ["deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  mtGained(game, 1, "after a [D] item entered play");
});

clause(MUSCLE, "0:rule", "a card providing [D][D] ('at least [D]') triggers it once: +1 strength, not +2", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerItem("Double D", ["deception", "deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  mtGained(game, 1, "after a [D][D] item entered play");
});

clause(MUSCLE, "0:rule", "a card providing [D] and another icon ('at least [D]') triggers it", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerItem("Mixed", ["rage", "deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  mtGained(game, 1, "after a [R][D] item entered play");
});

clause(MUSCLE, "0:rule", "the real Crest of Deception (PROVIDES [D][D]) triggers it", () => {
  const game = mtBoard({ extra: [{ key: "crest", def: printing("0786957e-6db1-42f2-b8cd-0162b889d0b9"), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("crest"));
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
  mtGained(game, 1, "after Crest of Deception entered play");
});

clause(MUSCLE, "0:rule", "playing a face-up Deception resource (the Develop Rule) triggers it", () => {
  const game = mtBoard({ extra: [{ key: "dres", def: stapleCard("deception"), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("dres"), false);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("dres")), "play");
  assert.equal(game.engine.state.cards[game.id("dres")].faceDown, false);
  mtGained(game, 1, "after a face-up [D] resource entered play");
});

clause(MUSCLE, "0:rule", "a card put into play by an effect (not deployed) that provides [D] triggers it too", () => {
  const game = mtBoard({
    extra: [
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("put"), { selected: { t: [game.id("prov")] } });
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  mtGained(game, 1, "after a [D] card was put into play");
});

clause(MUSCLE, "0:rule", "a Deception resource played FACE-DOWN does not trigger it: a face-down card provides only Volition (CR 411.1)", () => {
  const game = mtBoard({ extra: [{ key: "dres", def: stapleCard("deception"), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("dres"), true);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.cards[game.id("dres")].faceDown, true);
  mtUnchanged(game, "a face-down resource is not a [D] card");
  const control = mtBoard({ extra: [{ key: "dres", def: stapleCard("deception"), owner: P1, zone: "hand" }] });
  developResource(control.engine, P1, control.id("dres"), false);
  resolvePendingResponses(control.engine);
  drain(control.engine, declineAll);
  mtGained(control, 1, "control: face-up works");
});

clause(MUSCLE, "0:rule", "a [D]-providing card played face-down (as a resource) does not trigger it either", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("prov"), true);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.cards[game.id("prov")].faceDown, true);
  mtUnchanged(game, "a face-down card provides only Volition");
});

clause(MUSCLE, "0:rule", "a card that provides no [D] does not trigger it: a plain character, a Rage resource, a [R][G] item, a Volition-only face-down card", () => {
  const cases: Array<[string, CardDefinition, "play" | "develop"]> = [
    ["a plain character", character({ name: "Plain", cost: 0 }), "play"],
    ["a plain item", item({ name: "Plain Item", cost: 0 }), "play"],
    ["a [R] character", providerChar("R Provider", ["rage"]), "play"],
    ["a [R][G] item", providerItem("RG Item", ["rage", "greed"]), "play"],
    ["a [E][O] item", providerItem("EO Item", ["elitism", "obsession"]), "play"],
    ["a Rage resource", stapleCard("rage"), "develop"],
    ["an Obsession resource", stapleCard("obsession"), "develop"]
  ];
  for (const [why, def, how] of cases) {
    const game = mtBoard({ extra: [{ key: "other", def, owner: P1, zone: "hand" }] });
    if (how === "play") play(game.engine, P1, game.id("other"));
    else {
      developResource(game.engine, P1, game.id("other"), false);
      resolvePendingResponses(game.engine);
    }
    drain(game.engine, declineAll);
    assert.equal(zoneOf(game.engine, game.id("other")), "play", why);
    mtUnchanged(game, why);
  }
});

clause(MUSCLE, "0:rule", "a [D] card that enters play under the OPPONENT's control does not trigger it", () => {
  const game = mtBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "prov", def: providerChar("Their D Provider", ["deception"]), owner: P2, zone: "hand" }]
  });
  play(game.engine, P2, game.id("prov"));
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  mtUnchanged(game, "their [D] card is not 'under your control'");
});

clause(MUSCLE, "0:rule", "a [D] card the opponent's effect puts into play under THEIR control does not trigger it (even though I own nothing of it)", () => {
  const game = mtBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "prov", def: providerChar("Their D Provider", ["deception"]), owner: P2, zone: "hand" },
      { key: "put", def: putFromHandTactic(), owner: P2, zone: "hand" }
    ]
  });
  play(game.engine, P2, game.id("put"), { selected: { t: [game.id("prov")] } });
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  assert.equal(controllerOf(game.engine, game.id("prov")), P2);
  mtUnchanged(game, "put into play under their control");
});

clause(MUSCLE, "0:rule", "a card of mine that enters play under the opponent's control does not trigger it; the same card entering under mine does", () => {
  const steal = mtBoard({
    extra: [
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic("opponent"), owner: P1, zone: "hand" }
    ]
  });
  play(steal.engine, P1, steal.id("put"), { selected: { t: [steal.id("prov")] } });
  assert.equal(zoneOf(steal.engine, steal.id("prov")), "play");
  assert.equal(controllerOf(steal.engine, steal.id("prov")), P2, "it entered play under the opponent's control");
  mtUnchanged(steal, "it entered play under the opponent's control");
  const mine = mtBoard({
    extra: [
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic("controller"), owner: P1, zone: "hand" }
    ]
  });
  play(mine.engine, P1, mine.id("put"), { selected: { t: [mine.id("prov")] } });
  mtGained(mine, 1, "control: under my control it triggers");
});

clause(MUSCLE, "0:rule", "each [D] card that enters play adds 1 strength: two cards give +2 strength, and COVERT is just held once", () => {
  const game = mtBoard({
    extra: [
      { key: "p1", def: providerChar("D Provider One", ["deception"]), owner: P1, zone: "hand" },
      { key: "p2", def: providerItem("D Provider Two", ["deception"]), owner: P1, zone: "hand" },
      { key: "p3", def: providerChar("D Provider Three", ["deception"]), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("p1"));
  mtGained(game, 1, "after the first");
  play(game.engine, P1, game.id("p2"));
  mtGained(game, 2, "after the second");
  play(game.engine, P1, game.id("p3"));
  mtGained(game, 3, "after the third");
  assert.equal(game.engine.getKeywords(game.id("mt")).filter((kw) => kw === "covert").length, 1, "COVERT is a single keyword (CR 507.3e)");
});

clause(MUSCLE, "0:rule", "it applies to this card only: another character of mine gains nothing", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  const allyBefore = stats(game.engine, game.id("ally"));
  play(game.engine, P1, game.id("prov"));
  mtGained(game, 1, "the Tribe");
  assert.deepEqual(stats(game.engine, game.id("ally")), allyBefore, "the ally's stats are unchanged");
  assert.equal(hasCovert(game.engine, game.id("ally")), false, "the ally has no COVERT");
  assert.equal(game.engine.getStat(game.id("prov"), "strength"), 1, "the provider itself is not buffed");
});

clause(MUSCLE, "0:rule", "its other stats are unchanged: only strength rises (life 1, speed 4)", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  assert.deepEqual(stats(game.engine, game.id("mt")), [3, 1, 4]);
});

clause(MUSCLE, "0:rule", "'this turn': the strength and COVERT are gone when the turn ends", () => {
  const game = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  mtGained(game, 1, "this turn");
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  mtUnchanged(game, "on the opponent's turn");
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  mtUnchanged(game, "on my next turn");
});

clause(MUSCLE, "0:rule", "it works on the opponent's turn too, if a [D] card of mine enters play then (and ends with that turn)", () => {
  const game = mtBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "prov", def: providerChar("D Tactical", ["deception"]), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic(), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playRaw(game.engine, P1, game.id("put"), { selected: { t: [game.id("prov")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  mtGained(game, 1, "my [D] card entering during their attack");
});

clause(MUSCLE, "0:rule", "it does nothing while the Muscle Tribe is not in play: in hand, in the discard pile, or in the deck", () => {
  for (const zone of ["hand", "discard", "deck"] as const) {
    const game = mtBoard({ zone, extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
    play(game.engine, P1, game.id("prov"));
    assert.equal(zoneOf(game.engine, game.id("mt")), zone, `${zone}: still there`);
    mtUnchanged(game, `Tribe in ${zone}`);
  }
});

clause(MUSCLE, "0:rule", "a face-down Tribe (just a Volition resource, CR 411.1) does not react", () => {
  const game = mtBoard({ faceDown: true, extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("prov"));
  assert.equal(game.engine.state.cards[game.id("mt")].faceDown, true);
  assert.equal(game.engine.getStat(game.id("mt"), "strength") <= MT_BASE_STRENGTH, true, "no strength gain");
  assert.equal(hasCovert(game.engine, game.id("mt")), false);
});

clause(MUSCLE, "0:rule", "the Tribe's own entering does not trigger it (it provides nothing); two Tribes each react to a [D] card entering", () => {
  const game = mtBoard({
    zone: "hand",
    extra: [
      { key: "mt2", def: printing(MUSCLE), owner: P1, zone: "play" },
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      ...res({ deception: 3 })
    ]
  });
  play(game.engine, P1, game.id("mt"));
  assert.equal(zoneOf(game.engine, game.id("mt")), "play");
  assert.equal(game.engine.getStat(game.id("mt2"), "strength"), MT_BASE_STRENGTH, "a Tribe entering play is not a [D] card");
  assert.equal(game.engine.getStat(game.id("mt"), "strength"), MT_BASE_STRENGTH);
  play(game.engine, P1, game.id("prov"));
  drain(game.engine, declineAll);
  assert.equal(game.engine.getStat(game.id("mt"), "strength"), MT_BASE_STRENGTH + 1, "the first Tribe reacts");
  assert.equal(game.engine.getStat(game.id("mt2"), "strength"), MT_BASE_STRENGTH + 1, "the second Tribe reacts");
  assert.equal(hasCovert(game.engine, game.id("mt")), true);
  assert.equal(hasCovert(game.engine, game.id("mt2")), true);
});

clause(MUSCLE, "0:rule", "COVERT works: it can't be blocked by a non-covert character this turn (a covert blocker can block it)", () => {
  const board = (withDProvider: boolean) =>
    mtBoard({
      extra: [
        ...(withDProvider ? [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" as const }] : []),
        { key: "plainBlocker", def: character({ name: "Plain Blocker", cost: 1, life: 4 }), owner: P2, zone: "play" },
        { key: "covertBlocker", def: character({ name: "Covert Blocker", cost: 1, life: 4, behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
      ]
    });
  const without = board(false);
  declareAttackBy(without.engine, P1, [without.id("mt")]);
  declareBlockers(without.engine, P2, [without.id("plainBlocker")]);
  assert.deepEqual(battleOf(without.engine)?.blockingParty, [without.id("plainBlocker")], "control: with no [D] card a plain character may block it");
  const covert = board(true);
  play(covert.engine, P1, covert.id("prov"));
  declareAttackBy(covert.engine, P1, [covert.id("mt")]);
  refused(() => declareBlockers(covert.engine, P2, [covert.id("plainBlocker")]), "a non-covert character cannot block a covert party");
  declareBlockers(covert.engine, P2, [covert.id("covertBlocker")]);
  assert.deepEqual(battleOf(covert.engine)?.blockingParty, [covert.id("covertBlocker")], "a covert character may block it");
});

clause(MUSCLE, "0:rule", "the strength gain is real in battle: unblocked it deals 3 damage to the faction instead of 2", () => {
  const plain = mtBoard();
  declareAttackBy(plain.engine, P1, [plain.id("mt")]);
  declareBlockers(plain.engine, P2, []);
  autoResolveBattle(plain.engine);
  assert.equal(influenceOf(plain.engine, P2), START - 2, "control: 2 strength deals 2");
  const boosted = mtBoard({ extra: [{ key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" }] });
  play(boosted.engine, P1, boosted.id("prov"));
  declareAttackBy(boosted.engine, P1, [boosted.id("mt")]);
  declareBlockers(boosted.engine, P2, []);
  autoResolveBattle(boosted.engine);
  assert.equal(influenceOf(boosted.engine, P2), START - 3, "3 strength deals 3");
});

// =============================================================================
// Mustache Aficionado (Seed Saga) — Character, rogue, gambler, cost 3, [D], 2/3/4
//   MUSTACHE SHOWDOWN
//   COST: Deplete this card.
//   EFFECT: Both players look at the top 3 cards of their deck and divide them
//     into 2 face-down piles containing at least 1 card each. Both players
//     choose one of their opponent's piles. Reveal the chosen piles. If one
//     pile has a higher total numeric cost than the other, the owner of that
//     pile may put one of the cards from it into their hand. Shuffle the
//     remaining cards into their owner's deck.
// =============================================================================

const MUSTACHE = "f276a0be-6c30-4276-a743-30e63619dc41";

/** A small seeded RNG (LCG) for tests that look at shuffled order. */
const lcg = (seed = 1): (() => number) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};

interface MsOpts {
  /** Numeric costs of P1's deck, top first (default 6 cards). */
  p1?: number[];
  /** Numeric costs of P2's deck, top first (default 6 cards). */
  p2?: number[];
  depleted?: boolean;
  zone?: Zone;
  faceDown?: boolean;
  owner?: PlayerId;
  turn?: number;
  active?: PlayerId;
  seed?: number;
  attackEligible?: boolean;
  extra?: CardPlacement[];
}

function msBoard(opts: MsOpts = {}) {
  const mk = (owner: PlayerId, prefix: string, costs: number[]): CardPlacement[] =>
    costs.map((cost, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()} card ${i}`, cost }), owner, zone: "deck" as const }));
  return devBoard(
    [
      {
        key: "ma",
        def: printing(MUSTACHE),
        owner: opts.owner ?? P1,
        zone: opts.zone ?? "play",
        depleted: opts.depleted,
        faceDown: opts.faceDown,
        attackEligible: opts.attackEligible
      },
      ...mk(P1, "a", opts.p1 ?? [5, 1, 1, 2, 2, 3]),
      ...mk(P2, "b", opts.p2 ?? [2, 2, 0, 1, 1, 1]),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1, random: lcg(opts.seed ?? 11) }
  );
}
type MsGame = ReturnType<typeof msBoard>;

interface MsPlan {
  /** P1's piles, as indexes into P1's top 3 cards (top first). */
  p1Piles: number[][];
  /** P2's piles, as indexes into P2's top 3 cards. */
  p2Piles: number[][];
  /** The pile of the OPPONENT's that P1 chooses. */
  p1Pick: number;
  /** The pile of the OPPONENT's that P2 chooses. */
  p2Pick: number;
}

const MS_DEFAULT: MsPlan = { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 };

/** Activates MUSTACHE SHOWDOWN (P1's Aficionado) and answers the choices in `plan`, stopping at the first choice after the picks. */
function msDrive(game: MsGame, plan: MsPlan = MS_DEFAULT) {
  const { engine } = game;
  const top1 = deckOf(engine, P1).slice(0, 3);
  const top2 = deckOf(engine, P2).slice(0, 3);
  actRaw(engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(engine);
  let pc = expectPending(engine, "partitionCards");
  assert.equal(pc.playerId, P1, "the controller divides their cards first");
  answerPending(engine, "partitionCards", { piles: plan.p1Piles.map((pile) => pile.map((i) => top1[i])) });
  pc = expectPending(engine, "partitionCards");
  assert.equal(pc.playerId, P2, "then the opponent divides theirs");
  answerPending(engine, "partitionCards", { piles: plan.p2Piles.map((pile) => pile.map((i) => top2[i])) });
  pc = expectPending(engine, "pickPile");
  assert.equal(pc.playerId, P1);
  answerPending(engine, "pickPile", { index: plan.p1Pick });
  pc = expectPending(engine, "pickPile");
  assert.equal(pc.playerId, P2);
  answerPending(engine, "pickPile", { index: plan.p2Pick });
  return { top1, top2, a: (i: number) => top1[i], b: (i: number) => top2[i] };
}

/** The cards currently in `player`'s deck, sorted (for "nothing lost, nothing added" checks). */
const sortedDeck = (engine: SpoilsEngine, player: PlayerId): CardInstanceId[] => deckOf(engine, player).sort();

/** The ids of every card revealed by `cardsRevealed` events logged so far. */
function revealedIds(engine: SpoilsEngine): CardInstanceId[] {
  return engine
    .getLog()
    .flatMap((entry) => (entry.event && entry.event.type === "cardsRevealed" ? entry.event.cardIds : []));
}

// --- cost: Deplete this card ---

clause(MUSTACHE, "0:ability:mustache-showdown", "the cost is depleting the Aficionado: it is depleted as soon as the ability is used, before the opponent can respond, and no resource is paid", () => {
  const game = msBoard();
  const before = ready(game.engine);
  assert.equal(isDepleted(game.engine, game.id("ma")), false);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  assert.equal(isDepleted(game.engine, game.id("ma")), true, "depleted as a cost");
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(game.engine.state.pendingChoice, undefined, "nothing has resolved yet");
  assert.equal(ready(game.engine), before, "deplete is the whole cost: no resource is spent");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "cannot be used while the Aficionado is already depleted", () => {
  const bad = msBoard({ depleted: true });
  refused(() => actRaw(bad.engine, P1, bad.id("ma"), "mustache-showdown"), "a depleted card cannot pay 'Deplete this card'");
  assert.equal(bad.engine.state.pendingChoice, undefined);
  assert.equal(bad.engine.state.responseWindow, undefined, "nothing was put on the stack");
  const good = msBoard({ depleted: false });
  actRaw(good.engine, P1, good.id("ma"), "mustache-showdown");
  assert.equal(isDepleted(good.engine, good.id("ma")), true, "control: a ready Aficionado can use it");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "once used it cannot be used again the same turn (it stays depleted)", () => {
  const game = msBoard();
  msDrive(game);
  answerPending(game.engine, "takeFromPile", { cardIds: [] });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(isDepleted(game.engine, game.id("ma")), true);
  refused(() => actRaw(game.engine, P1, game.id("ma"), "mustache-showdown"), "still depleted");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "it can be used on the turn the Aficionado entered play (abilities have no summoning sickness, CR 204.3a)", () => {
  const game = msBoard({ attackEligible: false });
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine)?.kind, "partitionCards");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "only its controller can use it: not the opponent, and not from hand, or face-down", () => {
  const opp = msBoard();
  refused(() => actRaw(opp.engine, P2, opp.id("ma"), "mustache-showdown"), "the opponent does not control it");
  const hand = msBoard({ zone: "hand" });
  refused(() => actRaw(hand.engine, P1, hand.id("ma"), "mustache-showdown"), "in hand");
  const down = msBoard({ faceDown: true });
  refused(() => actRaw(down.engine, P1, down.id("ma"), "mustache-showdown"), "face-down it is only a resource (CR 411.1)");
  const discard = msBoard({ zone: "discard" });
  refused(() => actRaw(discard.engine, P1, discard.id("ma"), "mustache-showdown"), "in the discard pile");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "it can be used as a response, e.g. to the opponent's attack on their turn", () => {
  const game = msBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  assert.equal(isDepleted(game.engine, game.id("ma")), true);
  resolvePendingResponses(game.engine);
  assert.equal(pending(game.engine)?.kind, "partitionCards", "the showdown runs");
});

// --- "Both players look at the top 3 cards of their deck and divide them into 2 face-down piles containing at least 1 card each" ---

clause(MUSTACHE, "0:ability:mustache-showdown", "each player is asked to divide exactly the top 3 cards of THEIR OWN deck (the controller first, then the opponent), into 2 piles", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  const first = expectPending(game.engine, "partitionCards");
  assert.equal(first.playerId, P1);
  assert.deepEqual([...(first.cardIds as string[])].sort(), [...top1].sort(), "my own top 3 cards");
  assert.equal(first.piles, 2, "2 piles");
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  const second = expectPending(game.engine, "partitionCards");
  assert.equal(second.playerId, P2);
  assert.deepEqual([...(second.cardIds as string[])].sort(), [...top2].sort(), "their own top 3 cards");
  assert.equal(second.piles, 2);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "both 1+2 and 2+1 divisions are legal, in either order of cards", () => {
  // 1 + 2 for both: my pile0 = [a2] (1) is chosen by them, their pile0 = [b2] (0) is chosen by me: mine is higher, I may take.
  const onePlusTwo = msBoard();
  const run1 = msDrive(onePlusTwo, { p1Piles: [[2], [1, 0]], p2Piles: [[2], [1, 0]], p1Pick: 0, p2Pick: 0 });
  const pc1 = expectPending(onePlusTwo.engine, "takeFromPile");
  assert.equal(pc1.playerId, P1);
  assert.deepEqual(pc1.candidates, [run1.a(2)]);
  // 2 + 1: my pile1 = [a2] (1) chosen by them, their pile1 = [b0] (2) chosen by me: theirs is higher, they may take.
  const twoPlusOne = msBoard();
  const run2 = msDrive(twoPlusOne, { p1Piles: [[0, 1], [2]], p2Piles: [[1, 2], [0]], p1Pick: 1, p2Pick: 1 });
  const pc2 = expectPending(twoPlusOne.engine, "takeFromPile");
  assert.equal(pc2.playerId, P2);
  assert.deepEqual(pc2.candidates, [run2.b(0)]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the piles must each contain at least 1 card: all three cards in one pile (and an empty one) is refused", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[...top1], []] }), "an empty pile");
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[], [...top1]] }), "an empty first pile");
  assert.equal(pending(game.engine)?.kind, "partitionCards", "the choice stays open");
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  assert.equal(pending(game.engine)?.playerId, P2, "control: a legal division is accepted");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "it must be exactly 2 piles: one pile of 3 and three piles of 1 are refused", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[...top1]] }), "a single pile");
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1]], [top1[2]]] }), "three piles");
  assert.equal(pending(game.engine)?.kind, "partitionCards");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the piles must be exactly the looked-at cards: a missing card, a duplicate, or a card from the rest of the deck is refused", () => {
  const game = msBoard();
  const deck1 = deckOf(game.engine, P1);
  const top1 = deck1.slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1]]] }), "the third card is missing");
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[top1[0], top1[0]], [top1[1], top1[2]]] }), "a duplicate");
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], deck1[3]]] }), "a card from deeper in the deck instead of the third");
  const theirs = deckOf(game.engine, P2)[0];
  refused(() => answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], theirs]] }), "a card from the opponent's deck");
  assert.equal(pending(game.engine)?.kind, "partitionCards");
  answerPending(game.engine, "partitionCards", { piles: [[top1[2]], [top1[1], top1[0]]] });
  assert.equal(pending(game.engine)?.playerId, P2, "control: a legal division is accepted");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the opponent divides their OWN cards: I cannot answer their division, and they cannot answer mine", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P2, choice: { kind: "partitionCards", piles: [[top1[0]], [top1[1], top1[2]]] } } as never),
    "it is my choice to make, not theirs",
    /not|your|choice|player/i
  );
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  refused(
    () => game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "partitionCards", piles: [[top2[0]], [top2[1], top2[2]]] } } as never),
    "it is their choice to make, not mine",
    /not|your|choice|player/i
  );
  assert.equal(pending(game.engine)?.playerId, P2);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "looking and dividing move nothing: every card is still in its owner's deck until the comparison", () => {
  const game = msBoard();
  const before1 = sortedDeck(game.engine, P1);
  const before2 = sortedDeck(game.engine, P2);
  msDrive(game);
  assert.deepEqual(sortedDeck(game.engine, P1), before1);
  assert.deepEqual(sortedDeck(game.engine, P2), before2);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(handOf(game.engine, P2).length, 0);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the cards looked at are read when the ability RESOLVES: if the opponent draws in response, their top 3 are the next three", () => {
  const draw = tactic({ name: "Quick Draw", cost: 0, behavior: { abilities: [{ id: "qd", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const game = msBoard({ extra: [{ key: "qd", def: draw, owner: P2, zone: "hand" }] });
  const deck2 = deckOf(game.engine, P2);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  playRaw(game.engine, P2, game.id("qd"));
  resolvePendingResponses(game.engine);
  expectPending(game.engine, "partitionCards");
  answerPending(game.engine, "partitionCards", { piles: [[deckOf(game.engine, P1)[0]], deckOf(game.engine, P1).slice(1, 3)] });
  const pc = expectPending(game.engine, "partitionCards");
  assert.equal(pc.playerId, P2);
  assert.deepEqual([...(pc.cardIds as string[])].sort(), deck2.slice(1, 4).sort(), "their top 3 are now the 2nd..4th of the original deck");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the ability still resolves when the Aficionado has been destroyed in response (the cost is already paid)", () => {
  const game = msBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("ma")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("ma")), "discard");
  assert.equal(pending(game.engine)?.kind, "partitionCards", "the showdown still runs (CR 502.4)");
});

// --- "Both players choose one of their opponent's piles" ---

clause(MUSTACHE, "0:ability:mustache-showdown", "each player is asked to choose among the OPPONENT's two piles (controller first), seeing the piles the opponent made", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  answerPending(game.engine, "partitionCards", { piles: [[top2[2], top2[0]], [top2[1]]] });
  const mine = expectPending(game.engine, "pickPile");
  assert.equal(mine.playerId, P1);
  assert.deepEqual(
    (mine.piles as string[][]).map((pile) => [...pile].sort()),
    [[top2[2], top2[0]].sort(), [top2[1]]],
    "I choose between THEIR piles"
  );
  answerPending(game.engine, "pickPile", { index: 1 });
  const theirs = expectPending(game.engine, "pickPile");
  assert.equal(theirs.playerId, P2);
  assert.deepEqual(
    (theirs.piles as string[][]).map((pile) => [...pile].sort()),
    [[top1[0]], [top1[1], top1[2]].sort()],
    "they choose between MY piles"
  );
});

clause(MUSTACHE, "0:ability:mustache-showdown", "only a pile index 0 or 1 is a legal choice: -1, 2 and 0.5 are refused", () => {
  const game = msBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  answerPending(game.engine, "partitionCards", { piles: [[top2[0]], [top2[1], top2[2]]] });
  refused(() => answerPending(game.engine, "pickPile", { index: -1 }), "index -1");
  refused(() => answerPending(game.engine, "pickPile", { index: 2 }), "index 2");
  refused(() => answerPending(game.engine, "pickPile", { index: 0.5 }), "index 0.5");
  assert.equal(pending(game.engine)?.kind, "pickPile");
  answerPending(game.engine, "pickPile", { index: 1 });
  assert.equal(pending(game.engine)?.playerId, P2, "control: 1 is legal and the opponent chooses next");
});

// --- "Reveal the chosen piles" ---

clause(MUSTACHE, "0:ability:mustache-showdown", "exactly the two chosen piles are revealed: the unchosen piles are not", () => {
  const game = msBoard();
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 1, p2Pick: 0 });
  const revealed = revealedIds(game.engine);
  // I chose their pile 1 = [b1, b2]; they chose my pile 0 = [a0].
  for (const id of [run.b(1), run.b(2), run.a(0)]) assert.ok(revealed.includes(id), `${id} (a chosen pile) is revealed`);
  for (const id of [run.b(0), run.a(1), run.a(2)]) assert.equal(revealed.includes(id), false, `${id} (an unchosen pile) stays hidden`);
});

// --- "If one pile has a higher total numeric cost than the other, the owner of that pile may put one of the cards from it into their hand" ---

/** Costs: mine a0=5, a1=1, a2=1 (pile0 = [a0] = 5, pile1 = [a1, a2] = 2); theirs b0=2, b1=2, b2=0 (pile0 = [b0] = 2, pile1 = [b1, b2] = 2). */
clause(MUSTACHE, "0:ability:mustache-showdown", "my chosen pile (cost 5) beats theirs (cost 2): I, its owner, may take one of ITS cards, and they get no choice", () => {
  const game = msBoard();
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P1, "the owner of the higher pile decides");
  assert.deepEqual(pc.candidates, [run.a(0)], "only the cards of my chosen pile");
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(0)] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.deepEqual(handOf(game.engine, P1), [run.a(0)], "the card is in my hand");
  assert.equal(handOf(game.engine, P2).length, 0, "they get nothing");
  assert.equal(zoneOf(game.engine, run.a(0)), "hand");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "their chosen pile beats mine: THEY, the owner of that pile, take one of its cards into THEIR hand", () => {
  const game = msBoard({ p1: [1, 1, 0, 2, 2, 3], p2: [4, 3, 3, 1, 1, 1] });
  // my piles: [a0,a1,a2] split 0 | 1,2 -> costs 1 | 1; their piles: [b0] = 4 | [b1,b2] = 6
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 1, p2Pick: 0 });
  // I chose their pile [b1,b2] (6); they chose my pile [a0] (1)
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P2, "the owner of the higher pile (them) decides");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [run.b(1), run.b(2)].sort());
  answerPending(game.engine, "takeFromPile", { cardIds: [run.b(2)] });
  assert.deepEqual(handOf(game.engine, P2), [run.b(2)]);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(zoneOf(game.engine, run.b(2)), "hand");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the pile is compared by the SUM of its cards' numeric costs: 3+3 beats a single 5, and a single 5 beats 2+2", () => {
  const sum = msBoard({ p1: [3, 3, 0, 1, 1, 1], p2: [5, 1, 1, 1, 1, 1] });
  // my pile0 = [a0,a1] = 6 vs their pile0 = [b0] = 5
  const run1 = msDrive(sum, { p1Piles: [[0, 1], [2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  const pc1 = expectPending(sum.engine, "takeFromPile");
  assert.equal(pc1.playerId, P1, "6 beats 5");
  assert.deepEqual([...(pc1.candidates as string[])].sort(), [run1.a(0), run1.a(1)].sort());
  const single = msBoard({ p1: [2, 2, 0, 1, 1, 1], p2: [5, 1, 1, 1, 1, 1] });
  // my pile0 = [a0,a1] = 4 vs their pile0 = [b0] = 5
  const run2 = msDrive(single, { p1Piles: [[0, 1], [2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  const pc2 = expectPending(single.engine, "takeFromPile");
  assert.equal(pc2.playerId, P2, "5 beats 2+2");
  assert.deepEqual(pc2.candidates, [run2.b(0)]);
});

/** A board whose top 3 cards are of mixed types: mine a0 = tactic (3), a1 = item (2), a2 = a character with no cost number; theirs b0 = location (4), b1 = cost-0 character, b2 = tactic (1). */
function msMixedBoard() {
  return devBoard(
    [
      { key: "ma", def: printing(MUSTACHE), owner: P1, zone: "play" },
      { key: "a0", def: tactic({ name: "Cost Three Tactic", cost: 3 }), owner: P1, zone: "deck" },
      { key: "a1", def: item({ name: "Cost Two Item", cost: 2 }), owner: P1, zone: "deck" },
      { key: "a2", def: character({ name: "Costless", cost: undefined }), owner: P1, zone: "deck" },
      { key: "a3", def: character({ name: "Spare A" }), owner: P1, zone: "deck" },
      { key: "b0", def: location({ name: "Cost Four Place", cost: 4 }), owner: P2, zone: "deck" },
      { key: "b1", def: character({ name: "Cost Zero", cost: 0 }), owner: P2, zone: "deck" },
      { key: "b2", def: tactic({ name: "Cost One", cost: 1 }), owner: P2, zone: "deck" },
      { key: "b3", def: character({ name: "Spare B" }), owner: P2, zone: "deck" }
    ],
    { random: lcg(5) }
  );
}

clause(MUSTACHE, "0:ability:mustache-showdown", "numeric cost is the printed cost of any card type, and a card with no cost number counts as 0: tactic 3 + costless 0 beats character 0 + tactic 1", () => {
  const game = msMixedBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  assert.deepEqual(top1, [game.id("a0"), game.id("a1"), game.id("a2")]);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "partitionCards", { piles: [[top1[0], top1[2]], [top1[1]]] }); // 3 + 0 | 2
  answerPending(game.engine, "partitionCards", { piles: [[top2[1], top2[2]], [top2[0]]] }); // 0 + 1 | 4
  answerPending(game.engine, "pickPile", { index: 0 }); // I pick their 0 + 1 = 1
  answerPending(game.engine, "pickPile", { index: 0 }); // they pick my 3 + 0 = 3
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P1, "3 (tactic) + 0 (no cost number) beats 0 + 1");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [top1[0], top1[2]].sort());
});

clause(MUSTACHE, "0:ability:mustache-showdown", "a location's cost counts too: a lone cost-4 location pile beats a lone cost-2 item pile", () => {
  const game = msMixedBoard();
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "partitionCards", { piles: [[top1[0], top1[2]], [top1[1]]] }); // 3 + 0 | 2
  answerPending(game.engine, "partitionCards", { piles: [[top2[1], top2[2]], [top2[0]]] }); // 0 + 1 | 4
  answerPending(game.engine, "pickPile", { index: 1 }); // I pick their [location] = 4
  answerPending(game.engine, "pickPile", { index: 1 }); // they pick my [item] = 2
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P2, "4 beats 2");
  assert.deepEqual(pc.candidates, [top2[0]]);
});

/** Four-way table: my piles are 5 | 2 (a0 | a1+a2), theirs 2 | 2... made distinct so every pair of choices has a definite winner. */
const msFourWay = (p1Pick: number, p2Pick: number) => {
  // mine: a0=5 -> pile0 = 5, pile1 = [a1, a2] = 1; theirs: b0=3 -> pile0 = 3, pile1 = [b1, b2] = 6.
  const game = msBoard({ p1: [5, 0, 1, 1, 1, 1], p2: [3, 3, 3, 1, 1, 1] });
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick, p2Pick });
  return { game, run, pc: pending(game.engine) };
};

clause(MUSTACHE, "0:ability:mustache-showdown", "choices (I pick their pile 0, they pick my pile 0): 5 (mine) vs 3 (theirs): mine is higher, I take", () => {
  const { pc, run } = msFourWay(0, 0);
  assert.equal(pc?.kind, "takeFromPile");
  assert.equal(pc?.playerId, P1);
  assert.deepEqual(pc?.candidates, [run.a(0)]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "choices (I pick their pile 1, they pick my pile 0): 5 (mine) vs 6 (theirs): theirs is higher, they take", () => {
  const { pc, run } = msFourWay(1, 0);
  assert.equal(pc?.kind, "takeFromPile");
  assert.equal(pc?.playerId, P2);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [run.b(1), run.b(2)].sort());
});

clause(MUSTACHE, "0:ability:mustache-showdown", "choices (I pick their pile 0, they pick my pile 1): 1 (mine) vs 3 (theirs): theirs is higher, they take", () => {
  const { pc, run } = msFourWay(0, 1);
  assert.equal(pc?.kind, "takeFromPile");
  assert.equal(pc?.playerId, P2);
  assert.deepEqual(pc?.candidates, [run.b(0)]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "choices (I pick their pile 1, they pick my pile 1): 1 (mine) vs 6 (theirs): theirs is higher, they take", () => {
  const { pc, run } = msFourWay(1, 1);
  assert.equal(pc?.kind, "takeFromPile");
  assert.equal(pc?.playerId, P2);
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [run.b(1), run.b(2)].sort());
});

clause(MUSTACHE, "0:ability:mustache-showdown", "equal totals: neither player takes a card, no choice is offered, and the cards stay in the decks", () => {
  const game = msBoard({ p1: [2, 1, 1, 1, 1, 1], p2: [2, 2, 0, 1, 1, 1] });
  const before1 = sortedDeck(game.engine, P1);
  const before2 = sortedDeck(game.engine, P2);
  // my chosen pile0 = [a0] = 2 vs their chosen pile0 = [b0] = 2
  msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  assert.equal(game.engine.state.pendingChoice, undefined, "a tie is not a win for anyone");
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.deepEqual(sortedDeck(game.engine, P1), before1, "nothing left either deck");
  assert.deepEqual(sortedDeck(game.engine, P2), before2);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "two piles of cost 0 tie as well (0 is not higher than 0)", () => {
  const game = msBoard({ p1: [0, 0, 0, 1, 1, 1], p2: [0, 0, 0, 1, 1, 1] });
  msDrive(game);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(handOf(game.engine, P1).length + handOf(game.engine, P2).length, 0);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "'may': the winner can decline to take any card; nothing moves", () => {
  const game = msBoard();
  const before1 = sortedDeck(game.engine, P1);
  const before2 = sortedDeck(game.engine, P2);
  msDrive(game);
  expectPending(game.engine, "takeFromPile");
  answerPending(game.engine, "takeFromPile", { cardIds: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(handOf(game.engine, P1).length, 0);
  assert.equal(handOf(game.engine, P2).length, 0);
  assert.deepEqual(sortedDeck(game.engine, P1), before1);
  assert.deepEqual(sortedDeck(game.engine, P2), before2);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "'one of the cards from it': two cards cannot be taken, nor a card from the other (unchosen) pile, nor from the loser's pile", () => {
  // Winner (me) has a 2-card chosen pile [a1, a2]; the unchosen pile is [a0].
  const game = msBoard({ p1: [1, 4, 4, 1, 1, 1], p2: [1, 1, 1, 1, 1, 1] });
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 1 });
  // I chose their pile0 = [b0] (1); they chose my pile1 = [a1, a2] (8): I own the winning pile.
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P1);
  assert.deepEqual([...(pc.candidates as string[])].sort(), [run.a(1), run.a(2)].sort());
  refused(() => answerPending(game.engine, "takeFromPile", { cardIds: [run.a(1), run.a(2)] }), "two cards from the pile");
  refused(() => answerPending(game.engine, "takeFromPile", { cardIds: [run.a(0)] }), "a card from my unchosen pile");
  refused(() => answerPending(game.engine, "takeFromPile", { cardIds: [run.b(0)] }), "a card from the loser's pile");
  refused(() => answerPending(game.engine, "takeFromPile", { cardIds: [run.a(1), run.a(1)] }), "the same card twice");
  assert.equal(pending(game.engine)?.kind, "takeFromPile", "the choice stays open");
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(2)] });
  assert.deepEqual(handOf(game.engine, P1), [run.a(2)], "control: exactly one legal card is taken");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the card taken leaves the deck for the hand; the rest of the pile stays in the deck", () => {
  const game = msBoard({ p1: [1, 4, 4, 1, 1, 1], p2: [1, 1, 1, 1, 1, 1] });
  const deckBefore = deckOf(game.engine, P1);
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 1 });
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(1)] });
  assert.equal(deckOf(game.engine, P1).length, deckBefore.length - 1);
  assert.equal(deckOf(game.engine, P1).includes(run.a(1)), false);
  assert.equal(deckOf(game.engine, P1).includes(run.a(2)), true, "the other card of the pile stays in the deck");
  assert.equal(deckOf(game.engine, P2).length, 6, "their deck is untouched in size");
});

// --- "Shuffle the remaining cards into their owner's deck" ---

clause(MUSTACHE, "0:ability:mustache-showdown", "after a card is taken, BOTH decks are shuffled: no card is lost or duplicated, and the order changes", () => {
  const game = msBoard({ p1: [5, 1, 1, 2, 2, 3, 3, 4], p2: [2, 2, 0, 1, 1, 1, 6, 7] });
  const before1 = deckOf(game.engine, P1);
  const before2 = deckOf(game.engine, P2);
  const run = msDrive(game);
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(0)] });
  const after1 = deckOf(game.engine, P1);
  const after2 = deckOf(game.engine, P2);
  assert.deepEqual([...after1].sort(), before1.filter((id) => id !== run.a(0)).sort(), "my deck: everything but the taken card");
  assert.deepEqual([...after2].sort(), [...before2].sort(), "their deck: all cards");
  assert.notDeepEqual(after1, before1.filter((id) => id !== run.a(0)), "my deck was shuffled");
  assert.notDeepEqual(after2, before2, "their deck was shuffled");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "decks are shuffled even when nobody takes (a tie, or the winner declines)", () => {
  const tie = msBoard({ p1: [2, 1, 1, 1, 1, 1, 3, 4], p2: [2, 2, 0, 1, 1, 1, 6, 7] });
  const t1 = deckOf(tie.engine, P1);
  const t2 = deckOf(tie.engine, P2);
  msDrive(tie, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  assert.equal(tie.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(tie.engine, P1).sort(), [...t1].sort());
  assert.notDeepEqual(deckOf(tie.engine, P1), t1, "my deck shuffled on a tie");
  assert.notDeepEqual(deckOf(tie.engine, P2), t2, "their deck shuffled on a tie");
  const declined = msBoard({ p1: [5, 1, 1, 2, 2, 3, 3, 4], p2: [2, 2, 0, 1, 1, 1, 6, 7] });
  const d1 = deckOf(declined.engine, P1);
  const d2 = deckOf(declined.engine, P2);
  msDrive(declined);
  answerPending(declined.engine, "takeFromPile", { cardIds: [] });
  assert.notDeepEqual(deckOf(declined.engine, P1), d1, "my deck shuffled when the winner declines");
  assert.notDeepEqual(deckOf(declined.engine, P2), d2, "their deck shuffled when the winner declines");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the shuffle is random: a different seed gives a different order (it is not a fixed reordering)", () => {
  const costs1 = [2, 1, 1, 1, 1, 1, 3, 4];
  const costs2 = [2, 2, 0, 1, 1, 1, 6, 7];
  const orders = [3, 77].map((seed) => {
    const game = msBoard({ p1: costs1, p2: costs2, seed });
    msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
    return deckOf(game.engine, P1).map((id) => game.engine.getDefinition(id).name);
  });
  assert.notDeepEqual(orders[0], orders[1]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "cards in hand, in play and in the discard pile are not part of the shuffle", () => {
  const game = msBoard({
    p1: [5, 1, 1, 2, 2, 3],
    extra: [
      { key: "handCard", def: character({ name: "In My Hand" }), owner: P1, zone: "hand" },
      { key: "discardCard", def: character({ name: "In My Discard" }), owner: P1, zone: "discard" },
      { key: "theirHand", def: character({ name: "In Their Hand" }), owner: P2, zone: "hand" }
    ]
  });
  const run = msDrive(game);
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(0)] });
  assert.equal(zoneOf(game.engine, game.id("handCard")), "hand");
  assert.equal(zoneOf(game.engine, game.id("discardCard")), "discard");
  assert.equal(zoneOf(game.engine, game.id("theirHand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("ma")), "play");
  assert.equal(handOf(game.engine, P1).length, 2, "the taken card joined the hand");
});

// --- fewer than 3 cards in a deck ---

clause(MUSTACHE, "0:ability:mustache-showdown", "a player with only 2 cards in their deck looks at both and divides them 1 + 1", () => {
  const game = msBoard({ p2: [2, 2] });
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  const pc = expectPending(game.engine, "partitionCards");
  assert.equal(pc.playerId, P2);
  assert.equal((pc.cardIds as string[]).length, 2, "their whole deck");
  const [x, y] = deckOf(game.engine, P2);
  answerPending(game.engine, "partitionCards", { piles: [[x], [y]] });
  expectPending(game.engine, "pickPile");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "a player whose deck has fewer cards than piles (1 card) cannot divide: no piles are made, nothing is moved, and the cost stays paid", () => {
  const game = msBoard({ p2: [2] });
  const before1 = sortedDeck(game.engine, P1);
  const before2 = sortedDeck(game.engine, P2);
  actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined, "no division is possible, so no piles are offered");
  assert.equal(isDepleted(game.engine, game.id("ma")), true, "the cost is paid regardless");
  assert.equal(handOf(game.engine, P1).length + handOf(game.engine, P2).length, 0);
  assert.deepEqual(sortedDeck(game.engine, P1), before1);
  assert.deepEqual(sortedDeck(game.engine, P2), before2);
});

// =============================================================================
// Shared helpers for the three cards below
// =============================================================================

/** Plays the card from hand with `placements` as the only resources: cost / threshold probe with LITERAL numbers. */
function deployProbe(defId: string, placements: CardPlacement[]): { entered: boolean; paid: number; refusedPlay: boolean } {
  const { engine, id } = devBoard([
    { key: "c", def: printing(defId), owner: P1, zone: "hand" },
    ...fillers("dk", 3, P1, "deck", (i) => character({ name: `Deck ${i}` })),
    ...placements
  ]);
  const before = ready(engine);
  let refusedPlay = false;
  try {
    playRaw(engine, P1, id("c"));
    resolvePendingResponses(engine);
  } catch {
    refusedPlay = true;
  }
  return { entered: zoneOf(engine, id("c")) === "play", paid: before - ready(engine), refusedPlay };
}

const eventsOf = (engine: SpoilsEngine, type: string): Array<Record<string, unknown>> =>
  engine
    .getLog()
    .map((entry) => entry.event as unknown as Record<string, unknown> | undefined)
    .filter((event): event is Record<string, unknown> => !!event && event.type === type);

/** Answers the open `uniqueSurvivor` choice. */
function keepUnique(engine: SpoilsEngine, player: PlayerId, keep: CardInstanceId): void {
  engine.perform({ type: "resolvePendingChoice", playerId: player, choice: { kind: "uniqueSurvivor", keep } } as never);
  resolvePendingResponses(engine);
}

// =============================================================================
// Lecram, Silent Advisor (Seed Saga) — Character, rogue, advisor, cost 2, [D][D], 2/2/2
//   COVERT, UNIQUE LECRAM
//   At the start of your turn, you may look at the top card of your deck.
//   At the end of your turn, flip a coin. If you win, look at the top card of an opponent's deck.
// =============================================================================

const LECRAM = "52575cdb-9125-474c-8dea-0506f28f8ee0";

function lecramBoard(opts: { random?: () => number; extra?: CardPlacement[]; owner?: PlayerId; zone?: Zone } = {}) {
  return devBoard(
    [
      { key: "lec", def: printing(LECRAM), owner: opts.owner ?? P1, zone: opts.zone ?? "play" },
      ...fillers("a", 4, P1, "deck", (i) => character({ name: `A${i}`, cost: i })),
      ...fillers("b", 4, P2, "deck", (i) => character({ name: `B${i}`, cost: i })),
      ...(opts.extra ?? [])
    ],
    { random: opts.random ?? (() => 0.9) }
  );
}

clause(LECRAM, "0:kw:COVERT", "has the COVERT keyword", () => covertHasKeyword(LECRAM));
clause(LECRAM, "0:kw:COVERT", "a COVERT party cannot be blocked by non-COVERT characters", () => covertCannotBeBlockedByNonCovert(LECRAM));
clause(LECRAM, "0:kw:COVERT", "a party needs every member to be COVERT to be unblockable by non-COVERT characters", () => covertPartyNeedsEveryMemberCovert(LECRAM));
clause(LECRAM, "0:kw:COVERT", "a COVERT blocker can only block COVERT parties", () => covertBlocksOnlyCovertParties(LECRAM));

clause(LECRAM, "0:kw:COVERT", "printed cost 2 and threshold [D][D]: exactly [D][D] deploys and pays 2; one resource short, or one [D] short, is refused", () => {
  const ok = deployProbe(LECRAM, res({ deception: 2 }));
  assert.deepEqual([ok.entered, ok.paid], [true, 2], "exactly [D][D] deploys for 2");
  const oneShort = deployProbe(LECRAM, res({ deception: 1 }));
  assert.equal(oneShort.entered, false, "one resource short");
  assert.equal(oneShort.refusedPlay, true);
  const iconShort = deployProbe(LECRAM, res({ deception: 1, rage: 1 }));
  assert.equal(iconShort.entered, false, "2 resources but only one [D]");
  assert.equal(iconShort.refusedPlay, true);
  const noIcon = deployProbe(LECRAM, res({ rage: 5 }));
  assert.equal(noIcon.entered, false, "no [D] at all");
  // spent icons count for the threshold but cannot pay: the cost is 2, not 1
  const costOne = deployProbe(LECRAM, [...spent({ deception: 2 }), ...res({ rage: 1 })]);
  assert.equal(costOne.entered, false, "[D][D] met by spent icons, but only 1 ready resource: the cost is 2");
  const costTwo = deployProbe(LECRAM, [...spent({ deception: 2 }), ...res({ rage: 2 })]);
  assert.deepEqual([costTwo.entered, costTwo.paid], [true, 2], "threshold met by spent icons, 2 ready resources pay exactly 2");
});

clause(LECRAM, "0:kw:COVERT", "is a 2/2/2 rogue advisor character (strength 2, life 2, speed 2)", () => {
  const { engine, id } = lecramBoard();
  assert.deepEqual(stats(engine, id("lec")), [2, 2, 2]);
  const def = engine.getDefinition(id("lec"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype, ["advisor"]);
});

clause(LECRAM, "0:unique", "UNIQUE LECRAM: deploying a second Lecram asks the controller which to keep (keep the new one)", () => {
  const { engine, id } = lecramBoard({ extra: [{ key: "lec2", def: printing(LECRAM), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  play(engine, P1, id("lec2"));
  const pc = pending(engine);
  assert.equal(pc?.kind, "uniqueSurvivor");
  assert.equal(pc?.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc?.candidates as string[])].sort(), [id("lec"), id("lec2")].sort());
  keepUnique(engine, P1, id("lec2"));
  assert.equal(zoneOf(engine, id("lec2")), "play");
  assert.equal(zoneOf(engine, id("lec")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(LECRAM, "0:unique", "keeping the original Lecram destroys the new one", () => {
  const { engine, id } = lecramBoard({ extra: [{ key: "lec2", def: printing(LECRAM), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  play(engine, P1, id("lec2"));
  keepUnique(engine, P1, id("lec"));
  assert.equal(zoneOf(engine, id("lec")), "play");
  assert.equal(zoneOf(engine, id("lec2")), "discard");
});

clause(LECRAM, "0:unique", "only my own copies count: the opponent may control their own Lecram with no choice and no destruction", () => {
  const { engine, id } = devBoard(
    [
      { key: "lec", def: printing(LECRAM), owner: P1, zone: "play" },
      { key: "lec2", def: printing(LECRAM), owner: P2, zone: "hand" },
      ...res({ deception: 2 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  play(engine, P2, id("lec2"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("lec2")), "play");
  assert.equal(zoneOf(engine, id("lec")), "play");
});

clause(LECRAM, "0:unique", "a character with a different name conflicts with nothing: no choice is raised", () => {
  const { engine, id } = lecramBoard({ extra: [{ key: "other", def: character({ name: "Someone Else", cost: 1 }), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  play(engine, P1, id("other"));
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(engine, id("other")), "play");
  assert.equal(zoneOf(engine, id("lec")), "play");
});

/** Answers an open look (`reorderDeck`) by leaving the looked-at cards where they are; `order: []` declines an "up to" look. */
function answerLook(engine: SpoilsEngine, order: "keep" | "decline"): { playerId: string; deckOwnerId: string; cardIds: string[]; upTo?: boolean } {
  const pc = engine.state.pendingChoice as unknown as { kind: string; playerId: string; deckOwnerId: string; cardIds: string[]; upTo?: boolean };
  assert.equal(pc?.kind, "reorderDeck", "a look is open");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice: { kind: "reorderDeck", order: order === "keep" ? pc.cardIds : [] } } as never);
  return pc;
}

clause(LECRAM, "1:rule", "at the start of my turn I may look at the top card of my deck: an optional look, nothing moves, nothing is drawn", () => {
  const { engine } = lecramBoard();
  const mine = deckOf(engine, P1);
  const theirs = deckOf(engine, P2);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "it is my turn again");
  const look = answerLook(engine, "decline");
  assert.equal(look.playerId, P1, "I look");
  assert.equal(look.deckOwnerId, P1, "at my own deck");
  assert.equal(look.upTo, true, "a 'may look': I can decline");
  assert.deepEqual(look.cardIds, mine.slice(0, 1), "its top card");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(engine, P1), mine, "looking does not change my deck");
  assert.deepEqual(deckOf(engine, P2), theirs, "the opponent's deck is not touched");
  assert.equal(handOf(engine, P1).length, 0, "looking does not draw");
});

clause(LECRAM, "2:rule", "at the end of MY turn a coin is flipped; winning lets me look at the top card of an opponent's deck, losing looks at nothing", () => {
  const won = lecramBoard({ random: () => 0 });
  const a = deckOf(won.engine, P1);
  const b = deckOf(won.engine, P2);
  won.engine.perform({ type: "endTurn", playerId: P1 });
  resolvePendingResponses(won.engine);
  const flips = eventsOf(won.engine, "coinFlipped");
  assert.equal(flips.length, 1, "exactly one coin is flipped");
  assert.equal(flips[0].won, true, "random() = 0 wins the flip");
  assert.equal(flips[0].playerId, P1, "I flip the coin");
  const look = answerLook(won.engine, "keep");
  assert.equal(look.playerId, P1, "I look");
  assert.equal(look.deckOwnerId, P2, "at the opponent's deck");
  assert.deepEqual(look.cardIds, b.slice(0, 1), "its top card");
  assert.deepEqual(deckOf(won.engine, P2), b, "looking leaves the opponent's deck as it was");
  assert.deepEqual(deckOf(won.engine, P1), a, "my deck is untouched");
  assert.equal(handOf(won.engine, P2).length, 0);
  const lost = lecramBoard({ random: () => 0.99 });
  endTurn(lost.engine, P1);
  const lostFlips = eventsOf(lost.engine, "coinFlipped");
  assert.equal(lostFlips.length, 1);
  assert.equal(lostFlips[0].won, false, "random() = 0.99 loses the flip");
  assert.equal(lostFlips[0].playerId, P1, "I flip the coin");
  assert.equal(lost.engine.state.pendingChoice, undefined, "a lost flip looks at nothing");
});

clause(LECRAM, "2:rule", "the coin is flipped only at the end of its controller's turn: not at the end of the opponent's turn, and not for the opponent's Lecram at the end of MY turn", () => {
  const mine = lecramBoard({ random: () => 0.99 });
  endTurn(mine.engine, P1);
  assert.equal(eventsOf(mine.engine, "coinFlipped").length, 1, "end of my turn: one flip");
  endTurn(mine.engine, P2);
  assert.equal(eventsOf(mine.engine, "coinFlipped").length, 1, "end of the opponent's turn: no further flip for my Lecram");
  const theirs = lecramBoard({ random: () => 0.99, owner: P2 });
  endTurn(theirs.engine, P1);
  assert.equal(eventsOf(theirs.engine, "coinFlipped").length, 0, "the opponent's Lecram does not flip at the end of MY turn");
  answerLook(theirs.engine, "decline"); // its controller's start-of-turn look
  endTurn(theirs.engine, P2);
  assert.equal(eventsOf(theirs.engine, "coinFlipped").length, 1, "it flips at the end of ITS controller's turn");
  assert.equal(eventsOf(theirs.engine, "coinFlipped")[0].playerId, P2, "its controller flips");
});

clause(LECRAM, "2:rule", "a Lecram that is not in play (in the discard pile or in hand) flips nothing", () => {
  for (const zone of ["discard", "hand"] as const) {
    const { engine } = lecramBoard({ zone });
    endTurn(engine, P1);
    assert.equal(eventsOf(engine, "coinFlipped").length, 0, `a Lecram in ${zone} flips nothing`);
  }
});

// =============================================================================
// Lucky Bastard (Seed Saga) — Character, rogue, gambler, cost 7, [D][D], 3/4/4
//   When this card enters play, draw a card.
//   If this card would be destroyed, each player removes the top card of their deck from the game
//   instead. If the numeric cost of your removed card is greater than or equal to the numeric cost
//   of each opponents', draw a card and reduce the amount of damage already inflicted to this card
//   this turn to 0. Otherwise, remove this card from the game.
// =============================================================================

const LUCKY = "4513085a-6185-4ef5-ba9c-7af3c3af30d4";

type DeckSpec = number | CardDefinition;

/** Lucky Bastard in play for `side` (default P1); the OTHER player is active and holds the damage / kill tactics. Decks are listed top first. */
function luckyBoard(opts: { mine?: DeckSpec[]; opp?: DeckSpec[]; side?: PlayerId; extra?: CardPlacement[] } = {}) {
  const me = opts.side ?? P1;
  const foe = me === P1 ? P2 : P1;
  const deck = (owner: PlayerId, prefix: string, specs: DeckSpec[]): CardPlacement[] =>
    specs.map((spec, i) => ({
      key: `${prefix}${i}`,
      def: typeof spec === "number" ? character({ name: `${prefix.toUpperCase()}-${i}`, cost: spec }) : spec,
      owner,
      zone: "deck" as const
    }));
  const game = devBoard(
    [
      { key: "lb", def: printing(LUCKY), owner: me, zone: "play" },
      { key: "bystander", def: character({ name: "Bystander", cost: 1, strength: 1, life: 2, speed: 1 }), owner: me, zone: "play" },
      { key: "kill", def: pickKillTactic(), owner: foe, zone: "hand" },
      { key: "hit4", def: pickHitTactic(4, "Hit Four"), owner: foe, zone: "hand" },
      { key: "hit3", def: pickHitTactic(3, "Hit Three"), owner: foe, zone: "hand" },
      { key: "hit2", def: pickHitTactic(2, "Hit Two"), owner: foe, zone: "hand" },
      { key: "hit2b", def: pickHitTactic(2, "Hit Two B"), owner: foe, zone: "hand" },
      ...deck(me, "m", opts.mine ?? [5, 1, 1]),
      ...deck(foe, "f", opts.opp ?? [3, 1, 1]),
      ...(opts.extra ?? [])
    ],
    { turn: foe === P2 ? 2 : 1, activePlayerId: foe, random: lcg(9) }
  );
  const strike = (key: string, target = "lb") => play(game.engine, foe, game.id(key), { selected: { t: [game.id(target)] } });
  return { ...game, me, foe, strike };
}
type LuckyGame = ReturnType<typeof luckyBoard>;

/** Snapshot of both decks (me, foe) before anything happens. */
const luckyDecks = (g: LuckyGame) => ({ m: deckOf(g.engine, g.me), f: deckOf(g.engine, g.foe) });

clause(LUCKY, "0:rule", "printed cost 7 and threshold [D][D]: exactly [D][D] + 5 others deploys and pays 7; one resource short, or one [D] short, is refused", () => {
  const ok = deployProbe(LUCKY, res({ deception: 2, rage: 5 }));
  assert.deepEqual([ok.entered, ok.paid], [true, 7], "exactly 7 resources deploy it for 7");
  const oneShort = deployProbe(LUCKY, res({ deception: 2, rage: 4 }));
  assert.equal(oneShort.entered, false, "6 resources: one short");
  assert.equal(oneShort.refusedPlay, true);
  const iconShort = deployProbe(LUCKY, res({ deception: 1, rage: 6 }));
  assert.equal(iconShort.entered, false, "7 resources but only one [D]");
  assert.equal(iconShort.refusedPlay, true);
  const noIcon = deployProbe(LUCKY, res({ rage: 9 }));
  assert.equal(noIcon.entered, false, "no [D] at all");
  const spentIcons = deployProbe(LUCKY, [...spent({ deception: 2 }), ...res({ rage: 6 })]);
  assert.equal(spentIcons.entered, false, "spent icons meet the threshold but only 6 ready resources pay: the cost is 7");
  const spentOk = deployProbe(LUCKY, [...spent({ deception: 2 }), ...res({ rage: 7 })]);
  assert.deepEqual([spentOk.entered, spentOk.paid], [true, 7]);
});

clause(LUCKY, "0:rule", "is a 3/4/4 rogue gambler character (strength 3, life 4, speed 4)", () => {
  const { engine, id } = luckyBoard();
  assert.deepEqual(stats(engine, id("lb")), [3, 4, 4]);
  const def = engine.getDefinition(id("lb"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype, ["gambler"]);
});

clause(LUCKY, "0:rule", "when it enters play its controller draws exactly one card (the top of their deck); the opponent draws nothing", () => {
  const { engine, id } = devBoard([
    { key: "lb", def: printing(LUCKY), owner: P1, zone: "hand" },
    ...res({ deception: 2, rage: 5 }),
    ...fillers("a", 3, P1, "deck", (i) => character({ name: `A${i}` })),
    ...fillers("b", 3, P2, "deck", (i) => character({ name: `B${i}` }))
  ]);
  const mine = deckOf(engine, P1);
  const theirs = deckOf(engine, P2);
  assert.equal(handOf(engine, P1).length, 1, "only Lucky Bastard in hand");
  play(engine, P1, id("lb"));
  assert.equal(zoneOf(engine, id("lb")), "play");
  assert.deepEqual(handOf(engine, P1), [mine[0]], "drew exactly the top card");
  assert.deepEqual(deckOf(engine, P1), mine.slice(1));
  assert.deepEqual(deckOf(engine, P2), theirs, "the opponent's deck is untouched");
  assert.equal(handOf(engine, P2).length, 0);
});

clause(LUCKY, "0:rule", "it triggers only for itself: another character entering play does not draw", () => {
  const { engine, id } = luckyBoard({ extra: [{ key: "new", def: character({ name: "Newcomer", cost: 1 }), owner: P1, zone: "hand" }, ...res({ rage: 1 })] });
  engine.state.activePlayerId = P1;
  const before = handOf(engine, P1).length;
  play(engine, P1, id("new"));
  assert.equal(zoneOf(engine, id("new")), "play");
  assert.equal(handOf(engine, P1).length, before - 1, "only the played card left the hand: nothing was drawn");
});

clause(LUCKY, "1:rule", "destroyed with my removed card costing MORE: both tops are removed from the game, it stays in play, I draw a card (the new top), damage is 0", () => {
  const g = luckyBoard({ mine: [5, 1, 1, 2], opp: [3, 1, 1] });
  const { m, f } = luckyDecks(g);
  g.strike("kill");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "Lucky Bastard was not destroyed");
  assert.deepEqual(removedOf(g.engine, P1), [m[0]], "my top card was removed from the game");
  assert.deepEqual(removedOf(g.engine, P2), [f[0]], "the opponent's top card was removed from the game");
  assert.deepEqual(handOf(g.engine, g.me), [m[1]], "I drew the card now on top of my deck");
  assert.deepEqual(deckOf(g.engine, g.me), m.slice(2));
  assert.deepEqual(handOf(g.engine, g.foe), [g.id("hit4"), g.id("hit3"), g.id("hit2"), g.id("hit2b")], "the opponent drew nothing");
  assert.deepEqual(deckOf(g.engine, g.foe), f.slice(1), "only the opponent's top card left their deck");
  assert.deepEqual(discardOf(g.engine, g.me), [], "nothing of mine reached the discard pile");
  assert.equal(damageOn(g.engine, g.id("lb")), 0);
});

clause(LUCKY, "1:rule", "equal numeric costs count as 'greater than or equal': it survives and I draw", () => {
  const g = luckyBoard({ mine: [3, 1, 1], opp: [3, 1, 1] });
  const { m, f } = luckyDecks(g);
  g.strike("kill");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.deepEqual(removedOf(g.engine, P1), [m[0]]);
  assert.deepEqual(removedOf(g.engine, P2), [f[0]]);
  assert.deepEqual(handOf(g.engine, g.me), [m[1]]);
});

clause(LUCKY, "1:rule", "equal costs of 0 also survive (0 >= 0)", () => {
  const g = luckyBoard({ mine: [0, 1, 1], opp: [0, 1, 1] });
  g.strike("kill");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(handOf(g.engine, g.me).length, 1, "drew a card");
});

clause(LUCKY, "1:rule", "my removed card costing LESS: both tops are removed and Lucky Bastard is removed from the game too (not destroyed, not in the discard pile)", () => {
  const g = luckyBoard({ mine: [2, 1, 1], opp: [3, 1, 1] });
  const { m, f } = luckyDecks(g);
  g.strike("kill");
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed", "Lucky Bastard was removed from the game");
  assert.deepEqual(discardOf(g.engine, g.me), [], "it was not put into the discard pile");
  assert.equal(removedOf(g.engine, P1).includes(m[0]), true, "my top card was removed");
  assert.equal(removedOf(g.engine, P2).includes(f[0]), true, "the opponent's top card was removed");
  assert.equal(handOf(g.engine, g.me).length, 0, "I drew nothing");
  assert.deepEqual(deckOf(g.engine, g.me), m.slice(1));
  assert.deepEqual(deckOf(g.engine, g.foe), f.slice(1));
});

clause(LUCKY, "1:rule", "off by one in the opponent's favor (cost 4 vs my 3) is a loss; off by one in mine (4 vs their 3) is a win", () => {
  const lose = luckyBoard({ mine: [3, 1, 1], opp: [4, 1, 1] });
  lose.strike("kill");
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed");
  const win = luckyBoard({ mine: [4, 1, 1], opp: [3, 1, 1] });
  win.strike("kill");
  assert.equal(zoneOf(win.engine, win.id("lb")), "play");
});

clause(LUCKY, "1:rule", "lethal DAMAGE is replaced too, and winning reduces the damage to 0", () => {
  const g = luckyBoard({ mine: [5, 1, 1], opp: [3, 1, 1] });
  const { m, f } = luckyDecks(g);
  g.strike("hit4");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "4 damage on life 4 would destroy it: replaced");
  assert.equal(damageOn(g.engine, g.id("lb")), 0, "the damage was reduced to 0");
  assert.deepEqual(removedOf(g.engine, P1), [m[0]]);
  assert.deepEqual(removedOf(g.engine, P2), [f[0]]);
  assert.deepEqual(handOf(g.engine, g.me), [m[1]]);
  assert.equal(damageOn(g.engine, g.id("bystander")), 0, "no other card took damage");
});

clause(LUCKY, "1:rule", "damage already inflicted earlier this turn is reduced to 0 as well (2 earlier + 2 lethal ends at 0, and 3 more is survivable)", () => {
  const g = luckyBoard({ mine: [5, 1, 1, 1], opp: [3, 1, 1, 1] });
  g.strike("hit2");
  assert.equal(damageOn(g.engine, g.id("lb")), 2, "the first hit is not lethal");
  assert.deepEqual(removedOf(g.engine, P1), [], "no replacement yet: nothing is removed");
  assert.deepEqual(removedOf(g.engine, P2), []);
  g.strike("hit2b");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.equal(damageOn(g.engine, g.id("lb")), 0, "ALL damage inflicted this turn is reduced to 0, not just the lethal part");
  assert.equal(removedOf(g.engine, P1).length, 1);
  g.strike("hit3");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "3 fresh damage on life 4 is not lethal");
  assert.equal(damageOn(g.engine, g.id("lb")), 3);
  assert.equal(removedOf(g.engine, P1).length, 1, "a non-lethal hit removes nothing");
  assert.equal(removedOf(g.engine, P2).length, 1);
});

clause(LUCKY, "1:rule", "a lost gamble after earlier damage still removes Lucky Bastard from the game", () => {
  const g = luckyBoard({ mine: [1, 1, 1], opp: [6, 1, 1] });
  g.strike("hit2");
  g.strike("hit2b");
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed");
  assert.equal(discardOf(g.engine, g.me).includes(g.id("lb")), false);
});

clause(LUCKY, "1:rule", "non-lethal damage does not trigger it: no card is removed and nothing is drawn", () => {
  const g = luckyBoard();
  const { m, f } = luckyDecks(g);
  g.strike("hit3");
  assert.equal(damageOn(g.engine, g.id("lb")), 3);
  assert.deepEqual(deckOf(g.engine, g.me), m);
  assert.deepEqual(deckOf(g.engine, g.foe), f);
  assert.deepEqual(removedOf(g.engine, P1), []);
  assert.equal(handOf(g.engine, g.me).length, 0);
});

clause(LUCKY, "1:rule", "it only replaces ITS OWN destruction: another character of mine that is destroyed goes to the discard pile and no deck is touched", () => {
  const g = luckyBoard();
  const { m, f } = luckyDecks(g);
  g.strike("kill", "bystander");
  assert.equal(zoneOf(g.engine, g.id("bystander")), "discard");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.deepEqual(deckOf(g.engine, g.me), m);
  assert.deepEqual(deckOf(g.engine, g.foe), f);
  assert.equal(handOf(g.engine, g.me).length, 0);
});

clause(LUCKY, "1:rule", "only the top card of each deck is removed: the rest of both decks keeps its order", () => {
  const g = luckyBoard({ mine: [7, 1, 2, 3, 4], opp: [2, 5, 6, 7] });
  const { m, f } = luckyDecks(g);
  g.strike("kill");
  assert.deepEqual(deckOf(g.engine, g.me), m.slice(2), "my deck: top removed, next drawn, the rest in order");
  assert.deepEqual(deckOf(g.engine, g.foe), f.slice(1), "their deck: only the top removed, same order");
});

clause(LUCKY, "1:rule", "'your' and 'opponents'' follow the controller: Lucky Bastard controlled by the second player compares THEIR top card against the first player's (win and lose)", () => {
  const win = luckyBoard({ side: P2, mine: [6, 1, 1], opp: [2, 1, 1] });
  const wm = luckyDecks(win);
  win.strike("kill");
  assert.equal(zoneOf(win.engine, win.id("lb")), "play", "P2's 6 beats P1's 2");
  assert.deepEqual(removedOf(win.engine, P2), [wm.m[0]]);
  assert.deepEqual(removedOf(win.engine, P1), [wm.f[0]]);
  assert.deepEqual(handOf(win.engine, P2), [wm.m[1]], "its controller draws");
  assert.equal(handOf(win.engine, P1).includes(wm.f[1]), false, "the opponent does not draw");
  const lose = luckyBoard({ side: P2, mine: [2, 1, 1], opp: [6, 1, 1] });
  lose.strike("kill");
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed", "P2's 2 loses to P1's 6");
  assert.equal(handOf(lose.engine, P2).length, 0);
});

clause(LUCKY, "1:rule", "'numeric cost' is the printed cost of whatever card is on top, of any type: an item of cost 4 beats a tactic of cost 3, a tactic of cost 2 loses to a location of cost 4", () => {
  const win = luckyBoard({ mine: [item({ name: "M-Item", cost: 4 }), 1, 1], opp: [tactic({ name: "F-Tactic", cost: 3 }), 1, 1] });
  win.strike("kill");
  assert.equal(zoneOf(win.engine, win.id("lb")), "play");
  const lose = luckyBoard({ mine: [tactic({ name: "M-Tactic", cost: 2 }), 1, 1], opp: [location({ name: "F-Location", cost: 4 }), 1, 1] });
  lose.strike("kill");
  assert.equal(zoneOf(lose.engine, lose.id("lb")), "removed");
});

clause(LUCKY, "1:rule", "an empty opponent deck leaves nothing to beat: it survives and I draw (literal reading of 'each opponents'')", () => {
  const g = luckyBoard({ mine: [0, 1, 1], opp: [] });
  const { m } = luckyDecks(g);
  g.strike("kill");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.deepEqual(removedOf(g.engine, P1), [m[0]]);
  assert.deepEqual(handOf(g.engine, g.me), [m[1]]);
});

clause(LUCKY, "1:rule", "an empty deck of mine has no removed card to compare, so the 'greater or equal' condition is not met: Lucky Bastard is removed from the game", () => {
  const g = luckyBoard({ mine: [], opp: [3, 1, 1] });
  g.strike("kill");
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed");
});

clause(LUCKY, "1:rule", "it can use its luck again later: a second destruction removes two more cards and (when won) it survives again", () => {
  const g = luckyBoard({ mine: [5, 1, 4, 1, 1, 1], opp: [3, 3, 1, 1, 1, 1] });
  const { m, f } = luckyDecks(g);
  g.strike("hit4");
  g.strike("kill");
  assert.equal(zoneOf(g.engine, g.id("lb")), "play");
  assert.deepEqual(removedOf(g.engine, P1), [m[0], m[2]]);
  assert.deepEqual(removedOf(g.engine, P2), [f[0], f[1]]);
  assert.deepEqual(handOf(g.engine, g.me), [m[1], m[3]], "drew once per win");
});

clause(LUCKY, "1:rule", "destroyed in BATTLE by lethal damage it is replaced as well: a won gamble leaves it in play with damage 0", () => {
  const atk = { key: "atk", def: character({ name: "Big Attacker", cost: 1, strength: 9, life: 9, speed: 1 }), owner: P2 as PlayerId, zone: "play" as Zone };
  const g = devBoard(
    [
      { key: "lb", def: printing(LUCKY), owner: P1, zone: "play" },
      atk,
      ...fillers("m", 3, P1, "deck", (i) => character({ name: `M${i}`, cost: i === 0 ? 5 : 1 })),
      ...fillers("f", 3, P2, "deck", (i) => character({ name: `F${i}`, cost: i === 0 ? 2 : 1 }))
    ],
    { turn: 2, activePlayerId: P2, random: lcg(4) }
  );
  const m = deckOf(g.engine, P1);
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("lb")]);
  autoResolveBattle(g.engine);
  assert.equal(g.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(g.engine, g.id("lb")), "play", "survived the lethal battle damage");
  assert.equal(damageOn(g.engine, g.id("lb")), 0);
  assert.equal(removedOf(g.engine, P1).length, 1);
  assert.equal(removedOf(g.engine, P2).length, 1);
  assert.deepEqual(handOf(g.engine, P1), [m[1]]);
});

clause(LUCKY, "1:rule", "destroyed in BATTLE with a lost gamble it is removed from the game", () => {
  const g = devBoard(
    [
      { key: "lb", def: printing(LUCKY), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Big Attacker", cost: 1, strength: 9, life: 9, speed: 1 }), owner: P2, zone: "play" },
      ...fillers("m", 3, P1, "deck", (i) => character({ name: `M${i}`, cost: 1 })),
      ...fillers("f", 3, P2, "deck", (i) => character({ name: `F${i}`, cost: i === 0 ? 6 : 1 }))
    ],
    { turn: 2, activePlayerId: P2, random: lcg(4) }
  );
  declareAttackBy(g.engine, P2, [g.id("atk")]);
  declareBlockers(g.engine, P1, [g.id("lb")]);
  autoResolveBattle(g.engine);
  assert.equal(zoneOf(g.engine, g.id("lb")), "removed");
  assert.deepEqual(discardOf(g.engine, P1), []);
});

// =============================================================================
// Lucky Charm (Seed Saga) — Item, rogue, cost 2, [D]
//   When this card enters play, draw a card.
//   Your opponents must pay 1 to pick a character you control.
// =============================================================================

const CHARM = "9db2e287-ca92-4304-814f-10b7eb99ef4b";

/** P1 controls Lucky Charm (unless noCharm) and two characters; P2 is active with the picking cards and `foeRes` ready resources. */
function charmBoard(opts: { foeRes?: number; noCharm?: boolean; extra?: CardPlacement[] } = {}) {
  const striker = character({
    name: "Striker",
    cost: 1,
    life: 5,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          costs: [],
          targets: [{ id: "z", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "z" }, amount: 2 }]
        }
      ]
    }
  });
  const twoPick = tactic({
    name: "Double Hit",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "dh",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 2 }],
          effects: [{ type: "forEach", selected: "t", effects: [{ type: "dealDamage", target: { type: "selected", id: "__candidate" }, amount: 1 }] }]
        }
      ]
    }
  });
  return devBoard(
    [
      ...(opts.noCharm ? [] : [{ key: "charm", def: printing(CHARM), owner: P1, zone: "play" as Zone }]),
      { key: "mine1", def: character({ name: "Mine One", cost: 1, strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine Two", cost: 1, strength: 1, life: 6, speed: 1 }), owner: P1, zone: "play" },
      { key: "mineItem", def: item({ name: "Mine Item", cost: 1 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", cost: 1, strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" },
      { key: "striker", def: striker, owner: P2, zone: "play" },
      { key: "hit", def: pickHitTactic(3), owner: P2, zone: "hand" },
      { key: "hitItem", def: pickHitTactic(3, "Hit Item", { zone: "play", type: "item" }), owner: P2, zone: "hand" },
      { key: "dh", def: twoPick, owner: P2, zone: "hand" },
      ...res({ rage: opts.foeRes ?? 3 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: 2, activePlayerId: P2 }
  );
}

clause(CHARM, "0:rule", "printed cost 2 and threshold [D]: [D] + 1 other deploys and pays 2; one resource short, or no [D], is refused", () => {
  const ok = deployProbe(CHARM, res({ deception: 1, rage: 1 }));
  assert.deepEqual([ok.entered, ok.paid], [true, 2], "[D] plus one other pays exactly 2");
  const oneShort = deployProbe(CHARM, res({ deception: 1 }));
  assert.equal(oneShort.entered, false, "one resource short");
  assert.equal(oneShort.refusedPlay, true);
  const noIcon = deployProbe(CHARM, res({ rage: 4 }));
  assert.equal(noIcon.entered, false, "no [D]");
  assert.equal(noIcon.refusedPlay, true);
  const costOne = deployProbe(CHARM, [...spent({ deception: 1 }), ...res({ rage: 1 })]);
  assert.equal(costOne.entered, false, "the threshold is met by a spent [D] but only 1 ready resource: the cost is 2");
  const costTwo = deployProbe(CHARM, [...spent({ deception: 1 }), ...res({ rage: 2 })]);
  assert.deepEqual([costTwo.entered, costTwo.paid], [true, 2]);
});

clause(CHARM, "0:rule", "is a rogue ITEM with no subtype", () => {
  const { engine, id } = charmBoard();
  const def = engine.getDefinition(id("charm"));
  assert.equal(def.type, "item");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype ?? [], []);
});

clause(CHARM, "0:rule", "when it enters play its controller draws exactly one card; the opponent draws nothing", () => {
  const { engine, id } = devBoard([
    { key: "charm", def: printing(CHARM), owner: P1, zone: "hand" },
    ...res({ deception: 1, rage: 1 }),
    ...fillers("a", 3, P1, "deck", (i) => character({ name: `A${i}` })),
    ...fillers("b", 3, P2, "deck", (i) => character({ name: `B${i}` }))
  ]);
  const mine = deckOf(engine, P1);
  const theirs = deckOf(engine, P2);
  play(engine, P1, id("charm"));
  assert.equal(zoneOf(engine, id("charm")), "play");
  assert.deepEqual(handOf(engine, P1), [mine[0]]);
  assert.deepEqual(deckOf(engine, P1), mine.slice(1));
  assert.deepEqual(deckOf(engine, P2), theirs);
  assert.equal(handOf(engine, P2).length, 0);
});

clause(CHARM, "0:rule", "it triggers only for itself: another item entering play draws nothing", () => {
  const { engine, id } = charmBoard({ extra: [{ key: "it2", def: item({ name: "Other Item", cost: 0 }), owner: P1, zone: "hand" }, ...fillers("a", 2, P1, "deck")] });
  engine.state.activePlayerId = P1;
  const before = handOf(engine, P1).length;
  play(engine, P1, id("it2"));
  assert.equal(zoneOf(engine, id("it2")), "play");
  assert.equal(handOf(engine, P1).length, before - 1, "nothing was drawn");
});

clause(CHARM, "1:rule", "my opponent must pay 1 to pick a character I control with a tactic: the pick costs them one resource and then lands", () => {
  const g = charmBoard();
  const before = ready(g.engine, P2);
  play(g.engine, P2, g.id("hit"), { selected: { t: [g.id("mine1")] } });
  assert.equal(damageOn(g.engine, g.id("mine1")), 3, "the pick landed");
  assert.equal(before - ready(g.engine, P2), 1, "exactly 1 was paid for the pick");
});

clause(CHARM, "1:rule", "an opponent with no resource to pay cannot pick my character", () => {
  const g = charmBoard({ foeRes: 0 });
  refused(() => playRaw(g.engine, P2, g.id("hit"), { selected: { t: [g.id("mine1")] } }), "no resource to pay the 1");
  assert.equal(damageOn(g.engine, g.id("mine1")), 0);
  assert.equal(zoneOf(g.engine, g.id("hit")), "hand");
});

clause(CHARM, "1:rule", "the tax applies to abilities that pick my character as well as to cards", () => {
  const g = charmBoard();
  const before = ready(g.engine, P2);
  activate(g.engine, P2, g.id("striker"), "zap", { selected: { z: [g.id("mine2")] } });
  assert.equal(damageOn(g.engine, g.id("mine2")), 2);
  assert.equal(before - ready(g.engine, P2), 1, "1 paid for the ability's pick");
});

clause(CHARM, "1:rule", "each character picked costs 1: picking two of my characters costs 2", () => {
  const g = charmBoard();
  const before = ready(g.engine, P2);
  play(g.engine, P2, g.id("dh"), { selected: { t: [g.id("mine1"), g.id("mine2")] } });
  assert.equal(damageOn(g.engine, g.id("mine1")), 1);
  assert.equal(damageOn(g.engine, g.id("mine2")), 1);
  assert.equal(before - ready(g.engine, P2), 2, "1 per character picked");
});

clause(CHARM, "1:rule", "no payment for other picks: their own character, or my ITEM, costs nothing extra (and the Charm does not stop the pick)", () => {
  const own = charmBoard();
  const before = ready(own.engine, P2);
  play(own.engine, P2, own.id("hit"), { selected: { t: [own.id("foe1")] } });
  assert.equal(damageOn(own.engine, own.id("foe1")), 3);
  assert.equal(before - ready(own.engine, P2), 0, "their own character: nothing paid");
  const itemPick = charmBoard();
  const before2 = ready(itemPick.engine, P2);
  play(itemPick.engine, P2, itemPick.id("hitItem"), { selected: { t: [itemPick.id("mineItem")] } });
  assert.equal(damageOn(itemPick.engine, itemPick.id("mineItem")), 3);
  assert.equal(before2 - ready(itemPick.engine, P2), 0, "my item is not a character: nothing paid");
});

clause(CHARM, "1:rule", "control: without Lucky Charm in play, picking my character costs nothing", () => {
  const g = charmBoard({ noCharm: true });
  const before = ready(g.engine, P2);
  play(g.engine, P2, g.id("hit"), { selected: { t: [g.id("mine1")] } });
  assert.equal(damageOn(g.engine, g.id("mine1")), 3);
  assert.equal(before - ready(g.engine, P2), 0);
});

clause(CHARM, "1:rule", "it taxes only my opponents: my own pick of my own character costs me nothing", () => {
  const g = charmBoard({ extra: [{ key: "myhit", def: pickHitTactic(1, "My Hit"), owner: P1, zone: "hand" }, ...res({ rage: 2 }, P1)] });
  g.engine.state.activePlayerId = P1;
  const before = ready(g.engine, P1);
  play(g.engine, P1, g.id("myhit"), { selected: { t: [g.id("mine1")] } });
  assert.equal(damageOn(g.engine, g.id("mine1")), 1);
  assert.equal(before - ready(g.engine, P1), 0);
});

// =============================================================================
// Printed cost / threshold / type lines for Muscle Tribe and Mustache Aficionado
// =============================================================================

clause(MUSCLE, "0:rule", "printed cost 2 and threshold [D]: [D] + 1 other deploys and pays 2; one short, or no [D], is refused; it is a rogue miner character", () => {
  const ok = deployProbe(MUSCLE, res({ deception: 1, rage: 1 }));
  assert.deepEqual([ok.entered, ok.paid], [true, 2]);
  const oneShort = deployProbe(MUSCLE, res({ deception: 1 }));
  assert.equal(oneShort.entered, false, "one resource short");
  assert.equal(oneShort.refusedPlay, true);
  const noIcon = deployProbe(MUSCLE, res({ rage: 4 }));
  assert.equal(noIcon.entered, false, "no [D]");
  assert.equal(noIcon.refusedPlay, true);
  const costOne = deployProbe(MUSCLE, [...spent({ deception: 1 }), ...res({ rage: 1 })]);
  assert.equal(costOne.entered, false, "threshold met by a spent [D], but the cost is 2 and only 1 resource is ready");
  const costTwo = deployProbe(MUSCLE, [...spent({ deception: 1 }), ...res({ rage: 2 })]);
  assert.deepEqual([costTwo.entered, costTwo.paid], [true, 2]);
  const game = mtBoard();
  const def = game.engine.getDefinition(game.id("mt"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype, ["miner"]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "printed cost 3 and threshold [D]: [D] + 2 others deploys and pays 3; one short, or no [D], is refused", () => {
  const ok = deployProbe(MUSTACHE, res({ deception: 1, rage: 2 }));
  assert.deepEqual([ok.entered, ok.paid], [true, 3]);
  const oneShort = deployProbe(MUSTACHE, res({ deception: 1, rage: 1 }));
  assert.equal(oneShort.entered, false, "one resource short");
  assert.equal(oneShort.refusedPlay, true);
  const noIcon = deployProbe(MUSTACHE, res({ rage: 6 }));
  assert.equal(noIcon.entered, false, "no [D]");
  assert.equal(noIcon.refusedPlay, true);
  const costTwo = deployProbe(MUSTACHE, [...spent({ deception: 1 }), ...res({ rage: 2 })]);
  assert.equal(costTwo.entered, false, "threshold met by a spent [D], but the cost is 3 and only 2 resources are ready");
  const costThree = deployProbe(MUSTACHE, [...spent({ deception: 1 }), ...res({ rage: 3 })]);
  assert.deepEqual([costThree.entered, costThree.paid], [true, 3]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "is a 2/3/4 rogue gambler character (strength 2, life 3, speed 4)", () => {
  const game = msBoard();
  assert.deepEqual(stats(game.engine, game.id("ma")), [2, 3, 4]);
  const def = game.engine.getDefinition(game.id("ma"));
  assert.equal(def.type, "character");
  assert.equal(def.trade, "rogue");
  assert.deepEqual(def.subtype, ["gambler"]);
});

clause(MUSCLE, "0:rule", "'this turn' also holds for a [D] resource played by develop: the strength and COVERT are gone when the turn ends", () => {
  const game = mtBoard({ extra: [{ key: "dres", def: stapleCard("deception"), owner: P1, zone: "hand" }] });
  developResource(game.engine, P1, game.id("dres"), false);
  mtGained(game, 1, "this turn");
  endTurn(game.engine, P1);
  mtUnchanged(game, "on the opponent's turn");
  endTurn(game.engine, P2);
  mtUnchanged(game, "on my next turn");
});
