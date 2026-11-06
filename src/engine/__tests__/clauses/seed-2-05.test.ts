// Clause tests — batch seed-2-05. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-2-05`. Expectations come from each
// card's PRINTED text (markup) and RULES.md / the Comprehensive Rules; engine
// data is only used to drive the engine.

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
import { clause, declineAll, drain, printing, refused, flipUpNow, holdFlipUp } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, finishBattle, playRaw } from "./_battle.js";
import { answerPending, declareBlockers, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { attachedCount, developResource, endTurn, setupGame, developOffers, settleStartFirst } from "./_turn.js";
import type { CardDefinition, CardInstanceId, CardSelector, PlayerId, SpoilsEngine, Zone } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";
import { developDraw } from "../support/develop.js";

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
// Mistaken Identity (Seed 2) — Tactic, rogue, cost 2, [D][D]
//   COST: Play this only in response to a card or ability that picked a
//         character as an extra cost. Pick another character that can be
//         picked by that card or ability.
//   EFFECT: When the card or ability resolves, its effect happens as though
//         your opponent had picked the other character instead.
// =============================================================================

const MISTAKEN = "e38f4972-a3c7-47b4-adb2-25177eda9065";

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

clause(MISTAKEN, "0:ability", "in response to a card that picked my character as an extra cost, I pick another character: the effect hits THAT character, not the one first picked", () => {
  const game = miBoard();
  miRedirect(game, "mine1", "foe1");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "the other character takes the damage");
  assert.equal(damageOn(game.engine, game.id("mine1")), 0, "the character first picked is untouched");
  assert.equal(zoneOf(game.engine, game.id("orig")), "discard", "the responded-to tactic still resolves normally");
});

clause(MISTAKEN, "0:ability", "the swap works the other way round: the original pick was the opponent's own character and the other is mine", () => {
  const game = miBoard();
  miRedirect(game, "foe1", "mine2");
  assert.equal(damageOn(game.engine, game.id("mine2")), 3);
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
});

clause(MISTAKEN, "0:ability", "the other character may be one of my own, or one of the opponent's", () => {
  const mine = miBoard();
  miRedirect(mine, "mine1", "mine2");
  assert.equal(damageOn(mine.engine, mine.id("mine2")), 3);
  assert.equal(damageOn(mine.engine, mine.id("mine1")), 0);
  const theirs = miBoard();
  miRedirect(theirs, "mine1", "foe2");
  assert.equal(damageOn(theirs.engine, theirs.id("foe2")), 3);
  assert.equal(damageOn(theirs.engine, theirs.id("mine1")), 0);
});

clause(MISTAKEN, "0:ability", "no other character is touched: only the redirected-to character takes the damage", () => {
  const game = miBoard();
  miRedirect(game, "mine1", "foe1");
  for (const key of ["mine1", "mine2", "foe2"]) assert.equal(damageOn(game.engine, game.id(key)), 0, `${key} is untouched`);
  assert.equal(damageOn(game.engine, game.id("foe1")), 3);
});

// --- cost: 2 and [D][D] ---

clause(MISTAKEN, "0:ability", "costs exactly 2: two resources are paid when it is played (while the window is still open), and it goes to my discard pile afterwards", () => {
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

clause(MISTAKEN, "0:ability", "is refused one resource short of its cost of 2, and nothing is paid", () => {
  // [D][D] met by already-spent Deception, so only the cost (1 ready of 2) can refuse
  const bad = miBoard({ icons: { rage: 1 }, extra: spent({ deception: 2 }) });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "foe1"), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 1);
  const good = miBoard({ icons: { deception: 2 } });
  miRedirect(good, "mine1", "foe1");
  assert.equal(damageOn(good.engine, good.id("foe1")), 3, "control: with 2 it works");
});

clause(MISTAKEN, "0:ability", "needs [D][D]: lots of other resources, or a single [D], are refused", () => {
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

clause(MISTAKEN, "0:ability", "Volition (face-down cards) does not meet [D][D], and neither do the opponent's [D]", () => {
  const vol = miBoard({ icons: {}, extra: volition(4, P1) });
  miOpen(vol, "mine1");
  refused(() => miPlayRaw(vol, "foe1"), "Volition is not [D]");
  const theirs = miBoard({ icons: { rage: 3 }, extra: res({ deception: 4 }, P2) });
  miOpen(theirs, "mine1");
  refused(() => miPlayRaw(theirs, "foe1"), "their [D] do not count");
  assert.equal(zoneOf(theirs.engine, theirs.id("mi")), "hand");
});

clause(MISTAKEN, "0:ability", "spent [D][D] still meet the threshold (icons are never spent) but cannot pay: two spent [D] plus two ready resources works", () => {
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

clause(MISTAKEN, "0:ability", "cannot be played when I am not responding to anything (my own turn, empty stack)", () => {
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

clause(MISTAKEN, "0:ability", "cannot be played in response to a card that picked no character (it picked nothing)", () => {
  const bad = miBoard({ orig: noPickTactic(), extra: fillers("dk", 3, P2, "deck") });
  playRaw(bad.engine, P2, bad.id("orig"));
  refused(() => miPlayRaw(bad, "foe1"), "the responded-to tactic picked nothing");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing paid");
});

clause(MISTAKEN, "0:ability", "cannot be played in response to a card that picked an ITEM (not a character) as its extra cost", () => {
  const bad = miBoard({
    orig: pickHitTactic(2, "Pick Item Hit", { zone: "play", type: "item" }),
    extra: [{ key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" }]
  });
  miOpen(bad, "gadget");
  refused(() => miPlayRaw(bad, "foe1"), "an item was picked, not a character", /cannot be deployed right now/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2, "nothing paid");
});

clause(MISTAKEN, "0:ability", "cannot be played in response to a card whose character pick is made on resolution (an effect, not an extra cost)", () => {
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

clause(MISTAKEN, "0:ability", "cannot be played in response to an attack declaration (no card or ability picked anything)", () => {
  const bad = miBoard({ theirTurn: true });
  declareAttackOpenWindow(bad.engine, P2, [bad.id("foe1")]);
  assert.equal(bad.engine.state.priorityPlayerId, P1, "I hold priority in the attack's response window");
  refused(() => miPlayRaw(bad, "foe2"), "an attack is not a card or ability that picked a character", /cannot be deployed right now/);
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 2);
});

clause(MISTAKEN, "0:ability", "cannot be played in response to the opponent announcing the end of their turn", () => {
  const bad = miBoard();
  bad.engine.perform({ type: "endTurn", playerId: P2 });
  assert.ok(bad.engine.state.responseWindow, "an end-of-turn response window is open");
  refused(() => miPlayRaw(bad, "foe1"), "announcing the end of the turn picked nothing");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
});

clause(MISTAKEN, "0:ability", "works in response to an ABILITY that picked a character as an extra cost, not only a card", () => {
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

clause(MISTAKEN, "0:ability", "responds to the TOP card of the stack: my own tactic's pick cannot be redirected, only the opponent's response that picked a character", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be a character in play: an item, a location, a resource, a faction or a face-down card is refused", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be in play: a character in a hand, deck or discard pile is refused", () => {
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

clause(MISTAKEN, "0:ability", "exactly one character must be picked: none and two are refused", () => {
  const none = miBoard({ icons: { deception: 3 } });
  miOpen(none, "mine1");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: { other: [] } }), "no pick");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: {} }), "no declaration");
  refused(() => playRaw(none.engine, P1, none.id("mi"), { selected: { other: [none.id("foe1"), none.id("foe2")] } }), "two picks");
  assert.equal(zoneOf(none.engine, none.id("mi")), "hand");
  assert.equal(ready(none.engine), 3, "nothing paid");
});

clause(MISTAKEN, "0:ability", "the pick must be ANOTHER character: picking the character that was already picked is refused", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be something THAT card could pick: a card that can only pick the opponent's characters cannot be redirected onto the opponent's own", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be something THAT card could pick: a card that can only pick its own controller's characters cannot be redirected onto mine", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be something THAT card could pick: a numeric-cost limit applies to the new pick too", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be something THAT ability could pick: an ability that says 'another character' cannot be redirected onto its own source", () => {
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

clause(MISTAKEN, "0:ability", "the pick must be something THAT card could pick: a subtype limit applies to the new pick too", () => {
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

clause(MISTAKEN, "0:ability", "on my own turn it can answer the opponent's response: only the card that picked a character, the top of the stack, is redirected", () => {
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

clause(MISTAKEN, "0:ability", "only the character pick is swapped: other extra-cost picks of the same card stay as picked", () => {
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

clause(MISTAKEN, "0:ability", "a destroy effect destroys the other character and spares the one first picked", () => {
  const game = miBoard({ orig: pickKillTactic() });
  miRedirect(game, "mine1", "foe1");
  assert.equal(zoneOf(game.engine, game.id("foe1")), "discard", "the other character is destroyed");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play", "the character first picked survives");
  assert.ok(discardOf(game.engine, P2).includes(game.id("foe1")), "discardOf(game.engine, P2).includes(game.id(\"foe1\"))");
});

clause(MISTAKEN, "0:ability", "a return-to-hand effect returns the other character to ITS owner's hand, and the rest of the original effect still happens", () => {
  const game = miBoard({ orig: pickBounceTactic(), extra: fillers("dk", 3, P2, "deck") });
  const handBefore = handOf(game.engine, P2).length;
  miRedirect(game, "mine1", "mine2");
  assert.equal(zoneOf(game.engine, game.id("mine2")), "hand");
  assert.ok(handOf(game.engine, P1).includes(game.id("mine2")), "mine2 returns to my hand");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play", "the character first picked stays");
  assert.equal(handOf(game.engine, P2).length, handBefore - 1 + 1, "the original's other instruction ('draw a card') still happened: the card played left the hand, one was drawn");
});

clause(MISTAKEN, "0:ability", "a buff effect is applied to the other character: the opponent's own pick can be swapped onto my character", () => {
  const game = miBoard({ orig: pickBuffTactic(2) });
  const mineBase = game.engine.getStat(game.id("mine2"), "strength");
  const foeBase = game.engine.getStat(game.id("foe1"), "strength");
  miRedirect(game, "foe1", "mine2");
  assert.equal(game.engine.getStat(game.id("mine2"), "strength"), mineBase + 2, "the buff lands on the other character");
  assert.equal(game.engine.getStat(game.id("foe1"), "strength"), foeBase, "the opponent's first pick gets nothing");
});

clause(MISTAKEN, "0:ability", "until it resolves, the original has not hit anyone: it is Mistaken Identity that resolves first (the window is a response chain)", () => {
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

clause(MISTAKEN, "0:ability", "the redirected damage is real damage: it can destroy the other character", () => {
  const frail = character({ name: "Frail", cost: 1, life: 2 });
  const game = miBoard({ extra: [{ key: "frail", def: frail, owner: P2, zone: "play" }] });
  miRedirect(game, "mine1", "frail");
  assert.equal(zoneOf(game.engine, game.id("frail")), "discard", "3 damage destroys a 2-life character");
  assert.equal(zoneOf(game.engine, game.id("mine1")), "play");
});

clause(MISTAKEN, "0:ability", "if the other character leaves play before the original resolves, the original does not fall back to its first pick (it happens as though the other was picked)", () => {
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

clause(MISTAKEN, "0:ability", "an unredirected response chain is unaffected: the original hits its first pick when I do not respond", () => {
  const game = miBoard();
  miOpen(game, "mine1");
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine1")), 3, "control: with no Mistaken Identity the pick is hit");
  assert.equal(zoneOf(game.engine, game.id("mi")), "hand");
});

clause(MISTAKEN, "0:ability", "even if the character first picked has left play in response, the effect still happens as though the other character had been picked", () => {
  const game = miBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  miOpen(game, "mine1");
  miPlayRaw(game, "foe1");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("mine1")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("mine1")), "discard", "the opponent destroyed the first pick in response");
  assert.equal(damageOn(game.engine, game.id("foe1")), 3, "the redirected effect lands on the other character regardless");
});

clause(MISTAKEN, "0:ability", "Mistaken Identity itself picked a character as an extra cost, so the opponent's own Mistaken Identity can answer it: the swap it makes is swapped again", () => {
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
// Muscle Tribe of Danger and Excellence (Seed 2) — Character, rogue, miner, cost 2, [D], 2/1/4
//   If a card that provides at least [D] enters play under your control, this
//   card gains 1 strength and COVERT this turn.
// =============================================================================

const MUSCLE = "6192784f-3ce3-4153-b98d-20da867884af";

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
// Mustache Aficionado (Seed 2) — Character, rogue, gambler, cost 3, [D], 2/3/4
//   MUSTACHE SHOWDOWN
//   COST: Deplete this card.
//   EFFECT: Both players look at the top 3 cards of their deck and divide them
//     into 2 face-down piles containing at least 1 card each. Both players
//     choose one of their opponent's piles. Reveal the chosen piles. If one
//     pile has a higher total numeric cost than the other, the owner of that
//     pile may put one of the cards from it into their hand. Shuffle the
//     remaining cards into their owner's deck.
// =============================================================================

const MUSTACHE = "1dffc074-b158-4134-b52e-9e6e56541cf0";

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
// Party Clowns (Seed 2, Seed Saga) — Character, rogue, clowns, cost 4, [D], 2/2/3
//   You may include as many copies of this card in your deck as you want.
//   At the start of your turn, you may pay 1. If you do, search your deck for a
//   card named Party Clowns and reveal it. Put it into play under your control.
// =============================================================================

const PARTY = "1a08f63f-1eb2-4592-a78e-dd83820fcbd7";
const PARTY_SAGA = "a97db794-de63-43b8-8538-6f98222b19c2";

interface PartyOpts {
  /** Extra Party Clowns copies in P1's deck (default 2). */
  copies?: number;
  /** Resources P1 has (face-up Deception, default 3). */
  resources?: number;
  /** P1's other deck cards placed ABOVE the copies (default 2). */
  above?: number;
  /** Number of Party Clowns on the board for P1 (default 1). */
  inPlay?: number;
  zone?: Zone;
  faceDown?: boolean;
  seed?: number;
  extra?: CardPlacement[];
  /** The copies in the deck use the Seed Saga printing. */
  sagaCopies?: boolean;
  /** The Party Clowns in play use this printing (default the Seed 2 one). */
  inPlayPrinting?: string;
  /** Spent (attached) resources instead of ready ones. */
  spentResources?: number;
}

/**
 * P2's turn 2 is about to end, so ending it starts P1's turn 3 (start-of-turn
 * triggers run). Party Clowns "pc" (and "pc2", ...) are in play; `clone0..`
 * are the copies in the deck, below `above` filler cards.
 */
function partyBoard(opts: PartyOpts = {}) {
  const copies = opts.copies ?? 2;
  const inPlay = opts.inPlay ?? 1;
  const cards: CardPlacement[] = [
    ...Array.from({ length: inPlay }, (_, i): CardPlacement => ({ key: i === 0 ? "pc" : `pc${i + 1}`, def: printing(opts.inPlayPrinting ?? PARTY), owner: P1, zone: opts.zone ?? "play", faceDown: opts.faceDown })),
    ...fillers("above", opts.above ?? 2, P1, "deck", (i) => character({ name: `Above ${i}` })),
    ...Array.from({ length: copies }, (_, i): CardPlacement => ({ key: `clone${i}`, def: printing(opts.sagaCopies ? PARTY_SAGA : PARTY), owner: P1, zone: "deck" })),
    ...fillers("below", 4, P1, "deck", (i) => character({ name: `Below ${i}` })),
    ...res({ deception: opts.resources ?? 3 }),
    ...spent({ deception: opts.spentResources ?? 0 }),
    ...(opts.extra ?? [])
  ];
  return devBoard(cards, { turn: 2, activePlayerId: P2, random: lcg(opts.seed ?? 23) });
}
type PartyGame = ReturnType<typeof partyBoard>;

/** Ends P2's turn: P1's turn starts and the trigger runs up to its first choice. */
function partyStart(game: PartyGame): void {
  endTurn(game.engine, P2);
}

/** Orders two simultaneous triggers (any order), if the engine asks. */
function maybeOrder(engine: SpoilsEngine): void {
  const pc = pending(engine);
  if (pc?.kind === "orderTriggers") answerPending(engine, "orderTriggers", declineAll(pc) as Record<string, unknown>);
}

const partyFaction = () =>
  developFaction({
    faction: {
      startingInfluence: 30,
      setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 7, goingSecond: 7 } },
      turn: { restore: { detachResources: true, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } }
    }
  });

clause(PARTY, "0:rule", "there is no limit on copies in a deck: a deck of 30 Party Clowns is accepted and every copy is dealt", () => {
  const clowns = printing(PARTY);
  const engine = setupGame(
    { faction: partyFaction(), deck: Array.from({ length: 30 }, () => clowns) },
    { faction: partyFaction(), deck: Array.from({ length: 30 }, () => character({ id: "party-opp-filler", name: "Filler" })) }
  );
  const owned = Object.values(engine.state.cards).filter((c) => c.ownerId === P1 && engine.getDefinition(c.id).name === "Party Clowns");
  assert.equal(owned.length, 30, "all 30 copies are in the game");
  assert.equal(engine.state.players[P1].hand.length, 7, "the opening hand is seven copies");
  assert.equal(engine.state.players[P1].deck.length, 23);
});

clause(PARTY_SAGA, "0:rule", "the Seed Saga printing also has no limit on copies: 30 copies are accepted and dealt", () => {
  const clowns = printing(PARTY_SAGA);
  const engine = setupGame(
    { faction: partyFaction(), deck: Array.from({ length: 30 }, () => clowns) },
    { faction: partyFaction(), deck: Array.from({ length: 30 }, () => character({ id: "party-opp-filler-2", name: "Filler" })) }
  );
  const owned = Object.values(engine.state.cards).filter((c) => c.ownerId === P1 && engine.getDefinition(c.id).name === "Party Clowns");
  assert.equal(owned.length, 30);
  assert.equal(engine.state.players[P1].hand.length, 7);
});

clause(PARTY, "1:rule", "it is a 2/2/3 character before anything happens", () => {
  const game = partyBoard();
  assert.deepEqual(stats(game.engine, game.id("pc")), [2, 2, 3]);
});

clause(PARTY, "1:rule", "at the start of my turn I am offered to pay 1; paying 1 attaches exactly one resource, and the search then puts a copy into play under my control", () => {
  const game = partyBoard();
  partyStart(game);
  const pay = expectPending(game.engine, "mayPay");
  assert.equal(pay.playerId, P1);
  assert.equal(game.engine.state.activePlayerId, P1, "it is my turn");
  assert.equal(attachedCount(game.engine, P1), 0, "nothing paid yet");
  const before = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(before - ready(game.engine), 1, "exactly 1 resource is paid");
  expectPending(game.engine, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play");
  assert.equal(controllerOf(game.engine, game.id("clone0")), P1);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 2);
});

clause(PARTY, "1:rule", "'you may pay 1': declining pays nothing, searches nothing and puts nothing into play", () => {
  const game = partyBoard();
  const deckBefore = deckOf(game.engine, P1);
  partyStart(game);
  const before = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: false });
  assert.equal(game.engine.state.pendingChoice, undefined, "no search is offered");
  assert.equal(ready(game.engine), before, "nothing paid");
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1);
  assert.deepEqual(deckOf(game.engine, P1), deckBefore, "the deck is untouched: not searched, not shuffled");
});

clause(PARTY, "1:rule", "'If you do': with no resource to pay, the offer cannot be accepted and nothing is searched", () => {
  const game = partyBoard({ resources: 0 });
  const deckBefore = deckOf(game.engine, P1);
  partyStart(game);
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    refused(() => answerPending(game.engine, "mayPay", { pay: true }), "nothing to pay with");
    assert.equal(pending(game.engine)?.kind, "mayPay", "the offer is still waiting");
    answerPending(game.engine, "mayPay", { pay: false });
  }
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1, "no copy was put into play");
  assert.deepEqual(deckOf(game.engine, P1), deckBefore);
});

clause(PARTY, "1:rule", "the 1 to pay must be a resource I can actually pay with: with every resource already spent the offer cannot be accepted", () => {
  const game = devBoard(
    [
      { key: "pc", def: printing(PARTY), owner: P1, zone: "play" },
      { key: "clone0", def: printing(PARTY), owner: P1, zone: "deck" },
      ...fillers("below", 3, P1, "deck"),
      // The restore rule detaches resources at the start of the turn, so use a faction that does NOT detach them.
      ...spent({ deception: 2 })
    ],
    {
      turn: 2,
      activePlayerId: P2,
      playerA: {
        faction: developFaction({
          faction: {
            startingInfluence: 30,
            setup: { startingResources: { count: 0 }, openingHand: { goingFirst: 0, goingSecond: 0 } },
            turn: { restore: { detachResources: false, restoreNonResources: true }, develop: { choices: [{ type: "draw", count: 1 }] } }
          }
        })
      }
    }
  );
  endTurn(game.engine, P2);
  assert.equal(ready(game.engine), 0, "every resource is still spent");
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "mayPay");
    refused(() => answerPending(game.engine, "mayPay", { pay: true }), "no ready resource to pay with");
    answerPending(game.engine, "mayPay", { pay: false });
  }
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1);
});

clause(PARTY, "1:rule", "the search is for a card named Party Clowns: the copies can be picked, the other deck cards cannot", () => {
  const game = partyBoard();
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("above0")] }), "a card with another name");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("below0")] }), "a card with another name below the copies");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone1")] });
  assert.equal(zoneOf(game.engine, game.id("clone1")), "play", "control: either copy may be picked");
  assert.equal(zoneOf(game.engine, game.id("clone0")), "deck");
});

clause(PARTY, "1:rule", "the search covers only my DECK: a copy in my hand or discard pile, or in the opponent's deck, cannot be picked", () => {
  const game = partyBoard({
    copies: 1,
    extra: [
      { key: "inHand", def: printing(PARTY), owner: P1, zone: "hand" },
      { key: "inDiscard", def: printing(PARTY), owner: P1, zone: "discard" },
      { key: "theirs", def: printing(PARTY), owner: P2, zone: "deck" }
    ]
  });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  for (const key of ["inHand", "inDiscard", "theirs"]) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] }), `${key} is not in my deck`);
  }
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play", "control: the copy in my deck");
  assert.equal(zoneOf(game.engine, game.id("inHand")), "hand");
  assert.equal(zoneOf(game.engine, game.id("inDiscard")), "discard");
  assert.equal(zoneOf(game.engine, game.id("theirs")), "deck");
});

clause(PARTY, "1:rule", "'a card named Party Clowns' includes the Seed Saga printing, which has the same name", () => {
  const game = partyBoard({ copies: 1, sagaCopies: true });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play");
  assert.equal(game.engine.getDefinition(game.id("clone0")).id, PARTY_SAGA);
});

clause(PARTY, "1:rule", "a similarly named card is not 'named Party Clowns'", () => {
  const lookalike = character({ name: "Party Clown", cost: 4, strength: 2, life: 2, speed: 3, subtype: ["clowns"] });
  const game = partyBoard({ copies: 1, extra: [{ key: "lookalike", def: lookalike, owner: P1, zone: "deck" }] });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("lookalike")] }), "'Party Clown' is a different name");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play");
});

clause(PARTY, "1:rule", "the found card is revealed", () => {
  const game = partyBoard();
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.ok(revealedIds(game.engine).includes(game.id("clone0")), "the copy found was revealed");
});

clause(PARTY, "1:rule", "exactly one copy is put into play (the search finds a card, not all of them)", () => {
  const game = partyBoard({ copies: 3 });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  refused(
    () => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0"), game.id("clone1")] }),
    "two copies in one search"
  );
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 2, "the original and one copy");
  assert.equal(zoneOf(game.engine, game.id("clone1")), "deck");
  assert.equal(zoneOf(game.engine, game.id("clone2")), "deck");
});

clause(PARTY, "1:rule", "the copy is put into play (not deployed): no cost is paid for it beyond the 1", () => {
  const game = partyBoard({ resources: 3 });
  partyStart(game);
  const before = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(before - ready(game.engine), 1, "the Party Clowns' cost of 4 is not paid");
});

clause(PARTY, "1:rule", "a search with specific criteria may be failed (CR 312.2): I can choose to find nothing even though a copy is in my deck", () => {
  const game = partyBoard();
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1, "nothing was put into play");
});

clause(PARTY, "1:rule", "with no copy left in the deck the search finds nothing: no error, no choice, and the game goes on", () => {
  const game = partyBoard({ copies: 0 });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  if (pending(game.engine)) answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1);
  assert.equal(game.engine.state.activePlayerId, P1);
});

clause(PARTY, "1:rule", "the deck is shuffled after the search (CR 312.1): a copy found leaves the rest of the deck in a new order", () => {
  const game = partyBoard({ copies: 2 });
  const before = deckOf(game.engine, P1);
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  const after = deckOf(game.engine, P1);
  assert.deepEqual([...after].sort(), before.filter((id) => id !== game.id("clone0")).sort(), "nothing lost, nothing added");
  assert.notDeepEqual(after, before.filter((id) => id !== game.id("clone0")), "the deck was shuffled");
});

clause(PARTY, "1:rule", "a search that finds nothing still shuffles the deck (CR 312.1)", () => {
  const game = partyBoard({ copies: 0 });
  const before = deckOf(game.engine, P1);
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  if (pending(game.engine)) answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  const after = deckOf(game.engine, P1);
  assert.deepEqual([...after].sort(), [...before].sort());
  assert.notDeepEqual(after, before, "the deck was shuffled");
});

clause(PARTY, "1:rule", "a character put into play at the start of the turn can't attack that turn (CR 204.3b), but the original can", () => {
  const game = partyBoard();
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  refused(() => declareAttackBy(game.engine, P1, [game.id("clone0")]), "the new copy was not in play at the start of the turn");
  assert.equal(battleOf(game.engine), undefined);
  declareAttackBy(game.engine, P1, [game.id("pc")]);
  assert.ok(battleOf(game.engine), "control: the original attacks");
});

clause(PARTY, "1:rule", "it triggers only at the start of MY turn: not at the start of the opponent's turn", () => {
  const game = partyBoard();
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: false });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.state.pendingChoice, undefined, "no offer at the start of their turn");
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1);
});

clause(PARTY, "1:rule", "an opponent's Party Clowns does not trigger at the start of MY turn", () => {
  const game = devBoard(
    [
      { key: "theirs", def: printing(PARTY), owner: P2, zone: "play" },
      { key: "theirClone", def: printing(PARTY), owner: P2, zone: "deck" },
      ...fillers("mine", 3, P1, "deck"),
      ...res({ deception: 3 }),
      ...res({ deception: 3 }, P2)
    ],
    { turn: 2, activePlayerId: P2 }
  );
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(game.engine.state.pendingChoice, undefined, "their Party Clowns triggers at the start of THEIR turn only");
  assert.equal(zoneOf(game.engine, game.id("theirClone")), "deck");
});

clause(PARTY, "1:rule", "it triggers at the start of the controller's turn: the opponent's Party Clowns offers THEM the payment when their turn starts", () => {
  const game = devBoard(
    [
      { key: "theirs", def: printing(PARTY), owner: P2, zone: "play" },
      { key: "theirClone", def: printing(PARTY), owner: P2, zone: "deck" },
      ...fillers("theirs", 3, P2, "deck"),
      ...res({ deception: 3 }, P2)
    ],
    { turn: 1, activePlayerId: P1 }
  );
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  const pc = expectPending(game.engine, "mayPay");
  assert.equal(pc.playerId, P2, "the controller, not me, is asked");
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("theirClone")] });
  assert.equal(zoneOf(game.engine, game.id("theirClone")), "play");
  assert.equal(controllerOf(game.engine, game.id("theirClone")), P2);
});

clause(PARTY, "1:rule", "it works only while the Party Clowns is in play: in hand, in the discard pile, or face-down it does nothing", () => {
  for (const [zone, faceDown] of [["hand", false], ["discard", false], ["play", true]] as const) {
    const game = partyBoard({ zone, faceDown });
    partyStart(game);
    assert.equal(pending(game.engine), undefined, `${zone}${faceDown ? " (face-down)" : ""}: no offer`);
  }
  const control = partyBoard();
  partyStart(control);
  assert.equal(pending(control.engine)?.kind, "mayPay", "control: in play it is offered");
});

clause(PARTY, "1:rule", "two Party Clowns in play each trigger: each may pay 1 and each finds its own copy", () => {
  const game = partyBoard({ inPlay: 2, copies: 3, resources: 4 });
  partyStart(game);
  maybeOrder(game.engine);
  const first = expectPending(game.engine, "mayPay");
  assert.equal(first.playerId, P1);
  const before = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  maybeOrder(game.engine);
  const second = expectPending(game.engine, "mayPay");
  assert.equal(second.playerId, P1);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone1")] });
  assert.equal(before - ready(game.engine), 2, "two payments of 1");
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 4, "two originals plus two copies");
});

clause(PARTY, "1:rule", "the copies it fetches have the same text: next turn start each of them can fetch another (a chain of clowns)", () => {
  const game = partyBoard({ copies: 3, resources: 4 });
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 2);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  const remaining = ["clone1", "clone2"].map((k) => game.id(k));
  let picks = 0;
  drain(game.engine, (pc) => {
    if (pc.kind === "mayPay") return { kind: "mayPay", pay: true };
    if (pc.kind === "chooserSelectsTarget") return { kind: "chooserSelectsTarget", selected: [remaining[picks++]] };
    return declineAll(pc);
  });
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 4, "each of the two clowns fetched one");
});

clause(PARTY, "1:rule", "resources I spent last turn are restored first: with ALL my resources attached, the start-of-turn restore frees them and I can pay the 1", () => {
  const game = partyBoard({ resources: 0, spentResources: 3 });
  assert.equal(ready(game.engine), 0, "everything is attached before the turn starts");
  partyStart(game);
  expectPending(game.engine, "mayPay");
  assert.equal(ready(game.engine), 3, "the restore rule detached them before the trigger");
  answerPending(game.engine, "mayPay", { pay: true });
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(ready(game.engine), 2);
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play");
});

const partyBody = (printingId: string) => () => {
  const game = partyBoard({ inPlayPrinting: printingId });
  partyStart(game);
  const pay = expectPending(game.engine, "mayPay");
  assert.equal(pay.playerId, P1);
  const before = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(before - ready(game.engine), 1, "exactly 1 resource is paid");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("clone0")] });
  assert.equal(zoneOf(game.engine, game.id("clone0")), "play");
  assert.equal(controllerOf(game.engine, game.id("clone0")), P1);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 2);
};
clause(PARTY_SAGA, "1:rule", "the Seed Saga printing: at the start of my turn I may pay 1 to put a copy from my deck into play under my control", partyBody(PARTY_SAGA));

clause(PARTY_SAGA, "1:rule", "the Seed Saga printing: declining the payment searches nothing", () => {
  const game = partyBoard({ inPlayPrinting: PARTY_SAGA });
  const deckBefore = deckOf(game.engine, P1);
  partyStart(game);
  answerPending(game.engine, "mayPay", { pay: false });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(inPlayNamed(game.engine, P1, "Party Clowns").length, 1);
  assert.deepEqual(deckOf(game.engine, P1), deckBefore);
});

// =============================================================================
// Peculate (Seed 2) — Tactic, rogue, cost 0, [D][D][D]
//   COST: Pick a character, item, or location in your opponent's discard pile.
//         Pay X, where X is its numeric cost.
//   EFFECT: Put the card into play under your control.
// =============================================================================

const PECULATE = "2db3791b-3472-44b9-ad9b-ea65743ea4fc";

interface PecOpts {
  /** Ready [D] resources (default 3, the threshold). */
  deception?: number;
  /** Ready [R] resources (default 4). */
  rage?: number;
  /** Spent (attached) [R] resources. */
  spentRage?: number;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * Me = P1 with Peculate in hand. The opponent's (P2) discard pile holds: a
 * character "char" (cost 3, 2/2/2), an item "item" (cost 2), a location "loc"
 * (cost 4), a tactic "tac" (cost 2), a resource card "resc"; my own discard
 * pile holds a character "mine" (cost 2).
 */
function pecBoard(opts: PecOpts = {}) {
  return devBoard(
    [
      { key: "pec", def: printing(PECULATE), owner: P1, zone: "hand" },
      { key: "char", def: character({ name: "Dead Char", cost: 3, strength: 2, life: 2, speed: 2 }), owner: P2, zone: "discard" },
      { key: "item", def: item({ name: "Dead Item", cost: 2 }), owner: P2, zone: "discard" },
      { key: "loc", def: location({ name: "Dead Place", cost: 4, structure: 5 }), owner: P2, zone: "discard" },
      { key: "tac", def: tactic({ name: "Dead Tactic", cost: 2 }), owner: P2, zone: "discard" },
      { key: "resc", def: resourceCard({ name: "Dead Resource", cost: 2 }), owner: P2, zone: "discard" },
      { key: "mine", def: character({ name: "My Dead Char", cost: 2 }), owner: P1, zone: "discard" },
      { key: "zero", def: character({ name: "Free Char", cost: 0 }), owner: P2, zone: "discard" },
      { key: "foe", def: character({ name: "Foe", cost: 1 }), owner: P2, zone: "play" },
      { key: "friend", def: character({ name: "Friend", cost: 1 }), owner: P1, zone: "play" },
      ...res({ deception: opts.deception ?? 3, rage: opts.rage ?? 4 }),
      ...spent({ rage: opts.spentRage ?? 0 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}
type PecGame = ReturnType<typeof pecBoard>;

const pecRaw = (game: PecGame, pick: string, player: PlayerId = P1) =>
  playRaw(game.engine, player, game.id("pec"), { selected: { loot: [game.id(pick)] } });

const pecPlay = (game: PecGame, pick: string) => {
  pecRaw(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};

clause(PECULATE, "0:ability", "a character in the opponent's discard pile is put into play under my control, and Peculate goes to my discard pile", () => {
  const game = pecBoard();
  pecPlay(game, "char");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("char")), "play");
  assert.equal(controllerOf(game.engine, game.id("char")), P1, "under my control");
  assert.equal(game.engine.state.cards[game.id("char")].ownerId, P2, "ownership never changes");
  assert.ok(playOf(game.engine, P1).includes(game.id("char")), "playOf(game.engine, P1).includes(game.id(\"char\"))");
  assert.equal(zoneOf(game.engine, game.id("pec")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("pec")), "the tactic goes to its owner's discard pile");
  assert.equal(discardOf(game.engine, P2).includes(game.id("char")), false);
});

clause(PECULATE, "0:ability", "an item in the opponent's discard pile can be picked and is put into play under my control", () => {
  const game = pecBoard();
  pecPlay(game, "item");
  assert.equal(zoneOf(game.engine, game.id("item")), "play");
  assert.equal(controllerOf(game.engine, game.id("item")), P1);
});

clause(PECULATE, "0:ability", "a location in the opponent's discard pile can be picked and is put into play under my control", () => {
  const game = pecBoard();
  pecPlay(game, "loc");
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(controllerOf(game.engine, game.id("loc")), P1);
  assert.equal(damageOn(game.engine, game.id("loc")), 0, "it enters with no damage");
});

clause(PECULATE, "0:ability", "the pick cannot be a tactic or a resource card in their discard pile", () => {
  for (const key of ["tac", "resc"]) {
    const bad = pecBoard();
    refused(() => pecRaw(bad, key), `${key} is neither a character, an item nor a location`);
    assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
    assert.equal(ready(bad.engine), 7, "nothing paid");
  }
  const good = pecBoard();
  pecPlay(good, "char");
  assert.equal(zoneOf(good.engine, good.id("char")), "play", "control: a character works");
});

clause(PECULATE, "0:ability", "the pick must be in the OPPONENT's discard pile: a card in my own discard pile is refused", () => {
  const bad = pecBoard();
  refused(() => pecRaw(bad, "mine"), "my own discard pile");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
  assert.equal(ready(bad.engine), 7, "nothing paid");
  assert.equal(zoneOf(bad.engine, bad.id("mine")), "discard");
});

clause(PECULATE, "0:ability", "the pick must be in a discard pile: a card in play, in their hand or in their deck is refused", () => {
  const extra = [
    { key: "inHand", def: character({ name: "In Their Hand", cost: 1 }), owner: P2, zone: "hand" as const },
    { key: "inDeck", def: character({ name: "In Their Deck", cost: 1 }), owner: P2, zone: "deck" as const },
    { key: "myHand", def: character({ name: "In My Hand", cost: 1 }), owner: P1, zone: "hand" as const }
  ];
  for (const key of ["foe", "friend", "inHand", "inDeck", "myHand"]) {
    const bad = pecBoard({ extra });
    refused(() => pecRaw(bad, key), `${key} is not in the opponent's discard pile`);
    assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
    assert.equal(ready(bad.engine), 7, "nothing paid");
  }
});

clause(PECULATE, "0:ability", "the pick cannot be a faction or a card removed from the game", () => {
  const bad = pecBoard({ extra: [{ key: "gone", def: character({ name: "Gone", cost: 1 }), owner: P2, zone: "removed" }] });
  refused(() => pecRaw(bad, "gone"), "a removed card");
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: { loot: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
});

clause(PECULATE, "0:ability", "exactly one card must be picked: none and two are refused", () => {
  const bad = pecBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: { loot: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: {} }), "no declaration");
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: { loot: [bad.id("char"), bad.id("item")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
  assert.equal(ready(bad.engine), 7);
});

clause(PECULATE, "0:ability", "with nothing legal in the opponent's discard pile Peculate cannot be played", () => {
  const bad = devBoard(
    [
      { key: "pec", def: printing(PECULATE), owner: P1, zone: "hand" },
      { key: "tac", def: tactic({ name: "Dead Tactic", cost: 1 }), owner: P2, zone: "discard" },
      ...res({ deception: 3, rage: 4 })
    ],
    {}
  );
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: { loot: [bad.id("tac")] } }), "only a tactic is there");
  refused(() => playRaw(bad.engine, P1, bad.id("pec"), { selected: {} }), "nothing to pick");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
});

// --- Pay X, where X is the picked card's numeric cost ---

clause(PECULATE, "0:ability", "a cost-3 character costs 3 resources, paid when Peculate is played (before the opponent can respond)", () => {
  const game = pecBoard();
  const before = ready(game.engine);
  pecRaw(game, "char");
  assert.equal(before - ready(game.engine), 3, "X = 3 is paid as part of the cost");
  assert.equal(zoneOf(game.engine, game.id("pec")), "deploying");
  assert.equal(zoneOf(game.engine, game.id("char")), "discard", "the card is still in their discard pile");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("char")), "play");
  assert.equal(before - ready(game.engine), 3, "nothing more was paid on resolution");
});

