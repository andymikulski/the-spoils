// Clause tests — batch seed-07. See docs/TESTING.md and
// `npm run card-tests -- manifest seed-07`. Expectations come from each card's
// PRINTED text, RULES.md and the Comprehensive Rules; engine data is only used
// to drive the engine.

import assert from "node:assert/strict";
import {
  buildGame as harnessBuildGame,
  activate,
  autoResolveBattle,
  bank,
  character,
  developFaction,
  item,
  location,
  play,
  resourceCard,
  tactic,
  volition,
  P1,
  P2,
  resolvePendingResponses
} from "../per-card/_harness.js";
import type { StapleIcon } from "../per-card/_harness.js";
import { clause, declineAll, drain, printing, refused, settleState, flipUpNow, holdFlipUp } from "./_clause.js";
import type { PendingChoiceLike } from "./_clause.js";
import { answerPending, fillers, pending, readyResources, tokensOn, zoneOf } from "./_board.js";
import { battleOf, declareAttackBy, declareAttackOpenWindow, fight, playRaw } from "./_battle.js";
import { attachedCount, endTurn, factionOf } from "./_turn.js";
import type { CardDefinition, CardInstanceId, PlayerId, SpoilsEngine } from "../../../engine.js";
import type { CardPlacement } from "../support/fixtures.js";

// --- shared helpers (this file only) ---------------------------------------

/** A small deterministic PRNG (mulberry32): every board gets its own fixed stream, so no outcome depends on an unseeded random. */
function seededRandom(seed = 20261016): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `buildGame` with a seeded random source unless a test passes its own (shuffles and random picks are all fixed). */
const buildGame: typeof harnessBuildGame = (options = {}) => harnessBuildGame({ ...options, random: options.random ?? seededRandom() });

type Icons = Partial<Record<StapleIcon, number>>;
type Id = (key: string) => CardInstanceId;

/** Staple resources for `owner`, e.g. `res({ deception: 2, rage: 3 })`. */
const res = (icons: Icons, owner: PlayerId = P1): CardPlacement[] =>
  (Object.entries(icons) as Array<[StapleIcon, number]>).flatMap(([icon, n]) => bank(icon, n, owner));

const other = (player: PlayerId): PlayerId => (player === P1 ? P2 : P1);
const handOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].hand;
const deckOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].deck;
const discardOf = (engine: SpoilsEngine, player: PlayerId) => engine.state.players[player].discard;
const ready = (engine: SpoilsEngine, player: PlayerId = P1) => readyResources(engine, player);
const controllerOf = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].controllerId;
const isDepleted = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].depleted;
const isFaceDown = (engine: SpoilsEngine, cardId: CardInstanceId) => engine.state.cards[cardId].faceDown;
const hasKeyword = (engine: SpoilsEngine, cardId: CardInstanceId, keyword: string) => engine.getKeywords(cardId).includes(keyword as never);

/** `n` plain characters in `owner`'s deck, keyed `<prefix>0..n-1`, top of the deck first. */
const deckCards = (prefix: string, n: number, owner: PlayerId): CardPlacement[] => fillers(prefix, n, owner, "deck");

/** A tactic that does nothing (cost 0): playing it opens a response window for the other player. */
const nothingTactic = (): CardDefinition =>
  tactic({ name: "Nothing", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } });

/** A free tactic that deals `amount` damage to one chosen character (id `zap`, declaration `t`). */
const zapTactic = (name: string, amount: number): CardDefinition =>
  tactic({
    name,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "zap",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "t" }, amount }]
        }
      ]
    }
  });

/** A free tactic that destroys one chosen card of `type` (id `kill`, declaration `t`). */
const killAnyTactic = (type: "character" | "item" | "location" | "resource"): CardDefinition =>
  tactic({
    name: `Kill ${type}`,
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "kill",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type }, count: 1 }],
          effects: [{ type: "destroy", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });

/** A free tactic that terminates the card being deployed (declaration `dep`). */
const counterTactic = (): CardDefinition =>
  tactic({
    name: "Counter",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "counter",
          type: "activated",
          targets: [{ id: "dep", selector: { zone: "deploying" }, count: 1 }],
          effects: [{ type: "terminate", target: { type: "selected", id: "dep" } }]
        }
      ]
    }
  });

/** Plays `cardId` as `player` (no draining): the other player then holds priority in a response window. */
function respondWith(engine: SpoilsEngine, responder: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]>): void {
  engine.perform({ type: "playCard", playerId: responder, cardId, selected, variables: {} } as never);
  resolvePendingResponses(engine);
}

/** `activateAbility` WITHOUT draining the response window. */
function activateRaw(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  abilityId: string,
  selected: Record<string, CardInstanceId[]> = {}
): void {
  engine.perform({ type: "activateAbility", playerId: player, cardId, abilityId, selected, variables: {} } as never);
}

/** `playCard` WITHOUT draining, with an optional modal `mode` (`playRaw` in _battle.ts has no mode). */
function rawPlay(
  engine: SpoilsEngine,
  player: PlayerId,
  cardId: CardInstanceId,
  opts: { selected?: Record<string, CardInstanceId[]>; variables?: Record<string, number>; mode?: number } = {}
): void {
  engine.perform({
    type: "playCard",
    playerId: player,
    cardId,
    selected: opts.selected ?? {},
    variables: opts.variables ?? {},
    ...(opts.mode !== undefined ? { mode: opts.mode } : {})
  } as never);
}

/** `flipUp` (no draining). */
function flipUpRaw(engine: SpoilsEngine, player: PlayerId, cardId: CardInstanceId, selected: Record<string, CardInstanceId[]> = {}): void {
  flipUpNow(engine, { type: "flipUp", playerId: player, cardId, selected, variables: {} });
}

/** Raw `resolvePendingChoice` for a refusal check (no draining, no asserting). */
const tryChoice = (engine: SpoilsEngine, choice: Record<string, unknown>) => () => {
  const pc = pending(engine);
  if (!pc) throw new Error("tryChoice(): no pending choice");
  engine.perform({ type: "resolvePendingChoice", playerId: pc.playerId, choice } as never);
};

/** Answers whatever is open with the given policy, always handling trigger-order prompts first. */
function settle(engine: SpoilsEngine, answerFor: (pc: PendingChoiceLike) => unknown = declineAll): void {
  drain(engine, (pc) => (pc.kind === "orderTriggers" ? { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] } : answerFor(pc)));
}

/** Reveal events in the log (cardsRevealed). */
const revealEvents = (engine: SpoilsEngine) => engine.getLog().filter((entry) => entry.event?.type === "cardsRevealed");

// A generic "deploy it from my hand" battery for one printing -------------------------------------

interface DeploySpec {
  id: string;
  /** Printed numeric cost. */
  cost: number;
  /** Threshold icon and how many are required. */
  icon: StapleIcon;
  count: number;
  /** Extra placements (a host for an ATTACH TO card, deck cards for an enters-play trigger ...). */
  extra?: () => CardPlacement[];
  /** The pick(s) the deploy needs. */
  selected?: (id: Id) => Record<string, CardInstanceId[]>;
  /** The modal tactic's mode index, when the card has modes. */
  mode?: number;
  /** Where the card ends once it has resolved (default "play"; a tactic ends in "discard"). */
  after?: "play" | "discard";
  /** How to answer prompts the card opens when it resolves (default: decline everything). */
  answer?: (pc: PendingChoiceLike) => unknown;
}

const ALL_ICONS: StapleIcon[] = ["rage", "greed", "deception", "elitism", "obsession"];
const otherIcon = (icon: StapleIcon): StapleIcon => (icon === "rage" ? "greed" : "rage");

function deployBoard(spec: DeploySpec, resources: CardPlacement[], opts: { turn?: number; active?: PlayerId } = {}) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [{ key: "card", def: printing(spec.id), owner: P1, zone: "hand" }, ...(spec.extra?.() ?? []), ...resources]
  });
}

const deployPick = (spec: DeploySpec, id: Id) => ({ selected: spec.selected?.(id) ?? {}, mode: spec.mode });

/** Paying exactly the printed cost with exactly the threshold icons: it enters play, nothing more is spent. */
function deploysForExactlyItsCost(spec: DeploySpec): void {
  const { engine, id } = deployBoard(spec, [...res({ [spec.icon]: spec.count }), ...res({ [otherIcon(spec.icon)]: Math.max(spec.cost - spec.count, 0) })]);
  const before = ready(engine);
  play(engine, P1, id("card"), deployPick(spec, id));
  settle(engine, spec.answer);
  assert.equal(zoneOf(engine, id("card")), spec.after ?? "play", "it has resolved");
  assert.equal(before - ready(engine), spec.cost, `exactly the printed cost of ${spec.cost} is paid`);
  assert.equal(attachedCount(engine, P1), spec.cost);
}

/** One resource short of the cost is refused, as is no resources at all; nothing is spent. */
function refusedOneShort(spec: DeploySpec): void {
  if (spec.cost - 1 >= spec.count) {
    const short = deployBoard(spec, [...res({ [spec.icon]: spec.count }), ...res({ [otherIcon(spec.icon)]: spec.cost - 1 - spec.count })]);
    assert.equal(ready(short.engine), spec.cost - 1, "control: one short, threshold met");
    refused(() => rawPlay(short.engine, P1, short.id("card"), deployPick(spec, short.id)), "one resource short of the printed cost");
    assert.equal(zoneOf(short.engine, short.id("card")), "hand");
    assert.equal(ready(short.engine), spec.cost - 1, "nothing was paid");
  }
  const none = deployBoard(spec, []);
  refused(() => rawPlay(none.engine, P1, none.id("card"), deployPick(spec, none.id)), "no resources");
  assert.equal(zoneOf(none.engine, none.id("card")), "hand");
  const ok = deployBoard(spec, res({ [spec.icon]: Math.max(spec.cost, spec.count) }));
  play(ok.engine, P1, ok.id("card"), deployPick(spec, ok.id));
  settle(ok.engine, spec.answer);
  assert.equal(zoneOf(ok.engine, ok.id("card")), spec.after ?? "play", "control: enough resources of the right icon is accepted");
}

/** The threshold is a gate: one icon short (with plenty of other / face-down resources) is refused. */
function refusedWithoutThreshold(spec: DeploySpec): void {
  const wrongIcons = deployBoard(spec, [...res({ [spec.icon]: spec.count - 1 }), ...res({ [otherIcon(spec.icon)]: spec.cost + 3 })]);
  refused(() => rawPlay(wrongIcons.engine, P1, wrongIcons.id("card"), deployPick(spec, wrongIcons.id)), `one [${spec.icon}] short of the threshold, with plenty of other resources`);
  assert.equal(zoneOf(wrongIcons.engine, wrongIcons.id("card")), "hand");
  const faceDown = deployBoard(spec, [...res({ [spec.icon]: spec.count - 1 }), ...volition(spec.cost + 3, P1)]);
  refused(() => rawPlay(faceDown.engine, P1, faceDown.id("card"), deployPick(spec, faceDown.id)), "face-down resources provide Volition, not the icon");
  const none = deployBoard(spec, res({ [otherIcon(spec.icon)]: spec.cost + 2 }));
  refused(() => rawPlay(none.engine, P1, none.id("card"), deployPick(spec, none.id)), "none of the required icon at all");
  const theirs = deployBoard(spec, [...res({ [spec.icon]: spec.count - 1 }), ...res({ [spec.icon]: 5 }, P2), ...res({ [otherIcon(spec.icon)]: spec.cost }, P1)]);
  refused(() => rawPlay(theirs.engine, P1, theirs.id("card"), deployPick(spec, theirs.id)), "the opponent's icons do not count");
}

/** The threshold is not a cost: with more icons than required only the printed cost is spent. */
function thresholdIsGateNotCost(spec: DeploySpec): void {
  const { engine, id } = deployBoard(spec, res({ [spec.icon]: spec.cost + 2 }));
  const before = ready(engine);
  play(engine, P1, id("card"), deployPick(spec, id));
  settle(engine, spec.answer);
  assert.equal(zoneOf(engine, id("card")), spec.after ?? "play");
  assert.equal(before - ready(engine), spec.cost, "only the printed cost is spent, however many icons are available");
  assert.equal(ready(engine), 2);
}

// ==================================================================================
// Cashier's Window
// CASH IN -- COST: Destroy a character you control. Deplete this card. -- EFFECT: Draw a card.
// Item, rogue, cost 1, threshold [D].
// ==================================================================================

const WINDOW = "0fc953a8-49f8-4b24-a053-502c3fb923ac";
const CASH_IN = "cash-in";

function windowBoard(
  opts: { icons?: Icons; zone?: "play" | "hand"; depleted?: boolean; turn?: number; active?: PlayerId; deck?: number; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "w", def: printing(WINDOW), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      ...deckCards("a", opts.deck ?? 3, P1),
      ...deckCards("b", 3, P2),
      ...fillers("oh", 2, P2, "hand"),
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ]
  });
}

const cashIn = (engine: SpoilsEngine, id: Id, pick: CardInstanceId) => activate(engine, P1, id("w"), CASH_IN, { selected: { c: [pick] } });

const WINDOW_SPEC: DeploySpec = { id: WINDOW, cost: 1, icon: "deception", count: 1 };

clause(WINDOW, "0:ability:cash-in", "deploys for exactly its printed cost of 1 with [D]; it is an item with no stats, ready (not depleted)", () => {
  const { engine, id } = deployBoard(WINDOW_SPEC, res({ deception: 3 }));
  const before = ready(engine);
  play(engine, P1, id("card"));
  assert.equal(zoneOf(engine, id("card")), "play");
  assert.equal(before - ready(engine), 1, "the printed cost of 1 is paid");
  assert.equal(isDepleted(engine, id("card")), false);
  assert.equal(engine.getCardTypes(id("card")).includes("item"), true);
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked on entering play");
});

clause(WINDOW, "0:ability:cash-in", "is refused without any resource, and without [D] even with plenty of other resources", () => {
  refusedOneShort(WINDOW_SPEC);
  refusedWithoutThreshold(WINDOW_SPEC);
  thresholdIsGateNotCost(WINDOW_SPEC);
});

clause(WINDOW, "0:ability:cash-in", "COST: the picked character I control is destroyed (into its owner's discard pile) and the Window is depleted; EFFECT: I draw exactly one card, the top one", () => {
  const { engine, id } = windowBoard();
  const top = deckOf(engine, P1)[0];
  const handBefore = handOf(engine, P1).length;
  const deckBefore = deckOf(engine, P1).length;
  cashIn(engine, id, id("mine"));
  assert.equal(pending(engine), undefined, "nothing is left to answer");
  assert.equal(zoneOf(engine, id("mine")), "discard", "the character was destroyed");
  assert.ok(discardOf(engine, P1).includes(id("mine")), "into its owner's discard pile");
  assert.equal(isDepleted(engine, id("w")), true, "the Window is depleted");
  assert.equal(handOf(engine, P1).length, handBefore + 1, "exactly one card was drawn");
  assert.equal(zoneOf(engine, top), "hand", "the top card of my deck");
  assert.equal(deckOf(engine, P1).length, deckBefore - 1);
  assert.equal(zoneOf(engine, id("mine2")), "play", "my other character is untouched");
  assert.equal(zoneOf(engine, id("foe")), "play", "the opponent's character is untouched");
  assert.equal(zoneOf(engine, id("w")), "play", "the Window stays in play");
});

clause(WINDOW, "0:ability:cash-in", "no resources are needed or spent", () => {
  const { engine, id } = windowBoard({ icons: { deception: 2 } });
  cashIn(engine, id, id("mine"));
  assert.equal(ready(engine), 2);
  assert.equal(attachedCount(engine, P1), 0);
});

clause(WINDOW, "0:ability:cash-in", "the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = windowBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  const oppDiscard = [...discardOf(engine, P2)];
  cashIn(engine, id, id("mine"));
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.deepEqual(discardOf(engine, P2), oppDiscard);
});

clause(WINDOW, "0:ability:cash-in", "the COST is paid when the ability is used, before the opponent can respond: the character is already destroyed and the Window depleted, but the card is not drawn yet", () => {
  const { engine, id } = windowBoard();
  const handBefore = handOf(engine, P1).length;
  activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("mine")] });
  assert.ok(engine.state.responseWindow, "a response window is open");
  assert.equal(zoneOf(engine, id("mine")), "discard", "the destroy cost is paid up front");
  assert.equal(isDepleted(engine, id("w")), true, "the deplete cost is paid up front");
  assert.equal(handOf(engine, P1).length, handBefore, "the draw is the EFFECT: not yet");
  resolvePendingResponses(engine);
  assert.equal(handOf(engine, P1).length, handBefore + 1, "...and happens when the ability resolves");
});

clause(WINDOW, "0:ability:cash-in", "a character that is destroyed as the cost still lets the draw happen even if the opponent responds", () => {
  const { engine, id } = windowBoard({ extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  const handBefore = handOf(engine, P1).length;
  activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("mine")] });
  respondWith(engine, P2, id("nothing"), {});
  assert.equal(handOf(engine, P1).length, handBefore + 1, "the ability resolves after the response");
  assert.equal(zoneOf(engine, id("mine")), "discard");
});

clause(WINDOW, "0:ability:cash-in", "only a character I control can be destroyed: an opponent's character is refused (a character I control is accepted)", () => {
  const { engine, id } = windowBoard();
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("foe")] }), "an opponent's character");
  assert.equal(zoneOf(engine, id("foe")), "play");
  assert.equal(isDepleted(engine, id("w")), false, "nothing was paid");
  cashIn(engine, id, id("mine"));
  assert.equal(zoneOf(engine, id("mine")), "discard", "control: my own character is accepted");
});

clause(WINDOW, "0:ability:cash-in", "only a character in play can be destroyed: an item, a location, a faction, a face-down card, or a character in hand / discard are refused", () => {
  const { engine, id } = windowBoard({
    extra: [
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P1, zone: "play" },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...volition(1, P1).map((p) => ({ ...p, key: "downCard" }))
    ]
  });
  const attempt = (picked: CardInstanceId) => () => activateRaw(engine, P1, id("w"), CASH_IN, { c: [picked] });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(id("downCard")), "a face-down card is only a resource");
  refused(attempt(id("inHand")), "a character in my hand");
  refused(attempt(id("inDiscard")), "a character in my discard pile");
  refused(attempt(id("w")), "the Window itself is not a character");
  assert.equal(isDepleted(engine, id("w")), false, "none of those attempts paid anything");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character I control is accepted");
});

clause(WINDOW, "0:ability:cash-in", "exactly one character is destroyed: no pick and two picks are refused", () => {
  const { engine, id } = windowBoard();
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, {}), "no pick");
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, { c: [] }), "an empty pick");
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("mine"), id("mine2")] }), "two picks");
  assert.equal(zoneOf(engine, id("mine")), "play");
  assert.equal(zoneOf(engine, id("mine2")), "play");
  assert.equal(isDepleted(engine, id("w")), false);
});

clause(WINDOW, "0:ability:cash-in", "a character I control but do not own can be destroyed; it goes to its OWNER's discard pile", () => {
  const { engine, id } = windowBoard({ extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  cashIn(engine, id, id("stolen"));
  assert.equal(zoneOf(engine, id("stolen")), "discard");
  assert.ok(discardOf(engine, P2).includes(id("stolen")), "the owner's discard pile");
  assert.equal(discardOf(engine, P1).includes(id("stolen")), false);
});

clause(WINDOW, "0:ability:cash-in", "'Deplete this card': a depleted Window cannot be used (nothing is destroyed or drawn); a ready one can", () => {
  const spent = windowBoard({ depleted: true });
  const handBefore = handOf(spent.engine, P1).length;
  refused(() => activateRaw(spent.engine, P1, spent.id("w"), CASH_IN, { c: [spent.id("mine")] }), "already depleted");
  assert.equal(zoneOf(spent.engine, spent.id("mine")), "play", "the character was not destroyed");
  assert.equal(handOf(spent.engine, P1).length, handBefore);
  const fresh = windowBoard();
  cashIn(fresh.engine, fresh.id, fresh.id("mine"));
  assert.equal(zoneOf(fresh.engine, fresh.id("mine")), "discard", "control: a ready Window works");
});

clause(WINDOW, "0:ability:cash-in", "with no character I control there is nothing to destroy: it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "w", def: printing(WINDOW), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe" }), owner: P2, zone: "play" },
      ...deckCards("a", 3, P1)
    ]
  });
  const handBefore = handOf(engine, P1).length;
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("foe")] }), "only the opponent has a character");
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, {}), "no pick");
  assert.equal(handOf(engine, P1).length, handBefore, "nothing drawn");
  assert.equal(isDepleted(engine, id("w")), false);
  assert.equal(zoneOf(engine, id("foe")), "play");
});

clause(WINDOW, "0:ability:cash-in", "with an empty deck the character is still destroyed, nothing is drawn, and the game goes on (CR 102.1a)", () => {
  const { engine, id } = windowBoard({ deck: 0 });
  const handBefore = handOf(engine, P1).length;
  cashIn(engine, id, id("mine"));
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore);
  assert.equal(engine.state.winner, undefined);
});

clause(WINDOW, "0:ability:cash-in", "it works in response on the opponent's turn too (an ability may be used in a response window)", () => {
  const { engine, id } = windowBoard({
    turn: 2,
    active: P2,
    extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }]
  });
  const handBefore = handOf(engine, P1).length;
  refused(() => activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("mine")] }), "nothing to respond to yet");
  playRaw(engine, P2, id("nothing"));
  activateRaw(engine, P1, id("w"), CASH_IN, { c: [id("mine")] });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("mine")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
  assert.equal(isDepleted(engine, id("w")), true);
});

clause(WINDOW, "0:ability:cash-in", "only the Window's controller can use it, and only while it is in play (not from the hand)", () => {
  const theirs = windowBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("w"), CASH_IN, { c: [theirs.id("mine")] }), "the opponent cannot use my Window");
  assert.equal(zoneOf(theirs.engine, theirs.id("mine")), "play");
  const inHand = windowBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("w"), CASH_IN, { c: [inHand.id("mine")] }), "in hand it is not an item in play");
  assert.equal(zoneOf(inHand.engine, inHand.id("mine")), "play");
});

clause(WINDOW, "0:ability:cash-in", "once restored at the start of my next turn the Window can be used again", () => {
  const { engine, id } = windowBoard();
  cashIn(engine, id, id("mine"));
  assert.equal(isDepleted(engine, id("w")), true);
  endTurn(engine, P1);
  endTurn(engine, P2);
  assert.equal(engine.state.activePlayerId, P1, "my turn again");
  assert.equal(isDepleted(engine, id("w")), false, "restored");
  const handBefore = handOf(engine, P1).length;
  cashIn(engine, id, id("mine2"));
  assert.equal(zoneOf(engine, id("mine2")), "discard");
  assert.equal(handOf(engine, P1).length, handBefore + 1);
});

// ==================================================================================
// Casino Kingpin
// (no rules text)  Character, rogue, subtype crimelord, cost 7, threshold [D][D], 3 strength / 4 speed / 6 life.
// ==================================================================================

const KINGPIN = "54e4d0a0-0a00-4b1d-bbc8-9f0fa1e05144";
const KINGPIN_SPEC: DeploySpec = { id: KINGPIN, cost: 7, icon: "deception", count: 2 };

/** A character deployed from hand has no keywords / abilities it does not print: it cannot attack the turn it enters, cannot be deployed out of turn, is not COVERT. */
function characterHasNoPhantomKeywords(spec: DeploySpec): void {
  const entered = deployBoard(spec, res({ [spec.icon]: Math.max(spec.cost, spec.count) }));
  play(entered.engine, P1, entered.id("card"), deployPick(spec, entered.id));
  settle(entered.engine, spec.answer);
  refused(() => declareAttackBy(entered.engine, P1, [entered.id("card")]), "no AGGRO: it cannot attack the turn it enters play");
  const theirTurn = deployBoard(spec, res({ [spec.icon]: Math.max(spec.cost, spec.count) }), { turn: 2, active: P2 });
  refused(() => rawPlay(theirTurn.engine, P1, theirTurn.id("card"), deployPick(spec, theirTurn.id)), "no TACTICAL: only on your own turn");
  assert.equal(zoneOf(theirTurn.engine, theirTurn.id("card")), "hand");
  const settled = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(spec.id), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 20, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(settled.engine, P1, [settled.id("card")]);
  settled.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [settled.id("plain")] });
  assert.deepEqual(battleOf(settled.engine)?.blockingParty, [settled.id("plain")], "no COVERT: an ordinary character can block it");
}

clause(KINGPIN, "vanilla", "plays for exactly its printed cost of 7 and nothing else happens", () => {
  deploysForExactlyItsCost(KINGPIN_SPEC);
  const { engine, id } = deployBoard(KINGPIN_SPEC, res({ deception: 7 }));
  const handBefore = handOf(engine, P1).length;
  const influence = [engine.state.players[P1].influence, engine.state.players[P2].influence];
  play(engine, P1, id("card"));
  assert.equal(engine.state.pendingChoice, undefined, "nothing is asked");
  assert.equal(isDepleted(engine, id("card")), false);
  assert.equal(handOf(engine, P1).length, handBefore - 1, "only the card itself left my hand");
  assert.deepEqual([engine.state.players[P1].influence, engine.state.players[P2].influence], influence, "no influence changes");
});

clause(KINGPIN, "vanilla", "has its printed 3 strength / 4 speed / 6 life, the crimelord subtype and the character type", () => {
  const { engine, id } = deployBoard(KINGPIN_SPEC, res({ deception: 7 }));
  play(engine, P1, id("card"));
  assert.equal(engine.getStat(id("card"), "strength"), 3);
  assert.equal(engine.getStat(id("card"), "speed"), 4);
  assert.equal(engine.getStat(id("card"), "life"), 6);
  assert.deepEqual(engine.getSubtypes(id("card")), ["crimelord"]);
  assert.deepEqual(engine.getCardTypes(id("card")), ["character"]);
  assert.deepEqual(engine.getKeywords(id("card")), [], "no keywords");
  assert.deepEqual(engine.getAvailableActivatedAbilities(P1).filter((entry) => entry.cardId === id("card")), [], "no abilities");
});

clause(KINGPIN, "vanilla", "is refused one resource short of 7, and with no resources", () => refusedOneShort(KINGPIN_SPEC));

clause(KINGPIN, "vanilla", "is refused with a single [D] (or none, or only face-down / the opponent's [D]) even with plenty of other resources", () => refusedWithoutThreshold(KINGPIN_SPEC));

clause(KINGPIN, "vanilla", "[D][D] plus 5 other resources is enough: the threshold is a gate, the cost is paid with anything", () => {
  const { engine, id } = deployBoard(KINGPIN_SPEC, [...res({ deception: 2 }), ...res({ rage: 5 })]);
  play(engine, P1, id("card"));
  assert.equal(zoneOf(engine, id("card")), "play");
  assert.equal(ready(engine), 0);
  thresholdIsGateNotCost(KINGPIN_SPEC);
});

clause(KINGPIN, "vanilla", "has no AGGRO / TACTICAL / COVERT it does not print", () => characterHasNoPhantomKeywords(KINGPIN_SPEC));

clause(KINGPIN, "vanilla", "deals its printed 3 strength to the faction when unblocked and survives 5 damage but not 6", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "card", def: printing(KINGPIN), owner: P1, zone: "play" },
      { key: "z5", def: zapTactic("Zap5", 5), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
    ]
  });
  const before = engine.state.players[P2].influence;
  fight(engine, P1, [id("card")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - engine.state.players[P2].influence, 3, "an unblocked attack deals exactly its printed strength");
  assert.equal(isDepleted(engine, id("card")), true);
  play(engine, P1, id("z5"), { selected: { t: [id("card")] } });
  assert.equal(zoneOf(engine, id("card")), "play", "5 damage does not kill a 6-life character");
  play(engine, P1, id("z1"), { selected: { t: [id("card")] } });
  assert.equal(zoneOf(engine, id("card")), "discard", "the 6th damage does");
});

// ==================================================================================
// Cloaked Weaponmaster
// You may play "gear" cards whenever you could play a tactic.
// Character, rogue, subtype outlaw, cost 1, threshold [D], 1 strength / 3 speed / 1 life.
// ==================================================================================

const WEAPONMASTER = "cc4064e8-ba75-4eab-89bd-f1d90d44429b";

const gearItem = (name = "Gear", over: Partial<CardDefinition> = {}): CardDefinition => item({ name, subtype: ["gear"], cost: 0, ...over });

/** P2's turn 2; P1 holds a gear item, a non-gear item and a non-gear character in hand. `master` places the Weaponmaster. */
function weaponBoard(
  opts: { master?: "play" | "hand" | "faceDown" | "none"; active?: PlayerId; turn?: number; icons?: Icons; extra?: CardPlacement[] } = {}
) {
  const master = opts.master ?? "play";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      ...(master === "none"
        ? []
        : [{ key: "wm", def: printing(WEAPONMASTER), owner: P1, zone: master === "hand" ? ("hand" as const) : ("play" as const), faceDown: master === "faceDown" ? true : undefined }]),
      { key: "gear", def: gearItem("Gear"), owner: P1, zone: "hand" },
      { key: "plain", def: item({ name: "PlainItem", cost: 0 }), owner: P1, zone: "hand" },
      { key: "plainChar", def: character({ name: "PlainChar", cost: 0 }), owner: P1, zone: "hand" },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ]
  });
}

/** P2 plays Nothing: P1 holds priority in a response window on P2's turn. */
function opponentOpensWindow(engine: SpoilsEngine, id: Id): void {
  playRaw(engine, P2, id("nothing"));
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
}

clause(WEAPONMASTER, "0:rule", "in play, a gear card in my hand can be played in response on the opponent's turn, like a tactic; it resolves into play under my control", () => {
  const { engine, id } = weaponBoard();
  opponentOpensWindow(engine, id);
  playRaw(engine, P1, id("gear"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gear")), "play", "an item resolves into play, not into the discard pile");
  assert.equal(controllerOf(engine, id("gear")), P1);
  assert.equal(zoneOf(engine, id("nothing")), "discard", "the opponent's tactic also resolved");
});

clause(WEAPONMASTER, "0:rule", "without the Weaponmaster the same gear card cannot be played in that window (control)", () => {
  const { engine, id } = weaponBoard({ master: "none" });
  opponentOpensWindow(engine, id);
  refused(() => playRaw(engine, P1, id("gear")), "an ordinary item cannot be played on the opponent's turn");
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

clause(WEAPONMASTER, "0:rule", "only 'gear' cards: a non-gear item and a non-gear character stay unplayable in that window", () => {
  const { engine, id } = weaponBoard();
  opponentOpensWindow(engine, id);
  refused(() => playRaw(engine, P1, id("plain")), "a non-gear item", /Only tactics or TACTICAL cards may be deployed as responses/);
  refused(() => playRaw(engine, P1, id("plainChar")), "a non-gear character", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(engine, id("plain")), "hand");
  assert.equal(zoneOf(engine, id("plainChar")), "hand");
  playRaw(engine, P1, id("gear"));
  assert.ok(engine.state.responseWindow, "control: the gear card is accepted");
});

clause(WEAPONMASTER, "0:rule", "'gear' means the subtype: a gear card that is not an item (a gear character) is playable at tactic timing too, a card with another subtype is not", () => {
  const { engine, id } = weaponBoard({
    extra: [
      { key: "gearChar", def: character({ name: "GearChar", subtype: ["gear"], cost: 0 }), owner: P1, zone: "hand" },
      { key: "otherSub", def: item({ name: "OtherSub", subtype: ["weapon"], cost: 0 }), owner: P1, zone: "hand" }
    ]
  });
  opponentOpensWindow(engine, id);
  refused(() => playRaw(engine, P1, id("otherSub")), "an item of another subtype", /Only tactics or TACTICAL cards may be deployed as responses/);
  playRaw(engine, P1, id("gearChar"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gearChar")), "play", "a gear-subtype character is a gear card");
});

clause(WEAPONMASTER, "0:rule", "a card with several subtypes counts as 'gear' as long as one of them is gear", () => {
  const { engine, id } = weaponBoard({ extra: [{ key: "multi", def: item({ name: "MultiGear", subtype: ["weapon", "gear"], cost: 0 }), owner: P1, zone: "hand" }] });
  opponentOpensWindow(engine, id);
  playRaw(engine, P1, id("multi"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("multi")), "play");
});

clause(WEAPONMASTER, "0:rule", "'whenever you COULD play a tactic': with no response window open on the opponent's turn the gear card still cannot be played", () => {
  const { engine, id } = weaponBoard();
  assert.equal(engine.state.responseWindow, undefined);
  refused(() => playRaw(engine, P1, id("gear")), "no tactic could be played now", /Only the active player may deploy/);
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

clause(WEAPONMASTER, "0:rule", "it also applies at a battle response point: the opponent attacks, passes, and I play the gear card", () => {
  const { engine, id } = weaponBoard();
  declareAttackOpenWindow(engine, P2, [id("atk")]);
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(engine, P1, id("gear"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gear")), "play");
});

clause(WEAPONMASTER, "0:rule", "it also applies when the opponent announces the end of their turn", () => {
  const { engine, id } = weaponBoard();
  refused(() => playRaw(engine, P1, id("gear")), "before the announcement: nothing to respond to");
  engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond to the end of turn");
  playRaw(engine, P1, id("gear"));
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("gear")), "play");
});

clause(WEAPONMASTER, "0:rule", "the gear card is played like any card: its printed cost is paid and its threshold is needed", () => {
  const gear2 = gearItem("PricyGear", { cost: 2, threshold: "dd" as never });
  const make = (icons: Icons) =>
    weaponBoard({ icons, extra: [{ key: "pricy", def: gear2, owner: P1, zone: "hand" }] });
  const short = make({ deception: 1, rage: 3 });
  opponentOpensWindow(short.engine, short.id);
  refused(() => playRaw(short.engine, P1, short.id("pricy")), "only one [D]");
  const poor = make({ deception: 2 });
  const spent = ready(poor.engine);
  opponentOpensWindow(poor.engine, poor.id);
  playRaw(poor.engine, P1, poor.id("pricy"));
  resolvePendingResponses(poor.engine);
  assert.equal(zoneOf(poor.engine, poor.id("pricy")), "play");
  assert.equal(spent - ready(poor.engine), 2, "its cost of 2 was paid");
});

clause(WEAPONMASTER, "0:rule", "an ATTACH TO gear card played that way picks its host and enters play attached to it", () => {
  const attachGear = gearItem("AttachGear", { attachTo: "character" as never });
  const { engine, id } = weaponBoard({
    extra: [
      { key: "ag", def: attachGear, owner: P1, zone: "hand" },
      { key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }
    ]
  });
  opponentOpensWindow(engine, id);
  playRaw(engine, P1, id("ag"), { selected: { attachTo: [id("host")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("ag")), "play");
  assert.equal(engine.state.cards[id("ag")].attachedTo, id("host"));
});

clause(WEAPONMASTER, "0:rule", "it is MY permission: my opponent's gear cards are not playable at tactic timing because of my Weaponmaster (control: with their own Weaponmaster they are)", () => {
  const theirGear = (withMaster: boolean) =>
    buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "wm", def: printing(WEAPONMASTER), owner: withMaster ? P2 : P1, zone: "play" },
        { key: "gear", def: gearItem("TheirGear"), owner: P2, zone: "hand" },
        { key: "nothing", def: nothingTactic(), owner: P1, zone: "hand" }
      ]
    });
  const mine = theirGear(false);
  playRaw(mine.engine, P1, mine.id("nothing"));
  assert.equal(mine.engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent may respond");
  refused(() => playRaw(mine.engine, P2, mine.id("gear")), "my Weaponmaster does not help them", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(mine.engine, mine.id("gear")), "hand");
  const theirs = theirGear(true);
  playRaw(theirs.engine, P1, theirs.id("nothing"));
  playRaw(theirs.engine, P2, theirs.id("gear"));
  resolvePendingResponses(theirs.engine);
  assert.equal(zoneOf(theirs.engine, theirs.id("gear")), "play", "their own Weaponmaster does");
});

clause(WEAPONMASTER, "0:rule", "it stops when the Weaponmaster leaves play: destroyed, the gear card is no longer playable at tactic timing", () => {
  const { engine, id } = weaponBoard({
    extra: [
      { key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" },
      { key: "nothing2", def: nothingTactic(), owner: P2, zone: "hand" }
    ]
  });
  opponentOpensWindow(engine, id);
  resolvePendingResponses(engine);
  assert.equal(engine.state.responseWindow, undefined, "control: the window closed");
  playRaw(engine, P2, id("kill"), { selected: { t: [id("wm")] } });
  resolvePendingResponses(engine);
  assert.equal(zoneOf(engine, id("wm")), "discard", "the Weaponmaster is gone");
  playRaw(engine, P2, id("nothing2"));
  refused(() => playRaw(engine, P1, id("gear")), "no Weaponmaster: no permission", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(engine, id("gear")), "hand");
});

clause(WEAPONMASTER, "0:rule", "it only works while the Weaponmaster is in play: in my hand, or face-down as a resource, it gives no permission (CR 411.1)", () => {
  const inHand = weaponBoard({ master: "hand" });
  opponentOpensWindow(inHand.engine, inHand.id);
  refused(() => playRaw(inHand.engine, P1, inHand.id("gear")), "Weaponmaster in hand", /Only tactics or TACTICAL cards may be deployed as responses/);
  const down = weaponBoard({ master: "faceDown" });
  opponentOpensWindow(down.engine, down.id);
  refused(() => playRaw(down.engine, P1, down.id("gear")), "Weaponmaster face-down", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(down.engine, down.id("gear")), "hand");
});

clause(WEAPONMASTER, "0:rule", "the Weaponmaster itself gets no such permission: it cannot be played in a response window, and it deploys for exactly 1 with [D] with its printed 1 / 3 / 1", () => {
  const { engine, id } = weaponBoard({ master: "none", extra: [{ key: "wm2", def: printing(WEAPONMASTER), owner: P1, zone: "hand" }, ...res({ deception: 2 })] });
  opponentOpensWindow(engine, id);
  refused(() => playRaw(engine, P1, id("wm2")), "an ordinary outlaw character is not a gear card", /Only tactics or TACTICAL cards may be deployed as responses/);
  const spec: DeploySpec = { id: WEAPONMASTER, cost: 1, icon: "deception", count: 1 };
  deploysForExactlyItsCost(spec);
  refusedOneShort(spec);
  refusedWithoutThreshold(spec);
  const mine = deployBoard(spec, res({ deception: 1 }));
  play(mine.engine, P1, mine.id("card"));
  assert.equal(mine.engine.getStat(mine.id("card"), "strength"), 1);
  assert.equal(mine.engine.getStat(mine.id("card"), "speed"), 3);
  assert.equal(mine.engine.getStat(mine.id("card"), "life"), 1);
  assert.deepEqual(mine.engine.getSubtypes(mine.id("card")), ["outlaw"]);
});

// ==================================================================================
// Cunning Disguise
// ATTACH TO CHARACTER. The attached character loses 1 strength, 1 life, and gains COVERT.
// FLIP UP: 0 [D][D].   Item (gear), rogue, cost 2, threshold [D][D].
// ==================================================================================

const DISGUISE = "e6906da0-c721-455f-ba6a-7a4496d85264";

function disguiseBoard(
  opts: {
    icons?: Icons;
    oppIcons?: Icons;
    disguise?: "hand" | "faceDown" | "attached" | "none";
    host?: string;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
    hostStats?: Partial<CardDefinition>;
  } = {}
) {
  const where = opts.disguise ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      ...(where === "none"
        ? []
        : [
            {
              key: "dg",
              def: printing(DISGUISE),
              owner: P1,
              zone: where === "hand" ? ("hand" as const) : ("play" as const),
              faceDown: where === "faceDown" ? true : undefined,
              attachedToKey: where === "attached" ? (opts.host ?? "mine") : undefined
            }
          ]),
      { key: "mine", def: character({ name: "Mine", strength: 3, life: 4, speed: 2, ...opts.hostStats }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 3, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type DisguiseGame = ReturnType<typeof disguiseBoard>;
const attachDisguise = (b: DisguiseGame, hostKey: string, cardKey = "dg") => play(b.engine, P1, b.id(cardKey), { selected: { attachTo: [b.id(hostKey)] } });
const flipDisguise = (b: DisguiseGame, hostKey?: string, player: PlayerId = P1) =>
  flipUpRaw(b.engine, player, b.id("dg"), hostKey ? { attachTo: [b.id(hostKey)] } : {});

const DISGUISE_SPEC: DeploySpec = {
  id: DISGUISE,
  cost: 2,
  icon: "deception",
  count: 2,
  extra: () => [{ key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }],
  selected: (id) => ({ attachTo: [id("host")] })
};

// -- 0:attach --------------------------------------------------------------------

clause(DISGUISE, "0:attach", "attaches to a character you control: it enters play attached to that character, the printed cost of 2 is paid, and no other character gets it", () => {
  const b = disguiseBoard({ icons: { deception: 3 } });
  const before = ready(b.engine);
  attachDisguise(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(before - ready(b.engine), 2, "the printed cost of 2 is paid");
  assert.equal(b.engine.state.cards[b.id("dg")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 3, "no other character gets it");
});

clause(DISGUISE, "0:attach", "attaches to an opponent's character too (ATTACH TO CHARACTER names no controller); I keep controlling the Disguise", () => {
  const b = disguiseBoard({ icons: { deception: 2 } });
  attachDisguise(b, "foe");
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("dg")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "the opposing host is the one that is disguised");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
});

clause(DISGUISE, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card", () => {
  const b = disguiseBoard({ icons: { deception: 3 } });
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "the opponent's faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand", "nothing was played");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(DISGUISE, "0:attach", "is refused for a character that is not in play (in your hand or in a discard pile)", () => {
  const b = disguiseBoard({ icons: { deception: 3 } });
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("inHand")), "a character in hand");
  refused(attempt(b.id("inDiscard")), "a character in a discard pile");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
});

clause(DISGUISE, "0:attach", "needs exactly one host: no pick, an empty pick and two picks are refused", () => {
  const b = disguiseBoard({ icons: { deception: 3 } });
  refused(() => playRaw(b.engine, P1, b.id("dg"), {}), "no selection at all");
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [] } }), "no host picked");
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
});

clause(DISGUISE, "0:attach", "deploys for exactly 2 with [D][D]; refused one resource short, and with one [D] even with plenty of other resources", () => {
  deploysForExactlyItsCost(DISGUISE_SPEC);
  refusedOneShort(DISGUISE_SPEC);
  refusedWithoutThreshold(DISGUISE_SPEC);
  thresholdIsGateNotCost(DISGUISE_SPEC);
});

clause(DISGUISE, "0:attach", "it is an item: it can only be deployed on my own turn, not in a response on the opponent's turn", () => {
  const b = disguiseBoard({ icons: { deception: 3 }, turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } }), "not my turn, nothing to respond to");
  playRaw(b.engine, P2, b.id("nothing"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } }), "an item is not a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
});

clause(DISGUISE, "0:attach", "when the host is destroyed the Disguise leaves play with it (to its owner's discard pile)", () => {
  const b = disguiseBoard({ disguise: "attached", extra: [{ key: "kill", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard", "the attached card follows its host out of play (CR 301.4)");
  assert.ok(discardOf(b.engine, P1).includes(b.id("dg")), "discardOf(b.engine, P1).includes(b.id(\"dg\"))");
});

clause(DISGUISE, "0:attach", "when the host is put into its owner's hand the Disguise leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = disguiseBoard({ disguise: "attached", host: "foe", extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand", "it leaves play 'in the same way': put into its owner's hand");
  assert.ok(handOf(b.engine, P1).includes(b.id("dg")), "my hand (I own the Disguise)");
});

// -- 1:rule ----------------------------------------------------------------------

clause(DISGUISE, "1:rule", "the attached character loses exactly 1 strength and 1 life (speed is untouched) and gains COVERT", () => {
  const b = disguiseBoard({ disguise: "attached" });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3 - 1);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4 - 1);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "speed is untouched");
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "it gains COVERT");
});

clause(DISGUISE, "1:rule", "only the attached character is affected: my other character, the opponent's character and the Disguise's own item are not", () => {
  const b = disguiseBoard({ disguise: "attached" });
  for (const key of ["mine2", "foe"]) {
    assert.equal(b.engine.getStat(b.id(key), "strength"), 3, `${key} strength`);
    assert.equal(b.engine.getStat(b.id(key), "life"), 4, `${key} life`);
    assert.equal(hasKeyword(b.engine, b.id(key), "covert"), false, `${key} is not covert`);
  }
});

clause(DISGUISE, "1:rule", "an opposing host is the one that is disguised (loses 1 strength / 1 life, gains COVERT)", () => {
  const b = disguiseBoard({ disguise: "attached", host: "foe" });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
  assert.ok(hasKeyword(b.engine, b.id("foe"), "covert"), "hasKeyword(b.engine, b.id(\"foe\"), \"covert\")");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
});

clause(DISGUISE, "1:rule", "the effect starts when the Disguise enters play and ends when it leaves play", () => {
  const b = disguiseBoard({ icons: { deception: 2 }, extra: [{ key: "kill", def: killAnyTactic("item"), owner: P1, zone: "hand" }] });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3, "before it enters play");
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
  attachDisguise(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "while attached");
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "hasKeyword(b.engine, b.id(\"mine\"), \"covert\")");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("dg")] } });
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard", "the Disguise itself was destroyed");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3, "strength restored");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4, "life restored");
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false, "COVERT gone");
});

clause(DISGUISE, "1:rule", "two Disguises on one character stack the stat loss (-2 / -2) but COVERT is held only once (CR 507.3e)", () => {
  const b = disguiseBoard({
    disguise: "attached",
    extra: [{ key: "dg2", def: printing(DISGUISE), owner: P1, zone: "play", attachedToKey: "mine" }]
  });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3 - 2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4 - 2);
  assert.equal(b.engine.getKeywords(b.id("mine")).filter((k) => k === "covert").length, 1, "one instance of COVERT only");
});

clause(DISGUISE, "1:rule", "a host that is already COVERT still has COVERT once", () => {
  const b = disguiseBoard({ disguise: "attached", hostStats: { behavior: { keywords: ["covert"] } } });
  assert.equal(b.engine.getKeywords(b.id("mine")).filter((k) => k === "covert").length, 1);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});

clause(DISGUISE, "1:rule", "a host with 0 strength stays at 0 strength (CR 410.4), not -1", () => {
  const b = disguiseBoard({ disguise: "attached", hostStats: { strength: 0 } });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 0, "a number an effect would push below 0 stays at 0");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
});

clause(DISGUISE, "1:rule", "a host with 1 life drops to 0 life and is destroyed (FAQ: a character with 0 life is destroyed); the Disguise follows it", () => {
  const b = disguiseBoard({ disguise: "hand", icons: { deception: 2 }, hostStats: { life: 1 } });
  attachDisguise(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "1 life - 1 = 0 life: a character with 0 life (0 damage >= 0 life) is destroyed");
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard", "and the attached Disguise leaves play with it");
});

clause(DISGUISE, "1:rule", "the life loss is real: a host at 4 life (3 with the Disguise) survives 2 damage and is destroyed by the 3rd", () => {
  const b = disguiseBoard({
    disguise: "attached",
    extra: [
      { key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("z2"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "2 damage does not kill a 3-life host");
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "the 3rd damage does");
});

clause(DISGUISE, "1:rule", "a face-down Disguise in play is only a resource: it disguises nothing (CR 411.1)", () => {
  const b = disguiseBoard({ disguise: "faceDown" });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
});

/** P1 attacks with `attackers`; P2 holds `blockers`. The Disguise sits on `hostKey`. */
function covertBoard(hostKey: string, attacker: PlayerId) {
  const defender = other(attacker);
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: attacker,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 3, life: 4, speed: 2 }), owner: hostKey === "attacker" ? attacker : defender, zone: "play" },
      { key: "dg", def: printing(DISGUISE), owner: hostKey === "attacker" ? attacker : defender, zone: "play", attachedToKey: "host" },
      { key: "plainAttacker", def: character({ name: "PlainAttacker", strength: 1, life: 6, speed: 1 }), owner: attacker, zone: "play" },
      { key: "plainBlocker", def: character({ name: "PlainBlocker", strength: 1, life: 6, speed: 1 }), owner: defender, zone: "play" },
      { key: "covertBlocker", def: character({ name: "CovertBlocker", strength: 1, life: 6, speed: 1, behavior: { keywords: ["covert"] } }), owner: defender, zone: "play" }
    ]
  });
}

clause(DISGUISE, "1:rule", "COVERT works: the disguised character attacking alone cannot be blocked by a non-covert character, but a covert one can block it", () => {
  const b = covertBoard("attacker", P1);
  declareAttackBy(b.engine, P1, [b.id("host")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] }), "a non-covert character cannot block a covert party");
  refused(
    () => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker"), b.id("covertBlocker")] }),
    "...nor join a covert blocker"
  );
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("covertBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("covertBlocker")]);
});

clause(DISGUISE, "1:rule", "COVERT is the party's: with a non-covert party member the party is not covert and anyone may block", () => {
  const b = covertBoard("attacker", P1);
  declareAttackBy(b.engine, P1, [b.id("host"), b.id("plainAttacker")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plainBlocker")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plainBlocker")]);
});

clause(DISGUISE, "1:rule", "a disguised character that blocks can block only covert parties (CR 507.3c)", () => {
  const b = covertBoard("blocker", P2);
  declareAttackBy(b.engine, P2, [b.id("plainAttacker")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] }), "a covert character may block only a covert party");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty ?? [], []);
});

clause(DISGUISE, "1:rule", "...but it can block a covert party", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 3, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "dg", def: printing(DISGUISE), owner: P1, zone: "play", attachedToKey: "host" },
      { key: "covertAttacker", def: character({ name: "CovertAttacker", behavior: { keywords: ["covert"] } }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P2, [b.id("covertAttacker")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("host")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("host")]);
});

// -- 2:flipUp --------------------------------------------------------------------

clause(DISGUISE, "2:flipUp", "a face-down Disguise is a resource that provides Volition until it is flipped", () => {
  const b = disguiseBoard({ disguise: "faceDown", icons: { deception: 2 } });
  assert.equal(b.engine.isResource(b.id("dg")), true);
  assert.equal(ready(b.engine), 3, "two [D] plus the face-down Disguise");
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(DISGUISE, "2:flipUp", "flips up for 0 with [D][D]: nothing is paid, it enters play face-up attached to the picked character and its effect applies", () => {
  const b = disguiseBoard({ disguise: "faceDown", icons: { deception: 2 } });
  flipDisguise(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(isFaceDown(b.engine, b.id("dg")), false, "face-up");
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, b.id("mine"), "attached to the picked character");
  assert.equal(attachedCount(b.engine, P1), 0, "FLIP UP cost 0: no resource was spent");
  assert.equal(ready(b.engine), 2, "the two [D] are still available; the card stopped being a resource");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "hasKeyword(b.engine, b.id(\"mine\"), \"covert\")");
});

clause(DISGUISE, "2:flipUp", "it pays only the FLIP UP cost of 0, not the card's cost of 2", () => {
  const b = disguiseBoard({ disguise: "faceDown", icons: { deception: 2, rage: 3 } });
  const before = ready(b.engine);
  flipDisguise(b, "foe");
  resolvePendingResponses(b.engine);
  assert.equal(before - ready(b.engine), 1, "only the card itself stopped being a resource");
  assert.equal(attachedCount(b.engine, P1), 0);
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, b.id("foe"), "an opposing character is a legal host");
});

clause(DISGUISE, "2:flipUp", "FLIP UP needs [D][D]: one [D] among many other resources is refused (and the card stays face-down), two are accepted", () => {
  const one = disguiseBoard({ disguise: "faceDown", icons: { deception: 1, rage: 6 } });
  refused(() => flipDisguise(one, "mine"), "one [D]");
  assert.equal(isFaceDown(one.engine, one.id("dg")), true, "still face-down");
  assert.equal(one.engine.getStat(one.id("mine"), "strength"), 3);
  const none = disguiseBoard({ disguise: "faceDown", icons: { rage: 6 } });
  refused(() => flipDisguise(none, "mine"), "no [D]");
  const two = disguiseBoard({ disguise: "faceDown", icons: { deception: 2, rage: 1 } });
  flipDisguise(two, "mine");
  resolvePendingResponses(two.engine);
  assert.equal(two.engine.state.cards[two.id("dg")].attachedTo, two.id("mine"), "control: [D][D] is accepted");
});

clause(DISGUISE, "2:flipUp", "the card's own Volition does not provide a [D], and the opponent's [D] do not count", () => {
  const onlyVolition = disguiseBoard({ disguise: "faceDown", icons: { rage: 3 } });
  refused(() => flipDisguise(onlyVolition, "mine"), "no [D] anywhere");
  const theirs = disguiseBoard({ disguise: "faceDown", icons: { deception: 1 }, oppIcons: { deception: 4 } });
  refused(() => flipDisguise(theirs, "mine"), "only the opponent has [D][D]");
  assert.equal(isFaceDown(theirs.engine, theirs.id("dg")), true);
  const facedownMates = disguiseBoard({ disguise: "faceDown", icons: { deception: 1 }, extra: volition(3, P1) });
  refused(() => flipDisguise(facedownMates, "mine"), "other face-down cards provide Volition, not [D]");
});

clause(DISGUISE, "2:flipUp", "the pick restrictions still apply: only a character in play (no item, location, faction, face-down card, hand or discard card) and exactly one", () => {
  const b = disguiseBoard({ disguise: "faceDown", icons: { deception: 2 } });
  refused(() => flipDisguise(b, "thing"), "an item");
  refused(() => flipDisguise(b, "place"), "a location");
  refused(() => flipUpRaw(b.engine, P1, b.id("dg"), { attachTo: [factionOf(b.engine, P1)] }), "a faction");
  refused(() => flipDisguise(b, "hidden"), "a face-down card");
  refused(() => flipDisguise(b, "inHand"), "a character in my hand");
  refused(() => flipDisguise(b, "inDiscard"), "a character in my discard pile");
  refused(() => flipDisguise(b), "no pick");
  refused(() => flipUpRaw(b.engine, P1, b.id("dg"), { attachTo: [b.id("mine"), b.id("mine2")] }), "two picks");
  assert.equal(isFaceDown(b.engine, b.id("dg")), true, "still face-down after every refusal");
  flipDisguise(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, b.id("mine"), "control: a character is accepted");
});

clause(DISGUISE, "2:flipUp", "only its controller can flip it up, and only while it is face-down in play (not from the hand, not when already face-up)", () => {
  const theirs = disguiseBoard({ disguise: "faceDown", icons: { deception: 2 }, oppIcons: { deception: 2 } });
  refused(() => flipDisguise(theirs, "mine", P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("dg")), true);
  const inHand = disguiseBoard({ disguise: "hand", icons: { deception: 2 } });
  refused(() => flipDisguise(inHand, "mine"), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("dg")), "hand");
  const faceUp = disguiseBoard({ disguise: "attached", icons: { deception: 2 } });
  refused(() => flipDisguise(faceUp, "mine2"), "already face-up in play");
  assert.equal(faceUp.engine.state.cards[faceUp.id("dg")].attachedTo, faceUp.id("mine"), "it was not re-attached");
});

clause(DISGUISE, "2:flipUp", "FLIP UP does not change when an item may be deployed (CR 507.4d): it is refused on the opponent's turn, even in a response window", () => {
  const b = disguiseBoard({
    disguise: "faceDown",
    icons: { deception: 2 },
    turn: 2,
    active: P2,
    extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }]
  });
  refused(() => flipDisguise(b, "mine"), "no window yet");
  playRaw(b.engine, P2, b.id("nothing"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  refused(() => flipDisguise(b, "mine"), "an item still can't be played in a response: FLIP UP does not change when a type may be deployed");
  assert.equal(isFaceDown(b.engine, b.id("dg")), true);
});

clause(DISGUISE, "2:flipUp", "on my own turn it can be flipped up at any time I could deploy an item", () => {
  const b = disguiseBoard({ disguise: "faceDown", icons: { deception: 2 }, turn: 3 });
  assert.equal(b.engine.state.activePlayerId, P1);
  flipDisguise(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(isFaceDown(b.engine, b.id("dg")), false);
});

clause(DISGUISE, "2:flipUp", "a flipped-up item is played as though from the hand (CR 507.4a): the opponent gets the chance to respond before it resolves, and can terminate it", () => {
  const b = disguiseBoard({
    disguise: "faceDown",
    icons: { deception: 2 },
    extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }]
  });
  holdFlipUp(() => flipDisguise(b, "mine"));
  assert.ok(b.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(b.engine.state.cards[b.id("dg")].attachedTo, undefined, "it has not entered play yet");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("dg")] });
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard", "terminated: it goes to its owner's discard pile (CR 314.1)");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3, "it never disguised anything");
});

// --- "choose a card type" helpers (Dauntless Gambler, Flailing Knife, Flimflam Man) ---------------

type TypeName = "character" | "item" | "location" | "tactic" | "resource";
const CARD_TYPES: TypeName[] = ["character", "item", "location", "tactic", "resource"];

const typedDef = (type: TypeName, name: string): CardDefinition => {
  switch (type) {
    case "character":
      return character({ name });
    case "item":
      return item({ name });
    case "location":
      return location({ name });
    case "tactic":
      return tactic({ name, cost: 0 });
    case "resource":
      return resourceCard({ name });
  }
};

/** Deck placements for `owner` whose cards have the given types; keys `<prefix>0..`. Check the deck array for the real order. */
const typedDeck = (prefix: string, types: TypeName[], owner: PlayerId): CardPlacement[] =>
  types.map((type, index) => ({ key: `${prefix}${index}`, def: typedDef(type, `${prefix.toUpperCase()}${index} ${type}`), owner, zone: "deck" as const }));

const otherTypesThan = (type: TypeName) => CARD_TYPES.filter((t) => t !== type);

interface TypeOption {
  label?: string;
}

/** The open `chooserSelectsOption` offers `type`: answers with that option. */
function chooseType(engine: SpoilsEngine, type: TypeName): void {
  const pc = pending(engine) as unknown as { kind: string; options: TypeOption[] } | undefined;
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption", "the controller is asked to choose a card type");
  const index = pc.options.findIndex((option) => option.label === type);
  assert.ok(index >= 0, `'${type}' is one of the card types offered`);
  answerPending(engine, "chooserSelectsOption", { index });
}

/** Index of the option that declines to choose a card type (a label such as "Decline" / "None"), or -1. */
function declineOptionIndex(engine: SpoilsEngine): number {
  const pc = pending(engine) as unknown as { options: TypeOption[] } | undefined;
  if (!pc) return -1;
  return pc.options.findIndex((option) => !CARD_TYPES.includes(option.label as TypeName));
}

const revealedIds = (engine: SpoilsEngine): string[] =>
  revealEvents(engine).flatMap((entry) => (entry.event as unknown as { cardIds: string[] }).cardIds);

// ==================================================================================
// Dauntless Gambler
// When this card enters play, you may choose a card type. If you do, reveal the top card of your deck. If that card is
// the chosen type, put a token on this card. Put the top card of your deck on the bottom.
// While there is a token on this card, it gains 1 strength and 1 life.
// Character, rogue, subtype gambler, cost 3, threshold [D][D], 2 strength / 3 speed / 2 life.
// ==================================================================================

const GAMBLER = "1a6323e1-ea9a-4ea0-acee-0eaa9b61a9c1";

function gamblerBoard(
  opts: {
    deck?: TypeName[];
    oppDeck?: TypeName[];
    zone?: "hand" | "play";
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    counters?: Record<string, number>;
    extra?: CardPlacement[];
    owner?: PlayerId;
  } = {}
) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "g", def: printing(GAMBLER), owner, zone: opts.zone ?? "hand", counters: opts.counters },
      ...typedDeck("d", opts.deck ?? ["character", "item", "location", "tactic", "resource"], owner),
      ...typedDeck("o", opts.oppDeck ?? ["character", "item", "location"], other(owner)),
      ...res(opts.icons ?? { deception: 4 }, owner),
      ...(opts.extra ?? [])
    ]
  });
}

const GAMBLER_SPEC: DeploySpec = { id: GAMBLER, cost: 3, icon: "deception", count: 2 };

clause(GAMBLER, "0:rule", "deploys for exactly 3 with [D][D] with its printed 2 / 3 / 2 and gambler subtype; refused one short, and with one [D]", () => {
  deploysForExactlyItsCost(GAMBLER_SPEC);
  refusedOneShort(GAMBLER_SPEC);
  refusedWithoutThreshold(GAMBLER_SPEC);
  thresholdIsGateNotCost(GAMBLER_SPEC);
  const { engine, id } = gamblerBoard({ zone: "play" });
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "speed"), 3);
  assert.equal(engine.getStat(id("g"), "life"), 2);
  assert.deepEqual(engine.getSubtypes(id("g")), ["gambler"]);
});

clause(GAMBLER, "0:rule", "when it enters play its controller is asked to choose a card type: the five types are offered (the choice is the controller's)", () => {
  const { engine, id } = gamblerBoard();
  play(engine, P1, id("g"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; options: TypeOption[] };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  for (const type of CARD_TYPES) assert.ok(pc.options.some((option) => option.label === type), `${type} is offered`);
  assert.equal(zoneOf(engine, id("g")), "play", "it is already in play when the trigger asks");
});

clause(GAMBLER, "0:rule", "'you MAY choose a card type': the controller can decline (the choice offers a way to choose no type)", () => {
  const { engine, id } = gamblerBoard();
  play(engine, P1, id("g"));
  const decline = declineOptionIndex(engine);
  assert.ok(decline >= 0, "besides the five card types there is an option to decline");
  answerPending(engine, "chooserSelectsOption", { index: decline });
  assert.equal(pending(engine), undefined);
  assert.equal(revealEvents(engine).length, 0, "'If you do': declining reveals nothing");
  assert.equal(tokensOn(engine, id("g")), 0);
});

clause(GAMBLER, "0:rule", "literal reading: the last sentence is not conditional on choosing, so even after declining the top card of the deck is put on the bottom", () => {
  const { engine, id } = gamblerBoard();
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("g"));
  const decline = declineOptionIndex(engine);
  assert.ok(decline >= 0, "the choice can be declined");
  answerPending(engine, "chooserSelectsOption", { index: decline });
  assert.equal(revealEvents(engine).length, 0, "nothing was revealed");
  assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]], "'Put the top card of your deck on the bottom' is a sentence of its own");
});

for (const type of CARD_TYPES) {
  clause(GAMBLER, "0:rule", `choosing '${type}' with a ${type} on top: the top card is revealed, a token is put on the Gambler, and the revealed card goes to the bottom`, () => {
    const deck = [type, ...otherTypesThan(type), otherTypesThan(type)[0]];
    const { engine, id } = gamblerBoard({ deck });
    const before = [...deckOf(engine, P1)];
    play(engine, P1, id("g"));
    chooseType(engine, type);
    assert.equal(pending(engine), undefined, "nothing else is asked");
    assert.deepEqual(revealedIds(engine), [before[0]], "exactly the top card is revealed");
    assert.equal(tokensOn(engine, id("g")), 1, "one token on the Gambler");
    assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]], "the top card is now on the bottom, the rest keep their order");
    assert.equal(handOf(engine, P1).length, 0, "nothing is drawn");
  });
}

clause(GAMBLER, "0:rule", "choosing a type the top card is NOT: it is revealed, no token, and it still goes to the bottom (all 20 wrong guesses)", () => {
  for (const top of CARD_TYPES) {
    for (const chosen of otherTypesThan(top)) {
      const { engine, id } = gamblerBoard({ deck: [top, "character", "item", "location"] });
      const before = [...deckOf(engine, P1)];
      play(engine, P1, id("g"));
      chooseType(engine, chosen);
      const label = `top ${top}, chosen ${chosen}`;
      assert.deepEqual(revealedIds(engine), [before[0]], `${label}: the top card is revealed`);
      assert.equal(tokensOn(engine, id("g")), 0, `${label}: no token`);
      assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]], `${label}: the top card goes to the bottom`);
      assert.equal(engine.getStat(id("g"), "strength"), 2, `${label}: no bonus`);
    }
  }
});

clause(GAMBLER, "0:rule", "only the TOP card matters: a matching type further down the deck gives no token", () => {
  const { engine, id } = gamblerBoard({ deck: ["item", "location", "tactic", "character", "character"] });
  play(engine, P1, id("g"));
  chooseType(engine, "character");
  assert.equal(tokensOn(engine, id("g")), 0);
});

clause(GAMBLER, "0:rule", "a revealed matching card is not drawn or moved anywhere but the bottom of the deck: it stays in my deck", () => {
  const { engine, id } = gamblerBoard({ deck: ["item", "character", "character"] });
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("g"));
  chooseType(engine, "item");
  assert.equal(zoneOf(engine, top), "deck");
  assert.equal(deckOf(engine, P1)[deckOf(engine, P1).length - 1], top);
  assert.equal(handOf(engine, P1).length, 0);
});

clause(GAMBLER, "0:rule", "a deck of one card: the top card is also the bottom card; the token is still given when it matches", () => {
  const { engine, id } = gamblerBoard({ deck: ["tactic"] });
  const only = deckOf(engine, P1)[0];
  play(engine, P1, id("g"));
  chooseType(engine, "tactic");
  assert.deepEqual(deckOf(engine, P1), [only]);
  assert.equal(tokensOn(engine, id("g")), 1);
});

clause(GAMBLER, "0:rule", "with an empty deck there is nothing to reveal: no token, no bottoming, nothing breaks", () => {
  const { engine, id } = gamblerBoard({ deck: [] });
  play(engine, P1, id("g"));
  chooseType(engine, "character");
  assert.equal(pending(engine), undefined);
  assert.equal(tokensOn(engine, id("g")), 0);
  assert.equal(revealEvents(engine).length, 0);
  assert.equal(deckOf(engine, P1).length, 0);
  assert.equal(engine.state.winner, undefined);
  assert.equal(zoneOf(engine, id("g")), "play");
});

clause(GAMBLER, "0:rule", "it is MY deck that is revealed and rotated: the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = gamblerBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("g"));
  chooseType(engine, "character");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(GAMBLER, "0:rule", "an opposing Gambler (its controller is the opponent) reveals ITS controller's deck, and that player chooses", () => {
  const { engine, id } = gamblerBoard({ owner: P2, turn: 2, active: P2, icons: { deception: 4 }, oppDeck: ["character", "item"] });
  const p1Deck = [...deckOf(engine, P1)];
  const p2Top = deckOf(engine, P2)[0];
  play(engine, P2, id("g"));
  const pc = pending(engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Gambler's controller chooses");
  chooseType(engine, "character");
  assert.deepEqual(revealedIds(engine), [p2Top]);
  assert.deepEqual(deckOf(engine, P1), p1Deck, "my deck is untouched");
  assert.equal(tokensOn(engine, id("g")), 1);
});

clause(GAMBLER, "0:rule", "it triggers only when THIS card enters play: another character entering play while the Gambler is in play asks nothing", () => {
  const { engine, id } = gamblerBoard({
    zone: "play",
    extra: [{ key: "plain", def: character({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }]
  });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("plain"));
  assert.equal(pending(engine), undefined, "nothing is asked");
  assert.equal(tokensOn(engine, id("g")), 0);
  assert.deepEqual(deckOf(engine, P1), before);
  assert.equal(revealEvents(engine).length, 0);
});

clause(GAMBLER, "0:rule", "it triggers when the card is put into play by an effect too (not only when deployed)", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = gamblerBoard({ icons: {}, extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("cheat"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "play", "put into play, not deployed");
  chooseType(engine, "character");
  assert.equal(tokensOn(engine, id("g")), 1);
  assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]]);
});

clause(GAMBLER, "0:rule", "the trigger does not fire when the Gambler leaves play", () => {
  const { engine, id } = gamblerBoard({ zone: "play", extra: [{ key: "kill", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("kill"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "discard");
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), before);
});

clause(GAMBLER, "1:rule", "with a token it has 3 strength and 3 life (+1 / +1); speed is untouched", () => {
  const { engine, id } = gamblerBoard({ zone: "play", counters: { token: 1 } });
  assert.equal(engine.getStat(id("g"), "strength"), 3);
  assert.equal(engine.getStat(id("g"), "life"), 3);
  assert.equal(engine.getStat(id("g"), "speed"), 3);
});

clause(GAMBLER, "1:rule", "without a token it has its printed 2 / 2", () => {
  const { engine, id } = gamblerBoard({ zone: "play" });
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "life"), 2);
});

clause(GAMBLER, "1:rule", "'while there is a token' is +1 / +1 once: two tokens still give only +1 strength and +1 life", () => {
  const { engine, id } = gamblerBoard({ zone: "play", counters: { token: 2 } });
  assert.equal(engine.getStat(id("g"), "strength"), 3);
  assert.equal(engine.getStat(id("g"), "life"), 3);
});

clause(GAMBLER, "1:rule", "it turns off when the last token goes away", () => {
  const unToken = tactic({
    name: "Untoken",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "untoken",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "removeCounter", target: { type: "selected", id: "t" }, counter: "token", amount: 1 }]
        }
      ]
    }
  });
  const { engine, id } = gamblerBoard({ zone: "play", counters: { token: 1 }, extra: [{ key: "u", def: unToken, owner: P1, zone: "hand" }] });
  assert.equal(engine.getStat(id("g"), "strength"), 3);
  play(engine, P1, id("u"), { selected: { t: [id("g")] } });
  assert.equal(tokensOn(engine, id("g")), 0);
  assert.equal(engine.getStat(id("g"), "strength"), 2);
  assert.equal(engine.getStat(id("g"), "life"), 2);
});

clause(GAMBLER, "1:rule", "it is on after the ETB gives it a token (3 / 3 right after choosing the matching type)", () => {
  const { engine, id } = gamblerBoard({ deck: ["item", "character"] });
  play(engine, P1, id("g"));
  chooseType(engine, "item");
  assert.equal(engine.getStat(id("g"), "strength"), 3);
  assert.equal(engine.getStat(id("g"), "life"), 3);
});

clause(GAMBLER, "1:rule", "a token on ANOTHER card does not buff the Gambler, and the Gambler's own token buffs nobody else", () => {
  const { engine, id } = gamblerBoard({
    zone: "play",
    counters: { token: 1 },
    extra: [
      { key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 2 }), owner: P2, zone: "play" }
    ]
  });
  assert.equal(engine.getStat(id("ally"), "strength"), 2);
  assert.equal(engine.getStat(id("foe"), "life"), 2);
  const plain = gamblerBoard({
    zone: "play",
    extra: [{ key: "ally", def: character({ name: "Ally", strength: 2, life: 2 }), owner: P1, zone: "play", counters: { token: 3 } }]
  });
  assert.equal(plain.engine.getStat(plain.id("g"), "strength"), 2, "a token elsewhere does nothing");
  assert.equal(plain.engine.getStat(plain.id("g"), "life"), 2);
  assert.equal(plain.engine.getStat(plain.id("ally"), "strength"), 2, "and the other card's tokens don't buff it either");
});

clause(GAMBLER, "1:rule", "the extra life is real: with a token it survives 2 damage and dies to the 3rd", () => {
  const { engine, id } = gamblerBoard({
    zone: "play",
    counters: { token: 1 },
    extra: [
      { key: "z2", def: zapTactic("Zap2", 2), owner: P1, zone: "hand" },
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("z2"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "play", "2 damage does not kill a 3-life Gambler");
  play(engine, P1, id("z1"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "discard");
});

clause(GAMBLER, "1:rule", "tokens disappear when the card leaves play (CR 409.2): a Gambler returned to hand and replayed has no token and no bonus", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const { engine, id } = gamblerBoard({
    zone: "play",
    counters: { token: 1 },
    deck: ["item", "item", "item"],
    icons: { deception: 5 },
    extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }]
  });
  play(engine, P1, id("bounce"), { selected: { t: [id("g")] } });
  assert.equal(zoneOf(engine, id("g")), "hand");
  assert.equal(tokensOn(engine, id("g")), 0, "the token disappeared when it left play");
  play(engine, P1, id("g"));
  chooseType(engine, "character");
  assert.equal(tokensOn(engine, id("g")), 0, "control: the revealed card was not a character");
  assert.equal(engine.getStat(id("g"), "strength"), 2, "a brand-new Gambler has no bonus");
});

// ==================================================================================
// Dazzling Trapezist
// INSPIRE -- COST: Put a card from your hand on the top of your deck. Pick a character.
// EFFECT: This turn, the character gains 1 speed.
// Character, rogue, subtype performer, cost 2, threshold [D][D], 1 strength / 3 speed / 2 life.
// ==================================================================================

const TRAPEZIST = "4fb63483-4a2d-4052-bebd-1806223eeb40";
const INSPIRE = "inspire";

function trapezistBoard(
  opts: { zone?: "play" | "hand"; hand?: number; deck?: number; turn?: number; active?: PlayerId; icons?: Icons; extra?: CardPlacement[]; depleted?: boolean } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "tz", def: printing(TRAPEZIST), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...fillers("h", opts.hand ?? 3, P1, "hand"),
      { key: "ht", def: tactic({ name: "HandTactic", cost: 5 }), owner: P1, zone: "hand" },
      ...fillers("oh", 2, P2, "hand"),
      ...deckCards("a", opts.deck ?? 3, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.icons ?? {}),
      ...(opts.extra ?? [])
    ]
  });
}

const inspire = (engine: SpoilsEngine, id: Id, tuck: string, target: string, who = "tz") =>
  activate(engine, P1, id(who), INSPIRE, { selected: { tuck: [id(tuck)], c: [id(target)] } });
const inspireRaw = (engine: SpoilsEngine, id: Id, tuck: string, target: string, who = "tz") =>
  activateRaw(engine, P1, id(who), INSPIRE, { tuck: [id(tuck)], c: [id(target)] });

const TRAPEZIST_SPEC: DeploySpec = { id: TRAPEZIST, cost: 2, icon: "deception", count: 2 };

clause(TRAPEZIST, "0:ability:inspire", "deploys for exactly 2 with [D][D] with its printed 1 / 3 / 2 and performer subtype; refused one short and with one [D]", () => {
  deploysForExactlyItsCost(TRAPEZIST_SPEC);
  refusedOneShort(TRAPEZIST_SPEC);
  refusedWithoutThreshold(TRAPEZIST_SPEC);
  thresholdIsGateNotCost(TRAPEZIST_SPEC);
  const { engine, id } = trapezistBoard();
  assert.equal(engine.getStat(id("tz"), "strength"), 1);
  assert.equal(engine.getStat(id("tz"), "speed"), 3);
  assert.equal(engine.getStat(id("tz"), "life"), 2);
  assert.deepEqual(engine.getSubtypes(id("tz")), ["performer"]);
});

clause(TRAPEZIST, "0:ability:inspire", "COST: the chosen hand card goes on the TOP of my deck (the rest of the deck keeps its order), and my hand shrinks by one", () => {
  const { engine, id } = trapezistBoard();
  const deckBefore = [...deckOf(engine, P1)];
  const handBefore = [...handOf(engine, P1)];
  inspire(engine, id, "h1", "mine");
  assert.equal(zoneOf(engine, id("h1")), "deck");
  assert.deepEqual(deckOf(engine, P1), [id("h1"), ...deckBefore], "on top, above the old top card");
  assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("h1")), "only that card left my hand");
  assert.equal(discardOf(engine, P1).includes(id("h1")), false, "it was not discarded");
  assert.equal(pending(engine), undefined);
});

clause(TRAPEZIST, "0:ability:inspire", "any card type can be put on top: a tactic from my hand works too, and it is the card I draw next", () => {
  const { engine, id } = trapezistBoard();
  inspire(engine, id, "ht", "mine");
  assert.equal(deckOf(engine, P1)[0], id("ht"));
  assert.equal(zoneOf(engine, id("ht")), "deck");
});

clause(TRAPEZIST, "0:ability:inspire", "EFFECT: the picked character gains exactly 1 speed this turn; its strength and life are unchanged", () => {
  const { engine, id } = trapezistBoard();
  inspire(engine, id, "h0", "mine");
  assert.equal(engine.getStat(id("mine"), "speed"), 3);
  assert.equal(engine.getStat(id("mine"), "strength"), 2);
  assert.equal(engine.getStat(id("mine"), "life"), 4);
});

clause(TRAPEZIST, "0:ability:inspire", "only the picked character is sped up: the Trapezist, my other characters and the opponent's characters are not", () => {
  const { engine, id } = trapezistBoard();
  inspire(engine, id, "h0", "mine");
  assert.equal(engine.getStat(id("tz"), "speed"), 3);
  assert.equal(engine.getStat(id("foe"), "speed"), 2);
});

clause(TRAPEZIST, "0:ability:inspire", "it can pick an opponent's character, or the Trapezist itself", () => {
  const foe = trapezistBoard();
  inspire(foe.engine, foe.id, "h0", "foe");
  assert.equal(foe.engine.getStat(foe.id("foe"), "speed"), 3);
  assert.equal(foe.engine.getStat(foe.id("mine"), "speed"), 2);
  const self = trapezistBoard();
  inspire(self.engine, self.id, "h0", "tz");
  assert.equal(self.engine.getStat(self.id("tz"), "speed"), 4);
});

clause(TRAPEZIST, "0:ability:inspire", "the speed gain lasts this turn only", () => {
  const { engine, id } = trapezistBoard();
  inspire(engine, id, "h0", "mine");
  assert.equal(engine.getStat(id("mine"), "speed"), 3);
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "gone when the turn ends");
  endTurn(engine, P2);
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "and it does not come back");
});

clause(TRAPEZIST, "0:ability:inspire", "INSPIRE can be used again and again (no deplete): two uses on one character give +2 speed", () => {
  const { engine, id } = trapezistBoard();
  inspire(engine, id, "h0", "mine");
  inspire(engine, id, "h1", "mine");
  assert.equal(engine.getStat(id("mine"), "speed"), 4);
  assert.equal(isDepleted(engine, id("tz")), false, "the Trapezist is not depleted by it");
  assert.equal(deckOf(engine, P1)[0], id("h1"));
  assert.equal(deckOf(engine, P1)[1], id("h0"));
});

clause(TRAPEZIST, "0:ability:inspire", "the gained speed is real speed: a speed-2 attacker boosted to 3 strikes first and survives a speed-2 blocker of equal strength", () => {
  const strong = (name: string) => character({ name, strength: 3, life: 3, speed: 2 });
  const duel = (boost: boolean) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "tz", def: printing(TRAPEZIST), owner: P1, zone: "play" },
        { key: "atk", def: strong("Atk"), owner: P1, zone: "play" },
        { key: "blk", def: strong("Blk"), owner: P2, zone: "play" },
        ...fillers("h", 1, P1, "hand"),
        ...deckCards("a", 2, P1)
      ]
    });
    if (boost) inspire(b.engine, b.id, "h0", "atk");
    declareAttackBy(b.engine, P1, [b.id("atk")]);
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
    autoResolveBattle(b.engine);
    return b;
  };
  const plain = duel(false);
  assert.equal(zoneOf(plain.engine, plain.id("atk")), "discard", "control: equal speed, both die");
  assert.equal(zoneOf(plain.engine, plain.id("blk")), "discard");
  const boosted = duel(true);
  assert.equal(zoneOf(boosted.engine, boosted.id("blk")), "discard", "the blocker died to the first strike");
  assert.equal(zoneOf(boosted.engine, boosted.id("atk")), "play", "the faster attacker took no damage");
});

clause(TRAPEZIST, "0:ability:inspire", "the cost is paid when the ability is used, before the opponent can respond: the card is already on top of the deck, but the speed is not gained yet", () => {
  const { engine, id } = trapezistBoard();
  inspireRaw(engine, id, "h0", "mine");
  assert.ok(engine.state.responseWindow, "a response window is open");
  assert.equal(deckOf(engine, P1)[0], id("h0"), "the cost is already paid");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "the effect has not happened yet");
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mine"), "speed"), 3);
});

clause(TRAPEZIST, "0:ability:inspire", "the card put on the deck must come from MY hand: a card in play, in my discard pile, in my deck, or in the opponent's hand is refused", () => {
  const { engine, id } = trapezistBoard();
  const attempt = (tuck: CardInstanceId) => () => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [tuck], c: [id("mine")] });
  refused(attempt(id("thing")), "an item in play");
  refused(attempt(id("mine")), "a character in play");
  refused(attempt(id("inDiscard")), "a card in my discard pile");
  refused(attempt(deckOf(engine, P1)[0]), "a card in my deck");
  refused(attempt(id("oh0")), "a card in the opponent's hand");
  refused(attempt(id("tz")), "the Trapezist itself, in play");
  assert.equal(engine.getStat(id("mine"), "speed"), 2, "nothing was gained");
  assert.deepEqual(deckOf(engine, P1).slice(0, 3), [id("a0"), id("a1"), id("a2")], "my deck is unchanged");
  attempt(id("h0"))();
  assert.ok(engine.state.responseWindow, "control: a card from my hand is accepted");
});

clause(TRAPEZIST, "0:ability:inspire", "exactly one hand card is put on the deck: none, or two, is refused", () => {
  const { engine, id } = trapezistBoard();
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { c: [id("mine")] }), "no card chosen");
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [], c: [id("mine")] }), "an empty choice");
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0"), id("h1")], c: [id("mine")] }), "two cards");
  assert.equal(zoneOf(engine, id("h0")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(TRAPEZIST, "0:ability:inspire", "with an empty hand there is no card to put on the deck: it cannot be used", () => {
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "tz", def: printing(TRAPEZIST), owner: P1, zone: "play" },
      { key: "mine", def: character({ name: "Mine" }), owner: P1, zone: "play" },
      { key: "foeHand", def: character({ name: "FoeHand" }), owner: P2, zone: "hand" },
      ...deckCards("a", 2, P1)
    ]
  });
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("foeHand")], c: [id("mine")] }), "only the opponent has a hand");
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { c: [id("mine")] }), "no card");
  assert.equal(engine.getStat(id("mine"), "speed"), 1);
});

clause(TRAPEZIST, "0:ability:inspire", "the pick must be a character in play: an item, a location, a faction, a face-down card, or a card in a discard pile are refused", () => {
  const { engine, id } = trapezistBoard();
  const attempt = (picked: CardInstanceId) => () => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0")], c: [picked] });
  refused(attempt(id("thing")), "an item");
  refused(attempt(id("place")), "a location");
  refused(attempt(factionOf(engine, P1)), "my faction");
  refused(attempt(factionOf(engine, P2)), "their faction");
  refused(attempt(id("hidden")), "a face-down card is only a resource");
  refused(attempt(id("inDiscard")), "a character in the discard pile");
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0")] }), "no character picked");
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0")], c: [id("mine"), id("foe")] }), "two characters");
  assert.equal(zoneOf(engine, id("h0")), "hand", "none of those attempts paid the cost");
  attempt(id("mine"))();
  assert.ok(engine.state.responseWindow, "control: a character is accepted");
});

clause(TRAPEZIST, "0:ability:inspire", "if the picked character is destroyed in response, the cost stays paid and the effect finds nothing (no fizzle problems)", () => {
  const { engine, id } = trapezistBoard({ extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  inspireRaw(engine, id, "h0", "foe");
  respondWith(engine, P2, id("kill"), { t: [id("foe")] });
  assert.equal(zoneOf(engine, id("foe")), "discard");
  assert.equal(zoneOf(engine, id("h0")), "deck", "the cost stays paid");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(TRAPEZIST, "0:ability:inspire", "it works in response on the opponent's turn too", () => {
  const { engine, id } = trapezistBoard({ turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0")], c: [id("mine")] }), "nothing to respond to yet");
  playRaw(engine, P2, id("nothing"));
  activateRaw(engine, P1, id("tz"), INSPIRE, { tuck: [id("h0")], c: [id("mine")] });
  resolvePendingResponses(engine);
  assert.equal(engine.getStat(id("mine"), "speed"), 3);
  assert.equal(deckOf(engine, P1)[0], id("h0"));
});

clause(TRAPEZIST, "0:ability:inspire", "only the Trapezist's controller can use it, and only while it is in play", () => {
  const theirs = trapezistBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("tz"), INSPIRE, { tuck: [theirs.id("oh0")], c: [theirs.id("foe")] }), "the opponent cannot use my Trapezist");
  const inHand = trapezistBoard({ zone: "hand" });
  refused(() => activateRaw(inHand.engine, P1, inHand.id("tz"), INSPIRE, { tuck: [inHand.id("h0")], c: [inHand.id("mine")] }), "in my hand");
  assert.equal(inHand.engine.getStat(inHand.id("mine"), "speed"), 2);
});

// ==================================================================================
// Essence of Deception
// Choose one of the following as this card's rules text:
//  OPTION 1 -- Search your opponent's deck for a card. Put it into their discard pile.
//  OPTION 2 -- COST: Pick a character. -- EFFECT: This turn, the character gains 1 speed.
//  OPTION 3 -- COST: Pick a character. -- EFFECT: If damage has been inflicted to the character this turn, destroy it.
// Tactic, rogue, cost 1, threshold [D][D].
// ==================================================================================

const ESSENCE = "01005d53-34a2-4a29-99f9-9a71dc23cdf0";

/** Fisher-Yates exactly as the engine does it, fed by a constant random source (to predict a shuffle). */
function shuffledWithConstant(items: string[], value: number): string[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(value * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const OPP_DECK_TYPES: TypeName[] = ["character", "item", "tactic", "location", "resource", "character"];

function essenceBoard(
  opts: {
    icons?: Icons;
    oppDeck?: TypeName[];
    turn?: number;
    active?: PlayerId;
    random?: () => number;
    extra?: CardPlacement[];
    noCharacters?: boolean;
  } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    random: opts.random,
    cards: [
      { key: "eod", def: printing(ESSENCE), owner: P1, zone: "hand" },
      ...(opts.noCharacters
        ? []
        : [
            { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" as const }
          ]),
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "zap", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" },
      ...fillers("oh", 2, P2, "hand"),
      { key: "od", def: character({ name: "OppDiscarded" }), owner: P2, zone: "discard" },
      ...deckCards("a", 3, P1),
      ...typedDeck("b", opts.oppDeck ?? OPP_DECK_TYPES, P2),
      ...res(opts.icons ?? { deception: 3 }),
      ...(opts.extra ?? [])
    ]
  });
}

type EssenceGame = ReturnType<typeof essenceBoard>;
const playEssence = (b: EssenceGame, mode: number, selected: Record<string, CardInstanceId[]> = {}) => play(b.engine, P1, b.id("eod"), { mode, selected });
/** Really inflicts 1 damage to `key` (a free tactic of mine), so "damage has been inflicted this turn" is true for it. */
const zapIt = (b: EssenceGame, key: string) => {
  play(b.engine, P1, b.id("zap"), { selected: { t: [b.id(key)] } });
  assert.equal(b.engine.state.cards[b.id(key)].damage, 1, "control: it was dealt 1 damage");
};
const pickCards = (engine: SpoilsEngine, playerId: PlayerId, selected: CardInstanceId[]) => {
  const pc = pending(engine);
  assert.ok(pc, "a pick is open");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, playerId);
  answerPending(engine, "chooserSelectsTarget", { selected });
};
const tryPick = (engine: SpoilsEngine, selected: CardInstanceId[]) => tryChoice(engine, { kind: "chooserSelectsTarget", selected });

const ESSENCE_SPEC: DeploySpec = {
  id: ESSENCE,
  cost: 1,
  icon: "deception",
  count: 2,
  mode: 1,
  after: "discard",
  extra: () => [{ key: "tgt", def: character({ name: "Tgt" }), owner: P1, zone: "play" }],
  selected: (id) => ({ c: [id("tgt")] })
};

// -- 0:rule — choose one --------------------------------------------------------

clause(ESSENCE, "0:rule", "a tactic of cost 1 with [D][D]: the chosen option's text is paid for with exactly 1 resource and the card ends in its owner's discard pile", () => {
  const b = essenceBoard();
  const before = ready(b.engine);
  playEssence(b, 1, { c: [b.id("mine")] });
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1");
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("eod")), "discardOf(b.engine, P1).includes(b.id(\"eod\"))");
});

clause(ESSENCE, "0:rule", "is refused with no resource at all, and with one [D] even with plenty of other resources (whichever option is chosen)", () => {
  for (const mode of [0, 1, 2]) {
    const spec: DeploySpec = { ...ESSENCE_SPEC, mode };
    refusedOneShort(spec);
    refusedWithoutThreshold(spec);
  }
  const spec1: DeploySpec = { ...ESSENCE_SPEC, mode: 1 };
  thresholdIsGateNotCost(spec1);
});

clause(ESSENCE, "0:rule", "each of the three options can be chosen: OPTION 1 (a search), OPTION 2 (speed) and OPTION 3 (execute) are all playable", () => {
  const search = essenceBoard();
  playEssence(search, 0);
  assert.equal(pending(search.engine)?.kind, "chooserSelectsTarget", "option 1 asks for a search pick");
  const speed = essenceBoard();
  playEssence(speed, 1, { c: [speed.id("mine")] });
  assert.equal(speed.engine.getStat(speed.id("mine"), "speed"), 3);
  const exec = essenceBoard();
  zapIt(exec, "foe");
  playEssence(exec, 2, { c: [exec.id("foe")] });
  assert.equal(zoneOf(exec.engine, exec.id("foe")), "discard");
});

clause(ESSENCE, "0:rule", "only the chosen option applies: OPTION 2 does not search the deck and does not destroy; OPTION 3 gives no speed and does not search", () => {
  const speed = essenceBoard();
  zapIt(speed, "foe");
  const oppDeck = [...deckOf(speed.engine, P2)];
  playEssence(speed, 1, { c: [speed.id("foe")] });
  assert.equal(speed.engine.state.pendingChoice, undefined, "no search");
  assert.deepEqual(deckOf(speed.engine, P2), oppDeck, "the opponent's deck is untouched");
  assert.equal(zoneOf(speed.engine, speed.id("foe")), "play", "a damaged character is NOT destroyed by option 2");
  const exec = essenceBoard();
  zapIt(exec, "foe");
  const execDeck = [...deckOf(exec.engine, P2)];
  playEssence(exec, 2, { c: [exec.id("mine")] });
  assert.equal(exec.engine.getStat(exec.id("mine"), "speed"), 2, "option 3 gives no speed");
  assert.equal(exec.engine.state.pendingChoice, undefined, "option 3 does not search");
  assert.deepEqual(deckOf(exec.engine, P2), execDeck);
  const search = essenceBoard();
  zapIt(search, "foe");
  playEssence(search, 0);
  pickCards(search.engine, P1, [search.engine.state.players[P2].deck[0]]);
  assert.equal(zoneOf(search.engine, search.id("foe")), "play", "option 1 destroys nothing");
  assert.equal(search.engine.getStat(search.id("mine"), "speed"), 2, "option 1 gives no speed");
});

clause(ESSENCE, "0:rule", "an unchosen option's COST (the character pick) does not apply: OPTION 1 can be played with no character anywhere in play", () => {
  const b = essenceBoard({ noCharacters: true });
  playEssence(b, 0);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "the search is offered");
  pickCards(b.engine, P1, [b.engine.state.players[P2].deck[0]]);
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard");
});

clause(ESSENCE, "0:rule", "OPTION 2 and OPTION 3 cannot be played with no character to pick", () => {
  const b = essenceBoard({ noCharacters: true });
  refused(() => rawPlay(b.engine, P1, b.id("eod"), { mode: 1, selected: {} }), "option 2 needs a character");
  refused(() => rawPlay(b.engine, P1, b.id("eod"), { mode: 2, selected: {} }), "option 3 needs a character");
  assert.equal(zoneOf(b.engine, b.id("eod")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
});

clause(ESSENCE, "0:rule", "a nonexistent option cannot be chosen", () => {
  const b = essenceBoard();
  refused(() => rawPlay(b.engine, P1, b.id("eod"), { mode: 3, selected: { c: [b.id("mine")] } }), "there are only three options");
  refused(() => rawPlay(b.engine, P1, b.id("eod"), { mode: -1, selected: { c: [b.id("mine")] } }), "a negative option");
  assert.equal(zoneOf(b.engine, b.id("eod")), "hand");
});

clause(ESSENCE, "0:rule", "a tactic: it can be played in response on the opponent's turn with whichever option", () => {
  const b = essenceBoard({ turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => rawPlay(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id("mine")] } }), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  rawPlay(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3);
});

// -- 1:option:OPTION 1 — search the opponent's deck -----------------------------

clause(ESSENCE, "1:option:OPTION 1", "I (the player of the tactic) search the opponent's deck: any card in it can be picked and goes into THEIR discard pile", () => {
  for (let index = 0; index < OPP_DECK_TYPES.length; index++) {
    const b = essenceBoard();
    const pick = deckOf(b.engine, P2)[index];
    const mineBefore = [...deckOf(b.engine, P1)];
    playEssence(b, 0);
    const pc = pending(b.engine);
    assert.ok(pc, "pc");
    assert.equal(pc.playerId, P1, "I choose the card");
    pickCards(b.engine, P1, [pick]);
    assert.equal(zoneOf(b.engine, pick), "discard", `deck card #${index} was put into a discard pile`);
    assert.ok(discardOf(b.engine, P2).includes(pick), "their discard pile (its owner's)");
    assert.equal(discardOf(b.engine, P1).includes(pick), false, "not mine");
    assert.equal(deckOf(b.engine, P2).length, OPP_DECK_TYPES.length - 1);
    assert.deepEqual(deckOf(b.engine, P1), mineBefore, "my deck is untouched");
    assert.equal(b.engine.state.pendingChoice, undefined);
  }
});

clause(ESSENCE, "1:option:OPTION 1", "only the opponent's DECK can be searched: a card in my deck, in either hand, in either discard pile or in play is refused", () => {
  const b = essenceBoard();
  playEssence(b, 0);
  const attempts: Array<[string, CardInstanceId]> = [
    ["a card in my own deck", deckOf(b.engine, P1)[0]],
    ["a card in the opponent's hand", b.id("oh0")],
    ["a card in the opponent's discard pile", b.id("od")],
    ["a card in my discard pile", b.id("inDiscard")],
    ["a character in play", b.id("foe")],
    ["an item in play", b.id("thing")]
  ];
  for (const [why, cardId] of attempts) refused(tryPick(b.engine, [cardId]), why);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  assert.equal(zoneOf(b.engine, b.id("oh0")), "hand");
  assert.equal(zoneOf(b.engine, b.id("od")), "discard");
  const legal = deckOf(b.engine, P2)[2];
  pickCards(b.engine, P1, [legal]);
  assert.equal(zoneOf(b.engine, legal), "discard", "control: a card in their deck is accepted");
});

clause(ESSENCE, "1:option:OPTION 1", "exactly ONE card is put into the discard pile: two cards are refused", () => {
  const b = essenceBoard();
  playEssence(b, 0);
  const [first, second] = deckOf(b.engine, P2);
  refused(tryPick(b.engine, [first, second]), "two cards");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget");
  assert.equal(deckOf(b.engine, P2).length, OPP_DECK_TYPES.length);
  pickCards(b.engine, P1, [first]);
  assert.equal(deckOf(b.engine, P2).length, OPP_DECK_TYPES.length - 1);
  assert.equal(zoneOf(b.engine, second), "deck");
});

clause(ESSENCE, "1:option:OPTION 1", "an unconditional 'search for a card' must find one when the deck has cards (CR 312.2): taking no card is refused", () => {
  const b = essenceBoard();
  playEssence(b, 0);
  refused(tryPick(b.engine, []), "the search must find a card");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a card");
  assert.equal(deckOf(b.engine, P2).length, OPP_DECK_TYPES.length);
});

clause(ESSENCE, "1:option:OPTION 1", "the searched deck is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const b = essenceBoard({ random: () => 0 });
  const taken = deckOf(b.engine, P2)[1];
  const unshuffled = deckOf(b.engine, P2).filter((cardId) => cardId !== taken);
  playEssence(b, 0);
  pickCards(b.engine, P1, [taken]);
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(b.engine, P2), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(ESSENCE, "1:option:OPTION 1", "the opponent's hand, discard pile and board are untouched except for the one card", () => {
  const b = essenceBoard();
  const oppHand = [...handOf(b.engine, P2)];
  const oppDiscard = [...discardOf(b.engine, P2)];
  playEssence(b, 0);
  const taken = deckOf(b.engine, P2)[0];
  pickCards(b.engine, P1, [taken]);
  assert.deepEqual(handOf(b.engine, P2), oppHand);
  assert.deepEqual(discardOf(b.engine, P2).filter((c) => c !== taken), oppDiscard);
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
});

clause(ESSENCE, "1:option:OPTION 1", "with a one-card deck that card is found and discarded; the deck is then empty", () => {
  const b = essenceBoard({ oppDeck: ["item"] });
  playEssence(b, 0);
  const only = deckOf(b.engine, P2)[0];
  pickCards(b.engine, P1, [only]);
  assert.equal(zoneOf(b.engine, only), "discard");
  assert.equal(deckOf(b.engine, P2).length, 0);
});

clause(ESSENCE, "1:option:OPTION 1", "with an empty opponent's deck there is nothing to find: the tactic resolves without a prompt and without breaking", () => {
  const b = essenceBoard({ oppDeck: [] });
  const oppDiscard = [...discardOf(b.engine, P2)];
  playEssence(b, 0);
  assert.equal(b.engine.state.pendingChoice, undefined, "no pick to make");
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard", "the tactic still resolved");
  assert.deepEqual(discardOf(b.engine, P2), oppDiscard);
  assert.equal(b.engine.state.winner, undefined);
});

// -- 2:option:OPTION 2 — +1 speed ------------------------------------------------

clause(ESSENCE, "2:option:OPTION 2", "the picked character gains exactly 1 speed this turn; strength and life unchanged; nobody else changes", () => {
  const b = essenceBoard();
  playEssence(b, 1, { c: [b.id("mine")] });
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "the opponent's character is unaffected");
});

clause(ESSENCE, "2:option:OPTION 2", "an opponent's character can be picked as well", () => {
  const b = essenceBoard();
  playEssence(b, 1, { c: [b.id("foe")] });
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2);
});

clause(ESSENCE, "2:option:OPTION 2", "the speed gain lasts this turn only", () => {
  const b = essenceBoard();
  playEssence(b, 1, { c: [b.id("mine")] });
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "gone when the turn ends");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2);
});

clause(ESSENCE, "2:option:OPTION 2", "the pick is the COST: exactly one character in play; an item, location, faction, face-down card, a card in a discard pile, none, or two are refused", () => {
  const b = essenceBoard();
  const attempt = (selected: Record<string, CardInstanceId[]>) => () => rawPlay(b.engine, P1, b.id("eod"), { mode: 1, selected });
  refused(attempt({ c: [b.id("thing")] }), "an item");
  refused(attempt({ c: [b.id("place")] }), "a location");
  refused(attempt({ c: [factionOf(b.engine, P1)] }), "my faction");
  refused(attempt({ c: [factionOf(b.engine, P2)] }), "their faction");
  refused(attempt({ c: [b.id("hidden")] }), "a face-down card");
  refused(attempt({ c: [b.id("inDiscard")] }), "a character in a discard pile");
  refused(attempt({}), "no pick");
  refused(attempt({ c: [b.id("mine"), b.id("foe")] }), "two characters");
  assert.equal(zoneOf(b.engine, b.id("eod")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  attempt({ c: [b.id("mine")] })();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(ESSENCE, "2:option:OPTION 2", "the pick is made as the card is played (before the opponent can respond), the speed arrives when it resolves", () => {
  const b = essenceBoard();
  rawPlay(b.engine, P1, b.id("eod"), { mode: 1, selected: { c: [b.id("mine")] } });
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "not yet");
  assert.equal(b.engine.state.pendingChoice, undefined, "no later pick prompt: the pick was part of playing the card");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3);
});

// -- 3:option:OPTION 3 — execute if damaged ---------------------------------------

clause(ESSENCE, "3:option:OPTION 3", "a character that was damaged this turn is destroyed (into its owner's discard pile)", () => {
  const b = essenceBoard();
  zapIt(b, "foe");
  playEssence(b, 2, { c: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foe")), "discardOf(b.engine, P2).includes(b.id(\"foe\"))");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play", "other characters are untouched");
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard");
});

clause(ESSENCE, "3:option:OPTION 3", "a character with no damage is NOT destroyed: the tactic resolves and does nothing", () => {
  const b = essenceBoard();
  playEssence(b, 2, { c: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0);
  assert.equal(zoneOf(b.engine, b.id("eod")), "discard", "the tactic was still played");
  assert.equal(ready(b.engine), 2, "and still paid for");
});

clause(ESSENCE, "3:option:OPTION 3", "my own damaged character can be picked and destroyed too; an undamaged one survives", () => {
  const damaged = essenceBoard();
  zapIt(damaged, "mine");
  playEssence(damaged, 2, { c: [damaged.id("mine")] });
  assert.equal(zoneOf(damaged.engine, damaged.id("mine")), "discard");
  const fresh = essenceBoard();
  playEssence(fresh, 2, { c: [fresh.id("mine")] });
  assert.equal(zoneOf(fresh.engine, fresh.id("mine")), "play");
});

clause(ESSENCE, "3:option:OPTION 3", "damage inflicted earlier this turn by a tactic counts", () => {
  const b = essenceBoard({ icons: { deception: 3 }, extra: [{ key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }] });
  playEssence(b, 2, { c: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "control: undamaged, so it survives");
  const c = essenceBoard({ icons: { deception: 3 }, extra: [{ key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }] });
  play(c.engine, P1, c.id("z1"), { selected: { t: [c.id("foe")] } });
  assert.equal(c.engine.state.cards[c.id("foe")].damage, 1);
  playEssence(c, 2, { c: [c.id("foe")] });
  assert.equal(zoneOf(c.engine, c.id("foe")), "discard", "it was dealt damage this turn: destroyed");
});

clause(ESSENCE, "3:option:OPTION 3", "battle damage counts too: a blocker that took 1 damage and survived is destroyed", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "eod", def: printing(ESSENCE), owner: P1, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res({ deception: 3 })
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("blk")), "play", "control: it survived the battle");
  assert.equal(b.engine.state.cards[b.id("blk")].damage, 1);
  play(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("blk")] } });
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard");
});

clause(ESSENCE, "3:option:OPTION 3", "'this turn' only: damage inflicted on an earlier turn does not count", () => {
  const b = essenceBoard({
    icons: { deception: 3 },
    extra: [{ key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" }]
  });
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 1);
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "two turns later");
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0, "damage wears off at the start of a turn");
  playEssence(b, 2, { c: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "no damage has been inflicted to it THIS turn");
});

clause(ESSENCE, "3:option:OPTION 3", "'damage HAS BEEN inflicted this turn': damage that was inflicted and later healed still counts", () => {
  const heal = tactic({
    name: "Heal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "heal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "healDamage", target: { type: "selected", id: "t" }, amount: 5 }]
        }
      ]
    }
  });
  const b = essenceBoard({
    icons: { deception: 3 },
    extra: [
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" },
      { key: "heal", def: heal, owner: P1, zone: "hand" }
    ]
  });
  play(b.engine, P1, b.id("z1"), { selected: { t: [b.id("foe")] } });
  play(b.engine, P1, b.id("heal"), { selected: { t: [b.id("foe")] } });
  assert.equal(b.engine.state.cards[b.id("foe")].damage, 0, "control: the damage was healed");
  playEssence(b, 2, { c: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "damage was inflicted to it this turn, however it stands now");
});

clause(ESSENCE, "3:option:OPTION 3", "the pick is the COST: exactly one character in play; an item, location, faction, face-down card, none, or two are refused", () => {
  const b = essenceBoard();
  zapIt(b, "foe");
  const attempt = (selected: Record<string, CardInstanceId[]>) => () => rawPlay(b.engine, P1, b.id("eod"), { mode: 2, selected });
  refused(attempt({ c: [b.id("thing")] }), "an item");
  refused(attempt({ c: [b.id("place")] }), "a location");
  refused(attempt({ c: [factionOf(b.engine, P2)] }), "their faction");
  refused(attempt({ c: [b.id("hidden")] }), "a face-down card");
  refused(attempt({}), "no pick");
  refused(attempt({ c: [b.id("mine"), b.id("foe")] }), "two characters");
  assert.equal(zoneOf(b.engine, b.id("eod")), "hand");
  attempt({ c: [b.id("foe")] })();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(ESSENCE, "3:option:OPTION 3", "damage dealt in response is seen when it resolves: the picked character is damaged by the opponent's response before the tactic resolves", () => {
  const b = essenceBoard({ extra: [{ key: "z1", def: zapTactic("Zap1", 1), owner: P2, zone: "hand" }] });
  rawPlay(b.engine, P1, b.id("eod"), { mode: 2, selected: { c: [b.id("foe")] } });
  respondWith(b.engine, P2, b.id("z1"), { t: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "the condition is checked when the tactic resolves");
});

// ==================================================================================
// Flailing Knife
// ATTACH TO CHARACTER. The attached character gains 2 strength.
// If this card is put into your discard pile from play, you may choose a card type. If you do, reveal the top card of
// your deck. If it is the chosen type, put this card into play. Put the top card of your deck on the bottom.
// Item (gear), rogue, cost 3, threshold [D].
// ==================================================================================

const KNIFE = "e7405d47-49f3-4b3a-adb5-1444fc726135";

function knifeBoard(
  opts: {
    knife?: "hand" | "attached";
    deck?: TypeName[];
    icons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
    onlyHost?: boolean;
    owner?: PlayerId;
  } = {}
) {
  const where = opts.knife ?? "attached";
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "knife", def: printing(KNIFE), owner, zone: where === "hand" ? "hand" : "play", attachedToKey: where === "attached" ? "host" : undefined },
      { key: "host", def: character({ name: "Host", strength: 1, life: 4, speed: 2 }), owner, zone: "play" },
      ...(opts.onlyHost
        ? []
        : [
            { key: "mine2", def: character({ name: "Mine2", strength: 1, life: 4, speed: 2 }), owner, zone: "play" as const },
            { key: "foe", def: character({ name: "Foe", strength: 1, life: 4, speed: 2 }), owner: other(owner), zone: "play" as const },
            { key: "thing", def: item({ name: "Thing" }), owner, zone: "play" as const },
            { key: "place", def: location({ name: "Place" }), owner: other(owner), zone: "play" as const },
            { key: "hidden", def: character({ name: "Hidden" }), owner: other(owner), zone: "play" as const, faceDown: true }
          ]),
      { key: "kill", def: killAnyTactic("character"), owner, zone: "hand" },
      { key: "killItem", def: killAnyTactic("item"), owner, zone: "hand" },
      ...typedDeck("d", opts.deck ?? ["character", "item", "location", "tactic", "resource"], owner),
      ...typedDeck("o", ["character", "item"], other(owner)),
      ...res(opts.icons ?? {}, owner),
      ...(opts.extra ?? [])
    ]
  });
}

type KnifeGame = ReturnType<typeof knifeBoard>;
const destroyHost = (b: KnifeGame) => play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("host")] } });
const attachKnife = (b: KnifeGame, hostKey: string) => play(b.engine, P1, b.id("knife"), { selected: { attachTo: [b.id(hostKey)] } });

const KNIFE_SPEC: DeploySpec = {
  id: KNIFE,
  cost: 3,
  icon: "deception",
  count: 1,
  extra: () => [{ key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }],
  selected: (id) => ({ attachTo: [id("host")] })
};

// -- 0:attach --------------------------------------------------------------------

clause(KNIFE, "0:attach", "attaches to a character you control: it enters play attached to that character, the printed cost of 3 is paid, and no other character gets it", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 4 } });
  const before = ready(b.engine);
  attachKnife(b, "host");
  assert.equal(zoneOf(b.engine, b.id("knife")), "play");
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("host"));
  assert.equal(before - ready(b.engine), 3, "the printed cost of 3");
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 1, "another character is unaffected");
});

clause(KNIFE, "0:attach", "attaches to an opponent's character too, and I keep controlling the Knife", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 3 } });
  attachKnife(b, "foe");
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("knife")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
});

clause(KNIFE, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 3 } });
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("knife"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "their faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  assert.equal(zoneOf(b.engine, b.id("knife")), "hand");
  assert.equal(ready(b.engine), 3, "nothing was paid");
  attempt(b.id("host"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(KNIFE, "0:attach", "needs exactly one host: no pick, an empty pick and two picks are refused", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 3 } });
  refused(() => playRaw(b.engine, P1, b.id("knife"), {}), "no selection");
  refused(() => playRaw(b.engine, P1, b.id("knife"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(b.engine, P1, b.id("knife"), { selected: { attachTo: [b.id("host"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("knife")), "hand");
});

clause(KNIFE, "0:attach", "deploys for exactly 3 with [D]; refused one resource short and without [D] even with plenty of other resources", () => {
  deploysForExactlyItsCost(KNIFE_SPEC);
  refusedOneShort(KNIFE_SPEC);
  refusedWithoutThreshold(KNIFE_SPEC);
  thresholdIsGateNotCost(KNIFE_SPEC);
});

clause(KNIFE, "0:attach", "it is an item: it cannot be deployed in a response on the opponent's turn", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 3 }, turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("nothing"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  refused(() => playRaw(b.engine, P1, b.id("knife"), { selected: { attachTo: [b.id("host")] } }), "an item is not a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
});

clause(KNIFE, "0:attach", "when the host is put into its owner's hand the Knife leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = knifeBoard({ extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("host")] } });
  assert.equal(zoneOf(b.engine, b.id("host")), "hand");
  assert.equal(zoneOf(b.engine, b.id("knife")), "hand", "it leaves play 'in the same way': into its owner's hand");
  assert.equal(pending(b.engine), undefined, "and 'put into your discard pile' did not happen, so its trigger did not fire");
});

// -- 1:rule — +2 strength --------------------------------------------------------

clause(KNIFE, "1:rule", "the attached character gains exactly 2 strength (life and speed unchanged); nobody else does", () => {
  const b = knifeBoard();
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("host"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("host"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 1);
});

clause(KNIFE, "1:rule", "an opposing host gets the +2 (the Knife is attached to it)", () => {
  const b = knifeBoard({ knife: "hand", icons: { deception: 3 } });
  attachKnife(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
});

clause(KNIFE, "1:rule", "two Knives on one character stack: +4 strength", () => {
  const b = knifeBoard({ extra: [{ key: "knife2", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: "host" }] });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 5);
});

clause(KNIFE, "1:rule", "the bonus is real in battle: the attached character deals 3 to the faction", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "host", def: character({ name: "Host", strength: 1, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "knife", def: printing(KNIFE), owner: P1, zone: "play", attachedToKey: "host" }
    ]
  });
  const before = b.engine.state.players[P2].influence;
  fight(b.engine, P1, [b.id("host")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - b.engine.state.players[P2].influence, 3);
});

clause(KNIFE, "1:rule", "the bonus ends when the Knife leaves play", () => {
  const b = knifeBoard({ deck: ["character", "character", "character", "character"] });
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 3);
  play(b.engine, P1, b.id("killItem"), { selected: { t: [b.id("knife")] } });
  // The host pick of a Knife put into play is mandatory now (SYS-20), so the test gives it a real answer (the host) and guesses
  // the type "location" against a character-only deck: the Knife stays in the discard pile and the bonus really ends.
  settle(b.engine, (pc) => {
    if (pc.kind === "chooserSelectsOption") return { kind: "chooserSelectsOption", index: (pc.options as { label: string }[]).findIndex((option) => option.label === "location") };
    return pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("host")] } : declineAll(pc);
  });
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1);
});

clause(KNIFE, "1:rule", "a face-down Knife in play is only a resource: it gives nothing", () => {
  const b = knifeBoard({ knife: "hand", extra: [] });
  const faceDown = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "host", def: character({ name: "Host", strength: 1 }), owner: P1, zone: "play" },
      { key: "knife", def: printing(KNIFE), owner: P1, zone: "play", faceDown: true }
    ]
  });
  assert.equal(faceDown.engine.getStat(faceDown.id("host"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("host"), "strength"), 1, "nor does a Knife in hand");
});

// -- 2:rule — "put into your discard pile from play" ------------------------------

clause(KNIFE, "2:rule", "when the host is destroyed the Knife is put into its owner's discard pile from play and its owner is asked to choose a card type", () => {
  const b = knifeBoard();
  destroyHost(b);
  assert.equal(zoneOf(b.engine, b.id("host")), "discard");
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "control: the Knife is in the discard pile");
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; options: TypeOption[] };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  for (const type of CARD_TYPES) assert.ok(pc.options.some((option) => option.label === type), `${type} is offered`);
});

clause(KNIFE, "2:rule", "choosing the type the top card IS: it is revealed, the Knife is put into play and attached to the character I pick, and the top card goes to the bottom", () => {
  const b = knifeBoard({ deck: ["item", "character", "character", "character"] });
  const before = [...deckOf(b.engine, P1)];
  destroyHost(b);
  chooseType(b.engine, "item");
  assert.deepEqual(revealedIds(b.engine), [before[0]], "exactly the top card is revealed");
  const pc = pending(b.engine);
  assert.ok(pc, "I am asked which character to attach to");
  assert.equal(pc.kind, "chooserSelectsTarget");
  assert.equal(pc.playerId, P1);
  pickCards(b.engine, P1, [b.id("mine2")]);
  assert.equal(zoneOf(b.engine, b.id("knife")), "play", "the Knife is back in play");
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("mine2"));
  assert.equal(b.engine.state.cards[b.id("knife")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 3, "the new host has +2 strength");
  assert.deepEqual(deckOf(b.engine, P1), [...before.slice(1), before[0]], "the revealed top card is on the bottom");
  assert.equal(discardOf(b.engine, P1).includes(b.id("knife")), false, "no longer in the discard pile");
  assert.equal(pending(b.engine), undefined);
});

for (const type of CARD_TYPES) {
  clause(KNIFE, "2:rule", `choosing '${type}' with a ${type} on top puts the Knife back into play`, () => {
    const b = knifeBoard({ deck: [type, ...otherTypesThan(type)] });
    destroyHost(b);
    chooseType(b.engine, type);
    pickCards(b.engine, P1, [b.id("mine2")]);
    assert.equal(zoneOf(b.engine, b.id("knife")), "play");
    assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("mine2"));
  });
}

clause(KNIFE, "2:rule", "choosing a type the top card is NOT: it is revealed, the Knife stays in the discard pile, and the top card still goes to the bottom (all 20 wrong guesses)", () => {
  for (const top of CARD_TYPES) {
    for (const chosen of otherTypesThan(top)) {
      const b = knifeBoard({ deck: [top, "character", "item", "location"] });
      const before = [...deckOf(b.engine, P1)];
      destroyHost(b);
      chooseType(b.engine, chosen);
      const label = `top ${top}, chosen ${chosen}`;
      assert.deepEqual(revealedIds(b.engine), [before[0]], `${label}: the top card is revealed`);
      assert.equal(pending(b.engine), undefined, `${label}: nothing else is asked`);
      assert.equal(zoneOf(b.engine, b.id("knife")), "discard", `${label}: the Knife stays in the discard pile`);
      assert.deepEqual(deckOf(b.engine, P1), [...before.slice(1), before[0]], `${label}: the top card goes to the bottom`);
      assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 1, `${label}: nobody got the +2`);
    }
  }
});

clause(KNIFE, "2:rule", "the new host can be any character in play: an opponent's character too, but not an item, location, faction, face-down card or a card in a discard pile", () => {
  const b = knifeBoard({ deck: ["item", "character"] });
  destroyHost(b);
  chooseType(b.engine, "item");
  refused(tryPick(b.engine, [b.id("thing")]), "an item");
  refused(tryPick(b.engine, [b.id("place")]), "a location");
  refused(tryPick(b.engine, [factionOf(b.engine, P1)]), "my faction");
  refused(tryPick(b.engine, [b.id("hidden")]), "a face-down card");
  refused(tryPick(b.engine, [b.id("host")]), "the destroyed old host, now in the discard pile");
  refused(tryPick(b.engine, [b.id("mine2"), b.id("foe")]), "two hosts");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal host");
  pickCards(b.engine, P1, [b.id("foe")]);
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("foe"), "control: an opponent's character is a legal host");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
});

clause(KNIFE, "2:rule", "'put this card into play' is not optional: when a legal host exists the pick cannot be declined (CR 507.2b)", () => {
  const b = knifeBoard({ deck: ["item", "character"] });
  destroyHost(b);
  chooseType(b.engine, "item");
  refused(tryPick(b.engine, []), "the Knife must be attached to a character");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a host");
});

clause(KNIFE, "2:rule", "with no character left to attach to, the Knife stays in the discard pile (CR 507.2c) and the top card still goes to the bottom", () => {
  const b = knifeBoard({ deck: ["item", "character", "character"], onlyHost: true });
  const before = [...deckOf(b.engine, P1)];
  destroyHost(b);
  chooseType(b.engine, "item");
  settle(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.deepEqual(deckOf(b.engine, P1), [...before.slice(1), before[0]]);
});

clause(KNIFE, "2:rule", "a character that is the new host is a character 'in play': a character entering the picking is not needed; an attached Knife can be re-attached repeatedly (host dies again: the trigger fires again)", () => {
  const b = knifeBoard({ deck: ["item", "item", "item", "item"], extra: [{ key: "kill2", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  destroyHost(b);
  chooseType(b.engine, "item");
  pickCards(b.engine, P1, [b.id("mine2")]);
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("mine2"));
  play(b.engine, P1, b.id("kill2"), { selected: { t: [b.id("mine2")] } });
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard", "it followed its new host");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "and the trigger fires again");
  chooseType(b.engine, "item");
  pickCards(b.engine, P1, [b.id("foe")]);
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("foe"));
});

clause(KNIFE, "2:rule", "it triggers when the Knife itself is destroyed (an item in play is put into the discard pile)", () => {
  const b = knifeBoard({ deck: ["character", "item"] });
  play(b.engine, P1, b.id("killItem"), { selected: { t: [b.id("knife")] } });
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "the trigger fired");
  chooseType(b.engine, "character");
  pickCards(b.engine, P1, [b.id("mine2")]);
  assert.equal(b.engine.state.cards[b.id("knife")].attachedTo, b.id("mine2"));
});

clause(KNIFE, "2:rule", "it does NOT trigger when the Knife goes from play to my hand (only 'put into your discard pile')", () => {
  const bounceItem = tactic({
    name: "BounceItem",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "bi",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = knifeBoard({ extra: [{ key: "bounceItem", def: bounceItem, owner: P1, zone: "hand" }] });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("bounceItem"), { selected: { t: [b.id("knife")] } });
  assert.equal(zoneOf(b.engine, b.id("knife")), "hand");
  assert.equal(pending(b.engine), undefined, "no prompt");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
  assert.equal(revealEvents(b.engine).length, 0);
});

clause(KNIFE, "2:rule", "it does NOT trigger when the Knife is discarded from my hand (not 'from play')", () => {
  const discardIt = tactic({
    name: "DiscardIt",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "di",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "discard" }]
        }
      ]
    }
  });
  const b = knifeBoard({ knife: "hand", extra: [{ key: "discardIt", def: discardIt, owner: P1, zone: "hand" }] });
  const deckBefore = [...deckOf(b.engine, P1)];
  play(b.engine, P1, b.id("discardIt"), { selected: { t: [b.id("knife")] } });
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(pending(b.engine), undefined, "no prompt");
  assert.deepEqual(deckOf(b.engine, P1), deckBefore);
});

clause(KNIFE, "2:rule", "it does NOT trigger when the Knife goes from play to the top of my deck, or is removed from the game", () => {
  const toDeck = tactic({
    name: "ToDeck",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "td",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "deck", position: "top" }]
        }
      ]
    }
  });
  const removeIt = tactic({
    name: "RemoveIt",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "ri",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "item" }, count: 1 }],
          effects: [{ type: "removeFromGame", target: { type: "selected", id: "t" } }]
        }
      ]
    }
  });
  const down = knifeBoard({ extra: [{ key: "toDeck", def: toDeck, owner: P1, zone: "hand" }] });
  play(down.engine, P1, down.id("toDeck"), { selected: { t: [down.id("knife")] } });
  assert.equal(zoneOf(down.engine, down.id("knife")), "deck");
  assert.equal(pending(down.engine), undefined, "no prompt for a card put into the deck");
  const gone = knifeBoard({ extra: [{ key: "removeIt", def: removeIt, owner: P1, zone: "hand" }] });
  play(gone.engine, P1, gone.id("removeIt"), { selected: { t: [gone.id("knife")] } });
  assert.equal(zoneOf(gone.engine, gone.id("knife")), "removed");
  assert.equal(pending(gone.engine), undefined, "no prompt for a card removed from the game");
});

clause(KNIFE, "2:rule", "it triggers only for the Knife itself: another item going from play to the discard pile asks nothing", () => {
  const b = knifeBoard({ extra: [{ key: "otherItem", def: item({ name: "OtherItem" }), owner: P1, zone: "play" }] });
  play(b.engine, P1, b.id("killItem"), { selected: { t: [b.id("otherItem")] } });
  assert.equal(zoneOf(b.engine, b.id("otherItem")), "discard");
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("knife")), "play");
});

clause(KNIFE, "2:rule", "an opposing Knife (controlled by the opponent) reveals ITS controller's deck and that player chooses", () => {
  const b = knifeBoard({ owner: P2, turn: 2, active: P2, deck: ["item", "character"] });
  const p1Deck = [...deckOf(b.engine, P1)];
  const p2Top = deckOf(b.engine, P2)[0];
  play(b.engine, P2, b.id("kill"), { selected: { t: [b.id("host")] } });
  const pc = pending(b.engine);
  assert.ok(pc, "pc");
  assert.equal(pc.playerId, P2, "the Knife's controller chooses");
  chooseType(b.engine, "item");
  assert.deepEqual(revealedIds(b.engine), [p2Top]);
  assert.deepEqual(deckOf(b.engine, P1), p1Deck, "my deck is untouched");
});

clause(KNIFE, "2:rule", "'you MAY choose a card type': the controller can decline (the choice offers a way to choose no type)", () => {
  const b = knifeBoard();
  destroyHost(b);
  const decline = declineOptionIndex(b.engine);
  assert.ok(decline >= 0, "besides the five card types there is an option to decline");
  answerPending(b.engine, "chooserSelectsOption", { index: decline });
  assert.equal(pending(b.engine), undefined);
  assert.equal(revealEvents(b.engine).length, 0, "'If you do': declining reveals nothing");
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
});

clause(KNIFE, "2:rule", "literal reading: the last sentence is not conditional on choosing, so even after declining the top card of the deck is put on the bottom", () => {
  const b = knifeBoard();
  const before = [...deckOf(b.engine, P1)];
  destroyHost(b);
  const decline = declineOptionIndex(b.engine);
  assert.ok(decline >= 0, "the choice can be declined");
  answerPending(b.engine, "chooserSelectsOption", { index: decline });
  assert.equal(revealEvents(b.engine).length, 0, "nothing was revealed");
  assert.deepEqual(deckOf(b.engine, P1), [...before.slice(1), before[0]], "'Put the top card of your deck on the bottom' is a sentence of its own");
});

clause(KNIFE, "2:rule", "with an empty deck nothing is revealed, the Knife stays in the discard pile and nothing breaks", () => {
  const b = knifeBoard({ deck: [] });
  destroyHost(b);
  chooseType(b.engine, "item");
  settle(b.engine);
  assert.equal(pending(b.engine), undefined);
  assert.equal(zoneOf(b.engine, b.id("knife")), "discard");
  assert.equal(revealEvents(b.engine).length, 0);
  assert.equal(b.engine.state.winner, undefined);
});

// ==================================================================================
// Flimflam Man
// When this card enters play, you may choose a card type. If you do, reveal the top card of your deck. If it is the
// chosen type, put it into your hand. Otherwise, put it on the bottom of your deck.
// Character, rogue, subtype grifter, cost 4, threshold [D], 3 strength / 3 speed / 2 life.
// ==================================================================================

const FLIMFLAM = "24de2269-2902-4800-a2f9-2ad2de1f1ee5";

function flimflamBoard(
  opts: { deck?: TypeName[]; zone?: "hand" | "play"; icons?: Icons; turn?: number; active?: PlayerId; owner?: PlayerId; extra?: CardPlacement[]; handSize?: number } = {}
) {
  const owner = opts.owner ?? P1;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "ff", def: printing(FLIMFLAM), owner, zone: opts.zone ?? "hand" },
      ...fillers("h", opts.handSize ?? 1, owner, "hand"),
      ...typedDeck("d", opts.deck ?? ["character", "item", "location", "tactic", "resource"], owner),
      ...typedDeck("o", ["character", "item", "location"], other(owner)),
      ...res(opts.icons ?? { deception: 4 }, owner),
      ...(opts.extra ?? [])
    ]
  });
}

const FLIMFLAM_SPEC: DeploySpec = { id: FLIMFLAM, cost: 4, icon: "deception", count: 1 };

clause(FLIMFLAM, "0:rule", "deploys for exactly 4 with [D] with its printed 3 / 3 / 2 and grifter subtype; refused one short and without [D]", () => {
  deploysForExactlyItsCost(FLIMFLAM_SPEC);
  refusedOneShort(FLIMFLAM_SPEC);
  refusedWithoutThreshold(FLIMFLAM_SPEC);
  thresholdIsGateNotCost(FLIMFLAM_SPEC);
  const { engine, id } = flimflamBoard({ zone: "play" });
  assert.equal(engine.getStat(id("ff"), "strength"), 3);
  assert.equal(engine.getStat(id("ff"), "speed"), 3);
  assert.equal(engine.getStat(id("ff"), "life"), 2);
  assert.deepEqual(engine.getSubtypes(id("ff")), ["grifter"]);
});

clause(FLIMFLAM, "0:rule", "when it enters play its controller is asked to choose a card type, all five are offered", () => {
  const { engine, id } = flimflamBoard();
  play(engine, P1, id("ff"));
  const pc = pending(engine) as unknown as { kind: string; playerId: string; options: TypeOption[] };
  assert.ok(pc, "pc");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1);
  for (const type of CARD_TYPES) assert.ok(pc.options.some((option) => option.label === type), `${type} is offered`);
  assert.equal(zoneOf(engine, id("ff")), "play");
});

clause(FLIMFLAM, "0:rule", "'you MAY choose a card type': the controller can decline (the choice offers a way to choose no type)", () => {
  const { engine, id } = flimflamBoard();
  play(engine, P1, id("ff"));
  const decline = declineOptionIndex(engine);
  assert.ok(decline >= 0, "besides the five card types there is an option to decline");
  answerPending(engine, "chooserSelectsOption", { index: decline });
  assert.equal(pending(engine), undefined);
});

clause(FLIMFLAM, "0:rule", "'If you do': after declining nothing is revealed and the deck is untouched (the top card is not moved to the bottom)", () => {
  const { engine, id } = flimflamBoard();
  const before = [...deckOf(engine, P1)];
  const hand = [...handOf(engine, P1)];
  play(engine, P1, id("ff"));
  const decline = declineOptionIndex(engine);
  assert.ok(decline >= 0, "the choice can be declined");
  answerPending(engine, "chooserSelectsOption", { index: decline });
  assert.equal(revealEvents(engine).length, 0, "nothing revealed");
  assert.deepEqual(deckOf(engine, P1), before, "the deck is untouched, in the same order");
  assert.deepEqual(handOf(engine, P1), hand.filter((c) => c !== id("ff")), "nothing drawn");
});

for (const type of CARD_TYPES) {
  clause(FLIMFLAM, "0:rule", `choosing '${type}' with a ${type} on top: the top card is revealed and put into my hand (not on the bottom)`, () => {
    const { engine, id } = flimflamBoard({ deck: [type, ...otherTypesThan(type), otherTypesThan(type)[0]] });
    const before = [...deckOf(engine, P1)];
    const handBefore = handOf(engine, P1).length;
    play(engine, P1, id("ff"));
    chooseType(engine, type);
    assert.equal(pending(engine), undefined, "nothing else is asked");
    assert.deepEqual(revealedIds(engine), [before[0]], "exactly the top card is revealed");
    assert.equal(zoneOf(engine, before[0]), "hand", "it is in my hand");
    assert.ok(handOf(engine, P1).includes(before[0]), "handOf(engine, P1).includes(before[0])");
    assert.equal(handOf(engine, P1).length, handBefore - 1 + 1, "Flimflam left the hand, the revealed card joined it");
    assert.equal(deckOf(engine, P1).length, before.length - 1, "one card left the deck");
    assert.equal(deckOf(engine, P1).includes(before[0]), false, "the revealed card is no longer in the deck (it was not put on the bottom)");
  });
}

for (const type of CARD_TYPES) {
  clause(FLIMFLAM, "0:rule", `after choosing '${type}' with a ${type} on top ('Otherwise' is only for a miss): the rest of the deck is untouched and in order`, () => {
    const { engine, id } = flimflamBoard({ deck: [type, ...otherTypesThan(type), otherTypesThan(type)[0]] });
    const before = [...deckOf(engine, P1)];
    play(engine, P1, id("ff"));
    chooseType(engine, type);
    assert.deepEqual(deckOf(engine, P1), before.slice(1), "the next card is not put on the bottom: it was not the revealed one, and 'Otherwise' does not apply to a hit");
  });
}

clause(FLIMFLAM, "0:rule", "choosing a type the top card is NOT: it is revealed and put on the BOTTOM of the deck, my hand does not grow (all 20 wrong guesses)", () => {
  for (const top of CARD_TYPES) {
    for (const chosen of otherTypesThan(top)) {
      const { engine, id } = flimflamBoard({ deck: [top, "character", "item", "location"] });
      const before = [...deckOf(engine, P1)];
      const handBefore = [...handOf(engine, P1)];
      play(engine, P1, id("ff"));
      chooseType(engine, chosen);
      const label = `top ${top}, chosen ${chosen}`;
      assert.deepEqual(revealedIds(engine), [before[0]], `${label}: the top card is revealed`);
      assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]], `${label}: it goes to the bottom`);
      assert.deepEqual(handOf(engine, P1), handBefore.filter((c) => c !== id("ff")), `${label}: my hand is unchanged`);
    }
  }
});

clause(FLIMFLAM, "0:rule", "only the TOP card matters: a matching type further down gives nothing, the top card goes to the bottom", () => {
  const { engine, id } = flimflamBoard({ deck: ["item", "location", "character", "character"] });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("ff"));
  chooseType(engine, "character");
  assert.deepEqual(deckOf(engine, P1), [...before.slice(1), before[0]]);
  assert.equal(zoneOf(engine, before[2]), "deck", "the character further down was not taken");
});

clause(FLIMFLAM, "0:rule", "the card is revealed to everyone (a public reveal)", () => {
  const { engine, id } = flimflamBoard();
  play(engine, P1, id("ff"));
  chooseType(engine, "tactic");
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1);
  assert.equal((reveals[0].event as unknown as { viewerId: string }).viewerId, "all");
});

clause(FLIMFLAM, "0:rule", "a deck of one card: a match puts it into my hand (deck empty); a miss leaves it as the only card", () => {
  const hit = flimflamBoard({ deck: ["item"] });
  const only = deckOf(hit.engine, P1)[0];
  play(hit.engine, P1, hit.id("ff"));
  chooseType(hit.engine, "item");
  assert.equal(zoneOf(hit.engine, only), "hand");
  assert.equal(deckOf(hit.engine, P1).length, 0);
  const miss = flimflamBoard({ deck: ["item"] });
  const only2 = deckOf(miss.engine, P1)[0];
  play(miss.engine, P1, miss.id("ff"));
  chooseType(miss.engine, "tactic");
  assert.deepEqual(deckOf(miss.engine, P1), [only2]);
  assert.equal(zoneOf(miss.engine, only2), "deck");
});

clause(FLIMFLAM, "0:rule", "with an empty deck there is nothing to reveal: nothing happens and the game goes on", () => {
  const { engine, id } = flimflamBoard({ deck: [] });
  const handBefore = handOf(engine, P1).length;
  play(engine, P1, id("ff"));
  chooseType(engine, "character");
  assert.equal(pending(engine), undefined);
  assert.equal(revealEvents(engine).length, 0);
  assert.equal(handOf(engine, P1).length, handBefore - 1);
  assert.equal(engine.state.winner, undefined);
});

clause(FLIMFLAM, "0:rule", "it is MY deck: the opponent's deck, hand and discard pile are untouched", () => {
  const { engine, id } = flimflamBoard();
  const oppDeck = [...deckOf(engine, P2)];
  const oppHand = [...handOf(engine, P2)];
  play(engine, P1, id("ff"));
  chooseType(engine, "character");
  assert.deepEqual(deckOf(engine, P2), oppDeck);
  assert.deepEqual(handOf(engine, P2), oppHand);
  assert.equal(discardOf(engine, P2).length, 0);
});

clause(FLIMFLAM, "0:rule", "an opposing Flimflam Man reveals ITS controller's deck, that player chooses, and the card goes to THEIR hand", () => {
  const { engine, id } = flimflamBoard({ owner: P2, turn: 2, active: P2 });
  const p1Deck = [...deckOf(engine, P1)];
  const p2Top = deckOf(engine, P2)[0];
  play(engine, P2, id("ff"));
  assert.equal(pending(engine)?.playerId, P2);
  chooseType(engine, "character");
  assert.deepEqual(revealedIds(engine), [p2Top]);
  assert.ok(handOf(engine, P2).includes(p2Top), "handOf(engine, P2).includes(p2Top)");
  assert.deepEqual(deckOf(engine, P1), p1Deck);
});

clause(FLIMFLAM, "0:rule", "it triggers only when THIS card enters play: another character entering play asks nothing", () => {
  const { engine, id } = flimflamBoard({ zone: "play", extra: [{ key: "plain", def: character({ name: "Plain", cost: 1 }), owner: P1, zone: "hand" }] });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("plain"));
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), before);
  assert.equal(revealEvents(engine).length, 0);
});

clause(FLIMFLAM, "0:rule", "it triggers when put into play by an effect, not only when deployed", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "character" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = flimflamBoard({ icons: {}, extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  const top = deckOf(engine, P1)[0];
  play(engine, P1, id("cheat"), { selected: { t: [id("ff")] } });
  assert.equal(zoneOf(engine, id("ff")), "play");
  chooseType(engine, "character");
  assert.equal(zoneOf(engine, top), "hand");
});

clause(FLIMFLAM, "0:rule", "nothing happens when it leaves play", () => {
  const { engine, id } = flimflamBoard({ zone: "play", extra: [{ key: "kill", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  const before = [...deckOf(engine, P1)];
  play(engine, P1, id("kill"), { selected: { t: [id("ff")] } });
  assert.equal(zoneOf(engine, id("ff")), "discard");
  assert.equal(pending(engine), undefined);
  assert.deepEqual(deckOf(engine, P1), before);
});

// ==================================================================================
// Gambling Den
// At the start of your turn, reveal the top card of your deck. If it has numeric cost 3 or less, both players may
// draw a card. Otherwise, both players may play a resource.
// Location, rogue, cost 0, threshold [D], structure 4.
// ==================================================================================

const DEN = "ee8821d4-4933-4e4b-a632-c4db1b91ea95";

/** Cost-`n` cards for the top of P1's deck, keyed t0.. in order (t0 is the top). */
const costedDeck = (costs: number[], owner: PlayerId = P1): CardPlacement[] =>
  costs.map((cost, index) => ({ key: `t${index}`, def: character({ name: `Top${index} (cost ${cost})`, cost }), owner, zone: "deck" as const }));

function denBoard(
  opts: {
    costs?: number[];
    oppCosts?: number[];
    den?: "play" | "hand" | "faceDown";
    startAs?: PlayerId;
    handResources?: boolean;
    extra?: CardPlacement[];
    denOwner?: PlayerId;
  } = {}
) {
  const startAs = opts.startAs ?? P1;
  const denOwner = opts.denOwner ?? P1;
  const where = opts.den ?? "play";
  return buildGame({
    turn: 2,
    activePlayerId: other(startAs),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "den", def: printing(DEN), owner: denOwner, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...costedDeck(opts.costs ?? [2, 5, 1, 1], P1),
      ...costedDeck(opts.oppCosts ?? [1, 1, 1], P2).map((p) => ({ ...p, key: p.key.replace("t", "u") })),
      { key: "rh", def: resourceCard({ name: "MyRageRes" }), owner: P1, zone: "hand" },
      { key: "h1", def: character({ name: "MyHandChar" }), owner: P1, zone: "hand" },
      { key: "orh", def: resourceCard({ name: "TheirRageRes" }), owner: P2, zone: "hand" },
      { key: "oh1", def: character({ name: "TheirHandChar" }), owner: P2, zone: "hand" },
      ...(opts.extra ?? [])
    ]
  });
}

interface DenPolicy {
  /** Whether each player says yes to "may draw" / "may play a resource" (default: yes). */
  p1?: "yes" | "no";
  p2?: "yes" | "no";
}

/** Ends the other player's turn so `player`'s turn starts, answers every prompt per `policy`, and returns what each player was asked as "<player>:<non-decline option labels>". */
function startTurn(engine: SpoilsEngine, id: Id, player: PlayerId, policy: DenPolicy = {}): string[] {
  endTurn(engine, other(player));
  assert.equal(engine.state.activePlayerId, player, "the turn has changed hands");
  const asked: string[] = [];
  drain(engine, (pc) => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "chooserSelectsOption") {
      const labels = (pc.options as Array<{ label: string }>).map((o) => o.label);
      asked.push(`${pc.playerId}:${labels.filter((l) => l !== "Decline").join("/")}`);
      const yes = (pc.playerId === P1 ? policy.p1 : policy.p2) !== "no";
      return { kind: "chooserSelectsOption", index: yes ? labels.findIndex((l) => l !== "Decline") : labels.indexOf("Decline") };
    }
    if (pc.kind === "chooserSelectsTarget") {
      // the "may play a resource" offer is an optional pick of a card from hand: a pick = yes, no pick = decline
      asked.push(`${pc.playerId}:Play a resource`);
      const yes = (pc.playerId === P1 ? policy.p1 : policy.p2) !== "no";
      const resource = pc.playerId === P1 ? id("rh") : id("orh");
      return { kind: "chooserSelectsTarget", selected: yes ? [resource] : [] };
    }
    return declineAll(pc);
  });
  return asked;
}

const DEN_SPEC: DeploySpec = { id: DEN, cost: 0, icon: "deception", count: 1 };

clause(DEN, "0:rule", "deploys for its printed cost of 0 with [D] (refused without [D]); it is a location with 4 structure", () => {
  deploysForExactlyItsCost(DEN_SPEC);
  refusedOneShort(DEN_SPEC);
  refusedWithoutThreshold(DEN_SPEC);
  thresholdIsGateNotCost(DEN_SPEC);
  const { engine, id } = denBoard();
  assert.deepEqual(engine.getCardTypes(id("den")), ["location"]);
});

clause(DEN, "0:rule", "its structure is 4: an attack of 3 leaves it standing with 3 damage, an attack of 4 destroys it", () => {
  const strike = (strength: number) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "den", def: printing(DEN), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength, life: 5, speed: 2 }), owner: P2, zone: "play" }
      ]
    });
    fight(b.engine, P2, [b.id("atk")], { type: "card", cardId: b.id("den") }, []);
    return b;
  };
  const three = strike(3);
  assert.equal(zoneOf(three.engine, three.id("den")), "play");
  assert.equal(three.engine.state.cards[three.id("den")].damage, 3);
  const four = strike(4);
  assert.equal(zoneOf(four.engine, four.id("den")), "discard");
});

clause(DEN, "0:rule", "at the start of MY turn the top card of my deck is revealed to everyone, and it stays on top of the deck", () => {
  const { engine, id } = denBoard({ costs: [2, 1, 1] });
  const deck = [...deckOf(engine, P1)];
  startTurn(engine, id, P1, { p1: "no", p2: "no" });
  const reveals = revealEvents(engine);
  assert.equal(reveals.length, 1, "exactly one reveal");
  const event = reveals[0].event as unknown as { cardIds: string[]; viewerId: string };
  assert.deepEqual(event.cardIds, [deck[0]], "the top card of my deck");
  assert.equal(event.viewerId, "all");
  assert.deepEqual(deckOf(engine, P1), deck, "when nobody draws, the revealed card stays on top");
});

for (const cost of [0, 1, 2, 3]) {
  clause(DEN, "0:rule", `a revealed card of numeric cost ${cost} (3 or less): BOTH players are asked whether they want to draw a card, me first`, () => {
    const { engine, id } = denBoard({ costs: [cost, 1, 1, 1] });
    const asked = startTurn(engine, id, P1, { p1: "no", p2: "no" });
    assert.deepEqual(asked, [`${P1}:Draw`, `${P2}:Draw`], "only the draw offer, to the active player first and then the other");
  });
}

for (const cost of [4, 5, 9]) {
  clause(DEN, "0:rule", `a revealed card of numeric cost ${cost} (more than 3): BOTH players are asked whether they want to play a resource, me first`, () => {
    const { engine, id } = denBoard({ costs: [cost, 1, 1, 1] });
    const asked = startTurn(engine, id, P1, { p1: "no", p2: "no" });
    assert.deepEqual(asked, [`${P1}:Play a resource`, `${P2}:Play a resource`], "only the resource offer, to the active player first and then the other");
  });
}

clause(DEN, "0:rule", "numeric cost is read from the card whatever its type: a tactic of cost 3 draws, an item of cost 4 plays resources, a resource (cost 0) draws", () => {
  const typed = (def: CardDefinition) => denBoard({ costs: [], extra: [{ key: "top", def, owner: P1, zone: "deck" }, ...costedDeck([1, 1], P1).map((p) => ({ ...p, key: `n${p.key}` }))] });
  const tac = typed(tactic({ name: "TopTactic", cost: 3 }));
  assert.deepEqual(startTurn(tac.engine, tac.id, P1, { p1: "no", p2: "no" }), [`${P1}:Draw`, `${P2}:Draw`]);
  const itm = typed(item({ name: "TopItem", cost: 4 }));
  assert.deepEqual(startTurn(itm.engine, itm.id, P1, { p1: "no", p2: "no" }), [`${P1}:Play a resource`, `${P2}:Play a resource`]);
  const rsc = typed(resourceCard({ name: "TopResource" }));
  assert.deepEqual(startTurn(rsc.engine, rsc.id, P1, { p1: "no", p2: "no" }), [`${P1}:Draw`, `${P2}:Draw`]);
  const loc = typed(location({ name: "TopLocation", cost: 6 }));
  assert.deepEqual(startTurn(loc.engine, loc.id, P1, { p1: "no", p2: "no" }), [`${P1}:Play a resource`, `${P2}:Play a resource`]);
});

clause(DEN, "0:rule", "it is MY deck that is revealed, not the opponent's: their top card's cost does not decide the branch", () => {
  const cheap = denBoard({ costs: [1, 1, 1], oppCosts: [9, 9, 9] });
  assert.deepEqual(startTurn(cheap.engine, cheap.id, P1, { p1: "no", p2: "no" }), [`${P1}:Draw`, `${P2}:Draw`], "my top card costs 1: draw, whatever theirs costs");
  const dear = denBoard({ costs: [8, 1, 1], oppCosts: [0, 0, 0] });
  assert.deepEqual(startTurn(dear.engine, dear.id, P1, { p1: "no", p2: "no" }), [`${P1}:Play a resource`, `${P2}:Play a resource`]);
  assert.equal(revealEvents(dear.engine).length, 1);
});

clause(DEN, "0:rule", "draw branch, both say yes: each draws exactly one card from the top of their OWN deck", () => {
  const { engine, id } = denBoard({ costs: [2, 7, 1, 1], oppCosts: [1, 1, 1] });
  const myTop = deckOf(engine, P1)[0];
  const theirTop = deckOf(engine, P2)[0];
  const myHand = handOf(engine, P1).length;
  const theirHand = handOf(engine, P2).length;
  startTurn(engine, id, P1, { p1: "yes", p2: "yes" });
  assert.equal(handOf(engine, P1).length, myHand + 1, "I drew exactly one");
  assert.equal(handOf(engine, P2).length, theirHand + 1, "they drew exactly one");
  assert.equal(zoneOf(engine, myTop), "hand", "the revealed card is the one I drew");
  assert.equal(zoneOf(engine, theirTop), "hand");
  assert.equal(deckOf(engine, P1).length, 3);
  assert.equal(deckOf(engine, P2).length, 2);
});

clause(DEN, "0:rule", "draw branch is a 'may' for each player separately: I decline and they draw / they decline and I draw / both decline", () => {
  const a = denBoard({ costs: [2, 7, 1], oppCosts: [1, 1, 1] });
  const a1 = handOf(a.engine, P1).length;
  const a2 = handOf(a.engine, P2).length;
  startTurn(a.engine, a.id, P1, { p1: "no", p2: "yes" });
  assert.equal(handOf(a.engine, P1).length, a1, "I declined: no draw");
  assert.equal(handOf(a.engine, P2).length, a2 + 1, "they accepted");
  const b = denBoard({ costs: [2, 7, 1], oppCosts: [1, 1, 1] });
  const b1 = handOf(b.engine, P1).length;
  const b2 = handOf(b.engine, P2).length;
  startTurn(b.engine, b.id, P1, { p1: "yes", p2: "no" });
  assert.equal(handOf(b.engine, P1).length, b1 + 1, "I accepted");
  assert.equal(handOf(b.engine, P2).length, b2, "they declined: no draw");
  const c = denBoard({ costs: [2, 7, 1], oppCosts: [1, 1, 1] });
  const c1 = handOf(c.engine, P1).length;
  const c2 = handOf(c.engine, P2).length;
  startTurn(c.engine, c.id, P1, { p1: "no", p2: "no" });
  assert.equal(handOf(c.engine, P1).length, c1);
  assert.equal(handOf(c.engine, P2).length, c2);
});

clause(DEN, "0:rule", "'Otherwise' means only the matching branch happens: after I draw the revealed cheap card, the NEXT card (cost 5) does not trigger the resource offer too", () => {
  const { engine, id } = denBoard({ costs: [2, 5, 1, 1], oppCosts: [1, 1, 1] });
  const asked = startTurn(engine, id, P1, { p1: "yes", p2: "yes" });
  assert.deepEqual(asked, [`${P1}:Draw`, `${P2}:Draw`], "nobody is offered to play a resource");
});

clause(DEN, "0:rule", "resource branch: it is not a draw, nobody draws and the revealed card stays on top of my deck", () => {
  const { engine, id } = denBoard({ costs: [6, 1, 1], oppCosts: [1, 1, 1] });
  const deck = [...deckOf(engine, P1)];
  const oppDeck = [...deckOf(engine, P2)];
  startTurn(engine, id, P1, { p1: "no", p2: "no" });
  assert.deepEqual(deckOf(engine, P1), deck);
  assert.deepEqual(deckOf(engine, P2), oppDeck);
});

clause(DEN, "0:rule", "resource branch: a player who says yes actually plays a resource (a resource card from their hand enters play face-up)", () => {
  const { engine, id } = denBoard({ costs: [6, 1, 1], oppCosts: [1, 1, 1] });
  const myReady = ready(engine, P1);
  const theirReady = ready(engine, P2);
  startTurn(engine, id, P1, { p1: "yes", p2: "yes" });
  assert.equal(zoneOf(engine, id("rh")), "play", "my resource card was played");
  assert.equal(zoneOf(engine, id("orh")), "play", "their resource card was played");
  assert.equal(engine.isResource(id("rh")), true);
  assert.equal(ready(engine, P1), myReady + 1, "it provides a resource");
  assert.equal(ready(engine, P2), theirReady + 1);
});

clause(DEN, "0:rule", "resource branch: only the player who says yes plays one", () => {
  const { engine, id } = denBoard({ costs: [6, 1, 1], oppCosts: [1, 1, 1] });
  startTurn(engine, id, P1, { p1: "yes", p2: "no" });
  assert.equal(zoneOf(engine, id("rh")), "play", "I said yes");
  assert.equal(zoneOf(engine, id("orh")), "hand", "they said no");
});

clause(DEN, "0:rule", "resource branch, both decline: no resource is played and no cards move", () => {
  const { engine, id } = denBoard({ costs: [6, 1, 1], oppCosts: [1, 1, 1] });
  startTurn(engine, id, P1, { p1: "no", p2: "no" });
  assert.equal(zoneOf(engine, id("rh")), "hand");
  assert.equal(zoneOf(engine, id("orh")), "hand");
  assert.equal(zoneOf(engine, id("h1")), "hand");
});

clause(DEN, "0:rule", "it triggers at the start of MY turn only: when the opponent's turn starts nothing is revealed or offered", () => {
  const { engine, id } = denBoard({ startAs: P2, costs: [2, 1, 1], oppCosts: [1, 1, 1] });
  const deck = [...deckOf(engine, P1)];
  const asked = startTurn(engine, id, P2, { p1: "yes", p2: "yes" });
  assert.deepEqual(asked, [], "nobody is asked anything");
  assert.equal(revealEvents(engine).length, 0);
  assert.deepEqual(deckOf(engine, P1), deck);
});

clause(DEN, "0:rule", "it triggers again at the start of each of my turns", () => {
  const { engine, id } = denBoard({ costs: [2, 1, 1, 1, 1], oppCosts: [1, 1, 1, 1] });
  startTurn(engine, id, P1, { p1: "yes", p2: "no" });
  assert.equal(handOf(engine, P1).length, 3, "first turn: drew one");
  endTurn(engine, P1);
  const asked: string[] = [];
  endTurn(engine, P2);
  drain(engine, (pc) => {
    asked.push(`${pc.playerId}:${pc.kind}`);
    return pc.kind === "chooserSelectsOption" ? { kind: "chooserSelectsOption", index: 0 } : declineAll(pc);
  });
  assert.equal(asked.length >= 2, true, "asked again on my next turn");
  assert.equal(revealEvents(engine).length, 2, "revealed once per turn start");
});

clause(DEN, "0:rule", "it does nothing while the Den is in my hand or face-down as a resource (CR 411.1)", () => {
  const inHand = denBoard({ den: "hand", costs: [2, 1, 1] });
  assert.deepEqual(startTurn(inHand.engine, inHand.id, P1), []);
  assert.equal(revealEvents(inHand.engine).length, 0);
  const faceDown = denBoard({ den: "faceDown", costs: [2, 1, 1] });
  assert.deepEqual(startTurn(faceDown.engine, faceDown.id, P1), []);
  assert.equal(revealEvents(faceDown.engine).length, 0);
});

clause(DEN, "0:rule", "it stops working once the Den is destroyed", () => {
  const { engine, id } = denBoard({ costs: [2, 1, 1], extra: [{ key: "killLoc", def: killAnyTactic("location"), owner: P2, zone: "hand" }] });
  const b = engine;
  b.perform({ type: "playCard", playerId: P2, cardId: id("killLoc"), selected: { t: [id("den")] }, variables: {} } as never);
  resolvePendingResponses(b);
  assert.equal(zoneOf(b, id("den")), "discard");
  assert.deepEqual(startTurn(b, id, P1), []);
  assert.equal(revealEvents(b).length, 0);
});

clause(DEN, "0:rule", "an empty deck: there is no card to reveal, so neither branch applies (the 'it' of both sentences is missing, CR 402.5b) and nobody is asked anything", () => {
  const { engine, id } = denBoard({ costs: [], oppCosts: [1, 1, 1] });
  const asked = startTurn(engine, id, P1, { p1: "yes", p2: "yes" });
  assert.equal(revealEvents(engine).length, 0, "nothing to reveal");
  assert.deepEqual(asked, [], "no draw offer and no resource offer");
});

clause(DEN, "0:rule", "a one-card deck: the card is revealed and drawn if I say yes (deck then empty)", () => {
  const { engine, id } = denBoard({ costs: [3], oppCosts: [1, 1, 1] });
  const only = deckOf(engine, P1)[0];
  startTurn(engine, id, P1, { p1: "yes", p2: "no" });
  assert.equal(zoneOf(engine, only), "hand");
  assert.equal(deckOf(engine, P1).length, 0);
});

clause(DEN, "0:rule", "two Dens trigger separately: each reveals the top card and makes its own offer", () => {
  const { engine, id } = denBoard({ costs: [2, 1, 1, 1], extra: [{ key: "den2", def: printing(DEN), owner: P1, zone: "play" }] });
  const asked = startTurn(engine, id, P1, { p1: "no", p2: "no" });
  assert.equal(revealEvents(engine).length, 2, "two reveals");
  assert.equal(asked.filter((entry) => entry === `${P1}:Draw`).length, 2, "I am offered a draw twice");
  assert.equal(asked.filter((entry) => entry === `${P2}:Draw`).length, 2, "and so are they");
});

// ==================================================================================
// Guttersnipe
// You may play this card whenever you could play a tactic.   FLIP UP: 0 [D][D]
// Character, rogue, subtype outcast, cost 1, threshold [D][D], 1 strength / 4 speed / 1 life.
// ==================================================================================

const GUTTERSNIPE = "90765f47-153f-4924-82fc-ce39dadacaee";

function snipeBoard(
  opts: {
    where?: "hand" | "faceDown" | "play";
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.where ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "gs", def: printing(GUTTERSNIPE), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      { key: "plain", def: character({ name: "PlainChar", cost: 0 }), owner: P1, zone: "hand" },
      { key: "mine", def: character({ name: "Mine", strength: 1, life: 3, speed: 1 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      { key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      ...res(opts.icons ?? { deception: 2 }),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

const SNIPE_SPEC: DeploySpec = { id: GUTTERSNIPE, cost: 1, icon: "deception", count: 2 };

clause(GUTTERSNIPE, "0:rule", "on my own turn it deploys for exactly 1 with [D][D], and has its printed 1 strength / 4 speed / 1 life and the outcast subtype", () => {
  deploysForExactlyItsCost(SNIPE_SPEC);
  refusedOneShort(SNIPE_SPEC);
  refusedWithoutThreshold(SNIPE_SPEC);
  thresholdIsGateNotCost(SNIPE_SPEC);
  const { engine, id } = snipeBoard({ where: "play", turn: 1, active: P1 });
  assert.equal(engine.getStat(id("gs"), "strength"), 1);
  assert.equal(engine.getStat(id("gs"), "speed"), 4);
  assert.equal(engine.getStat(id("gs"), "life"), 1);
  assert.deepEqual(engine.getSubtypes(id("gs")), ["outcast"]);
});

clause(GUTTERSNIPE, "0:rule", "in response to the opponent's card on their turn it can be played from my hand, pays 1, and resolves into play under my control as a character", () => {
  const b = snipeBoard();
  playRaw(b.engine, P2, b.id("nothing"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("gs"));
  assert.equal(zoneOf(b.engine, b.id("gs")), "deploying", "it waits for responses like any played card");
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1 was paid");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gs")), "play", "a character resolves into play, not into the discard pile");
  assert.equal(controllerOf(b.engine, b.id("gs")), P1);
  assert.deepEqual(b.engine.getCardTypes(b.id("gs")), ["character"]);
  assert.equal(zoneOf(b.engine, b.id("nothing")), "discard", "the opponent's tactic also resolved");
});

clause(GUTTERSNIPE, "0:rule", "an ordinary character cannot be played in that same window (control)", () => {
  const b = snipeBoard();
  playRaw(b.engine, P2, b.id("nothing"));
  refused(() => playRaw(b.engine, P1, b.id("plain")), "an ordinary character is not a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
  assert.equal(zoneOf(b.engine, b.id("plain")), "hand");
  playRaw(b.engine, P1, b.id("gs"));
  assert.ok(b.engine.state.responseWindow, "but Guttersnipe can");
});

clause(GUTTERSNIPE, "0:rule", "'whenever you COULD play a tactic': with nothing to respond to on the opponent's turn it cannot be played", () => {
  const b = snipeBoard();
  assert.equal(b.engine.state.responseWindow, undefined);
  refused(() => playRaw(b.engine, P1, b.id("gs")), "no tactic could be played now", /Only the active player may deploy/);
  assert.equal(zoneOf(b.engine, b.id("gs")), "hand");
});

clause(GUTTERSNIPE, "0:rule", "it can be played at a battle response point: the opponent attacks and passes, I play it, and it can then BLOCK", () => {
  const b = snipeBoard();
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("gs")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("gs")], "a character in play can block");
});

clause(GUTTERSNIPE, "0:rule", "it can be played when the opponent announces the end of their turn", () => {
  const b = snipeBoard();
  refused(() => playRaw(b.engine, P1, b.id("gs")), "before the announcement", /Only the active player may deploy/);
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
});

clause(GUTTERSNIPE, "0:rule", "the cost and threshold still apply when played that way: one resource short or one [D] short is refused", () => {
  const poor = snipeBoard({ icons: { deception: 1 } });
  playRaw(poor.engine, P2, poor.id("nothing"));
  refused(() => playRaw(poor.engine, P1, poor.id("gs")), "one [D] is not [D][D]");
  const wrong = snipeBoard({ icons: { rage: 4, deception: 1 } });
  playRaw(wrong.engine, P2, wrong.id("nothing"));
  refused(() => playRaw(wrong.engine, P1, wrong.id("gs")), "other icons do not help");
  assert.equal(zoneOf(wrong.engine, wrong.id("gs")), "hand");
  const ok = snipeBoard({ icons: { deception: 2 } });
  playRaw(ok.engine, P2, ok.id("nothing"));
  playRaw(ok.engine, P1, ok.id("gs"));
  assert.ok(ok.engine.state.responseWindow, "control: [D][D] is enough");
});

clause(GUTTERSNIPE, "0:rule", "the opponent can respond to it: a played Guttersnipe can be terminated", () => {
  const b = snipeBoard({ extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  playRaw(b.engine, P2, b.id("nothing"));
  playRaw(b.engine, P1, b.id("gs"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to my response");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("gs")] });
  assert.equal(zoneOf(b.engine, b.id("gs")), "discard", "terminated: to its owner's discard pile");
});

clause(GUTTERSNIPE, "0:rule", "a Guttersnipe played on the opponent's turn started my next turn in play: it can attack then", () => {
  const b = snipeBoard();
  playRaw(b.engine, P2, b.id("nothing"));
  playRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  refused(() => declareAttackBy(b.engine, P1, [b.id("gs")]), "it is not my turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  declareAttackBy(b.engine, P1, [b.id("gs")]);
  assert.ok(b.engine.state.battle, "it attacked");
});

clause(GUTTERSNIPE, "0:rule", "on my own turn the Guttersnipe deployed from hand is a new arrival: it cannot attack that turn (no AGGRO)", () => {
  const b = snipeBoard({ turn: 1, active: P1 });
  play(b.engine, P1, b.id("gs"));
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  refused(() => declareAttackBy(b.engine, P1, [b.id("gs")]), "it cannot attack the turn it enters play");
});

clause(GUTTERSNIPE, "0:rule", "it is not covert: an ordinary character can block it", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P1,
    cards: [
      { key: "gs", def: printing(GUTTERSNIPE), owner: P1, zone: "play" },
      { key: "plain", def: character({ name: "Plain", strength: 1, life: 5, speed: 1 }), owner: P2, zone: "play" }
    ]
  });
  declareAttackBy(b.engine, P1, [b.id("gs")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("plain")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("plain")]);
});

clause(GUTTERSNIPE, "0:rule", "the permission is for THIS card only and only for the controller: the opponent's Guttersnipe is not playable by me, and my own is not playable by them", () => {
  const b = snipeBoard({ turn: 1, active: P1, extra: [{ key: "oppGs", def: printing(GUTTERSNIPE), owner: P2, zone: "hand" }, ...res({ deception: 2 }, P2)] });
  playRaw(b.engine, P1, b.id("plain"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "control: now the opponent may respond");
  refused(() => playRaw(b.engine, P2, b.id("gs")), "they cannot play my Guttersnipe");
  playRaw(b.engine, P2, b.id("oppGs"));
  assert.ok(b.engine.state.responseWindow, "but their own Guttersnipe is playable for them");
});

// -- 1:flipUp ---------------------------------------------------------------------

clause(GUTTERSNIPE, "1:flipUp", "a face-down Guttersnipe is a resource that provides Volition until it is flipped", () => {
  const b = snipeBoard({ where: "faceDown", icons: { deception: 2 } });
  assert.equal(b.engine.isResource(b.id("gs")), true);
  assert.equal(ready(b.engine), 3);
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(GUTTERSNIPE, "1:flipUp", "flips up for 0 with [D][D] on my turn: nothing is paid, it is a face-up character in play with its printed stats", () => {
  const b = snipeBoard({ where: "faceDown", turn: 1, active: P1 });
  flipUpRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  assert.equal(isFaceDown(b.engine, b.id("gs")), false);
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  assert.deepEqual(b.engine.getCardTypes(b.id("gs")), ["character"]);
  assert.equal(attachedCount(b.engine, P1), 0, "FLIP UP cost 0: nothing was spent");
  assert.equal(ready(b.engine), 2, "the two [D] remain; the card stopped being a resource");
  assert.equal(b.engine.getStat(b.id("gs"), "strength"), 1);
  assert.equal(b.engine.getStat(b.id("gs"), "speed"), 4);
  assert.equal(b.engine.getStat(b.id("gs"), "life"), 1);
});

clause(GUTTERSNIPE, "1:flipUp", "FLIP UP needs [D][D]: one [D] among many other resources is refused (and it stays face-down), two are accepted", () => {
  const one = snipeBoard({ where: "faceDown", turn: 1, active: P1, icons: { deception: 1, rage: 6 } });
  refused(() => flipUpRaw(one.engine, P1, one.id("gs")), "one [D]");
  assert.equal(isFaceDown(one.engine, one.id("gs")), true);
  const none = snipeBoard({ where: "faceDown", turn: 1, active: P1, icons: { rage: 6 } });
  refused(() => flipUpRaw(none.engine, P1, none.id("gs")), "no [D]");
  const two = snipeBoard({ where: "faceDown", turn: 1, active: P1, icons: { deception: 2 } });
  flipUpRaw(two.engine, P1, two.id("gs"));
  resolvePendingResponses(two.engine);
  assert.equal(isFaceDown(two.engine, two.id("gs")), false, "control: [D][D] is accepted");
});

clause(GUTTERSNIPE, "1:flipUp", "its own Volition, other face-down cards' Volition and the opponent's [D] do not provide [D]", () => {
  const own = snipeBoard({ where: "faceDown", turn: 1, active: P1, icons: { deception: 1 }, extra: volition(3, P1) });
  refused(() => flipUpRaw(own.engine, P1, own.id("gs")), "Volition is not [D]");
  const theirs = snipeBoard({ where: "faceDown", turn: 1, active: P1, icons: { deception: 1 }, oppIcons: { deception: 4 } });
  refused(() => flipUpRaw(theirs.engine, P1, theirs.id("gs")), "the opponent's [D] do not count");
  assert.equal(isFaceDown(theirs.engine, theirs.id("gs")), true);
});

clause(GUTTERSNIPE, "1:flipUp", "the flipped-up Guttersnipe is a brand-new character: it cannot attack the turn it was flipped up", () => {
  const b = snipeBoard({ where: "faceDown", turn: 1, active: P1 });
  flipUpRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  refused(() => declareAttackBy(b.engine, P1, [b.id("gs")]), "it just entered play", /did not start the turn in play/);
});

clause(GUTTERSNIPE, "1:flipUp", "its own text lets it be played whenever a tactic could be, so FLIP UP works in a response window on the opponent's turn too (CR 507.4d)", () => {
  const b = snipeBoard({ where: "faceDown" });
  refused(() => flipUpRaw(b.engine, P1, b.id("gs")), "with no window open on their turn there is no tactic timing");
  assert.equal(isFaceDown(b.engine, b.id("gs")), true);
  playRaw(b.engine, P2, b.id("nothing"));
  flipUpRaw(b.engine, P1, b.id("gs"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("gs")), "play");
  assert.equal(isFaceDown(b.engine, b.id("gs")), false);
});

clause(GUTTERSNIPE, "1:flipUp", "only its controller can flip it up, and only while it is face-down in play (not from the hand, not when already face-up)", () => {
  const theirs = snipeBoard({ where: "faceDown", turn: 1, active: P1, oppIcons: { deception: 2 }, extra: [{ key: "n2", def: nothingTactic(), owner: P1, zone: "hand" }] });
  playRaw(theirs.engine, P1, theirs.id("n2"));
  assert.equal(theirs.engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent holds priority");
  refused(() => flipUpRaw(theirs.engine, P2, theirs.id("gs")), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("gs")), true);
  const inHand = snipeBoard({ where: "hand", turn: 1, active: P1 });
  refused(() => flipUpRaw(inHand.engine, P1, inHand.id("gs")), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("gs")), "hand");
  const faceUp = snipeBoard({ where: "play", turn: 1, active: P1 });
  refused(() => flipUpRaw(faceUp.engine, P1, faceUp.id("gs")), "already face-up");
});

clause(GUTTERSNIPE, "1:flipUp", "a flipped-up character is played as though from the hand (CR 507.4a): the opponent gets the chance to respond before it resolves, and can terminate it", () => {
  const b = snipeBoard({ where: "faceDown", turn: 1, active: P1, extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipUpRaw(b.engine, P1, b.id("gs")));
  assert.ok(b.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("gs")] });
  assert.equal(zoneOf(b.engine, b.id("gs")), "discard", "terminated: it goes to its owner's discard pile (CR 314.1)");
});

// ==================================================================================
// Harbinger of Anguish
// DEMOTIVATE -- COST: Pay 1. Deplete this card. Pick a character. -- EFFECT: This turn, the character loses 1 life.
// Character, rogue, subtype teller, cost 4, threshold [D][D], 1 strength / 3 speed / 1 life.
// ==================================================================================

const HARBINGER = "783bcae6-08af-475b-bd25-36c3d331b046";
const DEMOTIVATE = "demotivate";

function harbingerBoard(
  opts: { zone?: "play" | "hand"; depleted?: boolean; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[] } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "hb", def: printing(HARBINGER), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 3, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 3, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { rage: 2 }),
      ...(opts.extra ?? [])
    ]
  });
}

type HarbingerGame = ReturnType<typeof harbingerBoard>;
const demotivate = (b: HarbingerGame, target: string, who = "hb") => activate(b.engine, P1, b.id(who), DEMOTIVATE, { selected: { c: [b.id(target)] } });
const demotivateRaw = (b: HarbingerGame, target: string, who = "hb") => activateRaw(b.engine, P1, b.id(who), DEMOTIVATE, { c: [b.id(target)] });

const HARBINGER_SPEC: DeploySpec = { id: HARBINGER, cost: 4, icon: "deception", count: 2 };

clause(HARBINGER, "0:ability:demotivate", "deploys for exactly 4 with [D][D] with its printed 1 / 3 / 1 and teller subtype; refused one short and with one [D]", () => {
  deploysForExactlyItsCost(HARBINGER_SPEC);
  refusedOneShort(HARBINGER_SPEC);
  refusedWithoutThreshold(HARBINGER_SPEC);
  thresholdIsGateNotCost(HARBINGER_SPEC);
  const { engine, id } = harbingerBoard();
  assert.equal(engine.getStat(id("hb"), "strength"), 1);
  assert.equal(engine.getStat(id("hb"), "speed"), 3);
  assert.equal(engine.getStat(id("hb"), "life"), 1);
  assert.deepEqual(engine.getSubtypes(id("hb")), ["teller"]);
});

clause(HARBINGER, "0:ability:demotivate", "COST: pays exactly 1 resource (any kind), depletes the Harbinger; EFFECT: the picked character loses exactly 1 life", () => {
  const b = harbingerBoard({ icons: { rage: 3 } });
  const before = ready(b.engine);
  demotivate(b, "foe");
  assert.equal(before - ready(b.engine), 1, "exactly 1 resource is paid");
  assert.equal(attachedCount(b.engine, P1), 1);
  assert.equal(isDepleted(b.engine, b.id("hb")), true, "the Harbinger is depleted");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3 - 1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2, "only life changes");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "only life changes");
  assert.equal(zoneOf(b.engine, b.id("hb")), "play");
});

clause(HARBINGER, "0:ability:demotivate", "only the picked character loses life: my characters, the Harbinger and the opponent's other characters do not", () => {
  const b = harbingerBoard({ extra: [{ key: "foe2", def: character({ name: "Foe2", life: 3 }), owner: P2, zone: "play" }] });
  demotivate(b, "foe");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("foe2"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("hb"), "life"), 1);
});

clause(HARBINGER, "0:ability:demotivate", "it can pick my own character too", () => {
  const b = harbingerBoard();
  demotivate(b, "mine");
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
});

clause(HARBINGER, "0:ability:demotivate", "the life loss lasts this turn only", () => {
  const b = harbingerBoard();
  demotivate(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
  endTurn(b.engine, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3, "restored when the turn ends");
  endTurn(b.engine, P2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
});

clause(HARBINGER, "0:ability:demotivate", "the lost life is real: a character with 2 life and 1 damage that loses 1 life is destroyed", () => {
  const wounded = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hb", def: printing(HARBINGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 2 }), owner: P2, zone: "play" },
      { key: "z1", def: zapTactic("Zap1", 1), owner: P1, zone: "hand" },
      ...res({ rage: 2 })
    ]
  });
  play(wounded.engine, P1, wounded.id("z1"), { selected: { t: [wounded.id("foe")] } });
  assert.equal(zoneOf(wounded.engine, wounded.id("foe")), "play", "control: 1 damage does not kill a 2-life character");
  activate(wounded.engine, P1, wounded.id("hb"), DEMOTIVATE, { selected: { c: [wounded.id("foe")] } });
  assert.equal(zoneOf(wounded.engine, wounded.id("foe")), "discard", "1 damage >= 1 life");
});

clause(HARBINGER, "0:ability:demotivate", "a character that stays above lethal survives: 5 life with 3 damage is at 4 life and 3 damage after the loss, and lives", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hb", def: printing(HARBINGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 5 }), owner: P2, zone: "play" },
      { key: "z3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" },
      ...res({ rage: 2 })
    ]
  });
  play(b.engine, P1, b.id("z3"), { selected: { t: [b.id("foe")] } });
  activate(b.engine, P1, b.id("hb"), DEMOTIVATE, { selected: { c: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "3 damage < 4 life");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 4);
});

clause(HARBINGER, "0:ability:demotivate", "two Harbingers stack: -2 life", () => {
  const b = harbingerBoard({ icons: { rage: 2 }, extra: [{ key: "hb2", def: printing(HARBINGER), owner: P1, zone: "play" }] });
  demotivate(b, "foe");
  demotivate(b, "foe", "hb2");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 1);
});

clause(HARBINGER, "0:ability:demotivate", "a 1-life character that loses 1 life has 0 life and is destroyed (FAQ)", () => {
  const b = harbingerBoard({ extra: [{ key: "frail", def: character({ name: "Frail", life: 1 }), owner: P2, zone: "play" }] });
  demotivate(b, "frail");
  assert.equal(b.engine.getStat(b.id("frail"), "life"), 0);
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "a character with 0 life is destroyed (0 damage >= 0 life)");
});

clause(HARBINGER, "0:ability:demotivate", "picking itself: the 1-life Harbinger drops to 0 life and is destroyed", () => {
  const b = harbingerBoard();
  demotivate(b, "hb");
  assert.equal(zoneOf(b.engine, b.id("hb")), "discard", "0 life: destroyed");
});

clause(HARBINGER, "0:ability:demotivate", "the cost is paid when the ability is used, before the opponent can respond: resource spent and Harbinger depleted, but the life is not lost yet", () => {
  const b = harbingerBoard({ icons: { rage: 2 } });
  demotivateRaw(b, "foe");
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(isDepleted(b.engine, b.id("hb")), true);
  assert.equal(attachedCount(b.engine, P1), 1);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3, "the effect has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
});

clause(HARBINGER, "0:ability:demotivate", "'Pay 1': refused with no resource to pay (and nothing is depleted); accepted with exactly one", () => {
  const none = harbingerBoard({ icons: {} });
  refused(() => demotivateRaw(none, "foe"), "no resources");
  assert.equal(isDepleted(none.engine, none.id("hb")), false, "not depleted by the failed attempt");
  assert.equal(none.engine.getStat(none.id("foe"), "life"), 3);
  const one = harbingerBoard({ icons: { deception: 1 } });
  demotivate(one, "foe");
  assert.equal(one.engine.getStat(one.id("foe"), "life"), 2);
  assert.equal(ready(one.engine), 0);
});

clause(HARBINGER, "0:ability:demotivate", "'Pay 1' needs an UNSPENT resource: a resource already attached to my faction cannot pay", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "hb", def: printing(HARBINGER), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", life: 3 }), owner: P2, zone: "play" },
      ...bank("rage", 1, P1).map((p) => ({ ...p, attachedToKey: "__factionA" }))
    ]
  });
  assert.equal(ready(b.engine), 0, "control: the only resource is spent");
  refused(() => activateRaw(b.engine, P1, b.id("hb"), DEMOTIVATE, { c: [b.id("foe")] }), "no available resource");
});

clause(HARBINGER, "0:ability:demotivate", "'Deplete this card': a depleted Harbinger cannot use it; nothing is paid", () => {
  const b = harbingerBoard({ depleted: true });
  refused(() => demotivateRaw(b, "foe"), "already depleted");
  assert.equal(ready(b.engine), 2, "no resource was spent");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
});

clause(HARBINGER, "0:ability:demotivate", "once restored at the start of my next turn it can be used again", () => {
  const b = harbingerBoard({ icons: { rage: 3 } });
  demotivate(b, "foe");
  refused(() => demotivateRaw(b, "foe"), "depleted now");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(isDepleted(b.engine, b.id("hb")), false);
  demotivate(b, "foe");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
});

clause(HARBINGER, "0:ability:demotivate", "the pick must be a character in play: an item, a location, a faction, a face-down card, a card in hand / discard, none or two are refused", () => {
  const b = harbingerBoard();
  const attempt = (picked: CardInstanceId[]) => () => activateRaw(b.engine, P1, b.id("hb"), DEMOTIVATE, { c: picked });
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("inHand")]), "a character in my hand");
  refused(attempt([b.id("inDiscard")]), "a character in my discard pile");
  refused(attempt([]), "no pick");
  refused(attempt([b.id("mine"), b.id("foe")]), "two characters");
  assert.equal(isDepleted(b.engine, b.id("hb")), false, "none of those attempts paid anything");
  assert.equal(ready(b.engine), 2);
  attempt([b.id("foe")])();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(HARBINGER, "0:ability:demotivate", "if the picked character is destroyed in response, the cost stays paid and nothing breaks", () => {
  const b = harbingerBoard({ extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  demotivateRaw(b, "foe");
  respondWith(b.engine, P2, b.id("kill"), { t: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(isDepleted(b.engine, b.id("hb")), true);
  assert.equal(attachedCount(b.engine, P1), 1);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(HARBINGER, "0:ability:demotivate", "it works in response on the opponent's turn too", () => {
  const b = harbingerBoard({ turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => demotivateRaw(b, "foe"), "nothing to respond to");
  playRaw(b.engine, P2, b.id("nothing"));
  demotivateRaw(b, "foe");
  resolvePendingResponses(b.engine);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 2);
});

clause(HARBINGER, "0:ability:demotivate", "only the Harbinger's controller can use it, and only while it is in play", () => {
  const theirs = harbingerBoard({ turn: 2, active: P2, icons: { rage: 2 } });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("hb"), DEMOTIVATE, { c: [theirs.id("mine")] }), "the opponent cannot use my Harbinger");
  const inHand = harbingerBoard({ zone: "hand" });
  refused(() => demotivateRaw(inHand, "foe"), "in my hand");
  assert.equal(inHand.engine.getStat(inHand.id("foe"), "life"), 3);
});

// ==================================================================================
// Headhunting
// COST: Play this only in response to a character with numeric cost X or less being played, where X is number of [D]
// you control. -- EFFECT: The character enters play under your control.
// Tactic, rogue, cost 5, threshold [D].
// ==================================================================================

const HEADHUNTING = "5275654c-1664-4342-811f-848e80019d9f";

/** A character with an enters-play draw, used to see WHO controls it when it enters play. */
const drawOnEnter = (cost: number): CardDefinition =>
  character({
    name: `Target (cost ${cost})`,
    cost,
    strength: 2,
    life: 3,
    speed: 2,
    behavior: {
      abilities: [{ id: "etb", type: "triggered", event: "cardEnteredPlay", condition: { type: "sourceIsEventCard" }, effects: [{ type: "draw", player: "controller", amount: 1 }] }]
    }
  });

/**
 * P2's turn 2. P1 holds Headhunting with `d` [D] and `other` other resources; P2 holds a character (key "target") of
 * printed cost `targetCost` and enough resources to deploy it.
 */
function huntBoard(
  opts: { d?: number; other?: number; faceDown?: number; targetCost?: number; oppD?: number; extra?: CardPlacement[]; turn?: number; active?: PlayerId } = {}
) {
  const targetCost = opts.targetCost ?? 2;
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "hh", def: printing(HEADHUNTING), owner: P1, zone: "hand" },
      { key: "target", def: drawOnEnter(targetCost), owner: P2, zone: "hand" },
      ...res({ deception: opts.d ?? 5, rage: opts.other ?? 0 }),
      ...volition(opts.faceDown ?? 0, P1),
      ...res({ rage: targetCost + 2, deception: opts.oppD ?? 0 }, P2),
      ...deckCards("a", 3, P1),
      ...deckCards("b", 3, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type HuntGame = ReturnType<typeof huntBoard>;
/** P2 plays the character; P1 now holds priority. */
const opponentDeploys = (b: HuntGame, key = "target") => {
  playRaw(b.engine, P2, b.id(key));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
};
const huntRaw = (b: HuntGame) => playRaw(b.engine, P1, b.id("hh"));


clause(HEADHUNTING, "0:ability", "in response to a character with numeric cost exactly X (X = my [D]): it is played, pays 5, and the character enters play under MY control", () => {
  const b = huntBoard({ d: 5, targetCost: 5 });
  opponentDeploys(b);
  const before = ready(b.engine);
  huntRaw(b);
  assert.equal(before - ready(b.engine), 5, "the printed cost of 5 is paid");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("target")), "play");
  assert.equal(controllerOf(b.engine, b.id("target")), P1, "under my control");
  assert.equal(b.engine.state.cards[b.id("target")].ownerId, P2, "still owned by the opponent");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("target")), "in my play area");
  assert.equal(b.engine.state.players[P2].play.includes(b.id("target")), false, "not in theirs");
  assert.equal(zoneOf(b.engine, b.id("hh")), "discard", "the tactic ends in its owner's discard pile");
});

clause(HEADHUNTING, "0:ability", "numeric cost X OR LESS: with 5 [D], characters of cost 0, 1 and 4 can be taken too", () => {
  for (const cost of [0, 1, 4]) {
    const b = huntBoard({ d: 5, targetCost: cost });
    opponentDeploys(b);
    huntRaw(b);
    resolvePendingResponses(b.engine);
    assert.equal(controllerOf(b.engine, b.id("target")), P1, `cost ${cost} <= 5`);
  }
});

clause(HEADHUNTING, "0:ability", "a character with numeric cost MORE than X cannot be taken: cost 6 against 5 [D] is refused", () => {
  const b = huntBoard({ d: 5, targetCost: 6 });
  opponentDeploys(b);
  refused(() => huntRaw(b), "cost 6 > X = 5", /cannot be deployed right now/);
  assert.equal(zoneOf(b.engine, b.id("hh")), "hand");
  assert.equal(ready(b.engine), 5, "nothing was paid");
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("target")), P2, "the character entered play for its player as usual");
});

clause(HEADHUNTING, "0:ability", "X is the number of [D] I control: with only 1 [D] (and 4 other resources) cost 1 can be taken, cost 2 cannot", () => {
  const ok = huntBoard({ d: 1, other: 4, targetCost: 1 });
  opponentDeploys(ok);
  huntRaw(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(controllerOf(ok.engine, ok.id("target")), P1, "cost 1 <= X = 1");
  const no = huntBoard({ d: 1, other: 4, targetCost: 2 });
  opponentDeploys(no);
  refused(() => huntRaw(no), "cost 2 > X = 1", /cannot be deployed right now/);
  assert.equal(zoneOf(no.engine, no.id("hh")), "hand");
});

clause(HEADHUNTING, "0:ability", "a character of cost 0 can be taken with just 1 [D]", () => {
  const b = huntBoard({ d: 1, other: 4, targetCost: 0 });
  opponentDeploys(b);
  huntRaw(b);
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("target")), P1);
});

clause(HEADHUNTING, "0:ability", "X counts every [D] I control, including resources spent on this very card: with 7 [D] (5 spent), cost 7 can be taken and cost 8 cannot", () => {
  const ok = huntBoard({ d: 7, targetCost: 7 });
  opponentDeploys(ok);
  huntRaw(ok);
  resolvePendingResponses(ok.engine);
  assert.equal(controllerOf(ok.engine, ok.id("target")), P1, "cost 7 <= X = 7");
  const no = huntBoard({ d: 7, targetCost: 8 });
  opponentDeploys(no);
  refused(() => huntRaw(no), "cost 8 > X = 7", /cannot be deployed right now/);
});

clause(HEADHUNTING, "0:ability", "only [D] count for X: other resources and face-down cards (Volition) do not, nor do the opponent's [D]", () => {
  const rage = huntBoard({ d: 1, other: 6, targetCost: 3 });
  opponentDeploys(rage);
  refused(() => huntRaw(rage), "six Rage are not [D]: X = 1", /cannot be deployed right now/);
  const down = huntBoard({ d: 1, other: 0, faceDown: 5, targetCost: 3 });
  opponentDeploys(down);
  refused(() => huntRaw(down), "face-down cards provide Volition: X = 1", /cannot be deployed right now/);
  const theirs = huntBoard({ d: 1, other: 4, oppD: 6, targetCost: 3 });
  opponentDeploys(theirs);
  refused(() => huntRaw(theirs), "the opponent's [D] are not mine: X = 1", /cannot be deployed right now/);
  assert.equal(zoneOf(theirs.engine, theirs.id("hh")), "hand");
});

clause(HEADHUNTING, "0:ability", "its own threshold [D] and cost 5: refused with no [D] (X would be 0, however much other resources), and one resource short of 5", () => {
  const noD = huntBoard({ d: 0, other: 6, targetCost: 0 });
  opponentDeploys(noD);
  refused(() => huntRaw(noD), "no [D] at all");
  const short = huntBoard({ d: 4, targetCost: 1 });
  opponentDeploys(short);
  refused(() => huntRaw(short), "only 4 resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("hh")), "hand");
  assert.equal(ready(short.engine), 4, "nothing was paid");
  const exact = huntBoard({ d: 1, other: 4, targetCost: 1 });
  opponentDeploys(exact);
  huntRaw(exact);
  assert.equal(ready(exact.engine), 0, "control: [D] plus 4 others pays exactly 5");
});

clause(HEADHUNTING, "0:ability", "'in response to a CHARACTER being played': an item, a location or a tactic being played cannot be taken", () => {
  const shapes: Array<[string, CardDefinition]> = [
    ["an item", item({ name: "TheirItem", cost: 0 })],
    ["a location", location({ name: "TheirLocation", cost: 0 })],
    ["a tactic", tactic({ name: "TheirTactic", cost: 0, behavior: { abilities: [{ id: "n", type: "activated", effects: [] }] } })]
  ];
  for (const [what, def] of shapes) {
    const b = huntBoard({ d: 5, extra: [{ key: "other", def, owner: P2, zone: "hand" }] });
    playRaw(b.engine, P2, b.id("other"));
    assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, `control: I may respond to ${what}`);
    refused(() => huntRaw(b), `${what} is not a character`, /cannot be deployed right now/);
    assert.equal(zoneOf(b.engine, b.id("hh")), "hand", what);
  }
  const ctl = huntBoard({ d: 5 });
  opponentDeploys(ctl);
  huntRaw(ctl);
  assert.ok(ctl.engine.state.responseWindow, "control: a character is accepted");
});

clause(HEADHUNTING, "0:ability", "an ABILITY being used is not a character being played", () => {
  const abilityChar = character({
    name: "Zapper",
    behavior: { abilities: [{ id: "poke", name: "Poke", type: "activated", costs: [], effects: [] }] }
  });
  const b = huntBoard({ d: 5, extra: [{ key: "zapper", def: abilityChar, owner: P2, zone: "play" }] });
  activateRaw(b.engine, P2, b.id("zapper"), "poke");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  refused(() => huntRaw(b), "no character is being played", /cannot be deployed right now/);
});

clause(HEADHUNTING, "0:ability", "'play this only in response': refused with nothing to respond to, on my own turn, and when I am the one playing the character", () => {
  const quiet = huntBoard({ d: 5 });
  refused(() => huntRaw(quiet), "no window on the opponent's turn");
  assert.equal(zoneOf(quiet.engine, quiet.id("hh")), "hand");
  const mine = huntBoard({ d: 5, turn: 1, active: P1, extra: [{ key: "mine", def: character({ name: "MyChar", cost: 1 }), owner: P1, zone: "hand" }] });
  refused(() => huntRaw(mine), "my own turn, nothing to respond to");
  playRaw(mine.engine, P1, mine.id("mine"));
  assert.equal(mine.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent holds priority over my own card");
  refused(() => huntRaw(mine), "I cannot respond to my own character", /priority/);
});

clause(HEADHUNTING, "0:ability", "the taken character's enters-play trigger fires for ME (I draw, the opponent does not)", () => {
  const b = huntBoard({ d: 5, targetCost: 2 });
  const myHand = handOf(b.engine, P1).length;
  const theirHand = handOf(b.engine, P2).length;
  opponentDeploys(b);
  huntRaw(b);
  resolvePendingResponses(b.engine);
  settle(b.engine);
  assert.equal(handOf(b.engine, P1).length, myHand - 1 + 1, "Headhunting left my hand, the trigger drew me one card");
  assert.equal(handOf(b.engine, P2).length, theirHand - 1, "their character left their hand; they drew nothing");
});

clause(HEADHUNTING, "0:ability", "the opponent keeps paying for the character they played (their resources stay spent) and does not get it, or a second copy", () => {
  const b = huntBoard({ d: 5, targetCost: 2 });
  const theirReady = ready(b.engine, P2);
  opponentDeploys(b);
  assert.equal(theirReady - ready(b.engine, P2), 2, "control: they paid 2 for it");
  huntRaw(b);
  resolvePendingResponses(b.engine);
  assert.equal(theirReady - ready(b.engine, P2), 2, "they stay paid");
  const copies = Object.values(b.engine.state.cards).filter((card) => card.id === b.id("target") && card.zone === "play");
  assert.equal(copies.length, 1);
  assert.equal(b.engine.state.responseWindow, undefined, "the response chain finished");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(HEADHUNTING, "0:ability", "the taken character is a real character of mine: after the turn passes it has been in play since the start of my turn and can attack", () => {
  const b = huntBoard({ d: 5, targetCost: 2 });
  opponentDeploys(b);
  huntRaw(b);
  resolvePendingResponses(b.engine);
  settle(b.engine);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  const influence = b.engine.state.players[P2].influence;
  fight(b.engine, P1, [b.id("target")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - b.engine.state.players[P2].influence, 2, "it hit for its printed 2 strength");
});

clause(HEADHUNTING, "0:ability", "the opponent can respond to Headhunting: if it is terminated, the character enters play for its player as usual", () => {
  const b = huntBoard({ d: 5, targetCost: 2, extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  opponentDeploys(b);
  huntRaw(b);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond to my response");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("hh")] });
  settle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("hh")), "discard", "terminated");
  assert.equal(zoneOf(b.engine, b.id("target")), "play");
  assert.equal(controllerOf(b.engine, b.id("target")), P2, "their character resolved normally");
});

// E7b: the numeric cost of a card that is being played is its running total (CR 406.3, Q9), so a printed cost-4 character
// the opponent got a discount of 2 on has numeric cost 2 while it is played and is within reach of 3 [D]. (The first
// version of this test asserted the printed number, 4, and refused.)
clause(HEADHUNTING, "0:ability", "'numeric cost' is the one while being deployed (CR 406.3): a printed cost-4 character the opponent paid 2 for with a discount is within reach of 3 [D]; without the discount it is refused", () => {
  const discount = tactic({
    name: "Discount",
    cost: 0,
    behavior: { abilities: [{ id: "disc", type: "activated", effects: [{ type: "reduceNextCost", player: "controller", amount: 2 }] }] }
  });
  const b = huntBoard({ d: 3, other: 2, targetCost: 4, extra: [{ key: "discount", def: discount, owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("discount"));
  playRaw(b.engine, P2, b.id("target"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  huntRaw(b);
  assert.notEqual(zoneOf(b.engine, b.id("hh")), "hand", "numeric cost 4 - 2 = 2 <= X = 3: Headhunting was played");
  const full = huntBoard({ d: 3, other: 2, targetCost: 4 });
  playRaw(full.engine, P2, full.id("target"));
  refused(() => huntRaw(full), "numeric cost 4 > X = 3", /cannot be deployed right now/);
  assert.equal(zoneOf(full.engine, full.id("hh")), "hand");
});

// ==================================================================================
// Heist Training Grounds
// UNIQUE HEIST TRAINING GROUNDS
// [D][D][D]: At the start of your turn, you may pick a character. If you do, it gains COVERT this turn.
// [D]x5: At the start of your turn, you may search your opponent's deck for a card. If you do, put it into their discard pile.
// [D]x7: At the start of your turn, your opponent discards a card at random.
// Location, rogue, cost 3, threshold [D], structure 5.
// ==================================================================================

const HEIST = "8791105b-7df3-4998-aa65-ab966d007869";

function heistBoard(
  opts: {
    d?: number;
    other?: number;
    faceDown?: number;
    oppD?: number;
    heist?: "play" | "hand" | "faceDown";
    startAs?: PlayerId;
    oppHand?: number;
    oppDeck?: TypeName[];
    random?: () => number;
    extra?: CardPlacement[];
    heistOwner?: PlayerId;
  } = {}
) {
  const startAs = opts.startAs ?? P1;
  const where = opts.heist ?? "play";
  const heistOwner = opts.heistOwner ?? P1;
  return buildGame({
    turn: 2,
    activePlayerId: other(startAs),
    random: opts.random,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "htg", def: printing(HEIST), owner: heistOwner, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      ...res({ deception: opts.d ?? 0, rage: opts.other ?? 0 }, heistOwner),
      ...volition(opts.faceDown ?? 0, heistOwner),
      ...res({ deception: opts.oppD ?? 0 }, other(heistOwner)),
      ...fillers("mh", 2, P1, "hand"),
      ...fillers("oh", opts.oppHand ?? 3, P2, "hand"),
      { key: "od", def: character({ name: "OppDiscarded" }), owner: P2, zone: "discard" },
      ...deckCards("a", 3, P1),
      ...typedDeck("b", opts.oppDeck ?? OPP_DECK_TYPES, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type HeistGame = ReturnType<typeof heistBoard>;

interface HeistPolicy {
  /** Character the controller picks for the COVERT paragraph (default: none). */
  cover?: string;
  /** Card (key) the controller takes from the opponent's deck for the search paragraph (default: none). */
  search?: string;
  /** Candidate answered if the engine asks the controller to choose the discard (it should not). */
  discard?: string;
}

/** Ends the other player's turn so `player`'s turn starts and answers every prompt per `policy`; returns what was asked as "<kind>:<declaration id>". */
function heistTurn(b: HeistGame, policy: HeistPolicy = {}, player: PlayerId = P1): string[] {
  endTurn(b.engine, other(player));
  assert.equal(b.engine.state.activePlayerId, player, "the turn has changed hands");
  const asked: string[] = [];
  drain(b.engine, (pc) => {
    if (pc.kind === "orderTriggers") {
      asked.push("orderTriggers");
      return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    }
    if (pc.kind === "chooserSelectsTarget") {
      const declId = (pc.declaration as { id: string }).id;
      asked.push(`pick:${declId}`);
      const key = declId === "c" ? policy.cover : declId === "__so" ? policy.search : policy.discard;
      // no card chosen for the "may search" (__so) = the player declines to search (Q2)
      return { kind: "chooserSelectsTarget", selected: key ? [b.id(key)] : [], ...(declId === "__so" && !key ? { declined: true } : {}) };
    }
    return declineAll(pc);
  });
  return asked;
}

/** After the turn change, answers trigger-order prompts and declines the COVERT pick until the pick with declaration `declId` is open; returns it. */
function advanceToPick(b: HeistGame, declId: string): PendingChoiceLike {
  for (let guard = 0; guard < 8; guard++) {
    const pc = pending(b.engine);
    assert.ok(pc, `the '${declId}' prompt never opened`);
    if (pc.kind === "orderTriggers") {
      answerPending(b.engine, "orderTriggers", { next: (pc.triggers as unknown[])[0] });
      continue;
    }
    assert.equal(pc.kind, "chooserSelectsTarget");
    const decl = (pc.declaration as { id: string }).id;
    if (decl === declId) return pc;
    answerPending(b.engine, "chooserSelectsTarget", { selected: [] });
  }
  throw new Error(`the '${declId}' prompt never opened`);
}

const HEIST_SPEC: DeploySpec = { id: HEIST, cost: 3, icon: "deception", count: 1 };

// -- 0:unique --------------------------------------------------------------------

clause(HEIST, "0:unique", "deploys for exactly 3 with [D] as a location with 5 structure; refused one resource short and without [D]", () => {
  deploysForExactlyItsCost(HEIST_SPEC);
  refusedOneShort(HEIST_SPEC);
  refusedWithoutThreshold(HEIST_SPEC);
  thresholdIsGateNotCost(HEIST_SPEC);
  const b = heistBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("htg")), ["location"]);
});

clause(HEIST, "0:unique", "its structure is 5: an attack of 4 leaves it standing, an attack of 5 destroys it", () => {
  const strike = (strength: number) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "htg", def: printing(HEIST), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength, life: 5, speed: 2 }), owner: P2, zone: "play" }
      ]
    });
    fight(b.engine, P2, [b.id("atk")], { type: "card", cardId: b.id("htg") }, []);
    return b;
  };
  const four = strike(4);
  assert.equal(zoneOf(four.engine, four.id("htg")), "play");
  assert.equal(four.engine.state.cards[four.id("htg")].damage, 4);
  const five = strike(5);
  assert.equal(zoneOf(five.engine, five.id("htg")), "discard");
});

function twoHeists(second: "hand" | "oppPlay" | "oppHand" = "hand") {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: second === "oppHand" ? 2 : 1,
    activePlayerId: second === "oppHand" ? P2 : P1,
    cards: [
      { key: "htg", def: printing(HEIST), owner: P1, zone: "play" },
      ...(second === "hand" ? [{ key: "htg2", def: printing(HEIST), owner: P1, zone: "hand" as const }] : []),
      ...(second === "oppPlay" ? [{ key: "oppHtg", def: printing(HEIST), owner: P2, zone: "play" as const }] : []),
      ...(second === "oppHand" ? [{ key: "oppHtg", def: printing(HEIST), owner: P2, zone: "hand" as const }] : []),
      ...res({ deception: 3 }, P1),
      ...res({ deception: 3 }, P2)
    ]
  });
}

clause(HEIST, "0:unique", "deploying a second copy while I control one forces ME to choose which to keep: keeping the new one destroys the old one", () => {
  const { engine, id } = twoHeists();
  play(engine, P1, id("htg2"));
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("htg"), id("htg2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("htg2") });
  assert.equal(zoneOf(engine, id("htg2")), "play");
  assert.equal(zoneOf(engine, id("htg")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
});

clause(HEIST, "0:unique", "keeping the old copy destroys the new one", () => {
  const { engine, id } = twoHeists();
  play(engine, P1, id("htg2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("htg") });
  assert.equal(zoneOf(engine, id("htg")), "play");
  assert.equal(zoneOf(engine, id("htg2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(HEIST, "0:unique", "after the choice the game goes on normally (the turn can be ended)", () => {
  const { engine, id } = twoHeists();
  play(engine, P1, id("htg2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("htg2") });
  endTurn(engine, P1);
  assert.equal(engine.state.activePlayerId, P2, "the turn passed");
});

clause(HEIST, "0:unique", "UNIQUE only concerns MY cards: my opponent may have their own copy in play, or deploy one while I control mine, with no choice", () => {
  const inPlay = twoHeists("oppPlay");
  assert.equal(inPlay.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(inPlay.engine, inPlay.id("htg")), "play");
  assert.equal(zoneOf(inPlay.engine, inPlay.id("oppHtg")), "play");
  const deploy = twoHeists("oppHand");
  play(deploy.engine, P2, deploy.id("oppHtg"));
  assert.equal(deploy.engine.state.pendingChoice, undefined, "no unique prompt for the opponent");
  assert.equal(zoneOf(deploy.engine, deploy.id("oppHtg")), "play");
  assert.equal(zoneOf(deploy.engine, deploy.id("htg")), "play");
});

clause(HEIST, "0:unique", "taking control of the opponent's copy while I control one forces a choice", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", owner: "opponent", type: "location" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "htg", def: printing(HEIST), owner: P1, zone: "play" },
      { key: "oppHtg", def: printing(HEIST), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("oppHtg")] } });
  const pc = pending(engine);
  assert.ok(pc, "now I control two copies");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
});

clause(HEIST, "0:unique", "the designation is what counts: another location with the same UNIQUE designation conflicts, one with a different designation does not", () => {
  const same = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "htg", def: printing(HEIST), owner: P1, zone: "play" },
      { key: "same", def: location({ name: "Totally Different Name", unique: "heist training grounds" }), owner: P1, zone: "hand" }
    ]
  });
  play(same.engine, P1, same.id("same"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor", "same designation: a choice");
  const different = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "htg", def: printing(HEIST), owner: P1, zone: "play" },
      { key: "diff", def: location({ name: "Another Place", unique: "something else" }), owner: P1, zone: "hand" }
    ]
  });
  play(different.engine, P1, different.id("diff"));
  assert.equal(different.engine.state.pendingChoice, undefined, "different designation: no choice");
});

// -- 1:rule@ddd — COVERT ---------------------------------------------------------

clause(HEIST, "1:rule@ddd", "with [D][D][D] at the start of my turn I am asked to pick a character, and the picked one gains COVERT", () => {
  const b = heistBoard({ d: 3 });
  const asked = heistTurn(b, { cover: "mine" });
  assert.deepEqual(asked, ["pick:c"], "exactly one prompt: the character pick");
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "the picked character is covert");
  assert.equal(hasKeyword(b.engine, b.id("mine2"), "covert"), false, "another of my characters is not");
  assert.equal(hasKeyword(b.engine, b.id("foe"), "covert"), false, "an opponent's character is not");
});

clause(HEIST, "1:rule@ddd", "any character can be picked: an opponent's character gains COVERT too", () => {
  const b = heistBoard({ d: 3 });
  heistTurn(b, { cover: "foe" });
  assert.ok(hasKeyword(b.engine, b.id("foe"), "covert"), "hasKeyword(b.engine, b.id(\"foe\"), \"covert\")");
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
});

clause(HEIST, "1:rule@ddd", "'you MAY pick': declining picks nothing and nobody gains COVERT", () => {
  const b = heistBoard({ d: 3 });
  const asked = heistTurn(b, {});
  assert.deepEqual(asked, ["pick:c"]);
  for (const key of ["mine", "mine2", "foe"]) assert.equal(hasKeyword(b.engine, b.id(key), "covert"), false, key);
});

clause(HEIST, "1:rule@ddd", "the pick must be a character in play: an item, a location, a faction, a face-down card, a card in hand or two characters are refused", () => {
  const b = heistBoard({ d: 3 });
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the pick is open");
  const attempt = (selected: CardInstanceId[]) => tryPick(b.engine, selected);
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("mh0")]), "a card in my hand");
  refused(attempt([b.id("od")]), "a card in a discard pile");
  refused(attempt([b.id("mine"), b.id("mine2")]), "two characters");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(b.engine, P1, [b.id("mine")]);
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "control: a character is accepted");
});

clause(HEIST, "1:rule@ddd", "COVERT lasts this turn only: it is gone when my turn ends", () => {
  const b = heistBoard({ d: 3 });
  heistTurn(b, { cover: "mine" });
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "during my turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false, "gone at the end of the turn");
});

clause(HEIST, "1:rule@ddd", "COVERT is real: the picked character attacking alone cannot be blocked by a non-covert character this turn", () => {
  const b = heistBoard({ d: 3 });
  heistTurn(b, { cover: "mine" });
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  refused(() => b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] }), "a non-covert character cannot block a covert party");
});

clause(HEIST, "1:rule@ddd", "without the pick the same attacker can be blocked normally (control)", () => {
  const b = heistBoard({ d: 3 });
  heistTurn(b, {});
  declareAttackBy(b.engine, P1, [b.id("mine")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("foe")] });
  assert.deepEqual(battleOf(b.engine)?.blockingParty, [b.id("foe")]);
});

clause(HEIST, "1:rule@ddd", "threshold-gated: with only [D][D] (however many other resources, face-down cards or opposing [D]) the paragraph is off: no prompt", () => {
  const two = heistBoard({ d: 2, other: 6, faceDown: 4, oppD: 6 });
  assert.deepEqual(heistTurn(two, { cover: "mine" }), [], "no prompt");
  assert.equal(hasKeyword(two.engine, two.id("mine"), "covert"), false);
});

clause(HEIST, "1:rule@ddd", "threshold-gated: [D][D][D] plus other resources is enough, and the paragraph turns off again when a [D] is gone", () => {
  const three = heistBoard({ d: 3, other: 3 });
  assert.deepEqual(heistTurn(three, { cover: "mine" }), ["pick:c"]);
  const lost = heistBoard({ d: 3, extra: [{ key: "kill", def: killAnyTactic("resource"), owner: P2, zone: "hand" }] });
  const myResources = lost.engine.state.players[P1].play.filter((cardId) => lost.engine.isResource(cardId));
  assert.equal(myResources.length, 3, "control: three [D]");
  play(lost.engine, P2, lost.id("kill"), { selected: { t: [myResources[0]] } });
  assert.equal(lost.engine.state.players[P1].play.filter((cardId) => lost.engine.isResource(cardId)).length, 2, "one [D] is gone");
  assert.deepEqual(heistTurn(lost, { cover: "mine" }), [], "only two [D] left: the paragraph is off");
  assert.equal(hasKeyword(lost.engine, lost.id("mine"), "covert"), false);
});

clause(HEIST, "1:rule@ddd", "it fires only at the start of MY turn: when the opponent's turn starts nothing is asked", () => {
  const b = heistBoard({ d: 3, startAs: P2 });
  assert.deepEqual(heistTurn(b, { cover: "mine" }, P2), []);
  assert.equal(hasKeyword(b.engine, b.id("mine"), "covert"), false);
});

clause(HEIST, "1:rule@ddd", "it does nothing while the Heist Training Grounds is in my hand or face-down as a resource", () => {
  const inHand = heistBoard({ d: 3, heist: "hand" });
  assert.deepEqual(heistTurn(inHand, { cover: "mine" }), []);
  const faceDown = heistBoard({ d: 3, heist: "faceDown" });
  assert.deepEqual(heistTurn(faceDown, { cover: "mine" }), []);
});

// -- 2:rule@ddddd — search the opponent's deck ------------------------------------

clause(HEIST, "2:rule@ddddd", "with [D]x5 at the start of my turn I am asked to search the opponent's deck; the card I take goes into THEIR discard pile", () => {
  for (let index = 0; index < OPP_DECK_TYPES.length; index++) {
    const b = heistBoard({ d: 5 });
    const pick = deckOf(b.engine, P2)[index];
    const mineBefore = [...deckOf(b.engine, P1)];
    endTurn(b.engine, P2);
    const pc = advanceToPick(b, "__so");
    assert.equal(pc.playerId, P1, "I search");
    answerPending(b.engine, "chooserSelectsTarget", { selected: [pick] });
    settle(b.engine);
    assert.equal(zoneOf(b.engine, pick), "discard", `deck card #${index} was put into a discard pile`);
    assert.ok(discardOf(b.engine, P2).includes(pick), "their discard pile");
    assert.equal(discardOf(b.engine, P1).includes(pick), false);
    assert.equal(deckOf(b.engine, P2).length, OPP_DECK_TYPES.length - 1);
    assert.deepEqual(deckOf(b.engine, P1), mineBefore, "my deck is untouched");
  }
});

clause(HEIST, "2:rule@ddddd", "'you MAY search ... If you do': declining takes no card and puts nothing into the discard pile", () => {
  const b = heistBoard({ d: 5 });
  const oppDeck = [...deckOf(b.engine, P2)];
  const oppDiscard = [...discardOf(b.engine, P2)];
  const asked = heistTurn(b, {});
  assert.deepEqual(asked.filter((entry) => entry !== "orderTriggers"), ["pick:c", "pick:__so"], "the COVERT paragraph (also active with [D]x5) and the search are offered");
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...oppDeck].sort(), "the same cards are still in the deck");
  assert.deepEqual(discardOf(b.engine, P2), oppDiscard);
});

clause(HEIST, "2:rule@ddddd", "'If you do': when I decline to search, the opponent's deck is not shuffled (nothing was searched, CR 312.1)", () => {
  const b = heistBoard({ d: 5, random: () => 0 });
  const oppDeck = [...deckOf(b.engine, P2)];
  heistTurn(b, {});
  assert.deepEqual(deckOf(b.engine, P2), oppDeck, "nothing was searched, so the deck keeps its order");
});

clause(HEIST, "2:rule@ddddd", "a deck that WAS searched is shuffled afterwards (CR 312.1): the same remaining cards in a new order", () => {
  const b = heistBoard({ d: 5, random: () => 0 });
  const taken = deckOf(b.engine, P2)[1];
  const unshuffled = deckOf(b.engine, P2).filter((cardId) => cardId !== taken);
  heistTurn(b, { search: "b1" });
  assert.equal(zoneOf(b.engine, taken), "discard");
  assert.deepEqual([...deckOf(b.engine, P2)].sort(), [...unshuffled].sort(), "the same cards remain");
  assert.deepEqual(deckOf(b.engine, P2), shuffledWithConstant(unshuffled, 0), "and they were shuffled");
});

clause(HEIST, "2:rule@ddddd", "only the opponent's DECK can be searched: my deck, either hand, either discard pile and the board are refused; exactly one card", () => {
  const b = heistBoard({ d: 5 });
  endTurn(b.engine, P2);
  advanceToPick(b, "__so");
  const attempts: Array<[string, CardInstanceId[]]> = [
    ["a card in my own deck", [deckOf(b.engine, P1)[0]]],
    ["a card in the opponent's hand", [b.id("oh0")]],
    ["a card in the opponent's discard pile", [b.id("od")]],
    ["a card in my hand", [b.id("mh0")]],
    ["a character in play", [b.id("foe")]],
    ["two cards", [deckOf(b.engine, P2)[0], deckOf(b.engine, P2)[1]]]
  ];
  for (const [why, cards] of attempts) refused(tryPick(b.engine, cards), why);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  const legal = deckOf(b.engine, P2)[3];
  pickCards(b.engine, P1, [legal]);
  assert.equal(zoneOf(b.engine, legal), "discard", "control: a card in their deck is accepted");
});

clause(HEIST, "2:rule@ddddd", "threshold-gated: [D]x4 (however many other resources / face-down cards / opposing [D]) is not enough: no search prompt", () => {
  const four = heistBoard({ d: 4, other: 5, faceDown: 4, oppD: 6 });
  const asked = heistTurn(four, { search: "b0" });
  assert.equal(asked.includes("pick:__so"), false, "no search");
  assert.equal(discardOf(four.engine, P2).length, 1, "only the card that was already there");
});

clause(HEIST, "2:rule@ddddd", "threshold-gated: [D]x5 plus other resources is enough; the lower [D][D][D] paragraph is on too (with [D]x5 both fire)", () => {
  const b = heistBoard({ d: 5, other: 2 });
  const asked = heistTurn(b, { cover: "mine", search: "b0" });
  assert.ok(asked.includes("pick:__so"), "the search is offered");
  assert.ok(asked.includes("pick:c"), "the COVERT pick is offered too: both paragraphs are active");
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "hasKeyword(b.engine, b.id(\"mine\"), \"covert\")");
  assert.equal(zoneOf(b.engine, b.id("b0")), "discard");
});

clause(HEIST, "2:rule@ddddd", "with an empty opponent's deck there is nothing to take: no card moves and nothing breaks", () => {
  const b = heistBoard({ d: 5, oppDeck: [] });
  const oppDiscard = [...discardOf(b.engine, P2)];
  heistTurn(b, {});
  assert.deepEqual(discardOf(b.engine, P2), oppDiscard);
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(b.engine.state.winner, undefined);
});

clause(HEIST, "2:rule@ddddd", "it fires only at the start of MY turn, and only while the Heist Training Grounds is in play", () => {
  const theirTurn = heistBoard({ d: 5, startAs: P2 });
  assert.deepEqual(heistTurn(theirTurn, { search: "b0" }, P2), []);
  assert.equal(deckOf(theirTurn.engine, P2).length, OPP_DECK_TYPES.length);
  const inHand = heistBoard({ d: 5, heist: "hand" });
  assert.deepEqual(heistTurn(inHand, { search: "b0" }), []);
  assert.equal(deckOf(inHand.engine, P2).length, OPP_DECK_TYPES.length);
});

// -- 3:rule@ddddddd — random discard -----------------------------------------------

/** Plays P1's turn start with [D]x7 and a fixed random source; returns the opponent card that was discarded from their hand (or undefined). */
function randomDiscardRun(r: number, oppHand = 3) {
  const b = heistBoard({ d: 7, random: () => r, oppHand });
  const hand = [...handOf(b.engine, P2)];
  const asked = heistTurn(b, { discard: "oh0" });
  const gone = hand.filter((cardId) => zoneOf(b.engine, cardId) === "discard");
  return { b, hand, asked, gone };
}

clause(HEIST, "3:rule@ddddddd", "'discards a card at random': I (the controller) am not asked to choose it; the engine picks at random with no prompt", () => {
  const b = heistBoard({ d: 7, random: () => 0.5 });
  const asked = heistTurn(b, { discard: "oh0" });
  assert.equal(asked.includes("pick:__od"), false, "I was asked to pick the card the opponent discards: it should be random, not my choice");
  assert.equal(handOf(b.engine, P2).length, 2, "the opponent discarded exactly one card");
});

clause(HEIST, "3:rule@ddddddd", "the discard is random over the opponent's WHOLE hand: different random values can discard the first and the last card (and the middle one)", () => {
  const first = randomDiscardRun(0);
  const middle = randomDiscardRun(0.5);
  const last = randomDiscardRun(0.999);
  for (const run of [first, middle, last]) assert.equal(run.gone.length, 1, "exactly one card of their hand is discarded");
  const discarded = new Set([first.gone[0], middle.gone[0], last.gone[0]].map((cardId, index) => [first, middle, last][index].hand.indexOf(cardId)));
  assert.deepEqual([...discarded].sort(), [0, 1, 2], "every card of a 3-card hand can be the one discarded");
});

clause(HEIST, "3:rule@ddddddd", "the discarded card goes from the opponent's hand to THEIR discard pile; my hand and deck and the rest of their hand are untouched", () => {
  const b = heistBoard({ d: 7, random: () => 0 });
  const myHand = [...handOf(b.engine, P1)];
  const myDeck = [...deckOf(b.engine, P1)];
  const theirHand = [...handOf(b.engine, P2)];
  heistTurn(b, { discard: "oh0" });
  const gone = theirHand.filter((cardId) => zoneOf(b.engine, cardId) === "discard");
  assert.equal(gone.length, 1, "exactly one card was discarded");
  assert.ok(discardOf(b.engine, P2).includes(gone[0]), "into their discard pile");
  assert.equal(handOf(b.engine, P2).length, theirHand.length - 1);
  assert.deepEqual(handOf(b.engine, P1), myHand, "my hand is untouched");
  assert.deepEqual(deckOf(b.engine, P1), myDeck);
  assert.equal(discardOf(b.engine, P1).length, 0);
});

clause(HEIST, "3:rule@ddddddd", "an opponent with one card in hand discards that card; with an empty hand nothing happens", () => {
  const one = heistBoard({ d: 7, oppHand: 1, random: () => 0.5 });
  heistTurn(one, { discard: "oh0" });
  assert.equal(handOf(one.engine, P2).length, 0);
  assert.equal(zoneOf(one.engine, one.id("oh0")), "discard");
  const none = heistBoard({ d: 7, oppHand: 0, random: () => 0.5 });
  const asked = heistTurn(none, {});
  assert.equal(none.engine.state.pendingChoice, undefined);
  assert.equal(discardOf(none.engine, P2).length, 1, "only the card that was already there");
  assert.equal(asked.includes("pick:__od"), false, "nothing to choose");
});

clause(HEIST, "3:rule@ddddddd", "threshold-gated: [D]x6 is not enough for the discard (however many other resources / face-down cards / opposing [D])", () => {
  const six = heistBoard({ d: 6, other: 4, faceDown: 4, oppD: 7 });
  const hand = [...handOf(six.engine, P2)];
  heistTurn(six, { cover: "mine", search: "b0", discard: "oh0" });
  assert.deepEqual(handOf(six.engine, P2), hand, "no card was discarded from their hand");
});

clause(HEIST, "3:rule@ddddddd", "threshold-gated: with [D]x7 all three paragraphs are active (COVERT pick, search, discard) and a trigger order is asked", () => {
  const b = heistBoard({ d: 7, random: () => 0 });
  const asked = heistTurn(b, { cover: "mine", search: "b0", discard: "oh0" });
  assert.ok(asked.includes("orderTriggers"), "three triggers at once: I order them");
  assert.ok(asked.includes("pick:c"), "asked.includes(\"pick:c\")");
  assert.ok(asked.includes("pick:__so"), "asked.includes(\"pick:__so\")");
  assert.ok(hasKeyword(b.engine, b.id("mine"), "covert"), "hasKeyword(b.engine, b.id(\"mine\"), \"covert\")");
  assert.equal(zoneOf(b.engine, b.id("b0")), "discard", "the search happened");
  assert.equal(handOf(b.engine, P2).length, 2, "and the discard happened");
});

clause(HEIST, "3:rule@ddddddd", "it fires only at the start of MY turn, and only while the Heist Training Grounds is in play", () => {
  const theirTurn = heistBoard({ d: 7, startAs: P2, random: () => 0 });
  const hand = [...handOf(theirTurn.engine, P2)];
  heistTurn(theirTurn, {}, P2);
  assert.deepEqual(handOf(theirTurn.engine, P2), hand, "nothing is discarded at the start of their turn");
  const faceDown = heistBoard({ d: 7, heist: "faceDown", random: () => 0 });
  const hand2 = [...handOf(faceDown.engine, P2)];
  heistTurn(faceDown, {});
  assert.deepEqual(handOf(faceDown.engine, P2), hand2);
});

// ==================================================================================
// Hidden Dagger
// ATTACH TO CHARACTER. You may play this card whenever you could play a tactic. The attached character gains 1 strength.
// HANDOFF -- COST: Deplete a character you control that is not in a battle. -- EFFECT: Attach this card to the character.
// FLIP UP: 1 [D]      Item (gear), rogue, cost 1, threshold [D].
// ==================================================================================

const DAGGER = "7ff74ee6-da99-4240-8186-c04dda01a4d7";
const HANDOFF = "handoff";

function daggerBoard(
  opts: {
    where?: "hand" | "attached" | "faceDown";
    host?: string;
    icons?: Icons;
    oppIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.where ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      {
        key: "dg",
        def: printing(DAGGER),
        owner: P1,
        zone: where === "hand" ? "hand" : "play",
        faceDown: where === "faceDown" ? true : undefined,
        attachedToKey: where === "attached" ? (opts.host ?? "mine") : undefined
      },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mine3", def: character({ name: "Mine3", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      { key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" },
      ...res(opts.icons ?? {}),
      ...res(opts.oppIcons ?? {}, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type DaggerGame = ReturnType<typeof daggerBoard>;
const attachDagger = (b: DaggerGame, hostKey: string) => play(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id(hostKey)] } });
const flipDagger = (b: DaggerGame, hostKey?: string, player: PlayerId = P1) => flipUpRaw(b.engine, player, b.id("dg"), hostKey ? { attachTo: [b.id(hostKey)] } : {});
const handoff = (b: DaggerGame, pickKey: string) => activate(b.engine, P1, b.id("dg"), HANDOFF, { selected: { h: [b.id(pickKey)] } });
const handoffRaw = (b: DaggerGame, pickKey: string) => activateRaw(b.engine, P1, b.id("dg"), HANDOFF, { h: [b.id(pickKey)] });
const hostOf = (b: DaggerGame) => b.engine.state.cards[b.id("dg")].attachedTo;

const DAGGER_SPEC: DeploySpec = {
  id: DAGGER,
  cost: 1,
  icon: "deception",
  count: 1,
  extra: () => [{ key: "host", def: character({ name: "Host" }), owner: P1, zone: "play" }],
  selected: (id) => ({ attachTo: [id("host")] })
};

/** Passes priority until it is `player`'s turn to respond in the open battle window. */
function untilPriority(engine: SpoilsEngine, player: PlayerId): void {
  let guard = 0;
  while (engine.state.responseWindow && engine.state.responseWindow.priorityPlayerId !== player) {
    assert.ok(guard++ < 10, "priority never reached the player");
    engine.perform({ type: "passPriority", playerId: engine.state.responseWindow.priorityPlayerId });
  }
}

// -- 0:attach --------------------------------------------------------------------

clause(DAGGER, "0:attach", "attaches to a character you control: it enters play attached to that character, the printed cost of 1 is paid, and no other character gets it", () => {
  const b = daggerBoard({ icons: { deception: 2 } });
  const before = ready(b.engine);
  attachDagger(b, "mine");
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(hostOf(b), b.id("mine"));
  assert.equal(before - ready(b.engine), 1, "the printed cost of 1");
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 2, "another character is unaffected");
});

clause(DAGGER, "0:attach", "attaches to an opponent's character too, and I keep controlling the Dagger", () => {
  const b = daggerBoard({ icons: { deception: 1 } });
  attachDagger(b, "foe");
  assert.equal(hostOf(b), b.id("foe"));
  assert.equal(b.engine.state.cards[b.id("dg")].controllerId, P1);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
});

clause(DAGGER, "0:attach", "is refused for a target that is not a character: an item, a location, a faction, a face-down card", () => {
  const b = daggerBoard({ icons: { deception: 2 } });
  const attempt = (hostId: CardInstanceId) => () => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [hostId] } });
  refused(attempt(b.id("thing")), "an item");
  refused(attempt(b.id("place")), "a location");
  refused(attempt(factionOf(b.engine, P1)), "my faction");
  refused(attempt(factionOf(b.engine, P2)), "their faction");
  refused(attempt(b.id("hidden")), "a face-down card is only a resource (CR 411.1)");
  refused(attempt(b.id("inHand")), "a character in my hand");
  refused(attempt(b.id("inDiscard")), "a character in my discard pile");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
  assert.equal(ready(b.engine), 2, "nothing was paid");
  attempt(b.id("mine"))();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(DAGGER, "0:attach", "needs exactly one host: no pick, an empty pick and two picks are refused", () => {
  const b = daggerBoard({ icons: { deception: 2 } });
  refused(() => playRaw(b.engine, P1, b.id("dg"), {}), "no selection");
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [] } }), "no host");
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine"), b.id("mine2")] } }), "two hosts");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
});

clause(DAGGER, "0:attach", "deploys for exactly 1 with [D]; refused with no resource and without [D] even with plenty of other resources", () => {
  deploysForExactlyItsCost(DAGGER_SPEC);
  refusedOneShort(DAGGER_SPEC);
  refusedWithoutThreshold(DAGGER_SPEC);
  thresholdIsGateNotCost(DAGGER_SPEC);
});

clause(DAGGER, "0:attach", "when the host is put into its owner's hand the Dagger leaves play the same way: into its owner's hand (CR 301.4a)", () => {
  const bounce = tactic({
    name: "Bounce",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "b",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", type: "character" }, count: 1 }],
          effects: [{ type: "moveCard", target: { type: "selected", id: "t" }, to: "hand" }]
        }
      ]
    }
  });
  const b = daggerBoard({ where: "attached", host: "foe", extra: [{ key: "bounce", def: bounce, owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("bounce"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "hand");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand", "it leaves play 'in the same way': into its owner's hand");
});

clause(DAGGER, "0:attach", "when the host is destroyed the Dagger leaves play with it (to its owner's discard pile)", () => {
  const b = daggerBoard({ where: "attached", extra: [{ key: "kill", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard");
  assert.ok(discardOf(b.engine, P1).includes(b.id("dg")), "discardOf(b.engine, P1).includes(b.id(\"dg\"))");
});

// -- 1:rule — play whenever you could play a tactic -------------------------------

clause(DAGGER, "1:rule", "in response on the opponent's turn the Dagger can be played from my hand (with a host pick): it resolves into play attached", () => {
  const b = daggerBoard({ icons: { deception: 1 }, turn: 2, active: P2 });
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } }), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond");
  playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dg")), "play", "an item resolves into play, not the discard pile");
  assert.equal(hostOf(b), b.id("mine"));
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
});

clause(DAGGER, "1:rule", "an ordinary gear item cannot be played in that same window (control)", () => {
  const b = daggerBoard({
    icons: { deception: 1 },
    turn: 2,
    active: P2,
    extra: [{ key: "plain", def: item({ name: "PlainGear", subtype: ["gear"], cost: 0, attachTo: "character" as never }), owner: P1, zone: "hand" }]
  });
  playRaw(b.engine, P2, b.id("nothing"));
  refused(() => playRaw(b.engine, P1, b.id("plain"), { selected: { attachTo: [b.id("mine")] } }), "an ordinary item is not a tactic", /Only tactics or TACTICAL cards may be deployed as responses/);
  playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } });
  assert.ok(b.engine.state.responseWindow, "but the Dagger can");
});

clause(DAGGER, "1:rule", "it can be played at a battle response point: the opponent attacks and passes, I attach the Dagger to a character", () => {
  const b = daggerBoard({ icons: { deception: 1 }, turn: 2, active: P2, extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" }] });
  declareAttackOpenWindow(b.engine, P2, [b.id("atk")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine"));
});

clause(DAGGER, "1:rule", "it can be played when the opponent announces the end of their turn", () => {
  const b = daggerBoard({ icons: { deception: 1 }, turn: 2, active: P2 });
  refused(() => playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } }), "before the announcement", /Only the active player may deploy/);
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1);
  playRaw(b.engine, P1, b.id("dg"), { selected: { attachTo: [b.id("mine")] } });
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine"));
});

clause(DAGGER, "1:rule", "on my own turn it plays normally; it is not 'free': the cost and threshold are still required in a response", () => {
  const poor = daggerBoard({ icons: { rage: 3 }, turn: 2, active: P2 });
  playRaw(poor.engine, P2, poor.id("nothing"));
  refused(() => playRaw(poor.engine, P1, poor.id("dg"), { selected: { attachTo: [poor.id("mine")] } }), "no [D]");
  const none = daggerBoard({ icons: {}, turn: 2, active: P2 });
  playRaw(none.engine, P2, none.id("nothing"));
  refused(() => playRaw(none.engine, P1, none.id("dg"), { selected: { attachTo: [none.id("mine")] } }), "no resources");
  assert.equal(zoneOf(none.engine, none.id("dg")), "hand");
});

clause(DAGGER, "1:rule", "the permission is mine only: the opponent cannot play my Dagger", () => {
  const b = daggerBoard({ icons: { deception: 1 }, oppIcons: { deception: 1 }, turn: 1, active: P1, extra: [{ key: "n1", def: nothingTactic(), owner: P1, zone: "hand" }] });
  playRaw(b.engine, P1, b.id("n1"));
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "control: they may respond");
  refused(() => playRaw(b.engine, P2, b.id("dg"), { selected: { attachTo: [b.id("foe")] } }), "it is in MY hand");
  assert.equal(zoneOf(b.engine, b.id("dg")), "hand");
});

// -- 2:rule — +1 strength -----------------------------------------------------------

clause(DAGGER, "2:rule", "the attached character gains exactly 1 strength (life and speed unchanged); nobody else does", () => {
  const b = daggerBoard({ where: "attached" });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
});

clause(DAGGER, "2:rule", "an opposing host gets the +1 strength", () => {
  const b = daggerBoard({ where: "attached", host: "foe" });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});

clause(DAGGER, "2:rule", "two Daggers stack (+2); the bonus ends when the Dagger leaves play", () => {
  const b = daggerBoard({
    where: "attached",
    extra: [
      { key: "dg2", def: printing(DAGGER), owner: P1, zone: "play", attachedToKey: "mine" },
      { key: "killItem", def: killAnyTactic("item"), owner: P1, zone: "hand" }
    ]
  });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 4);
  play(b.engine, P1, b.id("killItem"), { selected: { t: [b.id("dg2")] } });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  assert.equal(zoneOf(b.engine, b.id("dg2")), "discard");
});

clause(DAGGER, "2:rule", "the bonus is real in battle: the attached character deals 3 to the faction", () => {
  const b = daggerBoard({ where: "attached", turn: 2, active: P1 });
  const before = b.engine.state.players[P2].influence;
  fight(b.engine, P1, [b.id("mine")], { type: "faction", playerId: P2 }, []);
  assert.equal(before - b.engine.state.players[P2].influence, 3);
});

clause(DAGGER, "2:rule", "a face-down Dagger in play is only a resource: it gives nothing", () => {
  const b = daggerBoard({ where: "faceDown" });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});

// -- 3:ability:handoff --------------------------------------------------------------

clause(DAGGER, "3:ability:handoff", "COST: the picked character I control is depleted; EFFECT: the Dagger is attached to it, the old host loses the +1 strength and the new host gains it", () => {
  const b = daggerBoard({ where: "attached", host: "mine" });
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
  handoff(b, "mine2");
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "the picked character is depleted");
  assert.equal(hostOf(b), b.id("mine2"), "the Dagger is attached to it");
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 3, "the new host has the +1");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2, "the old host lost the +1");
  assert.equal(isDepleted(b.engine, b.id("mine")), false, "the old host is not depleted");
  assert.equal(isDepleted(b.engine, b.id("dg")), false, "the Dagger itself is not depleted");
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(b.engine.state.cards[b.id("dg")].controllerId, P1);
});

clause(DAGGER, "3:ability:handoff", "no resource is paid", () => {
  const b = daggerBoard({ where: "attached", icons: { deception: 2 } });
  handoff(b, "mine2");
  assert.equal(ready(b.engine), 2);
  assert.equal(attachedCount(b.engine, P1), 0);
});

clause(DAGGER, "3:ability:handoff", "the cost is paid when the ability is used, before the opponent can respond: the picked character is already depleted, but the Dagger has not moved yet", () => {
  const b = daggerBoard({ where: "attached", host: "mine" });
  handoffRaw(b, "mine2");
  assert.ok(b.engine.state.responseWindow, "a response window is open");
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "the deplete cost is already paid");
  assert.equal(hostOf(b), b.id("mine"), "the effect has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine2"));
});

clause(DAGGER, "3:ability:handoff", "the Dagger can be moved off an OPPONENT's character onto one of mine", () => {
  const b = daggerBoard({ where: "attached", host: "foe" });
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 3);
  handoff(b, "mine");
  assert.equal(hostOf(b), b.id("mine"));
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
});

clause(DAGGER, "3:ability:handoff", "the character I pick may be the one the Dagger is already on: it is depleted and the Dagger stays", () => {
  const b = daggerBoard({ where: "attached", host: "mine" });
  handoff(b, "mine");
  assert.equal(isDepleted(b.engine, b.id("mine")), true);
  assert.equal(hostOf(b), b.id("mine"));
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3);
});

clause(DAGGER, "3:ability:handoff", "it can be used again and again (each time with a ready character): hand off twice in a row", () => {
  const b = daggerBoard({ where: "attached", host: "mine" });
  handoff(b, "mine2");
  handoff(b, "mine3");
  assert.equal(hostOf(b), b.id("mine3"));
  assert.equal(isDepleted(b.engine, b.id("mine2")), true);
  assert.equal(isDepleted(b.engine, b.id("mine3")), true);
  assert.equal(b.engine.getStat(b.id("mine2"), "strength"), 2, "mine2 no longer has the Dagger");
  assert.equal(b.engine.getStat(b.id("mine3"), "strength"), 3);
});

clause(DAGGER, "3:ability:handoff", "the pick must be a character I CONTROL: an opponent's character is refused", () => {
  const b = daggerBoard({ where: "attached" });
  refused(() => handoffRaw(b, "foe"), "an opponent's character");
  assert.equal(isDepleted(b.engine, b.id("foe")), false);
  assert.equal(hostOf(b), b.id("mine"));
  handoff(b, "mine2");
  assert.equal(hostOf(b), b.id("mine2"), "control: my character is accepted");
});

clause(DAGGER, "3:ability:handoff", "a character I control but do not own can be picked", () => {
  const b = daggerBoard({ where: "attached", extra: [{ key: "stolen", def: character({ name: "Stolen" }), owner: P2, controller: P1, zone: "play" }] });
  handoff(b, "stolen");
  assert.equal(hostOf(b), b.id("stolen"));
  assert.equal(isDepleted(b.engine, b.id("stolen")), true);
});

clause(DAGGER, "3:ability:handoff", "only a character in play can be picked: an item, a location, a faction, a face-down card, a card in hand / discard; none or two are refused", () => {
  const b = daggerBoard({ where: "attached" });
  const attempt = (picked: CardInstanceId[]) => () => activateRaw(b.engine, P1, b.id("dg"), HANDOFF, { h: picked });
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("inHand")]), "a character in my hand");
  refused(attempt([b.id("inDiscard")]), "a character in my discard pile");
  refused(attempt([]), "no pick");
  refused(attempt([b.id("mine2"), b.id("mine3")]), "two characters");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "none of those attempts paid anything");
  attempt([b.id("mine2")])();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(DAGGER, "3:ability:handoff", "a character that is already depleted cannot be depleted again: it is refused", () => {
  const b = daggerBoard({ where: "attached", extra: [{ key: "tired", def: character({ name: "Tired" }), owner: P1, zone: "play", depleted: true }] });
  refused(() => handoffRaw(b, "tired"), "already depleted");
  assert.equal(hostOf(b), b.id("mine"));
  handoff(b, "mine2");
  assert.equal(hostOf(b), b.id("mine2"), "control: a ready character works");
});

clause(DAGGER, "3:ability:handoff", "'not in a battle': my attacking character cannot be picked, but a character not in the battle can", () => {
  const b = daggerBoard({ where: "attached", host: "mine", turn: 2, active: P1 });
  b.engine.perform({ type: "declareAttack", playerId: P1, attackerIds: [b.id("mine")], target: { type: "faction", playerId: P2 } });
  refused(() => handoffRaw(b, "mine"), "the attacker is in the battle");
  handoffRaw(b, "mine3");
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine3"), "an idle character is a legal pick even mid-battle");
  assert.equal(isDepleted(b.engine, b.id("mine3")), true);
});

clause(DAGGER, "3:ability:handoff", "'not in a battle': a blocking character (not depleted) cannot be picked, a character not blocking can", () => {
  const b = daggerBoard({
    where: "attached",
    host: "mine2",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine2")] });
  untilPriority(b.engine, P1);
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "control: the blocker is not depleted");
  refused(() => handoffRaw(b, "mine2"), "the blocker is in the battle");
  assert.equal(isDepleted(b.engine, b.id("mine2")), false, "nothing was paid by the refused attempt");
  handoffRaw(b, "mine3");
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine3"), "a character that is not in the battle is a legal pick");
});

clause(DAGGER, "3:ability:handoff", "after the battle ends the same character can be picked again (it was only barred while in the battle)", () => {
  const b = daggerBoard({
    where: "attached",
    host: "mine2",
    turn: 2,
    active: P2,
    extra: [{ key: "atk", def: character({ name: "Atk", strength: 1, life: 6, speed: 1 }), owner: P2, zone: "play" }]
  });
  declareAttackBy(b.engine, P2, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P1, blockerIds: [b.id("mine2")] });
  autoResolveBattle(b.engine);
  assert.equal(b.engine.state.battle, undefined, "the battle is over");
  const survivors = b.engine.state.cards[b.id("mine2")];
  assert.equal(survivors.zone, "play");
  assert.equal(isDepleted(b.engine, b.id("mine2")), true, "surviving characters of the battle are depleted (CR 609.1h)");
});

clause(DAGGER, "3:ability:handoff", "it works in response on the opponent's turn too", () => {
  const b = daggerBoard({ where: "attached", turn: 2, active: P2 });
  refused(() => handoffRaw(b, "mine2"), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  handoffRaw(b, "mine2");
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine2"));
});

clause(DAGGER, "3:ability:handoff", "if the picked character is destroyed in response, the cost stays paid and the Dagger stays where it was (CR 402.4: the effect loses track of it)", () => {
  const b = daggerBoard({ where: "attached", host: "mine", extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  handoffRaw(b, "mine2");
  respondWith(b.engine, P2, b.id("kill"), { t: [b.id("mine2")] });
  assert.equal(zoneOf(b.engine, b.id("mine2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("dg")), "play", "the Dagger is still in play");
  assert.equal(hostOf(b), b.id("mine"), "and still on its old host");
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(DAGGER, "3:ability:handoff", "only the Dagger's controller can use it, and only while it is in play and face-up", () => {
  const theirs = daggerBoard({ where: "attached", turn: 2, active: P2 });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("dg"), HANDOFF, { h: [theirs.id("foe")] }), "the opponent cannot use my Dagger");
  const inHand = daggerBoard({ where: "hand" });
  refused(() => handoffRaw(inHand, "mine"), "in my hand");
  const faceDown = daggerBoard({ where: "faceDown" });
  refused(() => handoffRaw(faceDown, "mine"), "a face-down card has no abilities");
  assert.equal(isDepleted(faceDown.engine, faceDown.id("mine")), false);
});

// -- 4:flipUp ------------------------------------------------------------------------

clause(DAGGER, "4:flipUp", "a face-down Dagger is a resource that provides Volition until it is flipped", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 1 } });
  assert.equal(b.engine.isResource(b.id("dg")), true);
  assert.equal(ready(b.engine), 2);
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(DAGGER, "4:flipUp", "flips up on my turn: it pays exactly the FLIP UP cost of 1 and needs a [D]; it enters play face-up attached to the picked character", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 1, rage: 2 } });
  assert.equal(ready(b.engine), 4);
  flipDagger(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(isFaceDown(b.engine, b.id("dg")), false);
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(hostOf(b), b.id("mine"));
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 3, "and its effect applies");
  assert.equal(attachedCount(b.engine, P1), 1, "exactly one resource was paid");
  assert.equal(ready(b.engine), 2, "4 resources: the card stopped being one (-1), one was paid (-1)");
});

clause(DAGGER, "4:flipUp", "it pays the FLIP UP cost of 1, not a second time the card's own cost of 1 on top", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 3 } });
  flipDagger(b, "foe");
  resolvePendingResponses(b.engine);
  assert.equal(attachedCount(b.engine, P1), 1);
  assert.equal(hostOf(b), b.id("foe"), "an opposing character is a legal host");
});

clause(DAGGER, "4:flipUp", "FLIP UP needs a [D]: with only other icons (or only Volition, or only the opponent's [D]) it is refused and the card stays face-down", () => {
  const rage = daggerBoard({ where: "faceDown", icons: { rage: 4 } });
  refused(() => flipDagger(rage, "mine"), "no [D]");
  assert.equal(isFaceDown(rage.engine, rage.id("dg")), true);
  assert.equal(attachedCount(rage.engine, P1), 0, "nothing was paid");
  const theirs = daggerBoard({ where: "faceDown", icons: { rage: 2 }, oppIcons: { deception: 3 } });
  refused(() => flipDagger(theirs, "mine"), "the opponent's [D] do not count");
  const volitions = daggerBoard({ where: "faceDown", icons: {}, extra: volition(3, P1) });
  refused(() => flipDagger(volitions, "mine"), "face-down cards (and its own Volition) are not [D]");
  const ok = daggerBoard({ where: "faceDown", icons: { deception: 1 } });
  flipDagger(ok, "mine");
  resolvePendingResponses(ok.engine);
  assert.equal(hostOf(ok), ok.id("mine"), "control: a single [D] is enough");
});

clause(DAGGER, "4:flipUp", "the pick restrictions still apply: only a character in play (no item, location, faction, face-down card, hand or discard card) and exactly one", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 2 } });
  refused(() => flipDagger(b, "thing"), "an item");
  refused(() => flipDagger(b, "place"), "a location");
  refused(() => flipUpRaw(b.engine, P1, b.id("dg"), { attachTo: [factionOf(b.engine, P1)] }), "a faction");
  refused(() => flipDagger(b, "hidden"), "a face-down card");
  refused(() => flipDagger(b, "inHand"), "a character in my hand");
  refused(() => flipDagger(b, "inDiscard"), "a character in my discard pile");
  refused(() => flipDagger(b), "no pick");
  refused(() => flipUpRaw(b.engine, P1, b.id("dg"), { attachTo: [b.id("mine"), b.id("mine2")] }), "two picks");
  assert.equal(isFaceDown(b.engine, b.id("dg")), true, "still face-down after every refusal");
  assert.equal(attachedCount(b.engine, P1), 0);
  flipDagger(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(hostOf(b), b.id("mine"), "control: a character is accepted");
});

clause(DAGGER, "4:flipUp", "only its controller can flip it up, and only while it is face-down in play (not from the hand, not when already face-up)", () => {
  const theirs = daggerBoard({ where: "faceDown", icons: { deception: 1 }, oppIcons: { deception: 2 }, turn: 1, active: P1, extra: [{ key: "n1", def: nothingTactic(), owner: P1, zone: "hand" }] });
  playRaw(theirs.engine, P1, theirs.id("n1"));
  assert.equal(theirs.engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent holds priority");
  refused(() => flipDagger(theirs, "foe", P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("dg")), true);
  const inHand = daggerBoard({ where: "hand", icons: { deception: 1 } });
  refused(() => flipDagger(inHand, "mine"), "in my hand it is not a face-down resource");
  const faceUp = daggerBoard({ where: "attached", icons: { deception: 1 } });
  refused(() => flipDagger(faceUp, "mine2"), "already face-up");
  assert.equal(hostOf(faceUp), faceUp.id("mine"), "it was not re-attached");
});

clause(DAGGER, "4:flipUp", "its own text lets it be played whenever a tactic could be, so FLIP UP works in a response window on the opponent's turn (CR 507.4d)", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 1, rage: 1 }, turn: 2, active: P2 });
  refused(() => flipDagger(b, "mine"), "with no window open on their turn there is no tactic timing");
  assert.equal(isFaceDown(b.engine, b.id("dg")), true);
  playRaw(b.engine, P2, b.id("nothing"));
  flipDagger(b, "mine");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("dg")), "play");
  assert.equal(hostOf(b), b.id("mine"));
});

clause(DAGGER, "4:flipUp", "a flipped-up item is played as though from the hand (CR 507.4a): the opponent gets the chance to respond before it resolves, and can terminate it", () => {
  const b = daggerBoard({ where: "faceDown", icons: { deception: 1, rage: 1 }, extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  holdFlipUp(() => flipDagger(b, "mine"));
  assert.ok(b.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(hostOf(b), undefined, "it has not entered play yet");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("dg")] });
  assert.equal(zoneOf(b.engine, b.id("dg")), "discard", "terminated: it goes to its owner's discard pile (CR 314.1)");
  assert.equal(b.engine.getStat(b.id("mine"), "strength"), 2);
});

// ==================================================================================
// Hustler's Comeuppance
// Destroy all characters that inflicted damage to your faction this turn.   FLIP UP: 3 [D][D]
// Tactic, rogue, cost 5, threshold [D][D].
// ==================================================================================

const HUSTLERS = "6bae74ee-4604-4f83-8f7d-6b5eed238ef9";

/** P2's turn 2. P2 attackers a1 (2 str), a2, a3 (1 str); P1 blockers m1, m2 and a location; P1 holds the Hustler's (hand or face-down). */
function hustBoard(
  opts: { where?: "hand" | "faceDown"; icons?: Icons; extra?: CardPlacement[]; turn?: number; active?: PlayerId; oppHustlers?: boolean } = {}
) {
  const where = opts.where ?? "hand";
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "hs", def: printing(HUSTLERS), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      { key: "m1", def: character({ name: "M1", strength: 1, life: 8, speed: 1 }), owner: P1, zone: "play" },
      { key: "m2", def: character({ name: "M2", strength: 1, life: 8, speed: 1 }), owner: P1, zone: "play" },
      { key: "myLoc", def: location({ name: "MyPlace", structure: 8 }), owner: P1, zone: "play" },
      { key: "a1", def: character({ name: "A1", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "a2", def: character({ name: "A2", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "a3", def: character({ name: "A3", strength: 1, life: 4, speed: 2 }), owner: P2, zone: "play" },
      ...(opts.oppHustlers ? [{ key: "hs2", def: printing(HUSTLERS), owner: P2, zone: "hand" as const }, ...res({ deception: 5 }, P2)] : []),
      ...res(opts.icons ?? { deception: 5 }),
      ...(opts.extra ?? [])
    ]
  });
}

type HustGame = ReturnType<typeof hustBoard>;
const hitMyFaction = (b: HustGame, attackers: string[], blockers: string[] = []) =>
  fight(b.engine, P2, attackers.map((key) => b.id(key)), { type: "faction", playerId: P1 }, blockers.map((key) => b.id(key)));
/** P2 announces the end of their turn: P1 holds priority in the end-of-turn window. */
const endOfTurnWindow = (b: HustGame) => {
  b.engine.perform({ type: "endTurn", playerId: P2 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond to the end of turn");
};
const castHustlers = (b: HustGame, key = "hs") => {
  playRaw(b.engine, P1, b.id(key));
  resolvePendingResponses(b.engine);
};


clause(HUSTLERS, "0:rule", "a character that dealt battle damage to my faction this turn is destroyed (into its owner's discard pile); it costs exactly 5", () => {
  const b = hustBoard();
  const influence = b.engine.state.players[P1].influence;
  hitMyFaction(b, ["a1"]);
  assert.equal(b.engine.state.players[P1].influence, influence - 2, "control: my faction took 2 damage from A1");
  endOfTurnWindow(b);
  const before = ready(b.engine);
  playRaw(b.engine, P1, b.id("hs"));
  assert.equal(before - ready(b.engine), 5, "the printed cost of 5");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "A1 inflicted damage to my faction this turn");
  assert.ok(discardOf(b.engine, P2).includes(b.id("a1")), "into its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "the tactic ends in its owner's discard pile");
});

clause(HUSTLERS, "0:rule", "ALL such characters are destroyed: a party of two that both damaged my faction", () => {
  const b = hustBoard();
  hitMyFaction(b, ["a1", "a2"]);
  endOfTurnWindow(b);
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a2")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a3")), "play", "a character that did nothing survives");
});

clause(HUSTLERS, "0:rule", "only characters that inflicted damage to my FACTION: a character that only hit a blocker, one that has not attacked, and my own characters all survive", () => {
  const b = hustBoard();
  hitMyFaction(b, ["a1"]);
  hitMyFaction(b, ["a3"], ["m1"]);
  assert.equal(b.engine.state.cards[b.id("m1")].damage, 1, "control: A3's damage went to my blocker");
  endOfTurnWindow(b);
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a3")), "play", "A3 only damaged a character");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play", "A2 did nothing");
  assert.equal(zoneOf(b.engine, b.id("m1")), "play", "my blocker survives");
  assert.equal(zoneOf(b.engine, b.id("m2")), "play");
});

clause(HUSTLERS, "0:rule", "damage to my LOCATION is not damage to my faction: an attacker that only hit a location survives", () => {
  const b = hustBoard();
  fight(b.engine, P2, [b.id("a1")], { type: "card", cardId: b.id("myLoc") }, []);
  assert.equal(b.engine.state.cards[b.id("myLoc")].damage, 2, "control: the location took the damage");
  endOfTurnWindow(b);
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("a1")), "play");
});

clause(HUSTLERS, "0:rule", "damage dealt outside a battle counts too ('inflicted damage'): a character whose ability damaged my faction is destroyed", () => {
  const pinger = character({
    name: "Pinger",
    strength: 1,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "ping",
          name: "Ping",
          type: "activated",
          targets: [{ id: "f", selector: { type: "faction", owner: "opponent" }, count: 1 }],
          effects: [{ type: "dealDamage", target: { type: "selected", id: "f" }, amount: 1 }]
        }
      ]
    }
  });
  const b = hustBoard({ extra: [{ key: "pinger", def: pinger, owner: P2, zone: "play" }] });
  const influence = b.engine.state.players[P1].influence;
  activate(b.engine, P2, b.id("pinger"), "ping", { selected: { f: [factionOf(b.engine, P1)] } });
  assert.equal(b.engine.state.players[P1].influence, influence - 1, "control: the ping hurt my faction");
  endOfTurnWindow(b);
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("pinger")), "discard", "it inflicted damage to my faction this turn");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play");
});

clause(HUSTLERS, "0:rule", "an attack that inflicts 0 damage inflicts nothing (CR 408.1): a 0-strength attacker that hit my faction survives", () => {
  const b = hustBoard({ extra: [{ key: "zero", def: character({ name: "Zero", strength: 0, life: 3, speed: 2 }), owner: P2, zone: "play" }] });
  const influence = b.engine.state.players[P1].influence;
  hitMyFaction(b, ["zero"]);
  assert.equal(b.engine.state.players[P1].influence, influence, "control: no influence was lost");
  endOfTurnWindow(b);
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("zero")), "play", "it inflicted no damage");
});

clause(HUSTLERS, "0:rule", "the destroyed characters include ones I control now: a character that hit my faction and was then taken by me is destroyed too ('all characters')", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", owner: "opponent", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = hustBoard({ extra: [{ key: "steal", def: steal, owner: P1, zone: "hand" }] });
  hitMyFaction(b, ["a1"]);
  endOfTurnWindow(b);
  playRaw(b.engine, P1, b.id("steal"), { selected: { t: [b.id("a1")] } });
  b.engine.perform({ type: "passPriority", playerId: P2 });
  b.engine.perform({ type: "advanceFlow" });
  assert.equal(controllerOf(b.engine, b.id("a1")), P1, "control: I took A1");
  castHustlers(b);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard", "it still inflicted damage to my faction this turn");
});

clause(HUSTLERS, "0:rule", "'this turn' only: damage inflicted on the opponent's turn does not count on my next turn", () => {
  const b = hustBoard();
  hitMyFaction(b, ["a1"]);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1, "my turn");
  play(b.engine, P1, b.id("hs"));
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "the tactic resolved");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play", "A1 did not inflict damage THIS turn");
});

clause(HUSTLERS, "0:rule", "'your faction': damage my characters dealt to the OPPONENT's faction does not count, so nothing of mine is destroyed", () => {
  const b = hustBoard({ turn: 3, active: P1 });
  const before = b.engine.state.players[P2].influence;
  fight(b.engine, P1, [b.id("m1")], { type: "faction", playerId: P2 }, []);
  assert.ok(b.engine.state.players[P2].influence < before, "control: their faction took damage");
  play(b.engine, P1, b.id("hs"));
  assert.equal(zoneOf(b.engine, b.id("m1")), "play", "M1 hit THEIR faction, not mine");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
});

clause(HUSTLERS, "0:rule", "'your faction' is the faction of whoever plays it: the opponent playing their own copy destroys MY characters that hit THEIR faction", () => {
  const b = hustBoard({ turn: 3, active: P1, oppHustlers: true });
  fight(b.engine, P1, [b.id("m1")], { type: "faction", playerId: P2 }, []);
  b.engine.perform({ type: "endTurn", playerId: P1 });
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "control: they may respond");
  playRaw(b.engine, P2, b.id("hs2"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("m1")), "discard", "M1 inflicted damage to THEIR faction");
  assert.equal(zoneOf(b.engine, b.id("m2")), "play");
});

clause(HUSTLERS, "0:rule", "with no character having damaged my faction it resolves and destroys nothing", () => {
  const b = hustBoard();
  endOfTurnWindow(b);
  castHustlers(b);
  for (const key of ["a1", "a2", "a3", "m1", "m2"]) assert.equal(zoneOf(b.engine, b.id(key)), "play", key);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
});

clause(HUSTLERS, "0:rule", "it can be played during an attack: the attacker that already hit my faction earlier in the turn is destroyed, the one now attacking (no damage yet) is not", () => {
  const b = hustBoard();
  hitMyFaction(b, ["a1"]);
  declareAttackOpenWindow(b.engine, P2, [b.id("a2")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond to the attack");
  playRaw(b.engine, P1, b.id("hs"));
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play", "A2 has not damaged my faction yet");
});

clause(HUSTLERS, "0:rule", "is refused one resource short of 5, and with one [D] even with plenty of other resources", () => {
  const short = hustBoard({ icons: { deception: 4 } });
  endOfTurnWindow(short);
  refused(() => playRaw(short.engine, P1, short.id("hs")), "4 resources for a cost of 5");
  assert.equal(zoneOf(short.engine, short.id("hs")), "hand");
  assert.equal(ready(short.engine), 4, "nothing was paid");
  const oneD = hustBoard({ icons: { deception: 1, rage: 6 } });
  endOfTurnWindow(oneD);
  refused(() => playRaw(oneD.engine, P1, oneD.id("hs")), "one [D] is not [D][D]");
  const exact = hustBoard({ icons: { deception: 2, rage: 3 } });
  endOfTurnWindow(exact);
  playRaw(exact.engine, P1, exact.id("hs"));
  assert.equal(ready(exact.engine), 0, "control: [D][D] and 5 resources is exactly enough");
});

// -- 1:flipUp ------------------------------------------------------------------------

const flipHust = (b: HustGame, player: PlayerId = P1) => flipUpRaw(b.engine, player, b.id("hs"));

clause(HUSTLERS, "1:flipUp", "a face-down Hustler's Comeuppance is a resource that provides Volition until it is flipped", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2 } });
  assert.equal(b.engine.isResource(b.id("hs")), true);
  assert.equal(ready(b.engine), 3);
  assert.equal(b.engine.getThresholds(P1).volition ?? 0, 1);
});

clause(HUSTLERS, "1:flipUp", "flipping it up resolves it as the tactic: a character that damaged my faction is destroyed and the card ends in the discard pile", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 3 } });
  hitMyFaction(b, ["a1"]);
  endOfTurnWindow(b);
  flipHust(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("a1")), "discard");
  assert.equal(zoneOf(b.engine, b.id("a2")), "play");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "a flipped-up tactic goes to its owner's discard pile when it has resolved");
  assert.equal(isFaceDown(b.engine, b.id("hs")), false);
});

clause(HUSTLERS, "1:flipUp", "it pays exactly the FLIP UP cost of 3 (not the card's cost of 5)", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 3 } });
  endOfTurnWindow(b);
  const before = ready(b.engine);
  assert.equal(before, 6, "five resources plus the face-down card");
  flipHust(b);
  assert.equal(attachedCount(b.engine, P1), 3, "three resources were spent");
  assert.equal(ready(b.engine), 2, "6 - the card itself leaving the pool - 3 spent");
});

clause(HUSTLERS, "1:flipUp", "the card may pay for its own FLIP UP (CR 507.4b): [D][D] plus the card itself make exactly 3", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2 } });
  endOfTurnWindow(b);
  flipHust(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "it resolved");
  assert.equal(isFaceDown(b.engine, b.id("hs")), false);
});

clause(HUSTLERS, "1:flipUp", "FLIP UP needs [D][D]: one [D] among many other resources is refused (and the card stays face-down), two are accepted", () => {
  const one = hustBoard({ where: "faceDown", icons: { deception: 1, rage: 6 } });
  endOfTurnWindow(one);
  refused(() => flipHust(one), "one [D]");
  assert.equal(isFaceDown(one.engine, one.id("hs")), true, "still face-down");
  assert.equal(attachedCount(one.engine, P1), 0, "nothing was paid");
  const none = hustBoard({ where: "faceDown", icons: { rage: 6 } });
  endOfTurnWindow(none);
  refused(() => flipHust(none), "no [D]");
  const two = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 1 } });
  endOfTurnWindow(two);
  flipHust(two);
  resolvePendingResponses(two.engine);
  assert.equal(zoneOf(two.engine, two.id("hs")), "discard", "control: [D][D] is accepted");
});

clause(HUSTLERS, "1:flipUp", "the card's own Volition, other face-down cards and the opponent's [D] do not provide [D]", () => {
  const down = hustBoard({ where: "faceDown", icons: { deception: 1 }, extra: volition(4, P1) });
  endOfTurnWindow(down);
  refused(() => flipHust(down), "Volition is not [D]");
  const theirs = hustBoard({ where: "faceDown", icons: { deception: 1, rage: 3 }, extra: res({ deception: 4 }, P2) });
  endOfTurnWindow(theirs);
  refused(() => flipHust(theirs), "the opponent's [D] do not count");
  assert.equal(isFaceDown(theirs.engine, theirs.id("hs")), true);
});

clause(HUSTLERS, "1:flipUp", "it is a tactic: it can be flipped up in a response window on the opponent's turn, but not when there is nothing to respond to", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 1 } });
  refused(() => flipHust(b), "nothing to respond to on their turn");
  assert.equal(isFaceDown(b.engine, b.id("hs")), true);
  endOfTurnWindow(b);
  flipHust(b);
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard");
});

clause(HUSTLERS, "1:flipUp", "only its controller can flip it up, and only while it is face-down in play (not from the hand, not when face-up)", () => {
  const theirs = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 1 }, turn: 3, active: P1, extra: [{ key: "n1", def: nothingTactic(), owner: P1, zone: "hand" }, ...res({ deception: 3 }, P2)] });
  playRaw(theirs.engine, P1, theirs.id("n1"));
  assert.equal(theirs.engine.state.responseWindow?.priorityPlayerId, P2, "control: the opponent holds priority");
  refused(() => flipHust(theirs, P2), "the opponent cannot flip my card");
  assert.equal(isFaceDown(theirs.engine, theirs.id("hs")), true);
  const inHand = hustBoard({ where: "hand", icons: { deception: 2, rage: 3 } });
  endOfTurnWindow(inHand);
  refused(() => flipHust(inHand), "in my hand it is not a face-down resource");
  assert.equal(zoneOf(inHand.engine, inHand.id("hs")), "hand");
});

clause(HUSTLERS, "1:flipUp", "a flipped-up tactic is played as though from the hand (CR 507.4a): the opponent gets the chance to respond before it resolves, and can terminate it", () => {
  const b = hustBoard({ where: "faceDown", icons: { deception: 2, rage: 3 }, extra: [{ key: "counter", def: counterTactic(), owner: P2, zone: "hand" }] });
  hitMyFaction(b, ["a1"]);
  endOfTurnWindow(b);
  holdFlipUp(() => flipHust(b));
  assert.ok(b.engine.state.responseWindow, "a response window is open after the cost is paid (CR 604.1g, 607.1)");
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P2, "the opponent may respond");
  assert.equal(zoneOf(b.engine, b.id("a1")), "play", "the effect has not happened yet");
  respondWith(b.engine, P2, b.id("counter"), { dep: [b.id("hs")] });
  assert.equal(zoneOf(b.engine, b.id("a1")), "play", "terminated in response: nothing was destroyed");
  assert.equal(zoneOf(b.engine, b.id("hs")), "discard", "a terminated card goes to its owner's discard pile (CR 314.1)");
});

// ==================================================================================
// Hypnotic Illusionist
// HYPNOTIZE -- COST: Pay 5. Destroy this card. Pick a character. -- EFFECT: Take control of the character if it has
// numeric cost X or less, where X is the number of [D] you control.
// Character, rogue, subtype performer, cost 3, threshold [D], 1 strength / 3 speed / 1 life.
// ==================================================================================

const ILLUSIONIST = "30eb5290-a83b-476a-83dd-af1851cd9a9d";
const HYPNOTIZE = "hypnotize";

function hypBoard(
  opts: {
    d?: number;
    other?: number;
    faceDown?: number;
    oppD?: number;
    targetCost?: number;
    zone?: "play" | "hand";
    turn?: number;
    active?: PlayerId;
    extra?: CardPlacement[];
  } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "hi", def: printing(ILLUSIONIST), owner: P1, zone: opts.zone ?? "play" },
      { key: "foe", def: character({ name: "Foe", cost: opts.targetCost ?? 3, strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play", attackEligible: opts.active === P2 ? undefined : false },
      { key: "foe2", def: character({ name: "Foe2", cost: 1, strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "mine", def: character({ name: "Mine", cost: 2, strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing", cost: 0 }), owner: P2, zone: "play" },
      { key: "place", def: location({ name: "Place", cost: 0 }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", cost: 0 }), owner: P2, zone: "play", faceDown: true },
      { key: "oppHand", def: character({ name: "OppHand", cost: 0 }), owner: P2, zone: "hand" },
      { key: "oppDiscard", def: character({ name: "OppDiscard", cost: 0 }), owner: P2, zone: "discard" },
      ...res({ deception: opts.d ?? 5, rage: opts.other ?? 0 }),
      ...volition(opts.faceDown ?? 0, P1),
      ...res({ deception: opts.oppD ?? 0 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type HypGame = ReturnType<typeof hypBoard>;
const hypnotize = (b: HypGame, target: string) => activate(b.engine, P1, b.id("hi"), HYPNOTIZE, { selected: { c: [b.id(target)] } });
const hypnotizeRaw = (b: HypGame, target: string) => activateRaw(b.engine, P1, b.id("hi"), HYPNOTIZE, { c: [b.id(target)] });

const HYP_SPEC: DeploySpec = { id: ILLUSIONIST, cost: 3, icon: "deception", count: 1 };

clause(ILLUSIONIST, "0:ability:hypnotize", "deploys for exactly 3 with [D] with its printed 1 / 3 / 1 and performer subtype; refused one short and without [D]", () => {
  deploysForExactlyItsCost(HYP_SPEC);
  refusedOneShort(HYP_SPEC);
  refusedWithoutThreshold(HYP_SPEC);
  thresholdIsGateNotCost(HYP_SPEC);
  const { engine, id } = hypBoard();
  assert.equal(engine.getStat(id("hi"), "strength"), 1);
  assert.equal(engine.getStat(id("hi"), "speed"), 3);
  assert.equal(engine.getStat(id("hi"), "life"), 1);
  assert.deepEqual(engine.getSubtypes(id("hi")), ["performer"]);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "COST: pays exactly 5 resources and destroys the Illusionist (into its owner's discard pile)", () => {
  const b = hypBoard({ d: 5, other: 2 });
  const before = ready(b.engine);
  hypnotize(b, "foe");
  assert.equal(before - ready(b.engine), 5, "exactly 5 resources are paid");
  assert.equal(attachedCount(b.engine, P1), 5);
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard", "the Illusionist is destroyed");
  assert.ok(discardOf(b.engine, P1).includes(b.id("hi")), "discardOf(b.engine, P1).includes(b.id(\"hi\"))");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "the cost is paid when the ability is used, before the opponent can respond: resources spent and the Illusionist already destroyed, but control has not changed yet", () => {
  const b = hypBoard({ d: 5 });
  hypnotizeRaw(b, "foe");
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(attachedCount(b.engine, P1), 5);
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(controllerOf(b.engine, b.id("foe")), P2, "the effect has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("foe")), P1);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "EFFECT: a character with numeric cost exactly X (X = my [D]) is taken: I control it, its owner is unchanged, it is in my play area", () => {
  const b = hypBoard({ d: 5, targetCost: 5 });
  hypnotize(b, "foe");
  assert.equal(controllerOf(b.engine, b.id("foe")), P1, "cost 5 <= X = 5");
  assert.equal(b.engine.state.cards[b.id("foe")].ownerId, P2, "still owned by the opponent");
  assert.ok(b.engine.state.players[P1].play.includes(b.id("foe")), "b.engine.state.players[P1].play.includes(b.id(\"foe\"))");
  assert.equal(b.engine.state.players[P2].play.includes(b.id("foe")), false);
  assert.equal(controllerOf(b.engine, b.id("foe2")), P2, "their other character is untouched");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "cost X OR LESS: with 5 [D] a character of cost 0, 1 or 4 is taken as well", () => {
  for (const cost of [0, 1, 4]) {
    const b = hypBoard({ d: 5, targetCost: cost });
    hypnotize(b, "foe");
    assert.equal(controllerOf(b.engine, b.id("foe")), P1, `cost ${cost} <= 5`);
  }
});

clause(ILLUSIONIST, "0:ability:hypnotize", "a character with numeric cost MORE than X is NOT taken: the costs stay paid and the Illusionist stays destroyed", () => {
  const b = hypBoard({ d: 5, targetCost: 6 });
  hypnotize(b, "foe");
  assert.equal(controllerOf(b.engine, b.id("foe")), P2, "cost 6 > X = 5");
  assert.equal(zoneOf(b.engine, b.id("foe")), "play");
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(attachedCount(b.engine, P1), 5);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "X is the number of [D] I control: with 2 [D] + 3 other resources, cost 2 is taken and cost 3 is not", () => {
  const ok = hypBoard({ d: 2, other: 3, targetCost: 2 });
  hypnotize(ok, "foe");
  assert.equal(controllerOf(ok.engine, ok.id("foe")), P1, "cost 2 <= X = 2");
  const no = hypBoard({ d: 2, other: 3, targetCost: 3 });
  hypnotize(no, "foe");
  assert.equal(controllerOf(no.engine, no.id("foe")), P2, "cost 3 > X = 2");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "a cost-0 character is taken even with no [D] at all (0 is 0 or less)", () => {
  const b = hypBoard({ d: 0, other: 5, targetCost: 0 });
  hypnotize(b, "foe");
  assert.equal(controllerOf(b.engine, b.id("foe")), P1);
  const dear = hypBoard({ d: 0, other: 5, targetCost: 1 });
  hypnotize(dear, "foe");
  assert.equal(controllerOf(dear.engine, dear.id("foe")), P2, "cost 1 > X = 0");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "X counts every [D] I control, including the ones just spent on the cost: with 7 [D] (5 spent) cost 7 is taken and cost 8 is not", () => {
  const ok = hypBoard({ d: 7, targetCost: 7 });
  hypnotize(ok, "foe");
  assert.equal(controllerOf(ok.engine, ok.id("foe")), P1, "cost 7 <= X = 7");
  const no = hypBoard({ d: 7, targetCost: 8 });
  hypnotize(no, "foe");
  assert.equal(controllerOf(no.engine, no.id("foe")), P2, "cost 8 > X = 7");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "only [D] count for X: other resources, face-down cards (Volition) and the opponent's [D] do not", () => {
  const rage = hypBoard({ d: 1, other: 6, targetCost: 3 });
  hypnotize(rage, "foe");
  assert.equal(controllerOf(rage.engine, rage.id("foe")), P2, "six Rage are not [D]: X = 1");
  const down = hypBoard({ d: 1, other: 4, faceDown: 5, targetCost: 3 });
  hypnotize(down, "foe");
  assert.equal(controllerOf(down.engine, down.id("foe")), P2, "Volition is not [D]: X = 1");
  const theirs = hypBoard({ d: 1, other: 4, oppD: 6, targetCost: 3 });
  hypnotize(theirs, "foe");
  assert.equal(controllerOf(theirs.engine, theirs.id("foe")), P2, "the opponent's [D] are not mine: X = 1");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "X is read when the effect resolves: if a [D] of mine is destroyed in response, X is one lower", () => {
  const b = hypBoard({ d: 6, targetCost: 6, extra: [{ key: "killRes", def: killAnyTactic("resource"), owner: P2, zone: "hand" }] });
  const myD = b.engine.state.players[P1].play.filter((cardId) => b.engine.isResource(cardId));
  assert.equal(myD.length, 6, "control: six [D]");
  hypnotizeRaw(b, "foe");
  respondWith(b.engine, P2, b.id("killRes"), { t: [myD[0]] });
  assert.equal(controllerOf(b.engine, b.id("foe")), P2, "five [D] left: cost 6 > X = 5");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "control is permanent: the character is still mine after the turn passes and comes back to me, and it can attack then", () => {
  const b = hypBoard({ d: 5, targetCost: 2, turn: 1, active: P1 });
  hypnotize(b, "foe");
  endTurn(b.engine, P1);
  assert.equal(controllerOf(b.engine, b.id("foe")), P1, "still mine on their turn");
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(controllerOf(b.engine, b.id("foe")), P1, "and on my next turn");
  const influence = b.engine.state.players[P2].influence;
  fight(b.engine, P1, [b.id("foe")], { type: "faction", playerId: P2 }, []);
  assert.equal(influence - b.engine.state.players[P2].influence, 2, "it fights for me");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "a character taken this turn did not start the turn under my control: it cannot attack this turn (CR 204.3)", () => {
  const b = hypBoard({ d: 5, targetCost: 2, turn: 1, active: P1 });
  hypnotize(b, "foe");
  assert.equal(controllerOf(b.engine, b.id("foe")), P1);
  refused(() => declareAttackBy(b.engine, P1, [b.id("foe")]), "it was not under my control since the start of the turn");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "when the taken character is destroyed it goes to its OWNER's discard pile", () => {
  const b = hypBoard({ d: 5, targetCost: 2, extra: [{ key: "kill", def: killAnyTactic("character"), owner: P1, zone: "hand" }] });
  hypnotize(b, "foe");
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("foe")), "its owner's discard pile");
  assert.equal(discardOf(b.engine, P1).includes(b.id("foe")), false);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "taking an attacking character out of its controller's hands removes it from the battle (CR 407.4)", () => {
  const b = hypBoard({ d: 5, targetCost: 2, turn: 2, active: P2 });
  declareAttackOpenWindow(b.engine, P2, [b.id("foe")]);
  assert.equal(b.engine.state.responseWindow?.priorityPlayerId, P1, "control: I may respond to the attack");
  hypnotizeRaw(b, "foe");
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("foe")), P1);
  assert.deepEqual(battleOf(b.engine)?.attackingParty ?? [], [], "it left the attacking party");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "it can pick my own character: nothing changes (it is already mine) but the costs are paid", () => {
  const b = hypBoard({ d: 5 });
  hypnotize(b, "mine");
  assert.equal(controllerOf(b.engine, b.id("mine")), P1);
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(attachedCount(b.engine, P1), 5);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "the pick must be a character in play: an item, a location, a faction, a face-down card, a card in hand / discard are refused; so are none and two", () => {
  const b = hypBoard({ d: 5 });
  const attempt = (picked: CardInstanceId[]) => () => activateRaw(b.engine, P1, b.id("hi"), HYPNOTIZE, { c: picked });
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("oppHand")]), "a card in their hand");
  refused(attempt([b.id("oppDiscard")]), "a card in their discard pile");
  refused(attempt([]), "no pick");
  refused(attempt([b.id("foe"), b.id("foe2")]), "two characters");
  assert.equal(zoneOf(b.engine, b.id("hi")), "play", "none of those attempts paid anything");
  assert.equal(attachedCount(b.engine, P1), 0);
  attempt([b.id("foe")])();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(ILLUSIONIST, "0:ability:hypnotize", "'Pay 5': refused with only 4 resources (the Illusionist is not destroyed), accepted with exactly 5", () => {
  const four = hypBoard({ d: 4, targetCost: 1 });
  refused(() => hypnotizeRaw(four, "foe"), "four resources for a cost of 5");
  assert.equal(zoneOf(four.engine, four.id("hi")), "play");
  assert.equal(ready(four.engine), 4, "nothing was paid");
  const five = hypBoard({ d: 5, targetCost: 1 });
  hypnotize(five, "foe");
  assert.equal(ready(five.engine), 0);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "the ability has no threshold of its own: 5 resources of any kind pay for it", () => {
  const b = hypBoard({ d: 0, other: 5, targetCost: 0 });
  hypnotize(b, "foe");
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(attachedCount(b.engine, P1), 5);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "if the picked character is destroyed in response, the costs stay paid and nothing breaks", () => {
  const b = hypBoard({ d: 5, targetCost: 2, extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  hypnotizeRaw(b, "foe");
  respondWith(b.engine, P2, b.id("kill"), { t: [b.id("foe")] });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(zoneOf(b.engine, b.id("hi")), "discard");
  assert.equal(attachedCount(b.engine, P1), 5);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "it works in response on the opponent's turn", () => {
  const b = hypBoard({ d: 5, targetCost: 2, turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => hypnotizeRaw(b, "foe"), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  hypnotizeRaw(b, "foe");
  resolvePendingResponses(b.engine);
  assert.equal(controllerOf(b.engine, b.id("foe")), P1);
});

clause(ILLUSIONIST, "0:ability:hypnotize", "only the Illusionist's controller can use it, and only while it is in play", () => {
  const theirs = hypBoard({ d: 5, turn: 2, active: P2, extra: res({ rage: 5 }, P2) });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("hi"), HYPNOTIZE, { c: [theirs.id("mine")] }), "the opponent cannot use my Illusionist");
  const inHand = hypBoard({ d: 5, zone: "hand" });
  refused(() => hypnotizeRaw(inHand, "foe"), "in my hand");
  assert.equal(controllerOf(inHand.engine, inHand.id("foe")), P2);
});

// ==================================================================================
// Lucky Charm
// When this card enters play, draw a card.   Your opponent must pay 1 to pick a character you control.
// Item, rogue, cost 2, threshold [D].
// ==================================================================================

const CHARM = "209f6903-153c-455b-b211-b7fa87571220";

function charmBoard(
  opts: {
    charm?: "play" | "hand" | "faceDown";
    oppIcons?: Icons;
    myIcons?: Icons;
    turn?: number;
    active?: PlayerId;
    deck?: number;
    extra?: CardPlacement[];
  } = {}
) {
  const where = opts.charm ?? "play";
  const poke = character({
    name: "Poker",
    strength: 1,
    life: 3,
    speed: 1,
    behavior: {
      abilities: [
        {
          id: "poke",
          name: "Poke",
          type: "activated",
          targets: [{ id: "c", selector: { type: "character" }, count: 1 }],
          effects: []
        }
      ]
    }
  });
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn ?? 2,
    activePlayerId: opts.active ?? P2,
    cards: [
      { key: "charm", def: printing(CHARM), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "mineItem", def: item({ name: "MyItem" }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "poker", def: poke, owner: P2, zone: "play" },
      { key: "killChar", def: killAnyTactic("character"), owner: P2, zone: "hand" },
      { key: "killItem", def: killAnyTactic("item"), owner: P2, zone: "hand" },
      { key: "myKill", def: killAnyTactic("character"), owner: P1, zone: "hand" },
      ...deckCards("a", opts.deck ?? 3, P1),
      ...deckCards("b", 3, P2),
      ...res(opts.myIcons ?? {}),
      ...res(opts.oppIcons ?? { rage: 2 }, P2),
      ...(opts.extra ?? [])
    ]
  });
}

type CharmGame = ReturnType<typeof charmBoard>;
const CHARM_SPEC: DeploySpec = {
  id: CHARM,
  cost: 2,
  icon: "deception",
  count: 1,
  extra: () => deckCards("a", 3, P1)
};

clause(CHARM, "0:rule", "deploys for exactly 2 with [D] as an item; refused one short and without [D] even with plenty of other resources", () => {
  deploysForExactlyItsCost(CHARM_SPEC);
  refusedOneShort(CHARM_SPEC);
  refusedWithoutThreshold(CHARM_SPEC);
  thresholdIsGateNotCost(CHARM_SPEC);
  const b = charmBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("charm")), ["item"]);
});

clause(CHARM, "0:rule", "when it enters play I draw exactly one card, the top card of my deck; the opponent draws nothing", () => {
  const b = charmBoard({ charm: "hand", myIcons: { deception: 2 }, turn: 1, active: P1 });
  const top = deckOf(b.engine, P1)[0];
  const myHand = handOf(b.engine, P1).length;
  const theirHand = handOf(b.engine, P2).length;
  const deckBefore = deckOf(b.engine, P1).length;
  play(b.engine, P1, b.id("charm"));
  settle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("charm")), "play");
  assert.equal(handOf(b.engine, P1).length, myHand - 1 + 1, "the Charm left my hand and one card was drawn");
  assert.equal(zoneOf(b.engine, top), "hand", "the top card of my deck");
  assert.equal(deckOf(b.engine, P1).length, deckBefore - 1);
  assert.equal(handOf(b.engine, P2).length, theirHand);
  assert.equal(deckOf(b.engine, P2).length, 3);
  assert.equal(b.engine.state.pendingChoice, undefined, "nothing is asked");
});

clause(CHARM, "0:rule", "it is not a 'may': the draw happens without any prompt", () => {
  const b = charmBoard({ charm: "hand", myIcons: { deception: 2 }, turn: 1, active: P1 });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("charm"));
  assert.equal(b.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(b.engine, top), "hand", "the draw already happened, with no question asked");
});

clause(CHARM, "0:rule", "the draw happens when the Charm ENTERS play (after the opponent had the chance to respond), not when it is played", () => {
  const b = charmBoard({ charm: "hand", myIcons: { deception: 2 }, turn: 1, active: P1 });
  const myHand = handOf(b.engine, P1).length;
  playRaw(b.engine, P1, b.id("charm"));
  assert.ok(b.engine.state.responseWindow, "the opponent may respond");
  assert.equal(handOf(b.engine, P1).length, myHand - 1, "nothing is drawn while the Charm is still being deployed");
  resolvePendingResponses(b.engine);
  assert.equal(handOf(b.engine, P1).length, myHand, "drawn once it entered play");
});

clause(CHARM, "0:rule", "it triggers only when THIS card enters play: another item entering play draws nothing", () => {
  const b = charmBoard({ turn: 1, active: P1, extra: [{ key: "plainItem", def: item({ name: "PlainItem", cost: 0 }), owner: P1, zone: "hand" }] });
  const myHand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("plainItem"));
  assert.equal(handOf(b.engine, P1).length, myHand - 1, "no card was drawn");
});

clause(CHARM, "0:rule", "it triggers when the Charm is put into play by an effect too", () => {
  const cheat = tactic({
    name: "Cheat",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "cheat",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "hand", owner: "self", type: "item" }, count: 1 }],
          effects: [{ type: "putIntoPlay", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const b = charmBoard({ charm: "hand", turn: 1, active: P1, extra: [{ key: "cheat", def: cheat, owner: P1, zone: "hand" }] });
  const top = deckOf(b.engine, P1)[0];
  play(b.engine, P1, b.id("cheat"), { selected: { t: [b.id("charm")] } });
  assert.equal(zoneOf(b.engine, b.id("charm")), "play");
  assert.equal(zoneOf(b.engine, top), "hand", "it drew");
});

clause(CHARM, "0:rule", "with an empty deck the Charm still enters play, nothing is drawn, and the game goes on (CR 102.1a)", () => {
  const b = charmBoard({ charm: "hand", myIcons: { deception: 2 }, turn: 1, active: P1, deck: 0 });
  const myHand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("charm"));
  assert.equal(zoneOf(b.engine, b.id("charm")), "play");
  assert.equal(handOf(b.engine, P1).length, myHand - 1);
  assert.equal(b.engine.state.winner, undefined);
});

clause(CHARM, "0:rule", "nothing is drawn when the Charm leaves play", () => {
  const b = charmBoard({ turn: 1, active: P1, extra: [{ key: "kill", def: killAnyTactic("item"), owner: P1, zone: "hand" }] });
  const myHand = handOf(b.engine, P1).length;
  play(b.engine, P1, b.id("kill"), { selected: { t: [b.id("charm")] } });
  assert.equal(zoneOf(b.engine, b.id("charm")), "discard");
  assert.equal(handOf(b.engine, P1).length, myHand - 1, "only the tactic left my hand");
});

clause(CHARM, "0:rule", "the controller of the Charm draws: a Charm the opponent plays draws from THEIR deck", () => {
  const b = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: 2,
    activePlayerId: P2,
    cards: [
      { key: "charm", def: printing(CHARM), owner: P2, zone: "hand" },
      ...deckCards("a", 3, P1),
      ...deckCards("b", 3, P2),
      ...res({ deception: 2 }, P2)
    ]
  });
  const theirTop = deckOf(b.engine, P2)[0];
  const myDeck = [...deckOf(b.engine, P1)];
  play(b.engine, P2, b.id("charm"));
  assert.equal(zoneOf(b.engine, theirTop), "hand");
  assert.deepEqual(deckOf(b.engine, P1), myDeck);
});

// -- 1:rule — the opponent pays 1 to pick my characters ---------------------------------

const killMine = (b: CharmGame) => play(b.engine, P2, b.id("killChar"), { selected: { t: [b.id("mine")] } });

clause(CHARM, "1:rule", "the opponent must pay 1 to pick a character I control: a tactic that picks my character costs them 1 resource on top", () => {
  const b = charmBoard({ oppIcons: { rage: 2 } });
  const before = ready(b.engine, P2);
  killMine(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "control: the pick went through");
  assert.equal(before - ready(b.engine, P2), 1, "they paid 1 to pick my character (the tactic itself costs 0)");
});

clause(CHARM, "1:rule", "an opponent with no resource cannot pick my character at all", () => {
  const b = charmBoard({ oppIcons: {} });
  refused(() => playRaw(b.engine, P2, b.id("killChar"), { selected: { t: [b.id("mine")] } }), "they cannot pay 1");
  assert.equal(zoneOf(b.engine, b.id("mine")), "play");
  assert.equal(zoneOf(b.engine, b.id("killChar")), "hand");
});

clause(CHARM, "1:rule", "...but picking their OWN character costs nothing (control for the payment), even with no resources", () => {
  const b = charmBoard({ oppIcons: {} });
  const before = ready(b.engine, P2);
  play(b.engine, P2, b.id("killChar"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(before - ready(b.engine, P2), 0, "nothing paid");
});

clause(CHARM, "1:rule", "the payment applies to ability picks as well: a Poke ability picking my character costs them 1", () => {
  const b = charmBoard({ oppIcons: { rage: 2 } });
  const before = ready(b.engine, P2);
  activate(b.engine, P2, b.id("poker"), "poke", { selected: { c: [b.id("mine")] } });
  assert.equal(before - ready(b.engine, P2), 1, "1 resource paid to pick my character");
  const none = charmBoard({ oppIcons: {} });
  refused(() => activateRaw(none.engine, P2, none.id("poker"), "poke", { c: [none.id("mine")] }), "they cannot pay 1");
});

clause(CHARM, "1:rule", "an ability that picks one of their own characters costs them nothing", () => {
  const b = charmBoard({ oppIcons: {} });
  activate(b.engine, P2, b.id("poker"), "poke", { selected: { c: [b.id("foe")] } });
  assert.equal(attachedCount(b.engine, P2), 0);
});

clause(CHARM, "1:rule", "it is only about picking a CHARACTER: picking my item costs them nothing", () => {
  const b = charmBoard({ oppIcons: {} });
  play(b.engine, P2, b.id("killItem"), { selected: { t: [b.id("mineItem")] } });
  assert.equal(zoneOf(b.engine, b.id("mineItem")), "discard");
  assert.equal(attachedCount(b.engine, P2), 0);
});

clause(CHARM, "1:rule", "it only taxes the OPPONENT: I pick my own character for free", () => {
  const b = charmBoard({ turn: 1, active: P1, myIcons: {} });
  const before = ready(b.engine, P1);
  play(b.engine, P1, b.id("myKill"), { selected: { t: [b.id("mine")] } });
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard");
  assert.equal(before - ready(b.engine, P1), 0, "I paid nothing");
});

clause(CHARM, "1:rule", "two Lucky Charms: each demands 1, so picking my character costs them 2", () => {
  const b = charmBoard({ oppIcons: { rage: 3 }, extra: [{ key: "charm2", def: printing(CHARM), owner: P1, zone: "play" }] });
  const before = ready(b.engine, P2);
  killMine(b);
  assert.equal(before - ready(b.engine, P2), 2, "1 for each Charm");
});

clause(CHARM, "1:rule", "the payment is spent from their resources: it is attached to their faction like any payment", () => {
  const b = charmBoard({ oppIcons: { rage: 2 } });
  killMine(b);
  assert.equal(attachedCount(b.engine, P2), 1);
  assert.equal(attachedCount(b.engine, P1), 0, "mine are untouched");
});

clause(CHARM, "1:rule", "once the Charm has left play my characters can be picked for free again", () => {
  const b = charmBoard({ oppIcons: {}, extra: [{ key: "killMyItem", def: killAnyTactic("item"), owner: P2, zone: "hand" }] });
  play(b.engine, P2, b.id("killMyItem"), { selected: { t: [b.id("charm")] } });
  assert.equal(zoneOf(b.engine, b.id("charm")), "discard", "the Charm is gone");
  killMine(b);
  assert.equal(zoneOf(b.engine, b.id("mine")), "discard", "picked without paying");
});

clause(CHARM, "1:rule", "a Lucky Charm in my hand or face-down as a resource taxes nobody", () => {
  const hand = charmBoard({ charm: "hand", oppIcons: {} });
  killMine(hand);
  assert.equal(zoneOf(hand.engine, hand.id("mine")), "discard");
  const down = charmBoard({ charm: "faceDown", oppIcons: {} });
  killMine(down);
  assert.equal(zoneOf(down.engine, down.id("mine")), "discard");
});

// ==================================================================================
// Luxurious Gaming Establishment
// At the start of your turn, you may pick a character. If you do, it loses 1 speed this turn.
// Location, rogue, cost 3, threshold [D], structure 3.
// ==================================================================================

const LGE = "f1451fa0-b4bf-4b88-a0c7-f18629af4abd";

function lgeBoard(
  opts: { lge?: "play" | "hand" | "faceDown"; startAs?: PlayerId; extra?: CardPlacement[]; mineSpeed?: number; lges?: number } = {}
) {
  const startAs = opts.startAs ?? P1;
  const where = opts.lge ?? "play";
  return buildGame({
    turn: 2,
    activePlayerId: other(startAs),
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "lge", def: printing(LGE), owner: P1, zone: where === "hand" ? "hand" : "play", faceDown: where === "faceDown" ? true : undefined },
      ...((opts.lges ?? 1) > 1 ? [{ key: "lge2", def: printing(LGE), owner: P1, zone: "play" as const }] : []),
      { key: "mine", def: character({ name: "Mine", strength: 2, life: 4, speed: opts.mineSpeed ?? 3 }), owner: P1, zone: "play" },
      { key: "mine2", def: character({ name: "Mine2", strength: 2, life: 4, speed: 3 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 3 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type LgeGame = ReturnType<typeof lgeBoard>;

/** Starts `player`'s turn and answers every prompt: the speed pick takes `picks` in order (an empty pick when the list runs out). */
function lgeTurn(b: LgeGame, picks: string[] = [], player: PlayerId = P1): string[] {
  endTurn(b.engine, other(player));
  assert.equal(b.engine.state.activePlayerId, player, "the turn has changed hands");
  const asked: string[] = [];
  const queue = [...picks];
  drain(b.engine, (pc) => {
    if (pc.kind === "orderTriggers") return { kind: "orderTriggers", next: (pc.triggers as unknown[])[0] };
    if (pc.kind === "chooserSelectsTarget") {
      asked.push(`${pc.playerId}:pick`);
      const key = queue.shift();
      return { kind: "chooserSelectsTarget", selected: key ? [b.id(key)] : [] };
    }
    return declineAll(pc);
  });
  return asked;
}

const LGE_SPEC: DeploySpec = { id: LGE, cost: 3, icon: "deception", count: 1 };

clause(LGE, "0:rule", "deploys for exactly 3 with [D] as a location; refused one resource short and without [D]", () => {
  deploysForExactlyItsCost(LGE_SPEC);
  refusedOneShort(LGE_SPEC);
  refusedWithoutThreshold(LGE_SPEC);
  thresholdIsGateNotCost(LGE_SPEC);
  const b = lgeBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("lge")), ["location"]);
});

clause(LGE, "0:rule", "its structure is 3: an attack of 2 leaves it standing, an attack of 3 destroys it", () => {
  const strike = (strength: number) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P2,
      cards: [
        { key: "lge", def: printing(LGE), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength, life: 5, speed: 2 }), owner: P2, zone: "play" }
      ]
    });
    fight(b.engine, P2, [b.id("atk")], { type: "card", cardId: b.id("lge") }, []);
    return b;
  };
  const two = strike(2);
  assert.equal(zoneOf(two.engine, two.id("lge")), "play");
  assert.equal(two.engine.state.cards[two.id("lge")].damage, 2);
  const three = strike(3);
  assert.equal(zoneOf(three.engine, three.id("lge")), "discard");
});

clause(LGE, "0:rule", "at the start of my turn I am asked to pick a character, and the picked one loses exactly 1 speed (strength and life unchanged)", () => {
  const b = lgeBoard();
  const asked = lgeTurn(b, ["foe"]);
  assert.deepEqual(asked, [`${P1}:pick`], "exactly one prompt");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 4);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3, "my character is unaffected");
});

clause(LGE, "0:rule", "any character can be picked: mine too", () => {
  const b = lgeBoard();
  lgeTurn(b, ["mine"]);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("mine2"), "speed"), 3);
});

clause(LGE, "0:rule", "'you MAY pick': declining picks nothing and nobody loses speed", () => {
  const b = lgeBoard();
  const asked = lgeTurn(b, []);
  assert.deepEqual(asked, [`${P1}:pick`]);
  for (const key of ["mine", "mine2", "foe"]) assert.equal(b.engine.getStat(b.id(key), "speed"), 3, key);
});

clause(LGE, "0:rule", "the pick must be a character in play: an item, a location, a faction, a face-down card, a card in hand / discard, or two characters are refused", () => {
  const b = lgeBoard();
  endTurn(b.engine, P2);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "control: the pick is open");
  const attempt = (selected: CardInstanceId[]) => tryPick(b.engine, selected);
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("inHand")]), "a card in my hand");
  refused(attempt([b.id("inDiscard")]), "a card in a discard pile");
  refused(attempt([b.id("mine"), b.id("foe")]), "two characters");
  assert.equal(pending(b.engine)?.kind, "chooserSelectsTarget", "still waiting for a legal pick");
  pickCards(b.engine, P1, [b.id("foe")]);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "control: a character is accepted");
});

clause(LGE, "0:rule", "the speed loss lasts this turn only: it is gone when my turn ends", () => {
  const b = lgeBoard();
  lgeTurn(b, ["foe"]);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "during my turn");
  endTurn(b.engine, P1);
  assert.equal(b.engine.state.activePlayerId, P2);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3, "restored at the end of the turn");
});

clause(LGE, "0:rule", "the lost speed is real speed: a speed-3 blocker picked at the start of my turn is slower than my speed-3 attacker, so it deals its damage after", () => {
  const b = buildGame({
    turn: 2,
    activePlayerId: P2,
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "lge", def: printing(LGE), owner: P1, zone: "play" },
      { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 3 }), owner: P1, zone: "play" },
      { key: "blk", def: character({ name: "Blk", strength: 3, life: 3, speed: 3 }), owner: P2, zone: "play" }
    ]
  });
  endTurn(b.engine, P2);
  pickCards(b.engine, P1, [b.id("blk")]);
  declareAttackBy(b.engine, P1, [b.id("atk")]);
  b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
  autoResolveBattle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("blk")), "discard", "the slowed blocker was destroyed before it could strike");
  assert.equal(zoneOf(b.engine, b.id("atk")), "play", "my attacker took no damage");
});

clause(LGE, "0:rule", "a character with 0 speed that 'loses 1 speed' stays at 0 speed (CR 410.4), not -1", () => {
  const b = lgeBoard({ mineSpeed: 0 });
  lgeTurn(b, ["mine"]);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 0);
});

clause(LGE, "0:rule", "a character with 1 speed goes to 0 speed", () => {
  const b = lgeBoard({ mineSpeed: 1 });
  lgeTurn(b, ["mine"]);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 0);
});

clause(LGE, "0:rule", "two Gaming Establishments each ask for a pick: picking the same character twice makes it lose 2 speed, and picking two characters slows each by 1", () => {
  const same = lgeBoard({ lges: 2 });
  const asked = lgeTurn(same, ["foe", "foe"]);
  assert.equal(asked.length, 2, "two prompts");
  assert.equal(same.engine.getStat(same.id("foe"), "speed"), 1, "-2 speed");
  const diff = lgeBoard({ lges: 2 });
  lgeTurn(diff, ["foe", "mine"]);
  assert.equal(diff.engine.getStat(diff.id("foe"), "speed"), 2);
  assert.equal(diff.engine.getStat(diff.id("mine"), "speed"), 2);
});

clause(LGE, "0:rule", "it fires only at the start of MY turn: when the opponent's turn starts nothing is asked", () => {
  const b = lgeBoard({ startAs: P2 });
  const asked = lgeTurn(b, ["foe"], P2);
  assert.deepEqual(asked, []);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3);
});

clause(LGE, "0:rule", "it fires at the start of each of my turns", () => {
  const b = lgeBoard();
  lgeTurn(b, ["foe"]);
  endTurn(b.engine, P1);
  const asked: string[] = [];
  endTurn(b.engine, P2);
  drain(b.engine, (pc) => {
    asked.push(pc.kind);
    return pc.kind === "chooserSelectsTarget" ? { kind: "chooserSelectsTarget", selected: [b.id("foe")] } : declineAll(pc);
  });
  assert.deepEqual(asked, ["chooserSelectsTarget"], "asked again on my next turn");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2);
});

clause(LGE, "0:rule", "it does nothing while the Establishment is in my hand or face-down as a resource, or after it was destroyed", () => {
  const inHand = lgeBoard({ lge: "hand" });
  assert.deepEqual(lgeTurn(inHand, ["foe"]), []);
  const faceDown = lgeBoard({ lge: "faceDown" });
  assert.deepEqual(lgeTurn(faceDown, ["foe"]), []);
  const gone = lgeBoard({ extra: [{ key: "killLoc", def: killAnyTactic("location"), owner: P2, zone: "hand" }] });
  gone.engine.perform({ type: "playCard", playerId: P2, cardId: gone.id("killLoc"), selected: { t: [gone.id("lge")] }, variables: {} } as never);
  resolvePendingResponses(gone.engine);
  assert.equal(zoneOf(gone.engine, gone.id("lge")), "discard");
  assert.deepEqual(lgeTurn(gone, ["foe"]), []);
  assert.equal(gone.engine.getStat(gone.id("foe"), "speed"), 3);
});

// ==================================================================================
// Maxwell Cockswagger
// UNIQUE MAXWELL
// STRUT -- COST: Pay 2. Pick a character. -- EFFECT: This turn, the character gains 1 speed or loses 1 life.
// Character, rogue, subtype grifter, cost 9, threshold [D][D], 5 strength / 3 speed / 5 life.
// ==================================================================================

const MAXWELL = "01077dac-1b52-4af9-a73c-7b64f71058b0";
const STRUT = "strut";

function maxwellBoard(
  opts: { zone?: "play" | "hand"; icons?: Icons; turn?: number; active?: PlayerId; extra?: CardPlacement[]; mineLife?: number } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mw", def: printing(MAXWELL), owner: P1, zone: opts.zone ?? "play" },
      { key: "mine", def: character({ name: "Mine", strength: 2, life: opts.mineLife ?? 4, speed: 2 }), owner: P1, zone: "play" },
      { key: "foe", def: character({ name: "Foe", strength: 2, life: 4, speed: 2 }), owner: P2, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden" }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P1, zone: "discard" },
      ...res(opts.icons ?? { rage: 4 }),
      ...(opts.extra ?? [])
    ]
  });
}

type MaxwellGame = ReturnType<typeof maxwellBoard>;
/** Uses STRUT on `target` and answers the "gains 1 speed or loses 1 life" choice: `option` 0 = speed, 1 = life (undefined: leave the prompt open). */
function strut(b: MaxwellGame, target: string, option?: 0 | 1, who = "mw"): void {
  activate(b.engine, P1, b.id(who), STRUT, { selected: { c: [b.id(target)] } });
  if (option !== undefined) {
    const pc = pending(b.engine);
    assert.ok(pc, "the speed-or-life choice is open");
    answerPending(b.engine, "chooserSelectsOption", { index: option });
  }
}
const strutRaw = (b: MaxwellGame, target: string) => activateRaw(b.engine, P1, b.id("mw"), STRUT, { c: [b.id(target)] });

const MAXWELL_SPEC: DeploySpec = { id: MAXWELL, cost: 9, icon: "deception", count: 2 };

// -- 0:unique --------------------------------------------------------------------

clause(MAXWELL, "0:unique", "deploys for exactly 9 with [D][D] with its printed 5 / 3 / 5 and grifter subtype; refused one short and with one [D]", () => {
  deploysForExactlyItsCost(MAXWELL_SPEC);
  refusedOneShort(MAXWELL_SPEC);
  refusedWithoutThreshold(MAXWELL_SPEC);
  thresholdIsGateNotCost(MAXWELL_SPEC);
  const { engine, id } = maxwellBoard();
  assert.equal(engine.getStat(id("mw"), "strength"), 5);
  assert.equal(engine.getStat(id("mw"), "speed"), 3);
  assert.equal(engine.getStat(id("mw"), "life"), 5);
  assert.deepEqual(engine.getSubtypes(id("mw")), ["grifter"]);
});

function twoMaxwells(second: "hand" | "oppPlay" | "oppHand" = "hand") {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: second === "oppHand" ? 2 : 1,
    activePlayerId: second === "oppHand" ? P2 : P1,
    cards: [
      { key: "mw", def: printing(MAXWELL), owner: P1, zone: "play" },
      ...(second === "hand" ? [{ key: "mw2", def: printing(MAXWELL), owner: P1, zone: "hand" as const }] : []),
      ...(second === "oppPlay" ? [{ key: "oppMw", def: printing(MAXWELL), owner: P2, zone: "play" as const }] : []),
      ...(second === "oppHand" ? [{ key: "oppMw", def: printing(MAXWELL), owner: P2, zone: "hand" as const }] : []),
      ...res({ deception: 9 }, P1),
      ...res({ deception: 9 }, P2)
    ]
  });
}

clause(MAXWELL, "0:unique", "deploying a second Maxwell while I control one forces ME to choose which to keep: keeping the new one destroys the old one", () => {
  const { engine, id } = twoMaxwells();
  play(engine, P1, id("mw2"));
  const pc = pending(engine);
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1, "the controller chooses (FAQ)");
  assert.deepEqual([...(pc.candidates as string[])].sort(), [id("mw"), id("mw2")].sort());
  answerPending(engine, "uniqueSurvivor", { keep: id("mw2") });
  assert.equal(zoneOf(engine, id("mw2")), "play");
  assert.equal(zoneOf(engine, id("mw")), "discard", "the other copy is destroyed");
  assert.equal(engine.state.pendingChoice, undefined);
  assert.equal(engine.state.responseWindow, undefined, "the game is not stuck");
});

clause(MAXWELL, "0:unique", "keeping the old Maxwell destroys the new one", () => {
  const { engine, id } = twoMaxwells();
  play(engine, P1, id("mw2"));
  answerPending(engine, "uniqueSurvivor", { keep: id("mw") });
  assert.equal(zoneOf(engine, id("mw")), "play");
  assert.equal(zoneOf(engine, id("mw2")), "discard");
  assert.equal(engine.state.pendingChoice, undefined);
});

clause(MAXWELL, "0:unique", "UNIQUE only concerns MY cards: my opponent may have their own Maxwell, or deploy one while I control mine, with no choice", () => {
  const inPlay = twoMaxwells("oppPlay");
  assert.equal(inPlay.engine.state.pendingChoice, undefined);
  assert.equal(zoneOf(inPlay.engine, inPlay.id("mw")), "play");
  assert.equal(zoneOf(inPlay.engine, inPlay.id("oppMw")), "play");
  const deploy = twoMaxwells("oppHand");
  play(deploy.engine, P2, deploy.id("oppMw"));
  assert.equal(deploy.engine.state.pendingChoice, undefined, "no unique prompt for the opponent");
  assert.equal(zoneOf(deploy.engine, deploy.id("oppMw")), "play");
  assert.equal(zoneOf(deploy.engine, deploy.id("mw")), "play");
});

clause(MAXWELL, "0:unique", "taking control of the opponent's Maxwell while I control mine forces a choice", () => {
  const steal = tactic({
    name: "Steal",
    cost: 0,
    behavior: {
      abilities: [
        {
          id: "steal",
          type: "activated",
          targets: [{ id: "t", selector: { zone: "play", owner: "opponent", type: "character" }, count: 1 }],
          effects: [{ type: "takeControl", target: { type: "selected", id: "t" }, controller: "controller" }]
        }
      ]
    }
  });
  const { engine, id } = buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    cards: [
      { key: "mw", def: printing(MAXWELL), owner: P1, zone: "play" },
      { key: "oppMw", def: printing(MAXWELL), owner: P2, zone: "play" },
      { key: "steal", def: steal, owner: P1, zone: "hand" }
    ]
  });
  play(engine, P1, id("steal"), { selected: { t: [id("oppMw")] } });
  const pc = pending(engine);
  assert.ok(pc, "now I control two copies");
  assert.equal(pc.kind, "uniqueSurvivor");
  assert.equal(pc.playerId, P1);
});

clause(MAXWELL, "0:unique", "the designation is what counts: another character with the same UNIQUE designation conflicts, one with a different designation does not", () => {
  const same = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mw", def: printing(MAXWELL), owner: P1, zone: "play" },
      { key: "same", def: character({ name: "Totally Different Name", unique: "maxwell" }), owner: P1, zone: "hand" }
    ]
  });
  play(same.engine, P1, same.id("same"));
  assert.equal(pending(same.engine)?.kind, "uniqueSurvivor", "same designation: a choice");
  const different = buildGame({
    playerA: { faction: developFaction() },
    cards: [
      { key: "mw", def: printing(MAXWELL), owner: P1, zone: "play" },
      { key: "diff", def: character({ name: "Another Guy", unique: "someone else" }), owner: P1, zone: "hand" }
    ]
  });
  play(different.engine, P1, different.id("diff"));
  assert.equal(different.engine.state.pendingChoice, undefined, "different designation: no choice");
});

// -- 1:ability:strut ----------------------------------------------------------------

clause(MAXWELL, "1:ability:strut", "COST: pays exactly 2 resources (any kind); Maxwell is not depleted by it", () => {
  const b = maxwellBoard({ icons: { rage: 4 } });
  const before = ready(b.engine);
  strut(b, "foe", 0);
  assert.equal(before - ready(b.engine), 2, "exactly 2 resources are paid");
  assert.equal(attachedCount(b.engine, P1), 2);
  assert.equal(isDepleted(b.engine, b.id("mw")), false);
});

clause(MAXWELL, "1:ability:strut", "the controller (me) is asked to choose between gaining 1 speed and losing 1 life, when the ability resolves; both options are offered", () => {
  const b = maxwellBoard();
  activate(b.engine, P1, b.id("mw"), STRUT, { selected: { c: [b.id("foe")] } });
  const pc = pending(b.engine) as unknown as { kind: string; playerId: string; optionCount: number };
  assert.ok(pc, "a choice is open");
  assert.equal(pc.kind, "chooserSelectsOption");
  assert.equal(pc.playerId, P1, "the Maxwell's controller chooses");
  assert.equal(pc.optionCount, 2);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "nothing has happened before the choice");
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 4);
});

clause(MAXWELL, "1:ability:strut", "choosing 'gains 1 speed': the picked character gets exactly +1 speed and nothing else changes", () => {
  const b = maxwellBoard();
  strut(b, "foe", 0);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 4, "'or': not also losing life");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 2, "another character is unaffected");
});

clause(MAXWELL, "1:ability:strut", "choosing 'loses 1 life': the picked character gets exactly -1 life and nothing else changes", () => {
  const b = maxwellBoard();
  strut(b, "foe", 1);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2, "'or': not also gaining speed");
  assert.equal(b.engine.getStat(b.id("foe"), "strength"), 2);
  assert.equal(b.engine.getStat(b.id("mine"), "life"), 4, "another character is unaffected");
});

clause(MAXWELL, "1:ability:strut", "it can pick my own character, an opponent's, or Maxwell himself", () => {
  const mine = maxwellBoard();
  strut(mine, "mine", 0);
  assert.equal(mine.engine.getStat(mine.id("mine"), "speed"), 3);
  const foe = maxwellBoard();
  strut(foe, "foe", 1);
  assert.equal(foe.engine.getStat(foe.id("foe"), "life"), 3);
  const self = maxwellBoard();
  strut(self, "mw", 0);
  assert.equal(self.engine.getStat(self.id("mw"), "speed"), 4);
});

clause(MAXWELL, "1:ability:strut", "the change lasts this turn only (both options)", () => {
  const speed = maxwellBoard();
  strut(speed, "foe", 0);
  assert.equal(speed.engine.getStat(speed.id("foe"), "speed"), 3);
  endTurn(speed.engine, P1);
  assert.equal(speed.engine.getStat(speed.id("foe"), "speed"), 2, "speed gain gone");
  const life = maxwellBoard();
  strut(life, "foe", 1);
  assert.equal(life.engine.getStat(life.id("foe"), "life"), 3);
  endTurn(life.engine, P1);
  assert.equal(life.engine.getStat(life.id("foe"), "life"), 4, "life loss gone");
});

clause(MAXWELL, "1:ability:strut", "it can be used again and again (no deplete): two uses stack, and the two options can be mixed", () => {
  const b = maxwellBoard({ icons: { rage: 4 } });
  strut(b, "foe", 0);
  strut(b, "foe", 1);
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 3);
  assert.equal(b.engine.getStat(b.id("foe"), "life"), 3);
  assert.equal(isDepleted(b.engine, b.id("mw")), false);
  assert.equal(ready(b.engine), 0, "2 + 2 resources spent");
});

clause(MAXWELL, "1:ability:strut", "the lost life is real: a character with 4 life and 3 damage that loses 1 life is destroyed", () => {
  const b = maxwellBoard({ extra: [{ key: "z3", def: zapTactic("Zap3", 3), owner: P1, zone: "hand" }] });
  play(b.engine, P1, b.id("z3"), { selected: { t: [b.id("foe")] } });
  assert.equal(zoneOf(b.engine, b.id("foe")), "play", "control: 3 damage does not kill a 4-life character");
  strut(b, "foe", 1);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard", "3 damage >= 3 life");
});

clause(MAXWELL, "1:ability:strut", "a 1-life character that loses 1 life has 0 life and is destroyed (FAQ)", () => {
  const b = maxwellBoard({ extra: [{ key: "frail", def: character({ name: "Frail", life: 1 }), owner: P2, zone: "play" }] });
  strut(b, "frail", 1);
  assert.equal(b.engine.getStat(b.id("frail"), "life"), 0);
  assert.equal(zoneOf(b.engine, b.id("frail")), "discard", "a character with 0 life is destroyed (0 damage >= 0 life)");
});

clause(MAXWELL, "1:ability:strut", "the speed gain is real speed: a speed-2 attacker boosted to 3 strikes first and survives an equal-strength speed-2 blocker", () => {
  const duel = (boost: boolean) => {
    const b = buildGame({
      playerA: { faction: developFaction() },
      playerB: { faction: developFaction() },
      turn: 2,
      activePlayerId: P1,
      cards: [
        { key: "mw", def: printing(MAXWELL), owner: P1, zone: "play" },
        { key: "atk", def: character({ name: "Atk", strength: 3, life: 3, speed: 2 }), owner: P1, zone: "play" },
        { key: "blk", def: character({ name: "Blk", strength: 3, life: 3, speed: 2 }), owner: P2, zone: "play" },
        ...res({ rage: 2 })
      ]
    });
    if (boost) strut(b, "atk", 0);
    declareAttackBy(b.engine, P1, [b.id("atk")]);
    b.engine.perform({ type: "declareBlockers", playerId: P2, blockerIds: [b.id("blk")] });
    autoResolveBattle(b.engine);
    return b;
  };
  const plain = duel(false);
  assert.equal(zoneOf(plain.engine, plain.id("atk")), "discard", "control: equal speed, both die");
  const boosted = duel(true);
  assert.equal(zoneOf(boosted.engine, boosted.id("blk")), "discard");
  assert.equal(zoneOf(boosted.engine, boosted.id("atk")), "play", "the faster attacker took no damage");
});

clause(MAXWELL, "1:ability:strut", "the cost is paid when the ability is used, before the opponent can respond: the 2 resources are spent, the choice and the effect come when it resolves", () => {
  const b = maxwellBoard();
  strutRaw(b, "foe");
  assert.ok(b.engine.state.responseWindow, "a response window is open");
  assert.equal(attachedCount(b.engine, P1), 2, "the cost is already paid");
  assert.equal(pending(b.engine), undefined, "the choice is not asked yet");
  assert.equal(b.engine.getStat(b.id("foe"), "speed"), 2);
  resolvePendingResponses(b.engine);
  assert.equal(pending(b.engine)?.kind, "chooserSelectsOption", "asked when it resolves");
});

clause(MAXWELL, "1:ability:strut", "'Pay 2': refused with only 1 resource (nothing is spent), accepted with exactly 2", () => {
  const one = maxwellBoard({ icons: { rage: 1 } });
  refused(() => strutRaw(one, "foe"), "one resource for a cost of 2");
  assert.equal(ready(one.engine), 1, "nothing was paid");
  const none = maxwellBoard({ icons: {} });
  refused(() => strutRaw(none, "foe"), "no resources");
  const two = maxwellBoard({ icons: { rage: 2 } });
  strut(two, "foe", 0);
  assert.equal(ready(two.engine), 0);
  assert.equal(two.engine.getStat(two.id("foe"), "speed"), 3);
});

clause(MAXWELL, "1:ability:strut", "the pick must be a character in play: an item, a location, a faction, a face-down card, a card in hand / discard, none or two are refused", () => {
  const b = maxwellBoard();
  const attempt = (picked: CardInstanceId[]) => () => activateRaw(b.engine, P1, b.id("mw"), STRUT, { c: picked });
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("inHand")]), "a character in my hand");
  refused(attempt([b.id("inDiscard")]), "a character in my discard pile");
  refused(attempt([]), "no pick");
  refused(attempt([b.id("mine"), b.id("foe")]), "two characters");
  assert.equal(attachedCount(b.engine, P1), 0, "none of those attempts paid anything");
  attempt([b.id("foe")])();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(MAXWELL, "1:ability:strut", "if the picked character is destroyed in response, the cost stays paid and nothing breaks", () => {
  const b = maxwellBoard({ extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  strutRaw(b, "foe");
  respondWith(b.engine, P2, b.id("kill"), { t: [b.id("foe")] });
  settle(b.engine);
  assert.equal(zoneOf(b.engine, b.id("foe")), "discard");
  assert.equal(attachedCount(b.engine, P1), 2);
  assert.equal(b.engine.state.pendingChoice, undefined, "the game is not stuck");
});

clause(MAXWELL, "1:ability:strut", "it works in response on the opponent's turn", () => {
  const b = maxwellBoard({ turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => strutRaw(b, "foe"), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  strutRaw(b, "mine");
  resolvePendingResponses(b.engine);
  answerPending(b.engine, "chooserSelectsOption", { index: 0 });
  assert.equal(b.engine.getStat(b.id("mine"), "speed"), 3);
});

clause(MAXWELL, "1:ability:strut", "only Maxwell's controller can use it, and only while he is in play", () => {
  const theirs = maxwellBoard({ turn: 2, active: P2, extra: res({ rage: 4 }, P2) });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("mw"), STRUT, { c: [theirs.id("mine")] }), "the opponent cannot use my Maxwell");
  const inHand = maxwellBoard({ zone: "hand" });
  refused(() => strutRaw(inHand, "foe"), "in my hand");
  assert.equal(attachedCount(inHand.engine, P1), 0);
});

// ==================================================================================
// Muddle Bugs
// BINGE -- COST: Deplete this card. Pick a character. -- EFFECT: Put a token on the character. Destroy it if it has at
// least X tokens on it, where X is its numeric cost.
// Item, rogue, cost 3, threshold [D][D][D].
// ==================================================================================

const BUGS = "0602ab86-73eb-4ca4-bf7f-c6149e75b88b";
const BINGE = "binge";

function bugsBoard(
  opts: { zone?: "play" | "hand"; depleted?: boolean; turn?: number; active?: PlayerId; extra?: CardPlacement[]; tokens?: Record<string, number> } = {}
) {
  return buildGame({
    playerA: { faction: developFaction() },
    playerB: { faction: developFaction() },
    turn: opts.turn,
    activePlayerId: opts.active,
    cards: [
      { key: "mb", def: printing(BUGS), owner: P1, zone: opts.zone ?? "play", depleted: opts.depleted },
      { key: "c0", def: character({ name: "Cost0", cost: 0, strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "c1", def: character({ name: "Cost1", cost: 1, strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "c2", def: character({ name: "Cost2", cost: 2, strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play", counters: opts.tokens },
      { key: "c3", def: character({ name: "Cost3", cost: 3, strength: 1, life: 4, speed: 1 }), owner: P2, zone: "play" },
      { key: "mine2", def: character({ name: "MyCost2", cost: 2, strength: 1, life: 4, speed: 1 }), owner: P1, zone: "play" },
      { key: "thing", def: item({ name: "Thing" }), owner: P1, zone: "play" },
      { key: "place", def: location({ name: "Place" }), owner: P2, zone: "play" },
      { key: "hidden", def: character({ name: "Hidden", cost: 0 }), owner: P2, zone: "play", faceDown: true },
      { key: "inHand", def: character({ name: "InHand" }), owner: P1, zone: "hand" },
      { key: "inDiscard", def: character({ name: "InDiscard" }), owner: P2, zone: "discard" },
      ...(opts.extra ?? [])
    ]
  });
}

type BugsGame = ReturnType<typeof bugsBoard>;
const binge = (b: BugsGame, target: string) => activate(b.engine, P1, b.id("mb"), BINGE, { selected: { c: [b.id(target)] } });
const bingeRaw = (b: BugsGame, target: string) => activateRaw(b.engine, P1, b.id("mb"), BINGE, { c: [b.id(target)] });

const BUGS_SPEC: DeploySpec = { id: BUGS, cost: 3, icon: "deception", count: 3 };

clause(BUGS, "0:ability:binge", "deploys for exactly 3 with [D][D][D] as an item; refused one short, and with only two [D] even with plenty of other resources", () => {
  deploysForExactlyItsCost(BUGS_SPEC);
  refusedOneShort(BUGS_SPEC);
  refusedWithoutThreshold(BUGS_SPEC);
  thresholdIsGateNotCost(BUGS_SPEC);
  const b = bugsBoard();
  assert.deepEqual(b.engine.getCardTypes(b.id("mb")), ["item"]);
  assert.equal(isDepleted(b.engine, b.id("mb")), false);
});

clause(BUGS, "0:ability:binge", "COST: Muddle Bugs is depleted (no resource is paid); EFFECT: exactly one token is put on the picked character", () => {
  const b = bugsBoard({ extra: res({ deception: 3 }) });
  binge(b, "c3");
  assert.equal(isDepleted(b.engine, b.id("mb")), true, "Muddle Bugs is depleted");
  assert.equal(tokensOn(b.engine, b.id("c3")), 1, "one token on the picked character");
  assert.equal(zoneOf(b.engine, b.id("c3")), "play", "1 token < cost 3: it survives");
  assert.equal(ready(b.engine), 3, "no resources were spent");
  assert.equal(tokensOn(b.engine, b.id("c2")), 0, "no other character got a token");
  assert.equal(tokensOn(b.engine, b.id("mb")), 0);
});

clause(BUGS, "0:ability:binge", "it can pick my own character too", () => {
  const b = bugsBoard();
  binge(b, "mine2");
  assert.equal(tokensOn(b.engine, b.id("mine2")), 1);
  assert.equal(zoneOf(b.engine, b.id("mine2")), "play", "1 token < cost 2");
});

clause(BUGS, "0:ability:binge", "the cost is paid when the ability is used, before the opponent can respond: Muddle Bugs is already depleted but no token has been placed yet", () => {
  const b = bugsBoard();
  bingeRaw(b, "c3");
  assert.ok(b.engine.state.responseWindow, "b.engine.state.responseWindow");
  assert.equal(isDepleted(b.engine, b.id("mb")), true);
  assert.equal(tokensOn(b.engine, b.id("c3")), 0, "the effect has not happened yet");
  resolvePendingResponses(b.engine);
  assert.equal(tokensOn(b.engine, b.id("c3")), 1);
});

clause(BUGS, "0:ability:binge", "a character whose numeric cost is 1 is destroyed by the first token (1 >= 1), into its owner's discard pile", () => {
  const b = bugsBoard();
  binge(b, "c1");
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.ok(discardOf(b.engine, P2).includes(b.id("c1")), "its owner's discard pile");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "other characters are untouched");
});

clause(BUGS, "0:ability:binge", "a character whose numeric cost is 0 is destroyed too (it has at least 0 tokens... and now 1)", () => {
  const b = bugsBoard();
  binge(b, "c0");
  assert.equal(zoneOf(b.engine, b.id("c0")), "discard");
});

clause(BUGS, "0:ability:binge", "'at least X tokens': a cost-2 character with 1 token survives the first Binge (1 < 2) with 1 token on it", () => {
  const b = bugsBoard();
  binge(b, "c2");
  assert.equal(tokensOn(b.engine, b.id("c2")), 1);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
});

clause(BUGS, "0:ability:binge", "tokens accumulate over turns: the second Binge (after Muddle Bugs is restored) puts the 2nd token on a cost-2 character and destroys it", () => {
  const b = bugsBoard({ turn: 1, active: P1 });
  binge(b, "c2");
  assert.equal(zoneOf(b.engine, b.id("c2")), "play");
  refused(() => bingeRaw(b, "c2"), "Muddle Bugs is depleted until restored");
  endTurn(b.engine, P1);
  endTurn(b.engine, P2);
  assert.equal(b.engine.state.activePlayerId, P1);
  assert.equal(isDepleted(b.engine, b.id("mb")), false, "restored");
  assert.equal(tokensOn(b.engine, b.id("c2")), 1, "the token stayed on the character");
  binge(b, "c2");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard", "2 tokens >= cost 2");
});

clause(BUGS, "0:ability:binge", "tokens already on the character count: a cost-3 character with 2 tokens is destroyed by the 3rd, one with 1 token is not", () => {
  const dead = bugsBoard({ extra: [{ key: "t2", def: character({ name: "Tokened2", cost: 3, life: 4 }), owner: P2, zone: "play", counters: { token: 2 } }] });
  binge(dead, "t2");
  assert.equal(zoneOf(dead.engine, dead.id("t2")), "discard", "3 tokens >= cost 3");
  const alive = bugsBoard({ extra: [{ key: "t1", def: character({ name: "Tokened1", cost: 3, life: 4 }), owner: P2, zone: "play", counters: { token: 1 } }] });
  binge(alive, "t1");
  assert.equal(tokensOn(alive.engine, alive.id("t1")), 2);
  assert.equal(zoneOf(alive.engine, alive.id("t1")), "play", "2 tokens < cost 3");
});

clause(BUGS, "0:ability:binge", "more tokens than the cost also destroy: a cost-2 character with 4 tokens", () => {
  const b = bugsBoard({ tokens: { token: 4 } });
  binge(b, "c2");
  assert.equal(zoneOf(b.engine, b.id("c2")), "discard");
});

clause(BUGS, "0:ability:binge", "only TOKENS count: other counters on the character do not", () => {
  const b = bugsBoard({ tokens: { stamp: 5 } });
  binge(b, "c2");
  assert.equal(tokensOn(b.engine, b.id("c2")), 1);
  assert.equal(zoneOf(b.engine, b.id("c2")), "play", "1 token < cost 2, whatever other counters it has");
});

clause(BUGS, "0:ability:binge", "X is the picked character's printed numeric cost: a cost-3 character is not destroyed by one token while a cost-1 one is", () => {
  const b = bugsBoard({ extra: res({ deception: 3 }) });
  binge(b, "c3");
  assert.equal(zoneOf(b.engine, b.id("c3")), "play");
  const c = bugsBoard();
  binge(c, "c1");
  assert.equal(zoneOf(c.engine, c.id("c1")), "discard");
});

clause(BUGS, "0:ability:binge", "tokens disappear when the card leaves play (CR 409.2): the destroyed character has no tokens left", () => {
  const b = bugsBoard();
  binge(b, "c1");
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
  assert.equal(tokensOn(b.engine, b.id("c1")), 0, "its token disappeared when it left play");
});

clause(BUGS, "0:ability:binge", "'Deplete this card': a depleted Muddle Bugs cannot be used; no token is placed", () => {
  const b = bugsBoard({ depleted: true });
  refused(() => bingeRaw(b, "c1"), "already depleted");
  assert.equal(tokensOn(b.engine, b.id("c1")), 0);
  assert.equal(zoneOf(b.engine, b.id("c1")), "play");
});

clause(BUGS, "0:ability:binge", "the pick must be a character in play: an item (not even Muddle Bugs itself), a location, a faction, a face-down card, a card in hand / discard, none or two are refused", () => {
  const b = bugsBoard();
  const attempt = (picked: CardInstanceId[]) => () => activateRaw(b.engine, P1, b.id("mb"), BINGE, { c: picked });
  refused(attempt([b.id("thing")]), "an item");
  refused(attempt([b.id("mb")]), "Muddle Bugs itself is an item");
  refused(attempt([b.id("place")]), "a location");
  refused(attempt([factionOf(b.engine, P1)]), "my faction");
  refused(attempt([factionOf(b.engine, P2)]), "their faction");
  refused(attempt([b.id("hidden")]), "a face-down card");
  refused(attempt([b.id("inHand")]), "a character in my hand");
  refused(attempt([b.id("inDiscard")]), "a character in a discard pile");
  refused(attempt([]), "no pick");
  refused(attempt([b.id("c1"), b.id("c2")]), "two characters");
  assert.equal(isDepleted(b.engine, b.id("mb")), false, "none of those attempts paid anything");
  attempt([b.id("c3")])();
  assert.ok(b.engine.state.responseWindow, "control: a character is accepted");
});

clause(BUGS, "0:ability:binge", "if the picked character is destroyed in response, the cost stays paid and nothing breaks", () => {
  const b = bugsBoard({ extra: [{ key: "kill", def: killAnyTactic("character"), owner: P2, zone: "hand" }] });
  bingeRaw(b, "c3");
  respondWith(b.engine, P2, b.id("kill"), { t: [b.id("c3")] });
  assert.equal(zoneOf(b.engine, b.id("c3")), "discard");
  assert.equal(isDepleted(b.engine, b.id("mb")), true);
  assert.equal(b.engine.state.pendingChoice, undefined);
});

clause(BUGS, "0:ability:binge", "it works in response on the opponent's turn", () => {
  const b = bugsBoard({ turn: 2, active: P2, extra: [{ key: "nothing", def: nothingTactic(), owner: P2, zone: "hand" }] });
  refused(() => bingeRaw(b, "c1"), "nothing to respond to yet");
  playRaw(b.engine, P2, b.id("nothing"));
  bingeRaw(b, "c1");
  resolvePendingResponses(b.engine);
  assert.equal(zoneOf(b.engine, b.id("c1")), "discard");
});

clause(BUGS, "0:ability:binge", "only the controller can use it, and only while it is in play and face-up", () => {
  const theirs = bugsBoard({ turn: 2, active: P2 });
  refused(() => activateRaw(theirs.engine, P2, theirs.id("mb"), BINGE, { c: [theirs.id("mine2")] }), "the opponent cannot use my Muddle Bugs");
  const inHand = bugsBoard({ zone: "hand" });
  refused(() => bingeRaw(inHand, "c1"), "in my hand");
  assert.equal(tokensOn(inHand.engine, inHand.id("c1")), 0);
});