clause(PECULATE, "0:ability", "a cost-2 item costs 2, and a cost-4 location costs 4", () => {
  const item2 = pecBoard();
  const b1 = ready(item2.engine);
  pecRaw(item2, "item");
  assert.equal(b1 - ready(item2.engine), 2);
  const loc4 = pecBoard();
  const b2 = ready(loc4.engine);
  pecRaw(loc4, "loc");
  assert.equal(b2 - ready(loc4.engine), 4);
});

clause(PECULATE, "0:ability", "a cost-0 card is picked for X = 0: nothing is paid, but the [D][D][D] threshold still applies", () => {
  const game = pecBoard();
  const before = ready(game.engine);
  pecPlay(game, "zero");
  assert.equal(before, ready(game.engine), "X = 0: nothing paid");
  assert.equal(zoneOf(game.engine, game.id("zero")), "play");
  assert.equal(controllerOf(game.engine, game.id("zero")), P1);
  const bad = pecBoard({ deception: 2, rage: 4 });
  refused(() => pecRaw(bad, "zero"), "no threshold, no Peculate");
});

clause(PECULATE, "0:ability", "X is taken from the picked card, not a fixed amount: a cheaper pick costs less than a dearer one", () => {
  const cheap = pecBoard();
  const b1 = ready(cheap.engine);
  pecRaw(cheap, "item");
  const cheapCost = b1 - ready(cheap.engine);
  const dear = pecBoard();
  const b2 = ready(dear.engine);
  pecRaw(dear, "loc");
  const dearCost = b2 - ready(dear.engine);
  assert.ok(dearCost > cheapCost, "4 > 2");
  assert.equal(dearCost - cheapCost, 2);
});

clause(PECULATE, "0:ability", "I can't pick a card whose cost I can't pay: with 3 ready resources a cost-4 location is refused and nothing is paid", () => {
  const bad = pecBoard({ deception: 3, rage: 0 });
  refused(() => pecRaw(bad, "loc"), "X = 4 but only 3 ready resources");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
  assert.equal(ready(bad.engine), 3);
  const good = pecBoard({ deception: 3, rage: 0 });
  pecPlay(good, "char");
  assert.equal(zoneOf(good.engine, good.id("char")), "play", "control: a cost-3 card is affordable");
  assert.equal(ready(good.engine), 0);
});

clause(PECULATE, "0:ability", "exactly enough: with 4 ready resources a cost-4 location works and uses them all", () => {
  const game = pecBoard({ deception: 3, rage: 1 });
  const before = ready(game.engine);
  assert.equal(before, 4);
  pecPlay(game, "loc");
  assert.equal(zoneOf(game.engine, game.id("loc")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(PECULATE, "0:ability", "spent (attached) resources count for the threshold but cannot pay X", () => {
  const good = pecBoard({ deception: 0, rage: 3, extra: spent({ deception: 3 }) });
  pecPlay(good, "char");
  assert.equal(zoneOf(good.engine, good.id("char")), "play", "spent [D][D][D] meet the threshold; three ready Rage pay X = 3");
  const bad = pecBoard({ deception: 0, rage: 2, extra: spent({ deception: 3 }) });
  refused(() => pecRaw(bad, "char"), "X = 3 but only 2 ready resources");
  assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
});

clause(PECULATE, "0:ability", "needs [D][D][D]: lots of other resources, only [D][D], Volition, or the opponent's [D] are refused", () => {
  const rage = pecBoard({ deception: 0, rage: 8 });
  refused(() => pecRaw(rage, "zero"), "no [D]");
  const two = pecBoard({ deception: 2, rage: 6 });
  refused(() => pecRaw(two, "zero"), "only [D][D]");
  const vol = pecBoard({ deception: 2, rage: 0, extra: volition(4, P1) });
  refused(() => pecRaw(vol, "zero"), "Volition is not [D]");
  const theirs = pecBoard({ deception: 2, rage: 4, extra: res({ deception: 4 }, P2) });
  refused(() => pecRaw(theirs, "zero"), "their [D] do not count");
  for (const bad of [rage, two, vol, theirs]) assert.equal(zoneOf(bad.engine, bad.id("pec")), "hand");
});

// --- EFFECT: put the card into play under your control ---

clause(PECULATE, "0:ability", "the card comes into play fresh: undamaged, not depleted, face-up, with its printed stats", () => {
  const game = pecBoard();
  pecPlay(game, "char");
  const card = game.engine.state.cards[game.id("char")];
  assert.equal(card.damage, 0);
  assert.equal(card.depleted, false);
  assert.equal(card.faceDown, false);
  assert.deepEqual(stats(game.engine, game.id("char")), [2, 2, 2]);
});

clause(PECULATE, "0:ability", "a character put into play this way can't attack this turn (it did not start the turn in play, CR 204.3)", () => {
  const game = pecBoard();
  pecPlay(game, "char");
  refused(() => declareAttackBy(game.engine, P1, [game.id("char")]), "a character that entered this turn cannot attack");
  assert.equal(battleOf(game.engine), undefined);
  declareAttackBy(game.engine, P1, [game.id("friend")]);
  assert.ok(battleOf(game.engine), "control: a character that started the turn in play can");
});

clause(PECULATE, "0:ability", "'enters play' triggers of the card fire for ME, its new controller", () => {
  const welcoming = character({
    name: "Welcoming Corpse",
    cost: 1,
    behavior: {
      abilities: [
        {
          id: "welcome",
          type: "triggered",
          event: "cardEnteredPlay",
          condition: { type: "sourceIsEventCard" },
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
  const game = pecBoard({ extra: [{ key: "welcome", def: welcoming, owner: P2, zone: "discard" }, ...fillers("dk", 3, P1, "deck"), ...fillers("odk", 3, P2, "deck")] });
  const myHand = handOf(game.engine, P1).length;
  const theirHand = handOf(game.engine, P2).length;
  pecPlay(game, "welcome");
  assert.equal(zoneOf(game.engine, game.id("welcome")), "play");
  assert.equal(handOf(game.engine, P1).length, myHand - 1 + 1, "I played Peculate (-1) and drew 1");
  assert.equal(handOf(game.engine, P2).length, theirHand, "they draw nothing");
});

clause(PECULATE, "0:ability", "it can be played in response, on the opponent's turn, as any tactic can", () => {
  const game = pecBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  pecRaw(game, "item");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("item")), "play");
  assert.equal(controllerOf(game.engine, game.id("item")), P1);
});

clause(PECULATE, "0:ability", "the CR 402.4 rule: if the picked card leaves their discard pile in response (returned to their hand), the unresolved effect loses track of it", () => {
  const retrieve = tactic({
    name: "Recover",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ret",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const game = pecBoard({ extra: [{ key: "recover", def: retrieve, owner: P2, zone: "hand" }] });
  pecRaw(game, "char");
  playRaw(game.engine, P2, game.id("recover"), { selected: { t: [game.id("char")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("char")), "hand", "they got it back");
  assert.equal(controllerOf(game.engine, game.id("char")), P2, "I did not get it");
  assert.equal(playOf(game.engine, P1).includes(game.id("char")), false);
});

clause(PECULATE, "0:ability", "an ATTACH TO item (Rusty Pickaxe) put into play this way ends up attached to a character, not discarded (CR 507.2b)", () => {
  const pickaxe = printing("0b3b61aa-3ea4-4acc-8f76-c6242af992e0");
  const game = pecBoard({ extra: [{ key: "axe", def: pickaxe, owner: P2, zone: "discard" }] });
  pecRaw(game, "axe");
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget", "I am asked to pick a character for it as it enters");
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("friend")] });
  }
  assert.equal(zoneOf(game.engine, game.id("axe")), "play", "it is in play, not in the discard pile");
  assert.ok(game.engine.state.cards[game.id("axe")].attachedTo, "it is attached to a character");
  assert.equal(controllerOf(game.engine, game.id("axe")), P1);
});

// =============================================================================
// Resistance Fighter (Seed 2, Seed Saga) — Character, rogue, miner, cost 1, [D], 1/1/3
//   PROVIDES: [D]
//   While you control a character you don't own, this card gains 2 strength,
//   2 life, and 1 speed.
// =============================================================================

const RF = "54acfe5d-ccfe-4f8e-b324-65b65e6d927f";
const RF_SAGA = "49efade2-8228-4691-8553-22735d20319c";

/** A free tactic (id "st", pick "t"): take control of one picked character the opponent controls. */
function stealTactic(name = "Steal"): CardDefinition {
  return tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "st",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "opponent" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}

interface RfOpts {
  printingId?: string;
  /** Who controls the Resistance Fighter (default P1, its owner). */
  rfController?: PlayerId;
  rfOwner?: PlayerId;
  zone?: Zone;
  faceDown?: boolean;
  depleted?: boolean;
  extra?: CardPlacement[];
}

function rfBoard(opts: RfOpts = {}) {
  const owner = opts.rfOwner ?? P1;
  return devBoard(
    [
      { key: "rf", def: printing(opts.printingId ?? RF), owner, controller: opts.rfController ?? owner, zone: opts.zone ?? "play", faceDown: opts.faceDown, depleted: opts.depleted },
      ...(opts.extra ?? [])
    ],
    { turn: 1, activePlayerId: P1 }
  );
}
type RfGame = ReturnType<typeof rfBoard>;

const icons = (engine: SpoilsEngine, player: PlayerId) => engine.getThresholds(player) as Record<string, number | undefined>;
const dCount = (engine: SpoilsEngine, player: PlayerId): number => icons(engine, player).deception ?? 0;

const RF_PLAIN: [number, number, number] = [1, 1, 3];
const RF_BOOSTED: [number, number, number] = [3, 3, 4];

const rfProvidesBody = (printingId: string) => () => {
  const game = rfBoard({ printingId });
  assert.equal(dCount(game.engine, P1), 1, "one [D] while in play");
  assert.equal(dCount(game.engine, P2), 0, "the opponent gets none");
  for (const icon of ["rage", "greed", "elitism", "obsession"]) assert.equal(icons(game.engine, P1)[icon] ?? 0, 0, `no [${icon}]`);
};
clause(RF, "0:provides", "in play it provides exactly one [D] and no other icon, to its controller only", rfProvidesBody(RF));
clause(RF_SAGA, "0:provides", "the Seed Saga printing provides exactly one [D] and no other icon, to its controller only", rfProvidesBody(RF_SAGA));

clause(RF, "0:provides", "it provides nothing in hand, in the deck or in the discard pile", () => {
  for (const zone of ["hand", "deck", "discard"] as const) {
    const game = rfBoard({ zone });
    assert.equal(dCount(game.engine, P1), 0, `${zone}: no [D]`);
  }
});

clause(RF, "0:provides", "face-down it provides only Volition (CR 411.1), not [D]", () => {
  const game = rfBoard({ faceDown: true });
  assert.equal(dCount(game.engine, P1), 0, "no [D] face-down");
  assert.equal(icons(game.engine, P1).volition ?? 0, 1, "one Volition instead");
});

clause(RF, "0:provides", "it stops providing when it leaves play", () => {
  const game = rfBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(dCount(game.engine, P1), 1);
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("rf")] } });
  assert.equal(zoneOf(game.engine, game.id("rf")), "discard");
  assert.equal(dCount(game.engine, P1), 0);
});

clause(RF, "0:provides", "a depleted Resistance Fighter still provides its [D] (icons are not spent, CR 405.6)", () => {
  const game = rfBoard({ depleted: true });
  assert.equal(dCount(game.engine, P1), 1);
});

clause(RF, "0:provides", "it provides to whoever controls it: under the opponent's control the [D] is theirs and not mine", () => {
  const game = rfBoard({ rfOwner: P1, rfController: P2 });
  assert.equal(dCount(game.engine, P2), 1, "the controller gets the [D]");
  assert.equal(dCount(game.engine, P1), 0, "the owner does not");
});

clause(RF, "0:provides", "its [D] counts toward thresholds: it alone lets me deploy a [D] card (the numeric cost is paid by another resource)", () => {
  const dCard = character({ name: "Needs D", cost: 1, threshold: "d" });
  const good = rfBoard({ extra: [{ key: "card", def: dCard, owner: P1, zone: "hand" }, ...res({ rage: 1 })] });
  play(good.engine, P1, good.id("card"));
  assert.equal(zoneOf(good.engine, good.id("card")), "play", "the Resistance Fighter's [D] met the threshold");
  const bad = devBoard([{ key: "card", def: dCard, owner: P1, zone: "hand" }, ...res({ rage: 1 })]);
  refused(() => playRaw(bad.engine, P1, bad.id("card")), "control: without a [D] source the threshold is not met");
  assert.equal(zoneOf(bad.engine, bad.id("card")), "hand");
});

clause(RF, "0:provides", "two Resistance Fighters provide two [D], enough for a [D][D] card", () => {
  const ddCard = character({ name: "Needs DD", cost: 0, threshold: "dd" });
  const game = rfBoard({
    extra: [
      { key: "rf2", def: printing(RF), owner: P1, zone: "play" },
      { key: "card", def: ddCard, owner: P1, zone: "hand" }
    ]
  });
  assert.equal(dCount(game.engine, P1), 2);
  play(game.engine, P1, game.id("card"));
  assert.equal(zoneOf(game.engine, game.id("card")), "play");
  const one = rfBoard({ extra: [{ key: "card", def: ddCard, owner: P1, zone: "hand" }] });
  refused(() => playRaw(one.engine, P1, one.id("card")), "one [D] is not [D][D]");
});

// --- the rule: While you control a character you don't own ---

clause(RF, "1:rule", "with no borrowed character it is a plain 1/1/3", () => {
  const game = rfBoard({
    extra: [
      { key: "mine", def: character({ name: "My Own", cost: 1 }), owner: P1, zone: "play" },
      { key: "theirs", def: character({ name: "Their Own", cost: 1 }), owner: P2, zone: "play" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "while I control a character the opponent owns it gains 2 strength, 2 life and 1 speed (1/1/3 becomes 3/3/4)", () => {
  const game = rfBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" }] });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
});

clause(RF_SAGA, "1:rule", "the Seed Saga printing: the same boost, 1/1/3 becomes 3/3/4 with a borrowed character, and it is plain without one", () => {
  const plain = rfBoard({ printingId: RF_SAGA });
  assert.deepEqual(stats(plain.engine, plain.id("rf")), RF_PLAIN);
  const boosted = rfBoard({ printingId: RF_SAGA, extra: [{ key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" }] });
  assert.deepEqual(stats(boosted.engine, boosted.id("rf")), RF_BOOSTED);
});

clause(RF, "1:rule", "the boost needs the opponent's character UNDER MY control: their own character under their control does not count", () => {
  const game = rfBoard({ extra: [{ key: "theirs", def: character({ name: "Their Own", cost: 1 }), owner: P2, zone: "play" }] });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "a character I own and control does not count", () => {
  const game = rfBoard({ extra: [{ key: "mine", def: character({ name: "My Own", cost: 1 }), owner: P1, zone: "play" }] });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "a character I OWN but the opponent controls does not count (I control nothing I do not own)", () => {
  const game = rfBoard({ extra: [{ key: "lent", def: character({ name: "Lent Out", cost: 1 }), owner: P1, controller: P2, zone: "play" }] });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "it must be a CHARACTER I control and don't own: a borrowed item, location or resource does not count", () => {
  const game = rfBoard({
    extra: [
      { key: "stolenItem", def: item({ name: "Stolen Item", cost: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenPlace", def: location({ name: "Stolen Place", cost: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "stolenRes", def: resourceCard({ name: "Stolen Resource" }), owner: P2, controller: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "a borrowed face-down card is only a resource, not a character (CR 411.1): it does not count", () => {
  const game = rfBoard({ extra: [{ key: "stolenDown", def: character({ name: "Stolen Face Down", cost: 1 }), owner: P2, controller: P1, zone: "play", faceDown: true }] });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "a borrowed character in my hand or discard pile (not in play, so not controlled) does not count", () => {
  const game = rfBoard({
    extra: [
      { key: "handCard", def: character({ name: "Theirs In My Hand", cost: 1 }), owner: P2, zone: "hand" },
      { key: "discardCard", def: character({ name: "Theirs In My Discard", cost: 1 }), owner: P2, zone: "discard" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "the boost is not cumulative: two borrowed characters still give just +2/+2/+1", () => {
  const game = rfBoard({
    extra: [
      { key: "s1", def: character({ name: "Stolen One", cost: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "s2", def: character({ name: "Stolen Two", cost: 1 }), owner: P2, controller: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
});

clause(RF, "1:rule", "it turns on the moment I take control of a character: stealing one with a tactic boosts the Fighter", () => {
  const game = rfBoard({
    extra: [
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" },
      { key: "victim", def: character({ name: "Victim", cost: 1 }), owner: P2, zone: "play" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
  play(game.engine, P1, game.id("steal"), { selected: { t: [game.id("victim")] } });
  assert.equal(controllerOf(game.engine, game.id("victim")), P1);
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
});

clause(RF, "1:rule", "it turns off when the borrowed character is destroyed", () => {
  const game = rfBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("stolen")] } });
  assert.equal(zoneOf(game.engine, game.id("stolen")), "discard");
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "it turns off when the borrowed character goes back to its owner's hand, and on again if I take another", () => {
  const bounce = tactic({
    name: "Send Home",
    cost: 0,
    behavior: {
      abilities: [{ id: "home", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
  const game = rfBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" },
      { key: "bounce", def: bounce, owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("stolen")] } });
  assert.equal(zoneOf(game.engine, game.id("stolen")), "hand");
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "damage already on it stays when the boost goes away: with 1 damage on a boosted (3-life) Fighter, losing the boost leaves 1 life and it is destroyed; with no damage it survives", () => {
  const board = () =>
    rfBoard({
      extra: [
        { key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" },
        { key: "kill", def: killTactic(), owner: P1, zone: "hand" }
      ]
    });
  const hurt = board();
  hurt.engine.state.cards[hurt.id("rf")].damage = 1;
  assert.equal(zoneOf(hurt.engine, hurt.id("rf")), "play", "3 life with 1 damage: alive");
  play(hurt.engine, P1, hurt.id("kill"), { selected: { t: [hurt.id("stolen")] } });
  assert.equal(zoneOf(hurt.engine, hurt.id("rf")), "discard", "1 life with 1 damage: destroyed (CR 408.4)");
  const fine = board();
  play(fine.engine, P1, fine.id("kill"), { selected: { t: [fine.id("stolen")] } });
  assert.equal(zoneOf(fine.engine, fine.id("rf")), "play", "control: with no damage it stays at 1 life");
  assert.deepEqual(stats(fine.engine, fine.id("rf")), RF_PLAIN);
});

clause(RF, "1:rule", "a Resistance Fighter the opponent steals can count ITSELF: a character I control and don't own", () => {
  const game = rfBoard({ rfOwner: P2, rfController: P1 });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED, "it is itself a character I control and don't own");
});

clause(RF, "1:rule", "from the opponent's side it works the same: their Fighter gains the boost while THEY control a character they don't own", () => {
  const game = rfBoard({
    rfOwner: P2,
    rfController: P2,
    extra: [{ key: "stolenByThem", def: character({ name: "Mine, Stolen", cost: 1 }), owner: P1, controller: P2, zone: "play" }]
  });
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
  const none = rfBoard({ rfOwner: P2, rfController: P2, extra: [{ key: "mineHere", def: character({ name: "Mine, Mine", cost: 1 }), owner: P1, controller: P1, zone: "play" }] });
  assert.deepEqual(stats(none.engine, none.id("rf")), RF_PLAIN, "a character I control that they don't own is not THEIR borrowed character");
});

clause(RF, "1:rule", "the boost applies to the Fighter only: the borrowed character and my other characters keep their stats", () => {
  const game = rfBoard({
    extra: [
      { key: "stolen", def: character({ name: "Stolen", cost: 1, strength: 2, life: 2, speed: 2 }), owner: P2, controller: P1, zone: "play" },
      { key: "mine", def: character({ name: "My Own", cost: 1, strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" }
    ]
  });
  assert.deepEqual(stats(game.engine, game.id("stolen")), [2, 2, 2]);
  assert.deepEqual(stats(game.engine, game.id("mine")), [2, 2, 2]);
  assert.deepEqual(stats(game.engine, game.id("rf")), RF_BOOSTED);
});

clause(RF, "1:rule", "the boost is real in battle: 3 strength deals 3 to the faction, and its 4 speed beats a 3-speed blocker in the damage order", () => {
  const board = (borrowed: boolean) =>
    rfBoard({
      extra: [
        ...(borrowed ? [{ key: "stolen", def: character({ name: "Stolen", cost: 1 }), owner: P2, controller: P1, zone: "play" as const }] : []),
        { key: "blocker", def: character({ name: "Blocker", cost: 1, strength: 1, life: 3, speed: 3 }), owner: P2, zone: "play" }
      ]
    });
  const plain = board(false);
  declareAttackBy(plain.engine, P1, [plain.id("rf")]);
  declareBlockers(plain.engine, P2, []);
  autoResolveBattle(plain.engine);
  assert.equal(influenceOf(plain.engine, P2), START - 1, "control: 1 strength deals 1");
  const boosted = board(true);
  declareAttackBy(boosted.engine, P1, [boosted.id("rf")]);
  declareBlockers(boosted.engine, P2, []);
  autoResolveBattle(boosted.engine);
  assert.equal(influenceOf(boosted.engine, P2), START - 3, "3 strength deals 3");
  const duel = board(true);
  declareAttackBy(duel.engine, P1, [duel.id("rf")]);
  declareBlockers(duel.engine, P2, [duel.id("blocker")]);
  autoResolveBattle(duel.engine);
  assert.equal(zoneOf(duel.engine, duel.id("blocker")), "discard", "3 damage kills the 3-life blocker");
  assert.equal(zoneOf(duel.engine, duel.id("rf")), "play", "a 3-life Fighter survives the blocker's 1 damage");
});

// =============================================================================
// Rosy Palmer, and Her Five Friends (Seed 2) — Character, rogue, dancer, cost 6, [D][D], 4/4/4
//   UNIQUE ROSY
//   If this card is destroyed, reveal the top 5 cards of your opponent's deck.
//   You may choose a revealed character. If you do, put it into play under your
//   control. Your opponent puts the remaining cards on the bottom of their deck
//   in any order.
// =============================================================================

const ROSY = "4d801a32-d054-413d-9eaf-d915a82139b1";

/** A free tactic (id "sac", pick "t"): EXTRA COST destroy the picked character you control; the effect draws a card. */
function sacrificeTactic(): CardDefinition {
  return tactic({
    name: "Sacrifice",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sac",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character", controller: "self" }, count: 1 }],
          costs: [{ type: "destroy", target: { type: "selected", id: "t" } }],
          effects: [{ type: "draw", player: "controller", amount: 1 }]
        }
      ]
    }
  });
}

/** A free tactic (id "rm", pick "t"): removes the picked card in play from the game. */
function removeAnyTactic(): CardDefinition {
  return tactic({
    name: "Remover",
    cost: 0,
    behavior: {
      abilities: [{ id: "rm", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic (id "bn", pick "t"): returns the picked card in play to its owner's hand. */
function bounceInPlayTactic(): CardDefinition {
  return tactic({
    name: "Bouncer",
    cost: 0,
    behavior: {
      abilities: [{ id: "bn", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }] }]
    }
  });
}

/** A free tactic (id "dk", pick "t"): destroys the picked card in play, of any type. */
function destroyInPlayTactic(): CardDefinition {
  return tactic({
    name: "Destroyer",
    cost: 0,
    behavior: {
      abilities: [{ id: "dk", type: "activated", targets: [{ id: "t", selector: { zone: "play" }, count: 1 }], effects: [{ type: "destroy", target: { type: "selected", id: "t" } }] }]
    }
  });
}

/** A free tactic (id "fd", pick "t"): flips the picked character face-down. */
function flipDownCharTactic(): CardDefinition {
  return tactic({
    name: "Flipper",
    cost: 0,
    behavior: {
      abilities: [{ id: "fd", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "flipFaceDown", target: { type: "selected", id: "t" } }] }]
    }
  });
}

type DeckKind = "char" | "item" | "tactic";

interface RosyOpts {
  /** The opponent's deck, top first (default: char, item, char, tactic, char | char, char, item). */
  deck?: DeckKind[];
  /** Who controls the Rosy (default P1). */
  controller?: PlayerId;
  /** Who owns the Rosy (default P1). */
  owner?: PlayerId;
  faceDown?: boolean;
  /** Whose deck is revealed from: the NON-controller's. */
  extra?: CardPlacement[];
  resources?: number;
  turn?: number;
  active?: PlayerId;
}

const ROSY_DECK: DeckKind[] = ["char", "item", "char", "tactic", "char", "char", "char", "item"];

/**
 * Rosy "rosy" in play; a free kill tactic "kill" in P1's hand. The OPPONENT
 * (P2)'s deck holds, top to bottom, `d0..d7` of the given kinds.
 * The controller's opponent's deck is the one revealed: with `controller: P2`
 * the revealed deck is P1's (`d0..d7` still name the revealed player's cards).
 */
function rosyBoard(opts: RosyOpts = {}) {
  const controller = opts.controller ?? P1;
  const owner = opts.owner ?? P1;
  const victim = controller === P1 ? P2 : P1;
  const kinds = opts.deck ?? ROSY_DECK;
  const mk = (kind: DeckKind, i: number): CardDefinition =>
    kind === "char"
      ? character({ name: `Deck Char ${i}`, cost: i })
      : kind === "item"
        ? item({ name: `Deck Item ${i}`, cost: i })
        : tactic({ name: `Deck Tactic ${i}`, cost: i });
  return devBoard(
    [
      { key: "rosy", def: printing(ROSY), owner, controller, zone: "play", faceDown: opts.faceDown },
      { key: "kill", def: destroyInPlayTactic(), owner: P1, zone: "hand" },
      { key: "bounce", def: bounceInPlayTactic(), owner: P1, zone: "hand" },
      { key: "remove", def: removeAnyTactic(), owner: P1, zone: "hand" },
      { key: "flip", def: flipDownCharTactic(), owner: P1, zone: "hand" },
      { key: "sac", def: sacrificeTactic(), owner: P1, zone: "hand" },
      ...kinds.map((kind, i): CardPlacement => ({ key: `d${i}`, def: mk(kind, i), owner: victim, zone: "deck" })),
      { key: "victimHand", def: character({ name: "Victim Hand Char", cost: 1 }), owner: victim, zone: "hand" },
      { key: "victimDiscard", def: character({ name: "Victim Discard Char", cost: 1 }), owner: victim, zone: "discard" },
      ...fillers("own", 3, controller, "deck", (i) => character({ name: `Own Deck ${i}` })),
      ...res({ deception: opts.resources ?? 4 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1, random: lcg(41) }
  );
}
type RosyGame = ReturnType<typeof rosyBoard>;

/** P1 destroys the Rosy with the kill tactic (the window is drained; the trigger's first choice is left open). */
function rosyDie(game: RosyGame, key = "rosy"): void {
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id(key)] } });
}

const rosyDeckIds = (game: RosyGame, n = 8) => Array.from({ length: n }, (_, i) => game.id(`d${i}`));

clause(ROSY, "0:unique", "it is a 4/4/4 character that costs 6 [D][D]", () => {
  const game = rosyBoard();
  assert.deepEqual(stats(game.engine, game.id("rosy")), [4, 4, 4]);
  const hand = devBoard([{ key: "rosy", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 5 })]);
  refused(() => playRaw(hand.engine, P1, hand.id("rosy")), "5 resources is one short of 6");
  const dd = devBoard([{ key: "rosy", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 1, rage: 6 })]);
  refused(() => playRaw(dd.engine, P1, dd.id("rosy")), "[D][D] needed");
  const good = devBoard([{ key: "rosy", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 6 })]);
  play(good.engine, P1, good.id("rosy"));
  assert.equal(zoneOf(good.engine, good.id("rosy")), "play");
  assert.equal(ready(good.engine), 0, "exactly 6 paid");
});

// --- UNIQUE ROSY (CR 507.5): I may not control two cards with the designation ---

clause(ROSY, "0:unique", "controlling two Rosy Palmers at once forces me to choose one to keep and destroys the other", () => {
  const game = rosyBoard({ extra: [{ key: "rosy2", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 6 })] });
  play(game.engine, P1, game.id("rosy2"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("rosy") });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "play", "the chosen one stays");
  assert.equal(zoneOf(game.engine, game.id("rosy2")), "discard", "the other is destroyed");
  assert.equal(inPlayNamed(game.engine, P1, "Rosy Palmer, and Her Five Friends").length, 1);
});

clause(ROSY, "0:unique", "the player may keep the NEW Rosy instead of the old one", () => {
  const game = rosyBoard({ extra: [{ key: "rosy2", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 6 })] });
  play(game.engine, P1, game.id("rosy2"));
  expectPending(game.engine, "uniqueSurvivor");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("rosy2") });
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(zoneOf(game.engine, game.id("rosy2")), "play");
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
});

clause(ROSY, "0:unique", "the opponent controlling their own Rosy is fine: UNIQUE is per player (FAQ)", () => {
  const game = rosyBoard({ extra: [{ key: "theirRosy", def: printing(ROSY), owner: P2, zone: "play" }] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirRosy")), "play");
  const second = rosyBoard({ extra: [{ key: "theirRosy", def: printing(ROSY), owner: P2, zone: "hand" }, ...res({ deception: 6 }, P2)], turn: 2, active: P2 });
  play(second.engine, P2, second.id("theirRosy"));
  assert.equal(second.engine.state.pendingChoice, undefined, "deploying their own Rosy while I have mine raises no conflict");
  assert.equal(zoneOf(second.engine, second.id("theirRosy")), "play");
  assert.equal(zoneOf(second.engine, second.id("rosy")), "play");
});

clause(ROSY, "0:unique", "taking control of the opponent's Rosy while I already control mine is a conflict: I choose which to keep", () => {
  const game = rosyBoard({
    extra: [
      { key: "theirRosy", def: printing(ROSY), owner: P2, zone: "play" },
      { key: "steal", def: stealTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("steal"), { selected: { t: [game.id("theirRosy")] } });
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("rosy") });
  drain(game.engine, declineAll);
  assert.equal(game.engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(inPlayNamed(game.engine, P1, "Rosy Palmer, and Her Five Friends").length, 1);
});

clause(ROSY, "0:unique", "a different card carrying UNIQUE ROSY conflicts too (the designation matters, not the name)", () => {
  const impostor = character({ name: "Rosy's Impostor", cost: 1, unique: "rosy" });
  const game = rosyBoard({ extra: [{ key: "impostor", def: impostor, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("impostor"));
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("impostor") });
  drain(game.engine, declineAll);
  assert.equal(zoneOf(game.engine, game.id("impostor")), "play");
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
});

clause(ROSY, "0:unique", "a card with another UNIQUE designation does not conflict with Rosy", () => {
  const other = character({ name: "Not Rosy", cost: 1, unique: "somebody-else" });
  const game = rosyBoard({ extra: [{ key: "other", def: other, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("other"));
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("other")), "play");
  assert.equal(zoneOf(game.engine, game.id("rosy")), "play");
});

// --- the rule: If this card is destroyed ---

clause(ROSY, "1:rule", "when it is destroyed I am asked which revealed character to take, and the top 5 cards of the opponent's deck are revealed (exactly those five)", () => {
  const game = rosyBoard();
  rosyDie(game);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  const revealed = revealedIds(game.engine);
  for (let i = 0; i < 5; i++) assert.ok(revealed.includes(game.id(`d${i}`)), `d${i} (top 5) is revealed`);
  for (let i = 5; i < 8; i++) assert.equal(revealed.includes(game.id(`d${i}`)), false, `d${i} (below the top 5) is not revealed`);
});

clause(ROSY, "1:rule", "'You may choose a revealed character': picking one puts it into play under my control (it was theirs, ownership does not change)", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  assert.equal(zoneOf(game.engine, game.id("d2")), "play");
  assert.equal(controllerOf(game.engine, game.id("d2")), P1);
  assert.equal(game.engine.state.cards[game.id("d2")].ownerId, P2);
  assert.ok(playOf(game.engine, P1).includes(game.id("d2")), "playOf(game.engine, P1).includes(game.id(\"d2\"))");
  assert.equal(deckOf(game.engine, P2).includes(game.id("d2")), false, "it left their deck");
});

clause(ROSY, "1:rule", "any of the revealed characters can be chosen: the first, the third and the fifth card all work", () => {
  for (const key of ["d0", "d2", "d4"]) {
    const game = rosyBoard();
    rosyDie(game);
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] });
    assert.equal(zoneOf(game.engine, game.id(key)), "play", `${key} can be chosen`);
    assert.equal(controllerOf(game.engine, game.id(key)), P1);
  }
});

clause(ROSY, "1:rule", "only a revealed CHARACTER can be chosen: a revealed item or tactic is refused", () => {
  const game = rosyBoard();
  rosyDie(game);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d1")] }), "an item");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d3")] }), "a tactic");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  assert.equal(zoneOf(game.engine, game.id("d0")), "play", "control: a character works");
  assert.equal(zoneOf(game.engine, game.id("d1")), "deck");
  assert.equal(zoneOf(game.engine, game.id("d3")), "deck");
});

clause(ROSY, "1:rule", "only a REVEALED card can be chosen: a character 6th or deeper in their deck is refused", () => {
  const game = rosyBoard();
  rosyDie(game);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d5")] }), "the 6th card");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d6")] }), "the 7th card");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d4")] });
  assert.equal(zoneOf(game.engine, game.id("d4")), "play", "control: the 5th card is revealed");
  assert.equal(zoneOf(game.engine, game.id("d5")), "deck");
});

clause(ROSY, "1:rule", "the choice is among the OPPONENT's deck only: a card in my own deck, or in their hand or discard pile, is refused", () => {
  const game = rosyBoard();
  rosyDie(game);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("own0")] }), "a card in my own deck");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("victimHand")] }), "a card in their hand");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("victimDiscard")] }), "a card in their discard pile");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  assert.equal(zoneOf(game.engine, game.id("d0")), "play");
});

clause(ROSY, "1:rule", "only one revealed character can be chosen, not two", () => {
  const game = rosyBoard();
  rosyDie(game);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0"), game.id("d2")] }), "two characters");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  assert.equal(zoneOf(game.engine, game.id("d2")), "deck");
});

clause(ROSY, "1:rule", "'may': I can decline to choose anyone; nothing enters play", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  for (let i = 0; i < 8; i++) assert.equal(zoneOf(game.engine, game.id(`d${i}`)), "deck", `d${i} stays in their deck`);
  assert.equal(inPlayNamed(game.engine, P1, "Deck Char 0").length, 0);
});

clause(ROSY, "1:rule", "'put it into play': no cost is paid for the character taken", () => {
  const game = rosyBoard();
  const before = ready(game.engine);
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d4")] });
  assert.equal(ready(game.engine), before, "Deck Char 4 (cost 4) was put into play for free");
});

// --- "Your opponent puts the remaining cards on the bottom of their deck in any order." ---

clause(ROSY, "1:rule", "after I take a character, THE OPPONENT is asked to order the 4 remaining revealed cards", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  const pc = expectPending(game.engine, "reorderDeck");
  assert.equal(pc.playerId, P2, "their cards, their order");
  assert.equal(pc.to, "bottom");
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [game.id("d0"), game.id("d1"), game.id("d3"), game.id("d4")].sort(), "the 4 revealed cards I did not take");
});

clause(ROSY, "1:rule", "when I decline, all 5 revealed cards are ordered by the opponent onto the bottom", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  const pc = expectPending(game.engine, "reorderDeck");
  assert.equal(pc.playerId, P2);
  assert.deepEqual([...(pc.cardIds as string[])].sort(), [0, 1, 2, 3, 4].map((i) => game.id(`d${i}`)).sort());
});

clause(ROSY, "1:rule", "the remaining cards go to the BOTTOM of their deck in the order they chose; the unrevealed cards move up in their old order", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  const chosenOrder = [game.id("d4"), game.id("d0"), game.id("d3"), game.id("d1")];
  answerPending(game.engine, "reorderDeck", { order: chosenOrder });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(game.engine, P2), [game.id("d5"), game.id("d6"), game.id("d7"), ...chosenOrder]);
});

clause(ROSY, "1:rule", "declined: all five go to the bottom in the opponent's chosen order", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  const chosenOrder = [game.id("d3"), game.id("d4"), game.id("d2"), game.id("d1"), game.id("d0")];
  answerPending(game.engine, "reorderDeck", { order: chosenOrder });
  assert.deepEqual(deckOf(game.engine, P2), [game.id("d5"), game.id("d6"), game.id("d7"), ...chosenOrder]);
});

clause(ROSY, "1:rule", "the opponent may keep the cards in their original order, or reverse them (any order is legal)", () => {
  const keep = rosyBoard();
  rosyDie(keep);
  answerPending(keep.engine, "chooserSelectsTarget", { selected: [] });
  const original = [0, 1, 2, 3, 4].map((i) => keep.id(`d${i}`));
  answerPending(keep.engine, "reorderDeck", { order: original });
  assert.deepEqual(deckOf(keep.engine, P2).slice(3), original);
  const reversed = rosyBoard();
  rosyDie(reversed);
  answerPending(reversed.engine, "chooserSelectsTarget", { selected: [] });
  const reversedOrder = [4, 3, 2, 1, 0].map((i) => reversed.id(`d${i}`));
  answerPending(reversed.engine, "reorderDeck", { order: reversedOrder });
  assert.deepEqual(deckOf(reversed.engine, P2).slice(3), reversedOrder);
});

clause(ROSY, "1:rule", "an order that drops, duplicates or adds a card is refused (the opponent must order exactly the remaining cards)", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  refused(() => answerPending(game.engine, "reorderDeck", { order: [game.id("d0"), game.id("d1"), game.id("d3")] }), "a card is missing");
  refused(() => answerPending(game.engine, "reorderDeck", { order: [game.id("d0"), game.id("d1"), game.id("d3"), game.id("d3")] }), "a duplicate");
  refused(() => answerPending(game.engine, "reorderDeck", { order: [game.id("d0"), game.id("d1"), game.id("d3"), game.id("d5")] }), "a card from deeper in the deck");
  assert.equal(pending(game.engine)?.kind, "reorderDeck", "still waiting for a legal order");
});

clause(ROSY, "1:rule", "nothing is shuffled: the deck keeps its size minus the card taken, and no card is lost", () => {
  const game = rosyBoard();
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  answerPending(game.engine, "reorderDeck", { order: [game.id("d0"), game.id("d1"), game.id("d3"), game.id("d4")] });
  assert.equal(deckOf(game.engine, P2).length, 7, "8 cards minus the 1 taken");
  assert.deepEqual(deckOf(game.engine, P2), ["d5", "d6", "d7", "d0", "d1", "d3", "d4"].map((k) => game.id(k)), "same order, the revealed cards simply moved to the bottom");
});

clause(ROSY, "1:rule", "my own deck is untouched by the trigger", () => {
  const game = rosyBoard();
  const mine = deckOf(game.engine, P1);
  rosyDie(game);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  answerPending(game.engine, "reorderDeck", { order: [1, 2, 3, 4].map((i) => game.id(`d${i}`)) });
  assert.deepEqual(deckOf(game.engine, P1), mine);
});

clause(ROSY, "1:rule", "with no character among the top 5 there is nothing to choose, and the 5 cards still go to the bottom in the opponent's order", () => {
  const game = rosyBoard({ deck: ["item", "tactic", "item", "tactic", "item", "char", "char", "item"] });
  rosyDie(game);
  const pc = pending(game.engine);
  if (pc && pc.kind === "chooserSelectsTarget") {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d5")] }), "the 6th card is not revealed");
    answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  }
  const reorder = expectPending(game.engine, "reorderDeck");
  assert.equal(reorder.playerId, P2);
  assert.equal((reorder.cardIds as string[]).length, 5);
  answerPending(game.engine, "reorderDeck", { order: [4, 3, 2, 1, 0].map((i) => game.id(`d${i}`)) });
  assert.deepEqual(deckOf(game.engine, P2).slice(0, 3), [game.id("d5"), game.id("d6"), game.id("d7")]);
  assert.equal(zoneOf(game.engine, game.id("d5")), "deck");
});

clause(ROSY, "1:rule", "an opponent with fewer than 5 cards: only those are revealed and offered, and the rest are reordered", () => {
  const game = rosyBoard({ deck: ["char", "item", "char"] });
  rosyDie(game);
  const revealed = revealedIds(game.engine);
  assert.ok(revealed.includes(game.id("d0")) && revealed.includes(game.id("d1")) && revealed.includes(game.id("d2")), "revealed.includes(game.id(\"d0\")) && revealed.includes(game.id(\"d1\")) && revealed.includes(game.id(\"d2\"))");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  assert.equal(zoneOf(game.engine, game.id("d2")), "play");
  const reorder = expectPending(game.engine, "reorderDeck");
  assert.deepEqual([...(reorder.cardIds as string[])].sort(), [game.id("d0"), game.id("d1")].sort());
  answerPending(game.engine, "reorderDeck", { order: [game.id("d1"), game.id("d0")] });
  assert.deepEqual(deckOf(game.engine, P2), [game.id("d1"), game.id("d0")]);
});

clause(ROSY, "1:rule", "an opponent with an empty deck: nothing is revealed, chosen or moved, and the game goes on", () => {
  const game = rosyBoard({ deck: [] });
  rosyDie(game);
  const pc = pending(game.engine);
  if (pc) answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
});

// --- what counts as 'destroyed' ---

clause(ROSY, "1:rule", "it triggers when Rosy is destroyed in BATTLE by lethal damage", () => {
  const game = rosyBoard({
    extra: [{ key: "bigAttacker", def: character({ name: "Big Attacker", cost: 3, strength: 9, life: 9, speed: 1 }), owner: P2, zone: "play" }],
    turn: 2,
    active: P2
  });
  declareAttackBy(game.engine, P2, [game.id("bigAttacker")]);
  declareBlockers(game.engine, P1, [game.id("rosy")]);
  autoResolveBattle(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard", "9 damage destroys a 4-life Rosy");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "Rosy's controller (me) chooses even on their turn");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  assert.equal(controllerOf(game.engine, game.id("d0")), P1);
});

clause(ROSY, "1:rule", "it triggers when Rosy is destroyed as non-battle damage reaches her life", () => {
  const burn = tactic({
    name: "Burn Five",
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 5 }] }] }
  });
  const game = rosyBoard({ extra: [{ key: "burn", def: burn, owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("burn"), { selected: { t: [game.id("rosy")] } });
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  expectPending(game.engine, "chooserSelectsTarget");
});

clause(ROSY, "1:rule", "it triggers when Rosy is destroyed as a COST (the picked character is destroyed to pay for a tactic)", () => {
  const game = rosyBoard();
  playRaw(game.engine, P1, game.id("sac"), { selected: { t: [game.id("rosy")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  expectPending(game.engine, "chooserSelectsTarget");
});

clause(ROSY, "1:rule", "it triggers when the opponent destroys her on their turn, and I (her controller) get the choice", () => {
  const game = rosyBoard({ extra: [{ key: "theirKill", def: destroyInPlayTactic(), owner: P2, zone: "hand" }], turn: 2, active: P2 });
  play(game.engine, P2, game.id("theirKill"), { selected: { t: [game.id("rosy")] } });
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
});

clause(ROSY, "1:rule", "it does NOT trigger when Rosy returns to hand, is removed from the game or is turned face-down (she was not destroyed)", () => {
  const bounced = rosyBoard();
  play(bounced.engine, P1, bounced.id("bounce"), { selected: { t: [bounced.id("rosy")] } });
  assert.equal(zoneOf(bounced.engine, bounced.id("rosy")), "hand");
  assert.equal(bounced.engine.state.pendingChoice, undefined, "bounced: no trigger");
  const removed = rosyBoard();
  play(removed.engine, P1, removed.id("remove"), { selected: { t: [removed.id("rosy")] } });
  assert.equal(zoneOf(removed.engine, removed.id("rosy")), "removed");
  assert.equal(removed.engine.state.pendingChoice, undefined, "removed from the game: no trigger");
  const flipped = rosyBoard();
  play(flipped.engine, P1, flipped.id("flip"), { selected: { t: [flipped.id("rosy")] } });
  assert.equal(flipped.engine.state.cards[flipped.id("rosy")].faceDown, true);
  assert.equal(flipped.engine.state.pendingChoice, undefined, "turned face-down: no trigger");
  for (const g of [bounced, removed, flipped]) assert.equal(deckOf(g.engine, P2).length, 8, "their deck is untouched");
  const control = rosyBoard();
  rosyDie(control);
  assert.equal(pending(control.engine)?.kind, "chooserSelectsTarget", "control: destroying her does trigger");
});

clause(ROSY, "1:rule", "another character being destroyed does not trigger Rosy's rule", () => {
  const game = rosyBoard({ extra: [{ key: "other", def: character({ name: "Other", cost: 1 }), owner: P1, zone: "play" }] });
  rosyDie(game, "other");
  assert.equal(zoneOf(game.engine, game.id("other")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "play");
  assert.equal(deckOf(game.engine, P2).length, 8);
});

clause(ROSY, "1:rule", "a Rosy destroyed while FACE-DOWN (a mere resource, CR 411.1) does not trigger", () => {
  const game = rosyBoard({ faceDown: true });
  rosyDie(game);
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  assert.equal(game.engine.state.pendingChoice, undefined, "a face-down card has no rules text");
  assert.equal(deckOf(game.engine, P2).length, 8);
});

clause(ROSY, "1:rule", "it is symmetrical: when the OPPONENT's Rosy is destroyed, THEY reveal the top 5 of MY deck and choose from it, and I reorder", () => {
  const game = rosyBoard({ controller: P2, owner: P2 });
  rosyDie(game);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2, "their Rosy: they choose");
  const revealed = revealedIds(game.engine);
  for (let i = 0; i < 5; i++) assert.ok(revealed.includes(game.id(`d${i}`)), `my d${i} is revealed`);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d2")] });
  assert.equal(controllerOf(game.engine, game.id("d2")), P2, "they put my card into play under THEIR control");
  assert.equal(game.engine.state.cards[game.id("d2")].ownerId, P1);
  const reorder = expectPending(game.engine, "reorderDeck");
  assert.equal(reorder.playerId, P1, "I order my own remaining cards");
  answerPending(game.engine, "reorderDeck", { order: [game.id("d3"), game.id("d0"), game.id("d4"), game.id("d1")] });
  assert.deepEqual(deckOf(game.engine, P1).slice(-4), [game.id("d3"), game.id("d0"), game.id("d4"), game.id("d1")]);
});

clause(ROSY, "1:rule", "'your opponent' is the Rosy's CONTROLLER's opponent: a Rosy I stole from them reveals THEIR deck when it dies, and goes to THEIR discard pile", () => {
  const game = rosyBoard({ owner: P2, controller: P1 });
  rosyDie(game);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I control it, so I choose");
  assert.ok(discardOf(game.engine, P2).includes(game.id("rosy")), "it goes to its owner's discard pile");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("d0")] });
  assert.equal(controllerOf(game.engine, game.id("d0")), P1);
  const reorder = expectPending(game.engine, "reorderDeck");
  assert.equal(reorder.playerId, P2);
});

clause(ROSY, "1:rule", "a character taken this way is a real card in play: it can attack the next turn and use its abilities for me", () => {
  const zapper = character({
    name: "Zapper",
    cost: 1,
    strength: 2,
    behavior: { abilities: [{ id: "zap", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const board = devBoard(
    [
      { key: "rosy", def: printing(ROSY), owner: P1, zone: "play" },
      { key: "kill", def: destroyInPlayTactic(), owner: P1, zone: "hand" },
      { key: "z", def: zapper, owner: P2, zone: "deck" },
      ...fillers("pad", 6, P2, "deck"),
      ...fillers("mine", 3, P1, "deck"),
      ...res({ deception: 4 })
    ],
    { random: lcg(3) }
  );
  play(board.engine, P1, board.id("kill"), { selected: { t: [board.id("rosy")] } });
  answerPending(board.engine, "chooserSelectsTarget", { selected: [board.id("z")] });
  answerPending(board.engine, "reorderDeck", { order: (pending(board.engine)!.cardIds as string[]).slice() });
  const hand = handOf(board.engine, P1).length;
  activate(board.engine, P1, board.id("z"), "zap");
  assert.equal(handOf(board.engine, P1).length, hand + 1, "the stolen character's ability works for me (abilities have no summoning sickness)");
});

clause(ROSY, "0:unique", "a Rosy destroyed by the UNIQUE rule is 'destroyed' too: her rule triggers for her controller", () => {
  const game = rosyBoard({ extra: [{ key: "rosy2", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 6 })] });
  play(game.engine, P1, game.id("rosy2"));
  // E11b: test corrected because the user's Q53 follow-up ruling says a NEW copy removed by UNIQUE never entered play, so
  // its destruction triggers nothing. The "destroyed by the UNIQUE rule" case that still triggers is the OLD copy, so keep the new one.
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("rosy2") });
  assert.equal(zoneOf(game.engine, game.id("rosy")), "discard");
  const pc = pending(game.engine);
  assert.ok(pc, "the destroyed old duplicate's trigger asks me to choose");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
});

clause(ROSY, "0:unique", "a NEW Rosy removed by the UNIQUE rule never entered play: her destruction rule does not trigger", () => {
  const game = rosyBoard({ extra: [{ key: "rosy2", def: printing(ROSY), owner: P1, zone: "hand" }, ...res({ deception: 6 })] });
  play(game.engine, P1, game.id("rosy2"));
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("rosy") });
  assert.equal(zoneOf(game.engine, game.id("rosy2")), "discard");
  assert.equal(pending(game.engine), undefined, "no destruction trigger for the new copy (Q53 follow-up)");
});

// =============================================================================
// Roundalicious Breasticles (Seed 2, Seed Saga) — Item, rogue, cost 2, [D][D]
//   At the end of your turn, put a token on this card.
//   JIGGLE JIGGLE — COST: Pay 2. EFFECT: Put a token on this card.
//   TANTALIZE — COST: Pick a character with numeric cost X or less, where X is
//     the number of tokens on this card. Destroy this card.
//     EFFECT: Take control of the character.
// =============================================================================

const BREAST = "e2e00e93-fcaa-4ef4-8f21-71d9306ed76b";
const BREAST_SAGA = "a77375e2-8ffa-4c67-b4eb-b4300b939a13";

interface RbOpts {
  printingId?: string;
  tokens?: number;
  zone?: Zone;
  faceDown?: boolean;
  owner?: PlayerId;
  controller?: PlayerId;
  /** Ready [D] resources for P1 (default 4). */
  deception?: number;
  spentDeception?: number;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * P1 owns the Breasticles "rb". Characters: P2's c0 (cost 0), c1 (cost 1), c2
 * (cost 2), c3 (cost 3), c5 (cost 5); P1's own m2 (cost 2).
 */
function rbBoard(opts: RbOpts = {}) {
  const owner = opts.owner ?? P1;
  const cost = (n: number) => ({ cost: n, strength: 2, life: 3, speed: 2 });
  return devBoard(
    [
      { key: "rb", def: printing(opts.printingId ?? BREAST), owner, controller: opts.controller ?? owner, zone: opts.zone ?? "play", faceDown: opts.faceDown, counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "c0", def: character({ name: "Cost Zero", ...cost(0) }), owner: P2, zone: "play", attackEligible: false },
      { key: "c1", def: character({ name: "Cost One", ...cost(1) }), owner: P2, zone: "play", attackEligible: false },
      { key: "c2", def: character({ name: "Cost Two", ...cost(2) }), owner: P2, zone: "play", attackEligible: false },
      { key: "c3", def: character({ name: "Cost Three", ...cost(3) }), owner: P2, zone: "play", attackEligible: false },
      { key: "c5", def: character({ name: "Cost Five", ...cost(5) }), owner: P2, zone: "play", attackEligible: false },
      { key: "m2", def: character({ name: "My Cost Two", ...cost(2) }), owner: P1, zone: "play" },
      ...res({ deception: opts.deception ?? 4 }),
      ...spent({ deception: opts.spentDeception ?? 0 }),
      ...fillers("dk", 3, P1, "deck"),
      ...fillers("odk", 3, P2, "deck"),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}
type RbGame = ReturnType<typeof rbBoard>;

const jiggle = (game: RbGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("rb"), "jiggle-jiggle");
const tantalize = (game: RbGame, pick: string, player: PlayerId = P1) => actRaw(game.engine, player, game.id("rb"), "tantalize", { c: [game.id(pick)] });

// --- At the end of your turn, put a token on this card ---

const rbEndTurnBody = (printingId: string) => () => {
  const game = rbBoard({ printingId });
  assert.equal(tokensOn(game.engine, game.id("rb")), 0);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1, "one token after my turn ended");
};
clause(BREAST, "0:rule", "at the end of my turn a token is put on it", rbEndTurnBody(BREAST));
clause(BREAST_SAGA, "0:rule", "the Seed Saga printing: at the end of my turn a token is put on it", rbEndTurnBody(BREAST_SAGA));

clause(BREAST, "0:rule", "one token per turn: after three of my turns it has three tokens", () => {
  const game = rbBoard();
  for (let turn = 1; turn <= 3; turn++) {
    endTurn(game.engine, P1);
    endTurn(game.engine, P2);
    assert.equal(tokensOn(game.engine, game.id("rb")), turn, `after my turn ${turn}`);
  }
});

clause(BREAST, "0:rule", "no token at the end of the OPPONENT's turn", () => {
  const game = rbBoard({ turn: 2, active: P2 });
  endTurn(game.engine, P2);
  assert.equal(game.engine.state.activePlayerId, P1);
  assert.equal(tokensOn(game.engine, game.id("rb")), 0, "their turn ending gives me nothing");
});

clause(BREAST, "0:rule", "the token arrives when the turn ACTUALLY ends (CR 610.1a), after the opponent's chance to respond: not while the end-of-turn window is still open", () => {
  const game = rbBoard();
  game.engine.perform({ type: "endTurn", playerId: P1 });
  assert.ok(game.engine.state.responseWindow, "the opponent may respond to the end of my turn");
  assert.equal(game.engine.state.activePlayerId, P1, "it is still my turn");
  assert.equal(tokensOn(game.engine, game.id("rb")), 0, "no token yet: the turn has not actually ended");
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1, "the token arrives as the turn ends");
});

clause(BREAST, "0:rule", "a Breasticles that was bounced in response to the end of my turn gets no token (it is not in play when the turn ends)", () => {
  const bounce = bounceInPlayTactic();
  const game = rbBoard({ extra: [{ key: "bounce", def: bounce, owner: P2, zone: "hand" }] });
  game.engine.perform({ type: "endTurn", playerId: P1 });
  playRaw(game.engine, P2, game.id("bounce"), { selected: { t: [game.id("rb")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rb")), "hand");
  assert.equal(tokensOn(game.engine, game.id("rb")), 0, "no token for a card that is not in play");
});

clause(BREAST, "0:rule", "each Breasticles I control gets its own token at the end of my turn", () => {
  const game = rbBoard({ extra: [{ key: "rb2", def: printing(BREAST), owner: P1, zone: "play", counters: { token: 2 } }] });
  endTurn(game.engine, P1);
  maybeOrder(game.engine);
  resolvePendingResponses(game.engine);
  settleStartFirst(game.engine); // the opponent's turn start
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1);
  assert.equal(tokensOn(game.engine, game.id("rb2")), 3);
});

clause(BREAST, "0:rule", "it only works in play: in hand, in the discard pile, or face-down it gets no token", () => {
  for (const [zone, faceDown] of [["hand", false], ["discard", false], ["play", true]] as const) {
    const game = rbBoard({ zone, faceDown });
    endTurn(game.engine, P1);
    assert.equal(tokensOn(game.engine, game.id("rb")), 0, `${zone}${faceDown ? " face-down" : ""}`);
  }
});

clause(BREAST, "0:rule", "'your turn' is its controller's: a Breasticles under the opponent's control gets its token at the end of THEIR turn, not mine", () => {
  const mine = rbBoard({ owner: P1, controller: P2 });
  endTurn(mine.engine, P1);
  assert.equal(tokensOn(mine.engine, mine.id("rb")), 0, "my turn ending: it is theirs now");
  endTurn(mine.engine, P2);
  assert.equal(tokensOn(mine.engine, mine.id("rb")), 1, "their turn ending: their token");
});

clause(BREAST, "0:rule", "the token shows on the card as a counter named 'token', adding to tokens already there", () => {
  const game = rbBoard({ tokens: 3 });
  endTurn(game.engine, P1);
  assert.equal(tokensOn(game.engine, game.id("rb")), 4);
});

// --- JIGGLE JIGGLE: COST Pay 2. EFFECT Put a token on this card. ---

clause(BREAST, "1:ability:jiggle-jiggle", "pays exactly 2 resources when used (before the opponent can respond), then puts a token on the Breasticles", () => {
  const game = rbBoard();
  const before = ready(game.engine);
  jiggle(game);
  assert.equal(before - ready(game.engine), 2, "2 resources are paid as the cost");
  assert.equal(tokensOn(game.engine, game.id("rb")), 0, "the token comes when the ability resolves");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1);
  assert.equal(before - ready(game.engine), 2, "nothing more was paid");
});

clause(BREAST_SAGA, "1:ability:jiggle-jiggle", "the Seed Saga printing: pays exactly 2 and puts a token on it", () => {
  const game = rbBoard({ printingId: BREAST_SAGA });
  const before = ready(game.engine);
  jiggle(game);
  resolvePendingResponses(game.engine);
  assert.equal(before - ready(game.engine), 2);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1);
});

clause(BREAST, "1:ability:jiggle-jiggle", "is refused with only 1 resource, and nothing is paid", () => {
  const bad = rbBoard({ deception: 1 });
  refused(() => jiggle(bad), "one resource short of 2");
  assert.equal(ready(bad.engine), 1);
  assert.equal(tokensOn(bad.engine, bad.id("rb")), 0);
  assert.equal(bad.engine.state.responseWindow, undefined, "nothing was put on the stack");
});

clause(BREAST, "1:ability:jiggle-jiggle", "spent (attached) resources cannot pay the 2", () => {
  const bad = rbBoard({ deception: 1, spentDeception: 3 });
  refused(() => jiggle(bad), "only 1 ready resource");
  assert.equal(tokensOn(bad.engine, bad.id("rb")), 0);
  const good = rbBoard({ deception: 2, spentDeception: 3 });
  jiggle(good);
  resolvePendingResponses(good.engine);
  assert.equal(tokensOn(good.engine, good.id("rb")), 1, "control: 2 ready resources are enough");
});

clause(BREAST, "1:ability:jiggle-jiggle", "may be used repeatedly while resources last: 4 resources give 2 tokens, a third use is refused", () => {
  const game = rbBoard({ deception: 4 });
  jiggle(game);
  resolvePendingResponses(game.engine);
  jiggle(game);
  resolvePendingResponses(game.engine);
  assert.equal(tokensOn(game.engine, game.id("rb")), 2);
  assert.equal(ready(game.engine), 0);
  refused(() => jiggle(game), "no resources left");
  assert.equal(tokensOn(game.engine, game.id("rb")), 2);
});

clause(BREAST, "1:ability:jiggle-jiggle", "adds to tokens already on it, and does not deplete or destroy the Breasticles", () => {
  const game = rbBoard({ tokens: 2 });
  jiggle(game);
  resolvePendingResponses(game.engine);
  assert.equal(tokensOn(game.engine, game.id("rb")), 3);
  assert.equal(isDepleted(game.engine, game.id("rb")), false);
  assert.equal(zoneOf(game.engine, game.id("rb")), "play");
});

clause(BREAST, "1:ability:jiggle-jiggle", "can be used in response on the opponent's turn", () => {
  const game = rbBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  jiggle(game);
  resolvePendingResponses(game.engine);
  assert.equal(tokensOn(game.engine, game.id("rb")), 1);
});

clause(BREAST, "1:ability:jiggle-jiggle", "only its controller can use it, and only while it is in play face-up", () => {
  const opp = rbBoard();
  refused(() => jiggle(opp, P2), "the opponent does not control it");
  const hand = rbBoard({ zone: "hand" });
  refused(() => jiggle(hand), "in hand");
  const down = rbBoard({ faceDown: true });
  refused(() => jiggle(down), "face-down");
  assert.equal(tokensOn(opp.engine, opp.id("rb")), 0);
});

// --- TANTALIZE ---

clause(BREAST, "2:ability:tantalize", "with 3 tokens it can pick a character of cost 3 or less: the Breasticles is destroyed as the cost, and I take control of the character", () => {
  const game = rbBoard({ tokens: 3 });
  tantalize(game, "c3");
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard", "destroyed as a cost, before any response");
  assert.equal(controllerOf(game.engine, game.id("c3")), P2, "not taken yet: the effect has not resolved");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("c3")), P1, "now it is mine");
  assert.equal(zoneOf(game.engine, game.id("c3")), "play");
  assert.equal(game.engine.state.cards[game.id("c3")].ownerId, P2, "ownership never changes");
  assert.ok(playOf(game.engine, P1).includes(game.id("c3")), "playOf(game.engine, P1).includes(game.id(\"c3\"))");
  assert.equal(playOf(game.engine, P2).includes(game.id("c3")), false);
});

clause(BREAST_SAGA, "2:ability:tantalize", "the Seed Saga printing: with 2 tokens it takes control of a cost-2 character and is destroyed", () => {
  const game = rbBoard({ printingId: BREAST_SAGA, tokens: 2 });
  tantalize(game, "c2");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard");
  assert.equal(controllerOf(game.engine, game.id("c2")), P1);
});

clause(BREAST, "2:ability:tantalize", "X is the number of tokens: with 2 tokens a cost-2 character can be picked, and a cost-3 character cannot", () => {
  const bad = rbBoard({ tokens: 2 });
  refused(() => tantalize(bad, "c3"), "cost 3 is more than 2 tokens");
  assert.equal(zoneOf(bad.engine, bad.id("rb")), "play", "nothing destroyed");
  assert.equal(controllerOf(bad.engine, bad.id("c3")), P2);
  const good = rbBoard({ tokens: 2 });
  tantalize(good, "c2");
  resolvePendingResponses(good.engine);
  assert.equal(controllerOf(good.engine, good.id("c2")), P1);
});

clause(BREAST, "2:ability:tantalize", "'cost X or less' includes cheaper characters: with 3 tokens a cost-0, cost-1 and cost-2 character can all be picked", () => {
  for (const key of ["c0", "c1", "c2"]) {
    const game = rbBoard({ tokens: 3 });
    tantalize(game, key);
    resolvePendingResponses(game.engine);
    assert.equal(controllerOf(game.engine, game.id(key)), P1, `${key} can be taken with 3 tokens`);
  }
});

clause(BREAST, "2:ability:tantalize", "with no tokens only a cost-0 character can be picked", () => {
  const bad = rbBoard({ tokens: 0 });
  refused(() => tantalize(bad, "c1"), "cost 1 with 0 tokens");
  refused(() => tantalize(bad, "c5"), "cost 5 with 0 tokens");
  assert.equal(zoneOf(bad.engine, bad.id("rb")), "play");
  const good = rbBoard({ tokens: 0 });
  tantalize(good, "c0");
  resolvePendingResponses(good.engine);
  assert.equal(controllerOf(good.engine, good.id("c0")), P1, "cost 0 <= 0 tokens");
});

clause(BREAST, "2:ability:tantalize", "no cost-5 character can be picked with 4 tokens, but one can with 5", () => {
  const bad = rbBoard({ tokens: 4 });
  refused(() => tantalize(bad, "c5"), "5 > 4");
  const good = rbBoard({ tokens: 5 });
  tantalize(good, "c5");
  resolvePendingResponses(good.engine);
  assert.equal(controllerOf(good.engine, good.id("c5")), P1);
});

clause(BREAST, "2:ability:tantalize", "the tokens are counted live: JIGGLE JIGGLE raises the limit by one", () => {
  const game = rbBoard({ tokens: 2 });
  refused(() => tantalize(game, "c3"), "cost 3 with 2 tokens");
  jiggle(game);
  resolvePendingResponses(game.engine);
  tantalize(game, "c3");
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("c3")), P1, "cost 3 with 3 tokens");
});

clause(BREAST, "2:ability:tantalize", "the pick must be a character in play: an item, a location, a faction or a face-down card is refused", () => {
  const extra = [
    { key: "gadget", def: item({ name: "Gadget", cost: 0 }), owner: P2, zone: "play" as const },
    { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" as const },
    { key: "fdown", def: character({ name: "Face Down Foe", cost: 0 }), owner: P2, zone: "play" as const, faceDown: true },
    { key: "inDiscard", def: character({ name: "Dead Foe", cost: 0 }), owner: P2, zone: "discard" as const },
    { key: "inHand", def: character({ name: "Hidden Foe", cost: 0 }), owner: P2, zone: "hand" as const }
  ];
  for (const key of ["gadget", "place", "fdown", "inDiscard", "inHand"]) {
    const bad = rbBoard({ tokens: 5, extra });
    refused(() => tantalize(bad, key), `${key} is not a character in play`);
    assert.equal(zoneOf(bad.engine, bad.id("rb")), "play", `${key}: the Breasticles is not destroyed`);
  }
  const faction = rbBoard({ tokens: 5 });
  refused(() => actRaw(faction.engine, P1, faction.id("rb"), "tantalize", { c: [faction.engine.state.players[P2].factionId!] }), "a faction");
  assert.equal(zoneOf(faction.engine, faction.id("rb")), "play");
});

clause(BREAST, "2:ability:tantalize", "exactly one character must be picked: none and two are refused", () => {
  const bad = rbBoard({ tokens: 5 });
  refused(() => actRaw(bad.engine, P1, bad.id("rb"), "tantalize", { c: [] }), "no pick");
  refused(() => actRaw(bad.engine, P1, bad.id("rb"), "tantalize", {}), "no declaration");
  refused(() => actRaw(bad.engine, P1, bad.id("rb"), "tantalize", { c: [bad.id("c1"), bad.id("c2")] }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("rb")), "play");
});

clause(BREAST, "2:ability:tantalize", "my own character can be picked too ('a character'), and taking control of it changes nothing", () => {
  const game = rbBoard({ tokens: 2 });
  tantalize(game, "m2");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard");
  assert.equal(controllerOf(game.engine, game.id("m2")), P1);
  assert.equal(zoneOf(game.engine, game.id("m2")), "play");
});

clause(BREAST, "2:ability:tantalize", "no resources are needed: the cost is only destroying the Breasticles", () => {
  const game = rbBoard({ tokens: 2, deception: 0 });
  tantalize(game, "c2");
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("c2")), P1);
});

clause(BREAST, "2:ability:tantalize", "the taken control is permanent: the character is still mine two turns later", () => {
  const game = rbBoard({ tokens: 3 });
  tantalize(game, "c3");
  resolvePendingResponses(game.engine);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  endTurn(game.engine, P1);
  assert.equal(controllerOf(game.engine, game.id("c3")), P1, "control did not revert");
  assert.equal(zoneOf(game.engine, game.id("c3")), "play");
});

clause(BREAST, "2:ability:tantalize", "a character taken this turn can't attack this turn (CR 204.3), but can the next turn it started in my control", () => {
  const game = rbBoard({ tokens: 3 });
  tantalize(game, "c3");
  resolvePendingResponses(game.engine);
  refused(() => declareAttackBy(game.engine, P1, [game.id("c3")]), "not under my control since the start of the turn");
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  declareAttackBy(game.engine, P1, [game.id("c3")]);
  assert.ok(battleOf(game.engine), "next turn it attacks for me");
});

clause(BREAST, "2:ability:tantalize", "the Breasticles is destroyed (to my discard pile) even though the character is taken: I keep nothing of it", () => {
  const game = rbBoard({ tokens: 1, extra: [] });
  tantalize(game, "c1");
  resolvePendingResponses(game.engine);
  assert.ok(discardOf(game.engine, P1).includes(game.id("rb")), "discardOf(game.engine, P1).includes(game.id(\"rb\"))");
  assert.equal(playOf(game.engine, P1).includes(game.id("rb")), false);
});

clause(BREAST, "2:ability:tantalize", "if the picked character leaves play in response, nothing happens to anyone else and the cost stays paid", () => {
  const game = rbBoard({ tokens: 3, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  tantalize(game, "c3");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("c3")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("c3")), "discard");
  assert.equal(zoneOf(game.engine, game.id("rb")), "discard", "the Breasticles was destroyed as a cost");
  assert.equal(controllerOf(game.engine, game.id("c2")), P2, "no other character is affected");
  assert.equal(controllerOf(game.engine, game.id("c1")), P2);
});

clause(BREAST, "2:ability:tantalize", "only its controller can use it, and only in play face-up", () => {
  const opp = rbBoard({ tokens: 3 });
  refused(() => tantalize(opp, "c1", P2), "the opponent does not control it");
  const hand = rbBoard({ tokens: 3, zone: "hand" });
  refused(() => tantalize(hand, "c1"), "in hand");
  const down = rbBoard({ tokens: 3, faceDown: true });
  refused(() => tantalize(down, "c1"), "face-down");
});

clause(BREAST, "2:ability:tantalize", "it can be used in response on the opponent's turn", () => {
  const game = rbBoard({ tokens: 3, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  tantalize(game, "c3");
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("c3")), P1);
});

clause(BREAST, "0:rule", "tokens vanish when it leaves play (CR 409.2): bounced with 3 tokens and deployed again, it has none", () => {
  const game = rbBoard({ tokens: 3, extra: [{ key: "bounce", def: bounceInPlayTactic(), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("rb")] } });
  assert.equal(zoneOf(game.engine, game.id("rb")), "hand");
  play(game.engine, P1, game.id("rb"));
  assert.equal(zoneOf(game.engine, game.id("rb")), "play");
  assert.equal(tokensOn(game.engine, game.id("rb")), 0, "the tokens disappeared when it left play");
});

clause(BREAST, "0:rule", "it deploys as a cost-2 [D][D] item: refused one short, refused without [D][D], and paid exactly 2", () => {
  const board = (icons: Icons) => devBoard([{ key: "rb", def: printing(BREAST), owner: P1, zone: "hand" }, ...res(icons)]);
  const good = board({ deception: 2 });
  play(good.engine, P1, good.id("rb"));
  assert.equal(zoneOf(good.engine, good.id("rb")), "play");
  assert.equal(ready(good.engine), 0, "exactly 2 paid");
  // [D][D] met by already-spent Deception, so only the cost (1 ready of 2) can refuse
  const short = devBoard([{ key: "rb", def: printing(BREAST), owner: P1, zone: "hand" }, ...res({ rage: 1 }), ...spent({ deception: 2 })]);
  refused(() => playRaw(short.engine, P1, short.id("rb")), "one short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const wrong = board({ rage: 5 });
  refused(() => playRaw(wrong.engine, P1, wrong.id("rb")), "no [D]", /Threshold requirements are not met/);
  const one = board({ deception: 1, rage: 4 });
  refused(() => playRaw(one.engine, P1, one.id("rb")), "only one [D]", /Threshold requirements are not met/);
});

// =============================================================================
// Rusty Pickaxe (Seed 2) — Item, rogue, gear, cost 1, [D]
//   ATTACH TO CHARACTER
//   The attached character gains 1 strength and 1 life.
//   If this card is destroyed, flip it face-down under its owner's control instead.
//   FLIP UP: 1 [D]
// =============================================================================

const AXE = "0b3b61aa-3ea4-4acc-8f76-c6242af992e0";

interface AxeOpts {
  zone?: Zone;
  faceDown?: boolean;
  /** The pickaxe is in play attached to "host". */
  attached?: boolean;
  /** Ready [D] resources for P1 (default 1). */
  deception?: number;
  rage?: number;
  /** Spent [D] resources (meet thresholds, cannot pay). */
  spentDeception?: number;
  /** The pickaxe is a spent (attached to faction) face-down resource. */
  spentFaceDown?: boolean;
  chars?: boolean;
  owner?: PlayerId;
  controller?: PlayerId;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * The Pickaxe "axe" (P1's by default). Characters: P1's host (3/4/2) and
 * host2 (1/1/1); P2's foe (2/3/2).
 */
function axeBoard(opts: AxeOpts = {}) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      {
        key: "axe",
        def: printing(AXE),
        owner,
        controller: opts.controller ?? owner,
        zone: opts.zone ?? (opts.attached || opts.faceDown ? "play" : "hand"),
        faceDown: opts.faceDown,
        attachedToKey: opts.attached ? "host" : opts.spentFaceDown ? (owner === P1 ? "__factionA" : "__factionB") : undefined
      },
      ...(opts.chars === false
        ? []
        : [
            { key: "host", def: character({ name: "Host", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "host2", def: character({ name: "Second Host", strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" as const }
          ]),
      ...res({ deception: opts.deception ?? 1, rage: opts.rage ?? 0 }),
      ...spent({ deception: opts.spentDeception ?? 0 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}
type AxeGame = ReturnType<typeof axeBoard>;

const axeDeploy = (game: AxeGame, hostKey = "host") => playRaw(game.engine, P1, game.id("axe"), { selected: { attachTo: [game.id(hostKey)] } });
const axeAttachedTo = (game: AxeGame): CardInstanceId | undefined => game.engine.state.cards[game.id("axe")].attachedTo;
const axeFlip = (game: AxeGame, hostKey = "host", player: PlayerId = P1) => flipUpRaw(game.engine, player, game.id("axe"), { attachTo: [game.id(hostKey)] });
const axeCard = (game: AxeGame) => game.engine.state.cards[game.id("axe")];

// --- 0:attach — ATTACH TO CHARACTER (CR 507.2) ---

clause(AXE, "0:attach", "picking my character is the first extra cost: the Pickaxe pays exactly its cost of 1 and enters play attached to that character", () => {
  const game = axeBoard();
  const before = ready(game.engine);
  axeDeploy(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(axeAttachedTo(game), game.id("host"));
  assert.equal(before - ready(game.engine), 1, "exactly the printed cost");
});

clause(AXE, "0:attach", "it attaches to the character that was picked, not to another one", () => {
  const game = axeBoard();
  axeDeploy(game, "host2");
  resolvePendingResponses(game.engine);
  assert.equal(axeAttachedTo(game), game.id("host2"));
  assert.notEqual(axeAttachedTo(game), game.id("host"));
});

clause(AXE, "0:attach", "any character may be picked, including the opponent's: the Pickaxe is mine but attached to their character", () => {
  const game = axeBoard();
  axeDeploy(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(axeAttachedTo(game), game.id("foe"));
  assert.equal(controllerOf(game.engine, game.id("axe")), P1);
});

clause(AXE, "0:attach", "while it is being deployed (response window open) it is not attached or in play yet", () => {
  const game = axeBoard();
  axeDeploy(game);
  assert.equal(zoneOf(game.engine, game.id("axe")), "deploying");
  assert.equal(game.engine.state.priorityPlayerId, P2);
  assert.deepEqual(stats(game.engine, game.id("host")), [3, 4, 2], "no bonus yet");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
});

clause(AXE, "0:attach", "refused one resource short of its cost of 1, and nothing is attached", () => {
  const bad = axeBoard({ deception: 0, spentDeception: 1 });
  refused(() => axeDeploy(bad), "no ready resource");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
  assert.equal(axeAttachedTo(bad), undefined);
});

clause(AXE, "0:attach", "refused without its [D] threshold, however many other resources there are", () => {
  const bad = axeBoard({ deception: 0, rage: 5 });
  refused(() => axeDeploy(bad), "no [D]");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
  assert.equal(ready(bad.engine), 5, "nothing paid");
});

clause(AXE, "0:attach", "spent [D] meets the threshold while a ready resource of any kind pays the 1", () => {
  const game = axeBoard({ deception: 0, rage: 1, spentDeception: 1 });
  axeDeploy(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(AXE, "0:attach", "it can only be deployed on its controller's turn (an item is not a tactic)", () => {
  const bad = axeBoard({ turn: 2, active: P2 });
  refused(() => axeDeploy(bad), "the opponent's turn");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
  const good = axeBoard();
  axeDeploy(good);
  resolvePendingResponses(good.engine);
  assert.equal(zoneOf(good.engine, good.id("axe")), "play", "control: my turn works");
});

clause(AXE, "0:attach", "it cannot attach to an item, a location, a resource, a face-down card, or a character in a hand or discard pile", () => {
  const extra = [
    { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" as const },
    { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" as const },
    { key: "resCard", def: resourceCard({ name: "Res" }), owner: P1, zone: "play" as const },
    { key: "fd", def: character({ name: "Face Down" }), owner: P1, zone: "play" as const, faceDown: true },
    { key: "inHand", def: character({ name: "In Hand" }), owner: P1, zone: "hand" as const },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P1, zone: "discard" as const }
  ];
  for (const key of ["thing", "place", "resCard", "fd", "inHand", "inDiscard"]) {
    const bad = axeBoard({ extra });
    const before = ready(bad.engine);
    refused(() => axeDeploy(bad, key), `attaching to ${key}`);
    assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
    assert.equal(ready(bad.engine), before, "nothing paid");
  }
});

clause(AXE, "0:attach", "it cannot attach to a faction", () => {
  const bad = axeBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: { attachTo: [bad.engine.state.players[P2].factionId!] } }), "their faction");
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: { attachTo: [bad.engine.state.players[P1].factionId!] } }), "my faction");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
});

clause(AXE, "0:attach", "exactly one character must be picked: none and two are refused", () => {
  const bad = axeBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: { attachTo: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: {} }), "no declaration");
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: { attachTo: [bad.id("host"), bad.id("host2")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
  assert.equal(ready(bad.engine), 1);
});

clause(AXE, "0:attach", "with no character in play there is nothing to attach to: it cannot be deployed", () => {
  const bad = axeBoard({ chars: false });
  refused(() => playRaw(bad.engine, P1, bad.id("axe"), { selected: {} }), "no characters at all");
  assert.equal(zoneOf(bad.engine, bad.id("axe")), "hand");
  assert.equal(ready(bad.engine), 1);
});

clause(AXE, "0:attach", "if the host leaves play before the Pickaxe resolves (destroyed in response) the Pickaxe goes to its owner's discard pile instead of entering play (CR 507.2c)", () => {
  const game = axeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  axeDeploy(game);
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("host")] } });
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("host")), "discard");
  assert.equal(zoneOf(game.engine, game.id("axe")), "discard", "not in play, not stuck in 'deploying'");
  assert.ok(discardOf(game.engine, P1).includes(game.id("axe")), "discardOf(game.engine, P1).includes(game.id(\"axe\"))");
});

clause(AXE, "0:attach", "when the host is destroyed the Pickaxe is destroyed with it (CR 301.4), and so its own replacement flips it face-down under my control", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  assert.equal(axeAttachedTo(game), game.id("host"));
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "discard");
  assert.equal(zoneOf(game.engine, game.id("axe")), "play", "it was destroyed, so it was flipped face-down instead");
  assert.equal(axeCard(game).faceDown, true);
  assert.equal(controllerOf(game.engine, game.id("axe")), P1);
  assert.equal(zoneOf(game.engine, game.id("host2")), "play", "other characters are untouched");
});

clause(AXE, "0:attach", "when the host is returned to its owner's hand the Pickaxe leaves play the same way: into its OWNER's hand (CR 301.4 / 301.4a)", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "bounce", def: bounceInPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "hand");
  assert.equal(zoneOf(game.engine, game.id("axe")), "hand", "the attached card follows its host to the hand");
});

clause(AXE, "0:attach", "when the host is removed from the game the Pickaxe is removed from the game too (CR 301.4a)", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "remove", def: removeAnyTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("remove"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "removed");
  assert.equal(zoneOf(game.engine, game.id("axe")), "removed");
});

clause(AXE, "0:attach", "a Pickaxe of mine attached to the OPPONENT's character that is destroyed is flipped face-down under MY control (its owner's)", () => {
  const game = axeBoard({ extra: [{ key: "kill", def: killTactic(), owner: P1, zone: "hand" }] });
  axeDeploy(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(axeAttachedTo(game), game.id("foe"));
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("foe")] } });
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard");
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(axeCard(game).faceDown, true);
  assert.equal(controllerOf(game.engine, game.id("axe")), P1, "my card, my resource");
});

clause(AXE, "0:attach", "if the host stops being a character (an animated item whose animation ends) the Pickaxe is flipped face-down with it immediately, and flipped face-down", () => {
  const animate = tactic({
    name: "Animate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "an",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "setCardType", target: { type: "selected", id: "t" }, cardType: "character", grantStats: { strength: 1, life: 3, speed: 1 }, duration: { type: "untilEndOfTurn" } }]
        }
      ]
    }
  });
  const game = axeBoard({
    extra: [
      { key: "statue", def: item({ name: "Statue", cost: 0 }), owner: P1, zone: "play" },
      { key: "animate", def: animate, owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("animate"), { selected: { t: [game.id("statue")] } });
  axeDeploy(game, "statue");
  resolvePendingResponses(game.engine);
  assert.equal(axeAttachedTo(game), game.id("statue"), "the animated statue is a character: it can be the host");
  endTurn(game.engine, P1);
  assert.equal(zoneOf(game.engine, game.id("statue")), "play", "the statue is still there, but an item again");
  assert.notEqual(axeAttachedTo(game), game.id("statue"), "the Pickaxe is no longer attached to a non-character");
  assert.ok(axeCard(game).zone === "play" && axeCard(game).faceDown, "destroyed, so flipped face-down");
});

clause(AXE, "0:attach", "put into play by an effect (not deployed) with no target specified, I pick a character as it enters and it enters play attached to it (CR 507.2b)", () => {
  const reanimate = tactic({
    name: "Reanimate",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "re",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "discard", owner: "self" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const game = axeBoard({
    zone: "discard",
    extra: [{ key: "re", def: reanimate, owner: P1, zone: "hand" }]
  });
  playRaw(game.engine, P1, game.id("re"), { selected: { t: [game.id("axe")] } });
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  if (pc) {
    assert.equal(pc.kind, "chooserSelectsTarget");
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("host")] });
  }
  assert.equal(zoneOf(game.engine, game.id("axe")), "play", "it is in play, not sent back to the discard pile");
  assert.equal(axeAttachedTo(game), game.id("host"));
});

// --- 1:rule — The attached character gains 1 strength and 1 life ---

clause(AXE, "1:rule", "the host gains 1 strength and 1 life (3/4/2 becomes 4/5/2), speed unchanged", () => {
  const game = axeBoard({ attached: true });
  assert.deepEqual(stats(game.engine, game.id("host")), [4, 5, 2]);
});

clause(AXE, "1:rule", "the bonus is exactly +1/+1: a 1/1/1 character becomes 2/2/1", () => {
  const game = axeBoard();
  axeDeploy(game, "host2");
  resolvePendingResponses(game.engine);
  assert.deepEqual(stats(game.engine, game.id("host2")), [2, 2, 1]);
});

clause(AXE, "1:rule", "the bonus goes to the attached character only: other characters, mine and theirs, are unchanged", () => {
  const game = axeBoard({ attached: true });
  assert.deepEqual(stats(game.engine, game.id("host2")), [1, 1, 1]);
  assert.deepEqual(stats(game.engine, game.id("foe")), [2, 3, 2]);
});

clause(AXE, "1:rule", "attached to the OPPONENT's character it buffs that character (the controller of the Pickaxe does not matter)", () => {
  const game = axeBoard();
  axeDeploy(game, "foe");
  resolvePendingResponses(game.engine);
  assert.deepEqual(stats(game.engine, game.id("foe")), [3, 4, 2]);
  assert.deepEqual(stats(game.engine, game.id("host")), [3, 4, 2]);
});

clause(AXE, "1:rule", "two Pickaxes on one character stack: +2 strength and +2 life", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "axe2", def: printing(AXE), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.deepEqual(stats(game.engine, game.id("host")), [5, 6, 2]);
});

clause(AXE, "1:rule", "the bonus is real in battle: 4 strength deals 4 to the faction instead of 3", () => {
  const plain = axeBoard();
  declareAttackBy(plain.engine, P1, [plain.id("host")]);
  declareBlockers(plain.engine, P2, []);
  autoResolveBattle(plain.engine);
  assert.equal(influenceOf(plain.engine, P2), START - 3, "control: 3 strength");
  const armed = axeBoard({ attached: true });
  declareAttackBy(armed.engine, P1, [armed.id("host")]);
  declareBlockers(armed.engine, P2, []);
  autoResolveBattle(armed.engine);
  assert.equal(influenceOf(armed.engine, P2), START - 4, "4 strength");
});

clause(AXE, "1:rule", "the extra life is real: 4 damage destroys a plain 3/4 host only at 4, and a Pickaxe host survives 4 damage", () => {
  const burn = (amount: number) =>
    tactic({
      name: `Burn ${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "burn", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  const armed = axeBoard({ attached: true, extra: [{ key: "burn", def: burn(4), owner: P1, zone: "hand" }] });
  play(armed.engine, P1, armed.id("burn"), { selected: { t: [armed.id("host")] } });
  assert.equal(zoneOf(armed.engine, armed.id("host")), "play", "5 life survives 4 damage");
  const plain = axeBoard({ extra: [{ key: "burn", def: burn(4), owner: P1, zone: "hand" }] });
  play(plain.engine, P1, plain.id("burn"), { selected: { t: [plain.id("host")] } });
  assert.equal(zoneOf(plain.engine, plain.id("host")), "discard", "control: 4 life dies to 4 damage");
});

clause(AXE, "1:rule", "the bonus ends when the Pickaxe is gone: a host with 4 damage and 5 life dies when the Pickaxe is removed", () => {
  const burn = tactic({
    name: "Burn 4",
    cost: 0,
    behavior: { abilities: [{ id: "burn", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 4 }] }] }
  });
  const game = axeBoard({
    attached: true,
    extra: [
      { key: "burn", def: burn, owner: P1, zone: "hand" },
      { key: "remove", def: removeAnyTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("burn"), { selected: { t: [game.id("host")] } });
  assert.equal(zoneOf(game.engine, game.id("host")), "play");
  play(game.engine, P1, game.id("remove"), { selected: { t: [game.id("axe")] } });
  assert.equal(zoneOf(game.engine, game.id("axe")), "removed");
  assert.equal(game.engine.getStat(game.id("host"), "life"), 4, "the +1 life is gone");
  assert.equal(zoneOf(game.engine, game.id("host")), "discard", "4 damage now equals its 4 life");
});

clause(AXE, "1:rule", "a Pickaxe in hand, or face-down, gives no bonus", () => {
  const hand = axeBoard();
  assert.deepEqual(stats(hand.engine, hand.id("host")), [3, 4, 2]);
  const down = axeBoard({ faceDown: true });
  assert.deepEqual(stats(down.engine, down.id("host")), [3, 4, 2]);
});

// --- 2:rule — If this card is destroyed, flip it face-down under its owner's control instead ---

clause(AXE, "2:rule", "destroyed by a destroy effect, it stays in play but face-down, as a resource under my control, instead of going to the discard pile", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("axe")] } });
  assert.equal(zoneOf(game.engine, game.id("axe")), "play", "not in the discard pile");
  assert.equal(axeCard(game).faceDown, true, "flipped face-down");
  assert.equal(controllerOf(game.engine, game.id("axe")), P1, "under its owner's control");
  assert.equal(discardOf(game.engine, P1).includes(game.id("axe")), false);
  assert.ok(playOf(game.engine, P1).includes(game.id("axe")), "playOf(game.engine, P1).includes(game.id(\"axe\"))");
});

clause(AXE, "2:rule", "it comes back as a fresh resource: no longer attached to the character, ready to pay, providing Volition", () => {
  const game = axeBoard({ attached: true, extra: [{ key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  const readyBefore = ready(game.engine);
  const volBefore = icons(game.engine, P1).volition ?? 0;
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("axe")] } });
  assert.notEqual(axeAttachedTo(game), game.id("host"), "no longer attached to the host");
  assert.equal(ready(game.engine), readyBefore + 1, "one more ready resource");
  assert.equal(icons(game.engine, P1).volition ?? 0, volBefore + 1, "providing one Volition");
  assert.deepEqual(stats(game.engine, game.id("host")), [3, 4, 2], "the host lost the bonus");
});

clause(AXE, "2:rule", "the owner's control: a Pickaxe the opponent controls (but I own) destroyed goes face-down under MY control", () => {
  const game = axeBoard({ attached: true, owner: P1, controller: P2, extra: [{ key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  assert.equal(controllerOf(game.engine, game.id("axe")), P2);
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("axe")] } });
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(axeCard(game).faceDown, true);
  assert.equal(controllerOf(game.engine, game.id("axe")), P1, "its owner's control");
});

clause(AXE, "2:rule", "it is only a replacement of 'destroyed': returned to hand it goes to hand, removed from the game it is removed", () => {
  const bounce = axeBoard({ attached: true, extra: [{ key: "bn", def: bounceInPlayTactic(), owner: P1, zone: "hand" }] });
  play(bounce.engine, P1, bounce.id("bn"), { selected: { t: [bounce.id("axe")] } });
  assert.equal(zoneOf(bounce.engine, bounce.id("axe")), "hand");
  const removed = axeBoard({ attached: true, extra: [{ key: "rm", def: removeAnyTactic(), owner: P1, zone: "hand" }] });
  play(removed.engine, P1, removed.id("rm"), { selected: { t: [removed.id("axe")] } });
  assert.equal(zoneOf(removed.engine, removed.id("axe")), "removed");
});

clause(AXE, "2:rule", "destroying ANOTHER item does not flip it: only this card is replaced", () => {
  const game = axeBoard({
    attached: true,
    extra: [
      { key: "other", def: item({ name: "Other Item" }), owner: P1, zone: "play" },
      { key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("other")] } });
  assert.equal(zoneOf(game.engine, game.id("other")), "discard", "an ordinary item is destroyed normally");
  assert.equal(axeCard(game).faceDown, false);
  assert.equal(axeAttachedTo(game), game.id("host"), "the Pickaxe stays attached");
});

clause(AXE, "2:rule", "destroyed as a COST it is not replaced (CR 506.2): the Pickaxe goes to the discard pile", () => {
  const game = axeBoard({
    attached: true,
    extra: [
      {
        key: "sac",
        def: tactic({
          name: "Sacrifice Item",
          cost: 0,
          behavior: {
            abilities: [
              {
                id: "sac",
                type: "activated",
                targets: [{ id: "t", selector: { zone: "play", type: "item", controller: "self" }, count: 1 }],
                costs: [{ type: "destroy", target: { type: "selected", id: "t" } }],
                effects: [{ type: "draw", player: "controller", amount: 1 }]
              }
            ]
          }
        }),
        owner: P1,
        zone: "hand"
      },
      ...fillers("dk", 2, P1, "deck")
    ]
  });
  play(game.engine, P1, game.id("sac"), { selected: { t: [game.id("axe")] } });
  assert.equal(zoneOf(game.engine, game.id("axe")), "discard", "destroying it as a cost is not replaced");
});

clause(AXE, "2:rule", "a face-down Pickaxe has no rules text: destroying it as a resource sends it to the discard pile", () => {
  const game = axeBoard({ faceDown: true, extra: [{ key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("axe")] } });
  assert.equal(zoneOf(game.engine, game.id("axe")), "discard");
});

clause(AXE, "2:rule", "the face-down Pickaxe it becomes can be flipped up again (FLIP UP 1 [D])", () => {
  const game = axeBoard({ attached: true, deception: 1, extra: [{ key: "dk", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  play(game.engine, P1, game.id("dk"), { selected: { t: [game.id("axe")] } });
  assert.equal(axeCard(game).faceDown, true);
  axeFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(axeCard(game).faceDown, false);
  assert.equal(axeAttachedTo(game), game.id("host"));
});

// --- 3:flipUp — FLIP UP: 1 [D] ---

clause(AXE, "3:flipUp", "a face-down Pickaxe flips up by paying 1 (it may pay for itself, CR 507.4b): it enters play attached to the picked character and buffs it", () => {
  const game = axeBoard({ faceDown: true, deception: 0, spentDeception: 1 });
  assert.equal(ready(game.engine), 1, "only the face-down card itself is ready");
  axeFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(axeCard(game).faceDown, false);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play");
  assert.equal(axeAttachedTo(game), game.id("host"));
  assert.deepEqual(stats(game.engine, game.id("host")), [4, 5, 2], "the buff applies");
});

clause(AXE, "3:flipUp", "FLIP UP costs 1 in total, not 1 plus the printed cost of 1: with a [D] resource and the face-down card, exactly one resource is paid", () => {
  const game = axeBoard({ faceDown: true, deception: 1 });
  assert.equal(ready(game.engine), 2, "the [D] resource and the face-down card");
  axeFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(axeCard(game).faceDown, false);
  const after = ready(game.engine);
  // The face-down card stopped being a resource (-1). If the [D] resource paid, it is attached too (-1 more); if the Pickaxe paid for itself, nothing more.
  assert.ok(after === 1 || after === 0, "one resource was paid in total, not two");
  assert.ok(after >= 0, "after >= 0");
  assert.equal(attachedCount(game.engine, P1) <= 1, true, "at most one resource attached");
});

clause(AXE, "3:flipUp", "FLIP UP needs [D]: Rage, Volition from other face-down cards, or the opponent's [D] are refused (still face-down, nothing paid)", () => {
  const rage = axeBoard({ faceDown: true, deception: 0, rage: 5 });
  refused(() => axeFlip(rage), "no [D]");
  assert.equal(axeCard(rage).faceDown, true);
  assert.equal(ready(rage.engine), 6);
  const volitionOnly = axeBoard({ faceDown: true, deception: 0, extra: volition(3, P1) });
  refused(() => axeFlip(volitionOnly), "Volition is not [D]");
  const theirs = axeBoard({ faceDown: true, deception: 0, rage: 2, extra: res({ deception: 3 }, P2) });
  refused(() => axeFlip(theirs), "their [D] do not count");
  assert.equal(axeCard(theirs).faceDown, true);
});

clause(AXE, "3:flipUp", "it is refused when it cannot pay the 1: every resource spent, including the Pickaxe itself", () => {
  const bad = axeBoard({ faceDown: true, spentFaceDown: true, deception: 0, spentDeception: 1 });
  assert.equal(ready(bad.engine), 0);
  refused(() => axeFlip(bad), "nothing ready to pay with");
  assert.equal(axeCard(bad).faceDown, true);
});

clause(AXE, "3:flipUp", "flipping up still needs the ATTACH TO pick: none, two, an item, or a faction is refused (still face-down, nothing paid)", () => {
  const none = axeBoard({ faceDown: true, deception: 1 });
  refused(() => flipUpRaw(none.engine, P1, none.id("axe"), { attachTo: [] }), "no pick");
  const two = axeBoard({ faceDown: true, deception: 1 });
  refused(() => flipUpRaw(two.engine, P1, two.id("axe"), { attachTo: [two.id("host"), two.id("host2")] }), "two picks");
  const itemPick = axeBoard({ faceDown: true, deception: 1, extra: [{ key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" }] });
  refused(() => flipUpRaw(itemPick.engine, P1, itemPick.id("axe"), { attachTo: [itemPick.id("thing")] }), "an item");
  const faction = axeBoard({ faceDown: true, deception: 1 });
  refused(() => flipUpRaw(faction.engine, P1, faction.id("axe"), { attachTo: [faction.engine.state.players[P2].factionId!] }), "a faction");
  for (const g of [none, two, itemPick, faction]) assert.equal(axeCard(g).faceDown, true);
});

clause(AXE, "3:flipUp", "the host may be the opponent's character: the flipped-up Pickaxe is mine but attached to theirs", () => {
  const game = axeBoard({ faceDown: true, deception: 1 });
  axeFlip(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(axeAttachedTo(game), game.id("foe"));
  assert.equal(controllerOf(game.engine, game.id("axe")), P1);
  assert.deepEqual(stats(game.engine, game.id("foe")), [3, 4, 2]);
});

clause(AXE, "3:flipUp", "FLIP UP works only on a face-down Pickaxe I control in play: not face-up, not in hand, not the opponent's", () => {
  const faceUp = axeBoard({ attached: true, deception: 1 });
  refused(() => flipUpRaw(faceUp.engine, P1, faceUp.id("axe"), { attachTo: [faceUp.id("host2")] }), "already face-up");
  const inHand = axeBoard({ deception: 1 });
  refused(() => axeFlip(inHand), "in hand");
  const theirs = axeBoard({ faceDown: true, deception: 1 });
  refused(() => axeFlip(theirs, "host", P2), "only its controller");
  assert.equal(axeCard(theirs).faceDown, true);
});

clause(AXE, "3:flipUp", "FLIP UP does not change WHEN an item can be deployed (CR 507.4d): on the opponent's turn it is refused, on mine it works", () => {
  const bad = axeBoard({ faceDown: true, deception: 1, turn: 2, active: P2 });
  refused(() => axeFlip(bad), "an item on the opponent's turn");
  assert.equal(axeCard(bad).faceDown, true);
  const good = axeBoard({ faceDown: true, deception: 1 });
  axeFlip(good);
  resolvePendingResponses(good.engine);
  assert.equal(axeCard(good).faceDown, false, "control: my own turn works");
});

clause(AXE, "3:flipUp", "FLIP UP of a non-tactic is refused INSIDE the opponent's response window too (CR 507.4d): an item can't be deployed in response to their attack", () => {
  const game = axeBoard({
    faceDown: true,
    deception: 1,
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  assert.equal(game.engine.state.priorityPlayerId, P1, "I hold priority in their attack window");
  refused(() => axeFlip(game), "an item can't be deployed in the opponent's response window", /deploy|turn|tactic|cannot|can't/i);
  assert.equal(axeCard(game).faceDown, true);
});

clause(AXE, "3:flipUp", "FLIP UP is cheaper than casting from hand: the same single [D] that pays 1 from hand also flips it up for 1 total", () => {
  const hand = axeBoard({ deception: 1 });
  const before = ready(hand.engine);
  axeDeploy(hand);
  resolvePendingResponses(hand.engine);
  assert.equal(before - ready(hand.engine), 1, "from hand: the printed cost of 1");
  const flipped = axeBoard({ faceDown: true, deception: 0, spentDeception: 1 });
  axeFlip(flipped);
  resolvePendingResponses(flipped.engine);
  assert.equal(axeCard(flipped).faceDown, false, "flipped up for its own resource alone");
});

clause(AXE, "3:flipUp", "a face-down Pickaxe that is spent (attached to the faction) can still be flipped up: CR 507.4a only needs it in play face-down under my control", () => {
  const game = axeBoard({ faceDown: true, spentFaceDown: true, deception: 2 });
  assert.equal(axeCard(game).attachedTo, game.engine.state.players[P1].factionId, "the face-down card is spent");
  axeFlip(game);
  resolvePendingResponses(game.engine);
  assert.equal(axeCard(game).faceDown, false);
  assert.equal(axeAttachedTo(game), game.id("host"));
});

// =============================================================================
// Smothering Corpulence (Seed 2) — Tactic, rogue, cost 4, [D][D]
//   COST: Pick a character. Both players remove the top card of their deck from
//     the game. X is the numeric cost of your opponent's removed card minus the
//     numeric cost of your removed card.
//   EFFECT: This turn, the character loses X life. Draw a card.
// =============================================================================

const SMOTHER = "48ac4062-dca5-469f-8b39-54f4519e137d";

interface SmOpts {
  /** Numeric costs of P1's deck, top first (default [2, 6, 6]). */
  mine?: number[];
  /** Numeric costs of P2's deck, top first (default [5, 6, 6]). */
  theirs?: number[];
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/**
 * Me = P1 with Smothering Corpulence in hand. Characters: mine "mine" (life 5),
 * theirs "foe" (life 5, one with damage 2 is "hurt"), all cost 1.
 */
function smBoard(opts: SmOpts = {}) {
  const mk = (owner: PlayerId, prefix: string, costs: number[]): CardPlacement[] =>
    costs.map((cost, i) => ({ key: `${prefix}${i}`, def: character({ name: `${prefix.toUpperCase()} deck ${i}`, cost }), owner, zone: "deck" as const }));
  return devBoard(
    [
      { key: "sm", def: printing(SMOTHER), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "My Character", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "hurt", def: character({ name: "Hurt Foe", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play", damage: 2 },
      ...mk(P1, "a", opts.mine ?? [2, 6, 6]),
      ...mk(P2, "b", opts.theirs ?? [5, 6, 6]),
      ...res(opts.icons ?? { deception: 6 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1, random: lcg(9) }
  );
}
type SmGame = ReturnType<typeof smBoard>;

const smRaw = (game: SmGame, pick: string, player: PlayerId = P1) => playRaw(game.engine, player, game.id("sm"), { selected: { c: [game.id(pick)] } });
const smPlay = (game: SmGame, pick: string) => {
  smRaw(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};
const lifeOf = (game: SmGame, key: string): number => game.engine.getStat(game.id(key), "life");

clause(SMOTHER, "0:ability", "with the opponent's card costing 5 and mine 2 (X = 3), the picked character loses 3 life this turn (5 life becomes 2)", () => {
  const game = smBoard({ mine: [2, 6, 6], theirs: [5, 6, 6] });
  assert.equal(lifeOf(game, "foe"), 5);
  smPlay(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(lifeOf(game, "foe"), 2, "5 - (5 - 2)");
  assert.equal(zoneOf(game.engine, game.id("foe")), "play");
});

clause(SMOTHER, "0:ability", "X is the opponent's cost MINUS mine: with theirs 7 and mine 4 it is 3, and swapping the two gives a different result (it is not an absolute difference)", () => {
  const a = smBoard({ mine: [4, 6, 6], theirs: [7, 6, 6] });
  smPlay(a, "foe");
  assert.equal(lifeOf(a, "foe"), 2, "X = 7 - 4 = 3");
  const b = smBoard({ mine: [7, 6, 6], theirs: [4, 6, 6] });
  smPlay(b, "foe");
  // E9b (Q5): a negative X is a loss of nothing, never a gain (the old assertion expected 8).
  assert.equal(lifeOf(b, "foe"), 5, "X = 4 - 7 = -3: it cannot 'lose -3 life', so nothing changes");
});

clause(SMOTHER, "0:ability", "when both removed cards cost the same, X is 0 and the character loses nothing", () => {
  const game = smBoard({ mine: [3, 6, 6], theirs: [3, 6, 6] });
  smPlay(game, "foe");
  assert.equal(lifeOf(game, "foe"), 5);
  assert.equal(damageOn(game.engine, game.id("foe")), 0);
});

clause(SMOTHER, "0:ability", "X can be as large as the cards make it: theirs 9, mine 0 gives X = 9", () => {
  const game = smBoard({ mine: [0, 6, 6], theirs: [9, 6, 6] });
  smRaw(game, "foe");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "life 5 - 9 -> 0: destroyed");
});

clause(SMOTHER, "0:ability", "the pick may be my own character: it loses the same X life", () => {
  const game = smBoard({ mine: [1, 6, 6], theirs: [4, 6, 6] });
  smPlay(game, "mine");
  assert.equal(lifeOf(game, "mine"), 2, "5 - 3");
  assert.equal(lifeOf(game, "foe"), 5, "their character is untouched");
});

clause(SMOTHER, "0:ability", "only the picked character is affected: the other characters keep their life", () => {
  const game = smBoard();
  smPlay(game, "foe");
  assert.equal(lifeOf(game, "mine"), 5);
  assert.equal(lifeOf(game, "hurt"), 5);
});

clause(SMOTHER, "0:ability", "life lost 'this turn' lasts only this turn: next turn the character is back at 5 life", () => {
  const game = smBoard({ mine: [2, 6, 6], theirs: [5, 6, 6] });
  smPlay(game, "foe");
  assert.equal(lifeOf(game, "foe"), 2);
  endTurn(game.engine, P1);
  assert.equal(lifeOf(game, "foe"), 5, "the effect ended with the turn");
});

clause(SMOTHER, "0:ability", "the reduced life matters for damage already on the character: 2 damage and life reduced from 5 to 2 destroys it", () => {
  const game = smBoard({ mine: [2, 6, 6], theirs: [5, 6, 6] });
  assert.equal(zoneOf(game.engine, game.id("hurt")), "play");
  smPlay(game, "hurt");
  assert.equal(zoneOf(game.engine, game.id("hurt")), "discard", "damage 2 >= life 2");
});

clause(SMOTHER, "0:ability", "a character whose life is reduced to a number above its damage survives: 2 damage with life 5 - 2 = 3", () => {
  const game = smBoard({ mine: [3, 6, 6], theirs: [5, 6, 6] });
  smPlay(game, "hurt");
  assert.equal(zoneOf(game.engine, game.id("hurt")), "play");
  assert.equal(lifeOf(game, "hurt"), 3);
});

clause(SMOTHER, "0:ability", "life cannot go below 0 (CR 410.4): losing more life than it has leaves 0 life, never a negative number", () => {
  const tough = smBoard({ mine: [0, 6, 6], theirs: [9, 6, 6], extra: [{ key: "tough", def: character({ name: "Tough", cost: 1, life: 20 }), owner: P2, zone: "play" }] });
  smPlay(tough, "tough");
  assert.equal(lifeOf(tough, "tough"), 11, "control: 20 - 9");
  const frail = smBoard({ mine: [0, 6, 6], theirs: [9, 6, 6], extra: [{ key: "frail", def: character({ name: "Frail", cost: 1, life: 3 }), owner: P2, zone: "play" }] });
  smPlay(frail, "frail");
  assert.equal(lifeOf(frail, "frail"), 0, "3 - 9 stays at 0");
});

clause(SMOTHER, "0:ability", "a character reduced to 0 life is destroyed (FAQ: a character with 0 life is destroyed because damage 0 equals life 0)", () => {
  const game = smBoard({ mine: [0, 6, 6], theirs: [5, 6, 6] });
  smPlay(game, "foe");
  assert.equal(lifeOf(game, "foe"), 0);
  assert.equal(zoneOf(game.engine, game.id("foe")), "discard", "0 life: destroyed");
});

// --- COST: both players remove the top card of their deck from the game ---

clause(SMOTHER, "0:ability", "'Both players remove the top card of their deck from the game' is part of the COST: both cards are gone as soon as the tactic is played, before the opponent can respond", () => {
  const game = smBoard();
  const myTop = deckOf(game.engine, P1)[0];
  const theirTop = deckOf(game.engine, P2)[0];
  smRaw(game, "foe");
  assert.equal(zoneOf(game.engine, game.id("sm")), "deploying");
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent is about to respond");
  assert.equal(zoneOf(game.engine, myTop), "removed", "my top card is already removed");
  assert.equal(zoneOf(game.engine, theirTop), "removed", "their top card is already removed");
  assert.equal(game.engine.state.cards[game.id("foe")].damage, 0);
});

clause(SMOTHER, "0:ability", "after it resolves, each player's former top card is out of the game (not in a discard pile, hand or deck)", () => {
  const game = smBoard();
  const myTop = deckOf(game.engine, P1)[0];
  const theirTop = deckOf(game.engine, P2)[0];
  smPlay(game, "foe");
  assert.equal(zoneOf(game.engine, myTop), "removed");
  assert.equal(zoneOf(game.engine, theirTop), "removed");
  assert.ok(removedOf(game.engine, P1).includes(myTop), "in my removed zone");
  assert.ok(removedOf(game.engine, P2).includes(theirTop), "in their removed zone");
  assert.equal(discardOf(game.engine, P1).includes(myTop), false);
  assert.equal(discardOf(game.engine, P2).includes(theirTop), false);
  assert.equal(deckOf(game.engine, P1).includes(myTop), false);
  assert.equal(deckOf(game.engine, P2).includes(theirTop), false);
});

clause(SMOTHER, "0:ability", "only the TOP card of each deck is removed: the other cards stay where they were", () => {
  const game = smBoard();
  const myDeck = deckOf(game.engine, P1);
  const theirDeck = deckOf(game.engine, P2);
  smPlay(game, "foe");
  assert.deepEqual(deckOf(game.engine, P2), theirDeck.slice(1), "their deck lost exactly its top card");
  assert.deepEqual(deckOf(game.engine, P1), myDeck.slice(2), "my deck lost its top card, and the next card was drawn");
});

clause(SMOTHER, "0:ability", "a removal is not a destruction: the removed cards do not appear in either discard pile", () => {
  const game = smBoard();
  smPlay(game, "foe");
  assert.equal(discardOf(game.engine, P1).length, 1, "only the Smothering Corpulence itself");
  assert.equal(discardOf(game.engine, P2).length, 0);
});

// --- EFFECT: Draw a card ---

clause(SMOTHER, "0:ability", "'Draw a card': I draw the card BELOW the one I removed (my removed card is not drawn)", () => {
  const game = smBoard();
  const [removed, below] = deckOf(game.engine, P1);
  const handBefore = handOf(game.engine, P1).length;
  smPlay(game, "foe");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1 + 1, "Smothering Corpulence left the hand, one card was drawn");
  assert.ok(handOf(game.engine, P1).includes(below), "I drew the next card");
  assert.equal(handOf(game.engine, P1).includes(removed), false);
});

clause(SMOTHER, "0:ability", "only I draw: the opponent's hand does not change", () => {
  const game = smBoard();
  const theirHand = handOf(game.engine, P2).length;
  smPlay(game, "foe");
  assert.equal(handOf(game.engine, P2).length, theirHand);
});

clause(SMOTHER, "0:ability", "I draw a card even when X is 0 or negative", () => {
  const zero = smBoard({ mine: [3, 6, 6], theirs: [3, 6, 6] });
  const below0 = deckOf(zero.engine, P1)[1];
  smPlay(zero, "foe");
  assert.ok(handOf(zero.engine, P1).includes(below0), "handOf(zero.engine, P1).includes(below0)");
  const neg = smBoard({ mine: [8, 6, 6], theirs: [1, 6, 6] });
  const below1 = deckOf(neg.engine, P1)[1];
  smPlay(neg, "foe");
  assert.ok(handOf(neg.engine, P1).includes(below1), "handOf(neg.engine, P1).includes(below1)");
});

// --- empty decks ---

clause(SMOTHER, "0:ability", "with my deck empty nothing of mine is removed, my removed card counts as cost 0 (X = their cost) and no card is drawn", () => {
  const game = smBoard({ mine: [], theirs: [4, 6, 6] });
  const handBefore = handOf(game.engine, P1).length;
  const theirTop = deckOf(game.engine, P2)[0];
  smPlay(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, theirTop), "removed");
  assert.equal(lifeOf(game, "foe"), 1, "5 - (4 - 0)");
  assert.equal(handOf(game.engine, P1).length, handBefore - 1, "nothing to draw (CR 306.2)");
});

clause(SMOTHER, "0:ability", "with their deck empty nothing of theirs is removed, their card counts as cost 0, and X is negative: the character loses nothing (Q5)", () => {
  const game = smBoard({ mine: [2, 6, 6], theirs: [] });
  const myTop = deckOf(game.engine, P1)[0];
  smPlay(game, "foe");
  assert.equal(zoneOf(game.engine, myTop), "removed");
  assert.equal(lifeOf(game, "foe"), 5, "X = 0 - 2 = -2: a negative loss changes nothing (the old assertion expected 7)");
});

clause(SMOTHER, "0:ability", "with both decks empty the tactic still resolves: X = 0 and nothing is drawn", () => {
  const game = smBoard({ mine: [], theirs: [] });
  smPlay(game, "foe");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(lifeOf(game, "foe"), 5);
  assert.equal(zoneOf(game.engine, game.id("sm")), "discard");
});

// --- "Pick a character" ---

clause(SMOTHER, "0:ability", "the pick must be a character in play: an item, a location, a face-down card, a faction, or a card in a hand or discard pile is refused", () => {
  const extra = [
    { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" as const },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" as const },
    { key: "fdown", def: character({ name: "Face Down" }), owner: P2, zone: "play" as const, faceDown: true },
    { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" as const },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" as const }
  ];
  for (const key of ["gadget", "place", "fdown", "inHand", "inDiscard"]) {
    const bad = smBoard({ extra });
    const before = ready(bad.engine);
    refused(() => smRaw(bad, key), `${key} is not a character in play`);
    assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
    assert.equal(ready(bad.engine), before, "nothing paid");
    assert.equal(deckOf(bad.engine, P2).length, 3, "their deck is untouched");
    assert.equal(deckOf(bad.engine, P1).length, 3, "my deck is untouched");
  }
  const faction = smBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("sm"), { selected: { c: [faction.engine.state.players[P2].factionId!] } }), "their faction");
  assert.equal(zoneOf(faction.engine, faction.id("sm")), "hand");
});

clause(SMOTHER, "0:ability", "exactly one character must be picked: none and two are refused, and no deck is touched", () => {
  const bad = smBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("sm"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("sm"), { selected: {} }), "no declaration");
  refused(() => playRaw(bad.engine, P1, bad.id("sm"), { selected: { c: [bad.id("foe"), bad.id("mine")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
  assert.equal(deckOf(bad.engine, P1).length, 3);
  assert.equal(deckOf(bad.engine, P2).length, 3);
});

clause(SMOTHER, "0:ability", "with no character in play at all it cannot be played, and no deck is touched", () => {
  const bad = devBoard([{ key: "sm", def: printing(SMOTHER), owner: P1, zone: "hand" }, ...fillers("a", 3, P1, "deck"), ...fillers("b", 3, P2, "deck"), ...res({ deception: 6 })]);
  refused(() => playRaw(bad.engine, P1, bad.id("sm"), { selected: {} }), "nothing to pick");
  assert.equal(deckOf(bad.engine, P1).length, 3);
  assert.equal(deckOf(bad.engine, P2).length, 3);
});

// --- cost 4 and [D][D] ---

clause(SMOTHER, "0:ability", "costs exactly 4 resources, paid when it is played", () => {
  const game = smBoard({ icons: { deception: 6 } });
  const before = ready(game.engine);
  smRaw(game, "foe");
  assert.equal(before - ready(game.engine), 4);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(before - ready(game.engine), 4, "nothing more paid");
});

clause(SMOTHER, "0:ability", "is refused one resource short of 4, and nothing is paid, picked or removed", () => {
  const bad = smBoard({ icons: { deception: 3 } });
  refused(() => smRaw(bad, "foe"), "3 resources for a cost of 4");
  assert.equal(zoneOf(bad.engine, bad.id("sm")), "hand");
  assert.equal(ready(bad.engine), 3);
  assert.equal(deckOf(bad.engine, P1).length, 3);
  assert.equal(deckOf(bad.engine, P2).length, 3);
});

clause(SMOTHER, "0:ability", "needs [D][D]: lots of other resources, a single [D], Volition or the opponent's [D] are refused", () => {
  const rage = smBoard({ icons: { rage: 8 } });
  refused(() => smRaw(rage, "foe"), "no [D]");
  const one = smBoard({ icons: { deception: 1, rage: 6 } });
  refused(() => smRaw(one, "foe"), "one [D]");
  const vol = smBoard({ icons: {}, extra: volition(6, P1) });
  refused(() => smRaw(vol, "foe"), "Volition");
  const theirs = smBoard({ icons: { rage: 5 }, extra: res({ deception: 4 }, P2) });
  refused(() => smRaw(theirs, "foe"), "their [D]");
  for (const g of [rage, one, vol, theirs]) {
    assert.equal(zoneOf(g.engine, g.id("sm")), "hand");
    assert.equal(deckOf(g.engine, P2).length, 3, "no deck was touched");
  }
});

clause(SMOTHER, "0:ability", "spent [D][D] meet the threshold, but only ready resources pay the 4", () => {
  const good = smBoard({ icons: { rage: 4 }, extra: spent({ deception: 2 }) });
  smPlay(good, "foe");
  assert.equal(zoneOf(good.engine, good.id("sm")), "discard");
  const bad = smBoard({ icons: { rage: 3 }, extra: spent({ deception: 2 }) });
  refused(() => smRaw(bad, "foe"), "only 3 ready resources");
});

clause(SMOTHER, "0:ability", "it can be played in response, on the opponent's turn", () => {
  const game = smBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  smRaw(game, "foe");
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(lifeOf(game, "foe"), 2);
  assert.equal(zoneOf(game.engine, game.id("sm")), "discard");
});

clause(SMOTHER, "0:ability", "numeric cost counts any card type: my removed tactic (cost 4) against their removed location (cost 6) gives X = 2", () => {
  const game = devBoard(
    [
      { key: "sm", def: printing(SMOTHER), owner: P1, zone: "hand" },
      { key: "foe", def: character({ name: "Foe", cost: 1, life: 5 }), owner: P2, zone: "play" },
      { key: "a0", def: tactic({ name: "My Cost Four Tactic", cost: 4 }), owner: P1, zone: "deck" },
      { key: "a1", def: character({ name: "My Next" }), owner: P1, zone: "deck" },
      { key: "b0", def: location({ name: "Their Cost Six Place", cost: 6 }), owner: P2, zone: "deck" },
      { key: "b1", def: character({ name: "Their Next" }), owner: P2, zone: "deck" },
      ...res({ deception: 6 })
    ],
    {}
  );
  smPlay(game, "foe");
  assert.equal(game.engine.getStat(game.id("foe"), "life"), 3, "5 - (6 - 4)");
});

// =============================================================================
// Sprint (Seed 2) — Tactic, rogue, cost 3, [D]
//   COST: Pick a character.
//   EFFECT: This turn, the character gains 1 speed. Put this card into play
//     under its owner's control as a face-down resource instead of into their
//     discard pile.
// =============================================================================

const SPRINT = "68f78435-b01d-43a8-92c7-ce9bb9a9c3d1";

interface SpOpts {
  icons?: Icons;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** Me = P1 with Sprint in hand; my characters "mine" (3/3/2) and "mine2" (1/1/1), theirs "foe" (3/3/3). */
function spBoard(opts: SpOpts = {}) {
  return devBoard(
    [
      { key: "sp", def: printing(SPRINT), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "My Runner", cost: 1, strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "My Other", cost: 1, strength: 1, life: 1, speed: 1 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { deception: 3 }),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1 }
  );
}
type SpGame = ReturnType<typeof spBoard>;

const spRaw = (game: SpGame, pick: string, player: PlayerId = P1) => playRaw(game.engine, player, game.id("sp"), { selected: { c: [game.id(pick)] } });
const spPlay = (game: SpGame, pick: string) => {
  spRaw(game, pick);
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
};
const speedOf = (game: SpGame, key: string): number => game.engine.getStat(game.id(key), "speed");

clause(SPRINT, "0:ability", "the picked character gains 1 speed this turn (2 becomes 3)", () => {
  const game = spBoard();
  assert.equal(speedOf(game, "mine"), 2);
  spPlay(game, "mine");
  assert.equal(speedOf(game, "mine"), 3);
  assert.deepEqual(stats(game.engine, game.id("mine")), [3, 3, 3], "only speed changes");
});

clause(SPRINT, "0:ability", "the speed bonus is exactly 1: a 1-speed character becomes 2-speed", () => {
  const game = spBoard();
  spPlay(game, "mine2");
  assert.equal(speedOf(game, "mine2"), 2);
});

clause(SPRINT, "0:ability", "the pick may be the opponent's character: it gains the speed", () => {
  const game = spBoard();
  spPlay(game, "foe");
  assert.equal(speedOf(game, "foe"), 4);
  assert.equal(speedOf(game, "mine"), 2, "my characters are unchanged");
});

clause(SPRINT, "0:ability", "only the picked character gains speed: the others keep theirs", () => {
  const game = spBoard();
  spPlay(game, "mine");
  assert.equal(speedOf(game, "mine2"), 1);
  assert.equal(speedOf(game, "foe"), 3);
});

clause(SPRINT, "0:ability", "'This turn': the speed bonus is gone when the turn ends", () => {
  const game = spBoard();
  spPlay(game, "mine");
  assert.equal(speedOf(game, "mine"), 3);
  endTurn(game.engine, P1);
  assert.equal(speedOf(game, "mine"), 2, "back to 2 on the opponent's turn");
  endTurn(game.engine, P2);
  assert.equal(speedOf(game, "mine"), 2, "and on my next turn");
});

clause(SPRINT, "0:ability", "the bonus is real in battle: at 3 speed my attacker hits at the same time as a 3-speed blocker instead of after it", () => {
  const board = () => spBoard();
  const without = board();
  declareAttackBy(without.engine, P1, [without.id("mine")]);
  declareBlockers(without.engine, P2, [without.id("foe")]);
  autoResolveBattle(without.engine);
  assert.equal(zoneOf(without.engine, without.id("mine")), "discard", "control: the faster blocker kills my attacker before it deals damage");
  assert.equal(zoneOf(without.engine, without.id("foe")), "play");
  const withSprint = board();
  spPlay(withSprint, "mine");
  declareAttackBy(withSprint.engine, P1, [withSprint.id("mine")]);
  declareBlockers(withSprint.engine, P2, [withSprint.id("foe")]);
  autoResolveBattle(withSprint.engine);
  assert.equal(zoneOf(withSprint.engine, withSprint.id("mine")), "discard", "both deal lethal damage at the same time");
  assert.equal(zoneOf(withSprint.engine, withSprint.id("foe")), "discard", "so the blocker dies too");
});

// --- Put this card into play under its owner's control as a face-down resource instead of into their discard pile ---

clause(SPRINT, "0:ability", "Sprint ends up IN PLAY, face-down, under my control, and not in the discard pile", () => {
  const game = spBoard();
  spPlay(game, "mine");
  const card = game.engine.state.cards[game.id("sp")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.equal(discardOf(game.engine, P1).includes(game.id("sp")), false, "not in the discard pile");
  assert.ok(playOf(game.engine, P1).includes(game.id("sp")), "playOf(game.engine, P1).includes(game.id(\"sp\"))");
});

clause(SPRINT, "0:ability", "it is a working resource: ready (not spent), and it provides one Volition", () => {
  const game = spBoard({ icons: { deception: 3 } });
  const volBefore = icons(game.engine, P1).volition ?? 0;
  spPlay(game, "mine");
  assert.equal(ready(game.engine), 1, "3 resources paid 3, then the new face-down resource is ready");
  assert.equal(icons(game.engine, P1).volition ?? 0, volBefore + 1);
  assert.equal(game.engine.state.cards[game.id("sp")].attachedTo, undefined, "not attached to the faction");
});

clause(SPRINT, "0:ability", "while it is being played (window open) it is not yet a resource; it only turns into one as it resolves", () => {
  const game = spBoard();
  spRaw(game, "mine");
  assert.equal(zoneOf(game.engine, game.id("sp")), "deploying");
  assert.equal(speedOf(game, "mine"), 2, "no speed bonus yet");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("sp")), "play");
});

clause(SPRINT, "0:ability", "the face-down Sprint can pay for other cards as a resource (cost 1 item paid with the new resource)", () => {
  const cheapItem = item({ name: "Cheap Item", cost: 1 });
  const game = spBoard({ extra: [{ key: "cheap", def: cheapItem, owner: P1, zone: "hand" }] });
  spPlay(game, "mine");
  assert.equal(ready(game.engine), 1);
  play(game.engine, P1, game.id("cheap"));
  assert.equal(zoneOf(game.engine, game.id("cheap")), "play");
  assert.equal(ready(game.engine), 0);
});

clause(SPRINT, "0:ability", "if the picked character is destroyed in response, Sprint still becomes a face-down resource (the second instruction doesn't depend on the pick)", () => {
  const game = spBoard({ extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  spRaw(game, "mine");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("mine")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("mine")), "discard");
  const card = game.engine.state.cards[game.id("sp")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
});

clause(SPRINT, "0:ability", "it is played on the opponent's turn too (a tactic): the resource still comes into play under MY control", () => {
  const game = spBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  spRaw(game, "mine");
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("sp")];
  assert.equal(card.zone, "play");
  assert.equal(card.faceDown, true);
  assert.equal(card.controllerId, P1);
  assert.equal(speedOf(game, "mine"), 3, "the bonus applies on their turn too");
});

clause(SPRINT, "0:ability", "two Sprints each become their own face-down resource", () => {
  const game = spBoard({ icons: { deception: 6 }, extra: [{ key: "sp2", def: printing(SPRINT), owner: P1, zone: "hand" }] });
  spPlay(game, "mine");
  playRaw(game.engine, P1, game.id("sp2"), { selected: { c: [game.id("mine")] } });
  resolvePendingResponses(game.engine);
  assert.equal(speedOf(game, "mine"), 4, "the two bonuses add up");
  for (const key of ["sp", "sp2"]) {
    assert.equal(game.engine.state.cards[game.id(key)].zone, "play");
    assert.equal(game.engine.state.cards[game.id(key)].faceDown, true);
  }
});

clause(SPRINT, "0:ability", "the face-down Sprint is just a resource: it is not a tactic that can be played again", () => {
  const game = spBoard({ icons: { deception: 3 } });
  spPlay(game, "mine");
  refused(() => playRaw(game.engine, P1, game.id("sp"), { selected: { c: [game.id("mine")] } }), "a face-down card in play is not in hand");
});

// --- "Pick a character" ---

clause(SPRINT, "0:ability", "the pick must be a character in play: an item, a location, a face-down card, a faction, or a card in a hand or discard pile is refused", () => {
  const extra = [
    { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" as const },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" as const },
    { key: "fdown", def: character({ name: "Face Down" }), owner: P2, zone: "play" as const, faceDown: true },
    { key: "inHand", def: character({ name: "In Hand" }), owner: P2, zone: "hand" as const },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" as const }
  ];
  for (const key of ["gadget", "place", "fdown", "inHand", "inDiscard"]) {
    const bad = spBoard({ extra });
    refused(() => spRaw(bad, key), `${key} is not a character in play`);
    assert.equal(zoneOf(bad.engine, bad.id("sp")), "hand");
    assert.equal(ready(bad.engine), 3, "nothing paid");
  }
  const faction = spBoard();
  refused(() => playRaw(faction.engine, P1, faction.id("sp"), { selected: { c: [faction.engine.state.players[P2].factionId!] } }), "their faction");
  assert.equal(zoneOf(faction.engine, faction.id("sp")), "hand");
});

clause(SPRINT, "0:ability", "exactly one character must be picked: none and two are refused", () => {
  const bad = spBoard();
  refused(() => playRaw(bad.engine, P1, bad.id("sp"), { selected: { c: [] } }), "no pick");
  refused(() => playRaw(bad.engine, P1, bad.id("sp"), { selected: {} }), "no declaration");
  refused(() => playRaw(bad.engine, P1, bad.id("sp"), { selected: { c: [bad.id("mine"), bad.id("foe")] } }), "two picks");
  assert.equal(zoneOf(bad.engine, bad.id("sp")), "hand");
  assert.equal(ready(bad.engine), 3);
});

clause(SPRINT, "0:ability", "with no character in play at all it cannot be played", () => {
  const bad = devBoard([{ key: "sp", def: printing(SPRINT), owner: P1, zone: "hand" }, ...res({ deception: 3 })]);
  refused(() => playRaw(bad.engine, P1, bad.id("sp"), { selected: {} }), "nothing to pick");
  assert.equal(zoneOf(bad.engine, bad.id("sp")), "hand");
});

// --- cost 3 and [D] ---

clause(SPRINT, "0:ability", "costs exactly 3 resources, paid when it is played (before the opponent can respond)", () => {
  const game = spBoard({ icons: { deception: 5 } });
  const before = ready(game.engine);
  spRaw(game, "mine");
  assert.equal(before - ready(game.engine), 3);
  resolvePendingResponses(game.engine);
  assert.equal(before - ready(game.engine), 2, "net of the new face-down resource");
});

clause(SPRINT, "0:ability", "is refused one resource short of 3, and nothing is paid", () => {
  const bad = spBoard({ icons: { deception: 2 } });
  refused(() => spRaw(bad, "mine"), "2 resources for a cost of 3");
  assert.equal(zoneOf(bad.engine, bad.id("sp")), "hand");
  assert.equal(ready(bad.engine), 2);
});

clause(SPRINT, "0:ability", "needs [D]: lots of Rage, Volition or the opponent's [D] are refused", () => {
  const rage = spBoard({ icons: { rage: 6 } });
  refused(() => spRaw(rage, "mine"), "no [D]");
  const vol = spBoard({ icons: {}, extra: volition(6, P1) });
  refused(() => spRaw(vol, "mine"), "Volition is not [D]");
  const theirs = spBoard({ icons: { rage: 4 }, extra: res({ deception: 3 }, P2) });
  refused(() => spRaw(theirs, "mine"), "their [D] do not count");
  for (const g of [rage, vol, theirs]) assert.equal(zoneOf(g.engine, g.id("sp")), "hand");
});

clause(SPRINT, "0:ability", "one [D] is enough for the threshold, with Rage paying the rest", () => {
  const game = spBoard({ icons: { deception: 1, rage: 2 } });
  spPlay(game, "mine");
  assert.equal(zoneOf(game.engine, game.id("sp")), "play");
});

clause(SPRINT, "0:ability", "spent [D] meets the threshold, but only ready resources pay the 3", () => {
  const good = spBoard({ icons: { rage: 3 }, extra: spent({ deception: 1 }) });
  spPlay(good, "mine");
  assert.equal(good.engine.state.cards[good.id("sp")].faceDown, true);
  const bad = spBoard({ icons: { rage: 2 }, extra: spent({ deception: 1 }) });
  refused(() => spRaw(bad, "mine"), "only 2 ready resources");
});

// =============================================================================
// Uncontrollable Jalopy (Seed 2, Seed Saga) — Character, rogue, vehicle, cost 4, [D][D], 3/3/1
//   At the start of your turn, you may put a token on this card.
//   This card gains 1 speed for each token on it.
//   While there are at least 5 tokens on this card, it's unblockable.
// =============================================================================

const JALOPY = "d2519bcd-7e4c-4ff6-918d-82aade2e81f0";
const JALOPY_SAGA = "dcee49ea-a540-43b2-86da-1c2a85e18e55";

interface JalOpts {
  printingId?: string;
  tokens?: number;
  zone?: Zone;
  faceDown?: boolean;
  owner?: PlayerId;
  controller?: PlayerId;
  turn?: number;
  active?: PlayerId;
  extra?: CardPlacement[];
}

/** The Jalopy "j" (P1's by default); P1 plain ally "ally" (2/2/2), P2 "blocker" (3/4/2) and "blocker2". */
function jalBoard(opts: JalOpts = {}) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "j", def: printing(opts.printingId ?? JALOPY), owner, controller: opts.controller ?? owner, zone: opts.zone ?? "play", faceDown: opts.faceDown, counters: opts.tokens ? { token: opts.tokens } : undefined },
      { key: "ally", def: character({ name: "Ally", cost: 1, strength: 2, life: 2, speed: 2 }), owner: P1, zone: "play" },
      { key: "blocker", def: character({ name: "Blocker", cost: 1, strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "blocker2", def: character({ name: "Second Blocker", cost: 1, strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 2, activePlayerId: opts.active ?? P2 }
  );
}
type JalGame = ReturnType<typeof jalBoard>;

/** P2's turn ends and P1's turn starts: the Jalopy's trigger asks. */
const jalStart = (game: JalGame) => endTurn(game.engine, P2);

/** Answers the open "put a token?" choice: `accept` picks the option that puts a token, otherwise the one that declines. */
function jalAnswer(game: JalGame, accept: boolean): void {
  const pc = expectPending(game.engine, "chooserSelectsOption");
  const options = pc.options as Array<{ label: string }>;
  assert.equal(options.length, 2, "put a token, or not");
  const index = options.findIndex((o) => (accept ? /token/i.test(o.label) : /decline|no|don't|not/i.test(o.label)));
  assert.ok(index >= 0, `an option to ${accept ? "put a token" : "decline"}`);
  answerPending(game.engine, "chooserSelectsOption", { index });
}

const jalSpeed = (game: JalGame, key = "j"): number => game.engine.getStat(game.id(key), "speed");
const unblockable = (game: JalGame, key = "j"): boolean => game.engine.getKeywords(game.id(key)).includes("cannotBeBlocked");

// --- 0:rule — At the start of your turn, you may put a token on this card ---

const jalTriggerBody = (printingId: string) => () => {
  const game = jalBoard({ printingId });
  jalStart(game);
  assert.equal(game.engine.state.activePlayerId, P1);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "I decide");
  assert.equal(tokensOn(game.engine, game.id("j")), 0, "no token until I say yes");
  jalAnswer(game, true);
  assert.equal(tokensOn(game.engine, game.id("j")), 1);
  assert.equal(game.engine.state.pendingChoice, undefined);
};
clause(JALOPY, "0:rule", "at the start of my turn I am asked, and saying yes puts one token on it", jalTriggerBody(JALOPY));
clause(JALOPY_SAGA, "0:rule", "the Seed Saga printing: at the start of my turn saying yes puts one token on it", jalTriggerBody(JALOPY_SAGA));

clause(JALOPY, "0:rule", "'you may': declining puts no token", () => {
  const game = jalBoard({ tokens: 2 });
  jalStart(game);
  jalAnswer(game, false);
  assert.equal(tokensOn(game.engine, game.id("j")), 2);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(JALOPY, "0:rule", "accepting adds exactly one token to the tokens already there", () => {
  const game = jalBoard({ tokens: 3 });
  jalStart(game);
  jalAnswer(game, true);
  assert.equal(tokensOn(game.engine, game.id("j")), 4);
});

clause(JALOPY, "0:rule", "it asks every one of my turns: three turns of 'yes' give three tokens, and a 'no' in between skips one", () => {
  const game = jalBoard();
  jalStart(game);
  jalAnswer(game, true);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  jalAnswer(game, false);
  endTurn(game.engine, P1);
  endTurn(game.engine, P2);
  jalAnswer(game, true);
  assert.equal(tokensOn(game.engine, game.id("j")), 2);
});

clause(JALOPY, "0:rule", "it does not ask at the start of the OPPONENT's turn", () => {
  const game = jalBoard({ turn: 1, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("j")), 0);
});

clause(JALOPY, "0:rule", "'your turn' is its controller's: a Jalopy under the opponent's control asks THEM at the start of THEIR turn", () => {
  const game = jalBoard({ owner: P1, controller: P2, turn: 1, active: P1 });
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.activePlayerId, P2);
  const pc = expectPending(game.engine, "chooserSelectsOption");
  assert.equal(pc.playerId, P2, "its controller, not its owner");
  jalAnswer(game, true);
  assert.equal(tokensOn(game.engine, game.id("j")), 1);
  const mine = jalBoard({ owner: P1, controller: P2 });
  jalStart(mine);
  assert.equal(mine.engine.state.pendingChoice, undefined, "it does not ask me at the start of MY turn when the opponent controls it");
});

clause(JALOPY, "0:rule", "it only works in play: in hand, in the discard pile, or face-down it asks nothing", () => {
  for (const [zone, faceDown] of [["hand", false], ["discard", false], ["play", true]] as const) {
    const game = jalBoard({ zone, faceDown });
    jalStart(game);
    assert.equal(game.engine.state.pendingChoice, undefined, `${zone}${faceDown ? " face-down" : ""}`);
  }
});

clause(JALOPY, "0:rule", "two Jalopies each ask: each may take a token independently", () => {
  const game = jalBoard({ extra: [{ key: "j2", def: printing(JALOPY), owner: P1, zone: "play" }] });
  jalStart(game);
  maybeOrder(game.engine);
  jalAnswer(game, true);
  maybeOrder(game.engine);
  jalAnswer(game, false);
  const totals = [tokensOn(game.engine, game.id("j")), tokensOn(game.engine, game.id("j2"))].sort();
  assert.deepEqual(totals, [0, 1], "exactly one of them got a token");
});

clause(JALOPY, "0:rule", "the token does not need the Jalopy to be ready, and nothing is paid", () => {
  const game = jalBoard({ extra: [...res({ deception: 2 })] });
  const before = ready(game.engine);
  jalStart(game);
  jalAnswer(game, true);
  assert.equal(ready(game.engine), before, "free");
  assert.equal(isDepleted(game.engine, game.id("j")), false);
});

// --- 1:rule — This card gains 1 speed for each token on it ---

const jalSpeedBody = (printingId: string) => () => {
  for (const tokens of [0, 1, 3]) {
    const game = jalBoard({ printingId, tokens });
    assert.equal(jalSpeed(game), 1 + tokens, `${tokens} tokens`);
  }
};
clause(JALOPY, "1:rule", "its speed is 1 plus one per token: 0, 1 and 3 tokens give speed 1, 2 and 4", jalSpeedBody(JALOPY));
clause(JALOPY_SAGA, "1:rule", "the Seed Saga printing: speed is 1 plus one per token", jalSpeedBody(JALOPY_SAGA));

clause(JALOPY, "1:rule", "a big pile of tokens gives a big speed: 5 and 9 tokens give speed 6 and 10", () => {
  assert.equal(jalSpeed(jalBoard({ tokens: 5 })), 6);
  assert.equal(jalSpeed(jalBoard({ tokens: 9 })), 10);
});

clause(JALOPY, "1:rule", "only speed changes: strength 3 and life 3 are unaffected by tokens", () => {
  const game = jalBoard({ tokens: 4 });
  assert.deepEqual(stats(game.engine, game.id("j")), [3, 3, 5]);
});

clause(JALOPY, "1:rule", "it counts only the tokens on THIS card: another card's tokens, or the opponent's Jalopy's, do not add speed", () => {
  const game = jalBoard({ tokens: 1, extra: [{ key: "other", def: printing(JALOPY), owner: P2, zone: "play", counters: { token: 4 } }] });
  assert.equal(jalSpeed(game), 2);
  assert.equal(jalSpeed(game, "other"), 5);
});

clause(JALOPY, "1:rule", "the speed follows the tokens live: taking the token that was just put on it away takes the speed away", () => {
  const strip = tactic({
    name: "Strip A Token",
    cost: 0,
    behavior: {
      abilities: [{ id: "strip", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }]
    }
  });
  const game = jalBoard({ tokens: 3, turn: 1, active: P1, extra: [{ key: "strip", def: strip, owner: P1, zone: "hand" }] });
  assert.equal(jalSpeed(game), 4);
  play(game.engine, P1, game.id("strip"), { selected: { t: [game.id("j")] } });
  assert.equal(tokensOn(game.engine, game.id("j")), 2);
  assert.equal(jalSpeed(game), 3);
});

clause(JALOPY, "1:rule", "the speed is real in battle: with 3 tokens (speed 4) it hits first and survives a 2-speed blocker that would kill it", () => {
  const board = (tokens: number) =>
    jalBoard({ turn: 1, active: P1, tokens, extra: [{ key: "frail", def: character({ name: "Frail Blocker", cost: 1, strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" }] });
  const fast = board(3);
  declareAttackBy(fast.engine, P1, [fast.id("j")]);
  declareBlockers(fast.engine, P2, [fast.id("frail")]);
  autoResolveBattle(fast.engine);
  assert.equal(zoneOf(fast.engine, fast.id("frail")), "discard", "3 damage at speed 4 kills the 3-life blocker first");
  assert.equal(zoneOf(fast.engine, fast.id("j")), "play", "the dead blocker never deals its damage");
  const slow = board(0);
  declareAttackBy(slow.engine, P1, [slow.id("j")]);
  declareBlockers(slow.engine, P2, [slow.id("frail")]);
  autoResolveBattle(slow.engine);
  assert.equal(zoneOf(slow.engine, slow.id("j")), "discard", "control: at speed 1 the faster blocker kills it first");
  assert.equal(zoneOf(slow.engine, slow.id("frail")), "play", "and the Jalopy never deals damage");
});

// --- 2:rule — While there are at least 5 tokens on this card, it's unblockable ---

const jalUnblockBody = (printingId: string) => () => {
  const game = jalBoard({ printingId, tokens: 5, turn: 1, active: P1 });
  assert.equal(unblockable(game), true);
  declareAttackBy(game.engine, P1, [game.id("j")]);
  refused(() => declareBlockers(game.engine, P2, [game.id("blocker")]), "an unblockable attacker cannot be blocked");
  declareBlockers(game.engine, P2, []);
  assert.deepEqual(battleOf(game.engine)?.blockingParty ?? [], []);
};
clause(JALOPY, "2:rule", "with 5 tokens it is unblockable: a blocker is refused", jalUnblockBody(JALOPY));
clause(JALOPY_SAGA, "2:rule", "the Seed Saga printing: with 5 tokens it is unblockable", jalUnblockBody(JALOPY_SAGA));

clause(JALOPY, "2:rule", "with 4 tokens it is NOT unblockable: it can be blocked", () => {
  const game = jalBoard({ tokens: 4, turn: 1, active: P1 });
  assert.equal(unblockable(game), false);
  declareAttackBy(game.engine, P1, [game.id("j")]);
  declareBlockers(game.engine, P2, [game.id("blocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("blocker")]);
});

clause(JALOPY, "2:rule", "with 0 tokens it is a plain blockable character", () => {
  const game = jalBoard({ tokens: 0, turn: 1, active: P1 });
  assert.equal(unblockable(game), false);
  declareAttackBy(game.engine, P1, [game.id("j")]);
  declareBlockers(game.engine, P2, [game.id("blocker"), game.id("blocker2")]);
  assert.equal(battleOf(game.engine)?.blockingParty?.length, 2);
});

clause(JALOPY, "2:rule", "'at least 5': 6 tokens and 12 tokens are still unblockable", () => {
  for (const tokens of [6, 12]) {
    const game = jalBoard({ tokens, turn: 1, active: P1 });
    assert.equal(unblockable(game), true, `${tokens} tokens`);
    declareAttackBy(game.engine, P1, [game.id("j")]);
    refused(() => declareBlockers(game.engine, P2, [game.id("blocker")]), `${tokens} tokens: no blocker`);
  }
});

clause(JALOPY, "2:rule", "the 5th token turns it on: a Jalopy with 4 tokens that takes one more becomes unblockable at the start of my turn", () => {
  const game = jalBoard({ tokens: 4 });
  assert.equal(unblockable(game), false);
  jalStart(game);
  jalAnswer(game, true);
  assert.equal(tokensOn(game.engine, game.id("j")), 5);
  assert.equal(unblockable(game), true);
  declareAttackBy(game.engine, P1, [game.id("j")]);
  refused(() => declareBlockers(game.engine, P2, [game.id("blocker")]), "unblockable");
});

clause(JALOPY, "2:rule", "it turns off again when tokens drop below 5", () => {
  const strip = tactic({
    name: "Strip A Token",
    cost: 0,
    behavior: {
      abilities: [{ id: "strip", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }] }]
    }
  });
  const game = jalBoard({ tokens: 5, turn: 1, active: P1, extra: [{ key: "strip", def: strip, owner: P1, zone: "hand" }] });
  assert.equal(unblockable(game), true);
  play(game.engine, P1, game.id("strip"), { selected: { t: [game.id("j")] } });
  assert.equal(tokensOn(game.engine, game.id("j")), 4);
  assert.equal(unblockable(game), false);
});

clause(JALOPY, "2:rule", "a party is only unblockable when EVERY member is: the unblockable Jalopy attacking with a plain ally can be blocked", () => {
  const game = jalBoard({ tokens: 5, turn: 1, active: P1 });
  declareAttackBy(game.engine, P1, [game.id("j"), game.id("ally")]);
  declareBlockers(game.engine, P2, [game.id("blocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("blocker")], "the party is blockable because the ally is");
});

clause(JALOPY, "2:rule", "unblockable means it deals its full strength to the faction: 3 damage with nothing able to stop it", () => {
  const game = jalBoard({ tokens: 5, turn: 1, active: P1 });
  declareAttackBy(game.engine, P1, [game.id("j")]);
  declareBlockers(game.engine, P2, []);
  autoResolveBattle(game.engine);
  assert.equal(influenceOf(game.engine, P2), START - 3);
});

clause(JALOPY, "2:rule", "it only applies to this card: another character of mine stays blockable", () => {
  const game = jalBoard({ tokens: 5, turn: 1, active: P1 });
  assert.equal(unblockable(game, "ally"), false);
  declareAttackBy(game.engine, P1, [game.id("ally")]);
  declareBlockers(game.engine, P2, [game.id("blocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("blocker")]);
});

clause(JALOPY, "2:rule", "tokens vanish when it leaves play, so a bounced and redeployed Jalopy is not unblockable (CR 409.2)", () => {
  const game = jalBoard({
    tokens: 5,
    turn: 1,
    active: P1,
    extra: [{ key: "bounce", def: bounceInPlayTactic(), owner: P1, zone: "hand" }, ...res({ deception: 4 })]
  });
  assert.equal(unblockable(game), true);
  play(game.engine, P1, game.id("bounce"), { selected: { t: [game.id("j")] } });
  assert.equal(zoneOf(game.engine, game.id("j")), "hand");
  play(game.engine, P1, game.id("j"));
  assert.equal(zoneOf(game.engine, game.id("j")), "play");
  assert.equal(tokensOn(game.engine, game.id("j")), 0, "the tokens disappeared when it left play");
  assert.equal(unblockable(game), false);
  assert.equal(jalSpeed(game), 1);
});

clause(JALOPY, "2:rule", "face-down it is just a resource: not unblockable, with no speed", () => {
  const game = jalBoard({ tokens: 5, faceDown: true });
  assert.equal(unblockable(game), false);
});

// =============================================================================
// Vast Mastabatorium (Seed 2) — Location, rogue, cost 2, [D][D], structure 4
//   YOU KNOW YOU WANT TO...
//     COST: Use this only 5 times each turn. Pay 1. Inflict 1 damage to your faction.
//     EFFECT: Draw a card. At the end of the turn, put a token on this card and
//       your opponent takes control of it.
//   SWEET RELEASE
//     COST: Pay 2. Remove a token from this card.
//     EFFECT: You may play a resource.
// =============================================================================

const VAST = "ab1abe6e-7428-492b-8eb1-0f0ceef7e512";

interface VastOpts {
  tokens?: number;
  owner?: PlayerId;
  controller?: PlayerId;
  zone?: Zone;
  faceDown?: boolean;
  /** Ready [D] resources for P1 (default 8) and P2 (default 8). */
  p1Resources?: number;
  p2Resources?: number;
  turn?: number;
  active?: PlayerId;
  p1Influence?: number;
  p2Influence?: number;
  extra?: CardPlacement[];
}

/**
 * The Mastabatorium "vm" (P1's by default). Each player has 8 deck cards
 * (`a0..`, `b0..`) and in hand a real Rage resource card "rageRes" and a
 * character "handChar" (P1), "theirRes" / "theirChar" (P2).
 */
function vastBoard(opts: VastOpts = {}) {
  const owner = opts.owner ?? P1;
  return devBoard(
    [
      { key: "vm", def: printing(VAST), owner, controller: opts.controller ?? owner, zone: opts.zone ?? "play", faceDown: opts.faceDown, counters: opts.tokens ? { token: opts.tokens } : undefined },
      ...fillers("a", 8, P1, "deck", (i) => character({ name: `A deck ${i}` })),
      ...fillers("b", 8, P2, "deck", (i) => character({ name: `B deck ${i}` })),
      { key: "rageRes", def: stapleCard("rage", "My Rage"), owner: P1, zone: "hand" },
      { key: "handChar", def: character({ name: "My Hand Char", cost: 1 }), owner: P1, zone: "hand" },
      { key: "theirRes", def: stapleCard("rage", "Their Rage"), owner: P2, zone: "hand" },
      { key: "theirChar", def: character({ name: "Their Hand Char", cost: 1 }), owner: P2, zone: "hand" },
      ...res({ deception: opts.p1Resources ?? 8 }),
      ...res({ deception: opts.p2Resources ?? 8 }, P2),
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1, playerA: { faction: developFaction(), influence: opts.p1Influence ?? START }, playerB: { faction: developFaction(), influence: opts.p2Influence ?? START } }
  );
}
type VastGame = ReturnType<typeof vastBoard>;

const vastUse = (game: VastGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("vm"), "you-know-you-want-to");
const vastRelease = (game: VastGame, player: PlayerId = P1) => actRaw(game.engine, player, game.id("vm"), "sweet-release");
const vastUseAndResolve = (game: VastGame, player: PlayerId = P1) => {
  vastUse(game, player);
  resolvePendingResponses(game.engine);
};

// --- YOU KNOW YOU WANT TO... ---

clause(VAST, "0:ability:you-know-you-want-to", "pays exactly 1 resource and inflicts 1 damage to my faction (1 influence) as a cost, before the opponent can respond; then I draw a card", () => {
  const game = vastBoard();
  const readyBefore = ready(game.engine);
  const handBefore = handOf(game.engine, P1).length;
  vastUse(game);
  assert.equal(readyBefore - ready(game.engine), 1, "1 resource paid at once");
  assert.equal(influenceOf(game.engine, P1), START - 1, "1 damage to my faction at once");
  assert.equal(handOf(game.engine, P1).length, handBefore, "the draw has not happened yet");
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent may respond");
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, handBefore + 1, "one card drawn");
  assert.equal(readyBefore - ready(game.engine), 1, "nothing more paid");
  assert.equal(influenceOf(game.engine, P1), START - 1, "no more damage");
});

clause(VAST, "0:ability:you-know-you-want-to", "I draw the top card of my own deck, not the opponent's", () => {
  const game = vastBoard();
  const top = deckOf(game.engine, P1)[0];
  const theirHand = handOf(game.engine, P2).length;
  vastUseAndResolve(game);
  assert.ok(handOf(game.engine, P1).includes(top), "handOf(game.engine, P1).includes(top)");
  assert.equal(handOf(game.engine, P2).length, theirHand);
});

clause(VAST, "0:ability:you-know-you-want-to", "the damage goes to MY faction only: the opponent's influence is unchanged", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(VAST, "0:ability:you-know-you-want-to", "the damage is real damage: a damage-prevention effect on my faction stops the influence loss (the cost is still paid and the card still drawn)", () => {
  const ward = item({
    name: "Ward",
    cost: 0,
    behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction", controller: "self" }, delta: -10 }] }] }
  });
  const game = vastBoard({ extra: [{ key: "ward", def: ward, owner: P1, zone: "play" }] });
  const handBefore = handOf(game.engine, P1).length;
  vastUseAndResolve(game);
  assert.equal(influenceOf(game.engine, P1), START, "the 1 damage was reduced to 0");
  assert.equal(handOf(game.engine, P1).length, handBefore + 1);
});

clause(VAST, "0:ability:you-know-you-want-to", "it is refused when there is no resource to pay the 1, and nothing happens", () => {
  const bad = vastBoard({ p1Resources: 0 });
  refused(() => vastUse(bad), "nothing to pay with");
  assert.equal(influenceOf(bad.engine, P1), START, "no damage taken");
  assert.equal(handOf(bad.engine, P1).length, 2, "nothing drawn");
  assert.equal(bad.engine.state.responseWindow, undefined);
});

clause(VAST, "0:ability:you-know-you-want-to", "spent (attached) resources cannot pay the 1", () => {
  const bad = vastBoard({ p1Resources: 0, extra: spent({ deception: 3 }) });
  refused(() => vastUse(bad), "all resources are spent");
  assert.equal(influenceOf(bad.engine, P1), START);
});

clause(VAST, "0:ability:you-know-you-want-to", "the damage is inflicted even when it takes my last influence: at 1 influence I lose the game", () => {
  const game = vastBoard({ p1Influence: 1 });
  vastUse(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), 0);
  assert.equal(game.engine.state.winner, P2, "my faction reached 0 influence");
});

clause(VAST, "0:ability:you-know-you-want-to", "'Use this only 5 times each turn': five uses in one turn are allowed", () => {
  const game = vastBoard();
  for (let i = 0; i < 5; i++) vastUseAndResolve(game);
  assert.equal(influenceOf(game.engine, P1), START - 5);
  assert.equal(handOf(game.engine, P1).length, 2 + 5);
});

clause(VAST, "0:ability:you-know-you-want-to", "the sixth use in the same turn is refused, and costs nothing", () => {
  const game = vastBoard();
  for (let i = 0; i < 5; i++) vastUseAndResolve(game);
  const readyBefore = ready(game.engine);
  refused(() => vastUse(game), "only 5 times each turn");
  assert.equal(ready(game.engine), readyBefore, "nothing paid");
  assert.equal(influenceOf(game.engine, P1), START - 5, "no damage");
  assert.equal(handOf(game.engine, P1).length, 7, "no draw");
});

clause(VAST, "0:ability:you-know-you-want-to", "the limit counts uses, not tokens: it applies even if each use is answered by a response", () => {
  const game = vastBoard();
  for (let i = 0; i < 5; i++) vastUseAndResolve(game);
  assert.equal(tokensOn(game.engine, game.id("vm")), 0, "no token yet: they arrive at the end of the turn");
  refused(() => vastUse(game), "still only 5");
});

clause(VAST, "0:ability:you-know-you-want-to", "the count resets each turn: after control passes and comes back, another 5 uses are possible", () => {
  const game = vastBoard();
  for (let i = 0; i < 5; i++) vastUseAndResolve(game);
  endTurn(game.engine, P1);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2, "they now control it");
  for (let i = 0; i < 5; i++) vastUseAndResolve(game, P2);
  assert.equal(influenceOf(game.engine, P2), START - 5, "they can use it 5 times on their own turn");
  refused(() => vastUse(game, P2), "their sixth use");
  endTurn(game.engine, P2);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1, "it came back to me");
  for (let i = 0; i < 5; i++) vastUseAndResolve(game);
  assert.equal(influenceOf(game.engine, P1), START - 10, "another 5 uses on my next turn");
});

clause(VAST, "0:ability:you-know-you-want-to", "'At the end of the turn': until the turn ends I keep control and there is no token", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1, "still mine");
  assert.equal(tokensOn(game.engine, game.id("vm")), 0, "no token yet");
  vastUseAndResolve(game);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1, "still mine after a second use");
});

clause(VAST, "0:ability:you-know-you-want-to", "at the end of the turn a token is put on it and my opponent takes control of it", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  endTurn(game.engine, P1);
  assert.equal(tokensOn(game.engine, game.id("vm")), 1, "one token");
  assert.equal(controllerOf(game.engine, game.id("vm")), P2, "the opponent controls it");
  assert.equal(game.engine.state.cards[game.id("vm")].ownerId, P1, "I still own it");
  assert.ok(playOf(game.engine, P2).includes(game.id("vm")), "playOf(game.engine, P2).includes(game.id(\"vm\"))");
  assert.equal(playOf(game.engine, P1).includes(game.id("vm")), false);
  assert.equal(zoneOf(game.engine, game.id("vm")), "play");
});

clause(VAST, "0:ability:you-know-you-want-to", "each use adds its own token and control change: three uses give three tokens", () => {
  const game = vastBoard();
  for (let i = 0; i < 3; i++) vastUseAndResolve(game);
  endTurn(game.engine, P1);
  assert.equal(tokensOn(game.engine, game.id("vm")), 3);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2);
});

clause(VAST, "0:ability:you-know-you-want-to", "no use, no change: if I never use it, nothing happens at the end of the turn", () => {
  const game = vastBoard();
  endTurn(game.engine, P1);
  assert.equal(tokensOn(game.engine, game.id("vm")), 0);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1);
});

clause(VAST, "0:ability:you-know-you-want-to", "the control change is permanent: it stays with the opponent through their turn too (until they use it themselves)", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  endTurn(game.engine, P1);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2);
  endTurn(game.engine, P2);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2, "they did not use it, so it does not move back");
  assert.equal(tokensOn(game.engine, game.id("vm")), 1);
});

clause(VAST, "0:ability:you-know-you-want-to", "the opponent controlling it can use it: they pay 1, damage THEIR faction and draw, and at the end of THEIR turn it goes back to me with another token", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  endTurn(game.engine, P1);
  const theirHand = handOf(game.engine, P2).length;
  const theirReady = ready(game.engine, P2);
  vastUseAndResolve(game, P2);
  assert.equal(influenceOf(game.engine, P2), START - 1, "their faction took the damage");
  assert.equal(influenceOf(game.engine, P1), START - 1, "mine only took the damage from my own use");
  assert.equal(handOf(game.engine, P2).length, theirHand + 1, "they drew");
  assert.ok(theirReady - ready(game.engine, P2) >= 1, "theirReady - ready(game.engine, P2) >= 1");
  endTurn(game.engine, P2);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1, "its controller's opponent (me) takes it back");
  assert.equal(tokensOn(game.engine, game.id("vm")), 2);
});

clause(VAST, "0:ability:you-know-you-want-to", "only its controller can use it: not the opponent, not from hand, and not face-down", () => {
  const opp = vastBoard();
  refused(() => vastUse(opp, P2), "the opponent does not control it");
  const hand = vastBoard({ zone: "hand" });
  refused(() => vastUse(hand), "in hand");
  const down = vastBoard({ faceDown: true });
  refused(() => vastUse(down), "face-down");
  assert.equal(influenceOf(opp.engine, P1), START);
  assert.equal(influenceOf(opp.engine, P2), START);
});

clause(VAST, "0:ability:you-know-you-want-to", "it can be used as a response, e.g. to the opponent's attack: the control change then happens at the end of THAT (their) turn", () => {
  const game = vastBoard({ turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  vastUse(game);
  resolvePendingResponses(game.engine);
  assert.equal(influenceOf(game.engine, P1), START - 1);
  assert.equal(controllerOf(game.engine, game.id("vm")), P1, "not yet");
  assert.equal(tokensOn(game.engine, game.id("vm")), 0);
  declareBlockers(game.engine, P1, []);
  finishBattle(game.engine, undefined, declineAll);
  endTurn(game.engine, P2);
  assert.equal(tokensOn(game.engine, game.id("vm")), 1, "the end of the turn it was used in");
  assert.equal(controllerOf(game.engine, game.id("vm")), P2, "the opponent (of its controller, me) takes it");
});

clause(VAST, "0:ability:you-know-you-want-to", "if the Mastabatorium has left play by the end of the turn, nothing happens: no token, no control change", () => {
  const game = vastBoard({ extra: [{ key: "kill", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  vastUseAndResolve(game);
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("vm")] } });
  assert.equal(zoneOf(game.engine, game.id("vm")), "discard");
  endTurn(game.engine, P1);
  assert.equal(zoneOf(game.engine, game.id("vm")), "discard", "it stays in the discard pile");
  assert.equal(tokensOn(game.engine, game.id("vm")), 0, "no token on a card that is not in play");
});

clause(VAST, "0:ability:you-know-you-want-to", "drawing from an empty deck draws nothing, the cost is still paid, and the end-of-turn part still happens", () => {
  const game = vastBoard({ extra: [] });
  for (const id of deckOf(game.engine, P1)) game.engine.state.cards[id].zone = "discard";
  game.engine.state.players[P1].deck.length = 0;
  const handBefore = handOf(game.engine, P1).length;
  vastUseAndResolve(game);
  assert.equal(handOf(game.engine, P1).length, handBefore, "no card to draw (CR 306.2)");
  assert.equal(influenceOf(game.engine, P1), START - 1);
  endTurn(game.engine, P1);
  assert.equal(tokensOn(game.engine, game.id("vm")), 1);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2);
});

// --- SWEET RELEASE ---

clause(VAST, "1:ability:sweet-release", "pays exactly 2 resources and removes exactly one token as a cost (before the opponent can respond)", () => {
  const game = vastBoard({ tokens: 3 });
  const readyBefore = ready(game.engine);
  vastRelease(game);
  assert.equal(readyBefore - ready(game.engine), 2, "2 resources paid at once");
  assert.equal(tokensOn(game.engine, game.id("vm")), 2, "one token removed at once");
  assert.equal(game.engine.state.priorityPlayerId, P2);
});

clause(VAST, "1:ability:sweet-release", "it cannot be used with no token on the card, and nothing is paid", () => {
  const bad = vastBoard({ tokens: 0 });
  const readyBefore = ready(bad.engine);
  refused(() => vastRelease(bad), "no token to remove");
  assert.equal(ready(bad.engine), readyBefore, "nothing paid");
  assert.equal(bad.engine.state.responseWindow, undefined);
  const good = vastBoard({ tokens: 1 });
  vastRelease(good);
  assert.equal(tokensOn(good.engine, good.id("vm")), 0, "control: with one token it works and removes it");
});

clause(VAST, "1:ability:sweet-release", "it is refused with only 1 resource, and no token is removed", () => {
  const bad = vastBoard({ tokens: 2, p1Resources: 1 });
  refused(() => vastRelease(bad), "one resource short of 2");
  assert.equal(tokensOn(bad.engine, bad.id("vm")), 2);
  assert.equal(ready(bad.engine), 1);
});

clause(VAST, "1:ability:sweet-release", "spent (attached) resources cannot pay the 2", () => {
  const bad = vastBoard({ tokens: 2, p1Resources: 1, extra: spent({ deception: 3 }) });
  refused(() => vastRelease(bad), "only 1 ready resource");
  assert.equal(tokensOn(bad.engine, bad.id("vm")), 2);
});

clause(VAST, "1:ability:sweet-release", "'You may play a resource': a real resource card from my hand is played face-up and provides its icon", () => {
  const game = vastBoard({ tokens: 1 });
  const rageBefore = icons(game.engine, P1).rage ?? 0;
  vastRelease(game);
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1, "I choose");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("rageRes")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("rageRes")), "play");
  assert.equal(game.engine.state.cards[game.id("rageRes")].faceDown, false, "an actual resource card is played face-up");
  assert.equal(icons(game.engine, P1).rage ?? 0, rageBefore + 1, "it provides [R]");
  assert.equal(controllerOf(game.engine, game.id("rageRes")), P1);
});

clause(VAST, "1:ability:sweet-release", "any card may be played as a resource (face-down): a character from my hand becomes a face-down Volition resource", () => {
  const game = vastBoard({ tokens: 1 });
  const volBefore = icons(game.engine, P1).volition ?? 0;
  vastRelease(game);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("handChar")] });
  assert.equal(zoneOf(game.engine, game.id("handChar")), "play");
  assert.equal(game.engine.state.cards[game.id("handChar")].faceDown, true, "a non-resource card can only be played face-down (CR 203.2)");
  assert.equal(icons(game.engine, P1).volition ?? 0, volBefore + 1);
});

clause(VAST, "1:ability:sweet-release", "'play a resource' lets me choose face-up or face-down (CR 203.2): a real resource card can be played FACE-DOWN", () => {
  // The engine decides face-up/face-down itself for this effect (faceDown: "auto"). The card says "You may play a resource", and playing
  // a resource always carries the choice of orientation (CR 203.2: "When you play a resource you choose face-up or face-down.").
  const game = vastBoard({ tokens: 1 });
  vastRelease(game);
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  assert.ok(pc, "I am asked");
  game.engine.perform({ type: "resolvePendingChoice", playerId: P1, choice: { kind: "chooserSelectsTarget", selected: [game.id("rageRes")], faceDown: true } } as never);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("rageRes")), "play");
  assert.equal(game.engine.state.cards[game.id("rageRes")].faceDown, true, "I chose to play it face-down");
});

clause(VAST, "1:ability:sweet-release", "'You may': I can decline to play any resource (the cost is already paid)", () => {
  const game = vastBoard({ tokens: 1 });
  const handBefore = handOf(game.engine, P1).length;
  vastRelease(game);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(handOf(game.engine, P1).length, handBefore, "no card left my hand");
  assert.equal(tokensOn(game.engine, game.id("vm")), 0, "the token is gone regardless");
  assert.equal(ready(game.engine), 8 - 2);
});

clause(VAST, "1:ability:sweet-release", "the resource must come from MY hand: a card in my deck, in my discard pile or in their hand is refused", () => {
  const game = vastBoard({ tokens: 1, extra: [{ key: "inDiscard", def: character({ name: "My Discard" }), owner: P1, zone: "discard" }] });
  vastRelease(game);
  resolvePendingResponses(game.engine);
  for (const key of ["a0", "inDiscard", "theirRes", "theirChar"]) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] }), `${key} is not in my hand`);
  }
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the choice is still open");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("handChar")] });
  assert.equal(zoneOf(game.engine, game.id("handChar")), "play", "control: a card in my hand works");
});

clause(VAST, "1:ability:sweet-release", "only one resource is played, not two", () => {
  const game = vastBoard({ tokens: 1 });
  vastRelease(game);
  resolvePendingResponses(game.engine);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("rageRes"), game.id("handChar")] }), "two resources");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("rageRes")] });
  assert.equal(zoneOf(game.engine, game.id("handChar")), "hand");
});

clause(VAST, "1:ability:sweet-release", "with an empty hand there is nothing to play, and the ability still resolves without trouble", () => {
  const game = vastBoard({ tokens: 1 });
  for (const key of ["rageRes", "handChar"]) game.engine.state.cards[game.id(key)].zone = "discard";
  game.engine.state.players[P1].hand.length = 0;
  vastRelease(game);
  resolvePendingResponses(game.engine);
  const pc = pending(game.engine);
  if (pc) answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(tokensOn(game.engine, game.id("vm")), 0);
});

clause(VAST, "1:ability:sweet-release", "playing a resource this way does not use up the Develop Rule: I can still develop afterwards", () => {
  const game = vastBoard({ tokens: 1, extra: [{ key: "devRes", def: stapleCard("greed", "Dev Greed"), owner: P1, zone: "hand" }] });
  vastRelease(game);
  resolvePendingResponses(game.engine);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("rageRes")] });
  assert.ok(developOffers(game.engine, P1).length > 0, "the Develop Rule is untouched");
  developResource(game.engine, P1, game.id("devRes"), false);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("devRes")), "play", "the Develop Rule still works");
});

clause(VAST, "1:ability:sweet-release", "it works for whoever controls the Mastabatorium: the opponent, after taking control, plays a resource from THEIR hand", () => {
  const game = vastBoard();
  vastUseAndResolve(game);
  endTurn(game.engine, P1);
  assert.equal(controllerOf(game.engine, game.id("vm")), P2);
  const readyBefore = ready(game.engine, P2);
  vastRelease(game, P2);
  resolvePendingResponses(game.engine);
  assert.equal(readyBefore - ready(game.engine, P2), 2, "they pay the 2");
  assert.equal(tokensOn(game.engine, game.id("vm")), 0, "their token removal");
  const pc = expectPending(game.engine, "chooserSelectsTarget");
  assert.equal(pc.playerId, P2);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("rageRes")] }), "my hand card is not theirs to play");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("theirRes")] });
  assert.equal(zoneOf(game.engine, game.id("theirRes")), "play");
  assert.equal(controllerOf(game.engine, game.id("theirRes")), P2);
});

clause(VAST, "1:ability:sweet-release", "only its controller can use it: not the opponent of the controller, not from hand, not face-down", () => {
  const opp = vastBoard({ tokens: 2 });
  refused(() => vastRelease(opp, P2), "the opponent does not control it");
  const hand = vastBoard({ tokens: 2, zone: "hand" });
  refused(() => vastRelease(hand), "in hand");
  const down = vastBoard({ tokens: 2, faceDown: true });
  refused(() => vastRelease(down), "face-down");
});

clause(VAST, "1:ability:sweet-release", "it can be used as often as there are tokens and resources: 3 tokens allow 3 uses", () => {
  const game = vastBoard({ tokens: 3, p1Resources: 8 });
  for (let i = 0; i < 3; i++) {
    vastRelease(game);
    resolvePendingResponses(game.engine);
    const pc = pending(game.engine);
    if (pc) answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  }
  assert.equal(tokensOn(game.engine, game.id("vm")), 0);
  assert.equal(ready(game.engine), 2, "3 uses x 2 resources");
  refused(() => vastRelease(game), "no tokens left");
});

// --- the card itself ---

clause(VAST, "0:ability:you-know-you-want-to", "it deploys as a cost-2 [D][D] location with structure 4: destroyed by 4 damage, not by 3", () => {
  const board = (icons: Icons) => devBoard([{ key: "vm", def: printing(VAST), owner: P1, zone: "hand" }, ...res(icons)]);
  const good = board({ deception: 2 });
  play(good.engine, P1, good.id("vm"));
  assert.equal(zoneOf(good.engine, good.id("vm")), "play");
  assert.equal(ready(good.engine), 0, "exactly 2 paid");
  // [D][D] met by already-spent Deception, so only the cost (1 ready of 2) can refuse
  const short = devBoard([{ key: "vm", def: printing(VAST), owner: P1, zone: "hand" }, ...res({ rage: 1 }), ...spent({ deception: 2 })]);
  refused(() => playRaw(short.engine, P1, short.id("vm")), "one short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  const wrong = board({ rage: 5 });
  refused(() => playRaw(wrong.engine, P1, wrong.id("vm")), "no [D]", /Threshold requirements are not met/);
  const oneD = board({ deception: 1, rage: 4 });
  refused(() => playRaw(oneD.engine, P1, oneD.id("vm")), "one [D] is not [D][D]", /Threshold requirements are not met/);
  assert.equal(zoneOf(oneD.engine, oneD.id("vm")), "hand");
  const hit = (amount: number) =>
    tactic({
      name: `Hit Place ${amount}`,
      cost: 0,
      behavior: { abilities: [{ id: "hp", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "location" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }] }] }
    });
  const three = vastBoard({ extra: [{ key: "hit", def: hit(3), owner: P1, zone: "hand" }] });
  play(three.engine, P1, three.id("hit"), { selected: { t: [three.id("vm")] } });
  assert.equal(zoneOf(three.engine, three.id("vm")), "play", "3 damage < structure 4");
  const four = vastBoard({ extra: [{ key: "hit", def: hit(4), owner: P1, zone: "hand" }] });
  play(four.engine, P1, four.id("hit"), { selected: { t: [four.id("vm")] } });
  assert.equal(zoneOf(four.engine, four.id("vm")), "discard", "4 damage destroys it");
});

// =============================================================================
// The five Crests (Seed 2) — Item, universal, crest, cost 0
//   UNIQUE CREST
//   PROVIDES: [X][X]
//   If a card that provides at least [X] enters play under your control, you may ...
//     Deception: pick a character. If you do, that character loses 1 life this turn.
//     Elitism:   put a Micromajig token into play under your control.
//     Greed:     pick a faction. If you do, it gains 2 influence.
//     Obsession: search your deck for a tactic and reveal it. If you do, put it on top of your deck.
//     Rage:      search your deck for a character and reveal it. If you do, put it on top of your deck.
// =============================================================================

const CREST_D = "0786957e-6db1-42f2-b8cd-0162b889d0b9";
const CREST_E = "29786d2d-d558-4aec-9bb4-220601822bc4";
const CREST_G = "c8205cbe-f1dd-43c0-be10-84f527c7f792";
const CREST_O = "351670b7-13a8-4398-a4f9-416e5ec9eb31";
const CREST_R = "9b44d317-14f6-4647-96cb-4a6a5166dc50";

interface CrestSpec {
  id: string;
  name: string;
  icon: StapleIcon;
  /** The kind of pending choice the rule opens when it triggers. */
  prompt: string;
}

const SPEC_D: CrestSpec = { id: CREST_D, name: "Crest of Deception", icon: "deception", prompt: "chooserSelectsTarget" };
const SPEC_E: CrestSpec = { id: CREST_E, name: "Crest of Elitism", icon: "elitism", prompt: "mayPay" };
const SPEC_G: CrestSpec = { id: CREST_G, name: "Crest of Greed", icon: "greed", prompt: "chooserSelectsTarget" };
const SPEC_O: CrestSpec = { id: CREST_O, name: "Crest of Obsession", icon: "obsession", prompt: "chooserSelectsTarget" };
const SPEC_R: CrestSpec = { id: CREST_R, name: "Crest of Rage", icon: "rage", prompt: "chooserSelectsTarget" };

type IconName = "deception" | "rage" | "greed" | "elitism" | "obsession";
const otherIcon = (icon: StapleIcon): IconName => (icon === "rage" ? "greed" : "rage");

interface CrestOpts {
  zone?: Zone;
  faceDown?: boolean;
  /** A second Crest-designation card or other cards. */
  extra?: CardPlacement[];
  turn?: number;
  active?: PlayerId;
  noCrest?: boolean;
}

/**
 * P1 has the Crest "crest" in play, and in hand: a staple of the Crest's icon
 * "stap", a staple of another icon "otherStap", providers "prov" (character,
 * [X]), "provItem" (item, [X]), "provMixed" ([other][X]), "provDouble" ([X][X]),
 * "provOther" ([other]), and a plain character "plain"; a free put-into-play
 * tactic "put". On the board: P1's "mine" (life 3) and P2's "foe" (life 3),
 * "foeDamaged" (life 3, 2 damage). P1's deck s0..s7: item, char, TACTIC, char,
 * TACTIC, item, char, TACTIC; P2's deck o0..o2: tactic, char, char.
 */
function crestBoard(spec: CrestSpec, opts: CrestOpts = {}) {
  const other = otherIcon(spec.icon);
  const deckKinds: DeckKind[] = ["item", "char", "tactic", "char", "tactic", "item", "char", "tactic"];
  const mk = (kind: DeckKind, i: number): CardDefinition =>
    kind === "char" ? character({ name: `Deck Char ${i}`, cost: 1 }) : kind === "item" ? item({ name: `Deck Item ${i}`, cost: 1 }) : tactic({ name: `Deck Tactic ${i}`, cost: 1 });
  return devBoard(
    [
      ...(opts.noCrest ? [] : [{ key: "crest", def: printing(spec.id), owner: P1, zone: opts.zone ?? "play", faceDown: opts.faceDown } as CardPlacement]),
      { key: "stap", def: stapleCard(spec.icon, `Staple ${spec.icon}`), owner: P1, zone: "hand" },
      { key: "otherStap", def: stapleCard(other, `Staple ${other}`), owner: P1, zone: "hand" },
      { key: "prov", def: providerChar("Provider", [spec.icon]), owner: P1, zone: "hand" },
      { key: "provItem", def: providerItem("Provider Item", [spec.icon]), owner: P1, zone: "hand" },
      { key: "provMixed", def: providerItem("Mixed Provider", [other, spec.icon]), owner: P1, zone: "hand" },
      { key: "provDouble", def: providerItem("Double Provider", [spec.icon, spec.icon]), owner: P1, zone: "hand" },
      { key: "provOther", def: providerItem("Other Provider", [other]), owner: P1, zone: "hand" },
      { key: "plain", def: character({ name: "Plain", cost: 0 }), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic(), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "My Character", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "foeDamaged", def: character({ name: "Damaged Foe", cost: 1, strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play", damage: 2 },
      ...deckKinds.map((kind, i): CardPlacement => ({ key: `s${i}`, def: mk(kind, i), owner: P1, zone: "deck" })),
      { key: "o0", def: tactic({ name: "Their Tactic", cost: 1 }), owner: P2, zone: "deck" },
      { key: "o1", def: character({ name: "Their Char", cost: 1 }), owner: P2, zone: "deck" },
      { key: "o2", def: character({ name: "Their Char Two", cost: 1 }), owner: P2, zone: "deck" },
      ...(opts.extra ?? [])
    ],
    { turn: opts.turn ?? 1, activePlayerId: opts.active ?? P1, random: lcg(17) }
  );
}
type CrestGame = ReturnType<typeof crestBoard>;

/** Plays the card `key` from my hand, as the Develop Rule's resource play (face-up unless `down`). */
function crestDevelop(game: CrestGame, key: string, down = false): void {
  developResource(game.engine, P1, game.id(key), down);
  resolvePendingResponses(game.engine);
}

/** Deploys `key` from my hand (cost 0). */
function crestDeploy(game: CrestGame, key: string): void {
  play(game.engine, P1, game.id(key));
}

/** Puts `key` from my hand into play with the free put-into-play tactic. */
function crestPut(game: CrestGame, key: string): void {
  play(game.engine, P1, game.id("put"), { selected: { t: [game.id(key)] } });
}

const promptOpen = (game: CrestGame, spec: CrestSpec): boolean => pending(game.engine)?.kind === spec.prompt;

/** Declines the Crest's "you may": picks nothing / pays nothing. */
function crestDecline(game: CrestGame, spec: CrestSpec): void {
  expectPending(game.engine, spec.prompt);
  if (spec.prompt === "mayPay") answerPending(game.engine, "mayPay", { pay: false });
  else answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
}

/** After the trigger fired, the rule has opened its prompt for me exactly once: answer by declining and nothing else is pending. */
function assertFiredOnce(game: CrestGame, spec: CrestSpec, why: string): void {
  assert.ok(promptOpen(game, spec), `${why}: the Crest's rule triggered`);
  assert.equal(pending(game.engine)?.playerId, P1, `${why}: its controller decides`);
  crestDecline(game, spec);
  assert.equal(game.engine.state.pendingChoice, undefined, `${why}: it triggered exactly once`);
}

function assertNotFired(game: CrestGame, why: string): void {
  assert.equal(game.engine.state.pendingChoice, undefined, `${why}: the Crest's rule did not trigger`);
}

// --- shared bodies, one literal call per printing ---------------------------------------

const uniqueTwoBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec, { extra: [{ key: "crest2", def: printing(spec.id), owner: P1, zone: "hand" }] });
  crestDeploy(game, "crest2");
  // the second Crest's own rule may trigger as well: answer whatever shows up, keeping the first
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(game.engine)!;
    if (pc.kind === "uniqueSurvivor") {
      assert.equal(pc.playerId, P1, "the controller chooses which to keep (FAQ)");
      answerPending(game.engine, "uniqueSurvivor", { keep: game.id("crest") });
    } else {
      answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
    }
  }
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("crest")), "play", "the Crest I chose stays");
  assert.equal(zoneOf(game.engine, game.id("crest2")), "discard", "the other copy is destroyed");
};
clause(CREST_D, "0:unique", "controlling two Crests of Deception forces me to keep one and destroy the other", uniqueTwoBody(SPEC_D));
clause(CREST_E, "0:unique", "controlling two Crests of Elitism forces me to keep one and destroy the other", uniqueTwoBody(SPEC_E));
clause(CREST_G, "0:unique", "controlling two Crests of Greed forces me to keep one and destroy the other", uniqueTwoBody(SPEC_G));
clause(CREST_O, "0:unique", "controlling two Crests of Obsession forces me to keep one and destroy the other", uniqueTwoBody(SPEC_O));
clause(CREST_R, "0:unique", "controlling two Crests of Rage forces me to keep one and destroy the other", uniqueTwoBody(SPEC_R));

const uniqueKeepNewBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec, { extra: [{ key: "crest2", def: printing(spec.id), owner: P1, zone: "hand" }] });
  crestDeploy(game, "crest2");
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(game.engine)!;
    if (pc.kind === "uniqueSurvivor") answerPending(game.engine, "uniqueSurvivor", { keep: game.id("crest2") });
    else answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  }
  assert.equal(game.engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(zoneOf(game.engine, game.id("crest2")), "play", "the new Crest stays when I choose it");
  assert.equal(zoneOf(game.engine, game.id("crest")), "discard");
};
clause(CREST_D, "0:unique", "I may keep the NEW Crest of Deception instead", uniqueKeepNewBody(SPEC_D));
clause(CREST_E, "0:unique", "I may keep the NEW Crest of Elitism instead", uniqueKeepNewBody(SPEC_E));
clause(CREST_G, "0:unique", "I may keep the NEW Crest of Greed instead", uniqueKeepNewBody(SPEC_G));
clause(CREST_O, "0:unique", "I may keep the NEW Crest of Obsession instead", uniqueKeepNewBody(SPEC_O));
clause(CREST_R, "0:unique", "I may keep the NEW Crest of Rage instead", uniqueKeepNewBody(SPEC_R));

const uniqueCrossBody = (spec: CrestSpec) => () => {
  // any other card carrying UNIQUE CREST conflicts too, whatever its name (here: a different real Crest)
  const otherCrest = spec.id === CREST_D ? CREST_R : CREST_D;
  const game = crestBoard(spec, { extra: [{ key: "crest2", def: printing(otherCrest), owner: P1, zone: "hand" }] });
  crestDeploy(game, "crest2");
  let sawConflict = false;
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(game.engine)!;
    if (pc.kind === "uniqueSurvivor") {
      sawConflict = true;
      answerPending(game.engine, "uniqueSurvivor", { keep: game.id("crest") });
    } else {
      answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
    }
  }
  assert.ok(sawConflict, "two different Crests carry the same UNIQUE CREST designation");
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
  assert.equal(zoneOf(game.engine, game.id("crest2")), "discard");
};
clause(CREST_D, "0:unique", "a Crest of Rage conflicts with a Crest of Deception (the designation is CREST, not the name)", uniqueCrossBody(SPEC_D));
clause(CREST_E, "0:unique", "a Crest of Deception conflicts with a Crest of Elitism", uniqueCrossBody(SPEC_E));
clause(CREST_G, "0:unique", "a Crest of Deception conflicts with a Crest of Greed", uniqueCrossBody(SPEC_G));
clause(CREST_O, "0:unique", "a Crest of Deception conflicts with a Crest of Obsession", uniqueCrossBody(SPEC_O));
clause(CREST_R, "0:unique", "a Crest of Deception conflicts with a Crest of Rage", uniqueCrossBody(SPEC_R));

const uniqueOpponentBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec, { extra: [{ key: "theirCrest", def: printing(spec.id), owner: P2, zone: "play" }] });
  assert.equal(game.engine.state.pendingChoice, undefined, "the opponent's own Crest is no conflict (FAQ)");
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirCrest")), "play");
};
clause(CREST_D, "0:unique", "the opponent's own Crest of Deception is no conflict", uniqueOpponentBody(SPEC_D));
clause(CREST_E, "0:unique", "the opponent's own Crest of Elitism is no conflict", uniqueOpponentBody(SPEC_E));
clause(CREST_G, "0:unique", "the opponent's own Crest of Greed is no conflict", uniqueOpponentBody(SPEC_G));
clause(CREST_O, "0:unique", "the opponent's own Crest of Obsession is no conflict", uniqueOpponentBody(SPEC_O));
clause(CREST_R, "0:unique", "the opponent's own Crest of Rage is no conflict", uniqueOpponentBody(SPEC_R));

const uniqueOtherDesignationBody = (spec: CrestSpec) => () => {
  const stranger = item({ name: "Not A Crest", cost: 0, unique: "something-else" });
  const game = crestBoard(spec, { extra: [{ key: "stranger", def: stranger, owner: P1, zone: "hand" }] });
  crestDeploy(game, "stranger");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("stranger")), "play");
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
};
clause(CREST_D, "0:unique", "a card with another UNIQUE designation does not conflict with the Crest of Deception", uniqueOtherDesignationBody(SPEC_D));
clause(CREST_E, "0:unique", "a card with another UNIQUE designation does not conflict with the Crest of Elitism", uniqueOtherDesignationBody(SPEC_E));
clause(CREST_G, "0:unique", "a card with another UNIQUE designation does not conflict with the Crest of Greed", uniqueOtherDesignationBody(SPEC_G));
clause(CREST_O, "0:unique", "a card with another UNIQUE designation does not conflict with the Crest of Obsession", uniqueOtherDesignationBody(SPEC_O));
clause(CREST_R, "0:unique", "a card with another UNIQUE designation does not conflict with the Crest of Rage", uniqueOtherDesignationBody(SPEC_R));

const uniqueStealBody = (spec: CrestSpec) => () => {
  // taking control of the opponent's Crest while I control mine is a conflict, resolved by my choice
  const game = crestBoard(spec, {
    extra: [
      { key: "theirCrest", def: printing(spec.id), owner: P2, zone: "play" },
      { key: "steal", def: stealItemTactic(), owner: P1, zone: "hand" }
    ]
  });
  play(game.engine, P1, game.id("steal"), { selected: { t: [game.id("theirCrest")] } });
  let sawConflict = false;
  let guard = 0;
  while (game.engine.state.pendingChoice && guard++ < 10) {
    const pc = pending(game.engine)!;
    if (pc.kind === "uniqueSurvivor") {
      sawConflict = true;
      answerPending(game.engine, "uniqueSurvivor", { keep: game.id("crest") });
    } else answerPending(game.engine, pc.kind, declineAll(pc) as Record<string, unknown>);
  }
  assert.ok(sawConflict, "I now control two Crests");
  assert.equal(game.engine.state.pendingChoice, undefined, "the game is not stuck");
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
  assert.equal(zoneOf(game.engine, game.id("theirCrest")), "discard");
};

/** A free tactic (id "sti", pick "t"): take control of one picked item the opponent controls. */
function stealItemTactic(): CardDefinition {
  return tactic({
    name: "Steal An Item",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "sti",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item", controller: "opponent" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
}
clause(CREST_D, "0:unique", "taking control of the opponent's Crest of Deception while I have mine is a conflict I resolve", uniqueStealBody(SPEC_D));
clause(CREST_E, "0:unique", "taking control of the opponent's Crest of Elitism while I have mine is a conflict I resolve", uniqueStealBody(SPEC_E));
clause(CREST_G, "0:unique", "taking control of the opponent's Crest of Greed while I have mine is a conflict I resolve", uniqueStealBody(SPEC_G));
clause(CREST_O, "0:unique", "taking control of the opponent's Crest of Obsession while I have mine is a conflict I resolve", uniqueStealBody(SPEC_O));
clause(CREST_R, "0:unique", "taking control of the opponent's Crest of Rage while I have mine is a conflict I resolve", uniqueStealBody(SPEC_R));

// --- PROVIDES: [X][X] ---

const providesBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  const t = icons(game.engine, P1);
  assert.equal(t[spec.icon] ?? 0, 2, `exactly two [${spec.icon}]`);
  for (const icon of ["rage", "greed", "elitism", "obsession", "deception"] as const) {
    if (icon !== spec.icon) assert.equal(t[icon] ?? 0, 0, `no [${icon}]`);
  }
  assert.equal(icons(game.engine, P2)[spec.icon] ?? 0, 0, "none for the opponent");
};
clause(CREST_D, "1:provides", "in play it provides exactly [D][D], to its controller only", providesBody(SPEC_D));
clause(CREST_E, "1:provides", "in play it provides exactly [E][E], to its controller only", providesBody(SPEC_E));
clause(CREST_G, "1:provides", "in play it provides exactly [G][G], to its controller only", providesBody(SPEC_G));
clause(CREST_O, "1:provides", "in play it provides exactly [O][O], to its controller only", providesBody(SPEC_O));
clause(CREST_R, "1:provides", "in play it provides exactly [R][R], to its controller only", providesBody(SPEC_R));

const providesNowhereElseBody = (spec: CrestSpec) => () => {
  for (const zone of ["hand", "deck", "discard"] as const) {
    const game = crestBoard(spec, { zone });
    assert.equal(icons(game.engine, P1)[spec.icon] ?? 0, 0, `${zone}: nothing provided`);
  }
  const down = crestBoard(spec, { faceDown: true });
  assert.equal(icons(down.engine, P1)[spec.icon] ?? 0, 0, "face-down it provides no [X]");
  assert.equal(icons(down.engine, P1).volition ?? 0, 1, "face-down it provides one Volition instead (CR 411.1)");
};
clause(CREST_D, "1:provides", "it provides nothing in hand, deck or discard, and only Volition face-down", providesNowhereElseBody(SPEC_D));
clause(CREST_E, "1:provides", "it provides nothing in hand, deck or discard, and only Volition face-down", providesNowhereElseBody(SPEC_E));
clause(CREST_G, "1:provides", "it provides nothing in hand, deck or discard, and only Volition face-down", providesNowhereElseBody(SPEC_G));
clause(CREST_O, "1:provides", "it provides nothing in hand, deck or discard, and only Volition face-down", providesNowhereElseBody(SPEC_O));
clause(CREST_R, "1:provides", "it provides nothing in hand, deck or discard, and only Volition face-down", providesNowhereElseBody(SPEC_R));

const providesThresholdBody = (spec: CrestSpec) => () => {
  const letter = { deception: "d", elitism: "e", greed: "g", obsession: "o", rage: "r" }[spec.icon];
  const needs2 = character({ name: "Needs Two", cost: 0, threshold: `${letter}${letter}` });
  const needs3 = character({ name: "Needs Three", cost: 0, threshold: `${letter}${letter}${letter}` });
  const base = (extra: CardPlacement[]) =>
    devBoard([{ key: "crest", def: printing(spec.id), owner: P1, zone: "play" }, { key: "n2", def: needs2, owner: P1, zone: "hand" }, { key: "n3", def: needs3, owner: P1, zone: "hand" }, ...extra]);
  const two = base([]);
  play(two.engine, P1, two.id("n2"));
  assert.equal(zoneOf(two.engine, two.id("n2")), "play", "the Crest alone meets a two-icon threshold");
  const three = base([]);
  refused(() => playRaw(three.engine, P1, three.id("n3")), "two icons are not three");
  assert.equal(zoneOf(three.engine, three.id("n3")), "hand");
  const plusOne = base(res({ [spec.icon]: 1 } as Icons));
  play(plusOne.engine, P1, plusOne.id("n3"));
  assert.equal(zoneOf(plusOne.engine, plusOne.id("n3")), "play", "the Crest's two plus a third source meet a three-icon threshold");
};
clause(CREST_D, "1:provides", "its [D][D] count toward thresholds: it alone meets [D][D], and with one more [D] meets [D][D][D]", providesThresholdBody(SPEC_D));
clause(CREST_E, "1:provides", "its [E][E] count toward thresholds: it alone meets [E][E], and with one more [E] meets [E][E][E]", providesThresholdBody(SPEC_E));
clause(CREST_G, "1:provides", "its [G][G] count toward thresholds: it alone meets [G][G], and with one more [G] meets [G][G][G]", providesThresholdBody(SPEC_G));
clause(CREST_O, "1:provides", "its [O][O] count toward thresholds: it alone meets [O][O], and with one more [O] meets [O][O][O]", providesThresholdBody(SPEC_O));
clause(CREST_R, "1:provides", "its [R][R] count toward thresholds: it alone meets [R][R], and with one more [R] meets [R][R][R]", providesThresholdBody(SPEC_R));

const crestCostBody = (spec: CrestSpec) => () => {
  // cost 0, no threshold: deployable on my turn with no resources at all, and not on the opponent's turn
  const mine = devBoard([{ key: "crest", def: printing(spec.id), owner: P1, zone: "hand" }]);
  play(mine.engine, P1, mine.id("crest"));
  assert.equal(zoneOf(mine.engine, mine.id("crest")), "play", "free, with no resources");
  const theirs = devBoard([{ key: "crest", def: printing(spec.id), owner: P1, zone: "hand" }], { turn: 2, activePlayerId: P2 });
  refused(() => playRaw(theirs.engine, P1, theirs.id("crest")), "an item is deployed only on its controller's turn");
  assert.equal(zoneOf(theirs.engine, theirs.id("crest")), "hand");
};
clause(CREST_D, "1:provides", "a Crest of Deception costs nothing to deploy (cost 0, no threshold), on my turn only", crestCostBody(SPEC_D));
clause(CREST_E, "1:provides", "a Crest of Elitism costs nothing to deploy (cost 0, no threshold), on my turn only", crestCostBody(SPEC_E));
clause(CREST_G, "1:provides", "a Crest of Greed costs nothing to deploy (cost 0, no threshold), on my turn only", crestCostBody(SPEC_G));
clause(CREST_O, "1:provides", "a Crest of Obsession costs nothing to deploy (cost 0, no threshold), on my turn only", crestCostBody(SPEC_O));
clause(CREST_R, "1:provides", "a Crest of Rage costs nothing to deploy (cost 0, no threshold), on my turn only", crestCostBody(SPEC_R));

// --- the rule's trigger condition: If a card that provides at least [X] enters play under your control ---

const trigStapleBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDevelop(game, "stap");
  assert.equal(zoneOf(game.engine, game.id("stap")), "play");
  assert.equal(game.engine.state.cards[game.id("stap")].faceDown, false);
  assertFiredOnce(game, spec, "a face-up staple of the Crest's icon played with the Develop Rule");
};
clause(CREST_D, "2:rule", "triggers when I play a face-up Deception resource (once)", trigStapleBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers when I play a face-up Elitism resource (once)", trigStapleBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers when I play a face-up Greed resource (once)", trigStapleBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers when I play a face-up Obsession resource (once)", trigStapleBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers when I play a face-up Rage resource (once)", trigStapleBody(SPEC_R));

const trigCharBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDeploy(game, "prov");
  assertFiredOnce(game, spec, "a character providing the icon, deployed");
};
clause(CREST_D, "2:rule", "triggers when a character providing [D] is deployed", trigCharBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers when a character providing [E] is deployed", trigCharBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers when a character providing [G] is deployed", trigCharBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers when a character providing [O] is deployed", trigCharBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers when a character providing [R] is deployed", trigCharBody(SPEC_R));

const trigItemBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDeploy(game, "provItem");
  assertFiredOnce(game, spec, "an item providing the icon, deployed");
};
clause(CREST_D, "2:rule", "triggers when an item providing [D] is deployed", trigItemBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers when an item providing [E] is deployed", trigItemBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers when an item providing [G] is deployed", trigItemBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers when an item providing [O] is deployed", trigItemBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers when an item providing [R] is deployed", trigItemBody(SPEC_R));

const trigPutBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestPut(game, "prov");
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  assertFiredOnce(game, spec, "a providing card put into play by an effect");
};
clause(CREST_D, "2:rule", "triggers when a [D] card is put into play by an effect (not deployed)", trigPutBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers when an [E] card is put into play by an effect (not deployed)", trigPutBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers when a [G] card is put into play by an effect (not deployed)", trigPutBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers when an [O] card is put into play by an effect (not deployed)", trigPutBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers when an [R] card is put into play by an effect (not deployed)", trigPutBody(SPEC_R));

const trigMixedBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDeploy(game, "provMixed");
  assertFiredOnce(game, spec, "'at least': a card providing the icon and another one");
};
clause(CREST_D, "2:rule", "'at least [D]': a card providing [R] and [D] triggers it", trigMixedBody(SPEC_D));
clause(CREST_E, "2:rule", "'at least [E]': a card providing [R] and [E] triggers it", trigMixedBody(SPEC_E));
clause(CREST_G, "2:rule", "'at least [G]': a card providing [R] and [G] triggers it", trigMixedBody(SPEC_G));
clause(CREST_O, "2:rule", "'at least [O]': a card providing [R] and [O] triggers it", trigMixedBody(SPEC_O));
clause(CREST_R, "2:rule", "'at least [R]': a card providing [G] and [R] triggers it", trigMixedBody(SPEC_R));

const trigDoubleBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDeploy(game, "provDouble");
  assertFiredOnce(game, spec, "a card providing the icon twice triggers once, not twice");
};
clause(CREST_D, "2:rule", "a card providing [D][D] triggers it once, not twice", trigDoubleBody(SPEC_D));
clause(CREST_E, "2:rule", "a card providing [E][E] triggers it once, not twice", trigDoubleBody(SPEC_E));
clause(CREST_G, "2:rule", "a card providing [G][G] triggers it once, not twice", trigDoubleBody(SPEC_G));
clause(CREST_O, "2:rule", "a card providing [O][O] triggers it once, not twice", trigDoubleBody(SPEC_O));
clause(CREST_R, "2:rule", "a card providing [R][R] triggers it once, not twice", trigDoubleBody(SPEC_R));

const trigNearMissBody = (spec: CrestSpec) => () => {
  const cases: Array<[string, (g: CrestGame) => void]> = [
    ["a staple of ANOTHER icon", (g) => crestDevelop(g, "otherStap")],
    ["a card providing only another icon", (g) => crestDeploy(g, "provOther")],
    ["a plain card that provides nothing", (g) => crestDeploy(g, "plain")],
    ["the Crest's own icon played FACE-DOWN (a face-down card provides only Volition)", (g) => crestDevelop(g, "stap", true)],
    ["a card providing the icon, played face-down as a resource", (g) => crestDevelop(g, "prov", true)]
  ];
  for (const [why, act] of cases) {
    const game = crestBoard(spec);
    act(game);
    assertNotFired(game, why);
  }
  const control = crestBoard(spec);
  crestDevelop(control, "stap");
  assert.ok(promptOpen(control, spec), "control: the right card does trigger it");
};
clause(CREST_D, "2:rule", "does not trigger for a staple of another icon, a card providing only another icon, a plain card, or any face-down card", trigNearMissBody(SPEC_D));
clause(CREST_E, "2:rule", "does not trigger for a staple of another icon, a card providing only another icon, a plain card, or any face-down card", trigNearMissBody(SPEC_E));
clause(CREST_G, "2:rule", "does not trigger for a staple of another icon, a card providing only another icon, a plain card, or any face-down card", trigNearMissBody(SPEC_G));
clause(CREST_O, "2:rule", "does not trigger for a staple of another icon, a card providing only another icon, a plain card, or any face-down card", trigNearMissBody(SPEC_O));
clause(CREST_R, "2:rule", "does not trigger for a staple of another icon, a card providing only another icon, a plain card, or any face-down card", trigNearMissBody(SPEC_R));

const trigOpponentBody = (spec: CrestSpec) => () => {
  const theirs = crestBoard(spec, {
    turn: 2,
    active: P2,
    extra: [{ key: "theirProv", def: providerChar("Their Provider", [spec.icon]), owner: P2, zone: "hand" }]
  });
  play(theirs.engine, P2, theirs.id("theirProv"));
  assert.equal(zoneOf(theirs.engine, theirs.id("theirProv")), "play");
  assertNotFired(theirs, "a providing card entering play under the OPPONENT's control");
  const handedOver = crestBoard(spec, {
    extra: [
      { key: "mineProv", def: providerChar("My Provider", [spec.icon]), owner: P1, zone: "hand" },
      { key: "putTheirs", def: putFromHandTactic("opponent"), owner: P1, zone: "hand" }
    ]
  });
  play(handedOver.engine, P1, handedOver.id("putTheirs"), { selected: { t: [handedOver.id("mineProv")] } });
  assert.equal(controllerOf(handedOver.engine, handedOver.id("mineProv")), P2);
  assertNotFired(handedOver, "my providing card entering play under the opponent's control");
};
clause(CREST_D, "2:rule", "does not trigger for a [D] card entering play under the opponent's control", trigOpponentBody(SPEC_D));
clause(CREST_E, "2:rule", "does not trigger for an [E] card entering play under the opponent's control", trigOpponentBody(SPEC_E));
clause(CREST_G, "2:rule", "does not trigger for a [G] card entering play under the opponent's control", trigOpponentBody(SPEC_G));
clause(CREST_O, "2:rule", "does not trigger for an [O] card entering play under the opponent's control", trigOpponentBody(SPEC_O));
clause(CREST_R, "2:rule", "does not trigger for an [R] card entering play under the opponent's control", trigOpponentBody(SPEC_R));

const trigOwnEntryBody = (spec: CrestSpec) => () => {
  // User ruling 2026-10-27: the Crest must already be in play when an [X] card enters, so its own entry does not trigger it.
  const game = crestBoard(spec, { noCrest: true, extra: [{ key: "crest", def: printing(spec.id), owner: P1, zone: "hand" }] });
  crestDeploy(game, "crest");
  assert.equal(zoneOf(game.engine, game.id("crest")), "play");
  assertNotFired(game, "the Crest itself entering play (it provides [X][X])");
  crestDevelop(game, "stap");
  assertFiredOnce(game, spec, "the next [X] card entering play after the Crest");
};
clause(CREST_D, "2:rule", "the Crest's own entry does not trigger its rule (user ruling 2026-10-27): the next [D] card entering play does", trigOwnEntryBody(SPEC_D));
clause(CREST_E, "2:rule", "the Crest's own entry does not trigger its rule (user ruling 2026-10-27): the next [E] card entering play does", trigOwnEntryBody(SPEC_E));
clause(CREST_G, "2:rule", "the Crest's own entry does not trigger its rule (user ruling 2026-10-27): the next [G] card entering play does", trigOwnEntryBody(SPEC_G));
clause(CREST_O, "2:rule", "the Crest's own entry does not trigger its rule (user ruling 2026-10-27): the next [O] card entering play does", trigOwnEntryBody(SPEC_O));
clause(CREST_R, "2:rule", "the Crest's own entry does not trigger its rule (user ruling 2026-10-27): the next [R] card entering play does", trigOwnEntryBody(SPEC_R));

const trigNotInPlayBody = (spec: CrestSpec) => () => {
  for (const zone of ["hand", "discard", "deck"] as const) {
    const game = crestBoard(spec, { zone });
    crestDeploy(game, "prov");
    assertNotFired(game, `Crest in ${zone}`);
  }
  const down = crestBoard(spec, { faceDown: true });
  crestDeploy(down, "prov");
  assertNotFired(down, "a face-down Crest has no rules text (CR 411.1)");
};
clause(CREST_D, "2:rule", "does nothing while the Crest is in hand, deck or discard pile, or face-down", trigNotInPlayBody(SPEC_D));
clause(CREST_E, "2:rule", "does nothing while the Crest is in hand, deck or discard pile, or face-down", trigNotInPlayBody(SPEC_E));
clause(CREST_G, "2:rule", "does nothing while the Crest is in hand, deck or discard pile, or face-down", trigNotInPlayBody(SPEC_G));
clause(CREST_O, "2:rule", "does nothing while the Crest is in hand, deck or discard pile, or face-down", trigNotInPlayBody(SPEC_O));
clause(CREST_R, "2:rule", "does nothing while the Crest is in hand, deck or discard pile, or face-down", trigNotInPlayBody(SPEC_R));

const trigTwiceBody = (spec: CrestSpec) => () => {
  const game = crestBoard(spec);
  crestDeploy(game, "prov");
  assert.ok(promptOpen(game, spec), "first card");
  crestDecline(game, spec);
  crestDeploy(game, "provItem");
  assert.ok(promptOpen(game, spec), "second card: the rule triggers again, every time");
  crestDecline(game, spec);
  assert.equal(game.engine.state.pendingChoice, undefined);
};
clause(CREST_D, "2:rule", "triggers separately for each [D] card entering play (two cards, two triggers)", trigTwiceBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers separately for each [E] card entering play (two cards, two triggers)", trigTwiceBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers separately for each [G] card entering play (two cards, two triggers)", trigTwiceBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers separately for each [O] card entering play (two cards, two triggers)", trigTwiceBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers separately for each [R] card entering play (two cards, two triggers)", trigTwiceBody(SPEC_R));

const trigOpponentTurnBody = (spec: CrestSpec) => () => {
  // my card entering play under my control during the OPPONENT's turn (put into play in response) also triggers
  const game = crestBoard(spec, {
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playRaw(game.engine, P1, game.id("put"), { selected: { t: [game.id("prov")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("prov")), "play");
  assertFiredOnce(game, spec, "my card entering play on the opponent's turn");
};
clause(CREST_D, "2:rule", "triggers on the opponent's turn too, for my [D] card put into play in response", trigOpponentTurnBody(SPEC_D));
clause(CREST_E, "2:rule", "triggers on the opponent's turn too, for my [E] card put into play in response", trigOpponentTurnBody(SPEC_E));
clause(CREST_G, "2:rule", "triggers on the opponent's turn too, for my [G] card put into play in response", trigOpponentTurnBody(SPEC_G));
clause(CREST_O, "2:rule", "triggers on the opponent's turn too, for my [O] card put into play in response", trigOpponentTurnBody(SPEC_O));
clause(CREST_R, "2:rule", "triggers on the opponent's turn too, for my [R] card put into play in response", trigOpponentTurnBody(SPEC_R));

// --- Crest of Deception: you may pick a character. If you do, that character loses 1 life this turn. ---

/** Develops the Deception staple (the Crest triggers) and leaves the pick open. */
function deceptionOpen(extra: CardPlacement[] = []): CrestGame {
  const game = crestBoard(SPEC_D, { extra });
  crestDevelop(game, "stap");
  expectPending(game.engine, "chooserSelectsTarget");
  return game;
}
const lifeOfCrest = (game: CrestGame, key: string): number => game.engine.getStat(game.id(key), "life");

clause(CREST_D, "2:rule", "picking my own character: it loses 1 life this turn (3 becomes 2) and nothing else changes", () => {
  const game = deceptionOpen();
  assert.equal(pending(game.engine)?.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine")] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(lifeOfCrest(game, "mine"), 2);
  assert.deepEqual(stats(game.engine, game.id("mine")), [2, 2, 2], "only life changes");
  assert.equal(damageOn(game.engine, game.id("mine")), 0, "it is lost life, not damage");
  assert.equal(lifeOfCrest(game, "foe"), 3);
});

clause(CREST_D, "2:rule", "picking an opponent's character: it loses 1 life this turn", () => {
  const game = deceptionOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(lifeOfCrest(game, "foe"), 2);
  assert.equal(lifeOfCrest(game, "mine"), 3);
});

clause(CREST_D, "2:rule", "'you may': picking no character changes nothing", () => {
  const game = deceptionOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  for (const key of ["mine", "foe", "foeDamaged"]) assert.equal(lifeOfCrest(game, key), 3, key);
});

clause(CREST_D, "2:rule", "only the picked character is affected", () => {
  const game = deceptionOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(lifeOfCrest(game, "mine"), 3);
  assert.equal(lifeOfCrest(game, "foeDamaged"), 3);
});

clause(CREST_D, "2:rule", "'this turn': the life is back to 3 once the turn ends", () => {
  const game = deceptionOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine")] });
  assert.equal(lifeOfCrest(game, "mine"), 2);
  endTurn(game.engine, P1);
  assert.equal(lifeOfCrest(game, "mine"), 3, "the effect ended with the turn");
});

clause(CREST_D, "2:rule", "damage already on the character counts against the reduced life: 2 damage on a 3-life character reduced to 2 destroys it", () => {
  const game = deceptionOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foeDamaged")] });
  assert.equal(zoneOf(game.engine, game.id("foeDamaged")), "discard");
});

clause(CREST_D, "2:rule", "a character reduced to 0 life is destroyed (FAQ): a 1-life character picked by the Crest dies", () => {
  const game = deceptionOpen([{ key: "fragile", def: character({ name: "Fragile", cost: 1, life: 1 }), owner: P2, zone: "play" }]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("fragile")] });
  assert.equal(game.engine.getStat(game.id("fragile"), "life"), 0);
  assert.equal(zoneOf(game.engine, game.id("fragile")), "discard", "0 damage >= 0 life");
});

clause(CREST_D, "2:rule", "the pick must be a character in play: an item, a location, a face-down card, a faction, or a card in a hand or discard pile is refused", () => {
  const extra = [
    { key: "gadget", def: item({ name: "Gadget" }), owner: P2, zone: "play" as const },
    { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" as const },
    { key: "fdown", def: character({ name: "Face Down" }), owner: P2, zone: "play" as const, faceDown: true },
    { key: "inDiscard", def: character({ name: "In Discard" }), owner: P2, zone: "discard" as const },
    { key: "theirHand", def: character({ name: "Their Hand" }), owner: P2, zone: "hand" as const }
  ];
  const game = deceptionOpen(extra);
  for (const key of ["gadget", "place", "fdown", "inDiscard", "theirHand", "plain"]) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] }), `${key} is not a character in play`);
  }
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.engine.state.players[P2].factionId!] }), "a faction");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the pick is still open");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(lifeOfCrest(game, "foe"), 2, "control: a character works");
});

clause(CREST_D, "2:rule", "only one character can be picked, not two", () => {
  const game = deceptionOpen();
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine"), game.id("foe")] }), "two picks");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("mine")] });
  assert.equal(lifeOfCrest(game, "foe"), 3);
});

clause(CREST_D, "2:rule", "two [D] cards entering play give two picks: the same character loses 2 life, or two characters 1 each", () => {
  const same = crestBoard(SPEC_D);
  crestDeploy(same, "prov");
  answerPending(same.engine, "chooserSelectsTarget", { selected: [same.id("foe")] });
  crestDeploy(same, "provItem");
  answerPending(same.engine, "chooserSelectsTarget", { selected: [same.id("foe")] });
  assert.equal(lifeOfCrest(same, "foe"), 1, "3 - 1 - 1");
  const split = crestBoard(SPEC_D);
  crestDeploy(split, "prov");
  answerPending(split.engine, "chooserSelectsTarget", { selected: [split.id("foe")] });
  crestDeploy(split, "provItem");
  answerPending(split.engine, "chooserSelectsTarget", { selected: [split.id("mine")] });
  assert.equal(lifeOfCrest(split, "foe"), 2);
  assert.equal(lifeOfCrest(split, "mine"), 2);
});

clause(CREST_D, "2:rule", "the character that just entered play can be picked: a [D] character deployed with the Crest in play may pick itself", () => {
  const game = crestBoard(SPEC_D);
  crestDeploy(game, "prov");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("prov")] });
  assert.equal(lifeOfCrest(game, "prov"), 1, "the provider's own 2 life, minus 1");
});

// --- Crest of Elitism: you may put a Micromajig token into play under your control. ---

const micromajigs = (game: CrestGame, player: PlayerId = P1): CardInstanceId[] => inPlayNamed(game.engine, player, "Micromajig");

function elitismOpen(extra: CardPlacement[] = []): CrestGame {
  const game = crestBoard(SPEC_E, { extra });
  crestDevelop(game, "stap");
  expectPending(game.engine, "mayPay");
  return game;
}

clause(CREST_E, "2:rule", "saying yes puts exactly one Micromajig token into play under my control, at no cost", () => {
  const game = elitismOpen();
  assert.equal(pending(game.engine)?.playerId, P1);
  const readyBefore = ready(game.engine);
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(micromajigs(game).length, 1);
  assert.equal(micromajigs(game, P2).length, 0);
  assert.equal(ready(game.engine), readyBefore, "nothing paid");
});

clause(CREST_E, "2:rule", "'you may': saying no puts no token into play", () => {
  const game = elitismOpen();
  answerPending(game.engine, "mayPay", { pay: false });
  assert.equal(micromajigs(game).length, 0);
  assert.equal(game.engine.state.pendingChoice, undefined);
});

clause(CREST_E, "2:rule", "the token is a 1/1/3 character with the majig subtype, called Micromajig", () => {
  const game = elitismOpen();
  answerPending(game.engine, "mayPay", { pay: true });
  const [token] = micromajigs(game);
  assert.ok(token, "a token exists");
  const def = game.engine.getDefinition(token);
  assert.equal(def.type, "character");
  assert.equal(def.name, "Micromajig");
  assert.ok(def.subtype.includes("majig"), "subtype majig");
  assert.deepEqual(stats(game.engine, token), [1, 1, 3]);
});

clause(CREST_E, "2:rule", "the Micromajig token is a GEARSMITH character card (CR 409.3c), not a universal one", () => {
  const game = elitismOpen();
  answerPending(game.engine, "mayPay", { pay: true });
  const [token] = micromajigs(game);
  assert.equal(game.engine.getDefinition(token).trade, "gearsmith");
});

clause(CREST_E, "2:rule", "the token enters play under my control and, as a new arrival, cannot attack this turn", () => {
  const game = elitismOpen();
  answerPending(game.engine, "mayPay", { pay: true });
  const [token] = micromajigs(game);
  assert.equal(controllerOf(game.engine, token), P1);
  assert.equal(zoneOf(game.engine, token), "play");
  refused(() => declareAttackBy(game.engine, P1, [token]), "it did not start the turn in play");
});

clause(CREST_E, "2:rule", "the token is a token, not a card: destroyed, it does not land in a discard pile (CR 409.3a)", () => {
  const game = elitismOpen([{ key: "kill", def: destroyInPlayTactic(), owner: P1, zone: "hand" }]);
  answerPending(game.engine, "mayPay", { pay: true });
  const [token] = micromajigs(game);
  play(game.engine, P1, game.id("kill"), { selected: { t: [token] } });
  assert.equal(micromajigs(game).length, 0, "it is gone");
  assert.equal(discardOf(game.engine, P1).includes(token), false);
  assert.equal(discardOf(game.engine, P2).includes(token), false);
});

clause(CREST_E, "2:rule", "two [E] cards entering play give two tokens", () => {
  const game = crestBoard(SPEC_E);
  crestDeploy(game, "prov");
  answerPending(game.engine, "mayPay", { pay: true });
  crestDeploy(game, "provItem");
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(micromajigs(game).length, 2);
});

clause(CREST_E, "2:rule", "each trigger is its own choice: yes then no gives exactly one token", () => {
  const game = crestBoard(SPEC_E);
  crestDeploy(game, "prov");
  answerPending(game.engine, "mayPay", { pay: true });
  crestDeploy(game, "provItem");
  answerPending(game.engine, "mayPay", { pay: false });
  assert.equal(micromajigs(game).length, 1);
});

clause(CREST_E, "2:rule", "the token is not an [E] provider: it does not trigger the Crest again", () => {
  const game = elitismOpen();
  answerPending(game.engine, "mayPay", { pay: true });
  assert.equal(game.engine.state.pendingChoice, undefined, "no second prompt");
  assert.equal(micromajigs(game).length, 1);
});

// --- Crest of Greed: you may pick a faction. If you do, it gains 2 influence. ---

function greedOpen(extra: CardPlacement[] = []): CrestGame {
  const game = crestBoard(SPEC_G, { extra });
  crestDevelop(game, "stap");
  expectPending(game.engine, "chooserSelectsTarget");
  return game;
}
const myFaction = (game: CrestGame): CardInstanceId => game.engine.state.players[P1].factionId!;
const theirFaction = (game: CrestGame): CardInstanceId => game.engine.state.players[P2].factionId!;

clause(CREST_G, "2:rule", "picking my own faction: it gains 2 influence (30 becomes 32, above its starting influence)", () => {
  const game = greedOpen();
  assert.equal(pending(game.engine)?.playerId, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [myFaction(game)] });
  assert.equal(influenceOf(game.engine, P1), START + 2);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(CREST_G, "2:rule", "'a faction': I may pick the OPPONENT's faction: it gains 2 influence", () => {
  const game = greedOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [theirFaction(game)] });
  assert.equal(influenceOf(game.engine, P2), START + 2);
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(CREST_G, "2:rule", "'you may': picking no faction changes nothing", () => {
  const game = greedOpen();
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(influenceOf(game.engine, P1), START);
  assert.equal(influenceOf(game.engine, P2), START);
});

clause(CREST_G, "2:rule", "the pick must be a faction: a character, an item, or any other card is refused", () => {
  const game = greedOpen([{ key: "gadget", def: item({ name: "Gadget" }), owner: P1, zone: "play" }]);
  for (const key of ["mine", "foe", "gadget", "crest", "plain"]) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] }), `${key} is not a faction`);
  }
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [myFaction(game)] });
  assert.equal(influenceOf(game.engine, P1), START + 2, "control: a faction works");
});

clause(CREST_G, "2:rule", "only one faction can be picked: both at once is refused", () => {
  const game = greedOpen();
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [myFaction(game), theirFaction(game)] }), "two factions");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [theirFaction(game)] });
  assert.equal(influenceOf(game.engine, P1), START);
});

clause(CREST_G, "2:rule", "two [G] cards entering play give 2 + 2: +4 on one faction, or +2 on each", () => {
  const same = crestBoard(SPEC_G);
  crestDeploy(same, "prov");
  answerPending(same.engine, "chooserSelectsTarget", { selected: [myFaction(same)] });
  crestDeploy(same, "provItem");
  answerPending(same.engine, "chooserSelectsTarget", { selected: [myFaction(same)] });
  assert.equal(influenceOf(same.engine, P1), START + 4);
  const split = crestBoard(SPEC_G);
  crestDeploy(split, "prov");
  answerPending(split.engine, "chooserSelectsTarget", { selected: [myFaction(split)] });
  crestDeploy(split, "provItem");
  answerPending(split.engine, "chooserSelectsTarget", { selected: [theirFaction(split)] });
  assert.equal(influenceOf(split.engine, P1), START + 2);
  assert.equal(influenceOf(split.engine, P2), START + 2);
});

clause(CREST_G, "2:rule", "gaining influence is not damage: a damage-prevention effect on the faction does not stop it", () => {
  const ward = item({
    name: "Ward",
    cost: 0,
    behavior: { abilities: [{ id: "ward", type: "continuous", modifiers: [], damageModifiers: [{ selector: { type: "faction", controller: "self" }, delta: -10 }] }] }
  });
  const game = greedOpen([{ key: "ward", def: ward, owner: P1, zone: "play" }]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [myFaction(game)] });
  assert.equal(influenceOf(game.engine, P1), START + 2);
});

// --- Crests of Obsession / Rage: you may search your deck for a tactic / character and reveal it. If you do, put it on top of your deck. ---

interface TutorSpec {
  spec: CrestSpec;
  /** deck keys that match the search (tactics for Obsession, characters for Rage). */
  matching: string[];
  /** deck keys that do NOT match. */
  nonMatching: string[];
  word: string;
}
const TUTOR_O: TutorSpec = { spec: SPEC_O, matching: ["s2", "s4", "s7"], nonMatching: ["s0", "s1", "s3", "s5", "s6"], word: "tactic" };
const TUTOR_R: TutorSpec = { spec: SPEC_R, matching: ["s1", "s3", "s6"], nonMatching: ["s0", "s2", "s4", "s5", "s7"], word: "character" };

function tutorOpen(t: TutorSpec, extra: CardPlacement[] = []): CrestGame {
  const game = crestBoard(t.spec, { extra });
  crestDevelop(game, "stap");
  expectPending(game.engine, "chooserSelectsTarget");
  return game;
}

const tutorFindBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t);
  assert.equal(pending(game.engine)?.playerId, P1, "I search");
  const sizeBefore = deckOf(game.engine, P1).length;
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[1])] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(deckOf(game.engine, P1)[0], game.id(t.matching[1]), `the ${t.word} I found is the top card of my deck`);
  assert.equal(deckOf(game.engine, P1).length, sizeBefore, "it never left the deck");
  assert.equal(zoneOf(game.engine, game.id(t.matching[1])), "deck");
};
clause(CREST_O, "2:rule", "searching for a tactic: the tactic found ends up on top of my deck (and the deck keeps all its cards)", tutorFindBody(TUTOR_O));
clause(CREST_R, "2:rule", "searching for a character: the character found ends up on top of my deck (and the deck keeps all its cards)", tutorFindBody(TUTOR_R));

const tutorAnyBody = (t: TutorSpec) => () => {
  for (const key of t.matching) {
    const game = tutorOpen(t);
    answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] });
    assert.equal(deckOf(game.engine, P1)[0], game.id(key), `${key} can be found`);
  }
};
clause(CREST_O, "2:rule", "any tactic in my deck can be found: the first, a middle and the last", tutorAnyBody(TUTOR_O));
clause(CREST_R, "2:rule", "any character in my deck can be found: the first, a middle and the last", tutorAnyBody(TUTOR_R));

const tutorOnlyMatchingBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t, [
    { key: "inHand", def: t.spec === SPEC_O ? tactic({ name: "Hand Tactic", cost: 1 }) : character({ name: "Hand Character", cost: 1 }), owner: P1, zone: "hand" },
    { key: "inDiscard", def: t.spec === SPEC_O ? tactic({ name: "Discard Tactic", cost: 1 }) : character({ name: "Discard Character", cost: 1 }), owner: P1, zone: "discard" }
  ]);
  for (const key of t.nonMatching) {
    refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(key)] }), `${key} is not a ${t.word}`);
  }
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("o0")] }), "a card in the opponent's deck");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("o1")] }), "a card in the opponent's deck");
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("inHand")] }), `a ${t.word} in my hand`);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("inDiscard")] }), `a ${t.word} in my discard pile`);
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget", "the search is still open");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[0])] });
  assert.equal(deckOf(game.engine, P1)[0], game.id(t.matching[0]), "control: a matching card in my deck");
};
clause(CREST_O, "2:rule", "only a tactic in MY deck can be found: not an item or character, not a card in my hand or discard pile, not the opponent's", tutorOnlyMatchingBody(TUTOR_O));
clause(CREST_R, "2:rule", "only a character in MY deck can be found: not an item or tactic, not a card in my hand or discard pile, not the opponent's", tutorOnlyMatchingBody(TUTOR_R));

const tutorOneBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[0]), game.id(t.matching[1])] }), "two cards");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[0])] });
  const deck = deckOf(game.engine, P1);
  assert.equal(deck[0], game.id(t.matching[0]));
  // The rest of the deck is shuffled (Q3: shuffle first, then put the found card on top), so the other candidate may land
  // anywhere below the top: it is only required to stay in the deck, below the found card.
  assert.ok(deck.slice(1).includes(game.id(t.matching[1])), "the other candidate stays in the deck, below the found card");
};
clause(CREST_O, "2:rule", "only one tactic is found, not two", tutorOneBody(TUTOR_O));
clause(CREST_R, "2:rule", "only one character is found, not two", tutorOneBody(TUTOR_R));

const tutorDeclineBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t);
  const before = deckOf(game.engine, P1);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [] });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.deepEqual(deckOf(game.engine, P1), before, "'you may': not searching leaves the deck exactly as it was (not shuffled)");
};
clause(CREST_O, "2:rule", "'you may': not searching leaves my deck untouched", tutorDeclineBody(TUTOR_O));
clause(CREST_R, "2:rule", "'you may': not searching leaves my deck untouched", tutorDeclineBody(TUTOR_R));

const tutorRevealBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[2])] });
  assert.ok(revealedIds(game.engine).includes(game.id(t.matching[2])), "the card found was revealed");
};
clause(CREST_O, "2:rule", "the tactic found is revealed", tutorRevealBody(TUTOR_O));
clause(CREST_R, "2:rule", "the character found is revealed", tutorRevealBody(TUTOR_R));

const tutorShuffleBody = (t: TutorSpec) => () => {
  const game = tutorOpen(t);
  const before = deckOf(game.engine, P1);
  const found = game.id(t.matching[2]);
  answerPending(game.engine, "chooserSelectsTarget", { selected: [found] });
  const after = deckOf(game.engine, P1);
  assert.equal(after[0], found, "the card found is on top");
  assert.deepEqual([...after].sort(), [...before].sort(), "nothing lost, nothing added");
  assert.notDeepEqual(after.slice(1), before.filter((id) => id !== found), "the rest of the deck was shuffled by the search (CR 312.1)");
};
clause(CREST_O, "2:rule", "a searched deck is shuffled (CR 312.1): after the search the rest of my deck is in a new order, with the tactic found on top", tutorShuffleBody(TUTOR_O));
clause(CREST_R, "2:rule", "a searched deck is shuffled (CR 312.1): after the search the rest of my deck is in a new order, with the character found on top", tutorShuffleBody(TUTOR_R));

const tutorTwiceBody = (t: TutorSpec) => () => {
  const game = crestBoard(t.spec);
  crestDeploy(game, "prov");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[0])] });
  assert.equal(deckOf(game.engine, P1)[0], game.id(t.matching[0]));
  crestDeploy(game, "provItem");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[2])] });
  assert.equal(deckOf(game.engine, P1)[0], game.id(t.matching[2]), "the second search puts its card on top");
};
clause(CREST_O, "2:rule", "two [O] cards entering play give two searches; the second card found ends up on top", tutorTwiceBody(TUTOR_O));
clause(CREST_R, "2:rule", "two [R] cards entering play give two searches; the second card found ends up on top", tutorTwiceBody(TUTOR_R));

const tutorDrawBody = (t: TutorSpec) => () => {
  // the card put on top is the next one I draw
  const game = crestBoard(t.spec, { extra: [...fillers("pad", 2, P1, "hand")] });
  crestDeploy(game, "prov");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id(t.matching[2])] });
  const handBefore = handOf(game.engine, P1).length;
  developDraw(game.engine, P1);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P1).length, handBefore + 1);
  assert.ok(handOf(game.engine, P1).includes(game.id(t.matching[2])), "the card I put on top is the one I draw");
};
clause(CREST_O, "2:rule", "the tactic put on top is the next card I draw", tutorDrawBody(TUTOR_O));
clause(CREST_R, "2:rule", "the character put on top is the next card I draw", tutorDrawBody(TUTOR_R));

// =============================================================================
// A Blazing Zero (Seed 2) — Tactic, warlord, cost 1, [R]
//   If you played this card in response to a tactic, terminate that tactic. Put
//   that tactic into play under its owner's control as a face-down resource
//   instead of into their discard pile.
// =============================================================================

const ZERO = "7e5bb861-d287-4c8b-8eac-44144ab6ef99";

interface BzOpts {
  /** Ready [R] resources for me (default 2). */
  rage?: number;
  /** The opponent's original tactic (default: free "Pick Hit 3" on a character). */
  orig?: CardDefinition;
  /** The opponent's ready resources (default 4 [G]). */
  theirs?: number;
  extra?: CardPlacement[];
  theirTurn?: boolean;
}

/**
 * Me = P1 with A Blazing Zero in hand. The opponent (P2, active) has `orig` in
 * hand. Characters: mine "mine1" (life 5), theirs "foe1" (life 5), "foe2".
 */
function bzBoard(opts: BzOpts = {}) {
  const theirTurn = opts.theirTurn !== false;
  return devBoard(
    [
      { key: "zero", def: printing(ZERO), owner: P1, zone: "hand" },
      { key: "orig", def: opts.orig ?? pickHitTactic(3, "Their Hit"), owner: P2, zone: "hand" },
      { key: "mine1", def: character({ name: "Mine One", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe1", def: character({ name: "Foe One", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      { key: "foe2", def: character({ name: "Foe Two", cost: 1, strength: 2, life: 5, speed: 2 }), owner: P2, zone: "play" },
      ...res({ rage: opts.rage ?? 2 }),
      ...res({ greed: opts.theirs ?? 4 }, P2),
      ...fillers("odk", 3, P2, "deck"),
      ...fillers("dk", 3, P1, "deck"),
      ...(opts.extra ?? [])
    ],
    theirTurn ? { turn: 2, activePlayerId: P2 } : { turn: 1, activePlayerId: P1 }
  );
}
type BzGame = ReturnType<typeof bzBoard>;

const bzOrigPlay = (game: BzGame, pick = "mine1", key = "orig") => playRaw(game.engine, P2, game.id(key), { selected: { t: [game.id(pick)] } });
const bzZeroPlay = (game: BzGame, player: PlayerId = P1) => playRaw(game.engine, player, game.id("zero"));

clause(ZERO, "0:rule", "played in response to the opponent's tactic, it terminates that tactic: the tactic's effect never happens", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  assert.equal(game.engine.state.priorityPlayerId, P1, "I may respond");
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(damageOn(game.engine, game.id("mine1")), 0, "the 3 damage never happened");
});

clause(ZERO, "0:rule", "the terminated tactic is put into play under its owner's control as a face-down resource, and is not in the discard pile", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  const card = game.engine.state.cards[game.id("orig")];
  assert.equal(card.zone, "play", "in play");
  assert.equal(card.faceDown, true, "face-down");
  assert.equal(card.controllerId, P2, "under its owner's control");
  assert.equal(card.ownerId, P2);
  assert.equal(discardOf(game.engine, P2).includes(game.id("orig")), false, "not in their discard pile");
  assert.ok(playOf(game.engine, P2).includes(game.id("orig")), "playOf(game.engine, P2).includes(game.id(\"orig\"))");
  assert.equal(playOf(game.engine, P1).includes(game.id("orig")), false, "not mine");
});

clause(ZERO, "0:rule", "the new resource is a working face-down resource for its owner: ready, and providing one Volition", () => {
  const game = bzBoard();
  const readyBefore = ready(game.engine, P2);
  const volBefore = icons(game.engine, P2).volition ?? 0;
  bzOrigPlay(game);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine, P2), readyBefore + 1, "one more ready resource for them");
  assert.equal(icons(game.engine, P2).volition ?? 0, volBefore + 1);
  assert.equal(game.engine.state.cards[game.id("orig")].attachedTo, undefined, "not spent");
  assert.equal(icons(game.engine, P1).volition ?? 0, 0, "nothing for me");
});

clause(ZERO, "0:rule", "A Blazing Zero itself goes to my discard pile like any resolved tactic", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
  assert.ok(discardOf(game.engine, P1).includes(game.id("zero")), "discardOf(game.engine, P1).includes(game.id(\"zero\"))");
});

clause(ZERO, "0:rule", "control: without the Zero the same tactic resolves normally and goes to the discard pile", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("mine1")), 3);
  assert.equal(zoneOf(game.engine, game.id("orig")), "discard");
});

clause(ZERO, "0:rule", "the terminated tactic's whole effect is stopped, including other instructions: a card-drawing tactic draws nothing", () => {
  const drawTactic = tactic({
    name: "Their Draw Two",
    cost: 0,
    behavior: { abilities: [{ id: "d2", type: "activated", effects: [{ type: "draw", player: "controller", amount: 2 }] }] }
  });
  const game = bzBoard({ orig: drawTactic });
  const theirHand = handOf(game.engine, P2).length;
  playRaw(game.engine, P2, game.id("orig"));
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, theirHand - 1, "they played the card and drew nothing");
});

clause(ZERO, "0:rule", "the terminated tactic's costs stay paid: resources spent to play it are not refunded", () => {
  const costly = tactic({
    name: "Their Costly Hit",
    cost: 2,
    behavior: { abilities: [{ id: "ch", type: "activated", targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }], effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount: 3 }] }] }
  });
  const game = bzBoard({ orig: costly, theirs: 4 });
  const before = ready(game.engine, P2);
  bzOrigPlay(game);
  assert.equal(before - ready(game.engine, P2), 2);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(ready(game.engine, P2), before - 2 + 1, "2 stay spent; the only change is the new face-down resource");
});

clause(ZERO, "0:rule", "the responded-to tactic's extra-cost pick is not affected: the picked character is untouched either way", () => {
  const game = bzBoard();
  bzOrigPlay(game, "foe1");
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(damageOn(game.engine, game.id("foe1")), 0);
  assert.equal(zoneOf(game.engine, game.id("foe1")), "play");
});

// --- cost 1 and [R] ---

clause(ZERO, "0:rule", "costs exactly 1 resource, paid when it is played", () => {
  const game = bzBoard({ rage: 3 });
  bzOrigPlay(game);
  const before = ready(game.engine);
  bzZeroPlay(game);
  assert.equal(before - ready(game.engine), 1);
  assert.equal(zoneOf(game.engine, game.id("zero")), "deploying");
  resolvePendingResponses(game.engine);
  assert.equal(before - ready(game.engine), 1, "nothing more paid");
});

clause(ZERO, "0:rule", "is refused with no resource to pay, and the tactic it would stop resolves", () => {
  const bad = bzBoard({ rage: 0 });
  bzOrigPlay(bad);
  refused(() => bzZeroPlay(bad), "no resource");
  assert.equal(zoneOf(bad.engine, bad.id("zero")), "hand");
  resolvePendingResponses(bad.engine);
  assert.equal(damageOn(bad.engine, bad.id("mine1")), 3, "the tactic was not stopped");
});

clause(ZERO, "0:rule", "needs [R]: lots of other resources, Volition or the opponent's [R] are refused", () => {
  const board = (extra: CardPlacement[], rage = 0) => {
    const g = bzBoard({ rage, extra });
    bzOrigPlay(g);
    return g;
  };
  const greed = board(res({ greed: 5 }));
  refused(() => bzZeroPlay(greed), "no [R]");
  const vol = board(volition(4, P1));
  refused(() => bzZeroPlay(vol), "Volition is not [R]");
  const theirs = board(res({ rage: 4 }, P2));
  refused(() => bzZeroPlay(theirs), "their [R] do not count");
  for (const g of [greed, vol, theirs]) assert.equal(zoneOf(g.engine, g.id("zero")), "hand");
});

clause(ZERO, "0:rule", "spent [R] meets the threshold, but only a ready resource pays the 1", () => {
  const good = bzBoard({ rage: 0, extra: [...spent({ rage: 1 }), ...res({ greed: 1 })] });
  bzOrigPlay(good);
  bzZeroPlay(good);
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("mine1")), 0, "the Zero worked with a spent [R] and a ready [G]");
  const bad = bzBoard({ rage: 0, extra: spent({ rage: 1 }) });
  bzOrigPlay(bad);
  refused(() => bzZeroPlay(bad), "nothing ready to pay with");
});

// --- 'If you played this card in response to a tactic': the near misses ---

clause(ZERO, "0:rule", "played on my own turn, in response to nothing, it does nothing: it simply goes to the discard pile", () => {
  const game = bzBoard({ theirTurn: false });
  const before = ready(game.engine);
  play(game.engine, P1, game.id("zero"));
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
  assert.equal(before - ready(game.engine), 1, "it still costs 1");
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(game.engine, game.id("orig")), "hand", "the opponent's cards are untouched");
});

clause(ZERO, "0:rule", "in response to an ABILITY (not a tactic) nothing is terminated: the ability still resolves", () => {
  const drawer = character({
    name: "Their Drawer",
    cost: 1,
    behavior: { abilities: [{ id: "study", type: "activated", costs: [], effects: [{ type: "draw", player: "controller", amount: 1 }] }] }
  });
  const game = bzBoard({ extra: [{ key: "drawer", def: drawer, owner: P2, zone: "play" }] });
  const theirHand = handOf(game.engine, P2).length;
  actRaw(game.engine, P2, game.id("drawer"), "study");
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(handOf(game.engine, P2).length, theirHand + 1, "the ability resolved: they drew");
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
});

clause(ZERO, "0:rule", "in response to a NON-tactic card (an item deployed by the opponent) nothing is terminated: it still enters play", () => {
  const trinket = item({ name: "Their Trinket", cost: 0 });
  const game = bzBoard({ extra: [{ key: "trinket", def: trinket, owner: P2, zone: "hand" }] });
  playRaw(game.engine, P2, game.id("trinket"));
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("trinket")), "play", "the item still entered play");
  assert.equal(game.engine.state.cards[game.id("trinket")].faceDown, false, "face-up");
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
});

clause(ZERO, "0:rule", "in response to a character the opponent deploys, nothing is terminated either", () => {
  const recruit = character({ name: "Their Recruit", cost: 0 });
  const game = bzBoard({ extra: [{ key: "recruit", def: recruit, owner: P2, zone: "hand" }] });
  playRaw(game.engine, P2, game.id("recruit"));
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("recruit")), "play");
  assert.equal(game.engine.state.cards[game.id("recruit")].faceDown, false);
});

clause(ZERO, "0:rule", "in response to an attack nothing is terminated: the attack goes on", () => {
  const game = bzBoard({ extra: [{ key: "atk", def: character({ name: "Their Attacker", cost: 1, strength: 2 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.ok(battleOf(game.engine), "the battle is still on");
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
});

clause(ZERO, "0:rule", "in response to the end of the opponent's turn nothing is terminated", () => {
  const game = bzBoard();
  game.engine.perform({ type: "endTurn", playerId: P2 });
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.activePlayerId, P1, "the turn ended");
  assert.equal(zoneOf(game.engine, game.id("zero")), "discard");
});

// --- 'a tactic': which tactic is meant ---

clause(ZERO, "0:rule", "it answers the tactic it was played in response to, i.e. the top of the stack: with three tactics stacked, only the top one is terminated", () => {
  const second = pickHitTactic(2, "Their Second Hit");
  const mineKill = pickHitTactic(1, "My Little Hit");
  const game = bzBoard({
    extra: [
      { key: "second", def: second, owner: P2, zone: "hand" },
      { key: "mineHit", def: mineKill, owner: P1, zone: "hand" }
    ]
  });
  bzOrigPlay(game, "mine1");
  playRaw(game.engine, P1, game.id("mineHit"), { selected: { t: [game.id("foe1")] } });
  assert.equal(game.engine.state.priorityPlayerId, P2);
  playRaw(game.engine, P2, game.id("second"), { selected: { t: [game.id("foe2")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(game.engine.state.cards[game.id("second")].faceDown, true, "the top tactic became a face-down resource");
  assert.equal(game.engine.state.cards[game.id("second")].zone, "play");
  assert.equal(damageOn(game.engine, game.id("foe2")), 0, "the top tactic's damage never happened");
  assert.equal(damageOn(game.engine, game.id("foe1")), 1, "my tactic below it still resolved");
  assert.equal(damageOn(game.engine, game.id("mine1")), 3, "their first tactic still resolved");
  assert.equal(zoneOf(game.engine, game.id("orig")), "discard");
  assert.equal(zoneOf(game.engine, game.id("mineHit")), "discard");
});

clause(ZERO, "0:rule", "the opponent can answer with their own A Blazing Zero: it terminates MY Zero, which becomes a face-down resource under MY control, so the first tactic resolves", () => {
  const theirZero = { key: "theirZero", def: printing(ZERO), owner: P2, zone: "hand" as const };
  const game = bzBoard({ extra: [theirZero, ...res({ rage: 2 }, P2)] });
  bzOrigPlay(game);
  bzZeroPlay(game);
  assert.equal(game.engine.state.priorityPlayerId, P2);
  playRaw(game.engine, P2, game.id("theirZero"));
  resolvePendingResponses(game.engine);
  const mine = game.engine.state.cards[game.id("zero")];
  assert.equal(mine.zone, "play", "my Zero was terminated and put into play");
  assert.equal(mine.faceDown, true);
  assert.equal(mine.controllerId, P1, "under its owner's control: mine");
  assert.equal(damageOn(game.engine, game.id("mine1")), 3, "their first tactic was not stopped (my Zero never resolved)");
  assert.equal(zoneOf(game.engine, game.id("orig")), "discard");
  assert.equal(zoneOf(game.engine, game.id("theirZero")), "discard");
});

clause(ZERO, "0:rule", "the tactic of a different owner: it is put into play under ITS owner's control, whoever controlled the effect (the opponent's tactic is theirs, not mine)", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("orig")), P2);
  assert.notEqual(controllerOf(game.engine, game.id("orig")), P1);
});

clause(ZERO, "0:rule", "a tactic stopped this way does not come back: the face-down resource is not a tactic I or they can play again from play", () => {
  const game = bzBoard();
  bzOrigPlay(game);
  bzZeroPlay(game);
  resolvePendingResponses(game.engine);
  endTurn(game.engine, P2);
  endTurn(game.engine, P1);
  assert.equal(game.engine.state.cards[game.id("orig")].faceDown, true, "still just a resource");
  assert.equal(game.engine.state.cards[game.id("orig")].zone, "play");
});

// --- extras: Mistaken Identity and "cannot be picked" ---

const elusiveChar = (name: string, restriction: "cannotBePicked" | "cannotBePickedByOpponents") =>
  character({
    name,
    cost: 1,
    strength: 2,
    life: 5,
    speed: 2,
    behavior: { abilities: [{ id: "elusive", type: "continuous", modifiers: [], restrictions: [{ target: "source", restriction }] }] }
  });

clause(MISTAKEN, "0:ability", "a character that 'cannot be picked' cannot be the other character: it is refused, and a normal character works", () => {
  const extra = [{ key: "elusive", def: elusiveChar("Elusive Foe", "cannotBePicked"), owner: P2, zone: "play" as const }];
  const bad = miBoard({ icons: { deception: 3 }, extra });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "elusive"), "nobody can pick it");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  assert.equal(ready(bad.engine), 3, "nothing paid");
  const good = miBoard({ icons: { deception: 3 }, extra });
  miOpen(good, "mine1");
  miPlayRaw(good, "foe1");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("foe1")), 3, "control: another character works");
});

clause(MISTAKEN, "0:ability", "the pick must be something THAT card could pick: my character that 'your opponents cannot pick' can't be picked by the opponent's card, so it can't be the other character", () => {
  const extra = [{ key: "elusive", def: elusiveChar("Elusive Friend", "cannotBePickedByOpponents"), owner: P1, zone: "play" as const }];
  const bad = miBoard({ icons: { deception: 3 }, extra });
  miOpen(bad, "mine1");
  refused(() => miPlayRaw(bad, "elusive"), "the original card is the opponent's and cannot pick it");
  assert.equal(zoneOf(bad.engine, bad.id("mi")), "hand");
  const good = miBoard({ icons: { deception: 3 }, extra });
  miOpen(good, "mine1");
  miPlayRaw(good, "mine2");
  resolvePendingResponses(good.engine);
  assert.equal(damageOn(good.engine, good.id("mine2")), 3, "control: an ordinary character of mine works");
});

// --- extras: Peculate ---

clause(PECULATE, "0:ability", "ownership never changes: when the stolen character is destroyed it goes to its OWNER's discard pile, not mine", () => {
  const game = pecBoard({ extra: [{ key: "kill", def: destroyInPlayTactic(), owner: P1, zone: "hand" }] });
  pecPlay(game, "char");
  play(game.engine, P1, game.id("kill"), { selected: { t: [game.id("char")] } });
  assert.equal(zoneOf(game.engine, game.id("char")), "discard");
  assert.ok(discardOf(game.engine, P2).includes(game.id("char")), "back to the opponent's discard pile");
  assert.equal(discardOf(game.engine, P1).includes(game.id("char")), false);
});

clause(PECULATE, "0:ability", "the card put into play is a real permanent under my control: a stolen item's aura buffs MY characters, not theirs", () => {
  const banner = item({
    name: "Dead Banner",
    cost: 1,
    behavior: {
      abilities: [{ id: "banner", type: "continuous", modifiers: [{ selector: { type: "character", controller: "self" }, stat: "strength", operation: "add", value: 1 }] }]
    }
  });
  const game = pecBoard({ extra: [{ key: "banner", def: banner, owner: P2, zone: "discard" }] });
  const mineBefore = game.engine.getStat(game.id("friend"), "strength");
  const theirsBefore = game.engine.getStat(game.id("foe"), "strength");
  pecPlay(game, "banner");
  assert.equal(game.engine.getStat(game.id("friend"), "strength"), mineBefore + 1, "my character is buffed");
  assert.equal(game.engine.getStat(game.id("foe"), "strength"), theirsBefore, "their character is not");
});

// --- extras: Roundalicious Breasticles ---

clause(BREAST, "2:ability:tantalize", "a character with no cost number has numeric cost 0 and can be picked even with no tokens", () => {
  const costless = character({ name: "Costless Foe", cost: undefined, strength: 1, life: 3, speed: 1 });
  const game = rbBoard({ tokens: 0, extra: [{ key: "costless", def: costless, owner: P2, zone: "play", attackEligible: false }] });
  tantalize(game, "costless");
  resolvePendingResponses(game.engine);
  assert.equal(controllerOf(game.engine, game.id("costless")), P1);
});

// --- extras: Smothering Corpulence ---

clause(SMOTHER, "0:ability", "the cards removed as a cost fix X: if the opponent draws their top card in response, X still uses the card that was removed when I played the tactic", () => {
  const draw = tactic({ name: "Quick Draw", cost: 0, behavior: { abilities: [{ id: "qd", type: "activated", effects: [{ type: "draw", player: "controller", amount: 1 }] }] } });
  const game = smBoard({ mine: [2, 6, 6], theirs: [5, 9, 9], extra: [{ key: "qd", def: draw, owner: P2, zone: "hand" }] });
  smRaw(game, "foe");
  const [firstTop] = [game.id("b0")];
  assert.equal(zoneOf(game.engine, firstTop), "removed", "their cost-5 card was removed when I played the tactic");
  playRaw(game.engine, P2, game.id("qd"));
  resolvePendingResponses(game.engine);
  drain(game.engine, declineAll);
  assert.equal(lifeOf(game, "foe"), 2, "X = 5 - 2 = 3 from the cards removed at cost time (life 5 - 3)");
});

// --- extras: Muscle Tribe and the full COVERT keyword ---

clause(MUSCLE, "0:rule", "COVERT works as a party: the Tribe attacking together with a non-covert ally is not a covert party, so a plain character may block", () => {
  const game = mtBoard({
    extra: [
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      { key: "plainBlocker", def: character({ name: "Plain Blocker", cost: 1, life: 4 }), owner: P2, zone: "play" }
    ]
  });
  play(game.engine, P1, game.id("prov"));
  assert.equal(hasCovert(game.engine, game.id("mt")), true);
  declareAttackBy(game.engine, P1, [game.id("mt"), game.id("ally")]);
  declareBlockers(game.engine, P2, [game.id("plainBlocker")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("plainBlocker")], "the ally is not covert, so the party is not");
});

clause(MUSCLE, "0:rule", "a covert Tribe may block only covert parties: on the opponent's turn, after a [D] card enters play for me, it cannot block a plain attacker", () => {
  const game = mtBoard({
    turn: 2,
    active: P2,
    extra: [
      { key: "prov", def: providerChar("D Provider", ["deception"]), owner: P1, zone: "hand" },
      { key: "put", def: putFromHandTactic(), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Their Plain Attacker", cost: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackOpenWindow(game.engine, P2, [game.id("atk")]);
  playRaw(game.engine, P1, game.id("put"), { selected: { t: [game.id("prov")] } });
  resolvePendingResponses(game.engine);
  assert.equal(hasCovert(game.engine, game.id("mt")), true, "the Tribe is covert on their turn");
  refused(() => declareBlockers(game.engine, P1, [game.id("mt")]), "a covert character may block only a covert party (CR 507.3c)");
  declareBlockers(game.engine, P1, [game.id("ally")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("ally")], "control: a plain ally may block");
});

clause(MUSCLE, "0:rule", "without a [D] card it blocks a plain attacker as usual", () => {
  const game = mtBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Their Plain Attacker", cost: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(game.engine, P2, [game.id("atk")]);
  declareBlockers(game.engine, P1, [game.id("mt")]);
  assert.deepEqual(battleOf(game.engine)?.blockingParty, [game.id("mt")]);
});

// --- extras: the pure UNIQUE CREST rule, with a second card that has no trigger of its own ---

const uniqueSyntheticBody = (spec: CrestSpec) => () => {
  const lookalike = (name: string) => item({ name, cost: 0, unique: "crest", subtype: ["crest"] });
  // keep the real Crest
  const keepReal = crestBoard(spec, { extra: [{ key: "twin", def: lookalike("Crest Lookalike"), owner: P1, zone: "hand" }] });
  crestDeploy(keepReal, "twin");
  const pc = expectPending(keepReal.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [keepReal.id("crest"), keepReal.id("twin")].sort());
  answerPending(keepReal.engine, "uniqueSurvivor", { keep: keepReal.id("crest") });
  assert.equal(keepReal.engine.state.pendingChoice, undefined);
  assert.equal(keepReal.engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(keepReal.engine, keepReal.id("crest")), "play");
  assert.equal(zoneOf(keepReal.engine, keepReal.id("twin")), "discard");
  // keep the lookalike: the real Crest is destroyed
  const keepTwin = crestBoard(spec, { extra: [{ key: "twin", def: lookalike("Crest Lookalike"), owner: P1, zone: "hand" }] });
  crestDeploy(keepTwin, "twin");
  answerPending(keepTwin.engine, "uniqueSurvivor", { keep: keepTwin.id("twin") });
  assert.equal(keepTwin.engine.state.pendingChoice, undefined);
  assert.equal(keepTwin.engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(keepTwin.engine, keepTwin.id("twin")), "play");
  assert.equal(zoneOf(keepTwin.engine, keepTwin.id("crest")), "discard");
  assert.equal(icons(keepTwin.engine, P1)[spec.icon] ?? 0, 0, "the destroyed Crest no longer provides its icons");
};
clause(CREST_D, "0:unique", "UNIQUE CREST against a plain card with the same designation: I choose which survives, and the other is destroyed (Deception)", uniqueSyntheticBody(SPEC_D));
clause(CREST_E, "0:unique", "UNIQUE CREST against a plain card with the same designation: I choose which survives, and the other is destroyed (Elitism)", uniqueSyntheticBody(SPEC_E));
clause(CREST_G, "0:unique", "UNIQUE CREST against a plain card with the same designation: I choose which survives, and the other is destroyed (Greed)", uniqueSyntheticBody(SPEC_G));
clause(CREST_O, "0:unique", "UNIQUE CREST against a plain card with the same designation: I choose which survives, and the other is destroyed (Obsession)", uniqueSyntheticBody(SPEC_O));
clause(CREST_R, "0:unique", "UNIQUE CREST against a plain card with the same designation: I choose which survives, and the other is destroyed (Rage)", uniqueSyntheticBody(SPEC_R));

// --- extras: "cannot be picked" applies to every 'Pick a character' ---

clause(SPRINT, "0:ability", "a character that 'cannot be picked' cannot be the pick; one that only 'opponents cannot pick' can be picked by its own controller (me) but not when it is theirs", () => {
  const extra = [
    { key: "hidden", def: elusiveChar("Hidden Foe", "cannotBePicked"), owner: P2, zone: "play" as const },
    { key: "theirShy", def: elusiveChar("Their Shy One", "cannotBePickedByOpponents"), owner: P2, zone: "play" as const },
    { key: "myShy", def: elusiveChar("My Shy One", "cannotBePickedByOpponents"), owner: P1, zone: "play" as const }
  ];
  const hidden = spBoard({ extra });
  refused(() => spRaw(hidden, "hidden"), "nobody can pick it");
  const theirShy = spBoard({ extra });
  refused(() => spRaw(theirShy, "theirShy"), "I am their opponent");
  assert.equal(zoneOf(theirShy.engine, theirShy.id("sp")), "hand");
  const myShy = spBoard({ extra });
  spPlay(myShy, "myShy");
  assert.equal(speedOf(myShy, "myShy"), 3, "I may pick my own 'your opponents cannot pick' character");
});

clause(SMOTHER, "0:ability", "a character that 'cannot be picked' cannot be the pick, and refusing it costs nothing and removes no card", () => {
  const extra = [
    { key: "hidden", def: elusiveChar("Hidden Foe", "cannotBePicked"), owner: P2, zone: "play" as const },
    { key: "theirShy", def: elusiveChar("Their Shy One", "cannotBePickedByOpponents"), owner: P2, zone: "play" as const },
    { key: "myShy", def: elusiveChar("My Shy One", "cannotBePickedByOpponents"), owner: P1, zone: "play" as const }
  ];
  const hidden = smBoard({ extra });
  refused(() => smRaw(hidden, "hidden"), "nobody can pick it");
  assert.equal(deckOf(hidden.engine, P1).length, 3);
  assert.equal(deckOf(hidden.engine, P2).length, 3);
  const theirShy = smBoard({ extra });
  refused(() => smRaw(theirShy, "theirShy"), "I am their opponent");
  const myShy = smBoard({ mine: [1, 6, 6], theirs: [4, 6, 6], extra });
  smPlay(myShy, "myShy");
  assert.equal(lifeOf(myShy, "myShy"), 2, "my own character is a legal pick");
});

clause(CREST_D, "2:rule", "a character that 'cannot be picked' cannot be the Crest's pick", () => {
  const game = deceptionOpen([{ key: "hidden", def: elusiveChar("Hidden Foe", "cannotBePicked"), owner: P2, zone: "play" }]);
  refused(() => answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("hidden")] }), "nobody can pick it");
  assert.equal(pending(game.engine)?.kind, "chooserSelectsTarget");
  answerPending(game.engine, "chooserSelectsTarget", { selected: [game.id("foe")] });
  assert.equal(lifeOfCrest(game, "foe"), 2);
  assert.equal(lifeOfCrest(game, "hidden"), 5);
});

clause(BREAST, "2:ability:tantalize", "a character that 'cannot be picked' cannot be taken, and the Breasticles is not destroyed by the refused try", () => {
  const extra = [
    { key: "hidden", def: elusiveChar("Hidden Foe", "cannotBePicked"), owner: P2, zone: "play" as const, attackEligible: false },
    { key: "theirShy", def: elusiveChar("Their Shy One", "cannotBePickedByOpponents"), owner: P2, zone: "play" as const, attackEligible: false }
  ];
  const hidden = rbBoard({ tokens: 5, extra });
  refused(() => tantalize(hidden, "hidden"), "nobody can pick it");
  assert.equal(zoneOf(hidden.engine, hidden.id("rb")), "play");
  const shy = rbBoard({ tokens: 5, extra });
  refused(() => tantalize(shy, "theirShy"), "I am their opponent");
  assert.equal(zoneOf(shy.engine, shy.id("rb")), "play");
});

// --- extras: Mistaken Identity redirects an ATTACH TO pick (a card that picks its host as an extra cost, CR 507.2a) ---

clause(MISTAKEN, "0:ability", "ATTACH TO picks a character as an extra cost: an item the opponent deploys onto their character can be redirected, and it attaches to the other character instead", () => {
  const pickaxe = printing("0b3b61aa-3ea4-4acc-8f76-c6242af992e0");
  const game = miBoard({ extra: [{ key: "axe", def: pickaxe, owner: P2, zone: "hand" }, ...res({ deception: 1 }, P2)] });
  playRaw(game.engine, P2, game.id("axe"), { selected: { attachTo: [game.id("foe1")] } });
  assert.equal(game.engine.state.priorityPlayerId, P1, "I may respond to their item");
  miPlayRaw(game, "mine1");
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("axe")), "play", "the item still entered play");
  assert.equal(game.engine.state.cards[game.id("axe")].attachedTo, game.id("mine1"), "attached to the other character, as though they had picked it");
  assert.equal(game.engine.state.cards[game.id("axe")].controllerId, P2, "still theirs");
  assert.equal(game.engine.getStat(game.id("mine1"), "strength"), 4, "my character got the +1 strength");
  assert.equal(game.engine.getStat(game.id("foe1"), "strength"), 3, "their character did not");
});

// --- extras: Peculate and a UNIQUE card ---

clause(PECULATE, "0:ability", "stealing a UNIQUE card while I control another with the same designation raises the UNIQUE choice, and the game does not get stuck", () => {
  const sage = (name: string) => character({ name, cost: 2, strength: 2, life: 2, speed: 2, unique: "sage" });
  const game = pecBoard({
    extra: [
      { key: "theirSage", def: sage("The Dead Sage"), owner: P2, zone: "discard" },
      { key: "mySage", def: sage("My Living Sage"), owner: P1, zone: "play" }
    ]
  });
  pecRaw(game, "theirSage");
  resolvePendingResponses(game.engine);
  const pc = expectPending(game.engine, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "I choose which to keep");
  answerPending(game.engine, "uniqueSurvivor", { keep: game.id("theirSage") });
  assert.equal(game.engine.state.pendingChoice, undefined);
  assert.equal(game.engine.state.responseWindow, undefined, "the game is not stuck");
  assert.equal(zoneOf(game.engine, game.id("theirSage")), "play");
  assert.equal(zoneOf(game.engine, game.id("mySage")), "discard");
});

// --- extras: Mustache Aficionado ---

clause(MUSTACHE, "0:ability:mustache-showdown", "a player whose deck is empty cannot divide anything: no piles are made, nothing moves, and the cost stays paid", () => {
  for (const [p1, p2, why] of [[[2, 6, 6], [], "their deck is empty"], [[], [5, 6, 6], "my deck is empty"], [[], [], "both decks are empty"]] as Array<[number[], number[], string]>) {
    const game = msBoard({ p1, p2 });
    actRaw(game.engine, P1, game.id("ma"), "mustache-showdown");
    resolvePendingResponses(game.engine);
    assert.equal(game.engine.state.pendingChoice, undefined, why);
    assert.equal(isDepleted(game.engine, game.id("ma")), true, `${why}: still depleted`);
    assert.equal(handOf(game.engine, P1).length + handOf(game.engine, P2).length, 0, `${why}: no card moved`);
  }
});

clause(MUSTACHE, "0:ability:mustache-showdown", "it works for whoever controls the Aficionado: the opponent's own showdown asks THEM to divide first and me second", () => {
  const game = msBoard({ owner: P2, turn: 2, active: P2 });
  const top1 = deckOf(game.engine, P1).slice(0, 3);
  const top2 = deckOf(game.engine, P2).slice(0, 3);
  actRaw(game.engine, P2, game.id("ma"), "mustache-showdown");
  resolvePendingResponses(game.engine);
  const first = expectPending(game.engine, "partitionCards");
  assert.equal(first.playerId, P2, "the controller divides first");
  assert.deepEqual([...(first.cardIds as string[])].sort(), [...top2].sort());
  answerPending(game.engine, "partitionCards", { piles: [[top2[0]], [top2[1], top2[2]]] });
  const second = expectPending(game.engine, "partitionCards");
  assert.equal(second.playerId, P1);
  assert.deepEqual([...(second.cardIds as string[])].sort(), [...top1].sort());
  answerPending(game.engine, "partitionCards", { piles: [[top1[0]], [top1[1], top1[2]]] });
  const pick = expectPending(game.engine, "pickPile");
  assert.equal(pick.playerId, P2, "the controller chooses first");
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the two divisions are independent: the opponent need not mirror mine (I split 1+2, they split 2+1)", () => {
  const game = msBoard();
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0, 1], [2]], p1Pick: 0, p2Pick: 1 });
  // I chose their pile0 = [b0, b1] = 2 + 2 = 4; they chose my pile1 = [a1, a2] = 1 + 1 = 2: mine (the pile they chose) is lower.
  const pc = expectPending(game.engine, "takeFromPile");
  assert.equal(pc.playerId, P2, "their chosen pile (4) beats mine (2)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [run.b(0), run.b(1)].sort());
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the winner may take a card from a two-card pile: either of the two cards is a legal choice", () => {
  for (const idx of [0, 1]) {
    const game = msBoard({ p1: [4, 4, 0, 1, 1, 1], p2: [1, 1, 1, 1, 1, 1] });
    const run = msDrive(game, { p1Piles: [[0, 1], [2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
    const pc = expectPending(game.engine, "takeFromPile");
    assert.equal(pc.playerId, P1);
    answerPending(game.engine, "takeFromPile", { cardIds: [run.a(idx)] });
    assert.deepEqual(handOf(game.engine, P1), [run.a(idx)], `card ${idx} of the pile`);
  }
});

clause(MUSTACHE, "0:ability:mustache-showdown", "the cards looked at but not taken stay in the deck, the taken one is not: with a 3-card deck the deck ends with exactly the 2 others", () => {
  const game = msBoard({ p1: [4, 0, 0], p2: [1, 1, 1] });
  const run = msDrive(game, { p1Piles: [[0], [1, 2]], p2Piles: [[0], [1, 2]], p1Pick: 0, p2Pick: 0 });
  answerPending(game.engine, "takeFromPile", { cardIds: [run.a(0)] });
  assert.deepEqual([...deckOf(game.engine, P1)].sort(), [run.a(1), run.a(2)].sort());
  assert.deepEqual([...deckOf(game.engine, P2)].sort(), [...run.top2].sort());
});

// --- deploying the characters: printed cost, threshold and stats ---

/** Deploys `printingId` from hand: refused one resource short, refused without its threshold, and paid exactly `cost` when it works. */
function deployChecks(printingId: string, cost: number, icon: StapleIcon, threshold: number, stat: [number, number, number]): void {
  const board = (icons: Icons) => devBoard([{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...res(icons)]);
  const good = board({ [icon]: cost + 2 } as Icons);
  play(good.engine, P1, good.id("card"));
  assert.equal(zoneOf(good.engine, good.id("card")), "play");
  assert.equal(2, ready(good.engine), "exactly the printed cost is paid");
  assert.deepEqual(stats(good.engine, good.id("card")), stat, "printed strength / life / speed");
  const exact = board({ [icon]: cost } as Icons);
  play(exact.engine, P1, exact.id("card"));
  assert.equal(zoneOf(exact.engine, exact.id("card")), "play", "exactly enough resources is enough");
  // threshold met by already-spent icons, so only the cost (one ready resource short) can refuse
  const otherIcon: StapleIcon = icon === "rage" ? "greed" : "rage";
  const short = devBoard([{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...res({ [otherIcon]: cost - 1 } as Icons), ...spent({ [icon]: threshold } as Icons)]);
  refused(() => playRaw(short.engine, P1, short.id("card")), "one resource short of the cost (threshold met by spent icons)", /Costs cannot be paid/);
  assert.equal(zoneOf(short.engine, short.id("card")), "hand");
  const wrong = board({ rage: cost + 3 });
  refused(() => playRaw(wrong.engine, P1, wrong.id("card")), "no icons of the right kind");
  if (threshold > 1) {
    const partial = board({ [icon]: threshold - 1, rage: cost + 3 } as Icons);
    refused(() => playRaw(partial.engine, P1, partial.id("card")), "one icon short of the threshold");
  }
  const theirTurn = devBoard([{ key: "card", def: printing(printingId), owner: P1, zone: "hand" }, ...res({ [icon]: cost + 2 } as Icons)], { turn: 2, activePlayerId: P2 });
  refused(() => playRaw(theirTurn.engine, P1, theirTurn.id("card")), "a character is deployed only on its controller's turn");
}

clause(MUSCLE, "0:rule", "it deploys as a cost-2 [D] character with strength 2, life 1, speed 4", () => {
  deployChecks(MUSCLE, 2, "deception", 1, [2, 1, 4]);
});

clause(MUSTACHE, "0:ability:mustache-showdown", "it deploys as a cost-3 [D] character with strength 2, life 3, speed 4", () => {
  deployChecks(MUSTACHE, 3, "deception", 1, [2, 3, 4]);
});

clause(PARTY, "0:rule", "it deploys as a cost-4 [D] character with strength 2, life 2, speed 3", () => {
  deployChecks(PARTY, 4, "deception", 1, [2, 2, 3]);
});

clause(PARTY_SAGA, "0:rule", "the Seed Saga printing deploys as a cost-4 [D] character with strength 2, life 2, speed 3", () => {
  deployChecks(PARTY_SAGA, 4, "deception", 1, [2, 2, 3]);
});

clause(JALOPY, "0:rule", "it deploys as a cost-4 [D][D] character with strength 3, life 3, speed 1", () => {
  deployChecks(JALOPY, 4, "deception", 2, [3, 3, 1]);
});

clause(JALOPY_SAGA, "0:rule", "the Seed Saga printing deploys as a cost-4 [D][D] character with strength 3, life 3, speed 1", () => {
  deployChecks(JALOPY_SAGA, 4, "deception", 2, [3, 3, 1]);
});

clause(RF, "0:provides", "it deploys as a cost-1 [D] character with strength 1, life 1, speed 3", () => {
  deployChecks(RF, 1, "deception", 1, [1, 1, 3]);
});

clause(RF_SAGA, "0:provides", "the Seed Saga printing deploys as a cost-1 [D] character with strength 1, life 1, speed 3", () => {
  deployChecks(RF_SAGA, 1, "deception", 1, [1, 1, 3]);
});

clause(ROSY, "0:unique", "it deploys as a cost-6 [D][D] character with strength 4, life 4, speed 4 (exact cost, threshold and timing)", () => {
  deployChecks(ROSY, 6, "deception", 2, [4, 4, 4]);
});

// --- extras: Rusty Pickaxe FLIP UP opens a response window (SYS-42, a rules question) ---

clause(AXE, "3:flipUp", "FLIP UP deploys the card, so the opponent may respond before it resolves: with the Pickaxe waiting, they destroy the picked host and the Pickaxe goes to the discard pile instead of entering play", () => {
  const game = axeBoard({ faceDown: true, deception: 1, extra: [{ key: "kill", def: killTactic(), owner: P2, zone: "hand" }] });
  holdFlipUp(() => axeFlip(game));
  assert.ok(game.engine.state.responseWindow, "a response window is open after FLIP UP");
  assert.equal(game.engine.state.priorityPlayerId, P2, "the opponent holds priority");
  playRaw(game.engine, P2, game.id("kill"), { selected: { t: [game.id("host")] } });
  resolvePendingResponses(game.engine);
  assert.equal(zoneOf(game.engine, game.id("host")), "discard");
  assert.equal(zoneOf(game.engine, game.id("axe")), "discard", "its host was gone when it would enter play (CR 507.2c)");
});
